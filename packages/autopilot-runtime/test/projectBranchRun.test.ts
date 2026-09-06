// A project-branch run, driven through the real worker path.
//
// WHY THIS EXISTS
//
// Phase 2 built the branch machinery and tested it directly, and every later
// phase tested the loop — in worktree mode. Nothing ever drove a project-branch
// run through a worker, so two separate guards written for the worktree model
// went on refusing the mode outright:
//
//   validateRunWorkspace   "The primary checkout may never be used as an
//                           autonomous writable workspace"
//   DurableWorker.workspace "Worker may not use the primary checkout"
//
// Both are correct for the mode they were written for, and both read like a
// safety rule working properly, which is why neither was obvious. The mode had
// never once reached a model.
//
// So this test is deliberately end-to-end rather than a unit: it opens a run
// whose workspace IS its project and drives a turn all the way through the real
// worker, verification and checkpoint path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { LoopStore } from "../src/loopStore.ts";
import { IterationStore } from "../src/iterations.ts";
import { CheckpointStore } from "../src/checkpoints.ts";
import { WorkerStore } from "../src/workerStore.ts";

const GREEN: LoopPlanStep = { emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 0 } };

/** The project and the workspace are the same directory, as the mode intends. */
function fixture(t: { after(fn: () => void): void }, mode: "worktree" | "project-branch") {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-inproject-"));
  const project = resolve(root, "worktree");
  initWorktree(project, [GREEN], { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun({
    workspaceMode: mode,
    // Naming the project is what arms the guards; without it they never fire.
    projectPath: execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: project, encoding: "utf8" }).trim(),
    capabilities: {
      workspaceRoot: project, allowedPaths: [project], forbiddenPaths: ["local-data"],
      allowedCommands: ["claude", "node", "git status"], forbiddenCommands: [], requiresApproval: []
    }
  });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

test("a project-branch run reaches a worker and completes a piece of work", async (t) => {
  const h = fixture(t, "project-branch");
  h.loop.authorize({ runId: "loop-run", maxTurns: 5, maxIterations: 2, grantedBy: "human" });

  // Before the fix this threw out of authorize() or the first turn, so the run
  // never produced a turn at all.
  const outcome = await h.loop.run("loop-run");

  assert.equal(outcome.reason, "completed", outcome.detail);
  assert.equal(new LoopStore(h.ports).turns("loop-run").length, 1);
  assert.equal(new IterationStore(h.ports).list("loop-run")[0]!.status, "VERIFIED");
  assert.equal(new CheckpointStore(h.ports).list("loop-run").length, 1, "verified work is committed");

  // The session really is bound to the project directory, not somewhere else.
  const session = new WorkerStore(h.ports).session("loop-run")!;
  assert.equal(session.cwd, h.worktree);
});

test("a worktree run is still refused from using the project as its workspace", (t) => {
  // The guard the project-branch mode steps around must still hold for the mode
  // it was written for, or the isolation it provides is gone with it.
  const h = fixture(t, "worktree");
  assert.throws(
    () => h.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "human" }),
    /primary checkout/
  );
});
