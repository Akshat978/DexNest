// Phase 1 — Queue items and their order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueue } from "../src/index.js";

test("an empty queue builds to an empty array", () => {
  assert.deepEqual(buildQueue([]), []);
});

test("ordinals are assigned from input order, 0-based", () => {
  const queue = buildQueue([
    { id: "a", projectPath: "/one", goal: "first" },
    { id: "b", projectPath: "/two", goal: "second" },
    { id: "c", projectPath: "/three", goal: "third" },
  ]);
  assert.deepEqual(
    queue.map((item) => item.ordinal),
    [0, 1, 2],
  );
  assert.deepEqual(
    queue.map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("ordinals supplied by the caller are ignored", () => {
  const queue = buildQueue([
    { id: "a", ordinal: 99, projectPath: "/one", goal: "first" },
    { id: "b", ordinal: 99, projectPath: "/two", goal: "second" },
  ]);
  assert.deepEqual(
    queue.map((item) => item.ordinal),
    [0, 1],
  );
});

test("optional fields are carried through only when present", () => {
  const queue = buildQueue([
    { id: "a", projectPath: "/one", goal: "g", planText: "do it", label: "L" },
    { id: "b", projectPath: "/two", goal: "g" },
  ]);
  assert.equal(queue[0].planText, "do it");
  assert.equal(queue[0].label, "L");
  assert.equal("planText" in queue[1], false);
  assert.equal("label" in queue[1], false);
});

test("required fields are preserved", () => {
  const queue = buildQueue([
    { id: "a", projectPath: "/proj", goal: "ship it" },
  ]);
  assert.deepEqual(queue[0], {
    id: "a",
    ordinal: 0,
    projectPath: "/proj",
    goal: "ship it",
  });
});

test("the input array and its items are not mutated", () => {
  const items = [{ id: "a", projectPath: "/one", goal: "first" }];
  const frozen = Object.freeze([Object.freeze({ ...items[0] })]);
  const queue = buildQueue(frozen);
  assert.equal(queue[0].ordinal, 0);
  assert.equal("ordinal" in frozen[0], false);
});

test("a non-array input is refused with a message", () => {
  assert.throws(() => buildQueue(null), /Queue input is not an array: null/);
});

// Phase 2 — Refusing malformed items, with messages worth reading.

test("a missing goal is refused, naming the item", () => {
  assert.throws(
    () => buildQueue([{ id: "a", projectPath: "/proj" }]),
    (error) => {
      assert.equal(
        error.message,
        'Queue item has no goal: item 0 ("a"). Give every item a goal.',
      );
      return true;
    },
  );
});

test("a blank goal is refused", () => {
  assert.throws(
    () => buildQueue([{ id: "a", projectPath: "/proj", goal: "   " }]),
    /Queue item has no goal: item 0 \("a"\)\. Give every item a goal\./,
  );
});

test("an oversized goal is refused, naming the length and the cap", () => {
  const goal = "x".repeat(2001);
  assert.throws(
    () => buildQueue([{ id: "a", projectPath: "/proj", goal }]),
    (error) => {
      assert.equal(
        error.message,
        'Queue item goal is too long: item 0 ("a"), 2001 characters. Keep goals to at most 2000 characters.',
      );
      return true;
    },
  );
});

test("a goal at exactly the cap is accepted", () => {
  const goal = "x".repeat(2000);
  const queue = buildQueue([{ id: "a", projectPath: "/proj", goal }]);
  assert.equal(queue[0].goal.length, 2000);
});

test("a missing projectPath is refused", () => {
  assert.throws(
    () => buildQueue([{ id: "a", goal: "g" }]),
    (error) => {
      assert.equal(
        error.message,
        'Queue item has no projectPath: item 0 ("a"). Give every item an absolute projectPath.',
      );
      return true;
    },
  );
});

test("a blank projectPath is refused", () => {
  assert.throws(
    () => buildQueue([{ id: "a", goal: "g", projectPath: "  " }]),
    /Queue item has no projectPath: item 0 \("a"\)\./,
  );
});

test("a relative projectPath is refused, naming the path", () => {
  assert.throws(
    () => buildQueue([{ id: "a", goal: "g", projectPath: "projects/site" }]),
    (error) => {
      assert.equal(
        error.message,
        'Queue item projectPath is not absolute: item 0 ("a") ("projects/site"). Use an absolute path like /home/me/project or C:\\Users\\me\\project.',
      );
      return true;
    },
  );
});

test("a Windows absolute projectPath is accepted", () => {
  const queue = buildQueue([
    { id: "a", goal: "g", projectPath: "C:\\Users\\me\\project" },
  ]);
  assert.equal(queue[0].projectPath, "C:\\Users\\me\\project");
});

test("a duplicate id is refused, naming both positions", () => {
  assert.throws(
    () =>
      buildQueue([
        { id: "dup", goal: "g", projectPath: "/one" },
        { id: "dup", goal: "g", projectPath: "/two" },
      ]),
    (error) => {
      assert.equal(
        error.message,
        'Queue item has a duplicate id: item 1 ("dup"), already used by item 0. Give every item a unique id.',
      );
      return true;
    },
  );
});

test("a missing id is refused, naming the item by position", () => {
  assert.throws(
    () => buildQueue([{ goal: "g", projectPath: "/one" }]),
    (error) => {
      assert.equal(
        error.message,
        "Queue item has no id: item 0. Give every item a unique id.",
      );
      return true;
    },
  );
});
