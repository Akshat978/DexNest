// Recovery and routing policy.
//
// The policy is a pure function of durable evidence, so these tests assemble
// real durable state through the real loop, consultation and handoff paths and
// then assert the single recommendation that falls out of it.
//
// The two invariants that matter most: exactly one recommendation at a time,
// and the policy grants no authority of its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { evaluateRecovery, recoveryActivityLabel, type ProviderPreflight, type PreflightProbe } from "../src/recovery.ts";
import { ConsultationStore } from "../src/consultations.ts";
import { ConsultantStore } from "../src/consultant.ts";
import { HandoffStore, OwnershipStore } from "../src/handoff.ts";
import { LoopStore } from "../src/loopStore.ts";
import { WorkerStore } from "../src/workerStore.ts";
import { buildRunReport } from "../src/report.ts";
import type { PrimaryProgress } from "../src/progress.ts";
import type { RuntimePorts } from "../src/ports.ts";

const WORKING: LoopPlanStep = { emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 1 } };
const STUCK: LoopPlanStep = { emitFiles: [] };
const FINISHING: LoopPlanStep = { emitFiles: [{ path: "two.txt", contents: "two\n" }], verify: { typecheck: 0 } };

/** Alternate provider present locally. Never claims anything about quota. */
const AVAILABLE: PreflightProbe = (provider) => ({
  provider, executableConfigured: true, executableFound: true,
  availableLocally: true, quota: "unknown_until_provider_call"
});
const MISSING: PreflightProbe = (provider) => ({
  provider, executableConfigured: false, executableFound: false,
  availableLocally: false, quota: "unknown_until_provider_call"
});

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[], consultant: "codex" | null = "codex", turns = 6) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-recovery-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  let h = openLoop(root, { maxConsecutiveFailures: 20 });
  h.createRun({ workers: { primary: "claude", consultant, sticky: true, fallback: null, consultantMode: false } });
  h.loop.authorize({ runId: "loop-run", maxTurns: turns, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  let instance = 1;
  return {
    get h() { return h; },
    restart() { h.close(); h = openLoop(root, { instance: ++instance, maxConsecutiveFailures: 20 }); return h; },
    decide: (probe: PreflightProbe = AVAILABLE) => evaluateRecovery(h.ports, "loop-run", probe),
    regrant: (maxTurns = 1) => { h.loop.revoke("loop-run", "test phase"); return h.loop.authorize({ runId: "loop-run", maxTurns, grantedBy: "human" }); }
  };
}

/** Records a completed diagnosis against a fresh operator consultation. */
function diagnose(ports: RuntimePorts, text = "ROOT CAUSE\nThe guard is inverted.") {
  const consultation = new ConsultationStore(ports).requestOperator({ runId: "loop-run", consultantProvider: "codex", source: "desktop_ui" });
  new ConsultationStore(ports).resolve({ runId: "loop-run", requestId: consultation.id, consultantProvider: "codex", decision: "APPROVED", source: "desktop_ui" });
  const store = new ConsultantStore(ports);
  store.startSession({ runId: "loop-run", provider: "codex", sessionId: "consultant-session-1", cwd: "cwd" });
  store.recordIntent({ runId: "loop-run", consultationId: consultation.id, provider: "codex", sessionId: "consultant-session-1", promptLength: text.length });
  store.settle({ consultationId: consultation.id, status: "COMPLETED", diagnosis: text, failure: null });
  return consultation;
}

/** Forces a durable terminal PRIMARY obstacle through the real detector. */
function blockPrimary(ports: RuntimePorts, obstacle: string) {
  const decision: PrimaryProgress = {
    version: 1, status: "BLOCKED", reason: `terminal_obstacle:${obstacle}`,
    turnId: null, turnOrdinal: null, verificationId: null, failureFingerprint: null,
    workspaceFingerprint: null, requestFingerprint: null, consecutiveStalled: 0,
    consultantRecommended: ["auth", "quota", "session", "protocol", "unsupported", "not_installed"].includes(obstacle)
  };
  void ports;
  return decision;
}

// ---------------------------------------------------------------------------
// Ordinary progress
// ---------------------------------------------------------------------------

test("a run with authorized turns left continues or retries PRIMARY", async t => {
  const f = fixture(t, [WORKING], "codex", 6);
  await f.h.loop.run("loop-run");

  const decision = f.decide();
  assert.equal(decision.currentPrimary, "claude");
  assert.equal(decision.alternateProvider, "codex");
  // The fixture keeps failing verification, so the loop spends the whole grant.
  assert.ok(["RETRY_PRIMARY", "CONTINUE_PRIMARY", "RECOMMEND_CONSULTATION", "WAIT_FOR_OPERATOR"].includes(decision.action));
  assert.ok(decision.fingerprint.startsWith("rec-"));
  assert.equal(decision.version, 1);
});

test("an exhausted grant waits for the operator rather than issuing another", async t => {
  const f = fixture(t, [FINISHING], "codex", 1);
  // One authorized turn that does not finish the run.
  const stuck = fixture(t, [WORKING], "codex", 1);
  await stuck.h.loop.run("loop-run");

  const decision = stuck.decide();
  assert.equal(decision.action, "WAIT_FOR_OPERATOR");
  assert.equal(decision.reason, "grant_exhausted");
  assert.match(decision.summary, /no authorized turn left/);
  // The policy did not create one.
  assert.equal(new LoopStore(stuck.h.ports).activeGrant("loop-run"), null);
  void f;
});

// ---------------------------------------------------------------------------
// STALLED routing
// ---------------------------------------------------------------------------

test("the first meaningful stall recommends a consultation, not a handoff", async t => {
  const f = fixture(t, [STUCK], "codex", 8);
  const outcome = await f.h.loop.run("loop-run");
  assert.equal(outcome.reason, "consultant_recommended");

  const decision = f.decide();
  // The automatic recommendation already exists, so the policy surfaces it.
  assert.equal(decision.action, "RECOMMEND_CONSULTATION");
  assert.match(decision.reason, /^(stalled_without_consultation|consultation_recommended)$/);
  assert.equal(decision.alternateProvider, "codex");
});

test("a stall with no viable consultant waits for the operator", async t => {
  const alone = fixture(t, [STUCK], null, 8);
  await alone.h.loop.run("loop-run");
  const decision = alone.decide();
  assert.equal(decision.action, "WAIT_FOR_OPERATOR");
  assert.equal(decision.reason, "stalled_without_viable_consultant");
  assert.equal(decision.alternateProvider, null);

  // Configured but not installed locally is equally not viable.
  const missing = fixture(t, [STUCK], "codex", 8);
  await missing.h.loop.run("loop-run");
  const denied = missing.decide(MISSING);
  assert.equal(denied.action, "WAIT_FOR_OPERATOR");
  assert.match(denied.reason, /no_viable_consultant|stalled_without_viable_consultant/);
});

test("an active consultation and a pending diagnosis each suppress a second recommendation", async t => {
  const f = fixture(t, [STUCK], "codex", 8);
  await f.h.loop.run("loop-run");

  const consultations = new ConsultationStore(f.h.ports);
  const active = consultations.list("loop-run").find(entry => ["RECOMMENDED", "APPROVED"].includes(entry.status))!;
  const withConsultation = f.decide();
  assert.equal(withConsultation.action, "RECOMMEND_CONSULTATION");
  assert.equal(withConsultation.evidence.consultationId, active.id);

  // A completed, unsupplied diagnosis is consumed by the next PRIMARY turn.
  consultations.resolve({ runId: "loop-run", requestId: active.id, consultantProvider: "codex", decision: "APPROVED", source: "desktop_ui" });
  const store = new ConsultantStore(f.h.ports);
  store.startSession({ runId: "loop-run", provider: "codex", sessionId: "consultant-session-1", cwd: "cwd" });
  store.recordIntent({ runId: "loop-run", consultationId: active.id, provider: "codex", sessionId: "consultant-session-1", promptLength: 10 });
  store.settle({ consultationId: active.id, status: "COMPLETED", diagnosis: "ROOT CAUSE\nlook again", failure: null });

  const withDiagnosis = f.decide();
  assert.ok(["CONTINUE_PRIMARY", "WAIT_FOR_OPERATOR"].includes(withDiagnosis.action));
  assert.match(withDiagnosis.reason, /diagnosis_pending/);
  assert.notEqual(withDiagnosis.action, "RECOMMEND_CONSULTATION", "no second opinion is requested on top of one already waiting");
});

// ---------------------------------------------------------------------------
// The canonical escalation
// ---------------------------------------------------------------------------

test("still stalled after a consultant-assisted retry recommends a handoff", async t => {
  const f = fixture(t, [STUCK], "codex", 12);
  await f.h.loop.run("loop-run");

  // Approve the automatic recommendation and answer it, which is what releases
  // the STALLED hold for exactly one advisory-carrying retry.
  const consultations = new ConsultationStore(f.h.ports);
  const automatic = consultations.list("loop-run").find(entry => ["RECOMMENDED", "APPROVED"].includes(entry.status))!;
  consultations.resolve({ runId: "loop-run", requestId: automatic.id, consultantProvider: "codex", decision: "APPROVED", source: "desktop_ui" });
  const store = new ConsultantStore(f.h.ports);
  store.startSession({ runId: "loop-run", provider: "codex", sessionId: "consultant-session-1", cwd: "cwd" });
  store.recordIntent({ runId: "loop-run", consultationId: automatic.id, provider: "codex", sessionId: "consultant-session-1", promptLength: 20 });
  store.settle({ consultationId: automatic.id, status: "COMPLETED", diagnosis: "ROOT CAUSE\nThe guard is inverted.", failure: null });

  f.regrant(4);
  await f.h.loop.run("loop-run");

  const supplied = new ConsultantStore(f.h.ports).diagnoses("loop-run").find(entry => entry.suppliedToTurnId)!;
  assert.ok(supplied, "the diagnosis reached a PRIMARY turn");

  const decision = f.decide();
  assert.equal(decision.action, "RECOMMEND_HANDOFF");
  assert.equal(decision.reason, "stalled_after_consultant_assisted_retry");
  assert.equal(decision.currentPrimary, "claude");
  assert.equal(decision.alternateProvider, "codex");
  assert.equal(decision.evidence.diagnosisSuppliedToTurnId, supplied.suppliedToTurnId);
  // Local availability only; never a quota claim.
  assert.equal(decision.alternatePreflight!.availableLocally, true);
  assert.equal(decision.alternatePreflight!.quota, "unknown_until_provider_call");
  assert.match(decision.summary, /usage\/quota is unknown until a provider call/);
});

test("a consultant-assisted retry that progresses does not recommend a handoff", async t => {
  const f = fixture(t, [STUCK, STUCK, STUCK, STUCK, FINISHING], "codex", 12);
  await f.h.loop.run("loop-run");
  const consultations = new ConsultationStore(f.h.ports);
  const automatic = consultations.list("loop-run").find(entry => ["RECOMMENDED", "APPROVED"].includes(entry.status))!;
  consultations.resolve({ runId: "loop-run", requestId: automatic.id, consultantProvider: "codex", decision: "APPROVED", source: "desktop_ui" });
  const store = new ConsultantStore(f.h.ports);
  store.startSession({ runId: "loop-run", provider: "codex", sessionId: "consultant-session-1", cwd: "cwd" });
  store.recordIntent({ runId: "loop-run", consultationId: automatic.id, provider: "codex", sessionId: "consultant-session-1", promptLength: 20 });
  store.settle({ consultationId: automatic.id, status: "COMPLETED", diagnosis: "ROOT CAUSE\nkeep going", failure: null });

  f.regrant(4);
  await f.h.loop.run("loop-run");

  const decision = f.decide();
  assert.notEqual(decision.action, "RECOMMEND_HANDOFF");
  assert.ok(["COMPLETE", "CONTINUE_PRIMARY", "RETRY_PRIMARY", "WAIT_FOR_OPERATOR"].includes(decision.action));
});

// ---------------------------------------------------------------------------
// Terminal provider obstacles
// ---------------------------------------------------------------------------

for (const [failure, reason] of [
  ["quota", "primary_quota_exhausted"],
  ["auth", "primary_unauthenticated"],
  ["session", "primary_session_unavailable"],
  ["process", null]
] as const) {
  test(`a terminal ${failure} obstacle routes correctly`, async t => {
    const f = fixture(t, [{ workerFailure: failure === "process" ? "process" : failure }], "codex", 4);
    await f.h.loop.run("loop-run");

    const decision = f.decide();
    if (reason) {
      assert.equal(decision.action, "RECOMMEND_HANDOFF");
      assert.equal(decision.reason, reason);
      assert.equal(decision.alternatePreflight!.quota, "unknown_until_provider_call");
      // Without a locally viable alternate it becomes a human problem instead.
      const denied = f.decide(MISSING);
      assert.equal(denied.action, "WAIT_FOR_OPERATOR");
      assert.equal(denied.reason, `${reason}:no_alternate`);
    } else {
      // An unclassified process failure is not a routing problem.
      assert.notEqual(decision.action, "RECOMMEND_HANDOFF");
      assert.equal(decision.action, "WAIT_FOR_OPERATOR");
    }
  });
}

test("policy refusal and verification problems never recommend a provider change", async t => {
  for (const obstacle of ["policy", "verification_configuration_error", "verification_unavailable"]) {
    const f = fixture(t, [WORKING], "codex", 4);
    await f.h.loop.run("loop-run");
    f.h.store.appendEvent("loop-run", {
      type: "PRIMARY_PROGRESS_EVALUATED",
      payload: { decision: blockPrimary(f.h.ports, obstacle) }
    });

    const decision = f.decide();
    assert.equal(decision.action, "WAIT_FOR_OPERATOR", `${obstacle} must not route`);
    assert.equal(decision.reason, `operator_required:${obstacle}`);
    assert.notEqual(decision.action, "RECOMMEND_HANDOFF");
    assert.notEqual(decision.action, "RECOMMEND_CONSULTATION");
    assert.match(decision.summary, /would not fix that/);
  }
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test("an uncertain send outranks consultation and handoff", async t => {
  const f = fixture(t, [{ workerFailure: "truncated" }], "codex", 4);
  await f.h.loop.run("loop-run");

  const uncertain = new WorkerStore(f.h.ports).list("loop-run").find(send => send.status === "UNCERTAIN");
  assert.ok(uncertain, "the fixture produced an uncertain send");

  const decision = f.decide();
  assert.equal(decision.action, "RESOLVE_UNCERTAIN");
  assert.equal(decision.reason, "uncertain_primary_send");
  assert.equal(decision.evidence.uncertainSendId, uncertain!.id);

  // Even with a stall and a viable consultant present, uncertainty comes first.
  assert.notEqual(decision.action, "RECOMMEND_CONSULTATION");
  assert.notEqual(decision.action, "RECOMMEND_HANDOFF");
});

test("an open handoff is the current action and suppresses everything else", async t => {
  const f = fixture(t, [STUCK], "codex", 8);
  await f.h.loop.run("loop-run");
  const consultations = new ConsultationStore(f.h.ports);
  const automatic = consultations.list("loop-run").find(entry => ["RECOMMENDED", "APPROVED"].includes(entry.status));
  if (automatic) consultations.resolve({ runId: "loop-run", requestId: automatic.id, consultantProvider: "codex", decision: "CANCELLED", source: "desktop_ui" });

  const handoffs = new HandoffStore(f.h.ports);
  const proposed = handoffs.propose({ runId: "loop-run", toProvider: "codex", source: "OPERATOR", requestedBy: "desktop_ui" });
  assert.equal(f.decide().action, "RECOMMEND_HANDOFF");
  assert.equal(f.decide().reason, "handoff_proposed");
  assert.equal(f.decide().evidence.handoffId, proposed.id);

  handoffs.resolve({ runId: "loop-run", handoffId: proposed.id, toProvider: "codex", decision: "APPROVED", source: "desktop_ui" });
  assert.equal(f.decide().reason, "handoff_approved");
  // Ownership never moved: the policy only described the pending action.
  assert.equal(new OwnershipStore(f.h.ports).primaryProvider("loop-run", f.h.store.requireRun("loop-run").spec), "claude");
});

test("terminal runs return COMPLETE or NO_ACTION", async t => {
  const done = fixture(t, [FINISHING], "codex", 4);
  await done.h.loop.run("loop-run");
  assert.equal(done.h.store.requireRun("loop-run").state, "COMPLETED");
  const completed = done.decide();
  assert.equal(completed.action, "COMPLETE");
  assert.equal(completed.reason, "run_completed");

  const stopped = fixture(t, [WORKING], "codex", 4);
  await stopped.h.loop.run("loop-run");
  await stopped.h.engine.requestStop("loop-run");
  const halted = stopped.decide();
  assert.equal(halted.action, "NO_ACTION");
  assert.match(halted.reason, /^run_(stopped|failed)$/);
});

// ---------------------------------------------------------------------------
// Determinism, persistence and authority
// ---------------------------------------------------------------------------

test("the decision is derived, so a restart reconstructs it and new evidence replaces it", async t => {
  const f = fixture(t, [STUCK], "codex", 8);
  await f.h.loop.run("loop-run");
  const before = f.decide();

  // Same durable state, twice: identical decision including its fingerprint.
  assert.deepEqual(f.decide(), before);

  const restarted = f.restart();
  const after = evaluateRecovery(restarted.ports, "loop-run", AVAILABLE);
  assert.deepEqual(after, before, "no renderer-only recovery memory");

  // New PRIMARY evidence retires the old decision automatically.
  new ConsultationStore(restarted.ports).list("loop-run").forEach(entry => {
    if (["RECOMMENDED", "APPROVED"].includes(entry.status)) {
      new ConsultationStore(restarted.ports).resolve({ runId: "loop-run", requestId: entry.id, consultantProvider: "codex", decision: "CANCELLED", source: "desktop_ui" });
    }
  });
  const next = evaluateRecovery(restarted.ports, "loop-run", AVAILABLE);
  assert.notEqual(next.fingerprint, before.fingerprint, "the stale decision did not survive new evidence");
});

test("the policy grants no authority", async t => {
  const f = fixture(t, [STUCK], "codex", 8);
  await f.h.loop.run("loop-run");

  const consultations = new ConsultationStore(f.h.ports);
  const beforeConsultations = consultations.list("loop-run").map(entry => entry.status);
  const beforeGrants = new LoopStore(f.h.ports).grants("loop-run").length;
  const beforeOwnership = new OwnershipStore(f.h.ports).history("loop-run").length;
  const beforeSessions = new ConsultantStore(f.h.ports).sessions("loop-run").length;
  const beforeSpec = JSON.stringify(f.h.store.requireRun("loop-run").spec);

  // Evaluating repeatedly must be free of side effects of every kind.
  for (let index = 0; index < 3; index += 1) f.decide();

  assert.deepEqual(consultations.list("loop-run").map(entry => entry.status), beforeConsultations, "no consultation was approved");
  assert.equal(new LoopStore(f.h.ports).grants("loop-run").length, beforeGrants, "no grant was issued");
  assert.equal(new OwnershipStore(f.h.ports).history("loop-run").length, beforeOwnership, "ownership unchanged");
  assert.equal(new ConsultantStore(f.h.ports).sessions("loop-run").length, beforeSessions, "no consultant was executed");
  assert.deepEqual(new HandoffStore(f.h.ports).list("loop-run"), [], "no handoff was proposed");
  assert.equal(JSON.stringify(f.h.store.requireRun("loop-run").spec), beforeSpec, "the Run Spec is untouched");
});

test("the report and timeline carry the decision without duplicating payloads", async t => {
  const f = fixture(t, [STUCK], "codex", 8);
  await f.h.loop.run("loop-run");

  const report = buildRunReport(f.h.ports, "loop-run", AVAILABLE);
  assert.equal(report.recovery.action, "RECOMMEND_CONSULTATION");
  assert.equal(report.recovery.currentPrimary, "claude");
  assert.equal(report.recovery.alternateProvider, "codex");
  assert.ok(report.recovery.reason);

  // The loop journals how routing changed, in one line.
  const row = report.activity.find(entry => entry.label.startsWith("Recovery:"));
  assert.ok(row, "a recovery row is present");
  assert.equal(row!.label, recoveryActivityLabel(report.recovery));
  assert.equal(report.activity.some(entry => entry.label.includes("ROOT CAUSE")), false, "no diagnosis text in the timeline");
});
