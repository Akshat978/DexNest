// The worker returns file contents as TEXT; DexNest writes them through policy.
//
// This is the production path introduced when the live trial proved that a
// worker running with `--tools ""` cannot touch a file at all. It matters that
// these writes go through the dispatcher: it is what keeps the worktree an
// enforced boundary rather than a convention.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertSafeDataRoot } from "./helpers/harness.ts";
import { initWorktree, openLoop, VERIFY_FIXTURE, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { parseWorkerOutput, MAX_OUTPUT_FILES } from "../src/workerOutput.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // Isolated temp directories must never fail a test.
    }
  }
});

function workspace(plan: LoopPlanStep[], verifyState: Record<string, number> = {}): string {
  const root = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-output-")));
  dirs.push(root);
  initWorktree(resolve(root, "worktree"), plan, verifyState);
  return root;
}

function block(path: string, contents: string): string {
  return `<<<DEXNEST_FILE path="${path}">>>\n${contents}\n<<<END_DEXNEST_FILE>>>`;
}

describe("parsing worker output", () => {
  test("extracts whole files and ignores surrounding narration", () => {
    const parsed = parseWorkerOutput(
      `I'll fix the cache.\n\n${block("src/lru.js", "export const a = 1;")}\n\nThat should do it.`
    );
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0]!.path, "src/lru.js");
    assert.equal(parsed.files[0]!.contents, "export const a = 1;\n");
  });

  test("normalizes backslashes and a leading ./", () => {
    const parsed = parseWorkerOutput(block(".\\src\\deep\\file.ts", "x"));
    assert.equal(parsed.files[0]!.path, "src/deep/file.ts");
  });

  test("refuses absolute paths and traversal, with a reason", () => {
    const absolute = parseWorkerOutput(block("C:/Windows/System32/evil.dll", "x"));
    assert.deepEqual(absolute.files, []);
    assert.match(absolute.issues[0]!, /absolute path/);

    const traversal = parseWorkerOutput(block("../../escape.txt", "x"));
    assert.deepEqual(traversal.files, []);
    assert.match(traversal.issues[0]!, /escapes the project root/);

    const rooted = parseWorkerOutput(block("/etc/passwd", "x"));
    assert.deepEqual(rooted.files, []);
    assert.equal(rooted.issues.length, 1);
  });

  test("reports an unclosed block instead of guessing", () => {
    const parsed = parseWorkerOutput(`<<<DEXNEST_FILE path="a.txt">>>\nsome content but no terminator`);
    assert.deepEqual(parsed.files, []);
    assert.match(parsed.issues[0]!, /never closed/);
  });

  test("keeps the first of a duplicated path and says so", () => {
    const parsed = parseWorkerOutput(`${block("a.txt", "first")}\n${block("a.txt", "second")}`);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0]!.contents, "first\n");
    assert.match(parsed.issues[0]!, /more than once/);
  });

  test("bounds the number of files taken from one response", () => {
    const many = Array.from({ length: MAX_OUTPUT_FILES + 5 }, (_, index) => block(`f${index}.txt`, "x")).join("\n");
    const parsed = parseWorkerOutput(many);
    assert.equal(parsed.files.length, MAX_OUTPUT_FILES);
    assert.match(parsed.issues.at(-1)!, /Only the first/);
  });

  test("a response with no blocks yields nothing and no false issue", () => {
    const parsed = parseWorkerOutput("Let me look at the file first.\n\n**Read** src.js");
    assert.deepEqual(parsed.files, []);
    assert.deepEqual(parsed.issues, []);
  });
});

describe("applying worker output through policy", () => {
  test("returned files are written into the worktree and drive verification", async () => {
    // Turn 1 returns a file that leaves typecheck failing; turn 2 fixes it.
    const plan: LoopPlanStep[] = [
      { verify: { typecheck: 1 }, emitFiles: [{ path: "src/lru.js", contents: "export const version = 1;" }] },
      { verify: { typecheck: 0 }, emitFiles: [{ path: "src/lru.js", contents: "export const version = 2;" }] }
    ];
    const root = workspace(plan, { typecheck: 1 });
    const h = openLoop(root, { maxConsecutiveFailures: 9 });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "completed", outcome.detail);

    // DexNest wrote the file the worker described. The worker never touched disk.
    const written = readFileSync(resolve(h.worktree, "src", "lru.js"), "utf8");
    assert.equal(written, "export const version = 2;\n", "the last returned contents won");

    const events = h.engine.snapshot("loop-run").events;
    assert.equal(events.filter((event) => event.type === "WORKER_OUTPUT_APPLIED").length, 2);
    assert.ok(events.some((event) => event.type === "WORKSPACE_CONTEXT_READ"), "the workspace was read into the prompt");
    h.close();
  });

  test("a file outside the workspace is refused by policy and never written", async () => {
    const root = workspace(
      [{ verify: { typecheck: 0 }, emitFiles: [{ path: "../escaped.txt", contents: "pwned" }] }],
      { typecheck: 0 }
    );
    const h = openLoop(root);

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    assert.equal(existsSync(resolve(root, "escaped.txt")), false, "nothing escaped the worktree");
    const events = h.engine.snapshot("loop-run").events;
    assert.ok(events.some((event) => event.type === "WORKER_OUTPUT_REJECTED"), "the refusal is journalled");
    h.close();
  });

  test("the prompt carries the current file contents, since the worker has no tools", async () => {
    const root = workspace(
      [{ verify: { typecheck: 0 }, emitFiles: [{ path: "src/lru.js", contents: "export const ok = true;" }] }],
      { typecheck: 0 }
    );
    const h = openLoop(root);
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    const dispatched = JSON.parse(readFileSync(resolve(h.worktree, ".loop-dispatches.json"), "utf8")) as Array<{ prompt: string }>;
    assert.equal(dispatched.length, 1);
    assert.match(dispatched[0]!.prompt, /PROJECT FILES/, "the workspace view is embedded");
    assert.match(dispatched[0]!.prompt, /README\.md/, "a tracked file is included");
    assert.match(dispatched[0]!.prompt, /HOW TO MAKE CHANGES/, "the output protocol is stated");
    assert.match(dispatched[0]!.prompt, /DEXNEST_FILE/, "the envelope format is shown");
    h.close();
  });

  test("a turn that returns no file blocks still verifies and reports honestly", async () => {
    // This is exactly what the real CLI did with tools disabled: it narrated a
    // tool call, changed nothing, and reported success.
    const root = workspace([{ verify: { typecheck: 1 }, emitFiles: [] }], { typecheck: 1 });
    const h = openLoop(root, { maxConsecutiveFailures: 1 });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "consecutive_failures", "no silent success");
    const events = h.engine.snapshot("loop-run").events;
    assert.ok(events.some((event) => event.type === "WORKER_OUTPUT_REJECTED"), "the empty result is recorded");
    assert.deepEqual(h.loop.checkpoints.store.list("loop-run"), [], "nothing was checkpointed");
    h.close();
  });
});
