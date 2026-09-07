// Phase 1: building real items and asserting the normalised shape, through
// the public API a caller would use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeItem, PRIORITIES } from "../src/index.js";

test("the four priorities are exactly these, in order", () => {
  assert.deepEqual(PRIORITIES, [
    "INFO",
    "ATTENTION",
    "ACTION_REQUIRED",
    "URGENT",
  ]);
});

test("an item with no answers normalises to an empty answers array", () => {
  const item = makeItem({
    id: "run-finished",
    source: "run",
    subject: "run-42",
    priority: "INFO",
    title: "Run finished",
    detail: "All iterations complete.",
    groupKey: "run:run-42",
    at: "2026-09-07T10:00:00.000Z",
  });

  assert.deepEqual(item, {
    id: "run-finished",
    source: "run",
    subject: "run-42",
    priority: "INFO",
    title: "Run finished",
    detail: "All iterations complete.",
    groupKey: "run:run-42",
    at: "2026-09-07T10:00:00.000Z",
    answers: [],
  });
});

test("an item with several answers keeps them as { id, label }", () => {
  const item = makeItem({
    id: "approve-completion",
    source: "run",
    subject: "run-7",
    priority: "ACTION_REQUIRED",
    title: "Approve completion?",
    detail: "The worker proposes it is done.",
    at: "2026-09-07T09:00:00.000Z",
    answers: [
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Keep going" },
      { id: "later", label: "Ask me later" },
    ],
  });

  assert.deepEqual(item.answers, [
    { id: "approve", label: "Approve" },
    { id: "reject", label: "Keep going" },
    { id: "later", label: "Ask me later" },
  ]);
});

test("groupKey defaults to source:subject when omitted", () => {
  const item = makeItem({
    id: "x",
    source: "queue",
    subject: "queue-1",
    priority: "ATTENTION",
    title: "Provider limit reached",
    at: "2026-09-07T09:00:00.000Z",
  });
  assert.equal(item.groupKey, "queue:queue-1");
});

test("whitespace around string fields is trimmed", () => {
  const item = makeItem({
    id: "  run-1  ",
    source: " run ",
    subject: " run-1 ",
    priority: "INFO",
    title: "  Done  ",
    at: "2026-09-07T09:00:00.000Z",
  });
  assert.equal(item.id, "run-1");
  assert.equal(item.source, "run");
  assert.equal(item.subject, "run-1");
  assert.equal(item.title, "Done");
});

test("a normalised item is frozen", () => {
  const item = makeItem({
    id: "x",
    source: "run",
    subject: "run-1",
    priority: "INFO",
    title: "Done",
    at: "2026-09-07T09:00:00.000Z",
  });
  assert.throws(() => {
    item.priority = "URGENT";
  });
});

// Phase 2: each malformed item is refused with a message naming the offending
// item and what would be right. The exact text is asserted so someone reading
// it at 7am learns what to fix.

test("an unknown priority is refused, naming it and the valid choices", () => {
  assert.throws(
    () =>
      makeItem({
        id: "run-1",
        source: "run",
        subject: "run-1",
        priority: "warning",
        title: "Something happened",
        at: "2026-09-07T09:00:00.000Z",
      }),
    {
      message:
        'Unknown priority: "warning". ' +
        "Use INFO, ATTENTION, ACTION_REQUIRED or URGENT.",
    }
  );
});

test("a missing subject is refused, naming the item", () => {
  assert.throws(
    () =>
      makeItem({
        id: "run-finished",
        source: "run",
        priority: "INFO",
        title: "Run finished",
        at: "2026-09-07T09:00:00.000Z",
      }),
    {
      message:
        'Attention item has no subject: item "run-finished". ' +
        "Every item names the run or queue it is about.",
    }
  );
});

test("a blank title is refused, naming the item", () => {
  assert.throws(
    () =>
      makeItem({
        id: "run-1",
        source: "run",
        subject: "run-1",
        priority: "INFO",
        title: "   ",
        at: "2026-09-07T09:00:00.000Z",
      }),
    {
      message:
        'Attention item has a blank title: item "run-1". ' +
        "Give it a short title a person can read.",
    }
  );
});

test("answers on a non-answerable item are refused, naming the priority", () => {
  assert.throws(
    () =>
      makeItem({
        id: "run-done",
        source: "run",
        subject: "run-1",
        priority: "INFO",
        title: "Run finished",
        at: "2026-09-07T09:00:00.000Z",
        answers: [{ id: "ok", label: "OK" }],
      }),
    {
      message:
        "Attention item offers answers but is not answerable: " +
        'item "run-done" is INFO. ' +
        "Only ACTION_REQUIRED items may offer answers.",
    }
  );
});

test("duplicate answer ids are refused, naming the repeated id", () => {
  assert.throws(
    () =>
      makeItem({
        id: "approve-completion",
        source: "run",
        subject: "run-7",
        priority: "ACTION_REQUIRED",
        title: "Approve completion?",
        at: "2026-09-07T09:00:00.000Z",
        answers: [
          { id: "approve", label: "Approve" },
          { id: "approve", label: "Approve again" },
        ],
      }),
    {
      message:
        "Attention item has duplicate answer ids: " +
        'item "approve-completion" repeats "approve". ' +
        "Each answer needs a distinct id.",
    }
  );
});
