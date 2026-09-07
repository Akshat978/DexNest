// Several projects in one night, on one budget.
//
// An Autopilot authorization covers one run in one repository, started because
// a person clicked Start. That is the whole reason an overnight session can
// only ever improve one project. This is the durable half of the fix: the
// decision logic lives in @dexnest/run-queue, which is pure and knows nothing
// about SQLite, runs or Electron; this store persists the queue, derives the
// engine's inputs from rows, and translates how a run ended into what happened
// to a queue item.
//
// WHY RECORDS ARE DERIVED
//
// The engine takes `records` — one per item — as an argument. They are not
// stored as their own table. Each item row carries its own status, timestamps
// and reason, and the records are built from those rows every time. Two places
// holding the same truth is how they come to disagree, and a queue that thinks
// an item is PENDING while the item row says DONE would start work twice.
//
// WHY TRANSITIONS GO THROUGH THE ENGINE
//
// Writing a status straight to SQLite would bypass the transition matrix the
// engine exists to enforce. Every settle calls `transition()` first, so an
// illegal move (DONE back to RUNNING, say) is refused here exactly as it is in
// the engine's own tests.

import {
  buildQueue,
  nextAction,
  progress,
  recordsFor,
  renderQueueSummary,
  transition,
  type QueueAction,
  type QueueBudget,
  type QueueItem,
  type QueueRecord,
  type QueueStatus,
  type QueueStopReason
} from "@dexnest/run-queue";
import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import type { LoopStopReason } from "./loop.ts";

/**
 * How a run ending becomes what happened to its queue item.
 *
 * Three groups, and the distinction between them is the whole design:
 *
 *   settle DONE       the work reached a green stopping point
 *   settle ABANDONED  a bound was spent — nothing is wrong, we simply stopped
 *   settle FAILED     something is actually broken and a person should look
 *   hold              do not advance; this run is still someone's business
 *
 * ABANDONED rather than FAILED for spent budgets matters: maxConsecutiveFailures
 * counts failures, and a queue that stopped three projects for running out of
 * turns has not encountered three broken projects.
 */
export const QUEUE_OUTCOME: Readonly<Record<LoopStopReason, QueueStatus | "hold">> = Object.freeze({
  // Green stopping points. plan_complete_proposed still needs a human to accept
  // the RUN, but the queue must not wait for one at 3am — the project's work is
  // finished as far as tonight is concerned, and the morning summary says so.
  completed: "DONE",
  plan_complete_proposed: "DONE",

  // Bounds, not breakage.
  turn_limit: "ABANDONED",
  iteration_limit: "ABANDONED",
  time_limit: "ABANDONED",
  cost_limit: "ABANDONED",
  no_progress: "ABANDONED",

  // Genuinely stuck.
  consecutive_failures: "FAILED",
  worker_failed: "FAILED",
  verification_indeterminate: "FAILED",
  primary_blocked: "FAILED",
  consultant_recommended: "FAILED",
  direction_needs_human: "FAILED",
  worker_uncertain: "FAILED",

  // Not ours to settle. provider_limit already has a scheduled retry, and the
  // rest mean a person intervened — marching on to the next project would
  // override the decision they just made.
  provider_limit: "hold",
  paused: "hold",
  stopped: "hold",
  grant_closed: "hold"
});

export interface QueueItemInput {
  projectPath: string;
  goal: string;
  planText?: string;
  label?: string;
}

/** How every run in a queue is set up. One template per queue, on purpose. */
export interface RunTemplate {
  model: string | null;
  effort: string | null;
  maxTurns: number;
  maxIterations: number;
  maxIdleTurns: number;
  maxFailures: number;
}

export interface RunQueueRecord {
  id: string;
  status: "ACTIVE" | "CLOSED";
  budget: QueueBudget;
  template: RunTemplate;
  createdAt: string;
  closedAt: string | null;
  closedReason: string | null;
}

export interface RunQueueItemRecord extends QueueItem {
  queueId: string;
  status: QueueStatus;
  startedAt: string | null;
  settledAt: string | null;
  reason: string | null;
  /** The Autopilot run this item became, once it started. */
  runId: string | null;
}

interface QueueRow {
  id: string;
  status: string;
  deadline: string | null;
  max_cost_usd: number | null;
  max_items: number | null;
  max_consecutive_failures: number | null;
  model: string | null;
  effort: string | null;
  max_turns: number;
  max_iterations: number;
  max_idle_turns: number;
  max_failures: number;
  created_at: string;
  closed_at: string | null;
  closed_reason: string | null;
}

interface ItemRow {
  id: string;
  queue_id: string;
  ordinal: number;
  project_path: string;
  goal: string;
  plan_text: string | null;
  label: string | null;
  status: string;
  started_at: string | null;
  settled_at: string | null;
  reason: string | null;
  run_id: string | null;
}

const toQueue = (row: QueueRow): RunQueueRecord => ({
  id: row.id,
  status: row.status as RunQueueRecord["status"],
  budget: {
    ...(row.deadline !== null ? { deadline: row.deadline } : {}),
    ...(row.max_cost_usd !== null ? { maxCostUsd: row.max_cost_usd } : {}),
    ...(row.max_items !== null ? { maxItems: row.max_items } : {}),
    ...(row.max_consecutive_failures !== null ? { maxConsecutiveFailures: row.max_consecutive_failures } : {})
  },
  template: {
    model: row.model,
    effort: row.effort,
    maxTurns: row.max_turns,
    maxIterations: row.max_iterations,
    maxIdleTurns: row.max_idle_turns,
    maxFailures: row.max_failures
  },
  createdAt: row.created_at,
  closedAt: row.closed_at,
  closedReason: row.closed_reason
});

const toItem = (row: ItemRow): RunQueueItemRecord => ({
  id: row.id,
  queueId: row.queue_id,
  ordinal: row.ordinal,
  projectPath: row.project_path,
  goal: row.goal,
  ...(row.plan_text ? { planText: row.plan_text } : {}),
  ...(row.label ? { label: row.label } : {}),
  status: row.status as QueueStatus,
  startedAt: row.started_at,
  settledAt: row.settled_at,
  reason: row.reason,
  runId: row.run_id
});

/** The engine's record, derived from the item row rather than stored twice. */
const recordOf = (item: RunQueueItemRecord): QueueRecord => ({
  itemId: item.id,
  status: item.status,
  startedAt: item.startedAt,
  settledAt: item.settledAt,
  reason: item.reason
});

export class RunQueueStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  /** Older databases have no queue tables; a host without them simply has none. */
  available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_run_queues'").get()
    );
  }

  /**
   * Creates a queue.
   *
   * The items go through the engine's own `buildQueue` first, so a blank goal
   * or a relative project path is refused with the engine's message before
   * anything is written. Ordinals come from the engine, never from the caller.
   */
  create(input: {
    items: readonly QueueItemInput[];
    budget?: QueueBudget;
    template?: Partial<RunTemplate>;
  }): RunQueueRecord {
    if (!this.available()) throw new Error("This database is too old to hold a run queue.");
    if (this.active()) throw new Error("A run queue is already active. Close it before starting another.");

    const now = this.ports.clock.now();
    const id = this.ports.ids.next("queue");
    // Ids are needed before buildQueue can validate, because the engine
    // identifies items by id in every refusal message.
    const built = buildQueue(
      input.items.map((item, index) => ({
        id: `${id}-item-${index + 1}`,
        projectPath: item.projectPath,
        goal: item.goal,
        ...(item.planText ? { planText: item.planText } : {}),
        ...(item.label ? { label: item.label } : {})
      }))
    );
    if (built.length === 0) throw new Error("A run queue needs at least one project.");

    const budget = input.budget ?? {};
    const template = input.template ?? {};
    return this.store.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO autopilot_run_queues
             (id, status, deadline, max_cost_usd, max_items, max_consecutive_failures,
              model, effort, max_turns, max_iterations, max_idle_turns, max_failures, created_at)
           VALUES (:id, 'ACTIVE', :deadline, :maxCostUsd, :maxItems, :maxConsecutive,
              :model, :effort, :maxTurns, :maxIterations, :maxIdleTurns, :maxFailures, :now)`
        )
        .run({
          id, now,
          deadline: budget.deadline ?? null,
          maxCostUsd: budget.maxCostUsd ?? null,
          maxItems: budget.maxItems ?? null,
          maxConsecutive: budget.maxConsecutiveFailures ?? null,
          model: template.model ?? null,
          effort: template.effort ?? null,
          maxTurns: template.maxTurns ?? 50,
          maxIterations: template.maxIterations ?? 25,
          maxIdleTurns: template.maxIdleTurns ?? 5,
          maxFailures: template.maxFailures ?? 5
        });
      for (const item of built) {
        this.db
          .prepare(
            `INSERT INTO autopilot_run_queue_items
               (id, queue_id, ordinal, project_path, goal, plan_text, label, status)
             VALUES (:id, :queueId, :ordinal, :projectPath, :goal, :planText, :label, 'PENDING')`
          )
          .run({
            id: item.id, queueId: id, ordinal: item.ordinal,
            projectPath: item.projectPath, goal: item.goal,
            planText: item.planText ?? null, label: item.label ?? null
          });
      }
      return this.get(id)!;
    });
  }

  get(queueId: string): RunQueueRecord | null {
    if (!this.available()) return null;
    const row = this.db.prepare("SELECT * FROM autopilot_run_queues WHERE id=:id").get<QueueRow>({ id: queueId });
    return row ? toQueue(row) : null;
  }

  /** The one queue currently being worked through, if any. */
  active(): RunQueueRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_run_queues WHERE status='ACTIVE' ORDER BY rowid DESC LIMIT 1")
      .get<QueueRow>({});
    return row ? toQueue(row) : null;
  }

  items(queueId: string): RunQueueItemRecord[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_run_queue_items WHERE queue_id=:queueId ORDER BY ordinal")
      .all<ItemRow>({ queueId })
      .map(toItem);
  }

  /** The queue item a run belongs to, or null for an ordinary standalone run. */
  itemForRun(runId: string): RunQueueItemRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_run_queue_items WHERE run_id=:runId")
      .get<ItemRow>({ runId });
    return row ? toItem(row) : null;
  }

  /**
   * What the whole queue has cost so far, summed from the turns of its runs.
   *
   * Derived rather than counted, for the same reason every other budget in the
   * runtime is: a stored total that can drift eventually authorizes the wrong
   * amount of work. The figure is the provider's own, which on a subscription
   * is a usage proxy rather than a bill.
   */
  spentUsd(queueId: string): number {
    if (!this.available()) return 0;
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(t.cost_usd), 0) AS total
           FROM autopilot_turns t
           JOIN autopilot_run_queue_items i ON i.run_id = t.run_id
          WHERE i.queue_id = :queueId`
      )
      .get<{ total: number }>({ queueId });
    return row?.total ?? 0;
  }

  /** Everything the engine needs, assembled from rows. */
  view(queueId: string): { queue: QueueItem[]; records: QueueRecord[]; budget: QueueBudget } {
    const items = this.items(queueId);
    return {
      queue: items.map(item => ({
        id: item.id,
        ordinal: item.ordinal,
        projectPath: item.projectPath,
        goal: item.goal,
        ...(item.planText ? { planText: item.planText } : {}),
        ...(item.label ? { label: item.label } : {})
      })),
      records: items.map(recordOf),
      budget: this.get(queueId)?.budget ?? {}
    };
  }

  /** The engine's decision for this queue, right now. */
  decide(queueId: string, options: { runningStaleAfterMs?: number } = {}): QueueAction {
    const { queue, records, budget } = this.view(queueId);
    return nextAction({
      queue, records, budget,
      spentUsd: this.spentUsd(queueId),
      now: this.ports.clock.now(),
      ...(options.runningStaleAfterMs !== undefined ? { runningStaleAfterMs: options.runningStaleAfterMs } : {})
    });
  }

  progress(queueId: string) {
    const { queue, records } = this.view(queueId);
    return progress(queue, records);
  }

  /** Binds an item to the run that is doing it, and marks it RUNNING. */
  start(itemId: string, runId: string): RunQueueItemRecord {
    const item = this.requireItem(itemId);
    const now = this.ports.clock.now();
    // Refused here by the same matrix the engine enforces, rather than by a
    // constraint that would only say "unique".
    const next = transition(recordOf(item), "RUNNING", now, null);
    this.db
      .prepare("UPDATE autopilot_run_queue_items SET status=:status, started_at=:at, run_id=:runId WHERE id=:id")
      .run({ id: itemId, status: next.status, at: next.startedAt, runId });
    this.store.appendEvent(runId, {
      type: "RUN_QUEUE_ITEM_STARTED",
      payload: { queueId: item.queueId, itemId, ordinal: item.ordinal, projectPath: item.projectPath }
    });
    return this.requireItem(itemId);
  }

  /** Settles an item. `status` must be a settled status the matrix permits. */
  settle(itemId: string, status: QueueStatus, reason: string | null): RunQueueItemRecord {
    const item = this.requireItem(itemId);
    const now = this.ports.clock.now();
    const next = transition(recordOf(item), status, now, reason);
    this.db
      .prepare("UPDATE autopilot_run_queue_items SET status=:status, settled_at=:at, reason=:reason WHERE id=:id")
      .run({ id: itemId, status: next.status, at: next.settledAt, reason: next.reason });
    if (item.runId) {
      this.store.appendEvent(item.runId, {
        type: "RUN_QUEUE_ITEM_SETTLED",
        payload: { queueId: item.queueId, itemId, status: next.status, reason: next.reason }
      });
    }
    return this.requireItem(itemId);
  }

  close(queueId: string, reason: string): RunQueueRecord | null {
    if (!this.available()) return null;
    this.db
      .prepare("UPDATE autopilot_run_queues SET status='CLOSED', closed_at=:now, closed_reason=:reason WHERE id=:id AND status='ACTIVE'")
      .run({ id: queueId, now: this.ports.clock.now(), reason });
    return this.get(queueId);
  }

  /** What the operator reads in the morning. */
  summary(queueId: string, stopReason?: QueueStopReason | null): string {
    const { queue, records } = this.view(queueId);
    return renderQueueSummary(queue, recordsFor(queue, records), progress(queue, records), stopReason ?? null);
  }

  private requireItem(itemId: string): RunQueueItemRecord {
    const row = this.db.prepare("SELECT * FROM autopilot_run_queue_items WHERE id=:id").get<ItemRow>({ id: itemId });
    if (!row) throw new Error(`No such queue item: ${itemId}.`);
    return toItem(row);
  }
}
