// Phase 21 — What the operator reads in the morning.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQueue,
  makeRecord,
  progress,
  renderQueueSummary,
} from "../src/index.js";

const AT = "2026-09-07T01:00:00.000Z";

function mixedQueue() {
  return buildQueue([
    { id: "alpha", projectPath: "/alpha", goal: "g", label: "Alpha site" },
    { id: "beta", projectPath: "/beta", goal: "g", label: "Beta API" },
    { id: "gamma", projectPath: "/gamma", goal: "g", label: "Gamma app" },
    { id: "delta", projectPath: "/delta", goal: "g", label: "Delta tool" },
  ]);
}

test("the summary names each project's outcome and the stop reason", () => {
  const queue = mixedQueue();
  const records = [
    makeRecord({ itemId: "alpha", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "beta", status: "FAILED", settledAt: AT, reason: "tests failed" }),
    makeRecord({ itemId: "gamma", status: "SKIPPED", settledAt: AT }),
    // delta was never reached
  ];
  const text = renderQueueSummary(queue, records, progress(queue, records), "deadline");

  assert.match(text, /Alpha site/);
  assert.match(text, /Beta API/);
  assert.match(text, /tests failed/);
  assert.match(text, /Gamma app/);
  assert.match(text, /Delta tool/);
  assert.match(text, /Never reached: Delta tool/);
  assert.match(text, /cut-off time/); // the deadline stop reason, in plain words
});

test("no status codes leak into the text", () => {
  const queue = mixedQueue();
  const records = [
    makeRecord({ itemId: "alpha", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "beta", status: "FAILED", settledAt: AT }),
  ];
  const text = renderQueueSummary(queue, records, progress(queue, records), "cost");
  for (const code of ["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED", "ABANDONED"]) {
    assert.ok(!text.includes(code), `text should not contain status code ${code}`);
  }
});

test("each stop reason renders a human sentence", () => {
  const queue = buildQueue([{ id: "a", projectPath: "/a", goal: "g" }]);
  const records = [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })];
  const p = progress(queue, records);
  const cases = {
    queue_complete: /every project/,
    deadline: /cut-off time/,
    cost: /budget/,
    max_items: /as many projects as allowed/,
    failing: /failed in a row/,
  };
  for (const [reason, pattern] of Object.entries(cases)) {
    const text = renderQueueSummary(queue, records, p, reason);
    assert.match(text, pattern, `reason ${reason}`);
  }
});

test("touched counts started projects, not skipped or unreached ones", () => {
  const queue = mixedQueue();
  const records = [
    makeRecord({ itemId: "alpha", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "beta", status: "FAILED", settledAt: AT }),
    makeRecord({ itemId: "gamma", status: "SKIPPED", settledAt: AT }),
  ];
  const text = renderQueueSummary(queue, records, progress(queue, records), "queue_complete");
  assert.match(text, /Touched 2 of 4 projects/);
});

test("a failure without a reason still reads cleanly", () => {
  const queue = buildQueue([{ id: "a", projectPath: "/a", goal: "g", label: "Only" }]);
  const records = [makeRecord({ itemId: "a", status: "FAILED", settledAt: AT })];
  const text = renderQueueSummary(queue, records, progress(queue, records), "failing");
  assert.match(text, /Only failed\./);
});

test("the summary works with no stop reason given", () => {
  const queue = buildQueue([{ id: "a", projectPath: "/a", goal: "g", label: "Only" }]);
  const records = [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })];
  const text = renderQueueSummary(queue, records, progress(queue, records));
  assert.match(text, /Succeeded: Only/);
});

test("renderQueueSummary does not mutate its inputs", () => {
  const queue = mixedQueue();
  const records = Object.freeze([
    Object.freeze(makeRecord({ itemId: "alpha", status: "DONE", settledAt: AT })),
  ]);
  renderQueueSummary(queue, records, progress(queue, records), "deadline");
  assert.equal(records[0].status, "DONE");
});

test("a skipped project carries its reason, like a failed one", () => {
  // The name alone tells the operator nothing they can act on. "Skipped
  // (repository has uncommitted changes)" tells them exactly what to fix.
  const queue = buildQueue([
    { id: "a", projectPath: "D:/a", goal: "g", label: "astro-yogi" },
    { id: "b", projectPath: "D:/b", goal: "g", label: "portfolio-v2" },
  ]);
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: "2026-09-07T02:00:00.000Z" }),
    makeRecord({
      itemId: "b",
      status: "SKIPPED",
      settledAt: "2026-09-07T02:00:00.000Z",
      reason: "Could not start: repository has uncommitted changes",
    }),
  ];
  const text = renderQueueSummary(queue, records, progress(queue, records), "queue_complete");
  assert.match(text, /Skipped: portfolio-v2 \(Could not start: repository has uncommitted changes\)\./);
});
