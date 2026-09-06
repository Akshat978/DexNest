import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "./helpers/harness.ts";
import { createTestRepository, createGitPort } from "./helpers/platform.ts";
import { openControlledHost } from "./helpers/controlledHostHarness.ts";
import type { RunSnapshot, RunRecord, WorkerSend } from "../src/index.ts";

async function setup(t: { after(fn: () => void): void }) {
  const space = createTestWorkspace();
  const repo = createTestRepository(resolve(space.dir, "repo"));
  const cwd = resolve(space.dir, "worktree");
  createGitPort().addWorktree({ repoRoot: repo, worktreePath: cwd, branch: "controlled-test", baseRef: "HEAD" });
  let h = await openControlledHost(space.dir);
  t.after(() => { h.close(); space.cleanup(); });
  const run: RunRecord = await h.invoke("create-run", { goal: "Controlled turn", projectPath: repo,
    workers: { primary: "claude", sticky: true, fallback: null, consultantMode: false },
    capabilities: { workspaceRoot: cwd, allowedPaths: [], forbiddenPaths: ["local-data"], allowedCommands: [], forbiddenCommands: [], requiresApproval: [] } });
  return { root: space.dir, repo, cwd, run, get h() { return h; }, async restart() { h.close(); h = await openControlledHost(space.dir); },
    prepare: (prompt = "Hello", retryOf?: string): Promise<WorkerSend> => h.invoke("worker-prepare", { runId: run.id, prompt, retryOf }),
    send: (sendId: string): Promise<WorkerSend> => h.invoke("worker-send", { runId: run.id, sendId }),
    resolve: (sendId: string, decision: string) => h.invoke("worker-resolve", { runId: run.id, sendId, decision, evidence: "Checked provider session and dispatch record" }),
    snapshot: (): Promise<RunSnapshot & { worker: ReturnType<typeof h.host.workers.snapshot> }> => h.invoke("get-run", run.id),
    dispatches: (): any[] => existsSync(resolve(cwd, ".fake-dispatches")) ? readFileSync(resolve(cwd, ".fake-dispatches"), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [] };
}

test("host prepares without sending; explicit approval sends one saved prompt and resumes the same session after restart", async t => {
  const f = await setup(t);
  const prepared = await f.prepare("<script>untrusted output</script>");
  assert.equal(prepared.status, "AWAITING_APPROVAL");
  assert.equal(f.dispatches().length, 0);
  const session = (await f.snapshot()).worker.session!;
  await f.restart();
  assert.equal((await f.snapshot()).worker.session!.sessionId, session.sessionId);
  assert.equal((await f.snapshot()).worker.sends[0]!.id, prepared.id);
  assert.equal((await f.send(prepared.id)).status, "COMPLETED");
  await f.send(prepared.id);
  assert.equal(f.dispatches().length, 1);
  assert.equal((await f.snapshot()).run.state, "PAUSED");
  await f.restart();
  const second = await f.prepare("Second explicitly approved turn");
  await f.send(second.id);
  assert.deepEqual(f.dispatches().map(row => [row.sessionId, row.resume]), [[session.sessionId, false], [session.sessionId, true]]);
  for (const call of f.h.calls.filter(call => call.stdin)) {
    assert.equal(call.cwd, f.cwd);
    assert.ok(!Object.keys(call.env).some(key => key.toUpperCase() === "ANTHROPIC_API_KEY"));
    assert.equal(call.args[call.args.indexOf("--tools") + 1], "");
    assert.ok(call.args.includes("--safe-mode"));
    assert.ok(!call.args.some(arg => /bypass|skip-permissions/.test(arg)));
  }
  assert.ok(!JSON.stringify(f.h.audit).includes("Second explicitly approved turn"));
  assert.equal((await f.snapshot()).steps.length, 0);
  await assert.rejects(f.h.host.engine.start(f.run.id), /controlled worker turn/);
});

test("human completed resolution survives restarts and never resends", async t => {
  const f = await setup(t);
  const send = await f.prepare("__truncated__");
  assert.equal((await f.send(send.id)).status, "UNCERTAIN");
  await f.restart();
  assert.equal((await f.snapshot()).run.state, "NEEDS_REVIEW");
  await assert.rejects(f.prepare(), /existing send/);
  await assert.rejects(f.send(send.id), /reconciliation/);
  await f.resolve(send.id, "keep_unresolved");
  await f.restart();
  assert.equal((await f.snapshot()).worker.resolutions[0]!.decision, "keep_unresolved");
  assert.equal((await f.snapshot()).run.state, "NEEDS_REVIEW");
  await f.resolve(send.id, "completed");
  await f.resolve(send.id, "completed");
  await assert.rejects(f.resolve(send.id, "not_sent"), /already has a final/);
  await f.restart();
  assert.equal((await f.snapshot()).worker.resolutions.length, 2);
  assert.equal((await f.send(send.id)).status, "COMPLETED");
  assert.equal(f.dispatches().length, 1);
  assert.equal((await f.snapshot()).worker.session!.established, true);
});

test("human safe resolution permits one linked explicit retry with a fresh approval", async t => {
  const f = await setup(t);
  const first = await f.prepare("Retry me");
  // Simulate loss after intent, before the CLI receives anything.
  f.h.host.workers.sessions.update(first.id, "UNCERTAIN", first.operationId);
  await f.restart();
  await f.resolve(first.id, "not_sent");
  assert.equal(f.h.host.pendingApprovals().length, 0, "the old approval must be retired with the resolution");
  await f.restart();
  assert.equal((await f.snapshot()).run.state, "PAUSED");
  assert.equal(f.dispatches().length, 0);
  const retry = await f.prepare(first.prompt, first.id);
  assert.notEqual(retry.id, first.id);
  assert.notEqual(retry.operationId, first.operationId);
  assert.equal(retry.retryOf, first.id);
  assert.equal(retry.status, "AWAITING_APPROVAL");
  await f.restart();
  await f.send(retry.id);
  await f.restart();
  await f.send(retry.id);
  await assert.rejects(f.prepare(first.prompt, first.id), /already been used/);
  assert.equal(f.dispatches().length, 1);
});

for (const mode of ["intent", "dispatch_mark", "after_dispatch"]) {
  test(`host crash at ${mode} remains uncertain through repeated restarts without duplicate dispatch`, async t => {
    const f = await setup(t);
    const prepared = mode === "intent" ? null : await f.prepare("Crash prompt");
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings",
      resolve(dirname(fileURLToPath(import.meta.url)), "helpers/controlledHostCrashChild.ts"), f.root, mode, f.run.id, prepared?.id ?? ""], { encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(child.status, 9, child.stderr);
    for (let count = 0; count < 3; count++) {
      await f.restart();
      const snap = await f.snapshot();
      assert.equal(snap.run.state, "NEEDS_REVIEW");
      const uncertain = snap.worker.sends.find(send => send.status === "UNCERTAIN")!;
      assert.ok(uncertain);
      await assert.rejects(f.send(uncertain.id), /reconciliation/);
      assert.equal(f.dispatches().length, mode === "after_dispatch" ? 1 : 0);
    }
  });
}

test("host rejects foreign frames, unsafe workspaces, unsafe retries and mismatched send identities", async t => {
  const f = await setup(t);
  assert.throws(() => f.h.handlers.get("dexnest:autopilot-worker-send")!({ sender: {}, senderFrame: {} }, {}), /trusted desktop/);
  const spec = f.run.spec;
  await assert.rejects(f.h.invoke("create-run", { ...spec, id: undefined, capabilities: { ...spec.capabilities, workspaceRoot: f.repo } }), /primary checkout/);
  await assert.rejects(f.h.invoke("create-run", { ...spec, id: undefined, capabilities: { ...spec.capabilities, workspaceRoot: "D:/DeskNest/local-data" } }), /denied/);
  const send = await f.prepare();
  await assert.rejects(f.h.invoke("worker-send", { runId: "wrong-run", sendId: send.id }));
  assert.equal(f.dispatches().length, 0);
  await f.h.invoke("worker-interrupt", f.run.id);
  assert.equal((await f.snapshot()).worker.sends[0]!.status, "CANCELLED");
  await assert.rejects(f.prepare(send.prompt, send.id), /human not-sent resolution/);
  assert.equal(f.dispatches().length, 0);
});

test("concurrent clicks allocate and dispatch only one send", async t => {
  const f = await setup(t);
  const preparations = await Promise.allSettled([f.prepare(), f.prepare()]);
  assert.equal(preparations.filter(result => result.status === "fulfilled").length, 1);
  const prepared = (preparations.find(result => result.status === "fulfilled") as PromiseFulfilledResult<WorkerSend>).value;
  await Promise.allSettled([f.send(prepared.id), f.send(prepared.id)]);
  assert.equal(f.dispatches().length, 1);
});

test("human resolution and audit journal roll back together on persistence failure", async t => {
  const f = await setup(t);
  const send = await f.prepare("__truncated__");
  await f.send(send.id);
  f.h.ports.db.exec(`CREATE TRIGGER fail_human_resolution BEFORE INSERT ON autopilot_run_events
    WHEN NEW.type='WORKER_SEND_RESOLVED_BY_HUMAN' BEGIN SELECT RAISE(ABORT,'simulated journal failure'); END;`);
  await assert.rejects(f.resolve(send.id, "completed"), /simulated journal failure/);
  assert.equal((await f.snapshot()).worker.resolutions.length, 0);
  assert.equal((await f.snapshot()).worker.sends[0]!.status, "UNCERTAIN");
  f.h.ports.db.exec("DROP TRIGGER fail_human_resolution");
  await f.resolve(send.id, "completed");
  assert.equal((await f.snapshot()).worker.resolutions.length, 1);
});

test("a dispatch-boundary exception immediately requires human review without waiting for restart", async t => {
  const f = await setup(t);
  const prepared = await f.prepare();
  const effects = f.h.host.engine.effects!;
  const request = effects.request.bind(effects);
  effects.request = async input => request({ ...input, beforeDispatch: () => { throw new Error("simulated send-record failure"); } });
  await assert.rejects(f.send(prepared.id), /simulated send-record failure/);
  assert.equal((await f.snapshot()).run.state, "NEEDS_REVIEW");
  assert.equal((await f.snapshot()).worker.sends[0]!.status, "UNCERTAIN");
  assert.equal((await f.snapshot()).worker.busy, false);
  assert.equal(f.dispatches().length, 0);
});

test("host interrupt kills only the owned process tree and holds the send for review", { skip: process.platform !== "win32" }, async t => {
  const f = await setup(t);
  const prepared = await f.prepare("__block__");
  const foreignResult = f.h.realProcess.run({ runId: "foreign", operationId: "foreign", executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"], cwd: f.cwd, env: { SystemRoot: process.env.SystemRoot ?? "C:/Windows" }, timeoutMs: 15000 });
  const foreign = f.h.realProcess.ownedProcesses("foreign")[0]!;
  const running = f.send(prepared.id);
  try {
    const treePath = resolve(f.cwd, ".fake-tree");
    for (let attempt = 0; attempt < 200 && !existsSync(treePath); attempt++) await new Promise(done => setTimeout(done, 20));
    assert.ok(existsSync(treePath));
    const tree = JSON.parse(readFileSync(treePath, "utf8"));
    await assert.rejects(f.resolve(prepared.id, "not_sent"), /owned worker to stop/);
    await f.h.invoke("worker-interrupt", f.run.id);
    assert.equal((await running).status, "UNCERTAIN");
    assert.equal((await f.snapshot()).run.state, "NEEDS_REVIEW");
    assert.throws(() => process.kill(tree.parent, 0));
    assert.throws(() => process.kill(tree.child, 0));
    assert.doesNotThrow(() => process.kill(foreign.pid, 0));
  } finally {
    await f.h.host.workers.interrupt(f.run.id);
    await running;
    await f.h.realProcess.terminate(foreign);
    await foreignResult;
  }
});
