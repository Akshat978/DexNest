// Bounded, redacted diagnostics for failed provider processes.
//
// Real SQLite, real child processes, the real policy and the real dispatcher.
// The only stand-ins are the provider CLIs, so no model is contacted and no
// quota is spent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createTestWorkspace } from "./helpers/harness.ts";
import { createTestRepository, createGitPort } from "./helpers/platform.ts";
import { openWorker } from "./helpers/workerHarness.ts";
import { openControlledHost } from "./helpers/controlledHostHarness.ts";
import {
  WorkerDiagnosticsStore, redactSecrets, boundedTail, classifyProviderFailure,
  secretEnvironmentValues, MAX_DIAGNOSTIC_TAIL_BYTES
} from "../src/diagnostics.ts";
import { defaultCapabilityPolicy } from "../src/policy.ts";
import { runAutopilotMigrations, AUTOPILOT_MIGRATIONS } from "../src/migrations.ts";
import { AutopilotStore } from "../src/store.ts";
import { createRunSpec } from "../src/runSpec.ts";
import { ConsultationStore, type ConsultationRecord } from "../src/consultations.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";
import type { PrimaryProgress } from "../src/progress.ts";
import type { RunRecord } from "../src/index.ts";

/** Tells the provider fixture exactly what to emit, and to fail. */
function arm(cwd: string, spec: { stdout?: string; stderr?: string; exitCode?: number }): void {
  mkdirSync(cwd, { recursive: true });
  writeFileSync(resolve(cwd, ".fake-diag.json"), JSON.stringify(spec), "utf8");
}

const STALL: PrimaryProgress = {
  version: 1, status: "STALLED", reason: "equivalent_verification_without_change",
  turnId: null, turnOrdinal: null, verificationId: null, failureFingerprint: "abc",
  workspaceFingerprint: "def", requestFingerprint: null, consecutiveStalled: 3, consultantRecommended: true
};

// ---------------------------------------------------------------------------
// Redaction and bounding, in isolation.
// ---------------------------------------------------------------------------

test("named secret assignments are redacted, keeping the name", () => {
  const text = [
    "ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop",
    "OPENAI_API_KEY: sk-proj-0123456789abcdef",
    'AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCY"',
    "GITHUB_TOKEN=ghp_0123456789abcdefghij",
    "NPM_TOKEN=npm_0123456789abcdefghij",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
  ].join("\n");
  const redacted = redactSecrets(text);

  for (const secret of ["sk-ant-abcdefghijklmnop", "sk-proj-0123456789abcdef", "wJalrXUtnFEMI/K7MDENG/bPxRfiCY",
    "ghp_0123456789abcdefghij", "npm_0123456789abcdefghij", "eyJhbGciOiJIUzI1NiJ9.payload.signature", "AKIAIOSFODNN7EXAMPLE"]) {
    assert.equal(redacted.includes(secret), false, `leaked: ${secret}`);
  }
  // The names survive, so the reader still learns which credential was involved.
  assert.match(redacted, /ANTHROPIC_API_KEY/);
  assert.match(redacted, /Authorization/);
});

test("environment-derived secret values are redacted using DexNest's own classification", () => {
  const policy = defaultCapabilityPolicy();
  const env = {
    ANTHROPIC_API_KEY: "value-that-must-never-be-stored",
    MY_SERVICE_TOKEN: "another-secret-value-here",
    PATH: "C:/Windows/System32",
    LANG: "en_US.UTF-8"
  };
  const values = secretEnvironmentValues(policy, env);
  assert.ok(values.includes("value-that-must-never-be-stored"));
  assert.ok(values.includes("another-secret-value-here"));
  // Non-secret variables are not treated as secrets, so ordinary text survives.
  assert.equal(values.includes("C:/Windows/System32"), false);
  assert.equal(values.includes("en_US.UTF-8"), false);

  const redacted = redactSecrets("failed while using value-that-must-never-be-stored on PATH C:/Windows/System32", values);
  assert.equal(redacted.includes("value-that-must-never-be-stored"), false);
  assert.match(redacted, /C:\/Windows\/System32/);
});

test("bounding keeps the tail, not the middle", () => {
  const text = "HEAD-MARKER" + "x".repeat(MAX_DIAGNOSTIC_TAIL_BYTES * 2) + "TAIL-MARKER";
  const { tail, truncated } = boundedTail(text);
  assert.equal(truncated, true);
  assert.ok(Buffer.byteLength(tail, "utf8") <= MAX_DIAGNOSTIC_TAIL_BYTES);
  assert.match(tail, /TAIL-MARKER$/);
  assert.equal(tail.includes("HEAD-MARKER"), false);
  // Short output is kept whole and not marked truncated.
  assert.deepEqual(boundedTail("short"), { tail: "short", truncated: false });
});

test("classification only fires on unambiguous CLI evidence", () => {
  assert.equal(classifyProviderFailure({ stderr: "Error: Input must be provided either through stdin" }), "input_protocol");
  assert.equal(classifyProviderFailure({ stderr: "Usage limit reached" }), "quota");
  assert.equal(classifyProviderFailure({ stderr: "Not logged in" }), "unauthenticated");
  assert.equal(classifyProviderFailure({ stderr: "No conversation found with session ID" }), "session_not_found");
  assert.equal(classifyProviderFailure({ transportFailure: "spawn" }), "not_installed");
  assert.equal(classifyProviderFailure({ transportFailure: "timeout" }), "timeout");
  assert.equal(classifyProviderFailure({ transportFailure: "interrupted" }), "interrupted");
  // Anything else stays generic rather than being guessed.
  assert.equal(classifyProviderFailure({ stderr: "something went sideways", exitCode: 3 }), "process");
  assert.equal(classifyProviderFailure({}), "process");
});

// ---------------------------------------------------------------------------
// Capture through the real worker path.
// ---------------------------------------------------------------------------

async function primaryFixture(
  t: { after(fn: () => void): void },
  provider: "claude" | "codex" = "claude",
  goal = "Diagnostics"
) {
  const space = createTestWorkspace();
  const repo = createTestRepository(resolve(space.dir, "repo"));
  const cwd = resolve(space.dir, "worktree");
  createGitPort().addWorktree({ repoRoot: repo, worktreePath: cwd, branch: "diag-test", baseRef: "HEAD" });
  let h = await openControlledHost(space.dir);
  t.after(() => { try { h.close(); } catch { /* already closed */ } space.cleanup(); });

  const run: RunRecord = await h.invoke("create-run", {
    goal, projectPath: repo,
    workers: { primary: provider, consultant: provider === "claude" ? "codex" : "claude", sticky: true, fallback: null, consultantMode: false },
    capabilities: { workspaceRoot: cwd, allowedPaths: [], forbiddenPaths: ["local-data"], allowedCommands: [], forbiddenCommands: [], requiresApproval: [] }
  });
  return {
    space, cwd, run,
    get h() { return h; },
    async restart() { h.close(); h = await openControlledHost(space.dir); },
    async turn(prompt: string) {
      const prepared = await h.invoke("worker-prepare", { runId: run.id, prompt });
      return h.invoke("worker-send", { runId: run.id, sendId: prepared.id });
    },
    diagnostics: () => new WorkerDiagnosticsStore(h.ports).list(run.id)
  };
}

test("a failed Claude PRIMARY process stores bounded stderr, exit code and category", async t => {
  const f = await primaryFixture(t);
  arm(f.cwd, { stderr: "Error: Input must be provided either through stdin or as a prompt argument when using --print", exitCode: 1 });

  const send = await f.turn("__diag__ please fix the thing");
  assert.notEqual(send.status, "COMPLETED");

  const [diagnostic, ...rest] = f.diagnostics().filter(d => d.role === "PRIMARY");
  assert.equal(rest.length, 0, "one diagnostic per failed operation");
  assert.equal(diagnostic!.provider, "claude");
  assert.equal(diagnostic!.role, "PRIMARY");
  assert.equal(diagnostic!.category, "input_protocol");
  assert.equal(diagnostic!.exitCode, 1);
  assert.match(diagnostic!.stderrTail, /Input must be provided either through stdin/);
  assert.equal(diagnostic!.stderrTruncated, false);
  assert.ok(diagnostic!.stderrBytes > 0);
  // It is attached to the operation that failed, not to a floating record.
  assert.equal(new WorkerDiagnosticsStore(f.h.ports).forOperation(diagnostic!.operationId)!.id, diagnostic!.id);
});

test("a failed Codex PRIMARY process stores bounded stderr", async t => {
  const f = await primaryFixture(t, "codex");
  arm(f.cwd, { stderr: "codex: Usage limit exceeded for this account", exitCode: 1 });

  const send = await f.turn("__diag__ do the work");
  assert.notEqual(send.status, "COMPLETED");

  const diagnostic = f.diagnostics().find(d => d.role === "PRIMARY" && d.provider === "codex");
  assert.ok(diagnostic, "codex PRIMARY failure was recorded");
  assert.equal(diagnostic!.category, "quota");
  assert.match(diagnostic!.stderrTail, /Usage limit exceeded/);
});

test("a successful worker turn stores no failure diagnostics", async t => {
  const f = await primaryFixture(t);
  const send = await f.turn("Please make the change");
  assert.equal(send.status, "COMPLETED");
  assert.ok(send.result?.ok, "the fake provider succeeded");

  assert.deepEqual(f.diagnostics().filter(d => d.role === "PRIMARY"), [], "model output is not evidence");
  // And the successful reply text is nowhere in the diagnostics table.
  assert.equal(
    f.diagnostics().some(d => d.stdoutTail.includes("Please make the change") || d.stderrTail.includes("Please make the change")),
    false
  );
});

test("large stderr and stdout are truncated to their tails when persisted", async t => {
  const f = await primaryFixture(t);
  const filler = "E".repeat(MAX_DIAGNOSTIC_TAIL_BYTES * 2);
  arm(f.cwd, {
    stderr: `STDERR-HEAD${filler}STDERR-TAIL-MARKER`,
    stdout: `STDOUT-HEAD${"O".repeat(MAX_DIAGNOSTIC_TAIL_BYTES * 2)}STDOUT-TAIL-MARKER`,
    exitCode: 2
  });

  await f.turn("__diag__ overflow");
  const diagnostic = f.diagnostics().find(d => d.role === "PRIMARY")!;

  assert.equal(diagnostic.stderrTruncated, true);
  assert.equal(diagnostic.stdoutTruncated, true);
  assert.ok(Buffer.byteLength(diagnostic.stderrTail, "utf8") <= MAX_DIAGNOSTIC_TAIL_BYTES);
  assert.ok(Buffer.byteLength(diagnostic.stdoutTail, "utf8") <= MAX_DIAGNOSTIC_TAIL_BYTES);
  // The tail is what survives; the head is dropped.
  assert.match(diagnostic.stderrTail, /STDERR-TAIL-MARKER$/);
  assert.match(diagnostic.stdoutTail, /STDOUT-TAIL-MARKER$/);
  assert.equal(diagnostic.stderrTail.includes("STDERR-HEAD"), false);
  assert.equal(diagnostic.stdoutTail.includes("STDOUT-HEAD"), false);
  // The byte counts still report what the process really emitted.
  assert.ok(diagnostic.stderrBytes > MAX_DIAGNOSTIC_TAIL_BYTES);
  assert.equal(diagnostic.exitCode, 2);
});

test("secrets are redacted before they reach SQLite", async t => {
  const f = await primaryFixture(t);
  arm(f.cwd, {
    stderr: [
      "ANTHROPIC_API_KEY=sk-ant-must-never-be-stored-01",
      "OPENAI_API_KEY=sk-proj-must-never-be-stored-02",
      "Authorization: Bearer must-never-be-stored-03-token",
      "using must-not-leak from the environment"
    ].join("\n"),
    exitCode: 1
  });

  await f.turn("__diag__ leak check");

  // Read the raw column, not the projection: persistence itself must be clean.
  const stored = f.h.ports.db
    .prepare("SELECT stderr_tail, stdout_tail FROM autopilot_worker_diagnostics")
    .all<{ stderr_tail: string; stdout_tail: string }>({})
    .map(row => `${row.stderr_tail}\n${row.stdout_tail}`)
    .join("\n");

  for (const secret of ["sk-ant-must-never-be-stored-01", "sk-proj-must-never-be-stored-02", "must-never-be-stored-03-token"]) {
    assert.equal(stored.includes(secret), false, `leaked to SQLite: ${secret}`);
  }
  // The harness puts ANTHROPIC_API_KEY=must-not-leak in the child environment;
  // its value is scrubbed by the environment classification, not by a pattern.
  assert.equal(stored.includes("must-not-leak"), false, "environment-derived secret leaked");
  assert.match(stored, /ANTHROPIC_API_KEY/, "the variable name is still legible");
});

test("a failed consultant process stores diagnostics under the CONSULTANT role", async t => {
  const f = await primaryFixture(t, "claude", "__diag__ diagnose the stall");
  arm(f.cwd, { stderr: "codex: Not logged in. Run `codex login`.", exitCode: 1 });

  f.h.host.engine.store.appendEvent(f.run.id, { type: "PRIMARY_PROGRESS_EVALUATED", payload: { decision: STALL } });
  const consultation: ConsultationRecord = new ConsultationStore(f.h.ports).list(f.run.id)[0]!;
  const scope = { runId: f.run.id, requestId: consultation.id, consultantProvider: consultation.consultantProvider };
  await f.h.invoke("consultation-approve", scope);
  await f.h.invoke("consultation-run", scope).catch(() => { /* the diagnosis fails; that is the point */ });

  const diagnostic = f.diagnostics().find(d => d.role === "CONSULTANT");
  assert.ok(diagnostic, "consultant failure was recorded");
  assert.equal(diagnostic!.provider, "codex");
  assert.match(diagnostic!.stderrTail, /Not logged in/);
  assert.equal(diagnostic!.category, "unauthenticated");
});

test("diagnostics reconstruct identically after restart, and reach the report and UI projection", async t => {
  const f = await primaryFixture(t);
  arm(f.cwd, { stderr: "Error: Input must be provided either through stdin", exitCode: 1 });
  await f.turn("__diag__ persist me");

  const before = f.diagnostics();
  assert.equal(before.length, 1);

  await f.restart();

  const after = f.diagnostics();
  assert.deepEqual(after, before, "no renderer-only diagnostic memory");

  const report = buildRunReport(f.h.ports, f.run.id);
  // The report carries the durable record plus the human label the renderer uses,
  // so it needs no copy of the category vocabulary.
  assert.deepEqual(report.workerDiagnostics.map(({ categoryLabel, ...durable }) => durable), before);
  assert.deepEqual(report.workerDiagnostics.map(d => d.categoryLabel), ["input/protocol error"]);
  const markdown = renderRunReportMarkdown(report);
  assert.match(markdown, /## Provider failures/);
  assert.match(markdown, /input\/protocol error/);
  assert.match(markdown, /Input must be provided/);

  // The timeline carries the one-line form and never the stderr body.
  const row = report.activity.find(a => a.label.includes("failed:"));
  assert.ok(row, "a concise failure row is present");
  assert.equal(row!.label, "Claude worker failed: input/protocol error");
  assert.equal(report.activity.some(a => a.label.includes("Input must be provided")), false);

  // The UI reads the same report shape the renderer is given.
  const snapshot = await f.h.invoke("report", f.run.id);
  assert.equal(snapshot.workerDiagnostics.length, 1);
  assert.equal(snapshot.workerDiagnostics[0].category, "input_protocol");
});

test("a database migrated before this feature stays valid and reports no diagnostics", t => {
  const space = createTestWorkspace();
  const opened = space.openPorts();
  t.after(() => { try { opened.close(); } catch { /* already closed */ } space.cleanup(); });

  // Apply every migration except the diagnostics one, i.e. a historical database.
  const legacy = AUTOPILOT_MIGRATIONS.filter(m => m.name !== "worker_process_diagnostics");
  runAutopilotMigrations(opened.ports.db, opened.ports.clock.now(), legacy);
  const store = new AutopilotStore(opened.ports);
  store.createRun({ spec: createRunSpec({ goal: "legacy" }, { id: "legacy-run", now: opened.ports.clock.now() }), executorId: "scripted" });

  const diagnostics = new WorkerDiagnosticsStore(opened.ports);
  assert.deepEqual(diagnostics.list("any-run"), [], "absent table reads as no diagnostics");
  assert.equal(diagnostics.forOperation("any-op"), null);
  assert.equal(
    diagnostics.record({ runId: "any-run", operationId: "any-op", scope: { provider: "claude", role: "PRIMARY" }, category: "process" }),
    null,
    "recording is a no-op rather than an error on a historical database"
  );

  // Then the migration applies cleanly on top of that historical database.
  const applied = runAutopilotMigrations(opened.ports.db, opened.ports.clock.now()).applied;
  assert.deepEqual(applied, [AUTOPILOT_MIGRATIONS.find(m => m.name === "worker_process_diagnostics")!.id]);
  assert.deepEqual(new WorkerDiagnosticsStore(opened.ports).list("any-run"), []);
});

test("only declared provider operations produce diagnostics", async t => {
  const f = await primaryFixture(t);
  // A failing verification command is an ordinary process, not a provider one.
  const worker = openWorker(f.space.dir, 42);
  try {
    const policy = defaultCapabilityPolicy();
    policy.workspaceRoot = f.cwd;
    policy.allowedCommands = [{ executable: "node", decision: "ALLOW", reason: "test", risk: "low" }];
    await worker.effects.request({
      runId: f.run.id, stepKey: "plain-process", policy,
      intent: { kind: "RUN_COMMAND", executable: "node", args: ["-e", "process.stderr.write('boom');process.exit(1)"], cwd: f.cwd, timeoutMs: 15000, purpose: "ordinary command" }
    });
    assert.deepEqual(new WorkerDiagnosticsStore(worker.ports).list(f.run.id), [],
      "DexNest does not start logging every process");
  } finally { worker.close(); }
});

test("a provider failure inside a cleanly exiting process is still recorded", async t => {
  // Found by the first real operator-consultation trial: Codex speaks its
  // protocol over stdio and exits 0 even when the turn failed, so a genuine
  // quota refusal settled as a COMPLETED operation with no diagnostics at all.
  const f = await primaryFixture(t, "codex");
  const send = await f.turn("__quota__");

  assert.equal(send.status, "FAILED");
  assert.equal(send.result?.failure, "quota");
  // The process itself exited cleanly; only the provider's own result says no.
  const operation = f.h.host.engine.effects!.operations.require(send.operationId!);
  assert.equal(operation.status, "COMPLETED");
  assert.equal(operation.exitCode, 0);

  const [diagnostic, ...rest] = f.diagnostics();
  assert.ok(diagnostic, "the refusal is durably inspectable");
  assert.equal(rest.length, 0, "still one row per operation");
  assert.equal(diagnostic!.provider, "codex");
  assert.equal(diagnostic!.role, "PRIMARY");
  assert.equal(diagnostic!.category, "quota");
  assert.equal(diagnostic!.operationId, operation.id);
  assert.doesNotMatch(JSON.stringify(diagnostic), /must-not-leak/);

  // And it reaches the report and the timeline like any other failure.
  const report = buildRunReport(f.h.ports, f.run.id);
  assert.equal(report.workerDiagnostics[0]!.categoryLabel, "quota exhausted");
  assert.ok(report.activity.some(a => a.label === "Codex worker failed: quota exhausted"));
});

test("a consultant refused by its provider is durably inspectable", async t => {
  const f = await primaryFixture(t, "claude", "__quota__ diagnose this");
  f.h.host.engine.store.appendEvent(f.run.id, { type: "PRIMARY_PROGRESS_EVALUATED", payload: { decision: STALL } });
  const consultation = new ConsultationStore(f.h.ports).list(f.run.id)[0]!;
  const scope = { runId: f.run.id, requestId: consultation.id, consultantProvider: consultation.consultantProvider };
  await f.h.invoke("consultation-approve", scope);
  const diagnosis = await f.h.invoke("consultation-run", scope);

  assert.equal(diagnosis.status, "FAILED");
  assert.equal(diagnosis.failure, "quota");
  const diagnostic = f.diagnostics().find(d => d.role === "CONSULTANT");
  assert.ok(diagnostic, "the consultant refusal is recorded, not silently lost");
  assert.equal(diagnostic!.provider, "codex");
  assert.equal(diagnostic!.category, "quota");
});
