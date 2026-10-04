// Operation requests (what the owner asked for), plans (what will happen, in
// plain words, and the structured steps git-ops will run) and refusals.
//
// Steps are data, not command lines. This package never builds a mutating
// git argv - git-ops turns each step into one, after checking it again
// against its own allowlist and NEVER list (Phase 4).

import { neverRuleForFlag, neverRuleForKind, type ConfirmationNeed, type SafetyClass } from "./safety.ts";

export const OPERATION_KINDS = [
  "fetch",
  "pull",
  "fast_forward",
  "push",
  "commit",
  "stash",
  "stash_pop",
  "switch",
  "create_branch",
  "delete_branch",
  "delete_remote_branch",
  "discard",
  "undo"
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export type OperationRequest =
  | { kind: "fetch"; remote?: string }
  | { kind: "pull" }
  /**
   * Move a branch that is not checked out forward, without switching to it:
   * to its upstream (`from` omitted), or the default branch up to another
   * local branch (`from` named). Forward only; nothing is merged or rewritten.
   */
  | { kind: "fast_forward"; branch: string; from?: string }
  | { kind: "push"; branch?: string; remote?: string; setUpstream?: boolean }
  | { kind: "commit"; message: string; files: "all" | string[] }
  | { kind: "stash"; includeUntracked?: boolean }
  | { kind: "stash_pop"; index: number; sha: string }
  | { kind: "switch"; branch: string; remote?: string; dirty?: "stash" }
  | { kind: "create_branch"; name: string; startPoint?: string; switchTo?: boolean }
  | { kind: "delete_branch"; name: string }
  | { kind: "delete_remote_branch"; remote: string; name: string }
  | { kind: "discard"; files: string[] }
  | { kind: "undo"; opId: string };

export type GitStep =
  | { op: "fetch"; remote: string | null; prune: true }
  | { op: "pull_ff"; remote: string; branch: string }
  /**
   * `source` is a full ref (refs/remotes/<remote>/<branch> or refs/heads/<branch>).
   * Both tips are the ones the plan saw; git-ops refuses to run if either moved.
   */
  | { op: "ff_branch"; branch: string; source: string; expectSha: string; toSha: string }
  | { op: "push"; remote: string; branch: string; setUpstream: boolean }
  | { op: "push_sha"; remote: string; sha: string; branch: string }
  | { op: "push_delete"; remote: string; branch: string }
  | { op: "stage"; paths: string[] | "all" }
  | { op: "commit"; message: string; only: string[] | null }
  | { op: "stash_push"; label: "stash" | "switch" | "discard"; paths: string[] | null; includeUntracked: boolean }
  | { op: "stash_apply"; sha: string }
  | { op: "stash_drop_if_clean"; sha: string }
  | { op: "switch"; branch: string; track?: string }
  | { op: "branch_create"; name: string; startPoint: string }
  | { op: "branch_delete"; name: string; expectSha: string }
  | { op: "reset_soft"; to: string; expectHead: string };

/** How an operation can be taken back. Filled in by git-ops with what actually happened. */
export type UndoRecord =
  | { kind: "uncommit"; branch: string; commitSha: string; parentSha: string }
  | { kind: "recreate_branch"; name: string; sha: string }
  | { kind: "apply_stash"; sha: string }
  | { kind: "pop_stash"; sha: string }
  | { kind: "switch_back"; branch: string }
  | { kind: "delete_created_branch"; name: string; sha: string }
  | { kind: "restore_remote_branch"; remote: string; name: string; sha: string };

export type UndoKind = UndoRecord["kind"];

export interface PlanCounts {
  commits?: number;
  files?: number;
  branches?: number;
  stashes?: number;
}

export interface OperationPlan {
  refused: false;
  kind: OperationKind;
  safety: SafetyClass;
  title: string;
  /** One sentence in plain words: "Push 3 commits from main to origin/main." */
  summary: string;
  details: string[];
  network: boolean;
  confirm: ConfirmationNeed;
  steps: GitStep[];
  /** What kind of undo will be recorded, if any. */
  undo: UndoKind | null;
  /** The branch the operation is about (for events and the busy check). */
  branch: string | null;
  counts: PlanCounts;
  /** HEAD as the plan saw it; git-ops refuses to run if it moved. */
  expectHead: string | null;
}

export type RefusalCode =
  | "never_allowed"
  | "invalid_request"
  | "not_a_repo"
  | "no_remote"
  | "detached_head"
  | "unborn"
  | "in_progress"
  | "conflicts"
  | "no_upstream"
  | "upstream_gone"
  | "diverged"
  | "behind"
  | "nothing_to_do"
  | "dirty"
  | "needs_choice"
  | "not_found"
  | "exists"
  | "invalid_name"
  | "current_branch"
  | "default_branch"
  | "other_worktree"
  | "stale_state"
  | "cannot_undo";

export type Offer = "open_terminal" | "push_set_upstream" | "stash_and_switch" | "pull" | "fetch" | "refresh";

export interface Refusal {
  refused: true;
  kind: string;
  code: RefusalCode;
  reason: string;
  offers: Offer[];
}

export type PlanResult = OperationPlan | Refusal;

export function refuse(kind: string, code: RefusalCode, reason: string, offers: Offer[] = []): Refusal {
  return { refused: true, kind, code, reason, offers };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ALLOWED_FIELDS: Record<OperationKind, readonly string[]> = {
  fetch: ["remote"],
  pull: [],
  fast_forward: ["branch", "from"],
  push: ["branch", "remote", "setUpstream"],
  commit: ["message", "files"],
  stash: ["includeUntracked"],
  stash_pop: ["index", "sha"],
  switch: ["branch", "remote", "dirty"],
  create_branch: ["name", "startPoint", "switchTo"],
  delete_branch: ["name"],
  delete_remote_branch: ["remote", "name"],
  discard: ["files"],
  undo: ["opId"]
};

export type ParseResult = { ok: true; request: OperationRequest } | { ok: false; refusal: Refusal };

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Turn whatever arrived over IPC or from an action's params into a request -
 * or a refusal. A request naming a NEVER operation, or carrying a flag that
 * would turn an allowed one into it (`force`, `hard`, `rebase`...), is refused
 * outright; unknown fields are refused rather than ignored.
 */
export function parseOperationRequest(input: unknown): ParseResult {
  if (!isRecord(input) || typeof input.kind !== "string") {
    return { ok: false, refusal: refuse("unknown", "invalid_request", "That is not an operation DexNest knows.") };
  }
  const kind = input.kind;
  const never = neverRuleForKind(kind);
  if (never) return { ok: false, refusal: refuse(kind, "never_allowed", never.reason, ["open_terminal"]) };
  for (const key of Object.keys(input)) {
    const flagged = neverRuleForFlag(key);
    if (flagged && input[key] !== undefined && input[key] !== false) {
      return { ok: false, refusal: refuse(kind, "never_allowed", flagged.reason, ["open_terminal"]) };
    }
  }
  if (!(OPERATION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, refusal: refuse(kind, "invalid_request", `DexNest doesn't do '${kind}'.`) };
  }
  const opKind = kind as OperationKind;
  const extra = Object.keys(input).filter((key) => key !== "kind" && !ALLOWED_FIELDS[opKind].includes(key));
  if (extra.length > 0) return { ok: false, refusal: refuse(kind, "invalid_request", `Unexpected field: ${extra.join(", ")}.`) };

  const bad = (why: string): ParseResult => ({ ok: false, refusal: refuse(kind, "invalid_request", why) });
  switch (opKind) {
    case "fetch":
      return optionalString(input.remote) ? { ok: true, request: { kind: "fetch", remote: input.remote } } : bad("remote must be text.");
    case "pull":
      return { ok: true, request: { kind: "pull" } };
    case "fast_forward":
      if (typeof input.branch !== "string" || !optionalString(input.from)) return bad("Which branch?");
      return { ok: true, request: { kind: "fast_forward", branch: input.branch, from: input.from } };
    case "push":
      if (!optionalString(input.branch) || !optionalString(input.remote)) return bad("branch and remote must be text.");
      if (input.setUpstream !== undefined && typeof input.setUpstream !== "boolean") return bad("setUpstream must be true or false.");
      return { ok: true, request: { kind: "push", branch: input.branch, remote: input.remote, setUpstream: input.setUpstream } };
    case "commit":
      if (typeof input.message !== "string") return bad("A commit needs a message.");
      if (input.files !== "all" && !stringList(input.files)) return bad("files must be 'all' or a list of paths.");
      return { ok: true, request: { kind: "commit", message: input.message, files: input.files } };
    case "stash":
      if (input.includeUntracked !== undefined && typeof input.includeUntracked !== "boolean") return bad("includeUntracked must be true or false.");
      return { ok: true, request: { kind: "stash", includeUntracked: input.includeUntracked } };
    case "stash_pop":
      if (typeof input.index !== "number" || !Number.isInteger(input.index) || input.index < 0 || typeof input.sha !== "string") return bad("Which stash?");
      return { ok: true, request: { kind: "stash_pop", index: input.index, sha: input.sha } };
    case "switch":
      if (typeof input.branch !== "string" || !optionalString(input.remote)) return bad("Which branch?");
      if (input.dirty !== undefined && input.dirty !== "stash") return bad("dirty may only be 'stash'.");
      return { ok: true, request: { kind: "switch", branch: input.branch, remote: input.remote, dirty: input.dirty } };
    case "create_branch":
      if (typeof input.name !== "string" || !optionalString(input.startPoint)) return bad("A new branch needs a name.");
      if (input.switchTo !== undefined && typeof input.switchTo !== "boolean") return bad("switchTo must be true or false.");
      return { ok: true, request: { kind: "create_branch", name: input.name, startPoint: input.startPoint, switchTo: input.switchTo } };
    case "delete_branch":
      return typeof input.name === "string" ? { ok: true, request: { kind: "delete_branch", name: input.name } } : bad("Which branch?");
    case "delete_remote_branch":
      return typeof input.name === "string" && typeof input.remote === "string"
        ? { ok: true, request: { kind: "delete_remote_branch", remote: input.remote, name: input.name } }
        : bad("Which remote branch?");
    case "discard":
      return stringList(input.files) ? { ok: true, request: { kind: "discard", files: input.files } } : bad("Which files?");
    case "undo":
      return typeof input.opId === "string" && input.opId ? { ok: true, request: { kind: "undo", opId: input.opId } } : bad("Undo what?");
  }
}
