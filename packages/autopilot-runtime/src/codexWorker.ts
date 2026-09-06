import { DurableWorker, type WorkerOptions, type WorkerProtocol, type WorkerFailure, type WorkerResult } from "./worker.ts";
import type { RunCommandIntent } from "./intent.ts";

export const CODEX_SUPPORTED_VERSION = "0.153.0";
// Version-pinned: new CLI tool defaults require a fresh compatibility audit.
export const CODEX_DISABLED_FEATURES = ["shell_tool", "unified_exec", "shell_snapshot", "apps", "plugins", "hooks",
  "multi_agent", "multi_agent_v2", "browser_use", "browser_use_external", "computer_use", "image_generation", "view_image",
  "code_mode", "code_mode_host", "code_mode_only", "skill_search", "skill_mcp_dependency_install", "sleep_tool", "goals",
  "memories", "request_permissions_tool", "tool_suggest", "in_app_browser", "in_app_local_automation", "recommended_plugins", "remote_plugin",
  "artifact", "auth_elicitation", "context_management", "default_mode_request_user_input", "executor_capability_discovery",
  "workspace_dependencies", "request_rule", "realtime_conversation", "enable_mcp_apps", "external_agent_memory_import", "external_migration"] as const;

export const CODEX_RESTRICTED_CONFIG: Record<string, unknown> = {
  forced_login_method: "chatgpt", model_provider: "openai", sandbox_mode: "read-only", approval_policy: "on-request", approvals_reviewer: "user",
  web_search: "disabled", project_doc_max_bytes: 0, "tools.update_plan.enabled": false,
  "tools.experimental_request_user_input.enabled": false,
  "features.skip_host_skill_discovery": true,
  ...Object.fromEntries(CODEX_DISABLED_FEATURES.map(name => [`features.${name}`, false]))
};
export const codexConfigArgs = () => Object.entries(CODEX_RESTRICTED_CONFIG).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);

export function classifyCodexFailure(text: string): WorkerFailure {
  if (/thread.{0,50}(not found|missing|invalid|expired)|session.{0,50}(not found|missing|invalid|expired)|no rollout|no saved session/i.test(text)) return "session";
  if (/quota|usage.?limit|rate.?limit|usage limit|credits|\b429\b/i.test(text)) return "quota";
  if (/not logged in|login|unauthorized|authentication|token.{0,20}(expired|invalid)|\b401\b/i.test(text)) return "auth";
  if (/permission|denied|sandbox/i.test(text)) return "permission";
  return "process";
}

export function codexProtocol(executable: string): WorkerProtocol {
  if (!executable.trim() || /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error("Configure a native Codex executable.");
  const command = (cwd: string, args: string[], stdin?: string): RunCommandIntent => ({
    kind: "RUN_COMMAND", executable, args, cwd, stdin, timeoutMs: stdin === undefined ? 15000 : 120000,
    purpose: stdin === undefined ? "Inspect Codex subscription availability" : "Send one Codex prompt",
    ...(stdin === undefined ? {} : { transport: "codex-app-server" as const })
  });
  return {
    id: "codex",
    installation: cwd => command(cwd, ["--version"]),
    authentication: cwd => command(cwd, ["login", "status"]),
    parseInstallation(result) {
      if (result.detail?.failure === "spawn") return { installed: false, version: null, failure: "not_installed" };
      const version = /codex-cli (\d+\.\d+\.\d+)\b/.exec(result.stdout ?? "")?.[1] ?? null;
      return { installed: version ? true : null, version, failure: result.ok && version === CODEX_SUPPORTED_VERSION ? null : "unsupported" };
    },
    parseAuthentication(result) {
      const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
      if (result.ok && /^Logged in using ChatGPT$/im.test(text) && !/api.?key/i.test(text)) return { authenticated: true, failure: null };
      return { authenticated: false, failure: result.detail?.failure === "timeout" ? "timeout" : "auth" };
    },
    prompt(session, text) {
      if (session.established && !session.providerSessionId) throw new Error("Codex session identity is unavailable; do not create a replacement session.");
      const args = ["app-server", "--stdio", ...codexConfigArgs()];
      if (!session.disabledMcpServers) throw new Error("Codex requires configuration detection before preparing a prompt.");
      for (const name of session.disabledMcpServers) {
        if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Invalid MCP configuration name.");
        args.push("-c", `mcp_servers.${name}.enabled=false`);
      }
      return command(session.cwd, args, JSON.stringify({ sessionId: session.sessionId, providerSessionId: session.providerSessionId ?? null, prompt: text }));
    },
    completion(result, sessionId) {
      const base: WorkerResult = { ok: false, text: "", failure: "protocol", sessionId, sessionConfirmed: false, certain: false };
      const transport = result.detail?.failure;
      if (transport) return { ...base, failure: transport === "spawn" ? "not_installed" : transport === "timeout" ? "timeout" : transport === "interrupted" ? "interrupted" : transport === "process" ? classifyCodexFailure(result.stderr ?? "") : "protocol", certain: transport === "spawn" };
      try {
        const raw = JSON.parse(result.stdout ?? "") as WorkerResult;
        if (raw.sessionId !== sessionId || typeof raw.ok !== "boolean" || typeof raw.certain !== "boolean" || typeof raw.text !== "string" || typeof raw.sessionConfirmed !== "boolean") return base;
        if (raw.ok && (!result.ok || !raw.providerSessionId || !raw.sessionConfirmed || !raw.certain || raw.failure !== null)) return base;
        return raw;
      } catch {
        const failure = classifyCodexFailure(result.stderr ?? "");
        return { ...base, failure: result.ok ? "protocol" : failure };
      }
    }
  };
}

export class CodexWorker extends DurableWorker {
  private readonly codexOptions: WorkerOptions & { executable: string };
  constructor(options: WorkerOptions & { executable: string }) { super(codexProtocol(options.executable), options); this.codexOptions = options; }

  override async detect(runId: string) {
    const availability = await super.detect(runId);
    if (availability.failure || !availability.authenticated) return availability;
    const session = this.startSession(runId);
    const { effects, ports, policy, executable } = this.codexOptions;
    const outcome = await effects.request({ runId, stepKey: ports.ids.next("worker-config-probe"), policy,
      diagnostics: { provider: "codex", role: "PROBE" },
      intent: { kind: "RUN_COMMAND", executable, args: ["mcp", "list", "--json", ...codexConfigArgs()], cwd: session.cwd, timeoutMs: 15000, purpose: "Discover MCP names to disable for this worker" } });
    if (!("result" in outcome) || !outcome.result.ok) return { ...availability, failure: "policy" as const };
    try {
      const servers: unknown = JSON.parse(outcome.result.stdout ?? "");
      if (!Array.isArray(servers) || servers.some(server => !server || typeof server.name !== "string")) throw new Error("Invalid MCP list");
      // Persist names only. Transport URLs, environment values and tokens are never retained.
      this.sessions.recordDisabledMcpServers(runId, servers.map(server => server.name as string));
      return availability;
    } catch { return { ...availability, failure: "policy" as const }; }
  }
}
