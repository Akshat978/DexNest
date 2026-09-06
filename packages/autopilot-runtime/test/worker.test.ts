import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "./helpers/harness.ts";
import { createTestRepository, createGitPort } from "./helpers/platform.ts";
import { openWorker, SESSION_ID } from "./helpers/workerHarness.ts";
import { createRunSpec } from "../src/runSpec.ts";
import { AutopilotEngine } from "../src/engine.ts";
import { ScriptedExecutor, MemorySideEffectLedger } from "../src/scriptedExecutor.ts";
import { claudeCodeProtocol } from "../src/claudeCodeWorker.ts";

function setup(t: { after(fn: () => void): void }, hooks?: Parameters<typeof openWorker>[2]) {
  const space = createTestWorkspace();
  const repo = createTestRepository(resolve(space.dir, "repo"));
  const worktree = resolve(space.dir, "worktree");
  createGitPort().addWorktree({ repoRoot: repo, worktreePath: worktree, branch: "autopilot-test", baseRef: "HEAD" });
  const h = openWorker(space.dir, 1, hooks);
  h.store.createRun({ spec: createRunSpec({ id: "worker-run", projectPath: repo, goal: "One prompt",
    workers: { primary: "claude", fallback: null, sticky: true, consultantMode: false },
    capabilities: { workspaceRoot: worktree, allowedPaths: [], forbiddenPaths: [], allowedCommands: [], forbiddenCommands: [], requiresApproval: [] }
  }, { id: "worker-run", now: h.ports.clock.now() }), executorId: "worker-foundation" });
  h.store.appendEvent("worker-run", { type: "RUN_READY", toState: "READY" });
  h.store.appendEvent("worker-run", { type: "RUN_STARTED", toState: "RUNNING" });
  t.after(() => { h.close(); space.cleanup(); });
  return { ...h, root: space.dir, worktree };
}
const send = (h: ReturnType<typeof openWorker>, id = "send-1", prompt = "Hello") =>
  h.worker.sendPrompt({ runId: "worker-run", sendId: id, prompt });

test("same run keeps its session across prompts and a fresh runtime", async (t) => {
  const h = setup(t);
  assert.equal(h.worker.startSession("worker-run").established, false);
  assert.equal((await send(h)).status, "COMPLETED");
  const reopened = openWorker(h.root, 2);
  try {
    assert.equal(reopened.worker.resumeSession("worker-run").sessionId, SESSION_ID);
    const second = await send(reopened, "send-2", "Follow up");
    assert.equal(second.status, "COMPLETED");
    assert.match(second.result!.text, /Follow up/);
    assert.equal(reopened.worker.sessionAvailability("worker-run"), "last_confirmed");
  } finally { reopened.close(); }
  const records = readFileSync(resolve(h.worktree, ".fake-dispatches"), "utf8").trim().split("\n").map(s => JSON.parse(s));
  assert.deepEqual(records.map(r => [r.sessionId, r.resume]), [[SESSION_ID, false], [SESSION_ID, true]]);
  assert.equal(h.store.requireRun("worker-run").state, "RUNNING", "worker completion never claims the goal is complete");
});

test("intent is committed before dispatch; private stdin, filtered env, worktree cwd", async (t) => {
  const h = setup(t);
  h.policy.environment.stripPatterns = []; // The API-key prohibition is unconditional.
  const run = h.ports.platform!.process.run;
  h.ports.platform!.process.run = async input => {
    // Independent SQLite connection sees committed identity before the CLI starts.
    const observer = openWorker(h.root, 3);
    assert.equal(observer.worker.sessions.send("send-1")!.status, "DISPATCHING");
    assert.ok(observer.store.listEvents("worker-run").some(e => e.type === "WORKER_SEND_INTENT"));
    observer.close();
    assert.equal(input.cwd, h.worktree);
    assert.equal(input.stdin, "private prompt 😀");
    assert.ok(!input.args.includes("private prompt 😀"));
    assert.ok(!Object.keys(input.env).some(k => k.toUpperCase() === "ANTHROPIC_API_KEY"));
    assert.ok(!input.args.some(a => /bypass|skip-permissions|acceptEdits|fork-session/.test(a)));
    return run(input);
  };
  assert.equal((await send(h, "send-1", "private prompt 😀")).result!.text, "Received private prompt 😀");
  assert.ok(!JSON.stringify(h.store.listEvents("worker-run")).includes("private prompt"));
  assert.ok(!JSON.stringify(h.effects.operations.listForRun("worker-run")).includes("private prompt"));
  assert.equal((await send(h, "send-1", "private prompt 😀")).status, "COMPLETED");
  assert.equal(h.calls.length, 1, "duplicate API call returns durable result without a new process");
  await assert.rejects(send(h, "send-1", "changed"), /identity/i);
});

for (const mode of ["intent", "dispatch"]) {
  test(`hard crash after ${mode}: restart enters review and never resends`, async (t) => {
    const h = setup(t);
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings",
      resolve(dirname(fileURLToPath(import.meta.url)), "helpers/workerCrashChild.ts"), h.root, mode], { encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.equal(child.status, 9, child.stderr);
    assert.equal(h.worker.sessions.send("send-crash")!.status, mode === "intent" ? "INTENT" : "DISPATCHING");
    assert.equal(existsSync(resolve(h.worktree, ".fake-dispatches")), mode === "dispatch");
    const engine = new AutopilotEngine({ ports: h.ports, executor: new ScriptedExecutor({ steps: [], ledger: new MemorySideEffectLedger() }), policy: h.policy });
    assert.equal((await engine.reconcile("worker-run", { autoResume: true })).resolvedState, "NEEDS_REVIEW");
    assert.equal((await engine.reconcile("worker-run")).resolvedState, "NEEDS_REVIEW");
    assert.equal(h.worker.sessions.send("send-crash")!.status, "UNCERTAIN");
    await assert.rejects(send(h, "send-crash", "Crash test"));
    await assert.rejects(send(h, "new-send"));
    assert.equal(h.calls.length, 0);
  });
}

test("approved send reuses the same intent, while denied or changed prompts never dispatch", async (t) => {
  const h = setup(t);
  h.policy.approvalCommands.push({ executable: "claude", decision: "REQUIRE_APPROVAL", reason: "External worker", risk: "high" });
  const first = await send(h);
  assert.equal(first.status, "AWAITING_APPROVAL"); assert.equal(h.calls.length, 0);
  const approval = h.effects.listPendingApprovals("worker-run")[0]!;
  h.effects.operations.resolveApproval({ approvalId: approval.id, status: "APPROVED", source: "human" });
  await assert.rejects(send(h, "send-1", "changed"));
  assert.equal((await send(h)).status, "COMPLETED");
  assert.equal(h.calls.length, 1);
  assert.equal(h.effects.operations.listForRun("worker-run").length, 1);
});

test("default deny, local-data, wrong workspace and paused runs remain blocked", async (t) => {
  const h = setup(t);
  h.policy.allowedCommands = [];
  assert.equal((await send(h)).result!.failure, "policy"); assert.equal(h.calls.length, 0);
  h.policy.workspaceRoot = "D:/DeskNest/local-data";
  assert.throws(() => h.worker.resumeSession("worker-run"), /worktree/);
  h.policy.workspaceRoot = h.worktree;
  h.store.appendEvent("worker-run", { type: "PAUSE_REQUESTED", toState: "PAUSE_REQUESTED", pauseRequested: true });
  await assert.rejects(send(h, "send-2"), /unpaused/);
});

test("cancelled approval cannot later send the prompt", async (t) => {
  const h = setup(t);
  h.policy.approvalCommands.push({ executable: "claude", decision: "REQUIRE_APPROVAL", reason: "External worker", risk: "high" });
  assert.equal((await send(h)).status, "AWAITING_APPROVAL");
  await h.worker.cancel("worker-run");
  assert.equal(h.worker.sessions.send("send-1")!.status, "CANCELLED");
  assert.equal(h.effects.listPendingApprovals("worker-run").length, 0);
  assert.equal((await send(h)).status, "CANCELLED");
  assert.equal(h.calls.length, 0);
});

test("dispatcher refuses a replay even outside the worker facade", async (t) => {
  const h = setup(t);
  const session = h.worker.startSession("worker-run");
  const intent = claudeCodeProtocol("claude.exe").prompt(session, "First");
  await assert.rejects(h.effects.request({ runId: "worker-run", stepKey: "uncertain", policy: h.policy, intent,
    beforeDispatch: () => { throw new Error("crash boundary"); } }), /crash boundary/);
  await assert.rejects(h.effects.request({ runId: "worker-run", stepKey: "uncertain", policy: h.policy, intent }), /reconciliation/);
  const operation = h.effects.operations.listForRun("worker-run")[0]!;
  assert.throws(() => h.effects.operations.markDispatched(operation.id), /already dispatched/);
  assert.equal(h.calls.length, 0);
});

test("run stop also interrupts an adapter-owned process without a loop", { skip: process.platform !== "win32" }, async (t) => {
  const h = setup(t);
  const engine = new AutopilotEngine({ ports: h.ports, executor: new ScriptedExecutor({ steps: [], ledger: new MemorySideEffectLedger() }), policy: h.policy });
  const running = send(h, "stop-send", "__block__");
  for (let n = 0; n < 200 && !existsSync(resolve(h.worktree, ".fake-tree")); n++) await new Promise(r => setTimeout(r, 20));
  assert.ok(existsSync(resolve(h.worktree, ".fake-tree")));
  assert.equal((await engine.requestStop("worker-run")).state, "STOPPED");
  assert.equal((await running).result!.failure, "interrupted");
  await assert.rejects(send(h, "after-stop"), /stopped|terminal/);
});

test("detects installation and subscription auth without sending a prompt", async (t) => {
  const h = setup(t);
  assert.deepEqual(await h.worker.detect("worker-run"), { installed: true, authenticated: true, version: "2.1.207", failure: null });
  writeFileSync(resolve(h.worktree, ".fake-auth"), JSON.stringify({ loggedIn: false }));
  assert.equal((await h.worker.detect("worker-run")).failure, "auth");
  writeFileSync(resolve(h.worktree, ".fake-auth"), JSON.stringify({ loggedIn: true, authMethod: "api_key" }));
  assert.equal((await h.worker.detect("worker-run")).authenticated, false);
  assert.equal(existsSync(resolve(h.worktree, ".fake-dispatches")), false);
});

for (const [prompt, failure] of [["__auth__", "auth"], ["__quota__", "quota"], ["__truncated__", "protocol"]] as const) {
  test(`classifies ${failure} distinctly`, async (t) => {
    const h = setup(t);
    const result = await send(h, "send-1", prompt);
    assert.equal(result.result!.failure, failure);
    assert.equal(result.status, failure === "protocol" ? "UNCERTAIN" : "FAILED");
    if (failure === "protocol") assert.equal(h.store.requireRun("worker-run").state, "NEEDS_REVIEW");
  });
}

test("missing/expired provider session never creates a replacement", async (t) => {
  const h = setup(t);
  h.worker.startSession("worker-run");
  h.ports.db.prepare("UPDATE autopilot_worker_sessions SET established=1 WHERE run_id=:id").run({ id: "worker-run" });
  const result = await send(h);
  assert.equal(result.result!.failure, "session");
  assert.ok(h.calls[0]!.args.includes("--resume"));
  assert.equal(h.worker.sessions.session("worker-run")!.sessionId, SESSION_ID);
});

test("protocol rejects mismatched session and distinguishes transport failures", () => {
  const p = claudeCodeProtocol("claude.exe");
  const base = { ok: false, summary: "failed", exitCode: -1 };
  assert.equal(p.parseInstallation({ ...base, detail: { failure: "spawn" } }).failure, "not_installed");
  for (const failure of ["timeout", "interrupted"] as const) assert.equal(p.completion({ ...base, detail: { failure } }, SESSION_ID).failure, failure);
  assert.equal(p.completion({ ...base, stdout: JSON.stringify({ type: "result", session_id: "other" }) }, SESSION_ID).failure, "session");
  assert.throws(() => claudeCodeProtocol("claude.cmd"), /native/);
});

test("interrupt terminates only the owned worker tree; no stale PID remains", { skip: process.platform !== "win32" }, async (t) => {
  const h = setup(t);
  const unrelated = h.realProcess.run({ runId: "unrelated", operationId: "unrelated", executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"], cwd: h.worktree, env: { SystemRoot: process.env.SystemRoot ?? "C:/Windows" }, timeoutMs: 15000 });
  const foreign = h.realProcess.ownedProcesses("unrelated")[0]!;
  const running = send(h, "send-block", "__block__");
  const treePath = resolve(h.worktree, ".fake-tree");
  for (let n = 0; n < 200 && !existsSync(treePath); n++) await new Promise(r => setTimeout(r, 20));
  assert.ok(existsSync(treePath));
  const tree = JSON.parse(readFileSync(treePath, "utf8"));
  try {
    await assert.rejects(h.realProcess.terminate({ ...foreign, runId: "worker-run" }), /owned/);
    await h.worker.interrupt("worker-run");
    const result = await running;
    assert.equal(result.result!.failure, "interrupted");
    assert.equal(result.status, "UNCERTAIN");
    assert.throws(() => process.kill(tree.parent, 0));
    assert.throws(() => process.kill(tree.child, 0));
    assert.doesNotThrow(() => process.kill(foreign.pid, 0));
    assert.equal(h.realProcess.ownedProcesses("worker-run").length, 0);
    await h.worker.cancel("worker-run");
  } finally { await h.realProcess.terminate(foreign); await unrelated; }
});
