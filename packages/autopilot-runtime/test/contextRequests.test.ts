// A tool-less worker asking DexNest for a file it cannot see.
//
// The request is data, exactly like a returned file: DexNest parses it,
// validates it, and reads it through the ordinary READ_FILE path. The worker
// never gains filesystem access.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertSafeDataRoot } from "./helpers/harness.ts";
import { initWorktree, openLoop, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { parseWorkerOutput, MAX_REQUESTED_FILES } from "../src/workerOutput.ts";
import { selectContextFiles } from "../src/contextSelection.ts";
import { buildRunReport, renderRunReportMarkdown } from "../src/report.ts";
import { openControlledHost } from "./helpers/controlledHostHarness.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // An isolated temp directory must never fail a test.
    }
  }
});

/** A worktree with an extra source file the selector would not pick on its own. */
function workspace(plan: LoopPlanStep[], verifyState: Record<string, number> = {}): string {
  const root = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-req-")));
  dirs.push(root);
  const worktree = resolve(root, "worktree");
  initWorktree(worktree, plan, verifyState);

  mkdirSync(resolve(worktree, "src"), { recursive: true });
  writeFileSync(resolve(worktree, "src", "target.js"), "export const target = 1;\n", "utf8");
  writeFileSync(resolve(worktree, "src", "hidden-helper.js"), "export const SECRET_CONSTANT = 42;\n", "utf8");
  writeFileSync(resolve(worktree, "src", "other-helper.js"), "export const other = 7;\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: worktree, windowsHide: true });
  execFileSync("git", ["commit", "-m", "sources"], { cwd: worktree, windowsHide: true });
  return root;
}

function prompts(worktree: string): string[] {
  const file = resolve(worktree, ".loop-dispatches.json");
  return (JSON.parse(readFileSync(file, "utf8")) as Array<{ prompt: string }>).map((entry) => entry.prompt);
}

describe("parsing context requests", () => {
  test("extracts a request and leaves narration alone", () => {
    const parsed = parseWorkerOutput('I need more.\n<<<DEXNEST_REQUEST path="src/a.ts">>>\nThanks.');
    assert.deepEqual(parsed.requests, ["src/a.ts"]);
    assert.deepEqual(parsed.issues, []);
  });

  test("a path merely mentioned in prose is not a request", () => {
    const parsed = parseWorkerOutput("You should look at src/a.ts and maybe src/b.ts too.");
    assert.deepEqual(parsed.requests, []);
  });

  test("duplicates collapse to one", () => {
    const parsed = parseWorkerOutput(
      '<<<DEXNEST_REQUEST path="src/a.ts">>>\n<<<DEXNEST_REQUEST path="./src/a.ts">>>\n<<<DEXNEST_REQUEST path="src\\a.ts">>>'
    );
    assert.deepEqual(parsed.requests, ["src/a.ts"]);
  });

  test("absolute paths and traversal are rejected with a reason", () => {
    const absolute = parseWorkerOutput('<<<DEXNEST_REQUEST path="C:/Windows/System32/drivers/etc/hosts">>>');
    assert.deepEqual(absolute.requests, []);
    assert.match(absolute.issues[0]!, /absolute path/);

    const traversal = parseWorkerOutput('<<<DEXNEST_REQUEST path="../../secrets.txt">>>');
    assert.deepEqual(traversal.requests, []);
    assert.match(traversal.issues[0]!, /escapes the project root/);

    const rooted = parseWorkerOutput('<<<DEXNEST_REQUEST path="/etc/passwd">>>');
    assert.deepEqual(rooted.requests, []);
    assert.equal(rooted.issues.length, 1);
  });

  test("a DexNest local-data request is rejected before it can become a read", () => {
    const parsed = parseWorkerOutput('<<<DEXNEST_REQUEST path="D:/DeskNest/local-data/settings/vault-documents.json">>>');
    assert.deepEqual(parsed.requests, []);
    assert.match(parsed.issues[0]!, /absolute path/);
  });

  test("a malformed envelope is reported, not guessed at", () => {
    const parsed = parseWorkerOutput("<<<DEXNEST_REQUEST src/a.ts>>>");
    assert.deepEqual(parsed.requests, []);
    assert.match(parsed.issues[0]!, /malformed/);
  });

  test("the per-turn count limit is enforced", () => {
    const many = Array.from({ length: MAX_REQUESTED_FILES + 3 }, (_, index) => `<<<DEXNEST_REQUEST path="src/f${index}.ts">>>`).join("\n");
    const parsed = parseWorkerOutput(many);
    assert.equal(parsed.requests.length, MAX_REQUESTED_FILES);
    assert.match(parsed.issues.at(-1)!, /Only the first/);
  });

  test("requests and file writes coexist in one response", () => {
    const parsed = parseWorkerOutput(
      '<<<DEXNEST_FILE path="src/a.ts">>>\nconst a = 1;\n<<<END_DEXNEST_FILE>>>\n<<<DEXNEST_REQUEST path="src/b.ts">>>'
    );
    assert.equal(parsed.files.length, 1);
    assert.deepEqual(parsed.requests, ["src/b.ts"]);
  });
});

describe("request priority in selection", () => {
  test("a requested file outranks every other reason", () => {
    const selection = selectContextFiles({
      tracked: ["src/a.js", "src/b.js", "package.json"],
      specText: "work on src/a.js",
      failureOutput: "at src/b.js:3",
      changed: ["src/a.js"],
      requested: ["package.json"]
    });
    assert.equal(selection.files[0]!.path, "package.json");
    assert.equal(selection.files[0]!.reason, "worker-request");
  });

  test("a requested file outranks fallback", () => {
    const selection = selectContextFiles({
      tracked: ["src/a.js", "src/b.js"],
      specText: "",
      failureOutput: "",
      changed: [],
      requested: ["src/b.js"]
    });
    assert.equal(selection.files[0]!.reason, "worker-request");
    assert.equal(selection.files[0]!.path, "src/b.js");
  });
});

describe("requests end to end", () => {
  test("report exposes fulfilled and denied evidence through host UI data without reading files", async () => {
    const root = workspace([
      { requestFiles: ["src/hidden-helper.js", "src/missing.js"] },
      { verify: { test: 0 }, emitFiles: [{ path: "src/target.js", contents: "export const target = 42;" }] }
    ], { test: 1 });
    const contents = "export const SECRET_CONSTANT = '你好🙂';\n";
    writeFileSync(resolve(root, "worktree/src/hidden-helper.js"), contents);
    const h = openLoop(root, { tiers: ["test"] });
    let before;
    try {
      h.createRun(); h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
      await h.loop.run("loop-run");
      // Reports need no platform capability at all, including repository reads.
      before = buildRunReport({ ...h.ports, platform: undefined }, "loop-run");
      const [fulfilled, denied] = before.contextRequests;
      assert.equal(fulfilled!.status, "FULFILLED");
      assert.equal(fulfilled!.allowed, true);
      assert.equal(fulfilled!.bytesSupplied, Buffer.byteLength(contents, "utf8"));
      assert.equal(fulfilled!.bytesUnit, "utf8_bytes");
      assert.equal(fulfilled!.fulfilledAfterRestart, false);
      assert.equal(fulfilled!.requestedTurnId, before.loop.turns[0]!.turnId);
      assert.equal(fulfilled!.consumedTurnId, before.loop.turns[1]!.turnId);
      assert.equal(fulfilled!.requestedTurnOrdinal, 1);
      assert.equal(fulfilled!.consumedTurnOrdinal, 2);
      assert.equal(fulfilled!.consumingWorker!.provider, "claude");
      assert.equal(fulfilled!.consumingWorker!.sessionId, before.provider.sessionId);
      assert.match(fulfilled!.availabilityReason, /Already included/);
      assert.equal(denied!.status, "DENIED");
      assert.equal(denied!.allowed, false);
      assert.match(denied!.denialReason!, /not a tracked file/);
      assert.match(denied!.availabilityReason, /Not included/);
      assert.equal(denied!.bytesSupplied, 0);
      assert.equal(denied!.consumedTurnId, fulfilled!.consumedTurnId);
      const markdown = renderRunReportMarkdown(before);
      assert.match(markdown, /## Context requests/);
      assert.match(markdown, /src\/hidden-helper.js/);
      assert.match(markdown, /DENIED \/ no/);
      assert.match(markdown, /not a tracked file/);
      assert.ok(!markdown.includes(contents));
      assert.ok(!JSON.stringify(before.contextRequests).includes("SECRET_CONSTANT"));
    } finally { h.close(); }
    const restarted = openLoop(root, { instance: 2, tiers: ["test"] });
    try {
      const after = buildRunReport({ ...restarted.ports, platform: undefined }, "loop-run");
      assert.deepEqual(after.contextRequests, before!.contextRequests);
      assert.deepEqual({ ...after, generatedAt: "" }, { ...before!, generatedAt: "" });
    } finally { restarted.close(); }
    const host = await openControlledHost(root);
    try {
      const uiReport = await host.invoke("report", "loop-run");
      assert.deepEqual(uiReport.contextRequests, before!.contextRequests);
    } finally { host.close(); }
  });

  test("pending evidence stays pending across restart; later fulfillment records restart permanently", async () => {
    const root = workspace([
      { requestFiles: ["src/hidden-helper.js"] },
      { verify: { test: 0 }, emitFiles: [{ path: "src/target.js", contents: "export const target = 9;" }] }
    ], { test: 1 });
    const first = openLoop(root, { tiers: ["test"] });
    let pending;
    try {
      first.createRun(); first.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "test-human" });
      await first.loop.run("loop-run");
      pending = first.loop.report("loop-run").contextRequests;
      assert.equal(pending[0]!.status, "PENDING");
      assert.equal(pending[0]!.allowed, null);
      assert.equal(pending[0]!.consumedTurnId, null);
      assert.equal(pending[0]!.consumingWorker, null);
      assert.equal(pending[0]!.bytesSupplied, 0);
      assert.match(renderRunReportMarkdown(first.loop.report("loop-run")), /PENDING \/ pending/);
    } finally { first.close(); }
    const second = openLoop(root, { instance: 2, tiers: ["test"] });
    let consumed;
    try {
      assert.deepEqual(second.loop.report("loop-run").contextRequests, pending);
      second.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "test-human" });
      await second.loop.run("loop-run");
      consumed = second.loop.report("loop-run").contextRequests;
      assert.equal(consumed[0]!.fulfilledAfterRestart, true);
      assert.equal(consumed[0]!.consumedTurnOrdinal, 2);
    } finally { second.close(); }
    const third = openLoop(root, { instance: 3 });
    try { assert.deepEqual(third.loop.report("loop-run").contextRequests, consumed); }
    finally { third.close(); }
  });

  test("legacy provenance remains unknown and Markdown treats request fields as data", async () => {
    const root = workspace([]);
    const h = openLoop(root);
    try {
      h.createRun();
      h.ports.db.exec(`INSERT INTO autopilot_context_requests
        (id,run_id,requested_turn_id,path,status,bytes_supplied,created_at)
        VALUES ('legacy','loop-run','old-turn','<script>|bad','FULFILLED',7,'2026-01-01');`);
      const report = h.loop.report("loop-run");
      assert.equal(report.contextRequests[0]!.fulfilledAfterRestart, null);
      assert.equal(report.contextRequests[0]!.bytesUnit, "legacy_utf16_units");
      assert.equal(report.contextRequests[0]!.consumingWorker, null);
      assert.match(report.contextRequests[0]!.availabilityReason, /not recorded/);
      const markdown = renderRunReportMarkdown(report);
      assert.ok(!markdown.includes("<script>"));
      assert.match(markdown, /&#124;/);
      assert.match(markdown, /7 legacy UTF-16 units/);
    } finally { h.close(); }
  });

  test("a requested file is supplied on the very next turn, via READ_FILE", async () => {
    const root = workspace(
      [
        { verify: { test: 1 }, requestFiles: ["src/hidden-helper.js"] },
        { verify: { test: 0 }, emitFiles: [{ path: "src/target.js", contents: "export const target = 42;" }] }
      ],
      { test: 1 }
    );
    const h = openLoop(root, { tiers: ["test"], maxConsecutiveFailures: 9 });
    // A goal that names a file, so targeted evidence exists and the selector
    // does not fall back to the whole repository.
    h.createRun({ goal: "Fix src/target.js" });
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "completed", outcome.detail);

    const sent = prompts(h.worktree);
    assert.equal(sent.length, 2, "the request cost exactly one extra turn");
    assert.ok(!sent[0]!.includes("SECRET_CONSTANT"), "turn 1 could not see the file it asked for");
    assert.match(sent[1]!, /SECRET_CONSTANT/, "turn 2 received the requested file");
    assert.match(sent[1]!, /YOUR PREVIOUS CONTEXT REQUESTS/);
    assert.match(sent[1]!, /src\/hidden-helper\.js: included below/);

    // Durable evidence, with both the originating and consuming turn recorded.
    const requests = h.loop.contextRequests.list("loop-run");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.path, "src/hidden-helper.js");
    assert.equal(requests[0]!.status, "FULFILLED");
    assert.ok(requests[0]!.bytesSupplied > 0);
    assert.ok(requests[0]!.requestedTurnId);

    // The file reached the prompt only through a policy-checked read.
    const reads = h.effects.operations
      .listForRun("loop-run")
      .filter((operation) => operation.kind === "READ_FILE" && operation.summary.includes("hidden-helper"));
    assert.ok(reads.length > 0, "a READ_FILE operation exists for the fulfilled request");
    assert.equal(reads[0]!.decision, "ALLOW");
    assert.equal(reads[0]!.status, "COMPLETED");
    h.close();
  });

  test("several requests are satisfied together", async () => {
    const root = workspace(
      [
        { verify: { test: 1 }, requestFiles: ["src/hidden-helper.js", "src/other-helper.js"] },
        { verify: { test: 0 }, emitFiles: [{ path: "src/target.js", contents: "export const target = 2;" }] }
      ],
      { test: 1 }
    );
    const h = openLoop(root, { tiers: ["test"], maxConsecutiveFailures: 9 });
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    const second = prompts(h.worktree)[1]!;
    assert.match(second, /SECRET_CONSTANT/);
    assert.match(second, /export const other = 7/);
    assert.equal(h.loop.contextRequests.list("loop-run").filter((request) => request.status === "FULFILLED").length, 2);
    h.close();
  });

  test("an untracked path is denied with a reason the worker can read", async () => {
    const root = workspace(
      [
        { verify: { test: 1 }, requestFiles: ["src/does-not-exist.js"] },
        { verify: { test: 0 }, emitFiles: [{ path: "src/target.js", contents: "export const target = 3;" }] }
      ],
      { test: 1 }
    );
    const h = openLoop(root, { tiers: ["test"], maxConsecutiveFailures: 9 });
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    const denied = h.loop.contextRequests.list("loop-run")[0]!;
    assert.equal(denied.status, "DENIED");
    assert.match(denied.denialReason!, /not a tracked file/);
    assert.match(prompts(h.worktree)[1]!, /src\/does-not-exist\.js: DENIED/);

    // Nothing was read for a denied request.
    const reads = h.effects.operations
      .listForRun("loop-run")
      .filter((operation) => operation.kind === "READ_FILE" && operation.summary.includes("does-not-exist"));
    assert.deepEqual(reads, []);
    h.close();
  });

  test("a request-only turn does not complete the run", async () => {
    // Verification would pass, but the worker only asked for context. Asking is
    // not doing the work, so the run must not be declared complete.
    const root = workspace([{ verify: { test: 0 }, requestFiles: ["src/hidden-helper.js"] }], { test: 0 });
    const h = openLoop(root, { tiers: ["test"], maxConsecutiveFailures: 9 });
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.notEqual(outcome.reason, "completed", "a request alone never completes the run");
    assert.equal(outcome.reason, "turn_limit");
    assert.equal(h.store.requireRun("loop-run").state, "PAUSED");
    assert.deepEqual(h.loop.checkpoints.store.list("loop-run"), [], "nothing was checkpointed");

    // The budget bounds it, so this cannot loop invisibly.
    assert.equal(h.loop.loops.grants("loop-run")[0]!.turnsUsed, 2);
    h.close();
  });

  test("a pending request survives a fresh runtime and is supplied exactly once", async () => {
    const root = workspace(
      [
        { verify: { test: 1 }, requestFiles: ["src/hidden-helper.js"] },
        { verify: { test: 0 }, emitFiles: [{ path: "src/target.js", contents: "export const target = 9;" }] }
      ],
      { test: 1 }
    );

    // Process 1: one turn, which only asks for a file.
    const first = openLoop(root, { tiers: ["test"], maxConsecutiveFailures: 9 });
    first.createRun();
    first.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "test-human" });
    await first.loop.run("loop-run");

    const pendingBefore = first.loop.contextRequests.pending("loop-run");
    assert.equal(pendingBefore.length, 1, "the request is durable and still pending");
    const sessionBefore = first.worker.sessions.session("loop-run")!.sessionId;
    assert.equal(prompts(first.worktree).length, 1);
    first.close();

    // Process 2: a completely fresh runtime against the same database.
    const second = openLoop(root, { instance: 2, tiers: ["test"], maxConsecutiveFailures: 9 });
    assert.equal(
      second.loop.contextRequests.pending("loop-run").length,
      1,
      "the pending request was restored from durable state"
    );

    second.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const outcome = await second.loop.run("loop-run");
    assert.equal(outcome.reason, "completed", outcome.detail);

    const sent = prompts(second.worktree);
    assert.equal(sent.length, 2, "the earlier prompt was not resent");
    assert.match(sent[1]!, /SECRET_CONSTANT/, "the requested file arrived after the restart");

    // Same sticky session, and the request was consumed once.
    assert.equal(second.worker.sessions.session("loop-run")!.sessionId, sessionBefore);
    const requests = second.loop.contextRequests.list("loop-run");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.status, "FULFILLED");
    assert.deepEqual(second.loop.contextRequests.pending("loop-run"), []);
    second.close();
  });
});
