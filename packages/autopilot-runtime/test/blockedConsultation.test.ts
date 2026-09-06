// The BLOCKED route into a consultation.
//
// A consultation can be recommended two ways: PRIMARY plateaus (STALLED), or
// PRIMARY hits a terminal provider obstacle (BLOCKED). The STALLED route is
// covered by consultantExecution.test.ts; this file covers BLOCKED, which had
// no end-to-end coverage — the loop's terminal-failure branch reaches
// evaluatePrimaryProgress by a different path, and nothing proved that the
// recommendation, the hold and the retry behaved the same way there.
//
// Real SQLite, a real git worktree, real child processes, the real policy and
// dispatcher. The worker CLI is a local fixture, so no model is contacted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { ConsultationStore } from "../src/consultations.ts";
import { ConsultantStore } from "../src/consultant.ts";
import { WorkerDiagnosticsStore } from "../src/diagnostics.ts";
import { latestPrimaryProgress } from "../src/progress.ts";
import { buildRunReport } from "../src/report.ts";
import { LoopStore } from "../src/loopStore.ts";

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[]) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-blocked-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  let h = openLoop(root, { maxConsecutiveFailures: 10 });
  h.createRun({ workers: { primary: "claude", consultant: "codex", sticky: true, fallback: null, consultantMode: false } });
  h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  let instance = 1;
  return {
    root,
    get h() { return h; },
    restart() { h.close(); h = openLoop(root, { instance: ++instance, maxConsecutiveFailures: 10 }); return h; },
    prompts: (): string[] => {
      const file = resolve(root, "worktree", ".loop-dispatches.json");
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Array<{ prompt: string }>).map(d => d.prompt) : [];
    }
  };
}

for (const [failure, category] of [["quota", "quota"], ["auth", "auth"], ["session", "session"]] as const) {
  test(`a terminal ${failure} failure blocks PRIMARY and recommends a consultant`, async t => {
    const f = fixture(t, [{ workerFailure: failure }]);
    const outcome = await f.h.loop.run("loop-run");

    // Losing subscription capacity or a login is named apart from a broken
    // turn: nothing is wrong with the work, the run has simply lost the
    // ability to continue for now.
    const expected = failure === "session" ? "worker_failed" : "provider_limit";
    assert.equal(outcome.reason, expected, outcome.detail);
    const progress = latestPrimaryProgress(f.h.ports, "loop-run")!;
    assert.equal(progress.status, "BLOCKED");
    assert.equal(progress.reason, `terminal_obstacle:${category}`);
    assert.equal(progress.consultantRecommended, true);

    // Exactly one recommendation, and nothing of the consultant has started.
    const consultations = new ConsultationStore(f.h.ports).list("loop-run");
    assert.equal(consultations.length, 1);
    assert.equal(consultations[0]!.status, "RECOMMENDED");
    assert.equal(consultations[0]!.consultantProvider, "codex");
    assert.equal(consultations[0]!.triggerType, "BLOCKED");
    assert.equal(consultations[0]!.executionEligible, false);
    assert.deepEqual(new ConsultantStore(f.h.ports).sessions("loop-run"), []);

    // The failed turn cost one grant turn and no further PRIMARY turn was spent.
    // The authorization survives either way, so resuming is a resume.
    assert.equal(new LoopStore(f.h.ports).activeGrant("loop-run")!.turnsUsed, 1);
    assert.equal(new LoopStore(f.h.ports).activeGrant("loop-run")!.status, "ACTIVE");
    assert.equal(f.prompts().length, 1);

    // The obstacle is durable: re-running holds instead of retrying blindly.
    const again = await f.h.loop.run("loop-run");
    assert.equal(again.reason, "consultant_recommended");
    assert.equal(f.prompts().length, 1, "a held run consumes no further PRIMARY turn");
  });
}

test("an unclassified provider failure blocks without recommending a consultant", async t => {
  const f = fixture(t, [{ workerFailure: "process" }]);
  await f.h.loop.run("loop-run");

  const progress = latestPrimaryProgress(f.h.ports, "loop-run")!;
  assert.equal(progress.status, "BLOCKED");
  assert.equal(progress.reason, "terminal_obstacle:process");
  // A second opinion is only offered where it could plausibly help. An
  // unrecognized process failure is not over-classified into one.
  assert.equal(progress.consultantRecommended, false);
  assert.deepEqual(new ConsultationStore(f.h.ports).list("loop-run"), []);
});

test("the failing PRIMARY call is inspectable through durable diagnostics", async t => {
  const f = fixture(t, [{ workerFailure: "quota" }]);
  await f.h.loop.run("loop-run");

  const [diagnostic, ...rest] = new WorkerDiagnosticsStore(f.h.ports).list("loop-run");
  assert.equal(rest.length, 0);
  assert.equal(diagnostic!.provider, "claude");
  assert.equal(diagnostic!.role, "PRIMARY");
  assert.equal(diagnostic!.category, "quota");
  assert.equal(diagnostic!.exitCode, 1);
  assert.match(`${diagnostic!.stdoutTail}${diagnostic!.stderrTail}`, /Usage limit reached/);
  // The harness puts a fake key in the child environment; it must not survive.
  assert.doesNotMatch(JSON.stringify(diagnostic), /must-not-leak/);

  // And it reconstructs from durable state alone.
  const restarted = f.restart();
  assert.deepEqual(new WorkerDiagnosticsStore(restarted.ports).list("loop-run"), [diagnostic]);
  assert.equal(buildRunReport(restarted.ports, "loop-run").workerDiagnostics[0]!.categoryLabel, "quota exhausted");
});

test("approval alone neither starts the consultant nor releases the BLOCKED hold", async t => {
  const f = fixture(t, [{ workerFailure: "quota" }]);
  await f.h.loop.run("loop-run");
  const consultations = new ConsultationStore(f.h.ports);
  const c = consultations.list("loop-run")[0]!;

  const approved = consultations.resolve({ runId: "loop-run", requestId: c.id, consultantProvider: "codex", decision: "APPROVED", source: "desktop_ui" });
  assert.equal(approved.executionEligible, true);
  assert.equal(approved.approvalSource, "desktop_ui");

  const outcome = await f.h.loop.run("loop-run");
  assert.equal(outcome.reason, "consultant_recommended", "the hold survives approval");
  assert.equal(latestPrimaryProgress(f.h.ports, "loop-run")!.status, "BLOCKED");
  assert.deepEqual(new ConsultantStore(f.h.ports).sessions("loop-run"), []);
  assert.equal(new LoopStore(f.h.ports).activeGrant("loop-run")!.turnsUsed, 1, "approval consumes no PRIMARY grant turn");
  assert.equal(f.prompts().length, 1);
});

test("a completed diagnosis releases the BLOCKED hold once, into the same PRIMARY session", async t => {
  const f = fixture(t, [
    { workerFailure: "quota" },
    { emitFiles: [{ path: "fix.txt", contents: "repaired\n" }], verify: { typecheck: 0 } }
  ]);
  await f.h.loop.run("loop-run");

  const consultations = new ConsultationStore(f.h.ports);
  const c = consultations.list("loop-run")[0]!;
  consultations.resolve({ runId: "loop-run", requestId: c.id, consultantProvider: "codex", decision: "APPROVED", source: "desktop_ui" });

  const primaryBefore = f.h.worker.sessions.session("loop-run")!;
  const store = new ConsultantStore(f.h.ports);
  store.startSession({ runId: "loop-run", provider: "codex", sessionId: "consultant-session-1", cwd: "consultant-cwd" });
  store.recordIntent({ runId: "loop-run", consultationId: c.id, provider: "codex", sessionId: "consultant-session-1", promptLength: 42 });
  const diagnosis = store.settle({ consultationId: c.id, status: "COMPLETED", diagnosis: "ROOT CAUSE\nThe provider refused the turn.", failure: null });

  // A restart between the diagnosis and the retry must change nothing.
  const restarted = f.restart();
  assert.deepEqual(new ConsultantStore(restarted.ports).diagnosis(c.id), diagnosis);
  assert.equal(new ConsultantStore(restarted.ports).pendingForPrimary("loop-run")!.id, diagnosis.id);
  assert.equal(new ConsultantStore(restarted.ports).session("loop-run", "codex")!.role, "CONSULTANT");

  const outcome = await restarted.loop.run("loop-run");
  const prompts = f.prompts();

  assert.equal(outcome.reason, "completed", outcome.detail);
  assert.ok(restarted.store.listEvents("loop-run").some(e => e.type === "CONSULTATION_HOLD_RELEASED"));
  assert.equal(prompts.filter(p => p.includes("ADVISORY — SECOND OPINION")).length, 1, "supplied exactly once");
  assert.match(prompts.at(-1)!, /The provider refused the turn/);

  // Same sticky PRIMARY session and provider; the consultant stays separate.
  const primaryAfter = restarted.worker.sessions.session("loop-run")!;
  assert.equal(primaryAfter.sessionId, primaryBefore.sessionId);
  assert.equal(primaryAfter.provider, "claude");
  const report = buildRunReport(restarted.ports, "loop-run");
  assert.equal(report.roles.primary.provider, "claude");
  assert.equal(report.roles.consultant.provider, "codex");

  // The diagnosis is spent, and the retry produced real verified work.
  const supplied = new ConsultantStore(restarted.ports).diagnosis(c.id)!;
  assert.ok(supplied.suppliedToTurnId);
  assert.equal(new ConsultantStore(restarted.ports).pendingForPrimary("loop-run"), null);
  assert.equal(report.run.state, "COMPLETED");
  assert.equal(report.loop.turns.at(-1)!.verification!.outcome, "PASSED");
  assert.equal(report.checkpoints.at(-1)!.status, "COMMITTED");
});
