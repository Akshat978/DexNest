// Deciding what to start next.
//
// nextAction is the heart of the engine: given the durable state plus the
// current time, it returns the single next decision. It performs no action and
// keeps no memory — a restarted process re-derives the same answer from the
// same state. Later phases add the stop, busy and budget rules; this phase
// establishes the "start" decision.

import { recordsFor, isSettled } from "./records.js";

/**
 * @typedef {Object} Budget
 * @property {string} [deadline]     ISO, added in Phase 9
 * @property {number} [maxCostUsd]   added in Phase 10
 * @property {number} [maxItems]     added in Phase 12
 * @property {number} [maxConsecutiveFailures] added in Phase 14
 */

/**
 * @typedef {Object} DecisionState
 * @property {ReadonlyArray<{ id: string, ordinal: number }>} queue
 * @property {ReadonlyArray<import("./records.js").Record>} records
 * @property {Budget} [budget]
 * @property {number} [spentUsd]
 * @property {string} now  ISO string
 */

/**
 * @typedef {{ kind: "start", itemId: string }
 *   | { kind: "busy", itemId: string }
 *   | { kind: "stop", reason: string, detail: string }} Action
 */

/**
 * Decide the next action from durable state and the current time.
 *
 * Order of decision:
 *   - If every item has settled, stop with `queue_complete`.
 *   - If an item is in flight (RUNNING), the answer is `busy` — never a second
 *     start (Phase 8 pins this invariant down).
 *   - Otherwise start the lowest-ordinal PENDING item.
 *
 * Performs no action and keeps no memory; does not mutate its argument.
 *
 * @param {DecisionState} state
 * @returns {Action}
 */
export function nextAction(state) {
  if (state === null || typeof state !== "object") {
    throw new Error(
      `Decision state is not an object: ${describe(state)}. Pass { queue, records, budget, spentUsd, now }.`,
    );
  }
  const { queue, records } = state;
  if (!Array.isArray(queue)) {
    throw new Error(
      `Decision state has no queue: ${describe(queue)}. Pass a built queue as state.queue.`,
    );
  }

  const view = recordsFor(queue, records ?? []);

  const running = view.find((record) => record.status === "RUNNING");
  const anyUnsettled = view.some((record) => !isSettled(record.status));

  if (!anyUnsettled) {
    return {
      kind: "stop",
      reason: "queue_complete",
      detail: completeDetail(view),
    };
  }

  // No bound may interrupt work in flight: while an item is RUNNING the answer
  // is busy, even past the deadline. But a process that crashed mid-item
  // leaves a RUNNING record that will never settle on its own; when the caller
  // says such a record is stale, surface it as `reconcile` so a human (or the
  // caller) decides — never a silent restart and never a silent skip.
  if (running !== undefined) {
    if (isStaleRunning(running, state.runningStaleAfterMs, state.now)) {
      return {
        kind: "reconcile",
        itemId: running.itemId,
        detail: `Item "${running.itemId}" has been RUNNING since ${running.startedAt} with no result by ${state.now}; it looks abandoned. Decide whether to mark it failed, abandoned, or retried before the queue continues.`,
      };
    }
    return { kind: "busy", itemId: running.itemId };
  }

  const budget = state.budget ?? {};

  if (isPastDeadline(budget.deadline, state.now)) {
    return {
      kind: "stop",
      reason: "deadline",
      detail: `The deadline ${budget.deadline} has passed (now ${state.now}); stopping between items.`,
    };
  }

  // One spend budget across the whole night: the cap spans the queue, so the
  // projects share a single budget rather than each getting its own.
  if (isOverCostCap(budget.maxCostUsd, state.spentUsd)) {
    const spent = state.spentUsd ?? 0;
    return {
      kind: "stop",
      reason: "cost",
      detail: `Spend has reached the budget: $${spent} of $${budget.maxCostUsd}. Stopping before starting another project.`,
    };
  }

  // A ceiling on how many projects one night touches. Counts items that have
  // ever been started — RUNNING, DONE, FAILED or ABANDONED — so a failure
  // still counts against the operator's "touch at most N projects" limit. A
  // SKIPPED item was never started and does not count.
  if (isOverItemCap(budget.maxItems, view)) {
    const started = countStarted(view);
    return {
      kind: "stop",
      reason: "max_items",
      detail: `Reached the project limit for the night: ${started} of at most ${budget.maxItems} started. Stopping before touching another.`,
    };
  }

  // Unless everything is failing: stop when too many items have failed in a
  // row with nothing succeeding between them. The streak is derived from the
  // records in settle order, never a stored counter.
  const streak = consecutiveFailures(view);
  if (isOverFailureLimit(budget.maxConsecutiveFailures, streak)) {
    return {
      kind: "stop",
      reason: "failing",
      detail: `${streak} projects failed in a row with none succeeding. Stopping rather than working through a queue that is only failing.`,
    };
  }

  const startable = pickLowestPending(queue, view);
  return { kind: "start", itemId: startable.id };
}

/**
 * The number of FAILED items at the tail of settle order, with no DONE after
 * them. Counted from the records, sorted by settledAt; any DONE resets the
 * streak, and SKIPPED/ABANDONED neither count nor reset. A pure derivation.
 * @param {ReadonlyArray<import("./records.js").Record>} view
 * @returns {number}
 */
function consecutiveFailures(view) {
  const settled = view
    .filter((record) => record.settledAt !== null && record.settledAt !== undefined)
    .slice()
    .sort((a, b) => Date.parse(a.settledAt) - Date.parse(b.settledAt));
  let streak = 0;
  for (const record of settled) {
    if (record.status === "FAILED") streak += 1;
    else if (record.status === "DONE") streak = 0;
    // SKIPPED and ABANDONED leave the streak unchanged.
  }
  return streak;
}

/**
 * Whether the failure streak has reached the limit. A missing limit never
 * triggers.
 * @param {number|undefined} maxConsecutiveFailures
 * @param {number} streak
 * @returns {boolean}
 */
function isOverFailureLimit(maxConsecutiveFailures, streak) {
  if (maxConsecutiveFailures === undefined || maxConsecutiveFailures === null) {
    return false;
  }
  if (typeof maxConsecutiveFailures !== "number" || Number.isNaN(maxConsecutiveFailures)) {
    throw new Error(
      `Budget maxConsecutiveFailures is not a number: ${describe(maxConsecutiveFailures)}. Use a whole count like 3.`,
    );
  }
  return streak >= maxConsecutiveFailures;
}

/**
 * The statuses that mean an item was actually started (left PENDING to run).
 * SKIPPED is excluded: a skipped item was never touched.
 * @type {ReadonlyArray<string>}
 */
const STARTED_STATUSES = ["RUNNING", "DONE", "FAILED", "ABANDONED"];

/**
 * How many items have ever been started.
 * @param {ReadonlyArray<import("./records.js").Record>} view
 * @returns {number}
 */
function countStarted(view) {
  return view.filter((record) => STARTED_STATUSES.includes(record.status)).length;
}

/**
 * Whether the number of started items has reached the cap. A missing cap never
 * triggers.
 * @param {number|undefined} maxItems
 * @param {ReadonlyArray<import("./records.js").Record>} view
 * @returns {boolean}
 */
function isOverItemCap(maxItems, view) {
  if (maxItems === undefined || maxItems === null) return false;
  if (typeof maxItems !== "number" || Number.isNaN(maxItems)) {
    throw new Error(
      `Budget maxItems is not a number: ${describe(maxItems)}. Use a whole count like 3.`,
    );
  }
  return countStarted(view) >= maxItems;
}

/**
 * Whether `now` is at or past the deadline. Both are ISO instants, compared
 * without reading the clock. A missing deadline never triggers.
 * @param {string|undefined} deadline
 * @param {string} now
 * @returns {boolean}
 */
function isPastDeadline(deadline, now) {
  if (deadline === undefined || deadline === null) return false;
  const deadlineMs = Date.parse(deadline);
  const nowMs = Date.parse(now);
  if (Number.isNaN(deadlineMs)) {
    throw new Error(
      `Budget deadline is not a valid ISO time: ${describe(deadline)}. Use an ISO instant like 2026-09-07T07:00:00.000Z.`,
    );
  }
  if (Number.isNaN(nowMs)) {
    throw new Error(
      `Decision time "now" is not a valid ISO time: ${describe(now)}. Use an ISO instant like 2026-09-07T02:00:00.000Z.`,
    );
  }
  return nowMs >= deadlineMs;
}

/**
 * Whether a RUNNING record has gone stale — started longer ago than the
 * caller's threshold. The caller owns the definition of "abandoned"; a missing
 * threshold means never stale (the engine only reports when asked). Times are
 * ISO instants compared without reading the clock.
 *
 * @param {import("./records.js").Record} running
 * @param {number|undefined} staleAfterMs
 * @param {string} now
 * @returns {boolean}
 */
function isStaleRunning(running, staleAfterMs, now) {
  if (staleAfterMs === undefined || staleAfterMs === null) return false;
  if (typeof staleAfterMs !== "number" || Number.isNaN(staleAfterMs) || staleAfterMs < 0) {
    throw new Error(
      `runningStaleAfterMs is not a non-negative number: ${describe(staleAfterMs)}. Use a duration in milliseconds like 3600000.`,
    );
  }
  if (running.startedAt === null || running.startedAt === undefined) {
    // A RUNNING record with no startedAt cannot be aged; treat it as stale so
    // it is never silently left in flight forever.
    return true;
  }
  const startedMs = Date.parse(running.startedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(startedMs)) {
    throw new Error(
      `Record startedAt is not a valid ISO time: ${describe(running.startedAt)} (item "${running.itemId}"). Store an ISO instant when starting an item.`,
    );
  }
  if (Number.isNaN(nowMs)) {
    throw new Error(
      `Decision time "now" is not a valid ISO time: ${describe(now)}. Use an ISO instant like 2026-09-07T02:00:00.000Z.`,
    );
  }
  return nowMs - startedMs >= staleAfterMs;
}

/**
 * Whether the total spend so far has reached the cap. A missing cap never
 * triggers; a missing spend counts as zero.
 * @param {number|undefined} maxCostUsd
 * @param {number|undefined} spentUsd
 * @returns {boolean}
 */
function isOverCostCap(maxCostUsd, spentUsd) {
  if (maxCostUsd === undefined || maxCostUsd === null) return false;
  if (typeof maxCostUsd !== "number" || Number.isNaN(maxCostUsd)) {
    throw new Error(
      `Budget maxCostUsd is not a number: ${describe(maxCostUsd)}. Use a dollar amount like 5.00.`,
    );
  }
  const spent = spentUsd ?? 0;
  if (typeof spent !== "number" || Number.isNaN(spent)) {
    throw new Error(
      `spentUsd is not a number: ${describe(spentUsd)}. Pass the total spent so far as a number.`,
    );
  }
  return spent >= maxCostUsd;
}

/**
 * A human sentence describing a finished queue.
 * @param {ReadonlyArray<import("./records.js").Record>} view
 * @returns {string}
 */
function completeDetail(view) {
  const total = view.length;
  if (total === 0) return "The queue is empty; there was nothing to do.";
  const done = view.filter((r) => r.status === "DONE").length;
  const projects = total === 1 ? "project" : "projects";
  return `All ${total} ${projects} have settled; ${done} finished successfully. Nothing is left to start.`;
}

/**
 * The lowest-ordinal PENDING item, taken in queue order.
 * @param {ReadonlyArray<{ id: string, ordinal: number }>} queue
 * @param {ReadonlyArray<import("./records.js").Record>} view
 * @returns {{ id: string, ordinal: number }}
 */
function pickLowestPending(queue, view) {
  const statusById = new Map(view.map((record) => [record.itemId, record.status]));
  const ordered = [...queue].sort((a, b) => a.ordinal - b.ordinal);
  for (const item of ordered) {
    if (statusById.get(item.id) === "PENDING") return item;
  }
  // No PENDING item to start. Phase 7 replaces this with a stop decision.
  return ordered[0];
}

/**
 * A short, safe description of an arbitrary value for an error message.
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  return typeof value;
}
