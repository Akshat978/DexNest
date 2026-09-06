import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openLoop, initWorktree } from "./helpers/loopHarness.ts";
import { evaluatePrimaryProgress, latestPrimaryProgress } from "../src/progress.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";

function setup(t: { after(fn: () => void): void }, requests = false, consultant = true) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-progress-"));
  initWorktree(resolve(root, "worktree"), [{ emitFiles: [], ...(requests ? { requestFiles: ["README.md"] } : {}) }], { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun({ workers: { primary: "claude", consultant: consultant ? "codex" : null, sticky: true, fallback: null, consultantMode: false } });
  h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "human" });
  t.after(() => { try { h.close(); } catch {} rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { h, root };
}
for (const consultant of [true, false]) test("equivalent failures hold without another turn; consultant=" + consultant, async t => {
  const { h, root } = setup(t, false, consultant);
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "consultant_recommended");
  assert.equal(outcome.turnsRun, 4);
  const report = buildRunReport(h.ports, "loop-run");
  assert.equal(report.primaryProgress?.status, "STALLED");
  assert.equal(report.primaryProgress?.consecutiveStalled, 3);
  assert.equal(report.roles.consultant.sessionId, null);
  assert.equal(report.roles.consultant.established, false);
  assert.match(renderRunReportMarkdown(report), /equivalent_verification_without_change/);
  assert.ok(report.activity.some(a => a.label.includes("STALLED")));
  const before = h.loop.loops.activeGrant("loop-run")!.turnsUsed;
  h.close();
  const restarted = openLoop(root, { instance: 2, maxConsecutiveFailures: 20 });
  try {
    assert.deepEqual(buildRunReport(restarted.ports, "loop-run").primaryProgress, report.primaryProgress);
    assert.equal((await restarted.loop.run("loop-run")).turnsRun, 0);
    assert.equal(restarted.loop.loops.activeGrant("loop-run")!.turnsUsed, before);
    assert.equal(restarted.worker.sessions.session("loop-run")?.provider, "claude");
  } finally { restarted.close(); }
});
test("repeated identical context requests contribute and hold", async t => {
  const { h } = setup(t, true);
  await h.loop.run("loop-run");
  const decision = latestPrimaryProgress(h.ports, "loop-run")!;
  assert.equal(decision.status, "STALLED");
  assert.equal(decision.reason, "repeated_context_requests_without_change");
  assert.ok(decision.requestFingerprint);
  assert.equal(h.loop.loops.verifications("loop-run").length, 0);
});
for (const failure of ["quota", "auth", "policy"]) test(failure + " obstacle is durable and classified", t => {
  const { h } = setup(t);
  const decision = evaluatePrimaryProgress(h.ports, "loop-run", failure)!;
  assert.equal(decision.status, "BLOCKED");
  assert.equal(decision.consultantRecommended, failure !== "policy");
  assert.equal(decision.reason, "terminal_obstacle:" + failure);
  assert.deepEqual(evaluatePrimaryProgress(h.ports, "loop-run"), decision);
  assert.equal(h.worker.sessions.session("loop-run")!.established, false);
});
test("first failure, changed failure, and changed workspace reset comparison count", t => {
  const { h } = setup(t);
  const grant = h.loop.loops.activeGrant("loop-run")!;
  function evidence(detail: string, diff: string) {
    const turn = h.loop.loops.planTurn({ runId: "loop-run", grantId: grant.id, kind: "REPAIR", prompt: "private prompt sentinel" });
    const tier = { tier: "test", command: "node test.js", ran: true, ok: false, exitCode: 1, detail, gating: true };
    h.loop.loops.recordVerification({ runId: "loop-run", turnId: turn.id, report: { outcome: "FAILED", summary: "failed", tiers: [tier], failingTier: tier, configurationError: null, indeterminateReason: null, changedFiles: 1 } });
    h.loop.loops.updateTurn({ turnId: turn.id, status: "FAILED_VERIFICATION" });
    h.loop.checkpoints.store.recordSnapshot({ runId: "loop-run", turnId: turn.id, reason: "test", headSha: "abc", statusText: "M test.js", diffStat: diff, changedFiles: 1 });
    return evaluatePrimaryProgress(h.ports, "loop-run")!;
  }
  assert.equal(evidence("expected 1 received 2", "1 insertion").status, "PROGRESSING");
  assert.equal(evidence("expected 1 received 2", "1 insertion").consecutiveStalled, 1);
  assert.equal(evidence("expected 1 received 3", "1 insertion").consecutiveStalled, 0);
  assert.equal(evidence("expected 1 received 3", "2 insertions").consecutiveStalled, 0);
  assert.doesNotMatch(renderRunReportMarkdown(buildRunReport(h.ports, "loop-run")), /private prompt sentinel/);
});

test("real durable send quota failure blocks the loop with provider evidence intact", async t => {
  const { h } = setup(t);
  writeFileSync(resolve(h.worktree, ".loop-plan.json"), JSON.stringify([{ emitFiles: [], workerFailure: "quota" }]));
  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.turnsRun, 1);
  const decision = latestPrimaryProgress(h.ports, "loop-run")!;
  assert.equal(decision.status, "BLOCKED");
  assert.equal(decision.reason, "terminal_obstacle:quota");
  assert.equal(h.worker.sessions.list("loop-run")[0]!.result!.failure, "quota");
  assert.equal((await h.loop.run("loop-run")).turnsRun, 0);
});
