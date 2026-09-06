// Running out of subscription capacity, and picking up where it stopped.
//
// This is the difference between a run that broke and a run that simply cannot
// continue right now. Nothing is wrong with the work when a limit is hit, so
// the run must keep everything it needs to carry on: the same conversation, the
// same authorization, the same place in the plan.
//
// It is only safe to treat a limit this way because both quota and auth
// failures are classified CERTAIN by the provider adapters — the send is known
// not to have been delivered. A pause that resumed an uncertain send would be a
// duplicate message in a live conversation, which is the one thing this system
// refuses to risk.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { LoopStore } from "../src/loopStore.ts";
import { IterationStore } from "../src/iterations.ts";
import { WorkerStore } from "../src/workerStore.ts";
import { CheckpointStore } from "../src/checkpoints.ts";
import { DirectionAuthorityStore, DirectionStore } from "../src/direction.ts";
import { claudeCodeProtocol } from "../src/claudeCodeWorker.ts";
import type { ChatDirector } from "../src/chatDirector.ts";

const say = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;
const green = (index: number, body?: string): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  ...(body ? { say: say(body) } : {})
});

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[], director?: ChatDirector | null) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-limit-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20, director: director ?? null });
  h.createRun();
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIterations: 6, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

// --- the pause --------------------------------------------------------------

test("hitting the usage limit pauses the run rather than failing it", async (t) => {
  const h = fixture(t, [{ workerFailure: "quota" }]);
  const outcome = await h.loop.run("loop-run");

  assert.equal(outcome.reason, "provider_limit");
  assert.match(outcome.detail, /no capacity left/);
  assert.match(outcome.detail, /session and authorization intact/);
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED", "PAUSED, not FAILED: nothing is broken");
});

test("a stale login is the same kind of event, and says what to do", async (t) => {
  const h = fixture(t, [{ workerFailure: "auth" }]);
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "provider_limit");
  assert.match(outcome.detail, /no longer logged in/);
  assert.match(outcome.detail, /Sign in again and resume/);
});

test("an ordinary broken turn is still an ordinary broken turn", async (t) => {
  // Only the two recoverable-by-waiting failures are named apart. A process
  // that died mid-turn is not something time fixes.
  const h = fixture(t, [{ workerFailure: "process" }]);
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "worker_failed");
});

test("the pause keeps everything the run needs to carry on", async (t) => {
  const h = fixture(t, [green(0, "decision: CONTINUE\nassignment: Do the second piece."), { workerFailure: "quota" }]);
  await h.loop.run("loop-run");

  // The authorization is still standing, so resuming is a resume and not a
  // fresh act of authorization.
  const grant = new LoopStore(h.ports).activeGrant("loop-run")!;
  assert.equal(grant.status, "ACTIVE");
  assert.equal(grant.iterationsUsed, 2, "the interrupted piece of work still counted");

  // The conversation survives: same session, still established, so the next
  // send resumes rather than starting a new one.
  const session = new WorkerStore(h.ports).session("loop-run")!;
  assert.equal(session.established, true);
  const intent = claudeCodeProtocol("C:/claude/claude.exe").prompt(session, "next");
  assert.ok(intent.args.includes("--resume"));

  // And the work that did land is still checkpointed.
  assert.equal(new CheckpointStore(h.ports).list("loop-run").length, 1);
});

test("the interrupted piece of work is abandoned, not recorded as a failure", async (t) => {
  const h = fixture(t, [{ workerFailure: "quota" }]);
  await h.loop.run("loop-run");
  const iteration = new IterationStore(h.ports).list("loop-run")[0]!;
  // FAILED would mean the work was attempted and found wanting. It was not
  // attempted at all.
  assert.equal(iteration.status, "ABANDONED");
  assert.match(iteration.summary ?? "", /no capacity left/);
  assert.equal(iteration.checkpointId, null);
});

// --- the resume -------------------------------------------------------------

test("resuming continues the same run, on the same session, with no re-authorization", async (t) => {
  const h = fixture(t, [
    green(0, "decision: CONTINUE\nassignment: Do the second piece."),
    { workerFailure: "quota" },
    green(1, "decision: NEEDS_HUMAN\nreason: stopping here for the test")
  ]);
  await h.loop.run("loop-run");
  assert.equal(new LoopStore(h.ports).turns("loop-run").length, 2);

  // The limit lifts. Nothing is re-authorized and nothing is re-created.
  const beforeSession = new WorkerStore(h.ports).session("loop-run")!.sessionId;
  // The retry is deliberate: a bare re-run would keep holding, because an
  // obstacle that is still there should not cost a turn to rediscover.
  assert.equal((await h.loop.run("loop-run")).reason, "consultant_recommended", "a bare re-run still holds");
  const resumed = await h.loop.run("loop-run", { retryProviderLimit: true });

  assert.equal(new WorkerStore(h.ports).session("loop-run")!.sessionId, beforeSession, "same conversation");
  assert.deepEqual(
    new IterationStore(h.ports).list("loop-run").map((entry) => entry.ordinal),
    [1, 2, 3],
    "the plan carries on rather than restarting"
  );
  assert.notEqual(resumed.reason, "grant_closed");
});

test("the failures that pause are exactly the ones known not to have been delivered", () => {
  // The invariant the whole pause rests on, asserted where it actually lives.
  //
  // Waiting out a limit and carrying on is only safe if the interrupted send
  // definitely never reached the provider. Both quota and auth are classified
  // CERTAIN by the adapter; a timeout is not, and a timeout must therefore
  // never be treated as something time will fix.
  const protocol = claudeCodeProtocol("C:/claude/claude.exe");
  const settle = (stderr: string) =>
    protocol.completion(
      { ok: false, stdout: "", stderr, detail: { failure: "process" } } as never,
      "11111111-2222-4333-8444-555555555555"
    );

  const quota = settle("Usage limit reached");
  assert.equal(quota.failure, "quota");
  assert.equal(quota.certain, true, "a quota refusal means the prompt was not acted on");

  const auth = settle("Authentication failed: not logged in");
  assert.equal(auth.failure, "auth");
  assert.equal(auth.certain, true);

  // A killed process is the case that must NOT auto-resume: the send may have
  // landed. It settles uncertain and waits for a person instead.
  const timedOut = protocol.completion(
    { ok: false, stdout: "", stderr: "", detail: { failure: "timeout" } } as never,
    "11111111-2222-4333-8444-555555555555"
  );
  assert.equal(timedOut.failure, "timeout");
  assert.equal(timedOut.certain, false);
});

// --- the director's own limit -----------------------------------------------

test("the chat running out of capacity pauses the run the same way", async (t) => {
  const director = {
    provider: "codex" as const,
    session: () => null,
    decide: async () => ({
      decision: {
        verb: "NEEDS_HUMAN" as const, assignment: null, planItemId: null,
        reason: "The director did not answer (quota).", issue: "The director did not answer (quota)."
      },
      failure: "quota" as const
    })
  } as unknown as ChatDirector;

  const h = fixture(t, [green(0)], director);
  new DirectionAuthorityStore(h.ports).switchTo({
    runId: "loop-run", source: "chat", reason: "the chat plans", changedBy: "akshat"
  });

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "provider_limit");
  assert.match(outcome.detail, /chat directing this run is unavailable \(quota\)/);
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED");

  // The work itself stood: it was verified and checkpointed before the chat
  // was ever asked what to do next.
  assert.equal(new IterationStore(h.ports).list("loop-run")[0]!.status, "VERIFIED");
  assert.equal(new CheckpointStore(h.ports).list("loop-run").length, 1);
  // And no decision was recorded from a chat that never answered.
  assert.deepEqual(new DirectionStore(h.ports).list("loop-run"), []);
});

test("a chat that wants a human is not the same as a chat that is out of capacity", async (t) => {
  const director = {
    provider: "codex" as const,
    session: () => null,
    decide: async () => ({
      decision: {
        verb: "NEEDS_HUMAN" as const, assignment: null, planItemId: null,
        reason: "Someone needs to choose a database.", issue: null
      },
      failure: null
    })
  } as unknown as ChatDirector;

  const h = fixture(t, [green(0)], director);
  new DirectionAuthorityStore(h.ports).switchTo({ runId: "loop-run", source: "chat", reason: "x", changedBy: "akshat" });

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "direction_needs_human");
  assert.match(outcome.detail, /choose a database/);
  // This one IS recorded: the chat answered, it just asked for a person.
  assert.equal(new DirectionStore(h.ports).list("loop-run")[0]!.verb, "NEEDS_HUMAN");
});
