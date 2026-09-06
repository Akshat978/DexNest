// Controlled PRIMARY ownership handoff.
//
// The hard invariant under test is single-writer: at most one provider may
// implement at any moment, and no crash window may produce two owners.
//
// Real SQLite, a real git worktree, real child processes, the real policy and
// dispatcher. The provider CLIs are local fixtures, so no model is contacted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { OwnershipStore, HandoffStore, currentRoles, buildHandoffPackage, packageFingerprint } from "../src/handoff.ts";
import { ConsultantStore } from "../src/consultant.ts";
import { LoopStore } from "../src/loopStore.ts";
import { WorkerStore } from "../src/workerStore.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";
import { authoritativeFingerprint } from "../src/runSpec.ts";

const WORKING: LoopPlanStep = { emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 1 } };
const FINISHING: LoopPlanStep = { emitFiles: [{ path: "two.txt", contents: "two\n" }], verify: { typecheck: 0 } };

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[], consultant: "codex" | null = "codex", turns = 1) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-handoff-"));
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
    handoffs: () => new HandoffStore(h.ports),
    ownership: () => new OwnershipStore(h.ports),
    propose: (toProvider: "claude" | "codex" = "codex") =>
      new HandoffStore(h.ports).propose({ runId: "loop-run", toProvider, source: "OPERATOR", requestedBy: "desktop_ui" }),
    approve: (id: string, toProvider: "claude" | "codex" = "codex") =>
      new HandoffStore(h.ports).resolve({ runId: "loop-run", handoffId: id, toProvider, decision: "APPROVED", source: "desktop_ui" }),
    prompts: (): string[] => {
      const file = resolve(root, "worktree", ".loop-dispatches.json");
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Array<{ prompt: string }>).map(d => d.prompt) : [];
    }
  };
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

test("a handoff cannot be proposed before PRIMARY has produced evidence", t => {
  const f = fixture(t, [WORKING]);
  assert.deepEqual(f.handoffs().eligibility("loop-run"), { eligible: false, reason: "no_primary_evidence", target: null });
  assert.throws(() => f.propose(), /no_primary_evidence/);
  assert.deepEqual(f.handoffs().list("loop-run"), []);
});

test("a handoff needs a configured alternate provider that is not the current owner", async t => {
  const alone = fixture(t, [WORKING], null);
  await alone.h.loop.run("loop-run");
  assert.equal(alone.handoffs().eligibility("loop-run").reason, "no_alternate_provider");

  const paired = fixture(t, [WORKING]);
  await paired.h.loop.run("loop-run");
  assert.equal(paired.handoffs().eligibility("loop-run", "claude").reason, "target_is_current_primary");
  assert.throws(() => paired.propose("claude"), /target_is_current_primary/);
});

test("a handoff cannot be proposed while a PRIMARY turn is in flight", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  assert.equal(f.handoffs().eligibility("loop-run").eligible, true, "eligible between turns");

  let observed: string | null = null;
  const original = f.h.ports.platform!.process.run;
  f.h.ports.platform!.process.run = async (input) => {
    if (input.args.includes("--print") && observed === null) {
      observed = new HandoffStore(f.h.ports).eligibility("loop-run").reason;
    }
    return original(input);
  };
  f.h.loop.revoke("loop-run", "test phase");
  f.h.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "human" });
  await f.h.loop.run("loop-run");
  assert.equal(observed, "primary_turn_in_flight");
});

test("a proposal freezes a package and changes nothing about the run", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");

  const primaryBefore = new WorkerStore(f.h.ports).session("loop-run")!;
  const grantBefore = new LoopStore(f.h.ports).grants("loop-run").at(-1)!;
  const promptsBefore = f.prompts().length;
  const stateBefore = f.h.store.requireRun("loop-run").state;

  const handoff = f.propose();
  assert.equal(handoff.status, "PROPOSED");
  assert.equal(handoff.source, "OPERATOR");
  assert.equal(handoff.fromProvider, "claude");
  assert.equal(handoff.toProvider, "codex");
  assert.equal(handoff.reason, "operator_requested_handoff");
  assert.equal(handoff.canApprove, true);
  assert.equal(handoff.canActivate, false, "a proposal is not an authorization");
  assert.ok(handoff.packageFingerprint.startsWith("hp-"));
  assert.equal(handoff.specFingerprint, authoritativeFingerprint(f.h.store.requireRun("loop-run").spec));
  assert.equal(handoff.packageFingerprint, packageFingerprint(handoff.package));

  // The frozen package carries the work, not a conversation or a secret.
  assert.equal(handoff.package.fromProvider, "claude");
  assert.equal(handoff.package.toProvider, "codex");
  assert.deepEqual(handoff.package.changedPaths, ["one.txt"]);
  assert.equal(handoff.package.latestVerification?.outcome, "FAILED");
  assert.ok(handoff.package.attempts.length >= 1);
  assert.ok(handoff.package.doNotChange.length > 0);
  assert.doesNotMatch(JSON.stringify(handoff.package), /must-not-leak|ANTHROPIC_API_KEY|OPENAI_API_KEY|Received /);

  // Nothing moved.
  assert.equal(new OwnershipStore(f.h.ports).primaryProvider("loop-run", f.h.store.requireRun("loop-run").spec), "claude");
  assert.deepEqual(new WorkerStore(f.h.ports).session("loop-run"), primaryBefore);
  assert.deepEqual(new LoopStore(f.h.ports).grants("loop-run").at(-1), grantBefore);
  assert.equal(f.prompts().length, promptsBefore, "no provider was started");
  assert.equal(f.h.store.requireRun("loop-run").state, stateBefore);
  assert.deepEqual(new ConsultantStore(f.h.ports).sessions("loop-run"), []);

  // Only one open handoff at a time.
  assert.equal(f.handoffs().eligibility("loop-run").reason, "handoff_already_open");
  assert.throws(() => f.propose(), /handoff_already_open/);
});

test("approval alone authorizes activation and does nothing else", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  const proposed = f.propose();
  const grantBefore = new LoopStore(f.h.ports).grants("loop-run").at(-1)!;
  const primaryBefore = new WorkerStore(f.h.ports).session("loop-run")!;

  const approved = f.approve(proposed.id);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvalSource, "desktop_ui");
  assert.equal(approved.canActivate, true);

  assert.equal(new OwnershipStore(f.h.ports).primaryProvider("loop-run", f.h.store.requireRun("loop-run").spec), "claude");
  assert.deepEqual(new WorkerStore(f.h.ports).session("loop-run"), primaryBefore);
  assert.deepEqual(new LoopStore(f.h.ports).grants("loop-run").at(-1), grantBefore);
  assert.equal(f.prompts().length, 1, "no provider was started");
});

test("new PRIMARY evidence supersedes an unactivated handoff", async t => {
  const f = fixture(t, [WORKING, WORKING]);
  await f.h.loop.run("loop-run");
  const proposed = f.propose();
  f.approve(proposed.id);

  // The human continues with the existing owner instead of activating.
  f.h.loop.revoke("loop-run", "test phase");
  f.h.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "human" });
  await f.h.loop.run("loop-run");

  const after = f.handoffs().list("loop-run")[0]!;
  assert.equal(after.status, "SUPERSEDED");
  assert.equal(after.canActivate, false);
  // A superseded handoff cannot be activated, and ownership never moved.
  assert.throws(() => f.h.workers.activateHandoff({
    runId: "loop-run", handoffId: after.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui"
  }), /stale|not approved for activation/);
  assert.equal(new OwnershipStore(f.h.ports).primaryProvider("loop-run", f.h.store.requireRun("loop-run").spec), "claude");
});

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/** Drives one PRIMARY turn, then proposes and approves a handoff to Codex. */
async function readyToActivate(f: ReturnType<typeof fixture>) {
  await f.h.loop.run("loop-run");
  const proposed = f.propose();
  return f.approve(proposed.id);
}

test("activation moves ownership exactly once and preserves the previous owner", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  const approved = await readyToActivate(f);
  const outgoingSession = new WorkerStore(f.h.ports).session("loop-run")!;
  const specBefore = authoritativeFingerprint(f.h.store.requireRun("loop-run").spec);
  const worktreeBefore = f.h.store.requireRun("loop-run").spec.capabilities.workspaceRoot;

  const result = f.h.workers.activateHandoff({
    runId: "loop-run", handoffId: approved.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui"
  });

  // Exactly one owner, and it is the new provider.
  const ownership = new OwnershipStore(f.h.ports);
  const run = f.h.store.requireRun("loop-run");
  assert.equal(ownership.primaryProvider("loop-run", run.spec), "codex");
  const history = ownership.history("loop-run");
  assert.equal(history.filter(entry => entry.status === "ACTIVE").length, 1, "exactly one active owner");
  assert.equal(history.length, 2, "the previous owner is preserved as history");
  assert.equal(history[0]!.provider, "claude");
  assert.equal(history[0]!.status, "HISTORICAL");
  assert.equal(history[0]!.sessionId, outgoingSession.sessionId, "the previous PRIMARY session is preserved");
  assert.ok(history[0]!.retiredAt);
  assert.equal(history[1]!.provider, "codex");
  assert.equal(history[1]!.handoffId, approved.id);

  // The incoming owner has its own PRIMARY session, not the consultant's.
  const incoming = new WorkerStore(f.h.ports).session("loop-run")!;
  assert.equal(incoming.provider, "codex");
  assert.notEqual(incoming.sessionId, outgoingSession.sessionId);
  assert.equal(incoming.established, false);
  assert.equal(result.handoff.toSessionId, incoming.sessionId);
  assert.deepEqual(new ConsultantStore(f.h.ports).sessions("loop-run"), [], "no consultant session was promoted");

  // Same worktree, same Run Spec.
  assert.equal(run.spec.capabilities.workspaceRoot, worktreeBefore);
  assert.equal(authoritativeFingerprint(run.spec), specBefore, "the Run Spec is untouched");
  assert.equal(run.spec.workers.primary, "claude", "ownership lives beside the spec, not inside it");

  // A fresh bounded grant, belonging only to the new owner.
  const grants = new LoopStore(f.h.ports).grants("loop-run");
  assert.equal(grants.at(-1)!.id, result.grant.id);
  assert.equal(grants.at(-1)!.provider, "codex");
  assert.equal(grants.at(-1)!.sessionId, incoming.sessionId);
  assert.equal(grants.at(-1)!.turnsUsed, 0);
  assert.notEqual(grants.at(0)!.status, "ACTIVE", "the outgoing owner's grant is closed");

  // Roles swapped: the displaced provider is now the consultant.
  assert.deepEqual(currentRoles(f.h.ports, "loop-run", run.spec), { primary: "codex", consultant: "claude" });
  assert.equal(f.handoffs().list("loop-run")[0]!.status, "ACTIVE");
});

test("the displaced provider cannot write, and its grant authorizes nothing", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  const approved = await readyToActivate(f);
  const outgoing = new WorkerStore(f.h.ports).session("loop-run")!;
  f.h.workers.activateHandoff({ runId: "loop-run", handoffId: approved.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui" });

  const loops = new LoopStore(f.h.ports);
  // A grant for the displaced provider is refused outright.
  assert.throws(() => loops.grant({
    runId: "loop-run", provider: "claude", sessionId: outgoing.sessionId,
    workspaceRoot: f.h.store.requireRun("loop-run").spec.capabilities.workspaceRoot!, maxTurns: 1, grantedBy: "human"
  }), /Only the PRIMARY provider may receive a LoopGrant|already has an active loop grant/);

  // And the run's single PRIMARY session no longer belongs to it.
  assert.equal(new WorkerStore(f.h.ports).session("loop-run")!.provider, "codex");
  assert.notEqual(new WorkerStore(f.h.ports).session("loop-run")!.sessionId, outgoing.sessionId);
});

test("an active handoff cannot be cancelled backwards", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  const approved = await readyToActivate(f);
  f.h.workers.activateHandoff({ runId: "loop-run", handoffId: approved.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui" });

  const active = f.handoffs().list("loop-run")[0]!;
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.canCancel, false);
  assert.throws(() => f.handoffs().resolve({
    runId: "loop-run", handoffId: active.id, toProvider: "codex", decision: "CANCELLED", source: "desktop_ui"
  }), /no longer actionable/);
  assert.equal(new OwnershipStore(f.h.ports).primaryProvider("loop-run", f.h.store.requireRun("loop-run").spec), "codex");

  // Reversing ownership is a new handoff in the opposite direction.
  const reverse = f.handoffs().eligibility("loop-run");
  assert.equal(reverse.target, "claude", "the displaced provider is now the handoff target");
});

test("a cancelled proposal cannot activate", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  const proposed = f.propose();
  const cancelled = f.handoffs().resolve({ runId: "loop-run", handoffId: proposed.id, toProvider: "codex", decision: "CANCELLED", source: "desktop_ui" });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.canActivate, false);
  assert.throws(() => f.h.workers.activateHandoff({
    runId: "loop-run", handoffId: proposed.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui"
  }), /not approved for activation/);
  assert.equal(new OwnershipStore(f.h.ports).primaryProvider("loop-run", f.h.store.requireRun("loop-run").spec), "claude");
  // Cancelling frees the run for a fresh proposal.
  assert.equal(f.handoffs().eligibility("loop-run").eligible, true);
});

// ---------------------------------------------------------------------------
// The incoming owner's first turn
// ---------------------------------------------------------------------------

test("the incoming owner's first turn carries the frozen briefing, once", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  // Give the outgoing owner a consultant diagnosis so the package carries it.
  await f.h.loop.run("loop-run");
  const consultants = new ConsultantStore(f.h.ports);
  const approvedHandoff = (() => {
    const proposed = f.propose();
    return f.approve(proposed.id);
  })();

  f.h.workers.activateHandoff({ runId: "loop-run", handoffId: approvedHandoff.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui" });
  const before = f.prompts().length;
  await f.h.workers.runLoop("loop-run");
  const prompts = f.prompts();

  assert.ok(prompts.length > before, "the incoming owner ran a turn");
  const first = prompts[before]!;
  assert.match(first, /OWNERSHIP HANDOFF — YOU ARE NOW THE PRIMARY IMPLEMENTATION OWNER/);
  assert.match(first, /previously owned by claude/);
  assert.match(first, /Do not restart the project/);
  assert.match(first, /WHAT THE PREVIOUS OWNER LEFT/);
  assert.match(first, /THINGS NOT TO CHANGE/);
  // The existing work is described, not re-requested.
  assert.match(first, /one\.txt/);

  // Exactly once: later turns do not repeat it.
  assert.equal(prompts.filter(p => p.includes("OWNERSHIP HANDOFF")).length, 1);
  void consultants;
});

test("a prior consultant diagnosis travels in the handoff package", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");

  const store = new ConsultantStore(f.h.ports);
  store.startSession({ runId: "loop-run", provider: "codex", sessionId: "consultant-session-1", cwd: "cwd" });
  // A diagnosis needs a consultation row to hang from; reuse the operator path.
  const { ConsultationStore } = await import("../src/consultations.ts");
  const consultation = new ConsultationStore(f.h.ports).requestOperator({ runId: "loop-run", consultantProvider: "codex", source: "desktop_ui" });
  store.recordIntent({ runId: "loop-run", consultationId: consultation.id, provider: "codex", sessionId: "consultant-session-1", promptLength: 10 });
  store.settle({ consultationId: consultation.id, status: "COMPLETED", diagnosis: "ROOT CAUSE\nThe golden file was never updated.", failure: null });

  const pkg = buildHandoffPackage(f.h.ports, "loop-run", "codex");
  assert.ok(pkg.consultantDiagnosis, "the diagnosis is included");
  assert.equal(pkg.consultantDiagnosis!.provider, "codex");
  assert.match(pkg.consultantDiagnosis!.text, /golden file was never updated/);
});

// ---------------------------------------------------------------------------
// Durability
// ---------------------------------------------------------------------------

test("a proposal and an approval reconstruct after restart", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  const proposed = f.propose();

  let restarted = f.restart();
  const afterProposal = new HandoffStore(restarted.ports).list("loop-run")[0]!;
  assert.equal(afterProposal.status, "PROPOSED");
  assert.equal(afterProposal.canApprove, true);
  assert.equal(afterProposal.packageFingerprint, proposed.packageFingerprint);

  new HandoffStore(restarted.ports).resolve({ runId: "loop-run", handoffId: proposed.id, toProvider: "codex", decision: "APPROVED", source: "desktop_ui" });
  restarted = f.restart();
  const afterApproval = new HandoffStore(restarted.ports).list("loop-run")[0]!;
  assert.equal(afterApproval.status, "APPROVED");
  assert.equal(afterApproval.canActivate, true, "activation eligibility survives a restart");
});

test("ownership and the new grant reconstruct after restart", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  const approved = await readyToActivate(f);
  const result = f.h.workers.activateHandoff({ runId: "loop-run", handoffId: approved.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui" });

  const restarted = f.restart();
  const ownership = new OwnershipStore(restarted.ports);
  const run = restarted.store.requireRun("loop-run");
  assert.equal(ownership.primaryProvider("loop-run", run.spec), "codex");
  assert.equal(ownership.history("loop-run").filter(entry => entry.status === "ACTIVE").length, 1);
  assert.equal(new WorkerStore(restarted.ports).session("loop-run")!.provider, "codex");
  const grant = new LoopStore(restarted.ports).activeGrant("loop-run")!;
  assert.equal(grant.id, result.grant.id);
  assert.equal(grant.provider, "codex");
  assert.equal(new HandoffStore(restarted.ports).list("loop-run")[0]!.status, "ACTIVE");
});

test("an interrupted activation resolves to exactly one owner", async t => {
  const f = fixture(t, [WORKING]);
  await f.h.loop.run("loop-run");
  const proposed = f.propose();
  f.approve(proposed.id);

  // Model a crash after the activation intent was journaled and before anything
  // else committed: the handoff is ACTIVATING while ownership never moved.
  new HandoffStore(f.h.ports).beginActivationUnsafe(proposed.id);
  assert.equal(f.handoffs().list("loop-run")[0]!.status, "ACTIVATING");

  const restarted = f.restart();
  new HandoffStore(restarted.ports).reconcileActivation("loop-run");

  const record = new HandoffStore(restarted.ports).list("loop-run")[0]!;
  assert.equal(record.status, "FAILED");
  assert.equal(record.failure, "activation_interrupted");
  const ownership = new OwnershipStore(restarted.ports);
  const run = restarted.store.requireRun("loop-run");
  assert.equal(ownership.primaryProvider("loop-run", run.spec), "claude", "the original owner still owns the run");
  assert.ok(ownership.history("loop-run").filter(entry => entry.status === "ACTIVE").length <= 1, "never two owners");
  assert.equal(new WorkerStore(restarted.ports).session("loop-run")!.provider, "claude");
  // A fresh proposal is required.
  assert.equal(new HandoffStore(restarted.ports).eligibility("loop-run").eligible, true);
});

test("the report records ownership history and handoffs", async t => {
  const f = fixture(t, [WORKING, FINISHING]);
  const approved = await readyToActivate(f);
  f.h.workers.activateHandoff({ runId: "loop-run", handoffId: approved.id, toProvider: "codex", maxTurns: 1, grantedBy: "desktop_ui" });

  const report = buildRunReport(f.h.ports, "loop-run");
  assert.equal(report.ownership.length, 2);
  assert.equal(report.handoffs.length, 1);
  assert.equal(report.handoffs[0]!.status, "ACTIVE");
  assert.equal(report.roles.primary.provider, "codex");
  assert.equal(report.roles.consultant.provider, "claude");

  const markdown = renderRunReportMarkdown(report);
  assert.match(markdown, /## Implementation ownership/);
  assert.match(markdown, /claude -> codex/);

  assert.ok(report.activity.some(a => a.label === "Handoff to Codex proposed"));
  assert.ok(report.activity.some(a => a.label === "Claude handed PRIMARY ownership to Codex"));
  // The package itself never enters the timeline.
  assert.equal(report.activity.some(a => a.label.includes("WHAT THE PREVIOUS OWNER LEFT")), false);
});
