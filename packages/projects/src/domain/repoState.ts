// What the read engine (Phase 3) reports about one repository. Planners,
// badges and the view all work from this one shape; nothing here runs git.

import type { PathSize } from "./risk.ts";

export type InProgressOperation = "merge" | "rebase" | "cherry_pick" | "revert" | "bisect";

export interface Counts {
  ahead: number;
  behind: number;
}

export interface UpstreamInfo {
  /** e.g. `origin/main` */
  ref: string;
  remote: string;
  /** Branch name on the remote, e.g. `main`. */
  branch: string;
  /** The remote branch no longer exists (after a fetch with prune). */
  gone: boolean;
  /** null when gone. */
  counts: Counts | null;
}

export type WorktreeOwner = "self" | "autopilot" | "other";

export interface WorktreeRef {
  path: string;
  owner: WorktreeOwner;
}

export interface LocalBranch {
  name: string;
  tipSha: string;
  isCurrent: boolean;
  upstream: UpstreamInfo | null;
  lastCommitAt: string | null;
  lastSubject: string | null;
  /** vs the default branch, measured against `RepoStateOk.defaultBase`; null when this is the default branch or it is unknown. */
  vsDefault: Counts | null;
  /** null when unknown (no default branch). */
  mergedIntoDefault: boolean | null;
  /**
   * vs the branch the owner marked as deployed (`RepoStateOk.deployed`): how
   * far this branch is from what is live. null when no branch is marked, when
   * this is that branch and it matches what was pushed, or when not compared.
   */
  vsDeployed?: Counts | null;
  /** Checked out in a worktree other than the one DexNest operates in. */
  checkedOutElsewhere: WorktreeRef | null;
}

export interface RemoteBranch {
  remote: string;
  name: string;
  /** e.g. `origin/feature/x` */
  ref: string;
  tipSha: string;
  lastCommitAt: string | null;
  lastSubject: string | null;
  vsDefault: Counts | null;
  mergedIntoDefault: boolean | null;
  /** Local branch whose upstream this is, if any. */
  trackedBy: string | null;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";

export interface FileChange {
  path: string;
  status: FileStatus;
  /** For renames. */
  from?: string;
}

export interface WorkingTree {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
  conflicted: string[];
  /** True when any list above was capped. Counts are still exact. */
  truncated: boolean;
  counts: { staged: number; unstaged: number; untracked: number; conflicted: number };
  /**
   * How much each new file or folder holds, when the reader was asked to
   * measure. A folder's count stops at a cap, so a dataset costs a bounded walk.
   */
  sizes?: Record<string, PathSize>;
  /** Paths git ignores, folders collapsed, when the reader was asked for them. Capped; `ignoredTruncated` says so. */
  ignored?: string[];
  ignoredTruncated?: boolean;
}

export interface StashEntry {
  index: number;
  sha: string;
  branch: string | null;
  createdAt: string | null;
  /** Shown in the view only; never logged. */
  message: string;
  /** Files the stash touches, when known; used to predict a conflicting pop. */
  files: string[] | null;
}

export interface Worktree {
  path: string;
  headSha: string | null;
  branch: string | null;
  isMain: boolean;
  /** The worktree DexNest operates in (the project's own path). */
  isCurrent: boolean;
  owner: WorktreeOwner;
  locked: boolean;
  prunable: boolean;
}

export interface HeadState {
  /** null when detached or unborn without a name. */
  branch: string | null;
  sha: string | null;
  detached: boolean;
  /** A new repository with no commits yet. */
  unborn: boolean;
}

export interface RemoteInfo {
  name: string;
  /** Credential-free. */
  url: string;
}

export interface RepoStateOk {
  isRepo: true;
  head: HeadState;
  defaultBranch: string | null;
  /**
   * What "vs the default branch" was measured against: `main`, or
   * `origin/main` when the local default branch is only behind it. A local
   * `main` that has not been pulled for months would make every branch look
   * further ahead than it is; the remote's copy is the newer truth then.
   */
  defaultBase: string | null;
  /**
   * The branch the owner marked as the one that is deployed, and the ref it
   * was compared at (`origin/develop`, or `develop` when there is no remote
   * copy; null when the branch no longer exists). null when none is marked.
   * DexNest only knows the name: whether a commit has reached the server is
   * not something it can see.
   */
  deployed?: { branch: string; base: string | null } | null;
  /**
   * How two local branches stand to each other, read only when an operation
   * asks for it: `ahead` is what `from` has that `branch` does not, `behind`
   * what `branch` has that `from` does not. Absent on an ordinary read.
   */
  between?: { branch: string; from: string; ahead: number; behind: number } | null;
  /**
   * Files git is tracking whose names look like secrets (`.env`, a key
   * file). Read only when asked for. Adding such a file to .gitignore does
   * not stop git tracking it, which is why they are worth pointing out.
   * `more` is how many were left off the list.
   */
  trackedSecrets?: { paths: string[]; more: number };
  remotes: RemoteInfo[];
  branches: LocalBranch[];
  remoteBranches: RemoteBranch[];
  workingTree: WorkingTree;
  stashes: StashEntry[];
  worktrees: Worktree[];
  inProgress: InProgressOperation | null;
  submodules: string[];
  lastCommit: { sha: string; subject: string; committedAt: string } | null;
  lastFetchAt: string | null;
  readAt: string;
}

export interface RepoStateAbsent {
  isRepo: false;
  /** Plain words: "Folder not found.", "Not a git repository." */
  reason: string;
  readAt: string;
}

export type RepoState = RepoStateOk | RepoStateAbsent;

/** Autopilot creates worktrees under `<parent>/dexnest-worktrees/<run>` on `autopilot/*` (or `dexnest/*`) branches. */
export function classifyWorktree(path: string, branch: string | null, isCurrent: boolean): WorktreeOwner {
  if (isCurrent) return "self";
  const segments = path.split(/[\\/]+/).map((segment) => segment.toLowerCase());
  if (segments.includes("dexnest-worktrees")) return "autopilot";
  if (branch && (branch.startsWith("autopilot/") || branch.startsWith("dexnest/"))) return "autopilot";
  return "other";
}

export function isDirty(tree: WorkingTree): boolean {
  const c = tree.counts;
  return c.staged + c.unstaged + c.untracked + c.conflicted > 0;
}

export function changedPaths(tree: WorkingTree): Set<string> {
  return new Set([...tree.staged.map((f) => f.path), ...tree.unstaged.map((f) => f.path), ...tree.untracked, ...tree.conflicted]);
}

export function currentBranch(state: RepoStateOk): LocalBranch | null {
  if (state.head.detached || !state.head.branch) return null;
  return state.branches.find((b) => b.name === state.head.branch) ?? null;
}

export function isStale(lastCommitAt: string | null, now: string, staleDays: number): boolean {
  if (!lastCommitAt) return false;
  const age = Date.parse(now) - Date.parse(lastCommitAt);
  return Number.isFinite(age) && age > staleDays * 86_400_000;
}
