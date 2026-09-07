// Phase 6: cooldown. A group that was just delivered should not be delivered
// again a moment later; the reader has already been told. A delivery record
// says what was delivered, for which group, and when. If the same group was
// delivered within its cooldown window, a fresh item about that group is held.
//
// This phase only ever holds. The matching exemption — an escalation piercing
// the cooldown so a blocked run is never lost to a "we just told you about this
// group" rule — is Phase 7. Here we prove the hold, including the case where the
// only previous delivery was of a lower priority: cooldown does not yet care
// about priority, so that item is held exactly like any other. Phase 7 is what
// makes that safe.

/**
 * @typedef {Object} DeliveryRecord
 * @property {string} groupKey  Which group was delivered.
 * @property {"INFO"|"ATTENTION"|"ACTION_REQUIRED"|"URGENT"} priority
 *   The priority at which it was delivered.
 * @property {string} at        ISO timestamp of the delivery.
 */

/**
 * @typedef {Object} CooldownDecision
 * @property {boolean} held      True when the group is inside its cooldown window.
 * @property {"cooling_down"|"expired"|"never_sent"} reason
 *   Why the item is or is not held: still cooling down, the window has expired,
 *   or the group was never delivered.
 * @property {?DeliveryRecord} lastDelivery  The most recent delivery for this
 *   group, or null when there is none.
 * @property {?string} coolsDownAt  When the window ends (ISO), or null when the
 *   group was never delivered.
 */

/**
 * Find the most recent delivery for a group. The input is not mutated.
 *
 * @param {string} groupKey
 * @param {DeliveryRecord[]} deliveries
 * @returns {?DeliveryRecord}
 */
export function lastDeliveryFor(groupKey, deliveries) {
  const records = Array.isArray(deliveries) ? deliveries : [];
  let latest = null;
  for (const record of records) {
    if (!record || record.groupKey !== groupKey) continue;
    if (latest === null || record.at > latest.at) latest = record;
  }
  return latest;
}

/**
 * Decide whether an item is held because its group is cooling down.
 *
 * @param {import("./item.js").AttentionItem} item  The item under consideration.
 * @param {DeliveryRecord[]} deliveries  Every known delivery record.
 * @param {number} cooldownMinutes  The window, in minutes, after a delivery
 *   during which the same group is held.
 * @param {string} now  ISO timestamp of the current moment.
 * @returns {CooldownDecision}
 */
export function holdForCooldown(item, deliveries, cooldownMinutes, now) {
  if (!item || !item.groupKey) {
    throw new Error(
      `Cannot apply cooldown to an item with no group: item ${quote(
        item && item.id
      )}. Every item carries a groupKey for cooldown to key on.`
    );
  }
  const minutes = Number(cooldownMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(
      `Cooldown window is not a duration in minutes: got ${quote(
        cooldownMinutes
      )}. Pass the window as a non-negative number of minutes.`
    );
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new Error(
      `Cooldown needs a valid current time: got ${quote(now)}. ` +
        `Pass "now" as an ISO timestamp.`
    );
  }

  const last = lastDeliveryFor(item.groupKey, deliveries);
  if (last === null) {
    return Object.freeze({
      held: false,
      reason: "never_sent",
      lastDelivery: null,
      coolsDownAt: null,
    });
  }

  const deliveredMs = Date.parse(last.at);
  if (Number.isNaN(deliveredMs)) {
    throw new Error(
      `Delivery record has an invalid timestamp: group ${quote(
        item.groupKey
      )} at ${quote(last.at)}. Delivery times are ISO timestamps.`
    );
  }

  const endMs = deliveredMs + minutes * 60_000;
  const coolsDownAt = new Date(endMs).toISOString();
  const held = nowMs < endMs;

  return Object.freeze({
    held,
    reason: held ? "cooling_down" : "expired",
    lastDelivery: last,
    coolsDownAt,
  });
}

// Phase 7: escalation pierces cooldown. Cooldown (Phase 6) is deliberately
// priority-blind — it holds a group for a while after any delivery. That is
// safe only because an item DexNest cannot proceed without, or one that is
// time-sensitive, must still get through. An ACTION_REQUIRED or URGENT item is
// delivered even when its group is cooling down, and even when an
// identical-looking INFO was just sent.
//
// The pierce is a read, not a write: it never adds a delivery record and never
// touches the window. So the routine INFO/ATTENTION items in the same group go
// on being held exactly as before — escalation does not reset their cooldown.
// That is the whole point, and the tests prove it.

/** The priorities that pierce a cooldown. */
export const PIERCING_PRIORITIES = Object.freeze(["ACTION_REQUIRED", "URGENT"]);

/**
 * Does this priority pierce a cooldown?
 * @param {string} priority
 * @returns {boolean}
 */
export function escalates(priority) {
  return PIERCING_PRIORITIES.includes(priority);
}

/**
 * @typedef {CooldownDecision & {pierced: boolean}} DeliveryDecision
 *   A cooldown decision, plus whether escalation pierced a hold. When
 *   `pierced` is true, `held` is false and `reason` is "escalated"; the
 *   `lastDelivery` and `coolsDownAt` still describe the window that was pierced,
 *   because escalation reads the window but never resets it.
 */

/**
 * Decide whether an item is delivered, holding routine items during their
 * group's cooldown but letting an escalation (ACTION_REQUIRED or URGENT) pierce
 * it. This never mutates the deliveries and never records a delivery of its own,
 * so a pierce leaves the cooldown of every routine item in the group untouched.
 *
 * @param {import("./item.js").AttentionItem} item
 * @param {DeliveryRecord[]} deliveries
 * @param {number} cooldownMinutes
 * @param {string} now
 * @returns {DeliveryDecision}
 */
export function holdWithEscalation(item, deliveries, cooldownMinutes, now) {
  const base = holdForCooldown(item, deliveries, cooldownMinutes, now);
  if (base.held && escalates(item.priority)) {
    return Object.freeze({
      held: false,
      reason: "escalated",
      lastDelivery: base.lastDelivery,
      coolsDownAt: base.coolsDownAt,
      pierced: true,
    });
  }
  return Object.freeze({ ...base, pierced: false });
}

/** @param {unknown} value */
function quote(value) {
  return `"${value == null ? "" : value}"`;
}
