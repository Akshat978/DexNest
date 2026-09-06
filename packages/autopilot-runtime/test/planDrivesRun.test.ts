// The plan actually driving the run.
//
// Everything to do with plans existed before this and none of it was connected:
// the items were stored, authoritative and displayed, the worker never saw
// them, and nothing ever marked one finished. A run handed a three-phase plan
// worked from its goal sentence and left "0 of 3" on screen for the whole run.
//
// So these assert the wire, not the data model: the worker is told the plan,
// one item is in flight at a time, and an item is finished by VERIFICATION
// passing rather than by the agent saying it is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { PlanStore, renderPlanForWorker } from "../src/plan.ts";
import { LoopStore } from "../src/loopStore.ts";
import { IterationStore } from "../src/iterations.ts";
import { parsePlanText, createRunSpec } from "../src/runSpec.ts";

const PLAN = "### Phase 1 — The page\nBuild it.\n\n### Phase 2 — The styling\nMake it look good.";

const say = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;
const green = (index: number, body?: string): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  ...(body ? { say: say(body) } : {})
});

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[]) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-plandrive-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun({ plan: parsePlanText(PLAN).items });
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIterations: 5, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

const spec = () => createRunSpec({ goal: "g", plan: parsePlanText(PLAN).items }, { id: "s", now: "2026-09-06T00:00:00.000Z" });

test("the worker is told the whole plan, and which item is being asked for", async (t) => {
  const h = fixture(t, [green(0, "decision: CONTINUE\nassignment: Now the styling.")]);
  await h.loop.run("loop-run");

  const prompt = new LoopStore(h.ports).turns("loop-run")[0]!.prompt;
  assert.match(prompt, /THE PLAN/);
  assert.match(prompt, /\[DO THIS NOW\] plan-1 — Phase 1 — The page/);
  assert.match(prompt, /Build it\./, "the active item's detail is included");
  // The rest is present so it can tell where the work sits, but not asked for.
  assert.match(prompt, /\[not started\] plan-2 — Phase 2 — The styling/);
  assert.equal(/Make it look good/.test(prompt), false, "an inactive item's detail is not");
  assert.match(prompt, /Do only the item marked DO THIS NOW/);
});

test("one item is in flight at a time, and it advances as work is verified", async (t) => {
  const h = fixture(t, [
    green(0, "decision: CONTINUE\nassignment: Now the styling."),
    green(1, "decision: PLAN_COMPLETE\nreason: Both phases are done.")
  ]);
  await h.loop.run("loop-run");

  const view = new PlanStore(h.ports).view("loop-run", h.store.requireRun("loop-run").spec);
  assert.deepEqual(view.items.map(item => item.status), ["DONE", "DONE"]);
  assert.equal(view.counts.DONE, 2);
  // Each item's note records what finished it.
  assert.ok(view.items[0]!.note, "a finished item records why");

  // And each was worked as its own piece of work.
  const iterations = new IterationStore(h.ports).list("loop-run");
  assert.deepEqual(iterations.map(entry => entry.planItemId), ["plan-1", "plan-2"]);
});

test("the second turn is told the first item is done", async (t) => {
  const h = fixture(t, [
    green(0, "decision: CONTINUE\nassignment: Now the styling."),
    green(1, "decision: PLAN_COMPLETE\nreason: done")
  ]);
  await h.loop.run("loop-run");

  const [, second] = new LoopStore(h.ports).turns("loop-run");
  assert.match(second!.prompt, /\[done\] plan-1 — Phase 1 — The page/);
  assert.match(second!.prompt, /\[DO THIS NOW\] plan-2 — Phase 2 — The styling/);
  assert.match(second!.prompt, /Make it look good/, "now the active item's detail is included");
});

test("a failing turn does not finish the item it was working on", async (t) => {
  // An item is finished by verification passing, not by the agent's say-so.
  const h = fixture(t, [
    { emitFiles: [{ path: "a.txt", contents: "a\n" }], verify: { typecheck: 1 },
      say: say("decision: CONTINUE\nassignment: Move on to the styling.") },
    green(1, "decision: PLAN_COMPLETE\nreason: done")
  ]);
  await h.loop.run("loop-run");

  const view = new PlanStore(h.ports).view("loop-run", h.store.requireRun("loop-run").spec);
  // The repair landed on the SAME item, and only then did it finish.
  assert.equal(view.items[0]!.status, "DONE");
  assert.equal(view.items[1]!.status, "PENDING", "the failed turn's cheerful decision moved nothing");
  assert.equal(new IterationStore(h.ports).list("loop-run").length, 1, "one piece of work, two turns");
});

test("a run with no plan is completely unaffected", async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-noplan-"));
  initWorktree(resolve(root, "worktree"), [green(0)], { typecheck: 1 });
  const h = openLoop(root, {});
  h.createRun();
  h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "human" });
  t.after(() => { try { h.close(); } catch { /* closed */ } rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "completed");
  assert.equal(/THE PLAN/.test(new LoopStore(h.ports).turns("loop-run")[0]!.prompt), false);
});

test("rendering is empty for an empty plan and never leaks the whole plan's detail", () => {
  assert.equal(renderPlanForWorker({ items: [], orphans: [], counts: { PENDING: 0, ACTIVE: 0, DONE: 0, BLOCKED: 0, SKIPPED: 0 } }), "");

  const view = { items: spec().plan.map((item, index) => ({
    ...item, status: index === 0 ? "ACTIVE" as const : "PENDING" as const,
    note: null, startedAt: null, settledAt: null
  })), orphans: [], counts: { PENDING: 1, ACTIVE: 1, DONE: 0, BLOCKED: 0, SKIPPED: 0 } };
  const text = renderPlanForWorker(view);
  assert.match(text, /Build it\./);
  assert.equal(/Make it look good/.test(text), false);
});
