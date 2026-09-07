// Phase 3 — Records: what has happened to each item.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQueue,
  makeRecord,
  pendingRecord,
  recordsFor,
  canTransition,
  transition,
  isSettled,
  STATUSES,
} from "../src/index.js";

test("pendingRecord fills the optional slots with null", () => {
  assert.deepEqual(pendingRecord("a"), {
    itemId: "a",
    status: "PENDING",
    startedAt: null,
    settledAt: null,
    reason: null,
  });
});

test("makeRecord carries every field through", () => {
  const record = makeRecord({
    itemId: "a",
    status: "DONE",
    startedAt: "2026-09-07T01:00:00.000Z",
    settledAt: "2026-09-07T01:30:00.000Z",
    reason: "shipped",
  });
  assert.deepEqual(record, {
    itemId: "a",
    status: "DONE",
    startedAt: "2026-09-07T01:00:00.000Z",
    settledAt: "2026-09-07T01:30:00.000Z",
    reason: "shipped",
  });
});

test("makeRecord refuses an unknown status, naming the item", () => {
  assert.throws(
    () => makeRecord({ itemId: "a", status: "WAT" }),
    /Record has an unknown status: "WAT" \(item "a"\)\. Use one of: /,
  );
});

test("makeRecord refuses a missing itemId", () => {
  assert.throws(
    () => makeRecord({ status: "PENDING" }),
    /Record has no itemId/,
  );
});

test("STATUSES is exactly the six agreed statuses", () => {
  assert.deepEqual(
    [...STATUSES],
    ["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED", "ABANDONED"],
  );
});

test("recordsFor pairs every item with exactly one record, in queue order", () => {
  const queue = buildQueue([
    { id: "a", projectPath: "/one", goal: "g" },
    { id: "b", projectPath: "/two", goal: "g" },
    { id: "c", projectPath: "/three", goal: "g" },
  ]);
  const records = [
    makeRecord({ itemId: "b", status: "DONE" }),
  ];
  const view = recordsFor(queue, records);
  assert.equal(view.length, queue.length);
  assert.deepEqual(
    view.map((r) => r.itemId),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    view.map((r) => r.status),
    ["PENDING", "DONE", "PENDING"],
  );
});

test("the pairing is total for an empty history: all PENDING", () => {
  const queue = buildQueue([
    { id: "a", projectPath: "/one", goal: "g" },
    { id: "b", projectPath: "/two", goal: "g" },
  ]);
  const view = recordsFor(queue, []);
  assert.equal(view.length, 2);
  assert.ok(view.every((r) => r.status === "PENDING"));
});

test("the empty queue pairs to no records", () => {
  assert.deepEqual(recordsFor([], []), []);
});

test("when an item has several records the latest wins", () => {
  const queue = buildQueue([{ id: "a", projectPath: "/one", goal: "g" }]);
  const records = [
    makeRecord({ itemId: "a", status: "RUNNING", startedAt: "2026-09-07T01:00:00.000Z" }),
    makeRecord({ itemId: "a", status: "DONE", settledAt: "2026-09-07T02:00:00.000Z" }),
  ];
  const view = recordsFor(queue, records);
  assert.equal(view.length, 1);
  assert.equal(view[0].status, "DONE");
});

test("records for items not in the queue are ignored", () => {
  const queue = buildQueue([{ id: "a", projectPath: "/one", goal: "g" }]);
  const view = recordsFor(queue, [makeRecord({ itemId: "ghost", status: "DONE" })]);
  assert.equal(view.length, 1);
  assert.equal(view[0].itemId, "a");
  assert.equal(view[0].status, "PENDING");
});

test("recordsFor does not mutate its inputs", () => {
  const queue = Object.freeze([Object.freeze({ id: "a" })]);
  const records = Object.freeze([
    Object.freeze(makeRecord({ itemId: "a", status: "DONE" })),
  ]);
  const view = recordsFor(queue, records);
  assert.equal(view[0].status, "DONE");
  assert.notEqual(view[0], records[0]);
});

// Phase 4 — Legal and illegal status transitions.

const AT = "2026-09-07T01:00:00.000Z";

// The full matrix of permitted transitions. Everything not here is refused.
const PERMITTED = new Set([
  "PENDING->RUNNING",
  "PENDING->SKIPPED",
  "RUNNING->DONE",
  "RUNNING->FAILED",
  "RUNNING->ABANDONED",
]);

test("every pair in the status matrix is permitted or refused as agreed", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const record = makeRecord({ itemId: "a", status: from });
      const key = `${from}->${to}`;
      const expected = PERMITTED.has(key);
      assert.equal(
        canTransition(record, to),
        expected,
        `canTransition ${key} should be ${expected}`,
      );
      if (expected) {
        assert.doesNotThrow(
          () => transition(record, to, AT),
          `transition ${key} should be allowed`,
        );
      } else {
        assert.throws(
          () => transition(record, to, AT),
          `transition ${key} should be refused`,
        );
      }
    }
  }
});

test("a refusal names both statuses and the item", () => {
  const record = makeRecord({ itemId: "a", status: "DONE" });
  assert.throws(
    () => transition(record, "RUNNING", AT),
    /Transition not allowed: DONE to RUNNING \(item "a"\)\./,
  );
});

test("RUNNING to PENDING is refused", () => {
  const record = makeRecord({ itemId: "a", status: "RUNNING" });
  assert.throws(
    () => transition(record, "PENDING", AT),
    /Transition not allowed: RUNNING to PENDING/,
  );
});

test("starting a record sets startedAt to the transition time", () => {
  const started = transition(pendingRecord("a"), "RUNNING", AT);
  assert.equal(started.startedAt, AT);
  assert.equal(started.settledAt, null);
  assert.equal(started.status, "RUNNING");
});

test("settling a record sets settledAt and preserves startedAt", () => {
  const started = transition(pendingRecord("a"), "RUNNING", AT);
  const settledAt = "2026-09-07T02:00:00.000Z";
  const done = transition(started, "DONE", settledAt, "shipped");
  assert.equal(done.startedAt, AT);
  assert.equal(done.settledAt, settledAt);
  assert.equal(done.reason, "shipped");
});

test("transition carries the previous reason when none is given", () => {
  const started = transition(pendingRecord("a"), "RUNNING", AT, "kickoff");
  const done = transition(started, "DONE", AT);
  assert.equal(done.reason, "kickoff");
});

test("transition does not mutate its argument", () => {
  const record = Object.freeze(pendingRecord("a"));
  const next = transition(record, "RUNNING", AT);
  assert.equal(record.status, "PENDING");
  assert.equal(next.status, "RUNNING");
});

test("transition refuses a missing timestamp", () => {
  assert.throws(
    () => transition(pendingRecord("a"), "RUNNING", ""),
    /Transition has no timestamp/,
  );
});

test("transition refuses an unknown target status", () => {
  assert.throws(
    () => transition(pendingRecord("a"), "WAT", AT),
    /Cannot transition to an unknown status: "WAT"/,
  );
});

test("isSettled is true for final statuses only", () => {
  assert.equal(isSettled("DONE"), true);
  assert.equal(isSettled("FAILED"), true);
  assert.equal(isSettled("SKIPPED"), true);
  assert.equal(isSettled("ABANDONED"), true);
  assert.equal(isSettled("PENDING"), false);
  assert.equal(isSettled("RUNNING"), false);
});
