import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestWorkspace } from "./helpers/harness.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { AutopilotStore } from "../src/store.ts";
import { createRunSpec } from "../src/runSpec.ts";
import { ConsultationStore, type ConsultationRecord } from "../src/consultations.ts";
import { evaluatePrimaryProgress, type PrimaryProgress } from "../src/progress.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";
import { LoopStore } from "../src/loopStore.ts";
import { WorkerStore } from "../src/workerStore.ts";
import { ContextRequestStore } from "../src/contextRequests.ts";
import { CheckpointStore } from "../src/checkpoints.ts";
import { openControlledHost } from "./helpers/controlledHostHarness.ts";

function setup(t: { after(fn: () => void): void }, consultant: "codex" | null = "codex") {
  const space = createTestWorkspace();
  const opened = space.openPorts();
  t.after(() => { try { opened.close(); } catch {} space.cleanup(); });
  const ports = opened.ports;
  runAutopilotMigrations(ports.db, ports.clock.now());
  const store = new AutopilotStore(ports);
  store.createRun({ spec: createRunSpec({ goal: "Repair the tests", constraints: ["Keep APIs stable"],
    acceptanceCriteria: [{ id: "ac", text: "Tests pass", kind: "automated", check: "node --test" }],
    workers: { primary: "claude", consultant, sticky: true, fallback: null, consultantMode: false }
  }, { id: "run", now: ports.clock.now() }), executorId: "scripted" });
  const consultations = new ConsultationStore(ports);
  return { space, opened, ports, store, consultations };
}
function decision(status: "STALLED" | "BLOCKED" = "STALLED", recommended = true): PrimaryProgress {
  return { version: 1, status, reason: status === "STALLED" ? "equivalent_verification_without_change" : "terminal_obstacle:quota",
    turnId: null, turnOrdinal: null, verificationId: null, failureFingerprint: "abc", workspaceFingerprint: "def", requestFingerprint: null,
    consecutiveStalled: status === "STALLED" ? 3 : 0, consultantRecommended: recommended };
}
function recommend(f: ReturnType<typeof setup>, progress = decision()) {
  f.store.appendEvent("run", { type: "PRIMARY_PROGRESS_EVALUATED", payload: { decision: progress } });
  return f.consultations.list("run")[0]!;
}
function scope(c: ConsultationRecord) { return { runId: c.runId, requestId: c.id, consultantProvider: c.consultantProvider }; }

for (const status of ["STALLED", "BLOCKED"] as const) test(`${status} creates exactly one durable recommendation`, t => {
  const f = setup(t);
  const c = recommend(f, decision(status));
  assert.equal(c.status, "RECOMMENDED");
  assert.equal(c.canApprove, true);
  assert.equal(c.executionEligible, false);
  assert.equal(c.diagnosisLimit, 1);
  for (let i = 0; i < 3; i++) evaluatePrimaryProgress(f.ports, "run");
  assert.deepEqual(f.consultations.list("run"), [c]);
  assert.equal(f.store.listEvents("run").filter(e => e.type === "CONSULTATION_RECOMMENDED").length, 1);
  assert.equal(new WorkerStore(f.ports).session("run"), null);
});

test("no consultant or ineligible policy block produces no request", t => {
  const f = setup(t, null);
  recommend(f);
  assert.deepEqual(f.consultations.list("run"), []);
  const g = setup(t);
  recommend(g, { ...decision("BLOCKED", false), reason: "terminal_obstacle:policy" });
  assert.deepEqual(g.consultations.list("run"), []);
});

for (const action of [null, "APPROVED", "CANCELLED"] as const) test(`restart preserves ${action ?? "RECOMMENDED"} and frozen evidence exactly`, t => {
  const f = setup(t);
  const c = recommend(f);
  if (action) f.consultations.resolve({ ...scope(c), decision: action, source: "desktop_ui" });
  const before = buildRunReport(f.ports, "run").consultations;
  assert.equal(before[0]!.status, action ?? "RECOMMENDED");
  assert.equal(before[0]!.executionEligible, action === "APPROVED");
  f.opened.close();
  const reopened = f.space.openPorts();
  try {
    const store = new ConsultationStore(reopened.ports);
    store.recover(); store.recover();
    assert.deepEqual(buildRunReport(reopened.ports, "run").consultations, before);
    assert.equal(new WorkerStore(reopened.ports).session("run"), null);
    assert.equal(new WorkerStore(reopened.ports).list("run").length, 0);
    assert.deepEqual(new LoopStore(reopened.ports).grants("run"), []);
    if (action === "CANCELLED") assert.throws(() => store.resolve({ ...scope(c), decision: "APPROVED", source: "desktop_ui" }), /actionable/);
  } finally { reopened.close(); }
});

test("approval is scoped to request, run and provider; LoopGrant cannot confer approval", t => {
  const f = setup(t);
  const c = recommend(f);
  const input = { ...scope(c), decision: "APPROVED" as const, source: "desktop_ui" as const };
  assert.throws(() => f.consultations.resolve({ ...input, runId: "other" }), /not found/);
  assert.throws(() => f.consultations.resolve({ ...input, requestId: "other" }), /belong/);
  assert.throws(() => f.consultations.resolve({ ...input, consultantProvider: "claude" }), /mismatch/);
  const grant = new LoopStore(f.ports).grant({ runId: "run", provider: "claude", sessionId: "primary", workspaceRoot: "D:/scratch", maxTurns: 3, grantedBy: "human" });
  assert.throws(() => f.consultations.resolve({ ...input, source: `loop_grant:${grant.id}` as "desktop_ui" }), /explicit human/);
  assert.equal(f.consultations.list("run")[0]!.status, "RECOMMENDED");
  const approved = f.consultations.resolve(input);
  assert.equal(approved.executionEligible, true);
  assert.equal(f.consultations.executionEligible(scope(c)), true);
  assert.equal(f.consultations.executionEligible({ ...scope(c), consultantProvider: "claude" }), false);
  assert.equal(f.consultations.executionEligible({ ...scope(c), runId: "other" }), false);
  assert.equal(f.consultations.executionEligible({ ...scope(c), requestId: "other" }), false);
  assert.deepEqual(f.consultations.resolve(input), approved);
  assert.equal(f.store.listEvents("run").filter(e => e.type === "CONSULTATION_APPROVED").length, 1);
  assert.equal(new LoopStore(f.ports).activeGrant("run")!.turnsUsed, 0);
  const cancelled = f.consultations.resolve({ ...input, decision: "CANCELLED" });
  assert.equal(cancelled.executionEligible, false);
  assert.equal(cancelled.approvalSource, "desktop_ui");
  assert.equal(cancelled.canApprove, false);
});

for (const field of ["consultantProvider", "primaryProvider", "runId", "triggeringTurnId", "triggerReason", "preview", "diagnosisLimit"]) {
  test(`mutating approved ${field} invalidates eligibility`, t => {
    const f = setup(t);
    const c = recommend(f);
    f.consultations.resolve({ ...scope(c), decision: "APPROVED", source: "desktop_ui" });
    const row = f.ports.db.prepare("SELECT identity_json FROM autopilot_consultations WHERE id=:id").get<{ identity_json: string }>({ id: c.id })!;
    const identity = JSON.parse(row.identity_json);
    identity[field] = field === "preview" ? { ...identity.preview, goal: "Changed" } : field === "diagnosisLimit" ? 2 : "changed";
    f.ports.db.prepare("UPDATE autopilot_consultations SET identity_json=:identity WHERE id=:id").run({ id: c.id, identity: JSON.stringify(identity) });
    assert.equal(f.consultations.list("run")[0]!.executionEligible, false);
    f.consultations.reconcile("run");
    assert.equal(f.consultations.list("run")[0]!.status, "SUPERSEDED");
  });
}

for (const approved of [false, true]) test(`new PRIMARY progress supersedes ${approved ? "approved" : "recommended"} consultation atomically`, t => {
  const f = setup(t);
  const c = recommend(f);
  if (approved) f.consultations.resolve({ ...scope(c), decision: "APPROVED", source: "desktop_ui" });
  f.store.appendEvent("run", { type: "WORKER_OUTPUT_APPLIED", payload: { applied: 1, paths: ["src/fix.ts"] } });
  const superseded = f.consultations.list("run")[0]!;
  assert.equal(superseded.status, "SUPERSEDED");
  assert.equal(superseded.executionEligible, false);
  assert.equal(superseded.canApprove, false);
  evaluatePrimaryProgress(f.ports, "run");
  assert.equal(f.consultations.list("run").length, 1);
  assert.ok(f.store.listEvents("run").some(e => e.type === "CONSULTATION_SUPERSEDED"));
});

test("preview uses only bounded durable metadata and omits conversations, source and credentials", t => {
  const f = setup(t);
  const loops = new LoopStore(f.ports);
  const grant = loops.grant({ runId: "run", provider: "claude", sessionId: "primary", workspaceRoot: "D:/scratch", maxTurns: 3, grantedBy: "human" });
  const turn = loops.planTurn({ runId: "run", grantId: grant.id, kind: "REPAIR", prompt: "PRIVATE_CONVERSATION_SENTINEL" });
  const checkpoints = new CheckpointStore(f.ports);
  const checkpoint = checkpoints.recordIntent({ runId: "run", turnId: turn.id, ordinal: turn.ordinal, verificationId: null, summary: "prior verified evidence", headBefore: "abc123" });
  checkpoints.settle({ checkpointId: checkpoint.id, status: "NO_CHANGES", commitSha: "abc123" });
  f.store.appendEvent("run", { type: "WORKER_OUTPUT_APPLIED", payload: { applied: 1, paths: ["src/fix.ts", "local-data/private.txt"], contents: "SOURCE_SENTINEL" } });
  const tier = { tier: "test", command: "node --test", ran: true, ok: false, exitCode: 1, detail: "password=RAW_SECRET OUTPUT_SENTINEL", gating: true };
  loops.recordVerification({ runId: "run", turnId: turn.id, report: { outcome: "FAILED", summary: "OUTPUT_SENTINEL", tiers: [tier], failingTier: tier, configurationError: null, indeterminateReason: null, changedFiles: 1 } });
  new ContextRequestStore(f.ports).record({ runId: "run", turnId: turn.id, paths: ["src/fix.ts"] });
  const c = recommend(f, { ...decision(), turnId: turn.id, turnOrdinal: turn.ordinal });
  assert.equal(c.preview.goal, "Repair the tests");
  assert.deepEqual(c.preview.constraints, ["Keep APIs stable"]);
  assert.equal(c.preview.failingTier, "test");
  assert.equal(c.preview.triggeringTurn, 1);
  assert.deepEqual(c.preview.changedPaths, ["src/fix.ts", "[restricted path]"]);
  assert.equal(c.preview.contextRequests[0]!.status, "PENDING");
  assert.equal(c.preview.latestCheckpoint?.commitSha, "abc123");
  assert.doesNotMatch(JSON.stringify(c), /PRIVATE_CONVERSATION|RAW_SECRET|OUTPUT_SENTINEL|SOURCE_SENTINEL|local-data/);
  assert.match(renderRunReportMarkdown(buildRunReport(f.ports, "run")), /## Consultations/);
  assert.ok(buildRunReport(f.ports, "run").activity.some(e => e.label === "Consultation recommended"));
});

test("new progressing decision supersedes an old trigger without creating another recommendation", t => {
  const f = setup(t);
  recommend(f);
  f.store.appendEvent("run", { type: "PRIMARY_PROGRESS_EVALUATED", payload: { decision: { ...decision(), status: "PROGRESSING", consultantRecommended: false, reason: "changed_failure" } } });
  assert.equal(f.consultations.list("run")[0]!.status, "SUPERSEDED");
  assert.equal(f.consultations.list("run").length, 1);
});

test("SQLite enforces one active consultation per run", t => {
  const f = setup(t);
  const c = recommend(f);
  const otherEvent = f.store.listEvents("run")[0]!.id;
  assert.throws(() => f.ports.db.prepare(`INSERT INTO autopilot_consultations(id,run_id,trigger_event_id,identity_json,status,created_at)
    SELECT 'duplicate',run_id,:event,identity_json,'RECOMMENDED',created_at FROM autopilot_consultations WHERE id=:id`)
    .run({ id: c.id, event: otherEvent }), /UNIQUE/);
});

test("preview redacts recognizable credentials in human-authored prose", t => {
  const f = setup(t);
  const spec = f.store.requireRun("run").spec;
  spec.goal = "Repair API_KEY=do-not-show and sk-private-test-key";
  spec.constraints = ["password='never-copy-this'", "Authorization: Bearer hidden-auth"];
  f.ports.db.prepare("UPDATE autopilot_runs SET spec_json=:spec WHERE id='run'").run({ spec: JSON.stringify(spec) });
  const c = recommend(f);
  assert.doesNotMatch(JSON.stringify(c.preview), /do-not-show|sk-private-test-key|never-copy-this|hidden-auth/);
  assert.match(c.preview.goal, /redacted/);
});

test("recommendation and progress decision roll back together on persistence failure", t => {
  const f = setup(t);
  f.ports.db.exec("CREATE TRIGGER fail_consultation BEFORE INSERT ON autopilot_consultations BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(() => recommend(f), /test failure/);
  assert.equal(f.store.listEvents("run").filter(e => e.type === "PRIMARY_PROGRESS_EVALUATED").length, 0);
  assert.equal(f.consultations.list("run").length, 0);
});

test("trusted host approval/cancellation never starts provider or consultant session", async t => {
  const space = createTestWorkspace();
  const h = await openControlledHost(space.dir);
  t.after(() => { h.close(); space.cleanup(); });
  h.host.engine.createRun({ id: "consult-host", goal: "Repair", workers: { primary: "claude", consultant: "codex", sticky: true, fallback: null, consultantMode: false } });
  h.host.engine.store.appendEvent("consult-host", { type: "PRIMARY_PROGRESS_EVALUATED", payload: { decision: decision() } });
  const report = await h.invoke("report", "consult-host");
  const c = report.consultations[0];
  const before = h.calls.length;
  const approved = await h.invoke("consultation-approve", scope(c));
  assert.equal(approved.executionEligible, true);
  assert.equal((await h.invoke("report", "consult-host")).roles.consultant.sessionId, null);
  assert.equal(h.calls.length, before);
  assert.equal((await h.invoke("consultation-cancel", scope(c))).status, "CANCELLED");
  assert.equal(h.calls.length, before);
  assert.ok(h.audit.some((event: any) => event.metadata?.actionId === "autopilot.consultation_approve"));
});
