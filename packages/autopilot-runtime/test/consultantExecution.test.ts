// Read-only CONSULTANT execution.
//
// No model is contacted: the consultant CLI is the local fakeCodex fixture and
// the PRIMARY CLI is the local fakeClaude/fakeLoopWorker fixture. Everything
// else — SQLite, git, child processes, policy, approvals, the dispatcher, the
// loop — is the real implementation.
//
// The invariants under test are structural, not advisory: the consultant gets
// one approved diagnosis, writes nothing, checkpoints nothing, and never
// becomes or displaces the PRIMARY.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createTestWorkspace } from "./helpers/harness.ts";
import { createTestRepository, createGitPort } from "./helpers/platform.ts";
import { openControlledHost } from "./helpers/controlledHostHarness.ts";
import { openLoop, initWorktree } from "./helpers/loopHarness.ts";
import { ConsultantStore, MAX_DIAGNOSIS_CHARS } from "../src/consultant.ts";
import { ConsultationStore, type ConsultationRecord } from "../src/consultations.ts";
import { WorkerStore } from "../src/workerStore.ts";
import { CheckpointStore } from "../src/checkpoints.ts";
import { LoopStore } from "../src/loopStore.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";
import type { RuntimePorts } from "../src/ports.ts";
import type { PrimaryProgress } from "../src/progress.ts";
import type { RunRecord } from "../src/index.ts";

const STALL: PrimaryProgress = {
  version: 1, status: "STALLED", reason: "equivalent_verification_without_change",
  turnId: null, turnOrdinal: null, verificationId: null, failureFingerprint: "abc",
  workspaceFingerprint: "def", requestFingerprint: null, consecutiveStalled: 3, consultantRecommended: true
};

function scopeOf(c: ConsultationRecord) {
  return { runId: c.runId, requestId: c.id, consultantProvider: c.consultantProvider };
}

// ---------------------------------------------------------------------------
// Group A: real consultant execution through the desktop host IPC surface.
// ---------------------------------------------------------------------------

async function hostFixture(t: { after(fn: () => void): void }) {
  const space = createTestWorkspace();
  const repo = createTestRepository(resolve(space.dir, "repo"));
  const cwd = resolve(space.dir, "worktree");
  createGitPort().addWorktree({ repoRoot: repo, worktreePath: cwd, branch: "consult-test", baseRef: "HEAD" });
  let h = await openControlledHost(space.dir);
  t.after(() => { try { h.close(); } catch { /* already closed */ } space.cleanup(); });

  const run: RunRecord = await h.invoke("create-run", {
    goal: "Repair the failing check", projectPath: repo,
    workers: { primary: "claude", consultant: "codex", sticky: true, fallback: null, consultantMode: false },
    capabilities: { workspaceRoot: cwd, allowedPaths: [], forbiddenPaths: ["local-data"], allowedCommands: [], forbiddenCommands: [], requiresApproval: [] }
  });

  const recommend = () => {
    h.host.engine.store.appendEvent(run.id, { type: "PRIMARY_PROGRESS_EVALUATED", payload: { decision: STALL } });
    return new ConsultationStore(h.ports).list(run.id)[0]!;
  };
  return {
    space, repo, cwd, run, recommend,
    get h() { return h; },
    async restart() { h.close(); h = await openControlledHost(space.dir); },
    dispatches: (): unknown[] => existsSync(resolve(cwd, ".fake-codex-dispatches"))
      ? readFileSync(resolve(cwd, ".fake-codex-dispatches"), "utf8").trim().split("\n").map(line => JSON.parse(line))
      : [],
    answer: (text: string) => writeFileSync(resolve(cwd, ".fake-codex-answer"), JSON.stringify(text), "utf8"),
    // Everything the local CLI fixture itself drops in the worktree is ignored;
    // what matters is that the consultant changed no project file.
    changedProjectFiles: () => execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", windowsHide: true })
      .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.includes(".fake-"))
  };
}

test("an approved consultation executes exactly one diagnosis, and only on execution", async t => {
  const f = await hostFixture(t);
  const c = f.recommend();
  const store = new ConsultantStore(f.h.ports);

  // Approval is authorization, not execution.
  await f.h.invoke("consultation-approve", scopeOf(c));
  assert.deepEqual(store.sessions(f.run.id), []);
  assert.equal(store.diagnosis(c.id), null);
  assert.equal(f.dispatches().length, 0);

  const diagnosis = await f.h.invoke("consultation-run", scopeOf(c));
  assert.equal(diagnosis.status, "COMPLETED");
  assert.equal(diagnosis.consultantProvider, "codex");
  assert.equal(diagnosis.suppliedToTurnId, null);
  assert.equal(f.dispatches().length, 1);

  // The one-diagnosis limit is enforced by the runner and by the database.
  await assert.rejects(() => f.h.invoke("consultation-run", scopeOf(c)), /authorizes exactly one/);
  assert.equal(f.dispatches().length, 1);
  assert.equal(store.diagnoses(f.run.id).length, 1);
});

for (const state of ["RECOMMENDED", "CANCELLED", "SUPERSEDED"] as const) {
  test(`a ${state} consultation cannot execute`, async t => {
    const f = await hostFixture(t);
    const c = f.recommend();
    if (state === "CANCELLED") await f.h.invoke("consultation-cancel", scopeOf(c));
    if (state === "SUPERSEDED") {
      await f.h.invoke("consultation-approve", scopeOf(c));
      // New PRIMARY evidence invalidates the frozen evidence the approval named.
      f.h.host.engine.store.appendEvent(f.run.id, { type: "WORKER_OUTPUT_APPLIED", payload: { applied: 1, paths: ["src/fix.ts"] } });
    }
    assert.equal(new ConsultationStore(f.h.ports).list(f.run.id)[0]!.status, state);
    await assert.rejects(() => f.h.invoke("consultation-run", scopeOf(c)), /not approved|superseded|authorizes nothing/);
    assert.deepEqual(new ConsultantStore(f.h.ports).sessions(f.run.id), []);
    assert.equal(f.dispatches().length, 0);
  });
}

test("CONSULTANT and PRIMARY sessions are distinct, and the role survives restart", async t => {
  const f = await hostFixture(t);
  const c = f.recommend();
  await f.h.invoke("consultation-approve", scopeOf(c));
  await f.h.invoke("consultation-run", scopeOf(c));

  const session = new ConsultantStore(f.h.ports).session(f.run.id, "codex")!;
  assert.equal(session.role, "CONSULTANT");
  assert.equal(session.provider, "codex");
  // The PRIMARY session table is untouched: the consultant cannot occupy it.
  assert.equal(new WorkerStore(f.h.ports).session(f.run.id), null);
  assert.throws(() => f.h.ports.db.prepare(
    "INSERT INTO autopilot_consultant_sessions(id,run_id,role,provider,session_id,cwd,created_at) VALUES('x',:run,'PRIMARY','codex','s',:cwd,'t')"
  ).run({ run: f.run.id, cwd: f.cwd }), /CHECK|constraint/i);

  await f.restart();
  const after = new ConsultantStore(f.h.ports).session(f.run.id, "codex")!;
  assert.deepEqual(after, session);
  assert.equal(new ConsultantStore(f.h.ports).diagnosis(c.id)!.status, "COMPLETED");
  assert.equal(new WorkerStore(f.h.ports).session(f.run.id), null);
  assert.equal(f.h.host.engine.store.requireRun(f.run.id).spec.workers.primary, "claude");
});

test("a DEXNEST_FILE block from the consultant is refused, never written", async t => {
  const f = await hostFixture(t);
  f.answer([
    "ROOT CAUSE",
    "The guard is inverted.",
    "",
    '<<<DEXNEST_FILE path="src/fix.ts">>>',
    "export const hijacked = true;",
    "<<<END_DEXNEST_FILE>>>"
  ].join("\n"));
  const c = f.recommend();
  await f.h.invoke("consultation-approve", scopeOf(c));
  const diagnosis = await f.h.invoke("consultation-run", scopeOf(c));

  assert.equal(diagnosis.status, "COMPLETED");
  assert.equal(diagnosis.refusedFileBlocks, 1);
  assert.equal(existsSync(resolve(f.cwd, "src/fix.ts")), false);
  assert.deepEqual(f.changedProjectFiles(), [], "the consultant left the PRIMARY worktree unchanged");
  assert.ok(f.h.host.engine.store.listEvents(f.run.id).some(e => e.type === "CONSULTANT_OUTPUT_REFUSED"));
  // Nothing the consultant did produced a checkpoint or a loop authorization.
  assert.deepEqual(new CheckpointStore(f.h.ports).list(f.run.id), []);
  assert.deepEqual(new LoopStore(f.h.ports).grants(f.run.id), []);
  assert.ok(diagnosis.diagnosis!.length <= MAX_DIAGNOSIS_CHARS);
});

for (const failure of ["__quota__", "__auth__"] as const) {
  test(`a consultant ${failure} failure surfaces without any fallback`, async t => {
    const f = await hostFixture(t);
    // The sentinel travels to the fixture inside the prompt, via the run goal,
    // and must be in place before the evidence is frozen by the recommendation.
    const spec = f.h.host.engine.store.requireRun(f.run.id).spec;
    spec.goal = failure;
    f.h.ports.db.prepare("UPDATE autopilot_runs SET spec_json=:spec WHERE id=:id").run({ spec: JSON.stringify(spec), id: f.run.id });
    const c = f.recommend();
    await f.h.invoke("consultation-approve", scopeOf(c));

    const diagnosis = await f.h.invoke("consultation-run", scopeOf(c));
    assert.equal(diagnosis.status, "FAILED");
    assert.ok(diagnosis.failure);
    // No provider switch, no retry with another model, no PRIMARY session.
    assert.equal(f.h.host.engine.store.requireRun(f.run.id).spec.workers.primary, "claude");
    assert.equal(new WorkerStore(f.h.ports).session(f.run.id), null);
    assert.equal(f.dispatches().length, 1);
    await assert.rejects(() => f.h.invoke("consultation-run", scopeOf(c)), /authorizes exactly one/);
  });
}

test("an interrupted send is reported UNCERTAIN and never blindly resent", async t => {
  const f = await hostFixture(t);
  const c = f.recommend();
  await f.h.invoke("consultation-approve", scopeOf(c));
  // Model a crash between the journaled intent and the recorded outcome.
  new ConsultantStore(f.h.ports).recordIntent({
    runId: f.run.id, consultationId: c.id, provider: "codex", sessionId: "consultant-session", promptLength: 100
  });
  await f.restart();

  await assert.rejects(() => f.h.invoke("consultation-run", scopeOf(c)), /no confirmed outcome/);
  assert.equal(f.dispatches().length, 0, "an uncertain send is never replayed");
  assert.equal(new ConsultantStore(f.h.ports).diagnosis(c.id)!.status, "UNCERTAIN");
  // And it still counts as the one diagnosis this consultation authorized.
  await assert.rejects(() => f.h.invoke("consultation-run", scopeOf(c)), /authorizes exactly one/);
});

test("the report and activity projection carry the diagnosis without provider protocol detail", async t => {
  const f = await hostFixture(t);
  const c = f.recommend();
  await f.h.invoke("consultation-approve", scopeOf(c));
  await f.h.invoke("consultation-run", scopeOf(c));

  const report = buildRunReport(f.h.ports, f.run.id);
  assert.equal(report.diagnoses.length, 1);
  assert.equal(report.consultantSessions[0]!.role, "CONSULTANT");
  assert.equal(report.roles.consultant.provider, "codex");
  assert.match(renderRunReportMarkdown(report), /## Consultant diagnoses/);
  assert.ok(report.activity.some(a => a.label === "Consultant session started"));
  assert.ok(report.activity.some(a => a.label === "Consultant diagnosis complete"));
  assert.doesNotMatch(JSON.stringify(report), /thread\/start|turn\/start|OPENAI_API_KEY|must-not-leak/);
  const snapshot = await f.h.invoke("get-run", f.run.id);
  assert.equal(snapshot.consultant.diagnoses.length, 1);
});

// ---------------------------------------------------------------------------
// Group B: how a diagnosis rejoins the PRIMARY loop.
//
// The consultant process is not re-exercised here; these tests start from a
// recorded diagnosis and assert what the loop does with it.
// ---------------------------------------------------------------------------

function loopFixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-consult-loop-"));
  initWorktree(resolve(root, "worktree"), [{ emitFiles: [] }], { typecheck: 1 });
  let instance = 1;
  let h = openLoop(root, { instance, maxConsecutiveFailures: 20 });
  h.createRun({ workers: { primary: "claude", consultant: "codex", sticky: true, fallback: null, consultantMode: false } });
  h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return {
    root,
    get h() { return h; },
    restart() { h.close(); h = openLoop(root, { instance: ++instance, maxConsecutiveFailures: 20 }); return h; },
    prompts: (): string[] => {
      const file = resolve(root, "worktree", ".loop-dispatches.json");
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Array<{ prompt: string }>).map(d => d.prompt) : [];
    }
  };
}

/** Drives the loop until it holds for a consultant, then approves one. */
async function stallAndApprove(f: ReturnType<typeof loopFixture>) {
  const outcome = await f.h.loop.run("loop-run");
  assert.equal(outcome.reason, "consultant_recommended", outcome.detail);
  const consultations = new ConsultationStore(f.h.ports);
  const c = consultations.list("loop-run")[0]!;
  consultations.resolve({ ...scopeOf(c), decision: "APPROVED", source: "desktop_ui" });
  return c;
}

/** Records a settled diagnosis without running any provider. */
function recordDiagnosis(
  ports: RuntimePorts,
  c: ConsultationRecord,
  status: "COMPLETED" | "FAILED",
  text = "ROOT CAUSE\nThe fixture never changes the verify state."
) {
  const store = new ConsultantStore(ports);
  store.startSession({ runId: c.runId, provider: "codex", sessionId: "consultant-session-1", cwd: "consultant-cwd" });
  store.recordIntent({ runId: c.runId, consultationId: c.id, provider: "codex", sessionId: "consultant-session-1", promptLength: text.length });
  return store.settle({
    consultationId: c.id,
    status,
    diagnosis: status === "COMPLETED" ? text : null,
    failure: status === "FAILED" ? "quota" : null
  });
}

test("approval alone does not release the hold; a failed diagnosis does not either", async t => {
  const f = loopFixture(t);
  const c = await stallAndApprove(f);
  const held = f.prompts().length;

  const afterApproval = await f.h.loop.run("loop-run");
  assert.equal(afterApproval.reason, "consultant_recommended");
  assert.equal(f.prompts().length, held, "approval alone started no PRIMARY turn");

  recordDiagnosis(f.h.ports, c, "FAILED");
  const afterFailure = await f.h.loop.run("loop-run");
  assert.equal(afterFailure.reason, "consultant_recommended");
  assert.equal(f.prompts().length, held, "a failed diagnosis released nothing");
  assert.equal(new ConsultantStore(f.h.ports).pendingForPrimary("loop-run"), null);
});

test("a completed diagnosis releases the hold once, into the same PRIMARY session", async t => {
  const f = loopFixture(t);
  const c = await stallAndApprove(f);
  const before = f.prompts();
  const primarySession = f.h.worker.sessions.session("loop-run")!;
  recordDiagnosis(f.h.ports, c, "COMPLETED");

  await f.h.loop.run("loop-run");
  const after = f.prompts();
  assert.ok(after.length > before.length, "the hold was released for a retry");
  const retry = after[before.length]!;
  assert.match(retry, /ADVISORY — SECOND OPINION FROM A CONSULTANT/);
  assert.match(retry, /The fixture never changes the verify state/);
  assert.match(retry, /advice, not instruction/);

  // Same sticky PRIMARY session, same provider, same worktree.
  const session = f.h.worker.sessions.session("loop-run")!;
  assert.equal(session.sessionId, primarySession.sessionId);
  assert.equal(session.provider, "claude");
  assert.equal(f.h.store.requireRun("loop-run").spec.workers.primary, "claude");
  assert.equal(f.h.store.requireRun("loop-run").spec.capabilities.workspaceRoot, resolve(f.root, "worktree"));

  // Supplied exactly once: later turns do not carry the advisory again.
  const diagnosis = new ConsultantStore(f.h.ports).diagnosis(c.id)!;
  assert.ok(diagnosis.suppliedToTurnId);
  assert.equal(new ConsultantStore(f.h.ports).pendingForPrimary("loop-run"), null);
  assert.equal(after.filter(p => p.includes("ADVISORY")).length, 1);
  assert.ok(f.h.store.listEvents("loop-run").some(e => e.type === "CONSULTATION_HOLD_RELEASED"));
});

test("a completed diagnosis survives restart and is then supplied exactly once", async t => {
  const f = loopFixture(t);
  const c = await stallAndApprove(f);
  const before = f.prompts().length;
  const recorded = recordDiagnosis(f.h.ports, c, "COMPLETED");

  const restarted = f.restart();
  assert.deepEqual(new ConsultantStore(restarted.ports).diagnosis(c.id), recorded);
  assert.equal(new ConsultantStore(restarted.ports).pendingForPrimary("loop-run")!.id, recorded.id);
  assert.equal(new ConsultantStore(restarted.ports).session("loop-run", "codex")!.role, "CONSULTANT");

  await restarted.loop.run("loop-run");
  const prompts = f.prompts();
  assert.ok(prompts.length > before);
  assert.equal(prompts.filter(p => p.includes("ADVISORY")).length, 1);
  assert.equal(new ConsultantStore(restarted.ports).pendingForPrimary("loop-run"), null);
});

test("a later stall requires a new request and a new approval", async t => {
  const f = loopFixture(t);
  const c = await stallAndApprove(f);
  recordDiagnosis(f.h.ports, c, "COMPLETED");
  await f.h.loop.run("loop-run");

  // The retry did not fix anything, so PRIMARY stalls again.
  const outcome = await f.h.loop.run("loop-run");
  assert.equal(outcome.reason, "consultant_recommended");
  const active = new ConsultationStore(f.h.ports).list("loop-run")
    .filter(entry => entry.status === "RECOMMENDED" || entry.status === "APPROVED");
  assert.equal(active.length, 1);
  assert.notEqual(active[0]!.id, c.id, "the spent consultation does not authorize a second diagnosis");
  assert.equal(active[0]!.status, "RECOMMENDED");
  assert.equal(active[0]!.executionEligible, false);
  assert.equal(new ConsultantStore(f.h.ports).diagnosis(active[0]!.id), null);
});

test("a PRIMARY LoopGrant confers no consultant authority", async t => {
  const f = loopFixture(t);
  const c = await stallAndApprove(f);
  const grant = new LoopStore(f.h.ports).activeGrant("loop-run")!;
  assert.throws(() => new ConsultationStore(f.h.ports).resolve({
    ...scopeOf(c), decision: "APPROVED", source: `loop_grant:${grant.id}` as "desktop_ui"
  }), /explicit human/);
  // And a grant is never created for, or consumed by, the consultant.
  assert.deepEqual(new LoopStore(f.h.ports).grants("loop-run").map(g => g.provider), ["claude"]);
  assert.equal(new ConsultantStore(f.h.ports).sessions("loop-run").length, 0);
});

test("the consultant never becomes PRIMARY and never checkpoints", async t => {
  const f = loopFixture(t);
  const c = await stallAndApprove(f);
  const checkpointsBefore = new CheckpointStore(f.h.ports).list("loop-run");
  recordDiagnosis(f.h.ports, c, "COMPLETED");

  assert.equal(f.h.worker.sessions.session("loop-run")!.provider, "claude");
  assert.deepEqual(new CheckpointStore(f.h.ports).list("loop-run"), checkpointsBefore);
  // The consultant's own session row can never claim the PRIMARY role.
  assert.throws(() => f.h.ports.db.prepare(
    "UPDATE autopilot_consultant_sessions SET role='PRIMARY' WHERE run_id='loop-run'"
  ).run({}), /CHECK|constraint/i);
  assert.equal(new ConsultantStore(f.h.ports).session("loop-run", "codex")!.role, "CONSULTANT");
});

test("a refused diagnosis still records the provider thread it was attempted on", async t => {
  // From the live trial: a Codex refusal left provider_session_id null on the
  // diagnosis even though the consultant session had already bound the thread,
  // so a failed consultation could not be traced to its conversation.
  const f = await hostFixture(t);
  const spec = f.h.host.engine.store.requireRun(f.run.id).spec;
  spec.goal = "__quota__";
  f.h.ports.db.prepare("UPDATE autopilot_runs SET spec_json=:spec WHERE id=:id").run({ spec: JSON.stringify(spec), id: f.run.id });
  const c = f.recommend();
  await f.h.invoke("consultation-approve", scopeOf(c));

  const diagnosis = await f.h.invoke("consultation-run", scopeOf(c));
  assert.equal(diagnosis.status, "FAILED");

  const session = new ConsultantStore(f.h.ports).session(f.run.id, "codex")!;
  assert.ok(session.providerSessionId, "the session bound a provider thread");
  assert.equal(diagnosis.providerSessionId, session.providerSessionId, "the refused diagnosis is traceable to it");
});
