// Verification sanity and selective context.
//
// Both exist because of the first live trial: a misconfigured command burned the
// whole turn budget, and whole-repo context does not scale.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertSafeDataRoot } from "./helpers/harness.ts";
import { initWorktree, openLoop, VERIFY_FIXTURE, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { classifyTierFailure, VERIFICATION_CONFIGURATION_ERROR } from "../src/verificationSanity.ts";
import { selectContextFiles, extractReferencedPaths, DEFAULT_CONTEXT_LIMITS } from "../src/contextSelection.ts";
import type { VerificationTierResult } from "../src/verification.ts";

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
  const root = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-sanity-")));
  dirs.push(root);
  initWorktree(resolve(root, "worktree"), plan, verifyState);
  return root;
}

function tier(overrides: Partial<VerificationTierResult> = {}): VerificationTierResult {
  return {
    tier: "test",
    command: "node --test test/",
    ran: true,
    ok: false,
    exitCode: 1,
    detail: "",
    gating: true,
    ...overrides
  };
}

describe("verification sanity: configuration vs code", () => {
  test("the real trial bug — `node --test test/` MODULE_NOT_FOUND — is a configuration error", () => {
    // Verbatim shape of the failure that burned five turns in the live trial.
    const detail = [
      "Error: Cannot find module 'C:\\\\Users\\\\aksha\\\\AppData\\\\Local\\\\Temp\\\\dexnest-trial\\\\worktree\\\\test'",
      "    at Function._resolveFilename (node:internal/modules/cjs/loader:1225:15)",
      "  code: 'MODULE_NOT_FOUND',",
      "  requireStack: []"
    ].join("\n");

    const classification = classifyTierFailure({
      tier: tier({ command: "node --test test/", detail }),
      history: [],
      everMadeProgress: false
    });

    assert.equal(classification.kind, "configuration");
    assert.equal(classification.rule, "verification.target-missing");
    assert.match(classification.reason, /test/);
    assert.match(classification.reason, /node --test test\//);
  });

  test("a genuine test failure stays a code failure, however often it repeats", () => {
    const detail = "# tests 6\n# pass 3\n# fail 3\nnot ok 4 - evicts the least recently used entry\n  AssertionError: expected undefined";
    const failing = tier({ detail });

    for (const repeats of [0, 1, 5, 20]) {
      const classification = classifyTierFailure({
        tier: failing,
        history: Array.from({ length: repeats }, () => "test|1|same"),
        everMadeProgress: true
      });
      assert.equal(classification.kind, "code", `repeats=${repeats} must stay a code failure`);
    }
  });

  test("a compiler error is a code failure, not a configuration error", () => {
    const classification = classifyTierFailure({
      tier: tier({ tier: "typecheck", command: "tsc -p tsconfig.json", detail: "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'." }),
      history: [],
      everMadeProgress: false
    });
    assert.equal(classification.kind, "code");
  });

  test("a missing module the CODE imports stays a code failure", () => {
    // The missing name is not an argument of the command, so this is the
    // worker's bug to fix rather than a broken command.
    const classification = classifyTierFailure({
      tier: tier({ command: "node --test test/lru.test.mjs", detail: "Error: Cannot find module './helpers/missing.js'\ncode: 'MODULE_NOT_FOUND'" }),
      history: [],
      everMadeProgress: false
    });
    assert.equal(classification.kind, "code");
  });

  test("an unstartable executable is a configuration error immediately", () => {
    for (const detail of [
      "'pnpm' is not recognized as an internal or external command,",
      "spawn tsc ENOENT",
      "/bin/sh: vitest: command not found"
    ]) {
      const classification = classifyTierFailure({ tier: tier({ detail }), history: [], everMadeProgress: false });
      assert.equal(classification.kind, "configuration", detail);
      assert.equal(classification.rule, "verification.executable-missing");
    }
  });

  test("a tier policy would not run is a configuration error", () => {
    const classification = classifyTierFailure({
      tier: tier({ ran: false, detail: "Verification command was not permitted: not in the allowed set." }),
      history: [],
      everMadeProgress: false
    });
    assert.equal(classification.kind, "configuration");
    assert.equal(classification.rule, "verification.tier-could-not-run");
  });

  test("identical failures with no execution progress escalate only after repeating", () => {
    const failing = tier({ command: "node run-checks.js", detail: "checks aborted" });
    const signature = "test|1|checks aborted";

    assert.equal(classifyTierFailure({ tier: failing, history: [], everMadeProgress: false }).kind, "code");
    assert.equal(classifyTierFailure({ tier: failing, history: [signature], everMadeProgress: false }).kind, "code");

    const escalated = classifyTierFailure({ tier: failing, history: [signature, signature], everMadeProgress: false });
    assert.equal(escalated.kind, "configuration");
    assert.equal(escalated.rule, "verification.repeated-without-progress");
  });

  test("a tier that once executed is never escalated by repetition", () => {
    const failing = tier({ detail: "checks aborted" });
    const signature = "test|1|checks aborted";
    const classification = classifyTierFailure({
      tier: failing,
      history: [signature, signature, signature],
      everMadeProgress: true
    });
    assert.equal(classification.kind, "code", "a tier that has run before is repairable, not misconfigured");
  });
});

describe("verification sanity end to end", () => {
  test("a missing verification target holds the run instead of spending the budget", async () => {
    const root = workspace([{ verify: { test: 1 }, emitFiles: [{ path: "src/lru.js", contents: "export const a = 1;" }] }], { test: 1 });
    // A command whose target does not exist: the real trial's bug.
    const h = openLoop(root, {
      tiers: ["test"],
      commandFor: () => "node --test does-not-exist/",
      acceptance: [{ id: "ac-1", text: "tests pass", kind: "automated", check: "node --test does-not-exist/" }],
      maxConsecutiveFailures: 9
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "verification_indeterminate");
    assert.equal(h.store.requireRun("loop-run").state, "NEEDS_REVIEW");

    const report = outcome.lastVerification!;
    assert.ok(report.configurationError, "the configuration error is recorded");
    assert.equal(report.configurationError!.tier, "test");
    assert.match(report.configurationError!.command, /does-not-exist/);
    assert.match(report.indeterminateReason!, new RegExp(VERIFICATION_CONFIGURATION_ERROR));

    // The whole point: one turn spent, not the whole grant.
    assert.equal(outcome.turnsRun, 1);
    assert.equal(h.loop.loops.activeGrant("loop-run")!.turnsUsed, 1);
    assert.deepEqual(h.loop.checkpoints.store.list("loop-run"), [], "nothing was checkpointed");
    h.close();
  });

  test("the run report surfaces the configuration error", async () => {
    const root = workspace([{ verify: { test: 1 }, emitFiles: [] }], { test: 1 });
    const h = openLoop(root, {
      tiers: ["test"],
      commandFor: () => "node --test does-not-exist/",
      acceptance: [{ id: "ac-1", text: "tests pass", kind: "automated", check: "node --test does-not-exist/" }]
    });
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    const report = h.loop.report("loop-run");
    assert.match(report.outcome.reason, new RegExp(VERIFICATION_CONFIGURATION_ERROR));
    assert.equal(report.loop.turns[0]!.verification!.outcome, "INDETERMINATE");
    h.close();
  });

  test("a genuine failing suite still drives repair turns", async () => {
    const root = workspace(
      [
        { verify: { test: 1 }, emitFiles: [{ path: "src/lru.js", contents: "export const v = 1;" }] },
        { verify: { test: 0 }, emitFiles: [{ path: "src/lru.js", contents: "export const v = 2;" }] }
      ],
      { test: 1 }
    );
    const h = openLoop(root, { tiers: ["test"], maxConsecutiveFailures: 9 });
    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "completed", "real failures are repaired, not escalated");
    assert.equal(outcome.turnsRun, 2);
    assert.equal(h.loop.loops.verifications("loop-run")[0]!.report.configurationError, null);
    h.close();
  });
});

describe("selective context", () => {
  const tracked = [
    "package.json",
    "src/lru.js",
    "src/unrelated.js",
    "src/deep/other.js",
    "test/lru.test.mjs",
    "docs/README.md"
  ];

  test("extracts tracked paths named in failure output, including bare basenames", () => {
    const found = extractReferencedPaths(
      "not ok 1 - lru\n  at test/lru.test.mjs:12\n  from lru.js\n  unrelated-but-untracked.txt",
      tracked
    );
    assert.ok(found.includes("test/lru.test.mjs"));
    assert.ok(found.includes("src/lru.js"), "a bare basename resolves to its tracked path");
    assert.ok(!found.includes("unrelated-but-untracked.txt"), "untracked names are never selected");
  });

  test("files named in the failure output come first", () => {
    const selection = selectContextFiles({
      tracked,
      specText: "Fix the cache",
      failureOutput: "not ok 1\n  at test/lru.test.mjs:9",
      changed: []
    });
    assert.equal(selection.files[0]!.path, "test/lru.test.mjs");
    assert.equal(selection.files[0]!.reason, "failure-output");
  });

  test("previously changed files outrank spec references on later turns", () => {
    const selection = selectContextFiles({
      tracked,
      specText: "Update docs/README.md as needed",
      failureOutput: "",
      changed: ["src/lru.js"]
    });
    assert.equal(selection.files[0]!.path, "src/lru.js");
    assert.equal(selection.files[0]!.reason, "previously-changed");
    const readme = selection.files.find((file) => file.path === "docs/README.md");
    assert.equal(readme?.reason, "spec-reference");
  });

  test("unrelated files are excluded once there is enough evidence", () => {
    const selection = selectContextFiles({
      tracked,
      specText: "",
      failureOutput: "at test/lru.test.mjs:9",
      changed: ["src/lru.js"]
    });
    const paths = selection.files.map((file) => file.path);
    assert.ok(!paths.includes("src/unrelated.js"), "an unrelated file is not sent");
    assert.ok(!paths.includes("src/deep/other.js"));
    assert.ok(paths.includes("package.json"), "project metadata is still included");
  });

  test("falls back to tracked files only when evidence is too thin", () => {
    const selection = selectContextFiles({ tracked: ["a.js", "b.js"], specText: "", failureOutput: "", changed: [] });
    assert.ok(selection.files.length >= DEFAULT_CONTEXT_LIMITS.minFiles);
    assert.deepEqual(selection.files.map((file) => file.reason), ["fallback", "fallback"]);
  });

  test("limits are enforced and configurable", () => {
    const many = Array.from({ length: 50 }, (_, index) => `src/f${index}.js`);
    const selection = selectContextFiles({
      tracked: many,
      specText: "",
      failureOutput: "",
      changed: [],
      limits: { maxFiles: 3, maxBytes: 1000, minFiles: 1 }
    });
    assert.equal(selection.files.length, 3);
    assert.equal(selection.omitted, 47);
  });

  test("selection is deterministic for identical inputs", () => {
    const input = { tracked, specText: "fix src/lru.js", failureOutput: "at test/lru.test.mjs:1", changed: ["src/unrelated.js"] };
    const first = selectContextFiles(input);
    const second = selectContextFiles(input);
    assert.deepEqual(first.files, second.files);
  });
});

describe("selective context in the loop", () => {
  test("the prompt carries only the selected files, and every read goes through READ_FILE", async () => {
    const root = workspace(
      [{ verify: { test: 0 }, emitFiles: [{ path: "src/lru.js", contents: "export const ok = true;" }] }],
      { test: 0 }
    );
    // Add noise the selector should exclude.
    const worktree = resolve(root, "worktree");
    mkdirSync(resolve(worktree, "src"), { recursive: true });
    writeFileSync(resolve(worktree, "src", "lru.js"), "export const stub = 0;\n", "utf8");
    writeFileSync(resolve(worktree, "src", "noise-one.js"), "export const noise = 1;\n", "utf8");
    writeFileSync(resolve(worktree, "src", "noise-two.js"), "export const noise = 2;\n", "utf8");
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["add", "-A"], { cwd: worktree, windowsHide: true });
    execFileSync("git", ["commit", "-m", "add sources"], { cwd: worktree, windowsHide: true });

    const h = openLoop(root, { tiers: ["test"] });
    h.createRun({ goal: "Fix src/lru.js so the cache works" });
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    const dispatched = JSON.parse(readFileSync(resolve(worktree, ".loop-dispatches.json"), "utf8")) as Array<{ prompt: string }>;
    const prompt = dispatched[0]!.prompt;

    assert.match(prompt, /src\/lru\.js/, "the spec-referenced file is included");
    assert.ok(!prompt.includes("noise-one.js"), "unrelated noise is excluded");
    assert.ok(!prompt.includes("noise-two.js"));

    // Every file in the prompt was read through a policy-checked READ_FILE.
    const operations = h.effects.operations.listForRun("loop-run");
    const reads = operations.filter((operation) => operation.kind === "READ_FILE");
    assert.ok(reads.length > 0, "context was gathered via READ_FILE intents");
    for (const read of reads) {
      assert.equal(read.decision, "ALLOW");
      assert.equal(read.status, "COMPLETED");
    }

    const contextEvent = h.engine.snapshot("loop-run").events.find((event) => event.type === "WORKSPACE_CONTEXT_READ");
    assert.ok(contextEvent, "the selection is journalled");
    const selected = contextEvent!.payload.selected as Array<{ path: string; reason: string }>;
    assert.ok(selected.every((entry) => entry.reason), "every selected file records why");
    h.close();
  });

  test("selection survives a restart deterministically", async () => {
    const root = workspace([{ verify: { test: 1 }, emitFiles: [{ path: "src/lru.js", contents: "export const v = 1;" }] }], { test: 1 });
    const first = openLoop(root, { tiers: ["test"], maxConsecutiveFailures: 1 });
    first.createRun();
    first.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    await first.loop.run("loop-run");

    const before = first.engine
      .snapshot("loop-run")
      .events.filter((event) => event.type === "WORKSPACE_CONTEXT_READ")
      .map((event) => JSON.stringify(event.payload.selected));
    first.close();

    // A fresh runtime rebuilds the same selection inputs from the journal.
    const second = openLoop(root, { instance: 2, tiers: ["test"], maxConsecutiveFailures: 1 });
    const applied = second.engine
      .snapshot("loop-run")
      .events.filter((event) => event.type === "WORKER_OUTPUT_APPLIED")
      .flatMap((event) => (event.payload.paths as string[]) ?? []);
    assert.deepEqual(applied, ["src/lru.js"], "changed paths are durable, so priority is reproducible");
    assert.ok(before.length > 0);
    second.close();
  });
});
