// Structured effect intents.
//
// Every effect Autopilot performs is described as one of these before it
// happens. An intent can be identified, policy-evaluated, approved, journaled,
// dispatched and reconciled — a raw shell string can do none of those things.
//
// This is deliberately NOT the future general-PC Action Router. It carries only
// the effect types Phase 2 needs.

import { canonicalize } from "./paths.ts";

export type IntentKind =
  | "RUN_COMMAND"
  | "READ_FILE"
  | "WRITE_FILE"
  | "GIT_OPERATION"
  | "CREATE_WORKTREE"
  | "REMOVE_WORKTREE"
  | "TERMINATE_PROCESS";

export interface RunCommandIntent {
  kind: "RUN_COMMAND";
  /** Executable name or absolute path. Never a shell line. */
  executable: string;
  /** Already-split arguments. No shell parsing, so no quoting or injection. */
  args: string[];
  cwd: string;
  purpose: string;
  timeoutMs?: number;
  /** Private input. Fingerprinted for approval, but omitted from operation/audit records. */
  stdin?: string;
  /** Fixed, host-owned interactive protocol; never a renderer-supplied script. */
  transport?: "codex-app-server";
}

export interface ReadFileIntent {
  kind: "READ_FILE";
  path: string;
  purpose: string;
}

export interface WriteFileIntent {
  kind: "WRITE_FILE";
  path: string;
  /** Size only; content is never fingerprinted or journaled (audit policy). */
  contents: string;
  purpose: string;
}

export interface GitOperationIntent {
  kind: "GIT_OPERATION";
  operation: string;
  args: string[];
  cwd: string;
  purpose: string;
}

export interface CreateWorktreeIntent {
  kind: "CREATE_WORKTREE";
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  purpose: string;
}

export interface RemoveWorktreeIntent {
  kind: "REMOVE_WORKTREE";
  repoRoot: string;
  worktreePath: string;
  force: boolean;
  purpose: string;
}

export interface TerminateProcessIntent {
  kind: "TERMINATE_PROCESS";
  pid: number;
  purpose: string;
}

export type Intent =
  | RunCommandIntent
  | ReadFileIntent
  | WriteFileIntent
  | GitOperationIntent
  | CreateWorktreeIntent
  | RemoveWorktreeIntent
  | TerminateProcessIntent;

/**
 * An intent bound to a run and a durable identity.
 *
 * `operationId` is the journal key; `fingerprint` is what an approval attaches
 * to. Both are established before any side effect.
 */
export interface OperationIntent {
  operationId: string;
  runId: string;
  stepKey: string | null;
  intent: Intent;
  fingerprint: string;
  createdAt: string;
}

/**
 * Canonical form used for fingerprinting and policy.
 *
 * Paths are canonicalized so that "C:/x" and "c:\x\." fingerprint identically —
 * an approval must not be evadable by respelling a path. File contents are
 * reduced to a length: approving a write approves the target, and the payload is
 * not audit material (AGENTS.md records what happened, not private content).
 */
export function normalizeIntent(intent: Intent, windows = true): Record<string, unknown> {
  switch (intent.kind) {
    case "RUN_COMMAND":
      return {
        kind: intent.kind,
        executable: canonicalizeExecutable(intent.executable, windows),
        args: [...intent.args],
        ...(intent.stdin === undefined ? {} : { stdin: intent.stdin }),
        ...(intent.transport ? { transport: intent.transport } : {}),
        cwd: canonicalize(intent.cwd, { windows }).key
      };
    case "READ_FILE":
      return { kind: intent.kind, path: canonicalize(intent.path, { windows }).key };
    case "WRITE_FILE":
      return {
        kind: intent.kind,
        path: canonicalize(intent.path, { windows }).key,
        contentLength: intent.contents.length
      };
    case "GIT_OPERATION":
      return {
        kind: intent.kind,
        operation: intent.operation.toLowerCase(),
        args: [...intent.args],
        cwd: canonicalize(intent.cwd, { windows }).key
      };
    case "CREATE_WORKTREE":
      return {
        kind: intent.kind,
        repoRoot: canonicalize(intent.repoRoot, { windows }).key,
        worktreePath: canonicalize(intent.worktreePath, { windows }).key,
        branch: intent.branch,
        baseRef: intent.baseRef
      };
    case "REMOVE_WORKTREE":
      return {
        kind: intent.kind,
        repoRoot: canonicalize(intent.repoRoot, { windows }).key,
        worktreePath: canonicalize(intent.worktreePath, { windows }).key,
        force: intent.force
      };
    case "TERMINATE_PROCESS":
      return { kind: intent.kind, pid: intent.pid };
    default: {
      const exhaustive: never = intent;
      throw new Error(`Unknown intent ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** An executable is compared by canonical path when absolute, by lower-cased name otherwise. */
export function canonicalizeExecutable(executable: string, windows = true): string {
  const raw = String(executable ?? "").trim();
  if (!raw) return "";
  const looksAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(raw);
  if (looksAbsolute) {
    return canonicalize(raw, { windows }).key;
  }
  return windows ? raw.toLowerCase() : raw;
}

/** Bare executable name without directory or .exe/.cmd/.bat/.ps1 suffix. */
export function executableName(executable: string, windows = true): string {
  const canonical = canonicalizeExecutable(executable, windows);
  const lastSlash = canonical.lastIndexOf("/");
  const base = lastSlash >= 0 ? canonical.slice(lastSlash + 1) : canonical;
  return base.replace(/\.(exe|cmd|bat|com|ps1)$/i, "");
}

/**
 * Stable fingerprint of the normalized intent.
 *
 * FNV-1a over canonical JSON. This is a TOCTOU guard against our own code
 * mutating an intent between approval and dispatch, not a defence against an
 * attacker who already controls the process — the runtime has no crypto port.
 */
export function fingerprintIntent(intent: Intent, windows = true): string {
  const canonical = JSON.stringify(sortValue(normalizeIntent(intent, windows)));
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `intent-${hash.toString(16).padStart(8, "0")}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}

/** Short human-readable line for approval prompts and the journal. */
export function describeIntent(intent: Intent): string {
  switch (intent.kind) {
    case "RUN_COMMAND":
      return `Run ${intent.executable} ${intent.args.join(" ")}`.trim();
    case "READ_FILE":
      return `Read ${intent.path}`;
    case "WRITE_FILE":
      return `Write ${intent.contents.length} bytes to ${intent.path}`;
    case "GIT_OPERATION":
      return `git ${intent.operation} ${intent.args.join(" ")}`.trim();
    case "CREATE_WORKTREE":
      return `Create worktree ${intent.worktreePath} from ${intent.baseRef}`;
    case "REMOVE_WORKTREE":
      return `Remove worktree ${intent.worktreePath}${intent.force ? " (force)" : ""}`;
    case "TERMINATE_PROCESS":
      return `Terminate process ${intent.pid}`;
    default:
      return "Unknown operation";
  }
}
