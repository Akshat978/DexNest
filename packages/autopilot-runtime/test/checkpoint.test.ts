// Known-good checkpoints and the durable run report.
//
// Real git, real SQLite, real child processes. Only the worker CLI and the
// verification commands are local fixtures, so no model is contacted.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertSafeDataRoot } from "./helpers/harness.ts";
import { initWorktree, openLoop, VERIFY_FIXTURE, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";
import { checkpointMarker } from "../src/checkpoints.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // An isolated temp directory outliving a test must not fail it.
    }
  }
});

function workspace(plan: LoopPlanStep[], verifyState: Record<string, number> = {}): string {
  const root = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-ckpt-")));
  dirs.push(root);
  initWorktree(resolve(root, "worktree"), plan, verifyState);
  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

/** Commits reachable from HEAD, newest first. */
function log(worktree: string): string[] {
  return git(worktree, ["log", "--format=%H %s"]).split("\n").filter(Boolean);
}

/** A run that fails once then passes: two turns, one checkpoint. */
async function completedRun() {
  const root = workspace([{ verify: { typecheck: 1 } }, { verify: { typecheck: 0 } }], { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 9 });
  h.createRun();
  const grant = h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
  const outcome = await h.loop.run("loop-run");
  return { root, h, grant, outcome };
}

describe("checkpoint creation", () => {
  test("a green verification creates exactly one checkpoint commit", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root);
    const before = log(h.worktree).length;

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");
    assert.equal(outcome.reason, "completed");

    const checkpoints = h.loop.checkpoints.store.list("loop-run");
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]!.status, "COMMITTED");
    assert.match(checkpoints[0]!.commitSha!, /^[0-9a-f]{40}$/);

    const after = log(h.worktree);
    assert.equal(after.length, before + 1, "exactly one new commit");
    assert.match(after[0]!, /DexNest Autopilot checkpoint: turn 1/);
    assert.ok(after[0]!.startsWith(checkpoints[0]!.commitSha!), "the recorded SHA is the real commit");

    // The commit message carries the marker used for crash recovery.
    const body = git(h.worktree, ["log", "-1", "--format=%B"]);
    assert.match(body, new RegExp(checkpointMarker(h.loop.loops.turns("loop-run")[0]!.id)));
    h.close();
  });

  test("a failed verification creates no checkpoint", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    const h = openLoop(root, { maxConsecutiveFailures: 1 });
    const before = log(h.worktree).length;

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "consecutive_failures");
    assert.deepEqual(h.loop.checkpoints.store.list("loop-run"), [], "a failing tree is never known-good");
    assert.equal(log(h.worktree).length, before, "no commit was created");
    h.close();
  });

  test("an indeterminate verification creates no checkpoint", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root, {
      acceptance: [
        { id: "ac-1", text: "typecheck passes", kind: "automated", check: `node ${VERIFY_FIXTURE} typecheck` },
        { id: "ac-2", text: "looks right", kind: "judgment" }
      ]
    });
    const before = log(h.worktree).length;

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "verification_indeterminate");
    assert.deepEqual(h.loop.checkpoints.store.list("loop-run"), []);
    assert.equal(log(h.worktree).length, before);
    h.close();
  });

  test("a green turn that changed nothing records the fact instead of an empty commit", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root);
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });

    // Commit everything first, so the worker's write is the only change; then
    // remove it so the tree is genuinely clean at checkpoint time.
    git(h.worktree, ["add", "--all"]);
    git(h.worktree, ["commit", "-m", "baseline"]);
    const before = log(h.worktree).length;
    const head = git(h.worktree, ["rev-parse", "HEAD"]);

    const turn = h.loop.loops.planTurn({
      runId: "loop-run",
      grantId: h.loop.loops.activeGrant("loop-run")!.id,
      kind: "INITIAL",
      prompt: "no-op"
    });
    const checkpoint = await h.loop.checkpoints.checkpoint({
      runId: "loop-run",
      turnId: turn.id,
      ordinal: turn.ordinal,
      verificationId: null,
      summary: "all checks passed",
      workspaceRoot: h.worktree
    });

    assert.equal(checkpoint.status, "NO_CHANGES");
    assert.equal(checkpoint.commitSha, head, "the existing HEAD is the known-good state");
    assert.match(checkpoint.detail!, /no commit was needed/);
    assert.equal(log(h.worktree).length, before, "no empty commit was created");
    h.close();
  });

  test("multiple green turns produce ordered checkpoints", async () => {
    // Fail, then pass twice: two green turns across two separate loop runs.
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root, { maxConsecutiveFailures: 9 });
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });

    const grantId = h.loop.loops.activeGrant("loop-run")!.id;
    const shas: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      writeFileSync(resolve(h.worktree, `change-${index}.txt`), `change ${index}\n`, "utf8");
      const turn = h.loop.loops.planTurn({ runId: "loop-run", grantId, kind: index === 0 ? "INITIAL" : "REPAIR", prompt: `turn ${index}` });
      h.loop.loops.updateTurn({ turnId: turn.id, status: "VERIFIED" });
      const checkpoint = await h.loop.checkpoints.checkpoint({
        runId: "loop-run", turnId: turn.id, ordinal: turn.ordinal,
        verificationId: null, summary: "green", workspaceRoot: h.worktree
      });
      assert.equal(checkpoint.status, "COMMITTED", `turn ${index}`);
      shas.push(checkpoint.commitSha!);
    }

    assert.equal(new Set(shas).size, 3, "three distinct commits");
    const history = log(h.worktree);
    // Newest first, so the recorded order is the reverse of the log order.
    assert.deepEqual(history.slice(0, 3).map((line) => line.split(" ")[0]), [...shas].reverse());

    const recorded = h.loop.checkpoints.store.list("loop-run");
    assert.deepEqual(recorded.map((entry) => entry.commitSha), shas, "checkpoints are stored in turn order");
    h.close();
  });
});

describe("checkpoint crash reconciliation", () => {
  test("a commit made before the SHA was recorded is reconciled, not repeated", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root);
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });

    const turn = h.loop.loops.planTurn({
      runId: "loop-run",
      grantId: h.loop.loops.activeGrant("loop-run")!.id,
      kind: "INITIAL",
      prompt: "work"
    });

    // Journal the intent, then simulate the crash window: the commit happens,
    // but the process dies before the SHA is written back.
    const intent = h.loop.checkpoints.store.recordIntent({
      runId: "loop-run", turnId: turn.id, ordinal: turn.ordinal,
      verificationId: null, summary: "green", headBefore: git(h.worktree, ["rev-parse", "HEAD"])
    });
    assert.equal(intent.status, "INTENT");
    assert.equal(intent.commitSha, null);

    writeFileSync(resolve(h.worktree, "orphan.txt"), "committed but unrecorded\n", "utf8");
    git(h.worktree, ["add", "--all"]);
    git(h.worktree, ["commit", "-m", intent.message]);
    const orphanSha = git(h.worktree, ["rev-parse", "HEAD"]);
    const commitsAfterCrash = log(h.worktree).length;

    // Restart: a fresh runtime against the same database and worktree.
    const restarted = openLoop(root, { instance: 2 });
    const recovered = await restarted.loop.checkpoints.checkpoint({
      runId: "loop-run", turnId: turn.id, ordinal: turn.ordinal,
      verificationId: null, summary: "green", workspaceRoot: restarted.worktree
    });

    assert.equal(recovered.status, "COMMITTED");
    assert.equal(recovered.commitSha, orphanSha, "reconciled to the commit that already existed");
    assert.match(recovered.detail!, /Recovered an existing checkpoint commit/);
    assert.equal(log(restarted.worktree).length, commitsAfterCrash, "nothing was committed again");

    const events = restarted.engine.snapshot("loop-run").events.map((event) => event.type);
    assert.ok(events.includes("CHECKPOINT_RECOVERED"), "recovery is journalled distinctly");
    h.close();
    restarted.close();
  });

  test("repeated restarts never duplicate a checkpoint commit", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const first = openLoop(root);
    first.createRun();
    first.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const turn = first.loop.loops.planTurn({
      runId: "loop-run", grantId: first.loop.loops.activeGrant("loop-run")!.id, kind: "INITIAL", prompt: "work"
    });
    writeFileSync(resolve(first.worktree, "work.txt"), "content\n", "utf8");
    const created = await first.loop.checkpoints.checkpoint({
      runId: "loop-run", turnId: turn.id, ordinal: turn.ordinal,
      verificationId: null, summary: "green", workspaceRoot: first.worktree
    });
    assert.equal(created.status, "COMMITTED");
    const commits = log(first.worktree).length;
    first.close();

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      const restarted = openLoop(root, { instance: attempt });
      const again = await restarted.loop.checkpoints.checkpoint({
        runId: "loop-run", turnId: turn.id, ordinal: turn.ordinal,
        verificationId: null, summary: "green", workspaceRoot: restarted.worktree
      });
      assert.equal(again.commitSha, created.commitSha, `attempt ${attempt} returns the same commit`);
      assert.equal(log(restarted.worktree).length, commits, `attempt ${attempt} created no commit`);
      assert.equal(restarted.loop.checkpoints.store.list("loop-run").length, 1, "still one checkpoint record");
      restarted.close();
    }
  });

  test("the primary checkout is never touched by a checkpoint", async () => {
    // A real primary repository with the run's worktree registered to it.
    const root = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-ckpt-primary-")));
    dirs.push(root);
    const primary = resolve(root, "primary");
    execFileSync("git", ["init", "-b", "main", primary], { encoding: "utf8", windowsHide: true });
    git(primary, ["config", "user.email", "primary@example.invalid"]);
    git(primary, ["config", "user.name", "Primary"]);
    writeFileSync(resolve(primary, "README.md"), "# primary\n", "utf8");
    git(primary, ["add", "."]);
    git(primary, ["commit", "-m", "initial"]);

    const worktree = resolve(root, "worktree");
    git(primary, ["worktree", "add", "-b", "autopilot/run", worktree, "HEAD"]);
    writeFileSync(resolve(worktree, ".loop-plan.json"), JSON.stringify([{ verify: { typecheck: 0 } }]), "utf8");
    writeFileSync(resolve(worktree, ".verify-state.json"), JSON.stringify({ typecheck: 0 }), "utf8");

    const primaryHeadBefore = git(primary, ["rev-parse", "HEAD"]);
    const primaryStatusBefore = git(primary, ["status", "--porcelain"]);

    const h = openLoop(root);
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");
    assert.equal(outcome.reason, "completed");
    assert.equal(h.loop.checkpoints.store.list("loop-run")[0]!.status, "COMMITTED");

    assert.equal(git(primary, ["rev-parse", "HEAD"]), primaryHeadBefore, "the primary HEAD did not move");
    assert.equal(git(primary, ["status", "--porcelain"]), primaryStatusBefore, "the primary checkout stayed clean");
    assert.equal(existsSync(resolve(primary, "work-0.txt")), false, "no worker file appeared in the primary checkout");
    h.close();
  });
});

describe("run report", () => {
  test("the report captures turns, verification, approvals, checkpoints and final state", async () => {
    const { h, grant, outcome } = await completedRun();
    assert.equal(outcome.reason, "completed");

    const report = h.loop.report("loop-run");

    assert.equal(report.outcome.classification, "completed");
    assert.equal(report.run.state, "COMPLETED");
    assert.equal(report.spec.goal, "Make the failing check pass");
    assert.equal(report.provider.id, "claude");
    assert.equal(report.provider.sticky, true);
    assert.ok(report.provider.sessionId, "the worker session id is recorded");
    assert.ok(report.provider.workspaceRoot, "the worktree is recorded");

    // Grant and budget.
    assert.equal(report.loop.grants.length, 1);
    assert.equal(report.loop.grants[0]!.id, grant.id);
    assert.equal(report.loop.grants[0]!.maxTurns, 5);
    assert.equal(report.loop.grants[0]!.turnsUsed, 2);

    // Every turn, with its verification.
    assert.equal(report.loop.turns.length, 2);
    assert.deepEqual(report.loop.turns.map((turn) => turn.verification?.outcome), ["FAILED", "PASSED"]);
    assert.ok(report.loop.turns[0]!.verification!.tiers.some((tier) => tier.tier === "typecheck"));
    assert.ok(report.loop.turns[0]!.promptLength > 0);

    // Checkpoints: only the green turn has one.
    assert.equal(report.loop.turns[0]!.checkpoint, null);
    assert.equal(report.loop.turns[1]!.checkpoint!.status, "COMMITTED");
    assert.equal(report.checkpoints.length, 1);
    assert.match(report.checkpoints[0]!.commitSha!, /^[0-9a-f]{40}$/);

    // Acceptance criteria.
    assert.deepEqual(report.acceptanceCriteria.map((criterion) => criterion.status), ["passed"]);

    // Approvals: one per turn, resolved by the loop grant, so no human
    // intervention is counted for them.
    assert.equal(report.humanActions.approvals.length, 2);
    for (const approval of report.humanActions.approvals) {
      assert.equal(approval.resolutionSource, `loop_grant:${grant.id}`);
    }
    assert.equal(report.humanActions.interventionCount, 0);

    // Final workspace evidence, captured durably rather than by running git now.
    assert.ok(report.workspace.headSha, "HEAD was captured");
    assert.ok(report.workspace.capturedAt);
    assert.ok(report.eventCount > 0);
    h.close();
  });

  test("the report reconstructs identically from a fresh runtime after restart", async () => {
    const { root, h } = await completedRun();
    const before = h.loop.report("loop-run");
    h.close();

    const restarted = openLoop(root, { instance: 2 });
    const after = buildRunReport(restarted.ports, "loop-run");

    // generatedAt legitimately differs; everything else is durable evidence.
    assert.deepEqual({ ...after, generatedAt: "" }, { ...before, generatedAt: "" });
    assert.equal(after.checkpoints[0]!.commitSha, before.checkpoints[0]!.commitSha);
    assert.equal(after.loop.turns.length, before.loop.turns.length);
    restarted.close();
  });

  test("a stopped run still produces a reviewable report", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    const stops: Promise<unknown>[] = [];
    const h = openLoop(root, {
      maxConsecutiveFailures: 99,
      beforeProcess: (input) => {
        if (/node(?:\.exe)?$/i.test(input.executable) && stops.length === 0) {
          stops.push(h.engine.requestStop("loop-run").catch(() => undefined));
        }
      }
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    await h.loop.run("loop-run");
    await Promise.all(stops);

    const report = h.loop.report("loop-run");
    assert.ok(["stopped", "needs_review", "in_progress"].includes(report.outcome.classification), report.outcome.classification);
    assert.equal(report.loop.turns.length, 1, "the turn that ran is still described");
    assert.ok(report.outcome.reason.length > 0);
    assert.deepEqual(report.checkpoints, [], "a stopped run has no checkpoint");

    const markdown = renderRunReportMarkdown(report);
    assert.match(markdown, /# Autopilot run report/);
    assert.match(markdown, /## Turns/);
    h.close();
  });

  test("a failed run reports its failure reason", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    const h = openLoop(root, { maxConsecutiveFailures: 1 });
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    const report = h.loop.report("loop-run");
    assert.match(report.outcome.reason, /consecutive verification failures|Verification failed/i);
    assert.equal(report.loop.turns[0]!.verification!.outcome, "FAILED");
    assert.deepEqual(report.checkpoints, []);
    h.close();
  });

  test("markdown rendering contains the evidence a reviewer needs", async () => {
    const { h } = await completedRun();
    const markdown = renderRunReportMarkdown(h.loop.report("loop-run"));

    for (const heading of ["## Goal", "## Worker", "## Authorization", "## Turns", "## Acceptance criteria", "## Checkpoints", "## Final workspace", "## Human involvement", "## Blocked operations"]) {
      assert.ok(markdown.includes(heading), `missing ${heading}`);
    }
    assert.match(markdown, /COMPLETED/);
    assert.match(markdown, /typecheck/);
    // Prompt and provider transcripts must not be reproduced in the report.
    assert.ok(!markdown.includes("Applied turn"), "provider output is not copied into the report");
    h.close();
  });
});

describe("report export", () => {
  test("exports JSON and Markdown into the run's artifacts directory", async () => {
    const { root, h } = await completedRun();
    const artifacts = `${h.worktree}-autopilot-artifacts`;
    h.policy.scratchRoot = artifacts;

    const result = await h.loop.exportReport({ runId: "loop-run", directory: artifacts });

    assert.deepEqual(result.refused, [], "policy permitted both artifacts");
    assert.equal(result.written.length, 2);

    const jsonPath = resolve(artifacts, "autopilot-report-loop-run.json");
    const markdownPath = resolve(artifacts, "autopilot-report-loop-run.md");
    assert.ok(existsSync(jsonPath));
    assert.ok(existsSync(markdownPath));

    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    assert.equal(parsed.run.id, "loop-run");
    assert.equal(parsed.checkpoints.length, 1);
    assert.match(readFileSync(markdownPath, "utf8"), /# Autopilot run report/);

    // The export lives outside the worktree, so it is not a source change and
    // cannot be swept into a checkpoint.
    assert.equal(git(h.worktree, ["status", "--porcelain"]).includes("autopilot-report"), false);
    void root;
    h.close();
  });

  test("an export outside the permitted roots is refused, not written", async () => {
    const { root, h } = await completedRun();
    const forbidden = resolve(root, "not-authorized");

    const result = await h.loop.exportReport({ runId: "loop-run", directory: forbidden });

    assert.deepEqual(result.written, [], "nothing was written");
    assert.equal(result.refused.length, 2);
    assert.equal(existsSync(resolve(forbidden, "autopilot-report-loop-run.json")), false);
    h.close();
  });
});
