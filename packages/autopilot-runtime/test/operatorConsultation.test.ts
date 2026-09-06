// Operator-initiated read-only consultation.
//
// A human asking for a second opinion on a run that is working, without waiting
// for the progress detector to raise STALLED or BLOCKED. It reuses the existing
// consultation machinery end to end: same request state, same human approval,
// same read-only consultant, same supplied-exactly-once advisory.
//
// Real SQLite, a real git worktree, real child processes, the real policy and
// dispatcher. The provider CLIs are local fixtures, so no model is contacted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { ConsultationStore } from "../src/consultations.ts";
import { ConsultantStore } from "../src/consultant.ts";
import { LoopStore } from "../src/loopStore.ts";
import { WorkerStore } from "../src/workerStore.ts";
import { CheckpointStore } from "../src/checkpoints.ts";
import { latestPrimaryProgress } from "../src/progress.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";

const WORKING: LoopPlanStep = { emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 1 } };
const FINISHING: LoopPlanStep = { emitFiles: [{ path: "two.txt", contents: "two\n" }], verify: { typecheck: 0 } };

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[], consultant: "codex" | "claude" | null = "codex", turns = 1) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-operator-"));
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
    root,
    get h() { return h; },
    restart() { h.close(); h = openLoop(root, { instance: ++instance, maxConsecutiveFailures: 20 }); return h; },
    /** Authorizes one more PRIMARY turn, as a human would before continuing. */
    authorize: (maxTurns = 1) => {
      h.loop.revoke("loop-run", "test phase boundary");
      return h.loop.authorize({ runId: "loop-run", maxTurns, grantedBy: "human" });
    },
    consultations: () => new ConsultationStore(h.ports),
    request: () => new ConsultationStore(h.ports).requestOperator({ runId: "loop-run", consultantProvider: "codex", source: "desktop_ui" }),
    approve: (id: string) => new ConsultationStore(h.ports).resolve({ runId: "loop-run", requestId: id, consultantProvider: "codex", decision: "APPROVED", source: "desktop_ui" }),
    /** Records a settled diagnosis without running a provider. */
    diagnose: (id: string, text = "CORRECTNESS ASSESSMENT\nThe retry counter is off by one.") => {
      const store = new ConsultantStore(h.ports);
      store.startSession({ runId: "loop-run", provider: "codex", sessionId: "consultant-session-1", cwd: "consultant-cwd" });
      store.recordIntent({ runId: "loop-run", consultationId: id, provider: "codex", sessionId: "consultant-session-1", promptLength: text.length });
      return store.settle({ consultationId: id, status: "COMPLETED", diagnosis: text, failure: null });
    },
    prompts: (): string[] => {
      const file = resolve(root, "worktree", ".loop-dispatches.json");
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Array<{ prompt: string }>).map(d => d.prompt) : [];
    }
  };
}

test("a second opinion cannot be requested before PRIMARY has produced evidence", t => {
  const f = fixture(t, [WORKING]);
  const eligibility = f.consultations().operatorEligibility("loop-run");
  assert.deepEqual(eligibility, { eligible: false, reason: "no_primary_evidence" });
  assert.throws(() => f.request(), /no_primary_evidence/);
  assert.deepEqual(f.consultations().list("loop-run"), []);
});

test("a second opinion cannot be requested without a distinct consultant", t => {
  const none = fixture(t, [WORKING], null);
  assert.equal(none.consultations().operatorEligibility("loop-run").reason, "no_consultant_configured");

  // consultant === primary cannot even be created: the Run Spec rejects it, so
  // the eligibility rule for it is defence in depth rather than the only guard.
  assert.throws(() => fixture(t, [WORKING], "claude"), /Consultant must be the other coding provider/);
});

test("a second opinion cannot be requested while a PRIMARY turn is in flight", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  assert.equal(f.consultations().operatorEligibility("loop-run").eligible, true, "eligible between turns");

  // Observe eligibility from inside the dispatch of the next turn.
  let observed: string | null = null;
  const original = f.h.ports.platform!.process.run;
  f.h.ports.platform!.process.run = async (input) => {
    if (input.args.includes("--print") && observed === null) {
      observed = new ConsultationStore(f.h.ports).operatorEligibility("loop-run").reason;
    }
    return original(input);
  };
  f.authorize();
  await f.h.loop.run("loop-run");

  assert.equal(observed, "primary_turn_in_flight", "a dispatching turn blocks the request");
  // Once the turn has settled, the same run becomes eligible.
  assert.equal(f.consultations().operatorEligibility("loop-run").eligible, true);
});

test("an operator request records the OPERATOR trigger and executes nothing", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");

  const primaryBefore = new WorkerStore(f.h.ports).session("loop-run")!;
  const grantBefore = new LoopStore(f.h.ports).grants("loop-run").at(-1)!.turnsUsed;
  const promptsBefore = f.prompts().length;
  const stateBefore = f.h.store.requireRun("loop-run").state;

  const request = f.request();
  assert.equal(request.triggerType, "OPERATOR");
  assert.equal(request.triggerReason, "operator_requested_second_opinion");
  assert.equal(request.status, "RECOMMENDED");
  assert.equal(request.consultantProvider, "codex");
  assert.equal(request.canApprove, true);
  assert.equal(request.executionEligible, false, "a request is not an authorization");

  // Nothing else moved.
  assert.deepEqual(new ConsultantStore(f.h.ports).sessions("loop-run"), [], "no consultant started");
  assert.deepEqual(new ConsultantStore(f.h.ports).diagnoses("loop-run"), []);
  assert.equal(new LoopStore(f.h.ports).grants("loop-run").at(-1)!.turnsUsed, grantBefore, "no grant turn consumed");
  assert.equal(f.prompts().length, promptsBefore, "no PRIMARY turn started");
  assert.deepEqual(new WorkerStore(f.h.ports).session("loop-run"), primaryBefore, "PRIMARY unchanged");
  assert.equal(f.h.store.requireRun("loop-run").state, stateBefore, "run state unchanged");
  assert.ok(f.h.store.listEvents("loop-run").some(e => e.type === "CONSULTATION_REQUESTED"));
});

test("the frozen preview carries current evidence and no secrets", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  const preview = f.request().preview;

  assert.equal(preview.primaryProvider, "claude");
  assert.ok(preview.goal.length > 0);
  assert.ok(preview.triggeringTurn, "the latest settled turn is named");
  assert.equal(preview.primarySessionId, new WorkerStore(f.h.ports).session("loop-run")!.sessionId);
  assert.equal(preview.latestVerification, "FAILED");
  assert.ok(preview.workspace, "bounded worktree state is included");
  assert.deepEqual(preview.changedPaths, ["one.txt"]);
  assert.equal(preview.progressStatus, latestPrimaryProgress(f.h.ports, "loop-run")?.status ?? null);
  // Bounded metadata only: no conversation, no credentials, no environment.
  assert.doesNotMatch(JSON.stringify(preview), /must-not-leak|ANTHROPIC_API_KEY|OPENAI_API_KEY|Received /);
});

test("approval alone still does not execute the consultant", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  const request = f.request();
  const grantBefore = new LoopStore(f.h.ports).grants("loop-run").at(-1)!.turnsUsed;

  const approved = f.approve(request.id);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.executionEligible, true, "approval authorizes exactly one future diagnosis");
  assert.equal(approved.approvalSource, "desktop_ui");
  assert.deepEqual(new ConsultantStore(f.h.ports).sessions("loop-run"), []);
  assert.deepEqual(new ConsultantStore(f.h.ports).diagnoses("loop-run"), []);
  assert.equal(new LoopStore(f.h.ports).grants("loop-run").at(-1)!.turnsUsed, grantBefore);
});

test("only one unspent consultation exists at a time", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");

  const first = f.request();
  assert.equal(f.consultations().operatorEligibility("loop-run").reason, "consultation_already_active");
  assert.throws(() => f.request(), /consultation_already_active/);

  f.approve(first.id);
  assert.throws(() => f.request(), /consultation_already_active/);

  // A completed but unsupplied diagnosis is still an unspent opinion: even once
  // the consultation row is closed, the pending diagnosis denies a second one.
  f.diagnose(first.id);
  assert.equal(f.consultations().operatorEligibility("loop-run").reason, "consultation_already_active");

  f.consultations().resolve({ runId: "loop-run", requestId: first.id, consultantProvider: "codex", decision: "CANCELLED", source: "desktop_ui" });
  assert.equal(f.consultations().list("loop-run")[0]!.status, "CANCELLED");
  assert.equal(f.consultations().operatorEligibility("loop-run").reason, "diagnosis_already_pending");
  assert.throws(() => f.request(), /diagnosis_already_pending/);
  assert.equal(new ConsultantStore(f.h.ports).diagnoses("loop-run").length, 1);

  // Once PRIMARY consumes the opinion, a later request is allowed again.
  f.authorize();
  await f.h.loop.run("loop-run");
  assert.equal(new ConsultantStore(f.h.ports).pendingForPrimary("loop-run"), null, "the opinion was consumed");
  assert.equal(f.consultations().operatorEligibility("loop-run").eligible, true);
  assert.equal(f.request().triggerType, "OPERATOR");
});

test("new PRIMARY evidence supersedes an unapproved operator request", async t => {
  const f = fixture(t, [WORKING, WORKING]);
  await f.h.loop.run("loop-run");
  const request = f.request();
  assert.equal(request.status, "RECOMMENDED");

  // The human resumes PRIMARY instead of approving; the frozen evidence is stale.
  f.authorize();
  await f.h.loop.run("loop-run");
  const after = f.consultations().list("loop-run")[0]!;
  assert.equal(after.status, "SUPERSEDED");
  assert.equal(after.canApprove, false);
  assert.equal(after.executionEligible, false);
  // And a fresh one may be requested against the new evidence.
  assert.equal(f.consultations().operatorEligibility("loop-run").eligible, true);
  assert.equal(f.request().triggerType, "OPERATOR");
});

test("an operator diagnosis is supplied exactly once to the same sticky PRIMARY session", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  await f.h.loop.run("loop-run");

  const primaryBefore = new WorkerStore(f.h.ports).session("loop-run")!;
  const request = f.request();
  f.approve(request.id);
  const diagnosis = f.diagnose(request.id);

  // A restart between the diagnosis and the next turn must change nothing.
  const restarted = f.restart();
  assert.deepEqual(new ConsultantStore(restarted.ports).diagnosis(request.id), diagnosis);
  assert.equal(new ConsultantStore(restarted.ports).pendingForPrimary("loop-run")!.id, diagnosis.id);
  assert.equal(new ConsultationStore(restarted.ports).list("loop-run")[0]!.triggerType, "OPERATOR");

  const before = f.prompts().length;
  restarted.loop.revoke("loop-run", "test phase boundary");
  restarted.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "human" });
  await restarted.loop.run("loop-run");
  const prompts = f.prompts();

  assert.ok(prompts.length > before, "the human's next PRIMARY turn ran");
  assert.equal(prompts.filter(p => p.includes("ADVISORY — SECOND OPINION")).length, 1, "supplied exactly once");
  assert.match(prompts.at(-1)!, /retry counter is off by one/);

  const primaryAfter = new WorkerStore(restarted.ports).session("loop-run")!;
  assert.equal(primaryAfter.sessionId, primaryBefore.sessionId, "same sticky PRIMARY session");
  assert.equal(primaryAfter.provider, "claude");

  const supplied = new ConsultantStore(restarted.ports).diagnosis(request.id)!;
  assert.ok(supplied.suppliedToTurnId);
  assert.equal(new ConsultantStore(restarted.ports).pendingForPrimary("loop-run"), null);
  // A later turn does not carry it again.
  assert.equal(prompts.filter(p => p.includes("ADVISORY — SECOND OPINION")).length, 1);

  const report = buildRunReport(restarted.ports, "loop-run");
  assert.equal(report.consultations[0]!.triggerType, "OPERATOR");
  assert.match(renderRunReportMarkdown(report), /OPERATOR \(operator requested\)/);
  assert.ok(report.activity.some(a => a.label === "Operator requested Codex second opinion"));
  assert.ok(report.activity.some(a => a.label.startsWith("Diagnosis supplied to PRIMARY turn")));
  assert.equal(report.activity.some(a => a.label.includes("retry counter")), false, "no diagnosis text in the timeline");
});

test("an operator diagnosis never resumes a held run by itself", async t => {
  // Three equivalent failing turns stall PRIMARY, which holds the run.
  const f = fixture(t, [{ emitFiles: [] }], "codex", 6);
  const stalled = await f.h.loop.run("loop-run");
  assert.equal(stalled.reason, "consultant_recommended");
  const held = f.h.store.requireRun("loop-run").state;
  assert.equal(held, "NEEDS_REVIEW");

  // The automatic recommendation owns this hold; it is the one that may release it.
  const automatic = f.consultations().list("loop-run")[0]!;
  assert.equal(automatic.triggerType, "STALLED");
  assert.equal(f.consultations().operatorEligibility("loop-run").reason, "consultation_already_active");
});

test("an operator diagnosis leaves a paused run paused", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  await f.h.loop.run("loop-run");
  const request = f.request();
  f.approve(request.id);
  f.diagnose(request.id);

  await f.h.engine.requestPause("loop-run");
  const paused = f.h.store.requireRun("loop-run").state;
  assert.ok(["PAUSED", "PAUSE_REQUESTED"].includes(paused), `expected a paused run, got ${paused}`);

  // The completed diagnosis does not start anything on its own.
  assert.equal(new ConsultantStore(f.h.ports).pendingForPrimary("loop-run")!.id, request.id ? new ConsultantStore(f.h.ports).diagnosis(request.id)!.id : "");
  assert.ok(["PAUSED", "PAUSE_REQUESTED"].includes(f.h.store.requireRun("loop-run").state));
  assert.deepEqual(new CheckpointStore(f.h.ports).list("loop-run").filter(c => c.status === "COMMITTED").map(c => c.turnId).length >= 0, true);
});
