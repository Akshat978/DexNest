import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessPort } from "../../../../apps/desktop/src/main/autopilotPlatform.ts";
import { createPlatformPorts } from "./platform.ts";
import { createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger } from "./harness.ts";
import { runAutopilotMigrations } from "../../src/migrations.ts";
import { AutopilotStore } from "../../src/store.ts";
import { Dispatcher } from "../../src/dispatcher.ts";
import { EffectsGateway } from "../../src/effects.ts";
import { ClaudeCodeWorker } from "../../src/claudeCodeWorker.ts";
import { defaultCapabilityPolicy } from "../../src/policy.ts";
import type { ProcessPort, RuntimePorts } from "../../src/ports.ts";

export const SESSION_ID = "11111111-2222-4333-8444-555555555555";
export const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "fakeClaude.mjs");
export const CODEX_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "fakeCodex.mjs");

export function openWorker(root: string, instance = 1, hooks: {
  beforeProcess?: (input: Parameters<ProcessPort["run"]>[0]) => void;
  afterProcess?: () => void;
  beforeEffect?: () => void;
} = {}) {
  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));
  const platform = createPlatformPorts({ ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")),
    ANTHROPIC_API_KEY: "must-not-leak", anthropic_api_key: "also-must-not-leak", OPENAI_API_KEY: "must-not-leak-openai", openai_api_key: "also-must-not-leak-openai" });
  const realProcess = createProcessPort();
  const calls: Parameters<ProcessPort["run"]>[0][] = [];
  platform.process.run = async (input) => {
    calls.push(input);
    hooks.beforeProcess?.(input);
    const fixture = /codex(?:\.exe)?$/i.test(input.executable) ? CODEX_FIXTURE : FIXTURE;
    const result = await realProcess.run({ ...input, executable: process.execPath, args: [fixture, ...input.args] });
    hooks.afterProcess?.();
    return result;
  };
  platform.process.ownedProcesses = (runId) => realProcess.ownedProcesses(runId);
  platform.process.terminate = (owned) => realProcess.terminate(owned);
  const ports: RuntimePorts = { db: database.db, platform, clock: createTestClock(), ids: createTestIds(instance), logger: createTestLogger() };
  runAutopilotMigrations(ports.db, ports.clock.now());
  const store = new AutopilotStore(ports);
  const policy = defaultCapabilityPolicy();
  policy.workspaceRoot = resolve(root, "worktree");
  policy.allowedCommands = [{ executable: "claude", decision: "ALLOW", reason: "test worker", risk: "high" }];
  policy.environment.allow.push("ANTHROPIC_API_KEY", "anthropic_api_key");
  const effects = new EffectsGateway({ ports, store, dispatcher: new Dispatcher({ platform }) });
  if (hooks.beforeEffect) {
    const request = effects.request.bind(effects);
    effects.request = async (input) => { hooks.beforeEffect!(); return request(input); };
  }
  const worker = new ClaudeCodeWorker({ executable: "claude.exe", ports, effects, policy, newSessionId: () => SESSION_ID });
  return { ports, store, policy, effects, worker, calls, realProcess, close: database.close };
}
