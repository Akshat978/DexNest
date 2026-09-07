// Phase 3: itemsFor maps a run's state to items with decided priorities. Every
// stop reason has a decided meaning, and an unknown one is refused rather than
// silently dropped — that is what stops a new reason being added without anyone
// choosing what it means to be told about it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsFor, STOP_REASONS } from "../src/index.js";

const AT = "2026-09-07T10:00:00.000Z";

test("the known stop reasons are exactly these", () => {
  assert.deepEqual(STOP_REASONS, [
    "proposed_completion",
    "worker_failure",
    "budget_spent",
    "run_finished",
    "provider_limit",
  ]);
});

test("a proposed completion is ACTION_REQUIRED and offers a decision", () => {
  const [item] = itemsFor({
    runId: "run-7",
    stopReason: "proposed_completion",
    at: AT,
  });
  assert.equal(item.priority, "ACTION_REQUIRED");
  assert.equal(item.source, "run");
  assert.equal(item.subject, "run-7");
  assert.equal(item.at, AT);
  assert.ok(item.answers.length > 0);
});

test("a worker failure is ACTION_REQUIRED and offers a decision", () => {
  const [item] = itemsFor({ runId: "run-7", stopReason: "worker_failure" });
  assert.equal(item.priority, "ACTION_REQUIRED");
  assert.ok(item.answers.length > 0);
});

test("a spent budget is INFO with no answers", () => {
  const [item] = itemsFor({ runId: "run-7", stopReason: "budget_spent" });
  assert.equal(item.priority, "INFO");
  assert.deepEqual(item.answers, []);
});

test("a finished run is INFO with no answers", () => {
  const [item] = itemsFor({ runId: "run-7", stopReason: "run_finished" });
  assert.equal(item.priority, "INFO");
  assert.deepEqual(item.answers, []);
});

test("a provider limit is ATTENTION", () => {
  const [item] = itemsFor({ runId: "run-7", stopReason: "provider_limit" });
  assert.equal(item.priority, "ATTENTION");
});

test("every stop reason has a decided meaning", () => {
  const decided = ["INFO", "ATTENTION", "ACTION_REQUIRED", "URGENT"];
  for (const stopReason of STOP_REASONS) {
    const items = itemsFor({ runId: "run-1", stopReason, at: AT });
    assert.equal(items.length, 1, `${stopReason} should yield one item`);
    assert.ok(
      decided.includes(items[0].priority),
      `${stopReason} should have a decided priority`
    );
    assert.equal(items[0].subject, "run-1");
  }
});

test("a still-running run yields no items", () => {
  assert.deepEqual(itemsFor({ runId: "run-7" }), []);
});

test("a run's detail overrides the default detail when given", () => {
  const [item] = itemsFor({
    runId: "run-7",
    stopReason: "run_finished",
    detail: "42 of 42 iterations complete.",
  });
  assert.equal(item.detail, "42 of 42 iterations complete.");
});

test("an unknown stop reason is refused, naming it and the valid choices", () => {
  assert.throws(
    () => itemsFor({ runId: "run-7", stopReason: "exploded" }),
    {
      message:
        'Unknown run stop reason: "exploded". ' +
        "Use proposed_completion, worker_failure, budget_spent, " +
        "run_finished or provider_limit.",
    }
  );
});

test("a run state with no runId is refused", () => {
  assert.throws(
    () => itemsFor({ stopReason: "run_finished" }),
    {
      message:
        'Run state has no runId: run state "run_finished". ' +
        "Every run state names the run it is about.",
    }
  );
});
