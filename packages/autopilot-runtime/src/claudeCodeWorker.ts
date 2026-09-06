import { DurableWorker, MEDIATED, WORKER_PROMPT_TIMEOUT_MS, WORKER_PROBE_TIMEOUT_MS, type WorkerCapabilities, type WorkerOptions, type WorkerProtocol, type WorkerFailure, type WorkerResult } from "./worker.ts";
import type { DispatchResult } from "./dispatcher.ts";
import type { RunCommandIntent } from "./intent.ts";

function object(text: string | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/**
 * The authoritative result object, whether the CLI buffered it or streamed it.
 *
 * In stream-json mode every event is its own line and the LAST "result" line is
 * the outcome; in json mode the whole of stdout is that object. Both shapes are
 * accepted, because the mediated and agentic profiles are the same code path
 * and a half-written stream must never be mistaken for a completed one.
 *
 * Anything unparseable yields null, which the caller already treats as "no
 * completion" — the safe direction, since an unreadable answer must never be
 * read as a successful one.
 */
export function resultEvent(text: string | undefined): Record<string, unknown> | null {
  const whole = object(text);
  if (whole) return whole;
  let found: Record<string, unknown> | null = null;
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    const parsed = object(line);
    if (parsed?.type === "result") found = parsed;
  }
  return found;
}

export function classifyClaudeFailure(text: string): WorkerFailure {
  if (/no conversation found|session.{0,40}(not found|expired|invalid)|invalid session|unknown session/i.test(text)) return "session";
  if (/not logged in|authentication|unauthorized|invalid.{0,15}(oauth|token)|login required|please.{0,8}log.?in|\b401\b/i.test(text)) return "auth";
  if (/quota|usage.{0,20}limit|rate.?limit|hit your limit|credit balance|\b429\b|overloaded/i.test(text)) return "quota";
  if (/permission|not allowed|denied/i.test(text)) return "permission";
  return "process";
}

/** Native executable only: no PowerShell/npm shim and no permission-bypass option. */
export function claudeCodeProtocol(executable: string, capabilities: WorkerCapabilities = MEDIATED): WorkerProtocol {
  if (!executable.trim() || /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error("Configure the native Claude executable, not a shell shim.");
  const command = (cwd: string, args: string[], stdin?: string): RunCommandIntent => ({
    kind: "RUN_COMMAND", executable, args, cwd, stdin,
    timeoutMs: stdin === undefined ? WORKER_PROBE_TIMEOUT_MS : WORKER_PROMPT_TIMEOUT_MS,
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
      // Safe mode in both profiles: it disables customizations (CLAUDE.md,
      // skills, plugins, hooks, MCP) while leaving auth, built-in tools and
      // permissions working normally. It is what keeps an unattended run
      // reproducible without giving up subscription auth, which --bare does.
      // stream-json rather than json, so the turn can be watched as it happens.
      // The stream ENDS with the same result object json would have returned,
      // and that object is still the only thing the outcome is read from — see
      // completion() below. Streaming buys visibility and changes nothing about
      // what a turn is judged to have done.
      //
      // --verbose is not optional here and not a debugging aid: the CLI refuses
      // outright with "When using --print, --output-format=stream-json requires
      // --verbose". Found the hard way, on the first real run.
      const base = [
        "--print", "--output-format", "stream-json", "--verbose",
        "--input-format", "text", "--safe-mode"
      ];
      const identity = [
        "--settings", '{"forceLoginMethod":"claudeai"}',
        ...(session.established ? ["--resume", session.sessionId] : ["--session-id", session.sessionId])
      ];

      if (capabilities.profile === "mediated") {
        return command(session.cwd, [
          ...base,
          // No tools at all: the worker emits files as text and DexNest writes
          // them, so every side effect passes through policy first.
          "--tools", "", "--permission-mode", "manual",
          ...identity,
          "--max-turns", "1"
        ], text);
      }

      return command(session.cwd, [
        ...base,
        // An explicit tool allow-list, so the set cannot widen when the CLI
        // gains new tools. cwd confines the file tools; no --add-dir is passed.
        "--tools", capabilities.tools.join(","),
        ...(capabilities.model ? ["--model", capabilities.model] : []),
        ...(capabilities.effort ? ["--effort", capabilities.effort] : []),
        // "auto" is the mode the editor's own Auto setting uses: the CLI
        // applies its safety check and proceeds, refusing anything risky.
        //
        // acceptEdits was the first choice and it was too narrow — it
        // auto-accepts EDITS only, so any command outside --allowedTools still
        // needed an approval nobody is present to give. Never
        // bypassPermissions: an unattended run is exactly the case where the
        // checks matter, and --disallowedTools below still applies on top.
        "--permission-mode", "auto",
        ...(capabilities.allowedTools.length ? ["--allowedTools", ...capabilities.allowedTools] : []),
        ...(capabilities.deniedTools.length ? ["--disallowedTools", ...capabilities.deniedTools] : []),
        ...identity,
        // Turns inside this one send, spent reading, editing and testing.
        "--max-turns", String(capabilities.maxTurns)
      ], text);
    },
    completion(result: DispatchResult, sessionId: string): WorkerResult {
      const raw = resultEvent(result.stdout);
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
  constructor(options: WorkerOptions & { executable: string; capabilities?: WorkerCapabilities }) {
    super(claudeCodeProtocol(options.executable, options.capabilities ?? MEDIATED), options);
  }
}
