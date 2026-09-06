// The iteration: one durable cycle of assignment, work, verification, checkpoint.
//
// WHY THIS EXISTS
//
// Turns, verifications and checkpoints are already durable, but nothing joins
// them. "What happened on iteration 7" currently means correlating three tables
// by turn id and hoping. Phases that chain iterations without a human present
// need a single row they can count, bound and resume against, so this is that
// row — and nothing more.
//
// WHAT THIS DELIBERATELY IS NOT
//
// It is not a copy of the conversation. DexNest is the orchestrator; the place
// to watch the work is the agent's own session, which is a real Claude Code
// conversation the operator can open in their editor. Reproducing that
// transcript inside DexNest would mean maintaining a worse version of a UI that
// already exists, and it would go stale the moment the agent said anything
// DexNest did not model.
//
// So this module stores pointers, not content: which turn, which verification,
// which checkpoint, and where to go to read what was actually said.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";

export type IterationStatus = "ACTIVE" | "VERIFIED" | "FAILED" | "INDETERMINATE" | "ABANDONED";

/** An iteration in one of these has a settled outcome and never reopens. */
const SETTLED: readonly IterationStatus[] = ["VERIFIED", "FAILED", "INDETERMINATE", "ABANDONED"];

export interface IterationRecord {
  id: string;
  runId: string;
  ordinal: number;
  /** The plan item this iteration advanced, when the run has a plan. */
  planItemId: string | null;
  turnId: string | null;
  verificationId: string | null;
  checkpointId: string | null;
  status: IterationStatus;
  summary: string | null;
  startedAt: string;
  settledAt: string | null;
}

interface IterationRow {
  id: string;
  run_id: string;
  ordinal: number;
  plan_item_id: string | null;
  turn_id: string | null;
  verification_id: string | null;
  checkpoint_id: string | null;
  status: string;
  summary: string | null;
  started_at: string;
  settled_at: string | null;
}

const toRecord = (row: IterationRow): IterationRecord => ({
  id: row.id,
  runId: row.run_id,
  ordinal: row.ordinal,
  planItemId: row.plan_item_id,
  turnId: row.turn_id,
  verificationId: row.verification_id,
  checkpointId: row.checkpoint_id,
  status: row.status as IterationStatus,
  summary: row.summary,
  startedAt: row.started_at,
  settledAt: row.settled_at
});

export class IterationStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_iterations'").get()
    );
  }

  list(runId: string): IterationRecord[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_iterations WHERE run_id=:runId ORDER BY ordinal")
      .all<IterationRow>({ runId })
      .map(toRecord);
  }

  active(runId: string): IterationRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_iterations WHERE run_id=:runId AND status='ACTIVE'")
      .get<IterationRow>({ runId });
    return row ? toRecord(row) : null;
  }

  forTurn(runId: string, turnId: string): IterationRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_iterations WHERE run_id=:runId AND turn_id=:turnId")
      .get<IterationRow>({ runId, turnId });
    return row ? toRecord(row) : null;
  }

  /** How many iterations have been spent. What a later budget counts. */
  count(runId: string): number {
    return this.list(runId).length;
  }

  /**
   * Opens the iteration for a turn.
   *
   * Idempotent on turn id, so a resumed run rejoins the iteration it was in
   * rather than opening a second one for the same work.
   */
  open(input: { runId: string; turnId: string; planItemId?: string | null }): IterationRecord | null {
    if (!this.available()) return null;
    return this.store.transaction(() => {
      const existing = this.forTurn(input.runId, input.turnId);
      if (existing) return existing;

      // A run can stop between a turn starting and its outcome: paused, held
      // for a consultation, a worker failure, a crash. The iteration is then
      // left open, and when work resumes it resumes as a NEW turn — so the old
      // iteration is over whatever happened to it.
      //
      // Refusing here would wedge the run permanently. Silently deleting the
      // row would erase that the attempt happened. So it is closed as
      // ABANDONED, keeping its link to the turn, whose own row records the
      // actual outcome.
      const stale = this.active(input.runId);
      if (stale && stale.turnId !== input.turnId) {
        this.settleUnsafe(input.runId, stale, "ABANDONED", "Did not reach an outcome before the next turn began.");
      }

      const ordinal = (this.list(input.runId).at(-1)?.ordinal ?? 0) + 1;
      const id = this.ports.ids.next("iteration");
      this.db
        .prepare(
          `INSERT INTO autopilot_iterations (id, run_id, ordinal, plan_item_id, turn_id, status, started_at)
           VALUES (:id, :runId, :ordinal, :planItemId, :turnId, 'ACTIVE', :now)`
        )
        .run({
          id, runId: input.runId, ordinal, planItemId: input.planItemId ?? null,
          turnId: input.turnId, now: this.ports.clock.now()
        });

      this.store.appendEvent(input.runId, {
        type: "ITERATION_STARTED",
        stepKey: input.turnId,
        payload: { iterationId: id, ordinal, turnId: input.turnId, planItemId: input.planItemId ?? null }
      });
      return this.forTurn(input.runId, input.turnId)!;
    });
  }

  /** Writes the outcome. The caller must already hold the transaction. */
  private settleUnsafe(
    runId: string,
    iteration: IterationRecord,
    status: Exclude<IterationStatus, "ACTIVE">,
    summary: string | null,
    verificationId: string | null = null,
    checkpointId: string | null = null
  ): void {
    this.db
      .prepare(
        `UPDATE autopilot_iterations
            SET status=:status, verification_id=:verificationId, checkpoint_id=:checkpointId,
                summary=:summary, settled_at=:now
          WHERE id=:id`
      )
      .run({
        id: iteration.id, status, verificationId, checkpointId,
        summary: (summary ?? "").slice(0, 2000) || null,
        now: this.ports.clock.now()
      });

    this.store.appendEvent(runId, {
      type: "ITERATION_SETTLED",
      stepKey: iteration.turnId,
      payload: { iterationId: iteration.id, ordinal: iteration.ordinal, status, checkpointId }
    });
  }

  /**
   * Settles whatever iteration is in flight.
   *
   * An iteration spans every turn its assignment needed — repairs and context
   * round-trips included — so the turn that ends it is usually not the turn
   * that opened it. Callers say what happened, not which turn it happened on.
   */
  settleActive(runId: string, input: {
    status: Exclude<IterationStatus, "ACTIVE">;
    verificationId?: string | null;
    checkpointId?: string | null;
    summary?: string | null;
  }): IterationRecord | null {
    if (!this.available()) return null;
    return this.store.transaction(() => {
      const current = this.active(runId);
      if (!current) return null;
      this.settleUnsafe(
        runId, current, input.status, input.summary ?? null,
        input.verificationId ?? null, input.checkpointId ?? null
      );
      return this.list(runId).find((iteration) => iteration.id === current.id)!;
    });
  }

  /** Records how a specific turn's iteration ended. Settling twice is refused. */
  settle(input: {
    runId: string;
    turnId: string;
    status: Exclude<IterationStatus, "ACTIVE">;
    verificationId?: string | null;
    checkpointId?: string | null;
    summary?: string | null;
  }): IterationRecord | null {
    if (!this.available()) return null;
    return this.store.transaction(() => {
      const current = this.forTurn(input.runId, input.turnId);
      if (!current) return null;
      // A settled iteration is history. Re-settling would rewrite it.
      if (SETTLED.includes(current.status)) return current;

      this.settleUnsafe(
        input.runId, current, input.status, input.summary ?? null,
        input.verificationId ?? null, input.checkpointId ?? null
      );
      return this.forTurn(input.runId, input.turnId)!;
    });
  }
}

/**
 * Where the operator goes to read what actually happened.
 *
 * DexNest orchestrates; the conversation lives in the agent's own session, and
 * that session is a real one the operator can open. This returns the way in
 * rather than a copy of what is inside it.
 *
 * The warning is not decoration. A transcript has one writer: opening the
 * session while a run is mid-iteration puts the editor and DexNest in the same
 * file, which is the situation Phase 3 refuses to create on purpose.
 */
export function renderWhereToWatch(input: {
  provider: string;
  sessionId: string | null;
  cwd: string | null;
  runActive: boolean;
}): string {
  if (!input.sessionId) return "This run has no agent session yet.";
  const lines = [
    `The work happens in ${input.provider} session ${input.sessionId}.`,
    input.cwd ? `Open it from ${input.cwd}:` : "Open it with:",
    input.provider === "claude" ? `  claude --resume ${input.sessionId}` : `  codex resume ${input.sessionId}`
  ];
  if (input.runActive) {
    lines.push(
      "",
      "The run is working right now. Wait until it pauses before opening the",
      "session: a conversation has one writer, and two would interleave."
    );
  }
  return lines.join("\n");
}

/** The orchestrator's whole status line. Deliberately small. */
export function renderIterationStatus(iterations: IterationRecord[]): string {
  if (iterations.length === 0) return "No iterations yet.";
  const mark: Record<IterationStatus, string> = {
    ACTIVE: "[>]", VERIFIED: "[x]", FAILED: "[!]", INDETERMINATE: "[?]", ABANDONED: "[-]"
  };
  return iterations
    .map((iteration) => {
      const outcome = iteration.summary ? ` — ${iteration.summary.split("\n")[0]!.slice(0, 120)}` : "";
      return `${mark[iteration.status]} iteration ${iteration.ordinal}${outcome}`;
    })
    .join("\n");
}
