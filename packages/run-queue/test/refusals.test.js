// Phase 22 — Consistency pass over every refusal.
//
// Every refusal thrown in phases 2, 4, 15 and 18 must follow one shape and one
// voice, from CONVENTIONS.md:
//
//     <what was wrong>: <the thing it was wrong about>. <what would be right>.
//
// This asserts that shape directly, with one representative bad input per error
// kind. It may only make the suite stricter.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQueue,
  makeRecord,
  transition,
  skip,
  reorder,
  parseSchedule,
} from "../src/index.js";

const AT = "2026-09-07T01:00:00.000Z";

// The shared shape: a clause, ": ", the offending thing, ". ", corrective
// guidance, and a closing period. The middle and the guidance must each be
// non-trivially present.
const SHAPE = /^.+: .+\. .+\.$/s;

function goodQueue() {
  return buildQueue([{ id: "a", projectPath: "/a", goal: "g" }]);
}

// One representative bad input per error kind. `contains` is a substring that
// must appear so we know the offending value is actually named.
const refusals = [
  // Phase 2 — malformed items.
  { phase: 2, name: "missing id", run: () => buildQueue([{ goal: "g", projectPath: "/a" }]), contains: "item 0" },
  {
    phase: 2,
    name: "duplicate id",
    run: () => buildQueue([{ id: "x", goal: "g", projectPath: "/a" }, { id: "x", goal: "g", projectPath: "/b" }]),
    contains: "x",
  },
  { phase: 2, name: "missing goal", run: () => buildQueue([{ id: "a", projectPath: "/a" }]), contains: "a" },
  {
    phase: 2,
    name: "oversized goal",
    run: () => buildQueue([{ id: "a", projectPath: "/a", goal: "x".repeat(2001) }]),
    contains: "2001",
  },
  { phase: 2, name: "missing projectPath", run: () => buildQueue([{ id: "a", goal: "g" }]), contains: "a" },
  {
    phase: 2,
    name: "relative projectPath",
    run: () => buildQueue([{ id: "a", goal: "g", projectPath: "rel/path" }]),
    contains: "rel/path",
  },
  // Phase 4 — illegal transition.
  {
    phase: 4,
    name: "illegal transition",
    run: () => transition(makeRecord({ itemId: "a", status: "DONE", settledAt: AT }), "RUNNING", AT),
    contains: "DONE to RUNNING",
  },
  // Phase 15 — skip and reorder.
  {
    phase: 15,
    name: "skip an already-running item",
    run: () => skip([makeRecord({ itemId: "a", status: "RUNNING", startedAt: AT })], "a", AT),
    contains: "RUNNING to SKIPPED",
  },
  {
    phase: 15,
    name: "reorder unknown id",
    run: () => reorder(goodQueue(), ["ghost"]),
    contains: "ghost",
  },
  {
    phase: 15,
    name: "reorder missing id",
    run: () => reorder(buildQueue([{ id: "a", goal: "g", projectPath: "/a" }, { id: "b", goal: "g", projectPath: "/b" }]), ["a"]),
    contains: "b",
  },
  {
    phase: 15,
    name: "reorder duplicated id",
    run: () => reorder(goodQueue(), ["a", "a"]),
    contains: "a",
  },
  // Phase 18 — schedule grammar.
  {
    phase: 18,
    name: "unrecognised schedule",
    run: () => parseSchedule("every other tuesday"),
    contains: "every other tuesday",
  },
];

for (const { phase, name, run, contains } of refusals) {
  test(`phase ${phase}: "${name}" refuses with the shared shape`, () => {
    assert.throws(run, (error) => {
      assert.ok(error instanceof Error, "must throw an Error, not a bare value");
      assert.match(error.message, SHAPE, `message must follow the shared shape: ${error.message}`);
      assert.ok(
        error.message.includes(contains),
        `message must name the offending value (${JSON.stringify(contains)}): ${error.message}`,
      );
      assert.ok(error.message.endsWith("."), "message must end with corrective guidance");
      return true;
    });
  });
}

test("the table covers every audited phase", () => {
  const phases = new Set(refusals.map((r) => r.phase));
  assert.deepEqual([...phases].sort((a, b) => a - b), [2, 4, 15, 18]);
});
