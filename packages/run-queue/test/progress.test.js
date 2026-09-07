// Phase 5 — Progress is derived, never stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueue, makeRecord, progress } from "../src/index.js";

const AT = "2026-09-07T01:00:00.000Z";

function queueOf(...ids) {
  return buildQueue(ids.map((id) => ({ id, projectPath: `/${id}`, goal: "g" })));
}

test("an empty queue has all-zero counts", () => {
  assert.deepEqual(progress([], []), {
    total: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    remaining: 0,
    inFlight: 0,
  });
});

test("with no records every item is remaining", () => {
  const queue = queueOf("a", "b", "c");
  assert.deepEqual(progress(queue, []), {
    total: 3,
    done: 0,
    failed: 0,
    skipped: 0,
    remaining: 3,
    inFlight: 0,
  });
});

test("counts each status in its own bucket", () => {
  const queue = queueOf("a", "b", "c", "d", "e");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: AT }),
    makeRecord({ itemId: "c", status: "SKIPPED", settledAt: AT }),
    makeRecord({ itemId: "d", status: "RUNNING", startedAt: AT }),
    // e has no record -> remaining
  ];
  assert.deepEqual(progress(queue, records), {
    total: 5,
    done: 1,
    failed: 1,
    skipped: 1,
    remaining: 1,
    inFlight: 1,
  });
});

test("an item transitioned several times is counted by its latest status only", () => {
  const queue = queueOf("a");
  const records = [
    makeRecord({ itemId: "a", status: "RUNNING", startedAt: AT }),
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
  ];
  assert.deepEqual(progress(queue, records), {
    total: 1,
    done: 1,
    failed: 0,
    skipped: 0,
    remaining: 0,
    inFlight: 0,
  });
});

test("ABANDONED counts in total but in no reported bucket", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "ABANDONED", settledAt: AT }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
  ];
  const p = progress(queue, records);
  assert.equal(p.total, 2);
  assert.equal(p.done, 1);
  assert.equal(p.done + p.failed + p.skipped + p.remaining + p.inFlight, 1);
});

test("records for items not in the queue do not inflate the counts", () => {
  const queue = queueOf("a");
  const records = [makeRecord({ itemId: "ghost", status: "DONE", settledAt: AT })];
  assert.deepEqual(progress(queue, records), {
    total: 1,
    done: 0,
    failed: 0,
    skipped: 0,
    remaining: 1,
    inFlight: 0,
  });
});

test("progress does not mutate its inputs", () => {
  const queue = queueOf("a");
  const records = Object.freeze([
    Object.freeze(makeRecord({ itemId: "a", status: "DONE", settledAt: AT })),
  ]);
  progress(queue, records);
  assert.equal(records[0].status, "DONE");
});
