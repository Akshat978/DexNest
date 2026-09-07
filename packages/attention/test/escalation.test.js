// Phase 7: escalation pierces cooldown. This is what makes Phase 6 safe. An
// ACTION_REQUIRED or URGENT item is delivered even when its group is cooling
// down, and even when an identical-looking INFO was just sent. The load-bearing
// pair of tests: the escalation gets through, and the routine items in the same
// group go on being held — escalation does not reset their cooldown. Exercised
// through the real API from src/index.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeItem,
  holdWithEscalation,
  holdForCooldown,
  escalates,
} from "../src/index.js";

const AT = "2026-09-07T10:00:00.000Z";

/** A real item about run-7, at a given time. */
function item(overrides = {}) {
  return makeItem({
    id: "run-7:iter:9",
    source: "run",
    subject: "run-7",
    priority: "INFO",
    title: "iteration completed",
    detail: "iteration 9 finished",
    at: AT,
    ...overrides,
  });
}

/** A delivery record for a group at a time. */
function delivery(groupKey, at, priority = "INFO") {
  return { groupKey, priority, at };
}

test("escalates recognises exactly ACTION_REQUIRED and URGENT", () => {
  assert.equal(escalates("ACTION_REQUIRED"), true);
  assert.equal(escalates("URGENT"), true);
  assert.equal(escalates("INFO"), false);
  assert.equal(escalates("ATTENTION"), false);
});

test("an ACTION_REQUIRED item pierces a group that is cooling down", () => {
  const it = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:05:00.000Z", "INFO")];
  // 15 minutes into a 30-minute window: the group is cooling down.
  const decision = holdWithEscalation(it, deliveries, 30, "2026-09-07T10:20:00.000Z");

  assert.equal(decision.held, false);
  assert.equal(decision.reason, "escalated");
  assert.equal(decision.pierced, true);
  // The window it pierced is still described, not reset.
  assert.equal(decision.coolsDownAt, "2026-09-07T10:35:00.000Z");
});

test("a URGENT item pierces a group that is cooling down", () => {
  const it = item({ id: "run-7:down", priority: "URGENT" });
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:05:00.000Z", "INFO")];
  const decision = holdWithEscalation(it, deliveries, 30, "2026-09-07T10:20:00.000Z");

  assert.equal(decision.held, false);
  assert.equal(decision.reason, "escalated");
  assert.equal(decision.pierced, true);
});

test("an escalation pierces even when an identical-looking INFO was just sent", () => {
  // Same group, same subject, same title — only the priority differs. The INFO
  // was delivered a minute ago; the ACTION_REQUIRED must still get through.
  const info = item();
  const deliveries = [
    delivery(info.groupKey, "2026-09-07T10:19:00.000Z", "INFO"),
  ];
  const escalation = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const decision = holdWithEscalation(
    escalation,
    deliveries,
    30,
    "2026-09-07T10:20:00.000Z"
  );

  assert.equal(decision.held, false);
  assert.equal(decision.reason, "escalated");
  assert.equal(decision.pierced, true);
});

test("escalation does not reset the cooldown for routine items in the same group", () => {
  // An escalation pierces the group's cooldown. A routine INFO item about the
  // same group, seen at the same moment against the same deliveries, is still
  // held: piercing reads the window but never resets it, and never records a
  // new delivery that would extend the hold.
  const deliveries = [delivery("run:run-7", "2026-09-07T10:05:00.000Z", "INFO")];

  const escalation = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const pierced = holdWithEscalation(escalation, deliveries, 30, "2026-09-07T10:20:00.000Z");
  assert.equal(pierced.held, false);
  assert.equal(pierced.pierced, true);

  const routine = item();
  const stillHeld = holdWithEscalation(routine, deliveries, 30, "2026-09-07T10:20:00.000Z");
  assert.equal(stillHeld.held, true);
  assert.equal(stillHeld.reason, "cooling_down");
  assert.equal(stillHeld.pierced, false);
  // The window is unchanged by the pierce: it still ends 30 minutes after the
  // original INFO delivery, not from the moment of the escalation.
  assert.equal(stillHeld.coolsDownAt, "2026-09-07T10:35:00.000Z");

  // And the raw cooldown, priority-blind, agrees the routine item is held.
  const raw = holdForCooldown(routine, deliveries, 30, "2026-09-07T10:20:00.000Z");
  assert.equal(raw.held, true);
});

test("an escalation with no active cooldown simply goes through, unpierced", () => {
  const it = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const decision = holdWithEscalation(it, [], 30, "2026-09-07T10:20:00.000Z");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "never_sent");
  assert.equal(decision.pierced, false);
});

test("a routine item outside any window goes through, unpierced", () => {
  const it = item();
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:00:00.000Z", "INFO")];
  const decision = holdWithEscalation(it, deliveries, 30, "2026-09-07T10:45:00.000Z");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "expired");
  assert.equal(decision.pierced, false);
});

test("the delivery decision is frozen", () => {
  const it = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:05:00.000Z", "INFO")];
  const decision = holdWithEscalation(it, deliveries, 30, "2026-09-07T10:20:00.000Z");
  assert.throws(() => {
    decision.held = true;
  }, TypeError);
});
