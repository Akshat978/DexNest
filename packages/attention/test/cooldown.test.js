// Phase 6: cooldown. A delivery record says which group was delivered and when.
// A fresh item about a group still inside its window is held; once the window
// expires, or if the group was never delivered, it goes through. The last test
// is the load-bearing one for what comes next: a group whose only previous
// delivery was at a lower priority is still held here — Phase 7 is what will let
// an escalation pierce that. These tests exercise the real API from src/index.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeItem, holdForCooldown, lastDeliveryFor } from "../src/index.js";

const AT = "2026-09-07T10:00:00.000Z";

/** A real item about a run, at a given time. */
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

test("an item whose group was delivered within the window is held", () => {
  const it = item();
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:00:00.000Z")];
  // 20 minutes later, window is 30 minutes: still cooling down.
  const decision = holdForCooldown(it, deliveries, 30, "2026-09-07T10:20:00.000Z");

  assert.equal(decision.held, true);
  assert.equal(decision.reason, "cooling_down");
  assert.equal(decision.coolsDownAt, "2026-09-07T10:30:00.000Z");
  assert.equal(decision.lastDelivery.groupKey, it.groupKey);
});

test("an item whose window has expired is not held", () => {
  const it = item();
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:00:00.000Z")];
  // 45 minutes later, window is 30 minutes: expired.
  const decision = holdForCooldown(it, deliveries, 30, "2026-09-07T10:45:00.000Z");

  assert.equal(decision.held, false);
  assert.equal(decision.reason, "expired");
});

test("the window boundary is exclusive: at exactly the window's end it goes through", () => {
  const it = item();
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:00:00.000Z")];
  const decision = holdForCooldown(it, deliveries, 30, "2026-09-07T10:30:00.000Z");

  assert.equal(decision.held, false);
  assert.equal(decision.reason, "expired");
});

test("an item whose group was never delivered is not held", () => {
  const it = item();
  const decision = holdForCooldown(it, [], 30, "2026-09-07T10:20:00.000Z");

  assert.equal(decision.held, false);
  assert.equal(decision.reason, "never_sent");
  assert.equal(decision.lastDelivery, null);
  assert.equal(decision.coolsDownAt, null);
});

test("deliveries of other groups do not cool this group down", () => {
  const it = item();
  const deliveries = [delivery("run:other", "2026-09-07T10:19:00.000Z")];
  const decision = holdForCooldown(it, deliveries, 30, "2026-09-07T10:20:00.000Z");

  assert.equal(decision.held, false);
  assert.equal(decision.reason, "never_sent");
});

test("a group delivered only at a lower priority is still held during its window", () => {
  // The item is ACTION_REQUIRED; the previous delivery was a routine INFO.
  // Phase 6 holds it anyway — cooldown is time, not priority. Phase 7 is what
  // will let the escalation pierce this.
  const it = item({ id: "run-7:blocked", priority: "ACTION_REQUIRED" });
  const deliveries = [
    delivery(it.groupKey, "2026-09-07T10:05:00.000Z", "INFO"),
  ];
  const decision = holdForCooldown(it, deliveries, 30, "2026-09-07T10:20:00.000Z");

  assert.equal(decision.held, true);
  assert.equal(decision.reason, "cooling_down");
  assert.equal(decision.lastDelivery.priority, "INFO");
});

test("the most recent delivery for a group decides the window", () => {
  const it = item();
  const deliveries = [
    delivery(it.groupKey, "2026-09-07T09:00:00.000Z"),
    delivery(it.groupKey, "2026-09-07T10:10:00.000Z"),
    delivery(it.groupKey, "2026-09-07T09:30:00.000Z"),
  ];
  const last = lastDeliveryFor(it.groupKey, deliveries);
  assert.equal(last.at, "2026-09-07T10:10:00.000Z");

  const decision = holdForCooldown(it, deliveries, 30, "2026-09-07T10:20:00.000Z");
  assert.equal(decision.held, true);
  assert.equal(decision.coolsDownAt, "2026-09-07T10:40:00.000Z");
});

test("a zero-minute window never holds", () => {
  const it = item();
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:20:00.000Z")];
  const decision = holdForCooldown(it, deliveries, 0, "2026-09-07T10:20:00.000Z");
  assert.equal(decision.held, false);
  assert.equal(decision.reason, "expired");
});

test("an unusable cooldown window is refused with a message naming the value", () => {
  const it = item();
  assert.throws(
    () => holdForCooldown(it, [], -5, AT),
    /Cooldown window is not a duration in minutes: got "-5"\./
  );
});

test("the returned decision is frozen — nothing downstream can mutate it", () => {
  const it = item();
  const deliveries = [delivery(it.groupKey, "2026-09-07T10:00:00.000Z")];
  const decision = holdForCooldown(it, deliveries, 30, "2026-09-07T10:20:00.000Z");
  assert.throws(() => {
    decision.held = false;
  }, TypeError);
});
