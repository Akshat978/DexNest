// A fresh conversation for each piece of work.
//
// One session resumed across a whole run means every model call carries every
// phase before it. Measured on a real 22-phase night: context per call grew
// from 12k tokens to 165k — 11.7M input tokens across 144 calls, climbing
// almost perfectly linearly. That is what paying for your own history looks
// like, and it is what this removes.
//
// The digest is what makes it safe. Phase 15 already receives a readable
// account of 1-14, the code is on disk, and the conventions are in the repo.
// What a new conversation loses is the transcript, which is the expensive part
// and the part the digest was built to replace.
//
// The tests here look at the argv that actually reaches the CLI, because
// "--resume <old>" versus "--session-id <new>" is the entire behaviour and
// nothing above that layer can tell the difference.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { LoopStore } from "../src/loopStore.ts";
import { WorkerStore } from "../src/workerStore.ts";

const say = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;
const CONTINUE = say("decision: CONTINUE\nassignment: Do the next piece.");
const COMPLETE = say("decision: PLAN_COMPLETE\nreason: done");

const green = (index: number, tail: string): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  say: tail
});
const red = (index: number): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 1 }
});

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[]) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-rotate-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun();
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

/** How each send identified itself to the CLI. */
const identities = (h: ReturnType<typeof openLoop>) =>
  h.calls
    .filter(call => /claude/i.test(call.executable) && call.args.includes("--print"))
    .map(call => {
      const resume = call.args.indexOf("--resume");
      const fresh = call.args.indexOf("--session-id");
      return resume >= 0
        ? { how: "resume" as const, sessionId: call.args[resume + 1]! }
        : { how: "new" as const, sessionId: call.args[fresh + 1]! };
    });

// --- the change -------------------------------------------------------------

test("each verified piece of work starts the next one in a fresh conversation", async (t) => {
  const h = fixture(t, [green(0, CONTINUE), green(1, CONTINUE), green(2, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 6, grantedBy: "human" });
  await h.loop.run("loop-run");

  const sends = identities(h);
  assert.equal(sends.length, 3, `expected three sends, got ${sends.length}`);

  const ids = new Set(sends.map(send => send.sessionId));
  assert.equal(ids.size, 3, "three phases, three conversations");
  // Each later phase opens its own rather than resuming the one before it.
  assert.deepEqual(sends.map(send => send.how), ["new", "new", "new"]);
});

test("the grant follows the session it authorized", async (t) => {
  // Left pointing at a retired conversation, the journal would record an
  // authorization for something that no longer exists.
  const h = fixture(t, [green(0, CONTINUE), green(1, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 4, grantedBy: "human" });
  await h.loop.run("loop-run");

  const grant = new LoopStore(h.ports).activeGrant("loop-run")!;
  const session = new WorkerStore(h.ports).session("loop-run")!;
  assert.equal(grant.sessionId, session.sessionId);
  assert.equal(session.sessionId, identities(h).at(-1)!.sessionId, "and both are the one that ran");
});

test("rotation is journalled, so a night can be read back", async (t) => {
  const h = fixture(t, [green(0, CONTINUE), green(1, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 4, grantedBy: "human" });
  await h.loop.run("loop-run");

  const rotated = h.store.listEvents("loop-run").filter(event => event.type === "WORKER_SESSION_ROTATED");
  assert.equal(rotated.length, 1, "one rotation, after the one verified phase that continued");
});

// --- and where it must not happen -------------------------------------------

test("a repair keeps its conversation, because repairing needs the failure in it", async (t) => {
  // The invariant this change had to respect. A repair turn is the SAME piece
  // of work; handing it a fresh conversation would mean asking it to fix a
  // failure it has never seen.
  const h = fixture(t, [red(0), green(1, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 4, grantedBy: "human" });
  await h.loop.run("loop-run");

  const sends = identities(h);
  assert.equal(sends.length, 2);
  assert.equal(sends[0]!.sessionId, sends[1]!.sessionId, "the repair stayed put");
  assert.equal(sends[1]!.how, "resume", "and resumed rather than starting over");
  assert.equal(
    h.store.listEvents("loop-run").filter(event => event.type === "WORKER_SESSION_ROTATED").length,
    0
  );
});

test("a run that opts out keeps one conversation throughout", async (t) => {
  const h = fixture(t, [green(0, CONTINUE), green(1, CONTINUE), green(2, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 6, grantedBy: "human", rotateSession: false });
  await h.loop.run("loop-run");

  const sends = identities(h);
  assert.equal(new Set(sends.map(send => send.sessionId)).size, 1, "one conversation for the whole run");
  assert.deepEqual(sends.slice(1).map(send => send.how), ["resume", "resume"]);
});

test("rotation is the default, so a run nobody configured gets the cheap behaviour", (t) => {
  const h = fixture(t, [green(0, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "human" });
  assert.equal(new LoopStore(h.ports).activeGrant("loop-run")!.rotateSession, true);
});

// --- what carries across ----------------------------------------------------

test("the new conversation is told what the old one did", async (t) => {
  // Rotation is only safe because the digest replaces the transcript. If a
  // fresh phase arrived with no account of what came before, it would redo
  // finished work — which is precisely what the digest exists to prevent.
  const h = fixture(t, [green(0, CONTINUE), green(1, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 4, grantedBy: "human" });
  await h.loop.run("loop-run");

  const prompts = new LoopStore(h.ports).turns("loop-run").map(turn => turn.prompt);
  assert.equal(prompts[0]!.includes("WHAT HAS ALREADY BEEN DONE"), false, "nothing had been done yet");
  assert.ok(prompts[1]!.includes("WHAT HAS ALREADY BEEN DONE"), prompts[1]);
  assert.ok(prompts[1]!.includes("1. [done]"), "and it says what, not just that something was");
});
