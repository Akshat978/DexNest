// Types for the run-queue engine.
//
// The engine is plain JavaScript on purpose — it must run under `node --test`
// with an empty node_modules, and a build step would have meant a dependency.
// But its consumers are TypeScript, and an untyped import would spread `any`
// through the host exactly the way the qrcode import already does.
//
// So the types are declared here by hand, against the JSDoc in src/*.js. They
// are a contract, not a generated artifact: if the two ever disagree, this
// file is the one the host compiled against, and the disagreement is a bug.

export declare const PACKAGE_NAME: "dexnest-run-queue";
export declare const MAX_GOAL_LENGTH: number;

export type QueueStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED" | "ABANDONED";
export declare const STATUSES: readonly QueueStatus[];

/** One project the queue should work through. Ordinals are assigned by the engine. */
export interface QueueItem {
  id: string;
  ordinal: number;
  projectPath: string;
  goal: string;
  planText?: string;
  label?: string;
}

/** What has happened to one item. Absent means PENDING. */
export interface QueueRecord {
  itemId: string;
  status: QueueStatus;
  startedAt: string | null;
  settledAt: string | null;
  reason: string | null;
}

export interface QueueBudget {
  /** ISO instant. The queue stops at or after this, but never mid-item. */
  deadline?: string;
  /** Spend across the WHOLE queue, not per item. */
  maxCostUsd?: number;
  /** Stop after this many items have been started, however many remain. */
  maxItems?: number;
  /** Stop after this many items fail in a row with none succeeding between. */
  maxConsecutiveFailures?: number;
}

export interface QueueProgress {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  remaining: number;
  inFlight: number;
}

export interface DecisionState {
  queue: readonly QueueItem[];
  records: readonly QueueRecord[];
  budget?: QueueBudget;
  spentUsd?: number;
  /** ISO instant. The engine never reads the clock itself. */
  now: string;
  /** How long a RUNNING record may sit with no result before it looks abandoned. */
  runningStaleAfterMs?: number;
}

export type QueueStopReason = "queue_complete" | "deadline" | "cost" | "max_items" | "failing";

export type QueueAction =
  | { kind: "start"; itemId: string }
  | { kind: "busy"; itemId: string }
  | { kind: "reconcile"; itemId: string; detail: string }
  | { kind: "stop"; reason: QueueStopReason; detail: string };

export interface Schedule {
  kind: "nightly" | "weekdays" | "weekends" | "days";
  /** Local weekdays it may fire on, 0=Sunday..6=Saturday. */
  days: number[];
  hour: number;
  minute: number;
}

export declare function buildQueue(
  items: ReadonlyArray<Omit<QueueItem, "ordinal"> & { ordinal?: number }>
): QueueItem[];
export declare function reorder(queue: readonly QueueItem[], itemIds: readonly string[]): QueueItem[];

export declare function isStatus(status: unknown): status is QueueStatus;
export declare function pendingRecord(itemId: string): QueueRecord;
export declare function makeRecord(fields: Partial<QueueRecord> & { itemId: string }): QueueRecord;
export declare function recordsFor(
  queue: readonly QueueItem[],
  records: readonly QueueRecord[]
): QueueRecord[];
export declare function canTransition(record: QueueRecord, next: QueueStatus): boolean;
export declare function transition(
  record: QueueRecord,
  next: QueueStatus,
  at: string,
  reason?: string | null
): QueueRecord;
export declare function isSettled(status: QueueStatus): boolean;
export declare function skip(
  records: readonly QueueRecord[],
  itemId: string,
  at: string,
  reason?: string | null
): QueueRecord[];
export declare function progress(
  queue: readonly QueueItem[],
  records: readonly QueueRecord[]
): QueueProgress;

/** The single next decision, derived purely from state plus the current time. */
export declare function nextAction(state: DecisionState): QueueAction;

export declare function parseSchedule(text: string): Schedule;
export declare function nextFire(schedule: Schedule, now: string): string;

export declare function renderQueueSummary(
  queue: readonly QueueItem[],
  records: readonly QueueRecord[],
  progress: QueueProgress,
  stopReason?: QueueStopReason | null
): string;
