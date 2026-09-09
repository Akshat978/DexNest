/**
 * What a project's working tree looks like right now.
 *
 * Parsing is kept apart from running git so the interesting half can be tested
 * against real porcelain output without a repository, a network, or a clock.
 * Everything here is pure; the process spawning lives in main.
 *
 * porcelain=v2 rather than v1: v1's short format overloads a two-character
 * column and leaves ahead/behind to a second command, while v2 states branch,
 * upstream and divergence in named header lines that are documented as stable.
 */

/** A project that is not a git repository, or one git could not read. */
export interface GitAbsent {
  repo: false;
  /** Why, when it is worth saying. Absent for "simply not a repo". */
  problem?: string;
}

export interface GitPresent {
  repo: true;
  branch: string | null;
  /** The tracking branch, or null when the branch has never been pushed. */
  upstream: string | null;
  /** Commits this branch has that its upstream does not. Null without one. */
  ahead: number | null;
  behind: number | null;
  /** Tracked files with staged or unstaged modifications. */
  changed: number;
  untracked: number;
  /** Files in a conflicted state. Any at all means a merge is in progress. */
  conflicted: number;
  /** True when a commit here would include nothing. */
  clean: boolean;
}

export type GitSnapshot = GitAbsent | GitPresent;

/**
 * Reads `git status --porcelain=v2 --branch`.
 *
 * Unknown line types are ignored rather than rejected. The format is additive
 * by design, and a future git that adds a header would otherwise turn every
 * project's status into an error over a line that changes nothing.
 */
export function parseStatus(stdout: string): GitPresent {
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let changed = 0;
  let untracked = 0;
  let conflicted = 0;

  for (const line of stdout.split("\n")) {
    const text = line.replace(/\r$/, "");
    if (!text) continue;

    if (text.startsWith("# branch.head ")) {
      const value = text.slice("# branch.head ".length).trim();
      // git says "(detached)" rather than a name when no branch is checked out.
      branch = value === "(detached)" ? null : value;
      continue;
    }
    if (text.startsWith("# branch.upstream ")) {
      upstream = text.slice("# branch.upstream ".length).trim() || null;
      continue;
    }
    if (text.startsWith("# branch.ab ")) {
      // "+2 -1", always both, always signed.
      const match = /^\+(\d+)\s+-(\d+)$/.exec(text.slice("# branch.ab ".length).trim());
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }

    // Entry lines: "1" ordinary, "2" renamed or copied, "u" unmerged,
    // "?" untracked, "!" ignored. A leading "#" that reached here is a header
    // this version does not know about.
    const kind = text[0];
    if (kind === "1" || kind === "2") changed += 1;
    else if (kind === "u") conflicted += 1;
    else if (kind === "?") untracked += 1;
  }

  return {
    repo: true,
    branch,
    upstream,
    // Without an upstream there is no divergence to report. Zero would claim
    // the branch is level with something it is not tracking.
    ahead: upstream ? ahead ?? 0 : null,
    behind: upstream ? behind ?? 0 : null,
    changed,
    untracked,
    conflicted,
    // Untracked files count. "Clean" has to mean "committing now would capture
    // everything", and a brand-new unstaged file is exactly what gets lost
    // when it does not.
    clean: changed === 0 && untracked === 0 && conflicted === 0
  };
}

/** The one-line commit description, from `git log -1` with NUL separators. */
export interface GitCommit {
  sha: string;
  subject: string;
  authoredAt: string;
}

/**
 * NUL-separated because a commit subject may contain anything a person can
 * type, tabs and pipes included, and splitting on those would truncate the
 * message at whatever punctuation the author happened to use.
 */
export function parseCommit(stdout: string): GitCommit | null {
  const parts = stdout.replace(/\n$/, "").split("\0");
  if (parts.length < 3 || !parts[0]) return null;
  return { sha: parts[0], subject: parts[1], authoredAt: parts[2] };
}

/** Whether a push should be attempted, and what to say either way. */
export interface PushVerdict {
  push: boolean;
  reason: string;
}

/**
 * Whether DexNest should push this repository.
 *
 * The rule the whole feature rests on: this pushes commits that already exist
 * and does nothing else. It does not stage, does not commit, does not set an
 * upstream, and never force-pushes. A button that commits for you is a button
 * that puts unreviewed work on a remote under your name, and the first you
 * would know of it is reading it back later.
 *
 * Every refusal below is a state where pushing would either fail at git or
 * succeed at something the operator did not ask for.
 */
export function canPush(snapshot: GitSnapshot): PushVerdict {
  if (!snapshot.repo) return { push: false, reason: snapshot.problem ?? "Not a git repository." };

  if (snapshot.branch === null) {
    // A detached HEAD has no branch for a plain push to resolve, and guessing
    // one would be choosing a destination on the operator's behalf.
    return { push: false, reason: "HEAD is detached, so there is no branch to push." };
  }
  if (snapshot.conflicted > 0) {
    // A merge in progress is not ordinary uncommitted work. Pushing mid-merge
    // publishes half of a resolution.
    return { push: false, reason: `${snapshot.conflicted} file${snapshot.conflicted === 1 ? " is" : "s are"} still conflicted. Finish the merge first.` };
  }
  if (!snapshot.upstream) {
    // Setting an upstream picks a remote and a remote branch name. That is a
    // decision, not a step, so it is left to the operator.
    return { push: false, reason: `${snapshot.branch} has no upstream. Push it once yourself with -u to choose where it goes.` };
  }
  if ((snapshot.behind ?? 0) > 0 && (snapshot.ahead ?? 0) > 0) {
    // Diverged. git would reject this, and the only thing that would make it
    // succeed is a force-push, which is exactly what this must never do.
    return { push: false, reason: `${snapshot.branch} has diverged from ${snapshot.upstream}: ${snapshot.ahead} ahead, ${snapshot.behind} behind. Pull first.` };
  }
  if ((snapshot.ahead ?? 0) === 0) {
    return { push: false, reason: `${snapshot.branch} is already level with ${snapshot.upstream}.` };
  }

  const commits = `${snapshot.ahead} commit${snapshot.ahead === 1 ? "" : "s"}`;
  const uncommitted = snapshot.changed + snapshot.untracked;
  return {
    push: true,
    // The uncommitted count is named on the way out rather than treated as a
    // problem. It does not block pushing what is already committed, but
    // "pushed" should never be read as "everything here is now on the remote".
    reason: uncommitted > 0
      ? `${commits} to ${snapshot.upstream}. ${uncommitted} uncommitted file${uncommitted === 1 ? "" : "s"} stay behind.`
      : `${commits} to ${snapshot.upstream}.`
  };
}

/** How the status reads in one line, for a card that has room for one. */
export function describe(snapshot: GitSnapshot): string {
  if (!snapshot.repo) return snapshot.problem ?? "not a git repository";

  const parts: string[] = [snapshot.branch ?? "detached"];
  if (snapshot.conflicted > 0) parts.push(`${snapshot.conflicted} conflicted`);
  if (!snapshot.upstream) parts.push("no upstream");
  else {
    if (snapshot.ahead) parts.push(`${snapshot.ahead} ahead`);
    if (snapshot.behind) parts.push(`${snapshot.behind} behind`);
  }
  const dirty = snapshot.changed + snapshot.untracked;
  if (dirty > 0) parts.push(`${dirty} uncommitted`);
  // Only when there is genuinely nothing else to say. Appending "clean" to a
  // line that already lists two problems would be describing a different repo.
  if (parts.length === 1 && snapshot.clean) parts.push("clean");
  return parts.join(" · ");
}
