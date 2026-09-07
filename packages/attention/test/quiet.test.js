// Phase 8: quiet hours. A local wall-clock window holds routine items — INFO and
// ATTENTION — for the next digest. The window is read on the clock, so a change
// of UTC offset at a daylight-saving boundary leaves it exactly where it was.
// The matching exemption for URGENT and the ACTION_REQUIRED decision is Phase 9;
// here we prove the hold, prove the wrap past midnight, prove the DST invariance,
// and — the rule that outranks the others — prove that URGENT and ACTION_REQUIRED
// still get through the window. These tests exercise the real API from index.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeItem,
  inQuietHours,
  holdForQuietHours,
  holdWithUrgency,
  piercesQuietHours,
  QUIET_PIERCING_PRIORITIES,
  QUIET_HELD_PRIORITIES,
  PRIORITIES,
} from "../src/index.js";

const NIGHT = { start: "23:00", end: "08:00" };

/** A real routine item, at a given local time. */
function item(overrides = {}) {
  return makeItem({
    id: "run-7:iter:9",
    source: "run",
    subject: "run-7",
    priority: "INFO",
    title: "iteration completed",
    detail: "iteration 9 finished",
    at: "2026-09-07T23:30:00-04:00",
    ...overrides,
  });
}

test("a routine item inside the window is held for the digest", () => {
  const decision = holdForQuietHours(item(), NIGHT, "2026-09-07T23:30:00-04:00");
  assert.equal(decision.held, true);
  assert.equal(decision.reason, "quiet_hours");
  assert.equal(decision.endsAt, "08:00");
});

test("a routine item outside the window goes through", () => {
  const decision = holdForQuietHours(item(), NIGHT, "2026-09-07T12:00:00-04:00");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "outside_quiet_hours");
});

test("a window that wraps past midnight holds the small hours", () => {
  // 03:00 is inside a 23:00–08:00 window even though it is a new date.
  assert.equal(inQuietHours("2026-09-08T03:00:00-04:00", NIGHT), true);
  // 23:30 the evening before is inside the same window.
  assert.equal(inQuietHours("2026-09-07T23:30:00-04:00", NIGHT), true);
  // Midday is not.
  assert.equal(inQuietHours("2026-09-07T12:00:00-04:00", NIGHT), false);
});

test("the window's start is inclusive and its end is exclusive", () => {
  assert.equal(inQuietHours("2026-09-07T23:00:00-04:00", NIGHT), true);
  assert.equal(inQuietHours("2026-09-08T08:00:00-04:00", NIGHT), false);
  assert.equal(inQuietHours("2026-09-08T07:59:00-04:00", NIGHT), true);
});

test("a window within a single day does not wrap", () => {
  const window = { start: "01:00", end: "06:00" };
  assert.equal(inQuietHours("2026-09-07T03:00:00-04:00", window), true);
  assert.equal(inQuietHours("2026-09-07T23:00:00-04:00", window), false);
  assert.equal(inQuietHours("2026-09-07T00:30:00-04:00", window), false);
});

test("the window is unmoved across a daylight-saving boundary", () => {
  // US Eastern falls back on 2026-11-01: the offset changes from -04:00 to
  // -05:00. Both timestamps read 23:30 on the wall clock, so both are inside a
  // 23:00–08:00 window. If the window were counted as a fixed number of hours
  // from some instant, the offset change would have shifted one of them out.
  const beforeDst = "2026-11-01T23:30:00-04:00";
  const afterDst = "2026-11-02T23:30:00-05:00";
  assert.equal(inQuietHours(beforeDst, NIGHT), true);
  assert.equal(inQuietHours(afterDst, NIGHT), true);

  // And a wall-clock time just outside the window stays outside on both sides.
  assert.equal(inQuietHours("2026-11-01T22:30:00-04:00", NIGHT), false);
  assert.equal(inQuietHours("2026-11-02T22:30:00-05:00", NIGHT), false);
});

test("ATTENTION is held by the window just as INFO is", () => {
  const it = item({ priority: "ATTENTION" });
  const decision = holdForQuietHours(it, NIGHT, "2026-09-07T23:30:00-04:00");
  assert.equal(decision.held, true);
  assert.equal(decision.reason, "quiet_hours");
});

test("URGENT gets through the window — a quiet system is never silent", () => {
  const it = item({ priority: "URGENT" });
  const decision = holdForQuietHours(it, NIGHT, "2026-09-08T03:00:00-04:00");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "not_a_held_priority");
});

test("ACTION_REQUIRED gets through the window", () => {
  const it = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const decision = holdForQuietHours(it, NIGHT, "2026-09-08T03:00:00-04:00");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "not_a_held_priority");
});

test("a UTC 'Z' timestamp is read on its own clock", () => {
  // A "Z" timestamp is its own local wall-clock: 23:30Z reads 23:30.
  assert.equal(inQuietHours("2026-09-07T23:30:00.000Z", NIGHT), true);
  assert.equal(inQuietHours("2026-09-07T12:00:00.000Z", NIGHT), false);
});

test("an empty window (start equals end) holds nothing", () => {
  assert.equal(inQuietHours("2026-09-07T23:30:00-04:00", { start: "00:00", end: "00:00" }), false);
});

test("a malformed window bound is refused with a message naming it", () => {
  assert.throws(
    () => inQuietHours("2026-09-07T23:30:00-04:00", { start: "2300", end: "08:00" }),
    /Quiet-hours bound is not a wall-clock time: got "2300"\./
  );
});

test("a now with no readable time is refused with a message", () => {
  assert.throws(
    () => inQuietHours("not-a-time", NIGHT),
    /Quiet hours needs a valid current time: got "not-a-time"\./
  );
});

test("the returned decision is frozen", () => {
  const decision = holdForQuietHours(item(), NIGHT, "2026-09-07T23:30:00-04:00");
  assert.throws(() => {
    decision.held = false;
  }, TypeError);
});

// Phase 9: urgent pierces quiet hours. The matching exemption to Phase 8. URGENT
// is delivered at 3am; the ACTION_REQUIRED decision is recorded in one place and
// tested from both sides. And the rule that outranks the others: what the window
// holds is genuinely re-offered when the window ends, not dropped.

test("URGENT pierces the window at 3am — flagged as a pierce, not merely 'not held'", () => {
  const it = item({ priority: "URGENT" });
  const decision = holdWithUrgency(it, NIGHT, "2026-09-08T03:00:00-04:00");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "pierced_quiet_hours");
  assert.equal(decision.pierced, true);
});

test("the ACTION_REQUIRED decision, recorded in one place, is to pierce", () => {
  // This is the line between "it woke me for nothing" and "it sat blocked all
  // night". The single recorded place is QUIET_PIERCING_PRIORITIES.
  assert.equal(QUIET_PIERCING_PRIORITIES.includes("ACTION_REQUIRED"), true);
  assert.equal(piercesQuietHours("ACTION_REQUIRED"), true);
});

test("ACTION_REQUIRED pierces the window at 3am — a blocked run is not left silent", () => {
  const it = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const decision = holdWithUrgency(it, NIGHT, "2026-09-08T03:00:00-04:00");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "pierced_quiet_hours");
  assert.equal(decision.pierced, true);
});

test("the ACTION_REQUIRED decision tested the other way: the held priorities do not include it", () => {
  // The flip side of the same single decision. If ACTION_REQUIRED were held, it
  // would appear among the priorities the window may hold. It must not.
  assert.equal(QUIET_HELD_PRIORITIES.includes("ACTION_REQUIRED"), false);
  assert.equal(piercesQuietHours("INFO"), false);
  assert.equal(piercesQuietHours("ATTENTION"), false);
});

test("held and piercing priorities partition the four levels — no overlap, none left out", () => {
  // Two views of one decision cannot drift: every priority either may be held or
  // pierces, exactly one of the two.
  for (const p of PRIORITIES) {
    const held = QUIET_HELD_PRIORITIES.includes(p);
    const pierces = QUIET_PIERCING_PRIORITIES.includes(p);
    assert.equal(held !== pierces, true, `${p} must be exactly one of held or piercing`);
  }
});

test("a routine item is held during quiet hours but is not pierced", () => {
  const decision = holdWithUrgency(item(), NIGHT, "2026-09-08T03:00:00-04:00");
  assert.equal(decision.held, true);
  assert.equal(decision.reason, "quiet_hours");
  assert.equal(decision.pierced, false);
});

test("what is held is genuinely re-offered when the window ends, not dropped", () => {
  const it = item();
  // 03:00: inside the window, held.
  const duringNight = holdWithUrgency(it, NIGHT, "2026-09-08T03:00:00-04:00");
  assert.equal(duringNight.held, true);
  assert.equal(duringNight.endsAt, "08:00");

  // 08:00: the window has ended. The very same item is no longer held — it comes
  // back for delivery rather than vanishing.
  const afterWindow = holdWithUrgency(it, NIGHT, "2026-09-08T08:00:00-04:00");
  assert.equal(afterWindow.held, false);
  assert.equal(afterWindow.reason, "outside_quiet_hours");
  assert.equal(afterWindow.pierced, false);

  // And a minute past the end, still through — the hold releases, it is not lost.
  const justAfter = holdWithUrgency(it, NIGHT, "2026-09-08T08:01:00-04:00");
  assert.equal(justAfter.held, false);
});

test("piercing reads the window but never resets or mutates it", () => {
  const window = { start: "23:00", end: "08:00" };
  const it = item({ priority: "URGENT" });
  const decision = holdWithUrgency(it, window, "2026-09-08T03:00:00-04:00");
  // The window we passed in is untouched.
  assert.deepEqual(window, { start: "23:00", end: "08:00" });
  // The pierce still describes the window it pierced.
  assert.equal(decision.endsAt, "08:00");
  // And the decision is frozen.
  assert.throws(() => {
    decision.pierced = false;
  }, TypeError);
});
