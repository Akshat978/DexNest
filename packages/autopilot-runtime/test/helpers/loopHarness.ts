// Harness for the autonomous loop tests.
//
// Uses real SQLite, a real git worktree, real child processes and the real
// policy/dispatcher path. The only stand-ins are the worker CLI and the
// verification commands, so no model is ever contacted and no quota is spent.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProcessPort } from "../../../../apps/desktop/src/main/autopilotPlatform.ts";
import { createPlatformPorts } from "./platform.ts";
import { createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger } from "./harness.ts";
import { runAutopilotMigrations } from "../../src/migrations.ts";
import { AutopilotStore } from "../../src/store.ts";
import { Dispatcher } from "../../src/dispatcher.ts";
import { EffectsGateway } from "../../src/effects.ts";
import { AutopilotEngine } from "../../src/engine.ts";
import { ClaudeCodeWorker } from "../../src/claudeCodeWorker.ts";
import { AutonomousLoop } from "../../src/loop.ts";
import { ControlledWorkerTurns } from "../../src/controlledWorker.ts";
import { ScriptedExecutor, MemorySideEffectLedger } from "../../src/scriptedExecutor.ts";
import { defaultCapabilityPolicy } from "../../src/policy.ts";
import type { ProcessPort, RuntimePorts } from "../../src/ports.ts";
import type { RunSpecInput } from "../../src/runSpec.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const LOOP_WORKER_FIXTURE = resolve(here, "fakeLoopWorker.mjs");
export const LOOP_CODEX_FIXTURE = resolve(here, "fakeCodex.mjs");
export const VERIFY_FIXTURE = resolve(here, "fakeVerify.mjs");
export const LOOP_SESSION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

export interface LoopPlanStep {
  /** Exit codes per verification tier, written to the workspace by the worker. */
  verify?: Record<string, number>;
  /**
   * Files returned as TEXT in the worker's response, for DexNest to write
   * through policy. This is the production path; omit it and the fake worker
   * writes directly, which only models a tool-enabled worker.
   */
  emitFiles?: Array<{ path: string; contents: string }>;
  workerFailure?: "quota" | "auth" | "session" | "process" | "truncated";
  /** Paths this turn asks DexNest to supply on the next turn. */
  requestFiles?: string[];
  hang?: boolean;
}

/** Creates the run's worktree as a real git repository. */
export function initWorktree(worktree: string, plan: LoopPlanStep[], verifyState: Record<string, number> = {}): void {
  const git = (args: string[]) => execFileSync("git", args, { cwd: worktree, encoding: "utf8", windowsHide: true });
  execFileSync("git", ["init", "-b", "main", worktree], { encoding: "utf8", windowsHide: true });
  git(["config", "user.email", "loop@example.invalid"]);
  git(["config", "user.name", "Loop Test"]);
  writeFileSync(resolve(worktree, "README.md"), "# loop workspace\n", "utf8");
  // Real projects carry metadata, and context selection treats it as a
  // first-class signal, so the fixture must have it too.
  writeFileSync(
    resolve(worktree, "package.json"),
    JSON.stringify({ name: "loop-fixture", private: true, type: "module" }, null, 2),
    "utf8"
  );
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  writeFileSync(resolve(worktree, ".loop-plan.json"), JSON.stringify(plan), "utf8");
  writeFileSync(resolve(worktree, ".verify-state.json"), JSON.stringify(verifyState), "utf8");
}

export interface OpenLoopOptions {
  instance?: number;
  /** Verification commands for the Run Spec. Defaults to typecheck + test. */
  tiers?: string[];
  acceptance?: RunSpecInput["acceptanceCriteria"];
  maxConsecutiveFailures?: number;
  beforeProcess?: (input: Parameters<ProcessPort["run"]>[0]) => void;
  /** Overrides the command for a tier, e.g. to model a misconfigured one. */
  commandFor?: (tier: string) => string;
}

export function openLoop(root: string, options: OpenLoopOptions = {}) {
  const worktree = resolve(root, "worktree");
  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));

  const platform = createPlatformPorts({
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    ANTHROPIC_API_KEY: "must-not-leak"
  });

  const realProcess = createProcessPort();
  const calls: Parameters<ProcessPort["run"]>[0][] = [];
  platform.process.run = async (input) => {
    calls.push(input);
    options.beforeProcess?.(input);
    // Route both provider CLIs to local fixtures; everything else runs for real.
    const fixture = /claude(?:\.exe)?$/i.test(input.executable) ? LOOP_WORKER_FIXTURE
      : /codex(?:\.exe)?$/i.test(input.executable) ? LOOP_CODEX_FIXTURE : null;
    return realProcess.run(
      fixture ? { ...input, executable: process.execPath, args: [fixture, ...input.args] } : input
    );
  };
  platform.process.ownedProcesses = (runId) => realProcess.ownedProcesses(runId);
  platform.process.terminate = (owned) => realProcess.terminate(owned);

  const ports: RuntimePorts = {
    db: database.db,
    platform,
    clock: createTestClock(),
    ids: createTestIds(options.instance ?? 1),
    logger: createTestLogger()
  };
  runAutopilotMigrations(ports.db, ports.clock.now());

  const store = new AutopilotStore(ports);
  const policy = defaultCapabilityPolicy();
  policy.workspaceRoot = worktree;
  policy.allowedCommands = [
    { executable: "claude", decision: "ALLOW", reason: "test worker", risk: "high" },
    { executable: "codex", decision: "ALLOW", reason: "test worker", risk: "high" },
    { executable: "node", decision: "ALLOW", reason: "verification command", risk: "low" },
    { executable: "git", subcommand: "status", decision: "ALLOW", reason: "verification evidence", risk: "low" }
  ];
  // The prompt itself is what the loop grant authorizes, turn by turn.
  policy.approvalCommands.push({
    executable: "claude",
    subcommand: "--print",
    decision: "REQUIRE_APPROVAL",
    reason: "Send this prompt to the sticky worker.",
    risk: "high"
  });

  const effects = new EffectsGateway({ ports, store, dispatcher: new Dispatcher({ platform }) });
  const engine = new AutopilotEngine({
    ports,
    executor: new ScriptedExecutor({ steps: [], ledger: new MemorySideEffectLedger() }),
    policy
  });

  const worker = new ClaudeCodeWorker({ executable: "claude.exe", ports, effects, policy, newSessionId: () => LOOP_SESSION_ID });
  const loop = new AutonomousLoop({ ports, engine, policy, worker });

  // The controlled host, so ownership handoff runs through the production path.
  let sessionCounter = 0;
  const workers = new ControlledWorkerTurns({
    ports, engine, executable: "claude.exe", codexExecutable: "codex.exe",
    executableFor: (provider) => `${provider}.exe`,
    newSessionId: () => `${LOOP_SESSION_ID.slice(0, -1)}${(sessionCounter += 1)}`,
    validateWorkspace: () => {},
    changed: () => {}
  });

  const tiers = options.tiers ?? ["typecheck", "test"];
  const commands = Object.fromEntries(
    tiers.map((tier) => [tier, options.commandFor ? options.commandFor(tier) : `node ${VERIFY_FIXTURE} ${tier}`])
  );

  const createRun = (overrides: Partial<RunSpecInput> = {}) =>
    engine.createRun({
      id: "loop-run",
      goal: "Make the failing check pass",
      constraints: ["do not change the acceptance criteria"],
      workers: { primary: "claude", fallback: null, sticky: true, consultantMode: false },
      capabilities: {
        workspaceRoot: worktree,
        allowedPaths: [worktree],
        forbiddenPaths: ["local-data"],
        allowedCommands: ["claude", "node", "git status"],
        forbiddenCommands: [],
        requiresApproval: []
      },
      verification: { tiers, commands },
      failurePolicy: { maxConsecutiveFailures: options.maxConsecutiveFailures ?? 3, maxAttemptsPerStep: 3 },
      acceptanceCriteria: options.acceptance ?? [
        { id: "ac-1", text: "typecheck passes", kind: "automated", check: `node ${VERIFY_FIXTURE} typecheck` }
      ],
      ...overrides
    });

  return {
    ports,
    store,
    policy,
    effects,
    engine,
    worker,
    loop,
    worktree,
    calls,
    createRun,
    workers,
    close: database.close
  };
}
