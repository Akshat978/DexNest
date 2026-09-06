// Self-direction end to end: does the next assignment actually react to the
// last one, and does a green verification stop ending the run?
//
// The acceptance criterion for this phase is narrow and behavioural: one turn
// finishes, says what it would do next, and the following turn is that. These
// tests drive the real loop with a fixture worker that emits decision blocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { DirectionStore } from "../src/direction.ts";
import { LoopStore } from "../src/loopStore.ts";
import { IterationStore } from "../src/iterations.ts";

/** A green step whose reply ends with a decision block. */
const decides = (file: string, body: string): LoopPlanStep => ({
  emitFiles: [{ path: file, contents: `${file}\n` }],
  verify: { typecheck: 0 },
  say: `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`
});

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[], turns = 4) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-directed-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun();
  h.loop.authorize({ runId: "loop-run", maxTurns: turns, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

test("a green turn that says CONTINUE ends the iteration, not the run", async (t) => {
  const h = fixture(t, [
    decides("one.txt", "decision: CONTINUE\nassignment: Now add the second file."),
    decides("two.txt", "decision: PLAN_COMPLETE\nreason: Both files exist.")
  ]);
  const outcome = await h.loop.run("loop-run");

  const turns = new LoopStore(h.ports).turns("loop-run");
  assert.equal(turns.length, 2, "verification passing must not have ended the run after turn 1");
  assert.deepEqual(turns.map((turn) => turn.status), ["VERIFIED", "VERIFIED"]);
  assert.deepEqual(
    new IterationStore(h.ports).list("loop-run").map((iteration) => iteration.status),
    ["VERIFIED", "VERIFIED"]
  );
  assert.equal(outcome.reason, "plan_complete_proposed");
});

test("the next prompt is demonstrably the assignment the agent gave itself", async (t) => {
  const h = fixture(t, [
    decides("one.txt", "decision: CONTINUE\nassignment: Now add the second file, called two.txt."),
    decides("two.txt", "decision: NEEDS_HUMAN\nreason: Need a decision on naming.")
  ]);
  await h.loop.run("loop-run");

  const [first, second] = new LoopStore(h.ports).turns("loop-run");
  // This is the whole phase: turn 2 reacts to what turn 1 said it would do.
  assert.match(second!.prompt, /Now add the second file, called two\.txt/);
  assert.match(second!.prompt, /At the end of your last turn you said/);
  assert.equal(/Now add the second file/.test(first!.prompt), false, "turn 1 cannot already contain it");

  const decisions = new DirectionStore(h.ports).list("loop-run");
  assert.equal(decisions[0]!.verb, "CONTINUE");
  assert.equal(decisions[0]!.consumedByTurnId, second!.id, "the assignment is bound to the turn that acted on it");
});

test("PLAN_COMPLETE stops and asks; it never finishes the run itself", async (t) => {
  const h = fixture(t, [decides("one.txt", "decision: PLAN_COMPLETE\nreason: Everything asked for is done.")]);
  const outcome = await h.loop.run("loop-run");

  assert.equal(outcome.reason, "plan_complete_proposed");
  assert.match(outcome.detail, /Everything asked for is done/);
  // An agent marking its own homework at 3am is the failure this prevents.
  assert.notEqual(h.store.requireRun("loop-run").state, "COMPLETED");
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED");
  // The work itself still counted: verification passed and was checkpointed.
  assert.equal(new IterationStore(h.ports).list("loop-run")[0]!.status, "VERIFIED");
});

test("NEEDS_HUMAN holds the run with the agent's reason", async (t) => {
  const h = fixture(t, [decides("one.txt", "decision: NEEDS_HUMAN\nreason: The staging credentials are missing.")]);
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "direction_needs_human");
  assert.match(outcome.detail, /staging credentials are missing/);
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED");
});

test("a failing verification is answered with evidence, not with the agent's opinion", async (t) => {
  const h = fixture(t, [
    // The worker claims a cheerful next step, but the tests fail.
    { emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 1 },
      say: "<<<DEXNEST_NEXT>>>\ndecision: CONTINUE\nassignment: Move on to something else entirely.\n<<<END_DEXNEST_NEXT>>>" },
    decides("two.txt", "decision: PLAN_COMPLETE\nreason: Fixed.")
  ]);
  await h.loop.run("loop-run");

  const [first, second] = new LoopStore(h.ports).turns("loop-run");
  assert.equal(second!.kind, "REPAIR");
  // A failure is DexNest's finding. The agent does not get to route around it.
  assert.equal(/Move on to something else entirely/.test(second!.prompt), false);
  assert.match(second!.prompt, /did not pass verification/);
  // The failed turn's cheerful decision is never even read.
  const decisions = new DirectionStore(h.ports).list("loop-run");
  assert.equal(decisions.some((decision) => decision.turnId === first!.id), false);
});

test("a run whose worker says nothing behaves exactly as it did before", async (t) => {
  // Self-direction is opt-in by the worker's own reply. Without a decision
  // block a green verification still means the run is done.
  const h = fixture(t, [{ emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 0 } }]);
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "completed");
  assert.equal(h.store.requireRun("loop-run").state, "COMPLETED");
  assert.equal(new DirectionStore(h.ports).list("loop-run").length, 0);
});

test("every prompt carries the decision protocol so the worker knows how to answer", async (t) => {
  const h = fixture(t, [decides("one.txt", "decision: NEEDS_HUMAN\nreason: stop")]);
  await h.loop.run("loop-run");
  const prompt = new LoopStore(h.ports).turns("loop-run")[0]!.prompt;
  assert.match(prompt, /<<<DEXNEST_NEXT>>>/);
  assert.match(prompt, /PLAN_COMPLETE stops the run and asks a human/);
});
