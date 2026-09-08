import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createTestWorkspace } from "./helpers/harness.ts";
import { createTestRepository } from "./helpers/platform.ts";
import { openControlledHost } from "./helpers/controlledHostHarness.ts";
import { AutopilotControlCenter, validateNewRun, validateRoles, rolesFor, dashboardCategory, readiness, buildRunReport, createRunSpec, LoopStore, ClaudeCodeWorker, defaultEnforcedCapabilityPolicy, AutopilotStore, WorkerStore, AUTOPILOT_MIGRATIONS, runAutopilotMigrations, type NewRunForm } from "../src/index.ts";

function form(projectPath: string, primary: "claude" | "codex" = "claude"): NewRunForm {
  return { goal: "Implement the requested behavior", projectPath, primary, consultant: null, maxTurns: 3, maxFailures: 2,
    constraints: ["Keep APIs stable"], nonGoals: [], acceptance: [{ text: "Tests pass", tier: "test" }],
    verification: [{ tier: "test", enabled: true, executable: "node", args: ["--test"] }] };
}
async function setup(t: { after(fn: () => void): void }) {
  const space = createTestWorkspace();
  const repo = createTestRepository(resolve(space.dir, "repo"));
  const h = await openControlledHost(space.dir);
  t.after(() => { h.close(); space.cleanup(); });
  const center = new AutopilotControlCenter({ ports: h.ports, engine: h.host.engine, workers: h.host.workers, executable: provider => `${provider}.exe` });
  return { space, repo, h, center };
}
for (const provider of ["claude", "codex"] as const) {
  test(`legacy ${provider} maps to PRIMARY with no consultant`, () => {
    const spec = createRunSpec({ goal: "Legacy", provider }, { id: "legacy", now: "2026-01-01" });
    assert.deepEqual(rolesFor(spec), { primary: provider, consultant: null });
  });
  test(`${provider} UI model creates a bounded run and dormant opposite consultant`, async t => {
    const f = await setup(t);
    const input = form(f.repo, provider); input.consultant = provider === "claude" ? "codex" : "claude";
    const run = await f.center.create(input);
    const report = buildRunReport(f.h.ports, run.id);
    assert.equal(report.roles.primary.provider, provider);
    assert.equal(report.roles.consultant.provider, input.consultant);
    assert.equal(report.roles.consultant.sessionId, null);
    assert.equal(report.roles.primary.established, false);
    assert.ok(report.roles.primary.sessionId);
    assert.notEqual(report.provider.workspaceRoot, f.repo);
    assert.equal(report.loop.grants[0]!.maxTurns, 3);
    assert.equal(report.loop.grants[0]!.turnsUsed, 0);
    assert.equal(report.spec.verification.structuredCommands!.test!.executable, "node");
    assert.equal(f.h.calls.some(call => call.conversation || call.args.includes("--print")), false);
    assert.ok(report.activity.some(event => event.label === "Workspace prepared"));
    const before = f.center.dashboard();
    assert.equal(before.length, 1, "probe audit runs are excluded from dashboard");
    const second = await openControlledHost(f.space.dir);
    try {
      const after = await second.invoke("dashboard");
      assert.equal(after[0].primary, before[0]!.primary);
      assert.equal(after[0].consultant, before[0]!.consultant);
      assert.equal(after[0].category, before[0]!.category);
      const restored = await second.invoke("report", run.id);
      assert.equal(restored.roles.primary.sessionId, report.roles.primary.sessionId);
      assert.equal(restored.roles.primary.restored, true);
      assert.equal(restored.roles.consultant.sessionId, null);
      assert.deepEqual(restored.loop.grants, report.loop.grants);
      assert.deepEqual(restored.contextRequests, report.contextRequests);
    } finally { second.close(); }
  });
}
test("role validation rejects matching providers and missing primary", () => {
  assert.throws(() => validateRoles("claude", "claude"), /different/);
  assert.throws(() => validateRoles("codex", "codex"), /different/);
  assert.throws(() => validateRoles(undefined), /primary/);
  assert.deepEqual(validateRoles("claude"), { primary: "claude", consultant: null });
});
test("New Run rejects unsafe or incomplete form fields", () => {
  const valid = form("D:/Projects/example");
  assert.equal(validateNewRun(valid), valid);
  for (const patch of [{ goal: "" }, { maxTurns: 0 }, { maxTurns: 51 }, { maxFailures: 0 }, { projectPath: "relative" }, { projectPath: "D:/DeskNest/local-data" }, { acceptance: [] }, { verification: [] }]) {
    assert.throws(() => validateNewRun({ ...valid, ...patch }));
  }
  assert.throws(() => validateNewRun({ ...valid, verification: [{ tier: "test", enabled: true, executable: "cmd.exe", args: ["/c", "dir"] }] }), /Shell/);
});
test("readiness maps sanitized status and unavailable primary blocks creation", async t => {
  const f = await setup(t);
  const values = await f.center.detect(f.repo);
  assert.ok(values.every(value => value.installed && value.authenticated && value.available));
  assert.ok(!JSON.stringify(values).includes("must-not-leak"));
  assert.equal(readiness("claude", { installed: true, authenticated: false, version: "1", failure: "auth" }).available, false);
  const missing = new AutopilotControlCenter({ ports: f.h.ports, engine: f.h.host.engine, workers: f.h.host.workers, executable: () => "" });
  await assert.rejects(missing.create(form(f.repo)), /unavailable/);
  assert.equal(missing.dashboard().length, 0);
});
test("CONSULTANT cannot start implementation or spend a primary grant", async t => {
  const f = await setup(t);
  const run = await f.center.create(form(f.repo));
  const policy = defaultEnforcedCapabilityPolicy(); policy.workspaceRoot = run.spec.capabilities.workspaceRoot;
  const consultant = new ClaudeCodeWorker({ ports: f.h.ports, effects: f.h.host.engine.effects!, policy, executable: "claude.exe", role: "CONSULTANT", newSessionId: () => "unused" });
  assert.throws(() => consultant.startSession(run.id), /CONSULTANT execution/);
  await assert.rejects(consultant.sendPrompt({ runId: run.id, sendId: "forbidden", prompt: '<<<DEXNEST_FILE path="a.js">>>\nx\n<<<END_DEXNEST_FILE>>>' }), /CONSULTANT execution/);
  const loops = new LoopStore(f.h.ports);
  const grant = loops.grants(run.id)[0]!;
  assert.throws(() => loops.grant({ role: "CONSULTANT", runId: run.id, provider: "codex", sessionId: grant.sessionId, workspaceRoot: grant.workspaceRoot, maxTurns: 1, grantedBy: "test" }), /CONSULTANT/);
    assert.equal(loops.grants(run.id)[0]!.turnsUsed, 0);
    assert.throws(() => loops.consumeGrantForTurn("any-turn", "CONSULTANT"), /CONSULTANT/);
  assert.equal(buildRunReport(f.h.ports, run.id).checkpoints.length, 0);
});
test("dashboard state filters use durable runtime state and attention", () => {
  assert.equal(dashboardCategory("RUNNING"), "ACTIVE");
  assert.equal(dashboardCategory("NEEDS_REVIEW"), "NEEDS ATTENTION");
  assert.equal(dashboardCategory("PAUSED", true), "NEEDS ATTENTION");
  assert.equal(dashboardCategory("AWAITING_APPROVAL"), "NEEDS ATTENTION");
  assert.equal(dashboardCategory("COMPLETED"), "COMPLETED");
  assert.equal(dashboardCategory("FAILED"), "STOPPED / FAILED");
  assert.equal(dashboardCategory("STOPPED"), "STOPPED / FAILED");
});

test("legacy persisted provider-only specs remain usable without rewriting historical JSON", async t => {
  const f = await setup(t);
  for (const provider of ["claude", "codex"] as const) {
    const run = f.h.host.engine.createRun({ goal: "Legacy run", provider });
    const legacy = { ...run.spec, provider } as Record<string, unknown>; delete legacy.workers;
    const json = JSON.stringify(legacy);
    f.h.ports.db.prepare("UPDATE autopilot_runs SET spec_json=:json WHERE id=:id").run({ json, id: run.id });
    const report = buildRunReport(f.h.ports, run.id);
    assert.equal(report.roles.primary.provider, provider);
    assert.equal(report.roles.consultant.provider, null);
    assert.equal(f.h.ports.db.prepare("SELECT spec_json FROM autopilot_runs WHERE id=:id").get<{spec_json:string}>({ id: run.id })!.spec_json, json);
  }
});

test("migration assigns legacy sessions and grants to PRIMARY without changing identity", t => {
  const space = createTestWorkspace(); const h = space.openPorts();
  t.after(() => { h.close(); space.cleanup(); });
  runAutopilotMigrations(h.ports.db, "2026-01-01", AUTOPILOT_MIGRATIONS.filter(m => m.id <= 9));
  const store = new AutopilotStore(h.ports);
  const spec = createRunSpec({ goal: "Old run", provider: "codex" }, { id: "old", now: "2026-01-01" });
  store.createRun({ spec, executorId: "test" });
  new WorkerStore(h.ports).createSession({ runId: "old", provider: "codex", sessionId: "original-session", providerSessionId: "original-thread", cwd: "D:/Worktree", established: false });
  h.ports.db.prepare("UPDATE autopilot_worker_sessions SET provider_session_id='original-thread' WHERE run_id='old'").run();
  new LoopStore(h.ports).grant({ runId: "old", provider: "codex", sessionId: "original-session", workspaceRoot: "D:/Worktree", maxTurns: 3, grantedBy: "human" });
  // Version-agnostic: every migration after 9 must apply and preserve identity.
  const remaining = AUTOPILOT_MIGRATIONS.filter(m => m.id > 9).map(m => m.id);
  assert.deepEqual(runAutopilotMigrations(h.ports.db, "2026-01-02").applied, remaining);
  const report = buildRunReport(h.ports, "old");
  assert.equal(report.roles.primary.sessionId, "original-session");
  assert.equal(report.roles.primary.providerSessionId, "original-thread");
  assert.equal(report.roles.primary.restored, false);
  assert.equal(report.loop.grants[0]!.role, "PRIMARY");
  assert.equal(report.roles.consultant.sessionId, null);
  assert.throws(() => h.ports.db.exec("UPDATE autopilot_worker_sessions SET role='CONSULTANT'"), /CHECK/);
});

test("a project junction redirected into denied data never reaches provider probes or worktree creation", async t => {
  const f = await setup(t);
  f.h.ports.platform!.fs.realPath = () => "D:/DeskNest/local-data";
  await assert.rejects(f.center.create(form(f.repo)), /unavailable/);
  assert.equal(f.h.calls.length, 0);
  assert.equal(f.center.dashboard().length, 0);
});

for (const provider of ["claude", "codex"] as const) {
  test(`${provider} Control Center primary executes one fake turn through structured verification`, async t => {
    const f = await setup(t);
    const input = form(f.repo, provider); input.maxTurns = 1;
    const run = await f.center.create(input);
    const outcome = await f.h.host.workers.runLoop(run.id);
    const report = buildRunReport(f.h.ports, run.id);
    assert.equal(outcome.reason, "completed", outcome.detail);
    assert.equal(report.loop.grants[0]!.role, "PRIMARY");
    assert.equal(report.loop.grants[0]!.turnsUsed, 1);
    assert.equal(report.loop.turns.length, 1);
    assert.equal(report.loop.turns[0]!.verification!.outcome, "PASSED");
    assert.ok(report.loop.turns[0]!.verification!.tiers.some(tier => tier.tier === "test" && tier.ran));
    assert.ok(report.checkpoints.length > 0);
    assert.ok(report.activity.some(event => event.label === "Verification passed"));
    assert.equal(report.roles.primary.established, true);
    assert.equal(f.center.dashboard()[0]!.category, "COMPLETED");
  });
}

test("the worktree is a sibling of the project, with the project name intact", async t => {
  // Found by the first real two-provider trial: canonicalize().display is
  // backslash-separated on Windows, so deriving the parent by splitting on "/"
  // alone found nothing and silently dropped the project's last character,
  // putting the worktree in a near-miss sibling directory.
  const f = await setup(t);
  const run = await f.center.create(form(f.repo));
  const report = buildRunReport(f.h.ports, run.id);
  const worktree = report.spec.capabilities.workspaceRoot!.replace(/\\/g, "/");
  const project = f.repo.replace(/\\/g, "/");
  const parent = project.slice(0, project.lastIndexOf("/"));

  assert.equal(worktree, `${parent}/dexnest-worktrees/${run.id}`);
  assert.ok(worktree.startsWith(`${parent}/`), "the worktree sits beside the project");
  assert.equal(worktree.includes(`${project}/`), false, "and never inside it");
  // The decisive assertion: no truncated near-miss of the project directory.
  const name = project.slice(project.lastIndexOf("/") + 1);
  assert.equal(worktree.includes(`/${name.slice(0, -1)}/`), false, `worktree must not use a truncated project name: ${worktree}`);
});

test("a failed workspace preparation reports the reason the runtime recorded", async t => {
  // From the first dogfood run: the operator saw only "inspect run <id>" while
  // the real sentence — a path outside every write root — sat in the operation.
  const f = await setup(t);
  const worktree = { path: "" };
  f.h.ports.platform!.fs.realPath = (path: string) => {
    // Corrupt only the worktree, exactly as the drive-root path bug did.
    if (path.includes("dexnest-worktrees")) { worktree.path = path; return path.replace("dexnest-worktrees", "exnest-worktrees"); }
    return path;
  };

  await assert.rejects(f.center.create(form(f.repo)), (error: Error) => {
    assert.match(error.message, /Workspace preparation did not complete: /);
    assert.match(error.message, /outside every root this run may write/);
    assert.match(error.message, /run coding-run-/, "the run id is still named");
    return true;
  });

  // And the same bounded reason is durable, not only thrown.
  const failed = f.h.host.engine.listRuns(10).find(run => run.state === "FAILED")!;
  assert.ok(failed, "the run is marked FAILED");
  assert.match(failed.failureReason!, /Workspace preparation did not complete: .*outside every root/);
  assert.ok(failed.failureReason!.length <= 460, "the reason stays bounded");
  assert.ok(worktree.path.includes("dexnest-worktrees"), "the intent itself was never corrupted");
});

// --- re-running -------------------------------------------------------------

test("a re-run form reproduces the run it was cloned from", async t => {
  // The whole value of "Run again" is not retyping. Anything that silently
  // fails to carry across is worse than no button: the operator believes the
  // new run is judged the way the old one was, and it is not.
  const f = await setup(t);
  const input = form(f.repo, "claude");
  input.constraints = ["Keep APIs stable", "No new dependencies"];
  input.nonGoals = ["Rewriting the parser"];
  input.model = "opus";
  input.effort = "high";
  input.maxTurns = 12;
  input.maxIterations = 7;
  input.maxIdleTurns = 4;
  input.rotateSession = false;
  input.autoResumeOnLimit = true;
  input.verification = [
    { tier: "test", enabled: true, executable: "node", args: ["--test"] },
    { tier: "typecheck", enabled: true, executable: "node", args: ["tsc", "--noEmit"] }
  ];

  const run = await f.center.create(input);
  const again = f.center.rerunForm(run.id);

  assert.equal(again.goal, input.goal);
  assert.equal(again.projectPath, input.projectPath);
  assert.equal(again.primary, "claude");
  assert.deepEqual(again.constraints, input.constraints);
  assert.deepEqual(again.nonGoals, input.nonGoals);
  assert.equal(again.model, "opus");
  assert.equal(again.effort, "high");
  assert.equal(again.maxFailures, input.maxFailures);

  // The bounds live on the loop grant, not the spec, so these are the ones
  // most likely to be quietly dropped.
  assert.equal(again.maxTurns, input.maxTurns);
  assert.equal(again.maxIterations, 7);
  assert.equal(again.maxIdleTurns, 4);
  assert.equal(again.rotateSession, false);
  assert.equal(again.autoResumeOnLimit, true);

  // Both enabled tiers survive, with their commands, and nothing the operator
  // had turned off comes back on.
  const enabled = again.verification.filter(item => item.enabled);
  assert.deepEqual(enabled.map(item => item.tier).sort(), ["test", "typecheck"]);
  assert.deepEqual(enabled.find(item => item.tier === "typecheck")!.args, ["tsc", "--noEmit"]);
  assert.equal(again.verification.some(item => item.tier === "lint" && item.enabled), false);
});

test("a cloned form is valid input to create, and produces an equivalent run", async t => {
  // The round trip that matters: the form must not merely look right, it must
  // be something create() accepts without the operator editing anything.
  const f = await setup(t);
  const first = await f.center.create(form(f.repo, "claude"));
  const cloned = f.center.rerunForm(first.id);

  assert.doesNotThrow(() => validateNewRun(cloned));
  const second = await f.center.create(cloned);
  assert.notEqual(second.id, first.id, "cloning starts a new run, it does not resume the old one");

  const before = buildRunReport(f.h.ports, first.id);
  const after = buildRunReport(f.h.ports, second.id);
  assert.equal(after.roles.primary.provider, before.roles.primary.provider);
  assert.equal(after.loop.grants[0]!.maxTurns, before.loop.grants[0]!.maxTurns);
  assert.deepEqual(
    Object.keys(after.spec.verification.structuredCommands ?? {}).sort(),
    Object.keys(before.spec.verification.structuredCommands ?? {}).sort()
  );
});

test("a run that never got a grant is still worth cloning", async t => {
  // A run that failed during setup has no loop grant, and reading bounds off a
  // missing grant is exactly where this would throw. Falling back to the same
  // defaults New Run offers means the failure is recoverable by cloning it.
  const f = await setup(t);
  const run = await f.center.create(form(f.repo, "claude"));
  f.h.ports.db.prepare("DELETE FROM autopilot_loop_grants WHERE run_id=:id").run({ id: run.id });

  const again = f.center.rerunForm(run.id);
  assert.equal(again.maxTurns, 50, "the New Run default, not a crash");
  assert.equal(again.rotateSession, true);
  assert.doesNotThrow(() => validateNewRun(again));
});

test("cloning a run with no iteration bound does not invent one", async t => {
  // The bug this pins. A grant can legitimately bound by turns alone, stored
  // as maxIterations null. Defaulting that to 25 on the way back produced a
  // form whose iteration ceiling exceeded its turn ceiling — so "Run again"
  // handed the operator something that refused to submit.
  const f = await setup(t);
  const input = form(f.repo, "claude");
  delete input.maxIterations;
  const run = await f.center.create(input);

  const again = f.center.rerunForm(run.id);
  assert.equal(again.maxIterations, undefined, "unbounded stays unbounded");
  assert.doesNotThrow(() => validateNewRun(again));
});
