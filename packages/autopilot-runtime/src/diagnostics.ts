// Bounded, redacted diagnostics for failed provider processes.
//
// Motivated by the first real two-provider trial: a failing Claude dispatch left
// only "claude.exe exited 1" in the durable record, and the decisive line —
// "Input must be provided either through stdin ..." — was visible only after the
// dispatcher was instrumented by hand. Three runs were spent on that.
//
// The rules this module keeps:
//   - only provider/Autopilot processes, declared explicitly by the caller;
//     nothing else in DexNest starts logging its output
//   - only failures; a successful provider turn is model output, not evidence,
//     and is never stored here
//   - bounded tails, because a CLI reports its reason at the end
//   - redaction happens before anything reaches SQLite, never in the renderer
//   - classification only where the CLI's own words are unambiguous

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { CapabilityPolicy } from "./policy.ts";

/** Per-stream cap. Conservative: enough for a stack trace, far from a log file. */
export const MAX_DIAGNOSTIC_TAIL_BYTES = 12_000;

/** What produced the failing process. Bounds the scope to Autopilot providers. */
export type DiagnosticRole = "PRIMARY" | "CONSULTANT" | "PROBE";

/**
 * Deterministic failure categories.
 *
 * "process" is the honest default: an unrecognized failure keeps the generic
 * category and shows its bounded text rather than being guessed into a
 * specific one.
 */
export type DiagnosticCategory =
  | "unauthenticated"
  | "quota"
  | "not_installed"
  | "unsupported_version"
  | "session_not_found"
  | "invalid_configuration"
  | "input_protocol"
  | "timeout"
  | "interrupted"
  | "policy_refused"
  | "process";

export const DIAGNOSTIC_CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  unauthenticated: "not authenticated",
  quota: "quota exhausted",
  not_installed: "executable missing",
  unsupported_version: "unsupported version",
  session_not_found: "session not found",
  invalid_configuration: "invalid configuration",
  input_protocol: "input/protocol error",
  timeout: "timed out",
  interrupted: "interrupted",
  policy_refused: "refused by policy",
  process: "process failure"
};

export interface WorkerDiagnostics {
  id: string;
  runId: string;
  operationId: string;
  provider: string;
  role: DiagnosticRole;
  category: DiagnosticCategory;
  exitCode: number | null;
  signal: string | null;
  stdoutTail: string;
  stderrTail: string;
  /** Bytes the process actually emitted, before bounding. */
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  createdAt: string;
}

/** The caller's declaration that this operation is a provider process. */
export interface DiagnosticScope {
  provider: string;
  role: DiagnosticRole;
}

const REDACTED = "[redacted]";

/** Escapes a literal secret value for use inside a RegExp. */
function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Values of environment variables DexNest already classifies as secret.
 *
 * Deliberately reuses policy.environment.stripPatterns rather than inventing a
 * second secret list, so a variable the dispatcher refuses to pass to a child
 * is also a variable whose value is scrubbed out of that child's output.
 *
 * Short values are ignored: replacing a two-character value would corrupt
 * unrelated text without protecting anything.
 */
export function secretEnvironmentValues(policy: CapabilityPolicy, env: Record<string, string>): string[] {
  const patterns = policy.environment.stripPatterns.map((pattern) => pattern.toLowerCase());
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.trim().length < 8) continue;
    if (patterns.some((pattern) => name.toLowerCase().includes(pattern))) values.add(value);
  }
  return [...values];
}

/** Named assignments whose value must never survive, whatever it looks like. */
const SECRET_NAME = "[A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|APIKEY|CREDENTIAL|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|SESSION[_-]?KEY)[A-Za-z0-9_.-]*";

const PATTERNS: Array<{ find: RegExp; replace: string }> = [
  // NAME=value / NAME: value, quoted or bare. The name is kept so the reader
  // still learns which credential the process complained about.
  { find: new RegExp(`\\b(${SECRET_NAME})(\\s*[:=]\\s*)(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s"',;]+)`, "gi"), replace: `$1$2${REDACTED}` },
  // Authorization headers, with or without a scheme.
  { find: /\b(authorization\s*[:=]\s*)(?:bearer|basic|token)?\s*[^\s"',;]+/gi, replace: `$1${REDACTED}` },
  { find: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: `$1 ${REDACTED}` },
  // Well-known credential shapes, which appear without a name often enough.
  { find: /\bsk-ant-[A-Za-z0-9_-]{8,}/g, replace: REDACTED },
  { find: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  { find: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replace: REDACTED },
  { find: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: REDACTED },
  { find: /\bnpm_[A-Za-z0-9]{16,}/g, replace: REDACTED },
  { find: /\bAKIA[0-9A-Z]{16}\b/g, replace: REDACTED },
  { find: /\bASIA[0-9A-Z]{16}\b/g, replace: REDACTED },
  { find: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: REDACTED }
];

/**
 * Removes likely secrets from provider output.
 *
 * Runs before persistence, never after: a value that reaches SQLite is already
 * disclosed, and the renderer hiding it would not undo that.
 */
export function redactSecrets(text: string, secretValues: string[] = []): string {
  let value = text;
  // Literal environment values first: they are the only certainties here.
  for (const secret of secretValues) {
    if (!secret) continue;
    value = value.replace(new RegExp(literal(secret), "g"), REDACTED);
  }
  for (const { find, replace } of PATTERNS) value = value.replace(find, replace);
  return value;
}

/** Keeps the last `MAX_DIAGNOSTIC_TAIL_BYTES` of a stream. */
export function boundedTail(text: string, limit = MAX_DIAGNOSTIC_TAIL_BYTES): { tail: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= limit) return { tail: text, truncated: false };
  // Trim from the front until the tail fits: a CLI states its reason last.
  let start = Math.max(0, text.length - limit);
  while (start < text.length && Buffer.byteLength(text.slice(start), "utf8") > limit) start += 1;
  return { tail: text.slice(start), truncated: true };
}

/**
 * Classifies a provider failure from evidence the CLI actually produced.
 *
 * Only unambiguous phrasings are matched. Anything else stays "process", so the
 * reader is shown the bounded text instead of a confident wrong label.
 */
export function classifyProviderFailure(input: {
  transportFailure?: string | null;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}): DiagnosticCategory {
  switch (input.transportFailure) {
    case "spawn": return "not_installed";
    case "timeout": return "timeout";
    case "interrupted": return "interrupted";
    default: break;
  }

  const text = `${input.stderr ?? ""}\n${input.stdout ?? ""}`;
  if (!text.trim()) return "process";

  // Ordered most specific first. Each pattern is a phrase a CLI actually emits.
  if (/input must be provided|no input (?:was )?(?:provided|received)|unexpected end of (?:json|input)|invalid json|failed to parse/i.test(text)) return "input_protocol";
  if (/usage limit|quota|rate.?limit|hit your limit|credit balance|\b429\b/i.test(text)) return "quota";
  if (/not logged in|login required|please log ?in|unauthorized|authentication failed|invalid.{0,15}(?:oauth|token)|\b401\b/i.test(text)) return "unauthenticated";
  if (/no conversation found|session (?:not found|expired|is invalid)|invalid session|unknown session|thread not found/i.test(text)) return "session_not_found";
  if (/unsupported version|requires version|version .{0,20}not supported/i.test(text)) return "unsupported_version";
  if (/invalid .{0,20}(?:config|settings)|unknown (?:option|flag|argument)|unrecognized (?:option|argument)/i.test(text)) return "invalid_configuration";
  if (/\bENOENT\b|is not recognized as an internal or external command|command not found/i.test(text)) return "not_installed";
  return "process";
}

interface DiagnosticsRow {
  id: string; run_id: string; operation_id: string; provider: string; role: string;
  category: string; exit_code: number | null; signal: string | null;
  stdout_tail: string; stderr_tail: string; stdout_bytes: number; stderr_bytes: number;
  stdout_truncated: number; stderr_truncated: number; created_at: string;
}

function toDiagnostics(row: DiagnosticsRow): WorkerDiagnostics {
  return {
    id: row.id, runId: row.run_id, operationId: row.operation_id, provider: row.provider,
    role: row.role as DiagnosticRole, category: row.category as DiagnosticCategory,
    exitCode: row.exit_code, signal: row.signal,
    stdoutTail: row.stdout_tail, stderrTail: row.stderr_tail,
    stdoutBytes: row.stdout_bytes, stderrBytes: row.stderr_bytes,
    stdoutTruncated: row.stdout_truncated === 1, stderrTruncated: row.stderr_truncated === 1,
    createdAt: row.created_at
  };
}

/**
 * Durable store for failure evidence.
 *
 * One row per failed operation, so the large strings live in exactly one place
 * and the operation/send/session records reference them by operation id.
 */
export class WorkerDiagnosticsStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
  }

  /** False on a database migrated before this feature existed. */
  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_worker_diagnostics'").get()
    );
  }

  list(runId: string): WorkerDiagnostics[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_worker_diagnostics WHERE run_id=:runId ORDER BY rowid")
      .all<DiagnosticsRow>({ runId })
      .map(toDiagnostics);
  }

  forOperation(operationId: string): WorkerDiagnostics | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_worker_diagnostics WHERE operation_id=:operationId")
      .get<DiagnosticsRow>({ operationId });
    return row ? toDiagnostics(row) : null;
  }

  /**
   * Records one failure. Redaction and bounding happen here, so no caller can
   * write raw provider output by mistake.
   */
  record(input: {
    runId: string;
    operationId: string;
    scope: DiagnosticScope;
    category: DiagnosticCategory;
    exitCode?: number | null;
    signal?: string | null;
    stdout?: string;
    stderr?: string;
    secretValues?: string[];
  }): WorkerDiagnostics | null {
    if (!this.available()) return null;
    if (this.forOperation(input.operationId)) return this.forOperation(input.operationId);

    const secrets = input.secretValues ?? [];
    const stdout = input.stdout ?? "";
    const stderr = input.stderr ?? "";
    // Redact the whole stream first, then bound it: bounding first could leave
    // the trailing half of a credential that spanned the cut.
    const outBound = boundedTail(redactSecrets(stdout, secrets));
    const errBound = boundedTail(redactSecrets(stderr, secrets));

    this.db
      .prepare(
        `INSERT INTO autopilot_worker_diagnostics
           (id, run_id, operation_id, provider, role, category, exit_code, signal,
            stdout_tail, stderr_tail, stdout_bytes, stderr_bytes,
            stdout_truncated, stderr_truncated, created_at)
         VALUES
           (:id, :runId, :operationId, :provider, :role, :category, :exitCode, :signal,
            :stdoutTail, :stderrTail, :stdoutBytes, :stderrBytes,
            :stdoutTruncated, :stderrTruncated, :now)`
      )
      .run({
        id: this.ports.ids.next("worker-diagnostic"),
        runId: input.runId,
        operationId: input.operationId,
        provider: input.scope.provider,
        role: input.scope.role,
        category: input.category,
        exitCode: input.exitCode ?? null,
        signal: input.signal ?? null,
        stdoutTail: outBound.tail,
        stderrTail: errBound.tail,
        // The byte counts describe what the process emitted, before bounding.
        stdoutBytes: Buffer.byteLength(stdout, "utf8"),
        stderrBytes: Buffer.byteLength(stderr, "utf8"),
        stdoutTruncated: outBound.truncated ? 1 : 0,
        stderrTruncated: errBound.truncated ? 1 : 0,
        now: this.ports.clock.now()
      });

    return this.forOperation(input.operationId);
  }
}

/** The one-line form used by the activity timeline. Never includes stderr. */
export function diagnosticActivityLabel(provider: string, role: DiagnosticRole, category: DiagnosticCategory): string {
  const who = role === "CONSULTANT" ? "consultant" : role === "PROBE" ? "readiness probe" : "worker";
  const name = provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : provider;
  return `${name} ${who} failed: ${DIAGNOSTIC_CATEGORY_LABELS[category]}`;
}
