// Continuing a conversation you already had.
//
// The workflow: explain the job to Claude Code in the editor, where explaining
// is easy and you can see the answers, then hand that conversation to DexNest
// to carry on unattended. The session is genuinely shared — the editor panel
// and DexNest's CLI read and write the same transcript files — so this is
// adoption, not a copy.
//
// sessionAttach.test.ts already proves the store's rules and that the protocol
// asks for --resume. What was never proved is that any of it is REACHABLE: the
// discovery and attach machinery existed for three phases with nothing wired to
// it. So these tests go through the same facade the desktop calls, and then
// through the real loop, and look at the argv that actually reaches the CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";

const PRIMED = "aaaaaaaa-1111-4111-8111-111111111111";
const LIVE = "bbbbbbbb-2222-4222-8222-222222222222";

/** A transcript in the shape Claude Code actually writes. */
function transcript(input: { sessionId: string; cwd: string; entrypoint: string; title: string; last: string }): string {
  return [
    JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-09-04T09:00:00.000Z", sessionId: input.sessionId }),
    JSON.stringify({
      type: "user", message: { role: "user", content: "here is the job" }, timestamp: "2026-09-04T09:00:00.000Z",
      entrypoint: input.entrypoint, cwd: input.cwd, sessionId: input.sessionId, version: "2.1.261", gitBranch: "main"
    }),
    JSON.stringify({ type: "ai-title", aiTitle: input.title, sessionId: input.sessionId }),
    JSON.stringify({ type: "assistant", message: { role: "assistant" }, timestamp: input.last, sessionId: input.sessionId })
  ].join("\n") + "\n";
}

const step: LoopPlanStep = {
  emitFiles: [{ path: "file-0.txt", contents: "0\n" }],
  verify: { typecheck: 0 },
  say: "<<<DEXNEST_NEXT>>>\ndecision: PLAN_COMPLETE\nreason: done\n<<<END_DEXNEST_NEXT>>>"
};

function fixture(t: { after(fn: () => void): void }, options: { live?: boolean } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-adopt-"));
  const worktree = resolve(root, "worktree");
  initWorktree(worktree, [step], { typecheck: 1 });

  // A home directory in the shape SessionDiscovery expects to find one.
  const projects = resolve(root, "home", ".claude", "projects");
  // The directory name is a lossy encoding of the path and discovery must not
  // depend on it, so the fixture deliberately gets it wrong.
  mkdirSync(resolve(projects, "some--mangled--name"), { recursive: true });
  const write = (id: string, title: string, last: string, entrypoint = "claude-vscode") =>
    writeFileSync(
      resolve(projects, "some--mangled--name", `${id}.jsonl`),
      transcript({ sessionId: id, cwd: worktree, entrypoint, title, last }),
      "utf8"
    );

  // Liveness is measured against the runtime clock, which these fixtures start
  // at 2026-01-01. Yesterday's conversation is finished; a minute ago is not.
  write(PRIMED, "Notifications architecture", "2025-12-31T09:00:00.000Z");
  // Written to seconds ago, so someone is probably still typing into it.
  if (options.live) write(LIVE, "Still open in the editor", "2026-01-01T00:00:00.000Z");

  const h = openLoop(root, { env: { USERPROFILE: resolve(root, "home") } });
  h.createRun();
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

const claudeCalls = (h: ReturnType<typeof openLoop>) =>
  h.calls.filter(call => /claude/i.test(call.executable));

// --- reaching the machinery at all ------------------------------------------

test("the sessions in this project are offered to the run", (t) => {
  const h = fixture(t);
  const candidates = h.workers.sessionCandidates("loop-run");

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.session.sessionId, PRIMED);
  assert.equal(candidates[0]!.session.title, "Notifications architecture");
  assert.equal(candidates[0]!.session.origin, "vscode", "found from the transcript, not guessed");
  assert.equal(candidates[0]!.attachable, true);
  assert.equal(h.workers.attachedSession("loop-run"), null);
});

test("a session still being written to is offered, and refused, with its reason", (t) => {
  // Silently omitting it would be worse: someone hunting for the conversation
  // they just had would conclude DexNest cannot see it, rather than learning
  // they need to close the panel.
  const h = fixture(t, { live: true });
  const live = h.workers.sessionCandidates("loop-run").find(entry => entry.session.sessionId === LIVE);

  assert.ok(live, "the blocked session is listed, not hidden");
  assert.equal(live!.attachable, false);
  assert.deepEqual(live!.blockers, ["live"]);
  assert.throws(() => h.workers.attachSession({ runId: "loop-run", sessionId: LIVE }), /still open/);
});

test("an id the operator's screen is stale about is refused", (t) => {
  const h = fixture(t);
  assert.throws(
    () => h.workers.attachSession({ runId: "loop-run", sessionId: "cccccccc-3333-4333-8333-333333333333" }),
    /no longer among this project's transcripts/
  );
});

// --- and the thing it is all for --------------------------------------------

test("an adopted session is resumed by the real send path, not started fresh", async (t) => {
  const h = fixture(t);
  const record = h.workers.attachSession({ runId: "loop-run", sessionId: PRIMED });
  assert.equal(record.sessionId, PRIMED);
  assert.equal(record.origin, "vscode");
  assert.equal(record.title, "Notifications architecture");

  h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "human" });
  await h.loop.run("loop-run");

  // The whole phase in one assertion: the argv that reached the CLI resumes
  // the operator's conversation. Everything they already said still counts.
  const args = claudeCalls(h)[0]!.args;
  assert.ok(args.includes("--resume"), args.join(" "));
  assert.equal(args[args.indexOf("--resume") + 1], PRIMED);
  assert.equal(args.includes("--session-id"), false, "a new session would throw the conversation away");
});

test("a run left alone opens its own session", (t) => {
  // Adoption is an option, not the default. A run nobody primed must still
  // work, and must not silently inherit a stranger's conversation.
  const h = fixture(t);
  assert.equal(h.workers.attachedSession("loop-run"), null);
  assert.equal(h.workers.sessionCandidates("loop-run").every(entry => entry.attachable), true, "offered, not applied");
});

test("a second adoption is refused once the run has a session", (t) => {
  const h = fixture(t);
  h.workers.attachSession({ runId: "loop-run", sessionId: PRIMED });
  assert.equal(h.workers.attachedSession("loop-run")!.sessionId, PRIMED);
  assert.equal(
    h.workers.sessionCandidates("loop-run").every(entry => entry.blockers.includes("run_has_session")),
    true
  );
  assert.throws(() => h.workers.attachSession({ runId: "loop-run", sessionId: PRIMED }), /conversation has already started/);
});

test("the real sequence: create, authorize, THEN adopt, then run", async (t) => {
  // Exactly what happened on the first real attempt. Creating a run authorizes
  // the loop, authorizing creates the session the grant binds to, and the run
  // "had a session" before the operator ever saw the picker. Adoption must
  // replace that never-used placeholder and carry the grant with it.
  const h = fixture(t);
  h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "human" });

  const candidates = h.workers.sessionCandidates("loop-run");
  assert.equal(candidates[0]!.attachable, true, "a placeholder nothing spoke through does not block adoption");

  const record = h.workers.attachSession({ runId: "loop-run", sessionId: PRIMED });
  assert.equal(record.sessionId, PRIMED);

  await h.loop.run("loop-run");
  const args = claudeCalls(h)[0]!.args;
  assert.ok(args.includes("--resume"), args.join(" "));
  assert.equal(args[args.indexOf("--resume") + 1], PRIMED);
  assert.equal(args.includes("--session-id"), false);
});
