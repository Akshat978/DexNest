import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "./helpers/harness.ts";
import { createTestRepository, createGitPort } from "./helpers/platform.ts";
import { openControlledHost } from "./helpers/controlledHostHarness.ts";
import { openWorker } from "./helpers/workerHarness.ts";
import { codexProtocol, classifyCodexFailure, CODEX_DISABLED_FEATURES } from "../src/codexWorker.ts";
import type { RunRecord, WorkerSend } from "../src/index.ts";

async function setup(t: { after(fn: () => void): void }) {
  const space = createTestWorkspace();
  const repo = createTestRepository(resolve(space.dir, "repo"));
  const cwd = resolve(space.dir, "worktree");
  createGitPort().addWorktree({ repoRoot: repo, worktreePath: cwd, branch: "codex-test", baseRef: "HEAD" });
  let h = await openControlledHost(space.dir);
  t.after(() => { h.close(); space.cleanup(); });
  const run: RunRecord = await h.invoke("create-run", { goal: "Codex controlled turn", projectPath: repo,
    workers: { primary: "codex", sticky: true, fallback: null, consultantMode: false },
    capabilities: { workspaceRoot: cwd, allowedPaths: [], forbiddenPaths: ["local-data"], allowedCommands: [], forbiddenCommands: [], requiresApproval: [] } });
  return { root: space.dir, repo, cwd, run, get h() { return h; }, async restart() { h.close(); h = await openControlledHost(space.dir); },
    prepare: (prompt = "Hello", retryOf?: string): Promise<WorkerSend> => h.invoke("worker-prepare", { runId: run.id, prompt, retryOf }),
    send: (sendId: string): Promise<WorkerSend> => h.invoke("worker-send", { runId: run.id, sendId }),
    snapshot: () => h.host.workers.snapshot(run.id),
    records: (name = ".fake-codex-dispatches"): any[] => existsSync(resolve(cwd, name)) ? readFileSync(resolve(cwd, name), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [] };
}

test("Codex intent and provider thread identity commit before prompt dispatch; provider/session survive restart", async t => {
  const f = await setup(t);
  let observedBinding = false;
  const processRun = f.h.ports.platform!.process.run;
  f.h.ports.platform!.process.run = async input => {
    if (input.conversation) {
      const observer = openWorker(f.root, 99);
      try {
        assert.ok(observer.store.listEvents(f.run.id).some(event => event.type === "WORKER_SEND_INTENT"));
        assert.equal(observer.worker.sessions.pending(f.run.id)?.status, "DISPATCHING");
      } finally { observer.close(); }
      const receive = input.conversation.receive.bind(input.conversation);
      input.conversation.receive = line => {
        const messages = receive(line);
        for (const message of messages) {
          if (JSON.parse(message).method !== "turn/start") continue;
          const observer = openWorker(f.root, 100);
          try {
            assert.equal(observer.worker.sessions.session(f.run.id)!.providerSessionId, JSON.parse(message).params.threadId);
            observedBinding = true;
          } finally { observer.close(); }
        }
        return messages;
      };
    }
    return processRun(input);
  };
  const first = await f.prepare("Private prompt");
  assert.equal(first.status, "AWAITING_APPROVAL");
  assert.equal(f.records().length, 0);
  const localId = f.snapshot().session!.sessionId;
  assert.equal((await f.send(first.id)).status, "COMPLETED");
  assert.ok(observedBinding);
  const providerId = f.snapshot().session!.providerSessionId;
  assert.ok(providerId);
  assert.notEqual(providerId, localId);
  await f.restart();
  assert.equal(f.h.host.engine.store.requireRun(f.run.id).spec.workers.primary, "codex");
  assert.equal(f.snapshot().session!.provider, "codex");
  assert.equal(f.snapshot().session!.providerSessionId, providerId);
  assert.equal(f.snapshot().session!.sessionId, localId);
  await f.send(first.id);
  assert.equal(f.records().length, 1);
  const second = await f.prepare("Explicit second turn");
  await f.send(second.id);
  assert.deepEqual(f.records().map(row => [row.threadId, row.resumed]), [[providerId, false], [providerId, true]]);
  for (const row of f.records()) {
    assert.equal(row.cwd, f.cwd); assert.equal(row.apiKeyPresent, false);
    assert.deepEqual(row.params.environments, []);
    assert.equal(row.params.sandboxPolicy.type, "readOnly");
  }
  const calls = f.h.calls.filter(call => call.conversation);
  assert.equal(calls.length, 1);
  assert.ok(!Object.keys(calls[0]!.env).some(key => key.toUpperCase() === "OPENAI_API_KEY"));
  assert.ok(calls[0]!.args.includes("mcp_servers.inherited.enabled=false"));
  for (const feature of CODEX_DISABLED_FEATURES) assert.ok(calls[0]!.args.includes(`features.${feature}=false`));
  assert.ok(!calls[0]!.args.some(arg => /dangerously|bypass|danger-full-access|approve-for-me/.test(arg)));
  assert.ok(!JSON.stringify(f.h.host.engine.snapshot(f.run.id).operations).includes("Private prompt"));
  assert.ok(!JSON.stringify(f.h.host.engine.snapshot(f.run.id).events).includes("never-persist-this-token"));
  await assert.rejects(f.h.host.engine.start(f.run.id), /controlled worker turn/);
});

for (const mode of ["intent", "dispatch_mark", "session_bound", "after_dispatch"]) {
  test(`Codex crash at ${mode} never blindly resends across repeated host restarts`, async t => {
    const f = await setup(t);
    const prepared = mode === "intent" ? null : await f.prepare("Crash prompt");
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings",
      resolve(dirname(fileURLToPath(import.meta.url)), "helpers/controlledHostCrashChild.ts"), f.root, mode, f.run.id, prepared?.id ?? ""], { encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(child.status, 9, child.stderr);
    for (let count = 0; count < 3; count++) {
      await f.restart();
      assert.equal(f.h.host.engine.store.requireRun(f.run.id).state, "NEEDS_REVIEW");
      const uncertain = f.snapshot().sends.find(send => send.status === "UNCERTAIN")!;
      assert.ok(uncertain);
      await assert.rejects(f.send(uncertain.id), /reconciliation/);
      assert.equal(f.records().length, mode === "after_dispatch" ? 1 : 0);
      if (["session_bound", "after_dispatch"].includes(mode)) assert.ok(f.snapshot().session!.providerSessionId);
    }
  });
}

for (const [prompt, failure, status] of [["__auth__", "auth", "FAILED"], ["__quota__", "quota", "FAILED"], ["__truncated__", "protocol", "UNCERTAIN"], ["__tool__", "permission", "UNCERTAIN"]]) {
  test(`Codex ${failure} is classified and never retried automatically`, async t => {
    const f = await setup(t);
    const prepared = await f.prepare(prompt);
    const send = await f.send(prepared.id);
    assert.equal(send.result?.failure, failure);
    assert.equal(send.status, status);
    await f.restart();
    assert.equal(f.records().length, 1);
  });
}

test("missing Codex provider session never creates a replacement", async t => {
  const f = await setup(t);
  const first = await f.prepare(); await f.send(first.id);
  const id = f.snapshot().session!.providerSessionId!;
  unlinkSync(resolve(f.cwd, `.fake-codex-session-${id}`));
  await f.restart();
  const second = await f.prepare();
  const result = await f.send(second.id);
  assert.equal(result.result?.failure, "session");
  assert.equal(f.snapshot().session!.providerSessionId, id);
  assert.equal(f.records().length, 1);
  assert.equal(f.records(".fake-codex-rpc").filter(row => row.method === "thread/start").length, 1);
});

test("Codex rejects API login and unexpected inherited tools before a model prompt", async t => {
  const f = await setup(t);
  writeFileSync(resolve(f.cwd, ".fake-codex-auth"), JSON.stringify("API key"));
  await assert.rejects(f.prepare(), /auth/);
  assert.equal(f.records().length, 0);
  writeFileSync(resolve(f.cwd, ".fake-codex-auth"), JSON.stringify("ChatGPT"));
  writeFileSync(resolve(f.cwd, ".fake-codex-unsafe"), "true");
  const first = await f.prepare();
  const result = await f.send(first.id);
  assert.equal(result.result?.failure, "policy");
  assert.equal(result.result?.certain, true);
  assert.equal(f.records().length, 0);
  writeFileSync(resolve(f.cwd, ".fake-codex-unsafe"), "false");
  writeFileSync(resolve(f.cwd, ".fake-codex-account"), JSON.stringify("apiKey"));
  const second = await f.prepare();
  assert.equal((await f.send(second.id)).result?.failure, "auth");
  assert.equal(f.records().length, 0);
});

test("Codex interrupt terminates only its owned process tree", { skip: process.platform !== "win32" }, async t => {
  const f = await setup(t);
  const first = await f.prepare("__block__");
  const foreignResult = f.h.realProcess.run({ runId: "foreign", operationId: "foreign", executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"], cwd: f.cwd, env: { SystemRoot: process.env.SystemRoot ?? "C:/Windows" }, timeoutMs: 15000 });
  const foreign = f.h.realProcess.ownedProcesses("foreign")[0]!;
  const sending = f.send(first.id);
  try {
    const treePath = resolve(f.cwd, ".fake-codex-tree");
    for (let attempt = 0; attempt < 200 && !existsSync(treePath); attempt++) await new Promise(done => setTimeout(done, 20));
    assert.ok(existsSync(treePath));
    const tree = JSON.parse(readFileSync(treePath, "utf8"));
    await f.h.invoke("worker-interrupt", f.run.id);
    const result = await sending;
    assert.equal(result.result?.failure, "interrupted"); assert.equal(result.status, "UNCERTAIN");
    assert.throws(() => process.kill(tree.parent, 0)); assert.throws(() => process.kill(tree.child, 0));
    assert.doesNotThrow(() => process.kill(foreign.pid, 0));
  } finally { await f.h.host.workers.interrupt(f.run.id); await sending; await f.h.realProcess.terminate(foreign); await foreignResult; }
});

test("Codex protocol distinguishes unsupported installation and process failures", () => {
  const protocol = codexProtocol("codex.exe");
  const failure = { ok: false, summary: "failed", exitCode: -1 };
  assert.equal(protocol.parseInstallation({ ...failure, detail: { failure: "spawn" } }).failure, "not_installed");
  assert.equal(protocol.parseInstallation({ ...failure, stdout: "codex-cli 0.154.0" }).failure, "unsupported");
  assert.equal(protocol.completion({ ...failure, detail: { failure: "spawn" } }, "session").failure, "not_installed");
  assert.equal(protocol.completion({ ...failure, stderr: "process crashed" }, "session").failure, "process");
  assert.equal(classifyCodexFailure("Thread not found"), "session");
  assert.throws(() => codexProtocol("codex.cmd"), /native/);
});

test("Codex human resolution preserves the bound session and permits only one approved retry", async t => {
  const f = await setup(t);
  const first = await f.prepare(); await f.send(first.id);
  const providerId = f.snapshot().session!.providerSessionId;
  const lost = await f.prepare("Retry after review");
  f.h.host.workers.sessions.update(lost.id, "UNCERTAIN", lost.operationId);
  await f.restart();
  const resolveSend = (sendId: string, decision: string) => f.h.invoke("worker-resolve", {
    runId: f.run.id, sendId, decision, evidence: "Checked the fake provider dispatch record"
  });
  await resolveSend(lost.id, "keep_unresolved");
  await f.restart();
  assert.equal(f.snapshot().resolutions.at(-1)!.decision, "keep_unresolved");
  await resolveSend(lost.id, "not_sent");
  await f.restart();
  const retry = await f.prepare(lost.prompt, lost.id);
  assert.equal(retry.status, "AWAITING_APPROVAL");
  assert.equal(f.records().length, 1);
  await f.send(retry.id);
  await f.restart(); await f.send(retry.id);
  assert.equal(f.records().length, 2);
  assert.equal(f.records()[1].threadId, providerId);
  assert.equal(f.records()[1].resumed, true);
  await assert.rejects(f.prepare(lost.prompt, lost.id), /already been used/);
  const uncertain = await f.prepare("__truncated__"); await f.send(uncertain.id);
  await f.restart(); await resolveSend(uncertain.id, "completed");
  await f.restart();
  assert.equal((await f.send(uncertain.id)).status, "COMPLETED");
  assert.equal(f.records().length, 3);
  assert.equal(f.snapshot().session!.providerSessionId, providerId);
});

test("Codex never transmits a prompt when the durable session commit fails", async t => {
  const f = await setup(t);
  const prepared = await f.prepare();
  const request = f.h.host.engine.effects!.request.bind(f.h.host.engine.effects!);
  f.h.host.engine.effects!.request = input => request({ ...input,
    onWorkerSession: () => { throw new Error("Simulated durable storage failure"); }
  });
  assert.equal((await f.send(prepared.id)).status, "UNCERTAIN");
  assert.equal(f.records().length, 0);
  assert.equal(f.snapshot().session!.providerSessionId, undefined);
  await f.restart();
  await assert.rejects(f.send(prepared.id), /reconciliation/);
  assert.equal(f.records().length, 0);
});
