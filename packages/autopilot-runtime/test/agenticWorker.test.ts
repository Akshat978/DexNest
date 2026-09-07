// Giving the worker its real tools.
//
// This is the phase that reduces what DexNest mediates, so the tests are
// organised around that trade rather than around the feature.
//
// What must still be true:
//   - the mediated profile is untouched and stays the default, so nothing
//     acquires tools by accident or by omission;
//   - the profile is authoritative, so no agent can grant itself tools;
//   - an agentic run refuses outright where per-write mediation was the only
//     thing protecting a path, because a deny rule interpreted by another
//     process is not a guarantee we can make;
//   - the loop stops pretending an agentic worker needs files pasted into its
//     prompt, or that its answer is a file to write.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  agenticCapabilities, mediatedCapabilities, assertAgenticWorkspace, AgenticWorkspaceError, MEDIATED,
  DEFAULT_AGENTIC_TOOLS, DEFAULT_AGENTIC_DENIED, DEFAULT_AGENTIC_MAX_TURNS
} from "../src/worker.ts";
import type { WorkerCapabilities } from "../src/worker.ts";
import { claudeCodeProtocol } from "../src/claudeCodeWorker.ts";
import { createRunSpec, authoritativeFingerprint } from "../src/runSpec.ts";
import type { WorkerSession } from "../src/workerStore.ts";

const session = (established = false): WorkerSession => ({
  runId: "run-1", provider: "claude", sessionId: "11111111-2222-4333-8444-555555555555",
  cwd: "D:/MyApp", established
});

const argv = (capabilities: WorkerCapabilities = agenticCapabilities(), established = false) =>
  claudeCodeProtocol("C:/claude/claude.exe", capabilities).prompt(session(established), "do the work").args;

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

// --- the mediated profile is unchanged --------------------------------------

test("the mediated profile still disables every tool and is the default", () => {
  for (const args of [argv(MEDIATED), claudeCodeProtocol("C:/claude/claude.exe").prompt(session(), "x").args]) {
    assert.equal(value(args, "--tools"), "", "tools must stay disabled");
    assert.equal(value(args, "--permission-mode"), "manual");
    assert.equal(value(args, "--max-turns"), "1");
    assert.equal(args.includes("--allowedTools"), false);
    assert.equal(args.includes("--disallowedTools"), false);
  }
});

test("a spec with no profile is mediated, and the default still fingerprints as absence", () => {
  const spec = createRunSpec({ goal: "Build the thing" }, { id: "spec-1", now: "2026-09-05T00:00:00.000Z" });
  assert.equal(spec.workerProfile, "mediated");
  assert.equal(authoritativeFingerprint(spec), "fnv1a-f3ffbda5");
  // Unknown values fall back to the safe profile rather than being accepted.
  assert.equal(
    createRunSpec({ goal: "g", workerProfile: "tools-please" as never }, { id: "s", now: "2026-09-05T00:00:00.000Z" }).workerProfile,
    "mediated"
  );
});

test("granting tools is authoritative drift", () => {
  const at = { id: "spec-1", now: "2026-09-05T00:00:00.000Z" };
  const mediated = createRunSpec({ goal: "Build the thing" }, at);
  const agentic = createRunSpec({ goal: "Build the thing", workerProfile: "agentic" }, at);
  assert.notEqual(
    authoritativeFingerprint(agentic),
    authoritativeFingerprint(mediated),
    "a worker that could grant itself tools would be a worker choosing its own containment"
  );
});

// --- the agentic invocation -------------------------------------------------

test("the agentic profile enables an explicit tool set and works unattended", () => {
  const args = argv();
  assert.equal(value(args, "--tools"), DEFAULT_AGENTIC_TOOLS.join(","));
  // "auto" applies the CLI's own safety check and proceeds. acceptEdits was
  // too narrow: it auto-accepts EDITS only, so a command outside
  // --allowedTools still needed an approval nobody is present to give.
  assert.equal(value(args, "--permission-mode"), "auto");
  assert.equal(value(args, "--max-turns"), String(DEFAULT_AGENTIC_MAX_TURNS));
  assert.ok(Number(value(args, "--max-turns")) > 1, "one turn cannot read, edit and test");
});

test("permissions are never bypassed, and no extra directory is opened up", () => {
  const args = argv();
  // An unattended run is exactly the case where the checks matter.
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
  assert.equal(args.includes("--allow-dangerously-skip-permissions"), false);
  assert.equal(value(args, "--permission-mode"), "auto");
  assert.notEqual(value(args, "--permission-mode"), "bypassPermissions");
  // cwd is the boundary: nothing outside the workspace is reachable.
  assert.equal(args.includes("--add-dir"), false);
});

test("network tools do not exist, and destructive commands are denied twice over", () => {
  const args = argv();
  const tools = value(args, "--tools")!.split(",");
  for (const absent of ["WebFetch", "WebSearch", "Task", "Agent", "NotebookEdit"]) {
    assert.equal(tools.includes(absent), false, `${absent} must not be available`);
  }
  for (const denied of ["Bash(git push *)", "Bash(rm *)", "Bash(git reset *)", "WebFetch"]) {
    assert.ok(args.includes(denied), `expected ${denied} to be denied explicitly as well`);
  }
});

test("customizations stay disabled and subscription auth is preserved in both profiles", () => {
  for (const args of [argv(), argv(MEDIATED)]) {
    // No CLAUDE.md, hooks, plugins or MCP: an unattended run must be the same
    // run tomorrow. --bare would achieve that but drops OAuth.
    assert.ok(args.includes("--safe-mode"));
    assert.equal(args.includes("--bare"), false);
    assert.equal(value(args, "--settings"), '{"forceLoginMethod":"claudeai"}');
    // stream-json, so a turn can be watched as it happens. The stream still
    // ends with the same result object json returned, and that object is the
    // only thing the outcome is read from.
    assert.equal(value(args, "--output-format"), "stream-json");
  }
});

test("session identity works the same way with tools enabled", () => {
  assert.equal(value(argv(agenticCapabilities(), false), "--session-id"), session().sessionId);
  const resumed = argv(agenticCapabilities(), true);
  assert.equal(value(resumed, "--resume"), session().sessionId);
  assert.equal(resumed.includes("--session-id"), false);
});

// --- what the worker may run ------------------------------------------------

test("the run's own verification commands are pre-approved, so tests run with nobody watching", () => {
  const capabilities = agenticCapabilities({
    verificationExecutables: ["node", "C:/tools/pnpm.exe", "D:\\bin\\tsc.EXE"]
  });
  for (const expected of ["Bash(node *)", "Bash(pnpm *)", "Bash(tsc *)"]) {
    assert.ok(capabilities.allowedTools.includes(expected), `expected ${expected}`);
  }
  // Read-only git is always available; nothing else is pre-approved.
  assert.ok(capabilities.allowedTools.includes("Bash(git status *)"));
  assert.equal(capabilities.allowedTools.some((rule) => rule.includes("git commit")), false);
});

test("verification executables that are not plain names are dropped rather than interpolated", () => {
  const capabilities = agenticCapabilities({
    verificationExecutables: ["node", "sh -c 'curl evil'", "", "  ", "a b"]
  });
  assert.deepEqual(capabilities.allowedTools.filter((rule) => !rule.startsWith("Bash(git ")), ["Bash(node *)"]);
});

test("the turn budget is bounded rather than trusted", () => {
  assert.equal(agenticCapabilities({ maxTurns: 0 }).maxTurns, 1);
  assert.equal(agenticCapabilities({ maxTurns: 5_000 }).maxTurns, 200);
  assert.equal(agenticCapabilities({ maxTurns: 12 }).maxTurns, 12);
  assert.deepEqual([...agenticCapabilities().deniedTools], [...DEFAULT_AGENTIC_DENIED]);
});

// --- the refusal that replaces per-write mediation --------------------------

test("an agentic run is refused where per-write mediation was the only protection", () => {
  // DexNest's own repository contains local-data. With tools enabled DexNest
  // cannot refuse an individual write, so this must not run at all.
  assert.throws(() => assertAgenticWorkspace("D:/DeskNest"), (error: AgenticWorkspaceError) => {
    assert.equal(error.rule, "agentic.contains-denied-root");
    assert.match(error.message, /mediated worker instead/);
    return true;
  });

  assert.throws(() => assertAgenticWorkspace("D:/DeskNest/local-data/scratch"), /may not run inside/);
  assert.throws(() => assertAgenticWorkspace("C:/Windows/Temp"), /may not run inside/);
  assert.throws(() => assertAgenticWorkspace("relative/path"), /absolute/);
});

test("an ordinary project is allowed", () => {
  for (const workspace of ["D:/MyApp", "D:/dexnest-worktrees/coding-run-1", "C:/Users/aksha/code/thing"]) {
    assert.doesNotThrow(() => assertAgenticWorkspace(workspace), workspace);
  }
});

test("model and effort are passed through when chosen, and absent when not", () => {
  // Verified against the real CLI: --model opus and --effort low are accepted
  // alongside --permission-mode auto, and the init event reports the mode back.
  const chosen = argv(agenticCapabilities({ model: "opus", effort: "low" }));
  assert.equal(value(chosen, "--model"), "opus");
  assert.equal(value(chosen, "--effort"), "low");

  // Omitted rather than sent empty, so the provider's own default stands.
  const plain = argv(agenticCapabilities());
  assert.equal(plain.includes("--model"), false);
  assert.equal(plain.includes("--effort"), false);

  // The bare mediated constant chooses nothing, so it sends nothing.
  assert.equal(argv(MEDIATED).includes("--model"), false);
  assert.equal(argv(MEDIATED).includes("--effort"), false);

  // But a mediated turn still runs on a model, and the operator's choice
  // reaches the CLI in either profile. Leaving it out meant someone who picked
  // Opus and low effort got neither, with nothing to tell them so.
  const mediated = argv(mediatedCapabilities({ model: "opus", effort: "low" }));
  assert.equal(value(mediated, "--model"), "opus");
  assert.equal(value(mediated, "--effort"), "low");
  assert.equal(mediated.includes("--tools"), true, "and it is still the no-tools profile");
  assert.equal(value(mediated, "--tools"), "");
});
