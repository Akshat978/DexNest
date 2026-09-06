// The failure modes of a long unattended run with a plan.
//
// A twenty-two phase run is not a three-phase run with more turns. Things that
// are harmless when a person is watching -- a mislabelled plan item, a turn
// that forgets the decision block -- decide the whole night when nobody is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { PlanStore } from "../src/plan.ts";

const say = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;
const step = (index: number, tail = ""): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  ...(tail ? { say: tail } : {})
});

const PLAN = [
  { id: "plan-1", ordinal: 1, title: "Phase 1 — Lexer", detail: "Tokens." },
  { id: "plan-2", ordinal: 2, title: "Phase 2 — Parser", detail: "Trees." },
  { id: "plan-3", ordinal: 3, title: "Phase 3 — Evaluator", detail: "Values." }
];

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[]) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-overnight-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root);
  h.createRun({ plan: PLAN });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

test("a green turn that forgets the decision block does not finish a plan with work left", async (t) => {
  // The old rule -- green verification means the run is done -- predates plans
  // and self-direction. With twenty-two phases queued, one forgotten block on
  // phase 1 would mark the whole run COMPLETED and stop the night.
  const h = fixture(t, [step(0), step(1, say("decision: PLAN_COMPLETE\nreason: done"))]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 4, grantedBy: "human" });

  const outcome = await h.loop.run("loop-run");
  assert.notEqual(h.store.requireRun("loop-run").state, "COMPLETED", `stopped as ${outcome.reason}`);
  const view = new PlanStore(h.ports).view("loop-run", h.store.requireRun("loop-run").spec);
  assert.ok(view.items.filter(item => item.status === "DONE").length >= 2, "it kept working through the plan");
});

test("a mislabelled plan item does not end the night", async (t) => {
  // "plan-item: Phase 2" instead of "plan-2" is a formatting slip, not an
  // attempt to invent work. Refusing to attribute it is right; throwing away
  // an otherwise valid CONTINUE and waking a human at 4am is not.
  const h = fixture(t, [
    step(0, say("decision: CONTINUE\nplan-item: Phase 2\nassignment: Write the parser.")),
    step(1, say("decision: PLAN_COMPLETE\nreason: done"))
  ]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 4, grantedBy: "human" });

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "plan_complete_proposed", `stopped as ${outcome.reason}: ${outcome.detail}`);
});
