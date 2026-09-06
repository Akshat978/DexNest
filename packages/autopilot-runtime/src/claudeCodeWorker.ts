import { DurableWorker, type WorkerOptions, type WorkerProtocol, type WorkerFailure, type WorkerResult } from "./worker.ts";
import type { DispatchResult } from "./dispatcher.ts";
import type { RunCommandIntent } from "./intent.ts";

function object(text: string | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function classifyClaudeFailure(text: string): WorkerFailure {
  if (/no conversation found|session.{0,40}(not found|expired|invalid)|invalid session|unknown session/i.test(text)) return "session";
  if (/not logged in|authentication|unauthorized|invalid.{0,15}(oauth|token)|login required|please.{0,8}log.?in|\b401\b/i.test(text)) return "auth";
  if (/quota|usage.{0,20}limit|rate.?limit|hit your limit|credit balance|\b429\b|overloaded/i.test(text)) return "quota";
  if (/permission|not allowed|denied/i.test(text)) return "permission";
  return "process";
}

/** Native executable only: no PowerShell/npm shim and no permission-bypass option. */
export function claudeCodeProtocol(executable: string): WorkerProtocol {
  if (!executable.trim() || /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error("Configure the native Claude executable, not a shell shim.");
  const command = (cwd: string, args: string[], stdin?: string): RunCommandIntent => ({
    kind: "RUN_COMMAND", executable, args, cwd, stdin, timeoutMs: stdin === undefined ? 15_000 : 120_000,
    purpose: stdin === undefined ? "Inspect Claude availability" : "Send one Claude prompt"
  });
  return {
    id: "claude",
    installation: (cwd) => command(cwd, ["--version"]),
    authentication: (cwd) => command(cwd, ["auth", "status", "--json"]),
    parseInstallation(result) {
      if (result.detail?.failure === "spawn") return { installed: false, version: null, failure: "not_installed" };
      const match = /\b(\d+\.\d+\.\d+)\s+\(Claude Code\)/.exec(result.stdout ?? "");
      if (!result.ok || !match) return { installed: null, version: null, failure: "unsupported" };
      const [major, minor, patch] = match[1]!.split(".").map(Number) as [number, number, number];
      if (major < 2 || (major === 2 && (minor < 1 || (minor === 1 && patch < 207)))) {
        return { installed: true, version: match[1]!, failure: "unsupported" };
      }
      return { installed: true, version: match[1]!, failure: null };
    },
    parseAuthentication(result) {
      const status = object(result.stdout);
      // Only existing subscription OAuth. Never fall back to API billing.
      if (status?.loggedIn === true && status.authMethod === "claude.ai" && result.ok) return { authenticated: true, failure: null };
      if (status?.loggedIn === false || status?.authMethod) return { authenticated: false, failure: "auth" };
      return { authenticated: null, failure: result.detail?.failure === "timeout" ? "timeout" : "protocol" };
    },
    prompt(session, text) {
      return command(session.cwd, [
        "--print", "--output-format", "json", "--input-format", "text",
        // Foundation only: no tools or custom hooks/MCP/plugins, even on resume.
        // Safe mode preserves subscription auth; --bare does not.
        "--safe-mode", "--tools", "", "--permission-mode", "manual",
        "--settings", '{"forceLoginMethod":"claudeai"}',
        "--max-turns", "1",
        ...(session.established ? ["--resume", session.sessionId] : ["--session-id", session.sessionId])
      ], text);
    },
    completion(result: DispatchResult, sessionId: string): WorkerResult {
      const raw = object(result.stdout);
      const base: WorkerResult = { ok: false, text: "", failure: null, sessionId, sessionConfirmed: false, certain: false };
      if (result.detail?.failure === "spawn") return { ...base, failure: "not_installed", certain: true };
      if (result.detail?.failure === "timeout") return { ...base, failure: "timeout" };
      if (result.detail?.failure === "interrupted") return { ...base, failure: "interrupted" };
      if (result.detail?.failure === "output_limit") return { ...base, failure: "protocol" };
      if (raw?.session_id && raw.session_id !== sessionId) return { ...base, failure: "session" };
      if (raw?.type === "result" && raw.session_id === sessionId) {
        const text = typeof raw.result === "string" ? raw.result : Array.isArray(raw.errors) ? raw.errors.join("\n") : "";
        if (raw.subtype === "success" && raw.is_error === false && result.ok && typeof raw.result === "string") {
          return { ...base, ok: true, text, sessionConfirmed: true, certain: true };
        }
        if (raw.is_error === true) return { ...base, text, failure: classifyClaudeFailure(`${raw.subtype} ${text}`), sessionConfirmed: true, certain: true };
      }
      const failure = classifyClaudeFailure(`${result.stderr ?? ""} ${result.stdout ?? ""}`);
      // Known CLI rejections are distinct from a truncated/missing completion.
      return { ...base, failure: failure === "process" ? "protocol" : failure,
        certain: !result.ok && ["auth", "quota", "session"].includes(failure) };
    }
  };
}

export class ClaudeCodeWorker extends DurableWorker {
  constructor(options: WorkerOptions & { executable: string }) { super(claudeCodeProtocol(options.executable), options); }
}
