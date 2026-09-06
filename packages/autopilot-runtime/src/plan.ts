// The plan the human hands to Autopilot, and progress against it.
//
// DIVISION OF OWNERSHIP — read this before changing anything here.
//
// The plan's CONTENT belongs to the human. It is the output of design work that
// happens outside DexNest (brainstorming with an agent or a chat), it lives in
// the Run Spec, it is covered by the authoritative fingerprint, and nothing in
// the runtime may rewrite it. An agent that could edit its own instructions is
// not executing a plan, it is choosing one.
//
// The plan's PROGRESS belongs to the runtime. Which item is in flight and which
// are finished changes constantly, so it lives in autopilot_plan_items instead,
// and every transition is journalled.
//
// This module is deliberately inert. It records what happened; it does not
// decide what to do next and it never dispatches anything. Choosing the next
// item is a later phase.

import type { RuntimePorts } from "./ports.ts";
import type { SqlDatabase } from "./ports.ts";
import type { PlanItem, RunSpec } from "./runSpec.ts";
import { AutopilotStore } from "./store.ts";

/** PENDING is the absence of a row, not a stored value. */
export type PlanItemStatus = "PENDING" | "ACTIVE" | "DONE" | "BLOCKED" | "SKIPPED";

/** A settled outcome cannot be reached from another settled outcome. */
const SETTLED: readonly PlanItemStatus[] = ["DONE", "BLOCKED", "SKIPPED"];

export interface PlanItemProgress extends PlanItem {
  status: PlanItemStatus;
  note: string | null;
  startedAt: string | null;
  settledAt: string | null;
}

/**
 * A progress row whose item is no longer in the Run Spec.
 *
 * Only reachable through an explicit, human-approved spec revision. Reported
 * rather than deleted: silently dropping the record of work that was done is
 * worse than showing a row that no longer has a home.
 */
export interface OrphanedProgress {
  itemId: string;
  status: PlanItemStatus;
  note: string | null;
  startedAt: string;
  settledAt: string | null;
}

export interface PlanView {
  items: PlanItemProgress[];
  orphans: OrphanedProgress[];
  counts: Record<PlanItemStatus, number>;
}

export class PlanItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanItemError";
  }
}

interface PlanRow {
  item_id: string;
  status: string;
  note: string | null;
  started_at: string;
  settled_at: string | null;
}

export class PlanStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  /** Tolerates a database that predates migration 15. */
  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_plan_items'").get()
    );
  }

  private rows(runId: string): PlanRow[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT item_id, status, note, started_at, settled_at FROM autopilot_plan_items WHERE run_id=:runId")
      .all<PlanRow>({ runId });
  }

  /** The plan as the operator should see it: spec content joined with status. */
  view(runId: string, spec: Pick<RunSpec, "plan">): PlanView {
    const byId = new Map(this.rows(runId).map((row) => [row.item_id, row]));
    const counts: Record<PlanItemStatus, number> = { PENDING: 0, ACTIVE: 0, DONE: 0, BLOCKED: 0, SKIPPED: 0 };

    const items = (spec.plan ?? []).map((item) => {
      const row = byId.get(item.id);
      const status = (row?.status ?? "PENDING") as PlanItemStatus;
      counts[status] += 1;
      return {
        ...item,
        status,
        note: row?.note ?? null,
        startedAt: row?.started_at ?? null,
        settledAt: row?.settled_at ?? null
      };
    });

    const known = new Set((spec.plan ?? []).map((item) => item.id));
    const orphans = [...byId.values()]
      .filter((row) => !known.has(row.item_id))
      .map((row) => ({
        itemId: row.item_id,
        status: row.status as PlanItemStatus,
        note: row.note,
        startedAt: row.started_at,
        settledAt: row.settled_at
      }));

    return { items, orphans, counts };
  }

  /** The item currently in flight, if any. At most one per run. */
  active(runId: string, spec: Pick<RunSpec, "plan">): PlanItemProgress | null {
    return this.view(runId, spec).items.find((item) => item.status === "ACTIVE") ?? null;
  }

  /**
   * The first item not yet started. A recommendation only — nothing in this
   * phase acts on it, and the caller is free to choose a different item.
   */
  next(runId: string, spec: Pick<RunSpec, "plan">): PlanItemProgress | null {
    return this.view(runId, spec).items.find((item) => item.status === "PENDING") ?? null;
  }

  /** True once every item has reached a settled outcome. Never implies success. */
  settled(runId: string, spec: Pick<RunSpec, "plan">): boolean {
    const items = this.view(runId, spec).items;
    return items.length > 0 && items.every((item) => SETTLED.includes(item.status));
  }

  private require(runId: string, spec: Pick<RunSpec, "plan">, itemId: string): PlanItemProgress {
    if (!this.available()) throw new PlanItemError("Plan progress requires migration 15.");
    const item = this.view(runId, spec).items.find((candidate) => candidate.id === itemId);
    if (!item) throw new PlanItemError(`Plan item "${itemId}" is not in this run's plan.`);
    return item;
  }

  /** Marks an item in flight. Refuses while another item holds the slot. */
  start(runId: string, spec: Pick<RunSpec, "plan">, itemId: string): PlanItemProgress {
    return this.store.transaction(() => {
      const item = this.require(runId, spec, itemId);
      if (item.status === "ACTIVE") return item;
      if (SETTLED.includes(item.status)) {
        throw new PlanItemError(`Plan item "${itemId}" is already ${item.status}; reset it first.`);
      }
      const inFlight = this.active(runId, spec);
      if (inFlight) {
        throw new PlanItemError(`Plan item "${inFlight.id}" is already in progress; one item at a time.`);
      }

      const now = this.ports.clock.now();
      this.db
        .prepare(
          `INSERT INTO autopilot_plan_items (id, run_id, item_id, status, note, started_at, settled_at)
           VALUES (:id, :runId, :itemId, 'ACTIVE', NULL, :now, NULL)
           ON CONFLICT(run_id, item_id)
             DO UPDATE SET status='ACTIVE', note=NULL, started_at=:now, settled_at=NULL`
        )
        .run({ id: this.ports.ids.next("plan-item"), runId, itemId, now });

      this.store.appendEvent(runId, {
        type: "PLAN_ITEM_STARTED",
        payload: { itemId, ordinal: item.ordinal, title: item.title }
      });
      return this.require(runId, spec, itemId);
    });
  }

  private settle(
    runId: string,
    spec: Pick<RunSpec, "plan">,
    itemId: string,
    status: "DONE" | "BLOCKED" | "SKIPPED",
    note: string | null
  ): PlanItemProgress {
    return this.store.transaction(() => {
      const item = this.require(runId, spec, itemId);
      if (SETTLED.includes(item.status)) {
        throw new PlanItemError(`Plan item "${itemId}" is already ${item.status}.`);
      }
      // SKIPPED and BLOCKED are legitimate outcomes for an item never started;
      // DONE is not, because nothing would have produced the work.
      if (status === "DONE" && item.status !== "ACTIVE") {
        throw new PlanItemError(`Plan item "${itemId}" was never started.`);
      }

      const now = this.ports.clock.now();
      this.db
        .prepare(
          `INSERT INTO autopilot_plan_items (id, run_id, item_id, status, note, started_at, settled_at)
           VALUES (:id, :runId, :itemId, :status, :note, :now, :now)
           ON CONFLICT(run_id, item_id)
             DO UPDATE SET status=:status, note=:note, settled_at=:now`
        )
        .run({ id: this.ports.ids.next("plan-item"), runId, itemId, status, note, now });

      this.store.appendEvent(runId, {
        type: status === "DONE" ? "PLAN_ITEM_COMPLETED" : status === "BLOCKED" ? "PLAN_ITEM_BLOCKED" : "PLAN_ITEM_SKIPPED",
        payload: { itemId, ordinal: item.ordinal, ...(note ? { note } : {}) }
      });
      return this.require(runId, spec, itemId);
    });
  }

  complete(runId: string, spec: Pick<RunSpec, "plan">, itemId: string, note?: string): PlanItemProgress {
    return this.settle(runId, spec, itemId, "DONE", note ?? null);
  }

  block(runId: string, spec: Pick<RunSpec, "plan">, itemId: string, reason: string): PlanItemProgress {
    if (!reason.trim()) throw new PlanItemError("Blocking an item requires a reason.");
    return this.settle(runId, spec, itemId, "BLOCKED", reason.trim());
  }

  skip(runId: string, spec: Pick<RunSpec, "plan">, itemId: string, reason: string): PlanItemProgress {
    if (!reason.trim()) throw new PlanItemError("Skipping an item requires a reason.");
    return this.settle(runId, spec, itemId, "SKIPPED", reason.trim());
  }

  /**
   * Returns an item to PENDING. The human's escape hatch when an item was
   * settled wrongly; the journal keeps the earlier outcome either way.
   */
  reset(runId: string, spec: Pick<RunSpec, "plan">, itemId: string, reason: string): PlanItemProgress {
    if (!reason.trim()) throw new PlanItemError("Resetting an item requires a reason.");
    return this.store.transaction(() => {
      const item = this.require(runId, spec, itemId);
      if (item.status === "PENDING") return item;
      this.db.prepare("DELETE FROM autopilot_plan_items WHERE run_id=:runId AND item_id=:itemId").run({ runId, itemId });
      this.store.appendEvent(runId, {
        type: "PLAN_ITEM_RESET",
        payload: { itemId, ordinal: item.ordinal, from: item.status, reason: reason.trim() }
      });
      return this.require(runId, spec, itemId);
    });
  }
}

/**
 * The plan as the worker is told it.
 *
 * Every item every turn, with its status, because a worker that only sees the
 * current item cannot tell whether it is finishing something or starting the
 * whole project. The ACTIVE one is marked because that is the one being asked
 * for now; the rest are there so it knows where the work sits.
 */
export function renderPlanForWorker(view: PlanView): string {
  if (view.items.length === 0) return "";
  const lines = ["THE PLAN", "", "Each item is one piece of work. You are asked for one at a time."];
  for (const item of view.items) {
    const mark = item.status === "DONE" ? "done"
      : item.status === "ACTIVE" ? "DO THIS NOW"
      : item.status === "PENDING" ? "not started"
      : item.status.toLowerCase();
    lines.push("", `[${mark}] ${item.id} — ${item.title}`);
    if (item.status === "ACTIVE" && item.detail) lines.push(item.detail);
  }
  lines.push(
    "",
    "Do only the item marked DO THIS NOW. Finishing early is better than",
    "starting the next one; the run will come back for that."
  );
  return lines.join("\n");
}

/** One line per item. Used by reports and by the Control Center. */
export function renderPlanProgress(view: PlanView): string {
  if (view.items.length === 0) return "No plan items.";
  const mark: Record<PlanItemStatus, string> = {
    PENDING: "[ ]", ACTIVE: "[>]", DONE: "[x]", BLOCKED: "[!]", SKIPPED: "[-]"
  };
  const lines = view.items.map((item) => {
    const note = item.note ? ` — ${item.note}` : "";
    return `${mark[item.status]} ${item.ordinal}. ${item.title}${note}`;
  });
  if (view.orphans.length > 0) {
    lines.push("", `${view.orphans.length} progress record(s) no longer match any plan item:`);
    for (const orphan of view.orphans) lines.push(`  ? ${orphan.itemId} (${orphan.status})`);
  }
  return lines.join("\n");
}
