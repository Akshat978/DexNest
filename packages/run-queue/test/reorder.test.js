// Phase 15 — Skipping and reordering without losing history.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQueue,
  reorder,
  skip,
  makeRecord,
  recordsFor,
  progress,
} from "../src/index.js";

const AT = "2026-09-07T01:00:00.000Z";

function queueOf(...ids) {
  return buildQueue(ids.map((id) => ({ id, projectPath: `/${id}`, goal: "g" })));
}

// --- skip ---

test("skip settles a PENDING item as SKIPPED, appending to history", () => {
  const records = skip([], "a", AT, "not tonight");
  assert.equal(records.length, 1);
  assert.equal(records[0].itemId, "a");
  assert.equal(records[0].status, "SKIPPED");
  assert.equal(records[0].settledAt, AT);
  assert.equal(records[0].reason, "not tonight");
});

test("skip preserves earlier records", () => {
  const before = [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })];
  const after = skip(before, "b", AT);
  assert.equal(after.length, 2);
  assert.equal(after[0].status, "DONE");
  assert.equal(after[1].itemId, "b");
  assert.equal(after[1].status, "SKIPPED");
});

test("skip refuses to skip an item that already started", () => {
  const before = [makeRecord({ itemId: "a", status: "RUNNING", startedAt: AT })];
  assert.throws(
    () => skip(before, "a", AT),
    /Transition not allowed: RUNNING to SKIPPED/,
  );
});

test("skip does not mutate the records array it is given", () => {
  const before = Object.freeze([]);
  const after = skip(before, "a", AT);
  assert.equal(before.length, 0);
  assert.equal(after.length, 1);
});

// --- reorder ---

test("reorder produces a new queue in the given order with fresh ordinals", () => {
  const queue = queueOf("a", "b", "c");
  const reordered = reorder(queue, ["c", "a", "b"]);
  assert.deepEqual(
    reordered.map((item) => item.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    reordered.map((item) => item.ordinal),
    [0, 1, 2],
  );
});

test("reorder does not mutate the original queue", () => {
  const queue = queueOf("a", "b", "c");
  reorder(queue, ["c", "b", "a"]);
  assert.deepEqual(
    queue.map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("records survive a reorder: recordsFor still pairs every item", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: AT }),
  ];
  const reordered = reorder(queue, ["c", "b", "a"]);
  const view = recordsFor(reordered, records);
  assert.deepEqual(
    view.map((r) => [r.itemId, r.status]),
    [
      ["c", "PENDING"],
      ["b", "FAILED"],
      ["a", "DONE"],
    ],
  );
  // Progress is unaffected by order.
  assert.equal(progress(reordered, records).done, 1);
  assert.equal(progress(reordered, records).failed, 1);
});

test("reorder refuses an unknown id", () => {
  const queue = queueOf("a", "b");
  assert.throws(
    () => reorder(queue, ["a", "ghost"]),
    /Reorder names an unknown item: "ghost"/,
  );
});

test("reorder refuses a partial id list", () => {
  const queue = queueOf("a", "b", "c");
  assert.throws(
    () => reorder(queue, ["a", "b"]),
    /Reorder is missing items: "c"/,
  );
});

test("reorder refuses a duplicated id", () => {
  const queue = queueOf("a", "b");
  assert.throws(
    () => reorder(queue, ["a", "a"]),
    /Reorder names an item twice: "a"/,
  );
});
