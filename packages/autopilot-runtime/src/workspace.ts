// Run workspace (git worktree) lifecycle.
//
// Git commands live here, behind the GitPort, rather than being scattered
// through the engine.
//
// A worktree provides repository isolation and reversibility: the primary
// checkout stays clean, and abandoning a run is a worktree removal. It is NOT a
// filesystem sandbox — see policy.ts and the architecture document.

import { canonicalize, contains, samePath } from "./paths.ts";
import type { GitPort, FileSystemPort } from "./ports.ts";
import { ALWAYS_DENIED_ROOTS } from "./policy.ts";

export interface RunWorkspace {
  runId: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  scratchRoot: string;
}

export class WorkspaceError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.rule = rule;
  }
}

export interface WorkspaceManagerOptions {
  git: GitPort;
  fs: FileSystemPort;
  /** Directory that holds every run worktree. Must be outside the repository. */
  worktreesRoot: string;
  /** Directory that holds run scratch/artifact output. */
  scratchesRoot: string;
  windows?: boolean;
}

/** Deterministic, run-linked naming so a worktree can be rediscovered after a restart. */
export function worktreeNameForRun(runId: string): string {
  return `run-${runId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export class WorkspaceManager {
  private readonly git: GitPort;
  private readonly fs: FileSystemPort;
  private readonly worktreesRoot: string;
  private readonly scratchesRoot: string;
  private readonly windows: boolean;

  constructor(options: WorkspaceManagerOptions) {
    this.git = options.git;
    this.fs = options.fs;
    this.worktreesRoot = options.worktreesRoot;
    this.scratchesRoot = options.scratchesRoot;
    this.windows = options.windows ?? true;
  }

  /** Validates the source repository and returns its canonical root. */
  resolveRepositoryRoot(sourceDir: string): string {
    if (!this.fs.exists(sourceDir)) {
      throw new WorkspaceError("workspace.source-missing", `Source directory does not exist: ${sourceDir}`);
    }
    if (!this.git.isRepository(sourceDir)) {
      throw new WorkspaceError("workspace.not-a-repository", `Not a git repository: ${sourceDir}`);
    }
    return canonicalize(this.git.repositoryRoot(sourceDir), { windows: this.windows }).display;
  }

  /** Where this run's worktree will live. Pure; creates nothing. */
  plan(runId: string, repoRoot: string): RunWorkspace {
    const name = worktreeNameForRun(runId);
    const worktreePath = canonicalize(`${this.worktreesRoot}/${name}`, { windows: this.windows }).display;
    const scratchRoot = canonicalize(`${this.scratchesRoot}/${name}`, { windows: this.windows }).display;

    this.assertUsable(repoRoot, worktreePath);

    return { runId, repoRoot, worktreePath, branch: `autopilot/${name}`, scratchRoot };
  }

  /**
   * Structural checks that must hold regardless of Run Spec. Policy checks the
   * same invariants for the CREATE_WORKTREE intent; this is the second, closer
   * guard so a caller cannot reach the git port with an unsafe location.
   */
  assertUsable(repoRoot: string, worktreePath: string): void {
    const repo = canonicalize(repoRoot, { windows: this.windows });
    const worktree = canonicalize(worktreePath, { windows: this.windows });

    for (const denied of ALWAYS_DENIED_ROOTS) {
      if (contains(canonicalize(denied, { windows: this.windows }), worktree, this.windows)) {
        throw new WorkspaceError("workspace.inside-denied-root", `A run worktree may not live inside ${denied}.`);
      }
    }
    if (samePath(repo, worktree, this.windows)) {
      throw new WorkspaceError(
        "workspace.equals-primary-checkout",
        "The primary checkout may never be used as an autonomous writable workspace."
      );
    }
    if (contains(repo, worktree, this.windows)) {
      throw new WorkspaceError(
        "workspace.inside-primary-checkout",
        "A run worktree must live outside the primary checkout so the primary checkout stays clean."
      );
    }
    if (contains(worktree, repo, this.windows)) {
      throw new WorkspaceError("workspace.contains-primary-checkout", "A run worktree may not contain the primary checkout.");
    }
  }

  /** True when the worktree exists on disk and git still knows about it. */
  validate(workspace: RunWorkspace): { exists: boolean; registered: boolean; head: string | null; dirty: boolean } {
    const exists = this.fs.exists(workspace.worktreePath);
    if (!exists) {
      return { exists: false, registered: false, head: null, dirty: false };
    }
    const registered = this.git
      .listWorktrees(workspace.repoRoot)
      .some((entry) => samePath(entry.path, workspace.worktreePath, this.windows));
    return {
      exists,
      registered,
      head: registered ? this.git.head(workspace.worktreePath) : null,
      dirty: registered ? this.git.isDirty(workspace.worktreePath) : false
    };
  }

  /** Ensures the scratch directory exists. Never touches the repository. */
  ensureScratch(workspace: RunWorkspace): void {
    this.fs.mkdirp(workspace.scratchRoot);
  }

  /**
   * State of the PRIMARY checkout. Used by tests and recovery to assert that an
   * autonomous run never dirtied it.
   */
  primaryCheckoutState(repoRoot: string): { head: string; dirty: boolean } {
    return { head: this.git.head(repoRoot), dirty: this.git.isDirty(repoRoot) };
  }
}
