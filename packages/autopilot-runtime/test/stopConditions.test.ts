// Bounds an operator can actually answer.
//
// "How many iterations" was always a guess standing in for something else. You
// cannot know it before doing the work, so a number typed at midnight is a
// number invented at midnight. These are the questions that DO have honest
// answers then: when should this stop, how much am I willing to spend, and how
// long should it keep trying without getting anywhere.
//
// The property that matters most here is WHERE they are checked. All three are
// evaluated only between pieces of work, so a wall-clock stop never kills a
// turn in flight — that would leave an uncertain send for a human to resolve
// in the morning, which is the opposite of what "stop at 7am" is for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { LoopStore } from "../src/loopStore.ts";
import { IterationStore } from "../src/iterations.ts";
import { buildMorningSummary } from "../src/morningSummary.ts";

const say = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;
const green = (index: number, body = "decision: CONTINUE\nassignment: Keep going."): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  say: say(body)
});
const red = (index: number): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 1 }
});

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[]) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-stopcond-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 50 });
  h.createRun();
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

const inHours = (h: ReturnType<typeof openLoop>, hours: number) =>
  new Date(Date.parse(h.ports.clock.now()) + hours * 3_600_000).toISOString();

// --- the bounds themselves --------------------------------------------------

test("a stop time ends the run, and says so", async (t) => {
  const h = fixture(t, [green(0), green(1), green(2)]);
  // Already past: the very first check trips.
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, stopAt: inHours(h, 1), grantedBy: "human" });
  h.ports.db.exec(`UPDATE autopilot_loop_grants SET stop_at = '2020-01-01T00:00:00.000Z' WHERE run_id = 'loop-run'`);

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "time_limit");
  assert.match(outcome.detail, /stop time/);
  // The bound tripped before any turn ran, so there was nothing to pause and
  // the run never left READY. hold() only moves a run that was working.
  assert.equal(h.store.requireRun("loop-run").state, "READY");
});

test("a spend limit ends the run once the provider's own figure reaches it", async (t) => {
  const h = fixture(t, [green(0, "decision: PLAN_COMPLETE\nreason: one piece is enough")]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxCostUsd: 0.05, grantedBy: "human" });

  // The fixture provider reports no cost, so the budget is primed directly —
  // what is under test is the boundary, not the arithmetic of one CLI.
  await h.loop.run("loop-run");
  const turn = new LoopStore(h.ports).turns("loop-run")[0]!;
  new LoopStore(h.ports).recordTurnCost(turn.id, 0.06);

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "cost_limit");
  assert.match(outcome.detail, /0\.06 of the 0\.05 budget/);
  assert.match(outcome.detail, /as the provider reports it/, "never presented as a bill");
});

test("cost accumulates across turns and is derived from them", async (t) => {
  const h = fixture(t, [green(0, "decision: PLAN_COMPLETE\nreason: done")]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIterations: 2, grantedBy: "human" });
  await h.loop.run("loop-run");

  const loops = new LoopStore(h.ports);
  for (const turn of loops.turns("loop-run")) loops.recordTurnCost(turn.id, 0.25);
  const grant = loops.activeGrant("loop-run")!;
  assert.equal(grant.costUsed, 0.25 * loops.turns("loop-run").length);
});

test("a run that is busy but getting nowhere stops rather than keeps spending", async (t) => {
  // This is the case the existing checks miss. maxConsecutiveFailures only
  // sees FAILING verification, and the stall detector only sees the SAME
  // failure repeating. A worker that keeps asking for context never fails and
  // never repeats itself — it just burns turns producing nothing.
  const asks = (path: string): LoopPlanStep => ({ requestFiles: [path], verify: { typecheck: 1 } });
  const h = fixture(t, [asks("README.md"), asks("package.json"), asks("src/a.ts"), asks("src/b.ts")]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIdleTurns: 3, grantedBy: "human" });

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "no_progress", outcome.detail);
  assert.match(outcome.detail, /since anything last passed verification/);
  assert.ok(new LoopStore(h.ports).turns("loop-run").length >= 3);
});

test("whichever bound is tighter is the one that fires", async (t) => {
  // Repeated identical failures are the stall detector's speciality, and it
  // gives a better answer than "stopped getting anywhere" — it recommends a
  // second opinion. With a generous idle bound it gets there first.
  const h = fixture(t, [red(0), red(1), red(2), red(3)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIdleTurns: 15, grantedBy: "human" });
  assert.equal((await h.loop.run("loop-run")).reason, "consultant_recommended");

  // With a tight one, the operator's own bound wins, which is the point of
  // setting it. Neither is more correct; the tighter answer is the one asked
  // for.
  const other = fixture(t, [red(0), red(1), red(2), red(3)]);
  other.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIdleTurns: 2, grantedBy: "human" });
  assert.equal((await other.loop.run("loop-run")).reason, "no_progress");
});

test("verified work resets the no-progress count", async (t) => {
  const h = fixture(t, [red(0), green(1, "decision: PLAN_COMPLETE\nreason: done")]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIdleTurns: 3, grantedBy: "human" });

  const outcome = await h.loop.run("loop-run");
  assert.notEqual(outcome.reason, "no_progress" as string);
  assert.ok(new IterationStore(h.ports).list("loop-run").some(entry => entry.status === "VERIFIED"));
});

// --- where they are checked -------------------------------------------------

test("a bound never kills a turn in flight", async (t) => {
  // The whole point of "stop at 7am" is waking up to finished work, not to an
  // uncertain send nobody can resolve without reading a transcript.
  const h = fixture(t, [green(0), green(1)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIterations: 5, grantedBy: "human" });

  // The time passes while the first piece of work is underway.
  const iterations = h.loop.iterations;
  const open = iterations.open.bind(iterations);
  iterations.open = (input) => {
    const record = open(input);
    h.ports.db.exec(`UPDATE autopilot_loop_grants SET stop_at = '2020-01-01T00:00:00.000Z' WHERE run_id = 'loop-run'`);
    return record;
  };

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "time_limit");
  const turns = new LoopStore(h.ports).turns("loop-run");
  assert.equal(turns.length, 1, "the turn that had started was still sent");
  assert.equal(turns[0]!.status, "VERIFIED", "and finished properly");
  assert.equal(new IterationStore(h.ports).list("loop-run")[0]!.status, "VERIFIED");
});

// --- bounded at authorization -----------------------------------------------

test("bounds are validated rather than trusted", async (t) => {
  const h = fixture(t, [green(0)]);
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ stopAt: "not a time" }, /valid timestamp/],
    [{ stopAt: "2020-01-01T00:00:00.000Z" }, /in the future/],
    [{ stopAt: inHours(h, 100) }, /within 48 hours/],
    [{ maxCostUsd: 0 }, /between 0 and 1000/],
    [{ maxCostUsd: 5000 }, /between 0 and 1000/],
    [{ maxIdleTurns: 0 }, /between 1 and 20/],
    [{ maxIdleTurns: 99 }, /between 1 and 20/]
  ];
  for (const [extra, expected] of bad) {
    assert.throws(
      () => h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "human", ...extra }),
      expected,
      JSON.stringify(extra)
    );
  }
});

test("a grant with no bounds behaves exactly as it did before", async (t) => {
  const h = fixture(t, [green(0, "decision: PLAN_COMPLETE\nreason: done")]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "human" });
  const grant = new LoopStore(h.ports).activeGrant("loop-run")!;
  assert.equal(grant.stopAt, null);
  assert.equal(grant.maxCostUsd, null);
  assert.equal(grant.maxIdleTurns, null);
  assert.equal((await h.loop.run("loop-run")).reason, "plan_complete_proposed");
});

// --- the morning ------------------------------------------------------------

test("the summary names which bound stopped the run", () => {
  const base = {
    detail: "", iterations: [], checkpoints: 0, assumptions: [],
    directionSource: "self" as const, resume: null, provider: "claude",
    sessionId: "s", cwd: "D:/MyApp"
  };
  assert.match(buildMorningSummary({ ...base, reason: "time_limit" }).headline, /stopped at the time you set/);
  assert.match(buildMorningSummary({ ...base, reason: "time_limit" }).detail, /nothing is half-done/);
  assert.match(buildMorningSummary({ ...base, reason: "cost_limit" }).headline, /spend you allowed/);
  assert.match(buildMorningSummary({ ...base, reason: "no_progress" }).headline, /stopped getting anywhere/);
});
