// Auto-chaining: many iterations, no clicks.
//
// This is the phase the whole thing was for — press start, walk away, come back
// to work that was done and a run holding for review. So these tests are about
// the two properties that make walking away reasonable:
//
//   1. It really does chain. Ten pieces of work, one authorization, no human
//      between them.
//   2. It really does stop. The budget is the operator's, not the agent's, and
//      revoking it takes effect at the next boundary rather than "eventually".

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { IterationStore } from "../src/iterations.ts";
import { LoopStore } from "../src/loopStore.ts";
import { CheckpointStore } from "../src/checkpoints.ts";
import { DirectionStore } from "../src/direction.ts";

/** A green piece of work that says what it would do next. */
const step = (index: number, body: string): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  say: `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`
});

/** Nine assignments that each ask for the next, then one that stops. */
function chainOfTen(): LoopPlanStep[] {
  const plan: LoopPlanStep[] = [];
  for (let index = 0; index < 9; index += 1) {
    plan.push(step(index, `decision: CONTINUE\nassignment: Write file-${index + 1}.txt, the next piece of work.`));
  }
  plan.push(step(9, "decision: PLAN_COMPLETE\nreason: All ten files exist and verification is green."));
  return plan;
}

function fixture(
  t: { after(fn: () => void): void },
  plan: LoopPlanStep[],
  grant: { maxTurns: number; maxIterations?: number } = { maxTurns: 30, maxIterations: 10 }
) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-chain-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun();
  h.loop.authorize({ runId: "loop-run", grantedBy: "human", ...grant });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

test("ten iterations run on one authorization, with no human between them", async (t) => {
  const h = fixture(t, chainOfTen());
  const outcome = await h.loop.run("loop-run");

  const iterations = new IterationStore(h.ports).list("loop-run");
  assert.equal(iterations.length, 10, "ten distinct pieces of work");
  assert.deepEqual([...new Set(iterations.map((iteration) => iteration.status))], ["VERIFIED"]);
  assert.deepEqual(iterations.map((iteration) => iteration.ordinal), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  // Each verified iteration left a commit, so the morning's work is revertible
  // piece by piece rather than as one lump.
  assert.equal(new CheckpointStore(h.ports).list("loop-run").length, 10);

  // Nine assignments were written by the agent and acted on exactly once each.
  const decisions = new DirectionStore(h.ports).list("loop-run");
  assert.equal(decisions.filter((decision) => decision.verb === "CONTINUE").length, 9);
  assert.equal(decisions.filter((decision) => decision.verb === "CONTINUE" && !decision.consumedByTurnId).length, 0);

  // And it stopped by asking, not by deciding.
  assert.equal(outcome.reason, "plan_complete_proposed");
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED");
});

test("the iteration budget is the operator's, and the run stops when it is spent", async (t) => {
  // Twenty assignments offered, four authorized.
  const plan = Array.from({ length: 20 }, (_, index) =>
    step(index, `decision: CONTINUE\nassignment: Keep going with file-${index + 1}.txt.`));
  const h = fixture(t, plan, { maxTurns: 30, maxIterations: 4 });

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "iteration_limit");
  assert.match(outcome.detail, /Iteration limit of 4 reached/);
  assert.equal(new IterationStore(h.ports).list("loop-run").length, 4);
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED");

  // The grant is spent, not merely paused: resuming needs a fresh human act.
  assert.equal(new LoopStore(h.ports).grants("loop-run")[0]!.status, "EXHAUSTED");
  assert.equal(new LoopStore(h.ports).activeGrant("loop-run"), null);
});

test("repairs come out of the turn ceiling, not the iteration budget", async (t) => {
  // One piece of work that takes three attempts, then one more.
  const h = fixture(t, [
    { emitFiles: [{ path: "a.txt", contents: "a\n" }], verify: { typecheck: 1 } },
    { emitFiles: [{ path: "a.txt", contents: "aa\n" }], verify: { typecheck: 1 } },
    step(0, "decision: CONTINUE\nassignment: Now the second piece of work."),
    step(1, "decision: PLAN_COMPLETE\nreason: Done.")
  ], { maxTurns: 30, maxIterations: 2 });

  const outcome = await h.loop.run("loop-run");
  assert.equal(new LoopStore(h.ports).turns("loop-run").length, 4, "four turns");
  assert.equal(new IterationStore(h.ports).list("loop-run").length, 2, "two pieces of work");
  assert.equal(outcome.reason, "plan_complete_proposed", "the budget was not exhausted by repairs");
});

test("revoking mid-chain stops the run at the next boundary", async (t) => {
  const h = fixture(t, chainOfTen());

  // Interrupt as soon as the third iteration opens, the way a human clicking
  // stop would: between pieces of work, never mid-write. The loop's own store
  // is patched, because that is the instance it actually calls.
  const iterations = h.loop.iterations;
  const original = iterations.open.bind(iterations);
  let revoked = false;
  iterations.open = (input) => {
    const record = original(input);
    if (!revoked && (record?.ordinal ?? 0) >= 3) {
      revoked = true;
      h.loop.revoke("loop-run", "The operator stopped the run.");
    }
    return record;
  };

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "grant_closed");
  assert.ok(iterations.list("loop-run").length < 10, "it did not run to completion");
  assert.equal(new LoopStore(h.ports).activeGrant("loop-run"), null);
});

test("a grant with no iteration budget is bounded by turns, exactly as before", async (t) => {
  const h = fixture(t, chainOfTen(), { maxTurns: 3 });
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "turn_limit");
  assert.equal(new LoopStore(h.ports).grants("loop-run")[0]!.maxIterations, null);
  assert.equal(new LoopStore(h.ports).turns("loop-run").length, 3);
});

test("budgets are bounded at authorization, not trusted from the caller", (t) => {
  const h = fixture(t, chainOfTen());
  h.loop.revoke("loop-run", "clearing for the next assertion");
  for (const maxIterations of [0, -1, 51, 1.5]) {
    assert.throws(
      () => h.loop.authorize({ runId: "loop-run", maxTurns: 5, maxIterations, grantedBy: "human" }),
      /between 1 and 50 iterations/
    );
  }
});

test("the chain resumes where it stopped rather than starting over", async (t) => {
  const h = fixture(t, chainOfTen(), { maxTurns: 30, maxIterations: 3 });
  await h.loop.run("loop-run");
  assert.equal(new IterationStore(h.ports).list("loop-run").length, 3);

  // A fresh authorization continues the same plan, on the same session, with
  // the iteration numbering carrying on.
  h.loop.authorize({ runId: "loop-run", maxTurns: 30, maxIterations: 3, grantedBy: "human" });
  await h.loop.run("loop-run");

  const iterations = new IterationStore(h.ports).list("loop-run");
  assert.equal(iterations.length, 6);
  assert.deepEqual(iterations.map((iteration) => iteration.ordinal), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...new Set(iterations.map((iteration) => iteration.status))], ["VERIFIED"]);
});
