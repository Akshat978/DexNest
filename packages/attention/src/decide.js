// Phase 10: deciding, all together. One pure function composes every earlier
// phase into the single entry point a caller needs. It groups the night's items
// (Phase 4/5), then for each group asks the two independent holds — cooldown
// with its escalation pierce (Phase 6/7) and quiet hours with its urgency pierce
// (Phase 8/9) — and reports what goes out now, what waits, and why each waiting
// thing waits.
//
// The one rule that outranks the rest lives here in the open: a quiet system is
// never a silent one. `decide` holds nothing without naming it. Every held group
// appears in `hold` AND carries an entry in `reason`; nothing is dropped, and a
// caller can always show a person why a night was quiet. The tests prove it from
// both sides — what is held, and what pierces the holds to get through anyway.

import { makeItem } from "./item.js";
import { groupItems, digestGroup } from "./grouping.js";
import { holdWithEscalation } from "./cooldown.js";
import { holdWithUrgency } from "./quiet.js";

/**
 * The cooldown window, in minutes, used when the caller does not pass one. A
 * group delivered within this many minutes is held unless an escalation pierces
 * it. Override per call with `state.cooldownMinutes`.
 */
export const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * @typedef {Object} DecisionState
 * @property {Array} items  The night's items (raw or already-made); each is
 *   normalised through `makeItem`, so the caller may pass either.
 * @property {import("./cooldown.js").DeliveryRecord[]} [delivered]  Known
 *   deliveries, for cooldown. Defaults to none.
 * @property {import("./quiet.js").QuietHours} quietHours  The quiet-hours window.
 * @property {string} now  ISO timestamp carrying its local offset.
 * @property {number} [cooldownMinutes]  Cooldown window; defaults to
 *   DEFAULT_COOLDOWN_MINUTES.
 */

/**
 * @typedef {Object} HeldReason
 * @property {string} groupKey
 * @property {"cooling_down"|"quiet_hours"|"cooling_down+quiet_hours"} reason
 *   Why this group waits. Both holds are reported when both apply, so the reason
 *   never understates what is keeping a group back.
 * @property {?string} coolsDownAt  When the cooldown window ends (ISO), if that
 *   is one of the reasons; otherwise null.
 * @property {?string} quietEndsAt  When quiet hours release the group ("HH:MM"),
 *   if that is one of the reasons; otherwise null.
 */

/**
 * @typedef {Object} Decision
 * @property {import("./grouping.js").GroupDigest[]} deliver  Digests to send now,
 *   in the input's group order.
 * @property {import("./grouping.js").GroupDigest[]} hold  Digests that wait, in
 *   the input's group order.
 * @property {HeldReason[]} reason  One entry per held group, aligned with `hold`,
 *   naming why it waits and when the hold lifts. Never shorter than `hold`: a
 *   held group without a stated reason would be a silent system, which this
 *   function forbids.
 */

/**
 * Decide a whole night at once. Pure: reads no clock, file or network — `now`
 * is passed in. The inputs are not mutated.
 *
 * @param {DecisionState} state
 * @returns {Decision}
 */
export function decide(state) {
  const {
    items,
    delivered,
    quietHours,
    now,
    cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
  } = state || {};

  const made = (Array.isArray(items) ? items : []).map((i) => makeItem(i));
  const groups = groupItems(made);
  const deliveries = Array.isArray(delivered) ? delivered : [];

  const deliver = [];
  const hold = [];
  const reason = [];

  for (const group of groups) {
    // A group speaks with its loudest member's priority, so an escalation among
    // routine items pierces the holds on the whole group — the outstanding thing
    // is never trapped behind a "we just told you" or "it's late" rule.
    const asItem = {
      id: group.groupKey,
      groupKey: group.groupKey,
      priority: group.priority,
    };

    const cool = holdWithEscalation(asItem, deliveries, cooldownMinutes, now);
    const quiet = holdWithUrgency(asItem, quietHours, now);

    const digest = digestGroup(group);

    if (cool.held || quiet.held) {
      hold.push(digest);
      reason.push(heldReason(group.groupKey, cool, quiet));
    } else {
      deliver.push(digest);
    }
  }

  return Object.freeze({
    deliver: Object.freeze(deliver),
    hold: Object.freeze(hold),
    reason: Object.freeze(reason),
  });
}

/**
 * @param {string} groupKey
 * @param {import("./cooldown.js").DeliveryDecision} cool
 * @param {import("./quiet.js").QuietDeliveryDecision} quiet
 * @returns {HeldReason}
 */
function heldReason(groupKey, cool, quiet) {
  const parts = [];
  if (cool.held) parts.push("cooling_down");
  if (quiet.held) parts.push("quiet_hours");
  return Object.freeze({
    groupKey,
    reason: /** @type {any} */ (parts.join("+")),
    coolsDownAt: cool.held ? cool.coolsDownAt : null,
    quietEndsAt: quiet.held ? quiet.endsAt : null,
  });
}
