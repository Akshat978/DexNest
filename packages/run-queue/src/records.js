// Records: what has happened to each item.
//
// A record is the durable history of one queue item. Items with no history are
// PENDING by definition, so a PENDING record is never stored — it is the
// absence of one. recordsFor pairs every item in a queue with exactly one
// record view, defaulting to PENDING, so a decision never has to guess.

/**
 * The exact set of statuses. Uppercase string literals, no more, no fewer.
 * @type {readonly ["PENDING","RUNNING","DONE","FAILED","SKIPPED","ABANDONED"]}
 */
export const STATUSES = Object.freeze([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "SKIPPED",
  "ABANDONED",
]);

/**
 * @typedef {"PENDING"|"RUNNING"|"DONE"|"FAILED"|"SKIPPED"|"ABANDONED"} Status
 */

/**
 * @typedef {Object} Record
 * @property {string} itemId
 * @property {Status} status
 * @property {string|null} startedAt   ISO string, or null before it started
 * @property {string|null} settledAt   ISO string, or null before it settled
 * @property {string|null} reason      human note, or null
 */

/**
 * Whether a value is one of the known statuses.
 * @param {unknown} status
 * @returns {boolean}
 */
export function isStatus(status) {
  return typeof status === "string" && STATUSES.includes(/** @type {Status} */ (status));
}

/**
 * The default, history-free record for an item: nothing has happened yet.
 * @param {string} itemId
 * @returns {Record}
 */
export function pendingRecord(itemId) {
  return makeRecord({ itemId, status: "PENDING" });
}

/**
 * Build a record from fields, filling the optional slots with null. Does not
 * mutate its argument.
 *
 * @param {{ itemId: string, status: Status, startedAt?: string|null,
 *           settledAt?: string|null, reason?: string|null }} fields
 * @returns {Record}
 */
export function makeRecord(fields) {
  if (fields === null || typeof fields !== "object") {
    throw new Error(
      `Record fields are not an object: ${describe(fields)}. Pass an object with itemId and status.`,
    );
  }
  if (typeof fields.itemId !== "string" || fields.itemId.trim() === "") {
    throw new Error(
      `Record has no itemId: ${describe(fields.itemId)}. Give every record the id of its item.`,
    );
  }
  if (!isStatus(fields.status)) {
    throw new Error(
      `Record has an unknown status: ${describe(fields.status)} (item "${fields.itemId}"). Use one of: ${STATUSES.join(", ")}.`,
    );
  }
  return {
    itemId: fields.itemId,
    status: fields.status,
    startedAt: fields.startedAt ?? null,
    settledAt: fields.settledAt ?? null,
    reason: fields.reason ?? null,
  };
}

/**
 * Pair every item in the queue with exactly one record view, defaulting to a
 * PENDING record for items nothing has happened to. The last record for an
 * item wins, so a caller appending history need not deduplicate first. The
 * result is a new array in queue order; inputs are not mutated.
 *
 * @param {ReadonlyArray<{ id: string }>} queue
 * @param {ReadonlyArray<Record>} records
 * @returns {Record[]}
 */
export function recordsFor(queue, records) {
  if (!Array.isArray(queue)) {
    throw new Error(
      `Queue is not an array: ${describe(queue)}. Pass a built queue.`,
    );
  }
  if (!Array.isArray(records)) {
    throw new Error(
      `Records is not an array: ${describe(records)}. Pass an array of records.`,
    );
  }

  const latestById = new Map();
  for (const record of records) {
    latestById.set(record.itemId, record);
  }

  return queue.map((item) => {
    const found = latestById.get(item.id);
    return found === undefined ? pendingRecord(item.id) : makeRecord(found);
  });
}

/**
 * The permitted transitions, as a map from current status to the set of
 * statuses it may move to. Everything not listed is refused. Adding a status
 * to STATUSES without adding it here leaves it unreachable on purpose — a new
 * status must be a deliberate decision, not an accident.
 * @type {Readonly<Record<Status, readonly Status[]>>}
 */
const ALLOWED = Object.freeze({
  PENDING: Object.freeze(["RUNNING", "SKIPPED"]),
  RUNNING: Object.freeze(["DONE", "FAILED", "ABANDONED"]),
  DONE: Object.freeze([]),
  FAILED: Object.freeze([]),
  SKIPPED: Object.freeze([]),
  ABANDONED: Object.freeze([]),
});

/**
 * Whether a record may move to the given status. A pure predicate; touches
 * nothing.
 * @param {Record} record
 * @param {Status} next
 * @returns {boolean}
 */
export function canTransition(record, next) {
  if (record === null || typeof record !== "object") return false;
  if (!isStatus(record.status) || !isStatus(next)) return false;
  return ALLOWED[record.status].includes(next);
}

/**
 * The statuses that are final: nothing follows them.
 * @param {Status} status
 * @returns {boolean}
 */
export function isSettled(status) {
  return isStatus(status) && ALLOWED[status].length === 0 && status !== "PENDING";
}

/**
 * Move a record to a new status at time `at`, returning a new record. Refuses
 * an illegal transition with a message naming both statuses. Sets startedAt
 * when a record begins RUNNING and settledAt when it reaches a final status;
 * carries the reason through. Does not mutate its argument.
 *
 * @param {Record} record
 * @param {Status} next
 * @param {string} at        ISO string, the moment of the transition
 * @param {string|null} [reason]
 * @returns {Record}
 */
export function transition(record, next, at, reason) {
  if (record === null || typeof record !== "object") {
    throw new Error(
      `Cannot transition a non-record: ${describe(record)}. Pass a record.`,
    );
  }
  if (!isStatus(record.status)) {
    throw new Error(
      `Record has an unknown status: ${describe(record.status)} (item "${record.itemId}"). Use one of: ${STATUSES.join(", ")}.`,
    );
  }
  if (!isStatus(next)) {
    throw new Error(
      `Cannot transition to an unknown status: ${describe(next)} (item "${record.itemId}"). Use one of: ${STATUSES.join(", ")}.`,
    );
  }
  if (typeof at !== "string" || at.trim() === "") {
    throw new Error(
      `Transition has no timestamp: ${describe(at)} (item "${record.itemId}"). Pass the ISO time as "at".`,
    );
  }
  if (!ALLOWED[record.status].includes(next)) {
    throw new Error(
      `Transition not allowed: ${record.status} to ${next} (item "${record.itemId}"). ${allowedHint(record.status)}`,
    );
  }

  const nextReason = reason ?? record.reason ?? null;
  return {
    itemId: record.itemId,
    status: next,
    startedAt: next === "RUNNING" ? at : record.startedAt ?? null,
    settledAt: isSettled(next) ? at : record.settledAt ?? null,
    reason: nextReason,
  };
}

/**
 * A hint about what a status may transition to, for a refusal message.
 * @param {Status} from
 * @returns {string}
 */
function allowedHint(from) {
  const targets = ALLOWED[from];
  if (targets.length === 0) {
    return `${from} is final and cannot change.`;
  }
  return `From ${from} you may only go to ${targets.join(" or ")}.`;
}

/**
 * Settle an item as SKIPPED, returning a new records array with the settlement
 * appended. History is preserved: nothing is removed or rewritten. The item's
 * current record is found by taking the latest record for its id (or a fresh
 * PENDING one), then transitioned — so only a PENDING item may be skipped, and
 * the refusal names both statuses.
 *
 * @param {ReadonlyArray<Record>} records
 * @param {string} itemId
 * @param {string} at        ISO string
 * @param {string|null} [reason]
 * @returns {Record[]}
 */
export function skip(records, itemId, at, reason) {
  if (!Array.isArray(records)) {
    throw new Error(
      `Records is not an array: ${describe(records)}. Pass an array of records.`,
    );
  }
  if (typeof itemId !== "string" || itemId.trim() === "") {
    throw new Error(
      `Cannot skip without an itemId: ${describe(itemId)}. Name the item to skip.`,
    );
  }

  let current = pendingRecord(itemId);
  for (const record of records) {
    if (record.itemId === itemId) current = makeRecord(record);
  }

  const skipped = transition(current, "SKIPPED", at, reason ?? null);
  return [...records, skipped];
}

/**
 * @typedef {Object} Progress
 * @property {number} total     items in the queue
 * @property {number} done      settled DONE
 * @property {number} failed    settled FAILED
 * @property {number} skipped   settled SKIPPED
 * @property {number} remaining not yet started (PENDING)
 * @property {number} inFlight  currently RUNNING
 */

/**
 * Count what has happened to a queue, derived from the records every time. No
 * counter is stored anywhere, so nothing can drift out of step with the
 * records that are the source of truth. The record view is total (Phase 3), so
 * every item lands in exactly one bucket by its current status.
 *
 * @param {ReadonlyArray<{ id: string }>} queue
 * @param {ReadonlyArray<Record>} records
 * @returns {Progress}
 */
export function progress(queue, records) {
  const view = recordsFor(queue, records);
  /** @type {Progress} */
  const counts = {
    total: view.length,
    done: 0,
    failed: 0,
    skipped: 0,
    remaining: 0,
    inFlight: 0,
  };
  for (const record of view) {
    switch (record.status) {
      case "DONE":
        counts.done += 1;
        break;
      case "FAILED":
        counts.failed += 1;
        break;
      case "SKIPPED":
        counts.skipped += 1;
        break;
      case "PENDING":
        counts.remaining += 1;
        break;
      case "RUNNING":
        counts.inFlight += 1;
        break;
      // ABANDONED is settled but is not one of the reported buckets; it is
      // still counted in total via view.length.
    }
  }
  return counts;
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
