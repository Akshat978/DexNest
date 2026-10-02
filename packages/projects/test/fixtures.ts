// Synthetic repository states for planner tests. No git, no disk.

import type { LocalBranch, RemoteBranch, RepoStateOk, StashEntry, WorkingTree, Worktree } from "../src/domain/repoState.ts";

export const NOW = "2026-10-01T12:00:00.000Z";

export function sha(seed: string): string {
  let out = "";
  for (let i = 0; out.length < 40; i += 1) out += ((seed.charCodeAt(i % seed.length) + i) % 16).toString(16);
  return out;
}

export function tree(parts: Partial<Pick<WorkingTree, "staged" | "unstaged" | "untracked" | "conflicted">> = {}): WorkingTree {
  const staged = parts.staged ?? [];
  const unstaged = parts.unstaged ?? [];
  const untracked = parts.untracked ?? [];
  const conflicted = parts.conflicted ?? [];
  return {
    staged,
    unstaged,
    untracked,
    conflicted,
    truncated: false,
    counts: { staged: staged.length, unstaged: unstaged.length, untracked: untracked.length, conflicted: conflicted.length }
  };
}

export function branch(name: string, extra: Partial<LocalBranch> = {}): LocalBranch {
  return {
    name,
    tipSha: sha(name),
    isCurrent: false,
    upstream: { ref: `origin/${name}`, remote: "origin", branch: name, gone: false, counts: { ahead: 0, behind: 0 } },
    lastCommitAt: "2026-09-30T10:00:00.000Z",
    lastSubject: `work on ${name}`,
    vsDefault: name === "main" ? null : { ahead: 0, behind: 0 },
    mergedIntoDefault: name === "main" ? null : true,
    checkedOutElsewhere: null,
    ...extra
  };
}

export function remoteBranch(name: string, extra: Partial<RemoteBranch> = {}): RemoteBranch {
  return {
    remote: "origin",
    name,
    ref: `origin/${name}`,
    tipSha: sha(`origin/${name}`),
    lastCommitAt: "2026-09-29T10:00:00.000Z",
    lastSubject: `remote ${name}`,
    vsDefault: null,
    mergedIntoDefault: true,
    trackedBy: null,
    ...extra
  };
}

export function stash(index: number, extra: Partial<StashEntry> = {}): StashEntry {
  return { index, sha: sha(`stash${index}`), branch: "main", createdAt: NOW, message: `WIP on main: secret stash message ${index}`, files: ["src/a.ts"], ...extra };
}

/** A clean repo on `main`, tracking origin/main, in sync. */
export function repo(overrides: Partial<RepoStateOk> = {}): RepoStateOk {
  const main = branch("main", { isCurrent: true });
  const self: Worktree = { path: "/work/app", headSha: main.tipSha, branch: "main", isMain: true, isCurrent: true, owner: "self", locked: false, prunable: false };
  return {
    isRepo: true,
    head: { branch: "main", sha: main.tipSha, detached: false, unborn: false },
    defaultBranch: "main",
    remotes: [{ name: "origin", url: "https://github.com/me/app.git" }],
    branches: [main],
    remoteBranches: [remoteBranch("main", { tipSha: main.tipSha, trackedBy: "main", mergedIntoDefault: null })],
    workingTree: tree(),
    stashes: [],
    worktrees: [self],
    inProgress: null,
    submodules: [],
    lastCommit: { sha: main.tipSha, subject: "initial", committedAt: "2026-09-30T10:00:00.000Z" },
    lastFetchAt: "2026-10-01T11:56:00.000Z",
    readAt: NOW,
    ...overrides
  };
}

/** The repo with the current branch's upstream counts set. */
export function withCounts(ahead: number, behind: number, base: RepoStateOk = repo()): RepoStateOk {
  return {
    ...base,
    branches: base.branches.map((b) =>
      b.isCurrent && b.upstream ? { ...b, upstream: { ...b.upstream, counts: { ahead, behind } } } : b
    )
  };
}

export const SECRET_MESSAGE = "fix: rotate key sk-live-DO-NOT-LOG";
