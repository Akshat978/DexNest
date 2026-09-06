// Running while nobody is watching.
//
// Three separate problems, tested separately: an agent that would rather ask
// than decide, a limit that lifts on its own, and a human who needs to know in
// thirty seconds what happened while they slept.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import {
  UnattendedStore, parseAssumptions, unattendedInstructions, RESUME_BACKOFF_MINUTES, MAX_ASSUMPTION_CHARS
} from "../src/unattended.ts";
import { buildMorningSummary, renderMorningSummary } from "../src/morningSummary.ts";
import { LoopStore } from "../src/loopStore.ts";
import { IterationStore } from "../src/iterations.ts";
import { DEFAULT_AGENTIC_TOOLS } from "../src/worker.ts";

const assumed = (body: string) => `<<<DEXNEST_ASSUMED>>>\n${body}\n<<<END_DEXNEST_ASSUMED>>>`;

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[]) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-unattended-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun();
  h.loop.authorize({ runId: "loop-run", maxTurns: 10, maxIterations: 4, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

// --- not asking -------------------------------------------------------------

test("the agent is told what to do instead of asking, not merely not to ask", () => {
  const text = unattendedInstructions();
  assert.match(text, /no way to ask a question/);
  assert.match(text, /Choose the option you would defend/);
  assert.match(text, /<<<DEXNEST_ASSUMED>>>/);
  // "Do not ask" alone produces silent guessing, which is worse than stopping.
  assert.match(text, /favouring the/);
  assert.match(text, /reversible one/);
});

test("some things are never assumed", () => {
  const text = unattendedInstructions();
  assert.match(text, /spends money, sends a message, or touches production/);
  assert.match(text, /cannot undo/);
  assert.match(text, /the goal, the constraints, or the plan itself/);
  assert.match(text, /not permission to widen the work/);
});

test("the agent has no way to ask in the first place", () => {
  // The instruction is a fallback. The real guarantee is that the question
  // tool is simply not in the allow-list, so an unattended run cannot block on
  // a dialog nobody will answer.
  assert.equal(DEFAULT_AGENTIC_TOOLS.includes("AskUserQuestion"), false);
});

test("assumptions are read, bounded, and free of the example", () => {
  const parsed = parseAssumptions(
    `Work done.\n${assumed("Used the existing sqlite helper rather than adding a dependency.")}\n${assumed("Named the table plurally, matching the others.")}`
  );
  assert.deepEqual(parsed, [
    "Used the existing sqlite helper rather than adding a dependency.",
    "Named the table plurally, matching the others."
  ]);

  // An echo of the instructions is not a decision.
  assert.deepEqual(parseAssumptions(unattendedInstructions()), []);
  assert.deepEqual(parseAssumptions("nothing here"), []);
  assert.equal(parseAssumptions(assumed("x".repeat(MAX_ASSUMPTION_CHARS + 100)))[0]!.length, MAX_ASSUMPTION_CHARS);
});

test("a turn's assumptions are recorded once, and survive a failed verification", async (t) => {
  const h = fixture(t, [
    // The work fails its checks, but it still decided something on the way.
    { emitFiles: [{ path: "a.txt", contents: "a\n" }], verify: { typecheck: 1 },
      say: assumed("Chose the smaller refactor because the larger one touches the public API.") },
    { emitFiles: [{ path: "a.txt", contents: "aa\n" }], verify: { typecheck: 0 } }
  ]);
  await h.loop.run("loop-run");

  const store = new UnattendedStore(h.ports);
  const all = store.assumptions("loop-run");
  assert.equal(all.length, 1, "a failed turn's assumptions are exactly the ones worth reading");
  assert.match(all[0]!.text, /smaller refactor/);
  assert.ok(all[0]!.iterationId, "linked to the piece of work it was decided during");

  // Recording twice for the same turn must not duplicate it.
  store.recordAssumptions({ runId: "loop-run", turnId: all[0]!.turnId, texts: ["something else"] });
  assert.equal(store.assumptions("loop-run").length, 1);
});

test("every prompt carries the unattended instructions", async (t) => {
  const h = fixture(t, [{ emitFiles: [{ path: "a.txt", contents: "a\n" }], verify: { typecheck: 0 } }]);
  await h.loop.run("loop-run");
  assert.match(new LoopStore(h.ports).turns("loop-run")[0]!.prompt, /NOBODY IS WATCHING THIS RUN/);
});

// --- waiting out a limit ----------------------------------------------------

test("a usage limit schedules a wait rather than sitting until morning", async (t) => {
  const h = fixture(t, [{ workerFailure: "quota" }]);
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "provider_limit");

  const plan = new UnattendedStore(h.ports).pending("loop-run")!;
  assert.equal(plan.attempt, 1);
  assert.equal(plan.exhausted, false);
  // The clock moves while the run works, so the wait is asserted as a window
  // rather than an exact instant.
  const waited = Date.parse(plan.notBefore) - Date.parse(h.ports.clock.now());
  assert.ok(waited > 0 && waited <= RESUME_BACKOFF_MINUTES[0]! * 60_000, `waited ${waited}ms`);
});

test("the wait escalates, then gives up rather than knocking forever", (t) => {
  const h = fixture(t, [{ workerFailure: "quota" }]);
  const store = new UnattendedStore(h.ports);
  let previous = 0;
  for (const [index, minutes] of RESUME_BACKOFF_MINUTES.entries()) {
    const before = Date.parse(h.ports.clock.now());
    const plan = store.scheduleRetry({ runId: "loop-run", reason: "out of capacity" })!;
    assert.equal(plan.attempt, index + 1);
    // The test clock ticks inside scheduleRetry, so the wait is asserted to a
    // tolerance rather than to the millisecond.
    const waited = Date.parse(plan.notBefore) - before;
    assert.ok(Math.abs(waited - minutes * 60_000) < 10_000, `attempt ${index + 1} waited ${waited}ms`);
    assert.ok(waited > previous, "each wait is longer than the last");
    previous = waited;
  }
  // Past the last backoff it is a problem, not a wait.
  const done = store.scheduleRetry({ runId: "loop-run", reason: "out of capacity" })!;
  assert.equal(done.exhausted, true);
  assert.ok(h.store.listEvents("loop-run").some((event) => event.type === "RESUME_ABANDONED"));
});

test("the wait buys time and never authorization", async (t) => {
  const h = fixture(t, [{ workerFailure: "quota" }]);
  await h.loop.run("loop-run");
  const grant = new LoopStore(h.ports).activeGrant("loop-run")!;
  new UnattendedStore(h.ports).scheduleRetry({ runId: "loop-run", reason: "again" });

  const after = new LoopStore(h.ports).activeGrant("loop-run")!;
  assert.equal(after.maxIterations, grant.maxIterations, "waiting cannot widen the budget");
  assert.equal(after.maxTurns, grant.maxTurns);
  assert.equal(after.status, "ACTIVE");
});

test("a turn that lands clears the wait", async (t) => {
  const h = fixture(t, [
    { workerFailure: "quota" },
    { emitFiles: [{ path: "a.txt", contents: "a\n" }], verify: { typecheck: 0 } }
  ]);
  await h.loop.run("loop-run");
  assert.ok(new UnattendedStore(h.ports).pending("loop-run"));

  await h.loop.run("loop-run", { retryProviderLimit: true });
  assert.equal(new UnattendedStore(h.ports).pending("loop-run"), null, "nothing is still being waited for");
});

test("due() is what a timer asks, and only returns runs whose wait is over", (t) => {
  const h = fixture(t, [{ workerFailure: "quota" }]);
  const store = new UnattendedStore(h.ports);
  const plan = store.scheduleRetry({ runId: "loop-run", reason: "out of capacity" })!;

  assert.deepEqual(store.due(h.ports.clock.now()), []);
  assert.deepEqual(store.due(plan.notBefore).map((entry) => entry.runId), ["loop-run"]);

  store.clear("loop-run");
  assert.deepEqual(store.due(plan.notBefore), []);
});

// --- the morning ------------------------------------------------------------

const summaryFor = (reason: Parameters<typeof buildMorningSummary>[0]["reason"], overrides = {}) =>
  buildMorningSummary({
    reason,
    detail: "",
    iterations: [
      { id: "i1", runId: "r", ordinal: 1, planItemId: null, turnId: "t1", verificationId: "v", checkpointId: "c", status: "VERIFIED", summary: null, startedAt: "x", settledAt: "x" },
      { id: "i2", runId: "r", ordinal: 2, planItemId: null, turnId: "t2", verificationId: "v", checkpointId: null, status: "ABANDONED", summary: null, startedAt: "x", settledAt: "x" }
    ],
    checkpoints: 1,
    assumptions: [{ id: "a1", runId: "r", turnId: "t1", iterationId: "i1", text: "Used the existing helper.", createdAt: "x" }],
    directionSource: "self",
    resume: null,
    provider: "claude",
    sessionId: "abc-123",
    cwd: "D:/MyApp",
    ...overrides
  });

test("the summary answers the questions someone has after sleeping", () => {
  const text = renderMorningSummary(summaryFor("plan_complete_proposed"));
  assert.match(text, /It believes the work is done/);
  assert.match(text, /did not finish the run itself/);
  assert.match(text, /1 of 2 piece\(s\) of work completed/);
  assert.match(text, /It decided 1 thing\(s\) on its own/);
  assert.match(text, /Used the existing helper/);
  assert.match(text, /NEXT: It needs an answer from you/);
  assert.match(text, /claude --resume abc-123/);
});

test("a limit still being waited out needs nothing from the operator", () => {
  const waiting = summaryFor("provider_limit", {
    resume: { runId: "r", attempt: 1, notBefore: "2026-09-06T04:00:00.000Z", reason: "quota", exhausted: false }
  });
  assert.equal(waiting.action, "waiting");
  assert.match(renderMorningSummary(waiting), /NEXT: Nothing to do; it will pick itself back up/);

  // One that gave up does.
  const gaveUp = summaryFor("provider_limit", {
    resume: { runId: "r", attempt: 6, notBefore: "x", reason: "quota", exhausted: true }
  });
  assert.equal(gaveUp.action, "resume");
  assert.match(gaveUp.detail, /waited and the limit did not clear/);
});

test("a stale login says to sign in, not to authorize more work", () => {
  const summary = summaryFor("provider_limit", {
    detail: "claude is no longer logged in. Sign in again and resume.",
    resume: { runId: "r", attempt: 6, notBefore: "x", reason: "auth", exhausted: true }
  });
  assert.equal(summary.action, "sign_in");
  assert.match(renderMorningSummary(summary), /Sign in to the provider/);
});

test("the summary is a pointer, not a transcript", () => {
  const text = renderMorningSummary(summaryFor("completed"));
  assert.ok(text.split("\n").length < 20, "it must be readable in one glance");
  assert.match(text, /The work happens in claude session/);
});
