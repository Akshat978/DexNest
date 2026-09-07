// Phase 8: quiet hours. A window on the local clock during which routine items
// — INFO and ATTENTION — are held for the next digest rather than delivered.
// The window is LOCAL wall-clock: "23:00 to 08:00" means those hours as read on
// a clock on the wall, on every date. It is not a fixed number of hours after a
// fixed instant.
//
// That distinction is the whole point of this phase. When the clocks change for
// daylight saving, the instant that "23:00 local" refers to shifts by an hour,
// but the window does not: 23:00 is still 23:00. We get this for free by reading
// the wall-clock time straight out of the ISO string's own local representation
// (the literal HH:MM it carries) rather than converting it to UTC and counting.
// A `now` of "2026-11-01T23:30:00-04:00" and one of "2026-11-02T23:30:00-05:00"
// straddle a DST change and carry different offsets, yet both read 23:30 on the
// clock, so both fall inside a 23:00–08:00 window.
//
// This phase only ever holds, and it only holds the two routine priorities. An
// ACTION_REQUIRED item that cannot proceed, and an URGENT one that is
// time-sensitive, are not held here — the matching exemption, and the recorded
// decision about ACTION_REQUIRED, is Phase 9. Here we prove the hold for INFO
// and ATTENTION, and prove that URGENT and ACTION_REQUIRED still get through.

/** The priorities a quiet-hours window may hold. The others get through. */
export const QUIET_HELD_PRIORITIES = Object.freeze(["INFO", "ATTENTION"]);

/**
 * @typedef {Object} QuietHours
 * @property {string} start  Local wall-clock start, "HH:MM".
 * @property {string} end    Local wall-clock end, "HH:MM". Exclusive: an item
 *   at exactly the end of the window is already through.
 */

/**
 * @typedef {Object} QuietDecision
 * @property {boolean} held  True when the window holds this item.
 * @property {"quiet_hours"|"outside_quiet_hours"|"not_a_held_priority"} reason
 *   Why the item is or is not held: inside the window and a routine priority;
 *   outside the window; or a priority the window never holds.
 * @property {QuietHours} window  The window that was applied.
 * @property {string} endsAt  The window's local end, "HH:MM" — when the hold is
 *   released and the item is re-offered for the digest.
 */

/**
 * Is a moment inside a local wall-clock quiet-hours window? Reads the wall-clock
 * time from `now` as written (its literal HH:MM), so a change of UTC offset — a
 * daylight-saving boundary — does not move the window. The start is inclusive
 * and the end is exclusive, matching the cooldown boundary convention.
 *
 * @param {string} now  ISO timestamp carrying its local offset.
 * @param {QuietHours} quietHours
 * @returns {boolean}
 */
export function inQuietHours(now, quietHours) {
  const window = validateWindow(quietHours);
  const nowMinutes = wallClockMinutes(now);
  const start = clockMinutes(window.start);
  const end = clockMinutes(window.end);

  if (start === end) return false; // An empty window holds nothing.
  if (start < end) {
    // A window within a single day, e.g. 01:00–06:00.
    return nowMinutes >= start && nowMinutes < end;
  }
  // A window that wraps past midnight, e.g. 23:00–08:00.
  return nowMinutes >= start || nowMinutes < end;
}

/**
 * Decide whether an item is held by a quiet-hours window. Only INFO and
 * ATTENTION are held; an ACTION_REQUIRED or URGENT item is never held here, so
 * it goes through even at 3am (Phase 9 records that line deliberately). The
 * inputs are not mutated.
 *
 * @param {import("./item.js").AttentionItem} item
 * @param {QuietHours} quietHours
 * @param {string} now  ISO timestamp carrying its local offset.
 * @returns {QuietDecision}
 */
export function holdForQuietHours(item, quietHours, now) {
  if (!item || !item.priority) {
    throw new Error(
      `Cannot apply quiet hours to an item with no priority: item ${quote(
        item && item.id
      )}. Every item carries a priority for quiet hours to weigh.`
    );
  }
  const window = validateWindow(quietHours);

  if (!QUIET_HELD_PRIORITIES.includes(item.priority)) {
    return Object.freeze({
      held: false,
      reason: "not_a_held_priority",
      window,
      endsAt: window.end,
    });
  }

  const held = inQuietHours(now, window);
  return Object.freeze({
    held,
    reason: held ? "quiet_hours" : "outside_quiet_hours",
    window,
    endsAt: window.end,
  });
}

// Phase 9: urgent pierces quiet hours. The matching exemption to Phase 8. A
// window that holds routine items is only safe because a time-sensitive URGENT,
// and a run blocked on an answer, are let through even at 3am. This is the same
// shape as escalation piercing cooldown (Phase 7): a read, never a write. The
// window itself is untouched, so an INFO or ATTENTION held in the same night
// goes on being held.
//
// The ACTION_REQUIRED decision lives here, in one place, and nowhere else. It is
// the line the plan names: "it woke me for nothing" against "it sat blocked all
// night". We choose to WAKE for ACTION_REQUIRED — a run that "cannot continue
// without an answer" (CONVENTIONS) sitting silent until morning is the worse
// failure, and it matches how ACTION_REQUIRED already pierces cooldown in
// Phase 7. To reverse that decision, remove "ACTION_REQUIRED" from the single
// list below; the tests assert the choice from both sides so the flip is
// deliberate and visible.

/** The priorities that pierce a quiet-hours window. The one recorded place. */
export const QUIET_PIERCING_PRIORITIES = Object.freeze([
  "ACTION_REQUIRED",
  "URGENT",
]);

/**
 * Does this priority pierce a quiet-hours window? The inverse of being held:
 * every priority either pierces or may be held, never both and never neither.
 * @param {string} priority
 * @returns {boolean}
 */
export function piercesQuietHours(priority) {
  return QUIET_PIERCING_PRIORITIES.includes(priority);
}

/**
 * @typedef {QuietDecision & {pierced: boolean}} QuietDeliveryDecision
 *   A quiet-hours decision, plus whether urgency pierced the window. When
 *   `pierced` is true, `held` is false and `reason` is "pierced_quiet_hours".
 *   The `window` and `endsAt` still describe the window that was pierced.
 */

/**
 * Decide whether an item is held by quiet hours, letting an URGENT or
 * ACTION_REQUIRED item pierce the window even in the small hours. Never mutates
 * its inputs and never alters the window, so routine items held the same night
 * stay held. This is the entry point Phase 10's `decide` composes; it and
 * `holdForQuietHours` agree, since the base already declines to hold a piercing
 * priority — here we say so explicitly and flag it as a pierce.
 *
 * @param {import("./item.js").AttentionItem} item
 * @param {QuietHours} quietHours
 * @param {string} now  ISO timestamp carrying its local offset.
 * @returns {QuietDeliveryDecision}
 */
export function holdWithUrgency(item, quietHours, now) {
  const base = holdForQuietHours(item, quietHours, now);
  if (piercesQuietHours(item && item.priority)) {
    return Object.freeze({
      held: false,
      reason: "pierced_quiet_hours",
      window: base.window,
      endsAt: base.endsAt,
      pierced: true,
    });
  }
  return Object.freeze({ ...base, pierced: false });
}

/**
 * Read the local wall-clock minutes-of-day from an ISO timestamp, taken from
 * the literal HH:MM it carries rather than from a UTC conversion. This is what
 * keeps the window fixed across a daylight-saving change.
 *
 * @param {string} now
 * @returns {number} minutes since local midnight, 0..1439
 */
function wallClockMinutes(now) {
  if (Number.isNaN(Date.parse(now))) {
    throw new Error(
      `Quiet hours needs a valid current time: got ${quote(now)}. ` +
        `Pass "now" as an ISO timestamp carrying its local offset.`
    );
  }
  const match = /T(\d{2}):(\d{2})/.exec(String(now));
  if (!match) {
    throw new Error(
      `Quiet hours cannot read a wall-clock time from now: got ${quote(now)}. ` +
        `Pass "now" as an ISO timestamp with a time part, e.g. "2026-09-07T23:30:00-04:00".`
    );
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Validate a "HH:MM" window bound and return it as minutes-of-day.
 * @param {string} value
 * @returns {number}
 */
function clockMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value));
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  if (!match || hours > 23 || minutes > 59) {
    throw new Error(
      `Quiet-hours bound is not a wall-clock time: got ${quote(value)}. ` +
        `Give it as "HH:MM" on a 24-hour clock, e.g. "23:00".`
    );
  }
  return hours * 60 + minutes;
}

/**
 * @param {unknown} quietHours
 * @returns {QuietHours} a frozen, validated window.
 */
function validateWindow(quietHours) {
  if (!quietHours || quietHours.start == null || quietHours.end == null) {
    throw new Error(
      `Quiet hours needs a start and an end: got ${quote(
        quietHours && JSON.stringify(quietHours)
      )}. Pass { start, end } as "HH:MM" local wall-clock times.`
    );
  }
  clockMinutes(quietHours.start);
  clockMinutes(quietHours.end);
  return Object.freeze({
    start: String(quietHours.start),
    end: String(quietHours.end),
  });
}

/** @param {unknown} value */
function quote(value) {
  return `"${value == null ? "" : value}"`;
}
