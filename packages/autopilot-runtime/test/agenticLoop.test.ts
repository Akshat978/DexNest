// The loop, with a worker that has its own tools.
//
// The mediated loop exists to compensate for a worker that cannot touch the
// disk: it pastes source into every prompt, accepts whole files back as text,
// and spends a turn of the grant whenever the worker asks for a file it cannot
// open. None of that should survive contact with a worker that can just read
// and edit the project — and continuing to do it would be actively harmful,
// spending context on a stale copy of code the worker can open for itself.
//
// Real git, real SQLite, a real child process. The provider is a local fixture
// that writes files directly, which is how a tool-enabled worker behaves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { LoopStore } from "../src/loopStore.ts";
import { CheckpointStore } from "../src/checkpoints.ts";

/** No emitFiles: the fixture writes to the workspace itself, like a real agent. */
const WORKS_DIRECTLY: LoopPlanStep = { verify: { typecheck: 0 } };

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[], profile: "mediated" | "agentic") {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-agentic-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun({ workerProfile: profile });
  h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

const prompts = (h: ReturnType<typeof openLoop>) =>
  new LoopStore(h.ports).turns("loop-run").map((turn) => turn.prompt);

test("an agentic turn is not sent a copy of the workspace", async (t) => {
  const h = fixture(t, [WORKS_DIRECTLY], "agentic");
  await h.loop.run("loop-run");

  const prompt = prompts(h)[0]!;
  assert.ok(prompt.length > 0, "the goal still has to be stated");
  // The mediated prompt carries file contents and the whole-file emit protocol.
  // Neither belongs in front of a worker that can open the file itself.
  assert.equal(/DEXNEST_FILE/.test(prompt), false, "no whole-file emit protocol");
  assert.equal(/DEXNEST_REQUEST/.test(prompt), false, "no context-request protocol");
  assert.equal(prompt.includes("# loop workspace"), false, "no pasted README");
  assert.equal(prompt.includes("loop-fixture"), false, "no pasted package.json");
});

test("the same run in mediated mode still gets the workspace and the protocol", async (t) => {
  // The contrast is the point: this is the behaviour being switched off, not
  // deleted, and it must still work for runs that did not ask for tools.
  const h = fixture(t, [{ emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 0 } }], "mediated");
  await h.loop.run("loop-run");

  const prompt = prompts(h)[0]!;
  assert.ok(/DEXNEST_FILE/.test(prompt), "a tool-less worker needs the emit protocol");
  assert.ok(prompt.includes("# loop workspace"), "a tool-less worker needs the files pasted in");
});

test("work the agent did itself is verified and checkpointed, with nothing applied by DexNest", async (t) => {
  const h = fixture(t, [WORKS_DIRECTLY], "agentic");
  const outcome = await h.loop.run("loop-run");

  // The fixture wrote work-0.txt with its own hands.
  assert.ok(existsSync(resolve(h.worktree, "work-0.txt")), "the agent's own write must survive");
  assert.equal(readFileSync(resolve(h.worktree, "work-0.txt"), "utf8"), "turn 0\n");

  const events = h.store.listEvents("loop-run").map((event) => event.type);
  assert.equal(events.includes("WORKER_OUTPUT_APPLIED"), false, "DexNest must not claim to have written anything");
  assert.equal(events.includes("WORKER_OUTPUT_REJECTED"), false);
  assert.ok(events.includes("VERIFICATION_PASSED"), "the agent's work is judged the same way a human's would be");

  const checkpoints = new CheckpointStore(h.ports).list("loop-run");
  assert.equal(checkpoints.length, 1, "one verified turn, one checkpoint");
  assert.equal(checkpoints[0]!.status, "COMMITTED");
  assert.equal(outcome.reason, "completed");
});

test("an agentic turn never burns a turn asking for context", async (t) => {
  // A tool-enabled worker has no reason to ask, but if a prompt echoed the
  // request markers the loop must not treat them as a request and spend a turn
  // supplying files, which is the round-trip this phase exists to remove.
  const h = fixture(t, [{ requestFiles: ["README.md"], verify: { typecheck: 0 } }], "agentic");
  await h.loop.run("loop-run");

  const turns = new LoopStore(h.ports).turns("loop-run");
  assert.equal(turns.some((turn) => turn.status === "REQUESTED_CONTEXT"), false);
  const events = h.store.listEvents("loop-run").map((event) => event.type);
  assert.equal(events.includes("CONTEXT_REQUESTED"), false);
  assert.equal(events.includes("WORKSPACE_CONTEXT_READ"), false, "no workspace read on the agentic path");
});

test("one agentic turn does what mediated mode needed several to do", async (t) => {
  const h = fixture(t, [WORKS_DIRECTLY], "agentic");
  await h.loop.run("loop-run");
  assert.equal(new LoopStore(h.ports).turns("loop-run").length, 1);

  const grant = new LoopStore(h.ports).grants("loop-run")[0]!;
  assert.equal(grant.turnsUsed, 1, "no turn was spent on a round-trip");
});
