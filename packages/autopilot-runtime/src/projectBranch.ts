// Working directly in the operator's project, on a dedicated branch.
//
// WHY THIS EXISTS, AND WHAT IT COSTS
//
// The worktree model gives isolation for free: the project is never touched, so
// a bad run is a directory you delete. It also means the operator wakes up to
// nothing visible in their own checkout, which defeats the point of leaving a
// run going overnight. This module is the deliberate trade: work in the project,
// give up the free isolation, and buy reversibility back explicitly.
//
// What replaces the worktree:
//
//   - A dedicated branch. The run never commits to the branch the operator was
//     on, and the base branch and SHA are recorded durably so returning is one
//     command that this module can state exactly.
//   - A clean-tree precondition. Starting on top of uncommitted work would mix
//     the operator's changes into the run's commits, and no later checkpoint
//     could separate them again. Refuse instead of guessing.
//   - Checkpoint commits per verified iteration, which already exist.
//   - Policy denial of .git, added alongside this, so history stays intact.
//
// This module never merges, never pushes, never deletes a branch, and never
// returns the operator to their original branch on its own. Ending a run leaves
// the work sitting on the branch for a human to look at.

import type { EffectsGateway } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";
import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { canonicalize, contains, samePath } from "./paths.ts";
import { ALWAYS_DENIED_ROOTS } from "./policy.ts";
import { AutopilotStore } from "./store.ts";

/** Deterministic and run-linked, so a restart rediscovers the same branch. */
export function branchNameForRun(runId: string): string {
  return `dexnest/${runId.replace(/[^A-Za-z0-9_\-/.]/g, "-")}`;
}

export interface ProjectBranchRecord {
  runId: string;
  repoRoot: string;
  branch: string;
  /** The branch the operator was on. Never modified by the run. */
  baseBranch: string;
  /** The commit the run branched from; the revert target. */
  baseSha: string;
  createdAt: string;
}

export class ProjectBranchError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.name = "ProjectBranchError";
    this.rule = rule;
  }
}

interface BranchRow {
  run_id: string;
  repo_root: string;
  branch: string;
  base_branch: string;
  base_sha: string;
  created_at: string;
}

const toRecord = (row: BranchRow): ProjectBranchRecord => ({
  runId: row.run_id,
  repoRoot: row.repo_root,
  branch: row.branch,
  baseBranch: row.base_branch,
  baseSha: row.base_sha,
  createdAt: row.created_at
});

export interface ProjectBranchOptions {
  ports: RuntimePorts;
  effects: EffectsGateway;
  windows?: boolean;
}

export class ProjectBranchManager {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly effects: EffectsGateway;
  private readonly store: AutopilotStore;
  private readonly windows: boolean;

  constructor(options: ProjectBranchOptions) {
    this.ports = options.ports;
    this.db = options.ports.db;
    this.effects = options.effects;
    this.store = new AutopilotStore(options.ports);
    this.windows = options.windows ?? true;
  }

  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_project_branches'").get()
    );
  }

  /** What the run branched from, once recorded. Survives restart. */
  record(runId: string): ProjectBranchRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_project_branches WHERE run_id=:runId")
      .get<BranchRow>({ runId });
    return row ? toRecord(row) : null;
  }

  /**
   * Structural checks that hold regardless of Run Spec.
   *
   * The worktree guards cannot be reused: they exist to keep the workspace OUT
   * of the project, which is exactly what this mode does instead. What survives
   * is everything that was never about isolation.
   */
  assertUsable(repoRoot: string): void {
    const repo = canonicalize(repoRoot, { windows: this.windows });
    if (!repo.absolute) {
      throw new ProjectBranchError("project.not-absolute", "The project path must be absolute and canonical.");
    }
    for (const denied of ALWAYS_DENIED_ROOTS) {
      const root = canonicalize(denied, { windows: this.windows });
      if (samePath(root, repo, this.windows) || contains(root, repo, this.windows)) {
        throw new ProjectBranchError("project.inside-denied-root", `A run may not work inside ${denied}.`);
      }
      // Working at a location that CONTAINS a denied root would put that root
      // inside the run's write scope by construction.
      if (contains(repo, root, this.windows)) {
        throw new ProjectBranchError("project.contains-denied-root", `A run may not work in a directory that contains ${denied}.`);
      }
    }
  }

  private async git(
    runId: string,
    policy: CapabilityPolicy,
    operation: string,
    args: string[],
    cwd: string,
    purpose: string
  ): Promise<{ ok: boolean; out: string; err: string }> {
    const outcome = await this.effects.request({
      runId,
      stepKey: this.ports.ids.next(`branch-${operation}`),
      policy,
      intent: { kind: "GIT_OPERATION", operation, args, cwd, purpose }
    });
    if (!("result" in outcome)) {
      const reason = "decision" in outcome ? outcome.decision.reason : `not authorized (${outcome.status})`;
      return { ok: false, out: "", err: reason };
    }
    return { ok: outcome.result.ok, out: (outcome.result.stdout ?? "").trim(), err: (outcome.result.stderr ?? "").trim() };
  }

  /**
   * Verifies the project is safe to work in and reports what would happen.
   * Reads only: nothing is created and no branch is changed.
   */
  async preflight(input: { runId: string; repoRoot: string; policy: CapabilityPolicy }): Promise<{
    repoRoot: string;
    branch: string;
    baseBranch: string;
    baseSha: string;
    alreadyOnBranch: boolean;
  }> {
    this.assertUsable(input.repoRoot);
    const { runId, repoRoot, policy } = input;

    const top = await this.git(runId, policy, "rev-parse", ["--show-toplevel"], repoRoot, "project branch: confirm repository root");
    if (!top.ok || !top.out) {
      throw new ProjectBranchError("project.not-a-repository", `Not a git repository: ${repoRoot}`);
    }
    if (!samePath(canonicalize(top.out, { windows: this.windows }), canonicalize(repoRoot, { windows: this.windows }), this.windows)) {
      throw new ProjectBranchError(
        "project.not-repository-root",
        "Select the repository root itself, not a subdirectory of it."
      );
    }

    const head = await this.git(runId, policy, "rev-parse", ["HEAD"], repoRoot, "project branch: read HEAD");
    if (!head.ok || !/^[0-9a-f]{7,40}$/i.test(head.out)) {
      throw new ProjectBranchError("project.no-commits", "The project has no commits to branch from.");
    }

    const current = await this.git(runId, policy, "rev-parse", ["--abbrev-ref", "HEAD"], repoRoot, "project branch: read current branch");
    if (!current.ok || !current.out) {
      throw new ProjectBranchError("project.branch-unreadable", "Could not determine the current branch.");
    }
    if (current.out === "HEAD") {
      throw new ProjectBranchError(
        "project.detached-head",
        "The project is on a detached HEAD. Check out a branch first so the run has something to return you to."
      );
    }

    // A dirty tree cannot be separated from the run's own work afterwards, so
    // no checkpoint could offer a clean revert. This is the one precondition
    // that is worth refusing over.
    const status = await this.git(runId, policy, "status", ["--porcelain"], repoRoot, "project branch: confirm a clean working tree");
    if (!status.ok) {
      throw new ProjectBranchError("project.status-unreadable", `Could not read the working tree: ${status.err || "unknown error"}`);
    }
    if (status.out) {
      const changed = status.out.split("\n").filter((line) => line.trim()).length;
      throw new ProjectBranchError(
        "project.dirty",
        `The project has ${changed} uncommitted change(s). Commit or stash them first: a run that starts on top of your work cannot give you a clean revert afterwards.`
      );
    }

    const branch = branchNameForRun(runId);
    const known = this.record(runId);
    return {
      repoRoot,
      branch,
      baseBranch: known?.baseBranch ?? current.out,
      baseSha: known?.baseSha ?? head.out,
      alreadyOnBranch: current.out === branch
    };
  }

  /**
   * Puts the project on the run's branch, creating it if needed.
   *
   * Idempotent across restarts: an existing branch is checked out rather than
   * recreated, and the recorded base is never overwritten, so the revert target
   * stays the commit the run actually started from.
   */
  async ensureBranch(input: { runId: string; repoRoot: string; policy: CapabilityPolicy }): Promise<ProjectBranchRecord> {
    if (!this.available()) throw new ProjectBranchError("project.migration-missing", "Project-branch runs require migration 16.");

    const { runId, repoRoot, policy } = input;
    const existing = this.record(runId);

    // On resume the branch already holds the run's commits, so a clean tree is
    // required only when first branching away from the operator's work.
    const plan = existing
      ? { branch: existing.branch, baseBranch: existing.baseBranch, baseSha: existing.baseSha, alreadyOnBranch: false }
      : await this.preflight(input);

    const current = await this.git(runId, policy, "rev-parse", ["--abbrev-ref", "HEAD"], repoRoot, "project branch: read current branch");
    if (!current.ok) throw new ProjectBranchError("project.branch-unreadable", "Could not determine the current branch.");

    if (current.out !== plan.branch) {
      const exists = await this.git(
        runId, policy, "rev-parse", ["--verify", "--quiet", `refs/heads/${plan.branch}`], repoRoot,
        "project branch: check whether the run branch already exists"
      );
      const args = exists.ok && exists.out ? [plan.branch] : ["-b", plan.branch];
      const checkout = await this.git(runId, policy, "checkout", args, repoRoot, `project branch: switch to ${plan.branch}`);
      if (!checkout.ok) {
        throw new ProjectBranchError("project.checkout-failed", `Could not switch to ${plan.branch}: ${checkout.err || "unknown error"}`);
      }
      this.store.appendEvent(runId, {
        type: exists.ok && exists.out ? "PROJECT_BRANCH_RESUMED" : "PROJECT_BRANCH_CREATED",
        payload: { branch: plan.branch, baseBranch: plan.baseBranch, baseSha: plan.baseSha, repoRoot }
      });
    }

    if (existing) return existing;

    this.db
      .prepare(
        `INSERT INTO autopilot_project_branches (run_id, repo_root, branch, base_branch, base_sha, created_at)
         VALUES (:runId, :repoRoot, :branch, :baseBranch, :baseSha, :now)
         ON CONFLICT(run_id) DO NOTHING`
      )
      .run({
        runId, repoRoot, branch: plan.branch, baseBranch: plan.baseBranch,
        baseSha: plan.baseSha, now: this.ports.clock.now()
      });

    return this.record(runId)!;
  }
}

/**
 * What the operator needs in the morning: where the work is and how to undo it.
 * Commands are shown, never run — returning the project to its original branch
 * is a human decision.
 */
export function renderProjectBranchSummary(record: ProjectBranchRecord | null): string {
  if (!record) return "This run does not work in the project directly.";
  return [
    `Project:  ${record.repoRoot}`,
    `Branch:   ${record.branch}`,
    `Based on: ${record.baseBranch} at ${record.baseSha.slice(0, 12)}`,
    "",
    "To go back to your own branch, leaving the run's work on its branch:",
    `  git checkout ${record.baseBranch}`,
    "",
    "To discard the run's work entirely, once you are on another branch:",
    `  git branch -D ${record.branch}`
  ].join("\n");
}
