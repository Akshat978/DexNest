// The read engine: everything Projects shows about a repository, from git's
// own answers, without changing anything. Every command goes through the
// read-only allowlist (createReadOnlyGit), runs with prompts and optional
// locks off, and is bounded by a timeout and an output cap.
//
// Remote state is only as fresh as the last fetch; this engine never fetches.

import type { PathSize } from "../domain/risk.ts";
import { isFullSha } from "../domain/names.ts";
import type { UndoFacts } from "../domain/planners.ts";
import {
  classifyWorktree,
  type Counts,
  type LocalBranch,
  type RemoteBranch,
  type RepoState,
  type RepoStateOk,
  type StashEntry,
  type Worktree
} from "../domain/repoState.ts";
import {
  IN_PROGRESS_MARKERS,
  LOG_FORMAT,
  parseLog,
  parseNumstat,
  parseRefs,
  parseRemotes,
  parseStashList,
  parseStatusV2,
  parseWorktrees,
  REF_FORMAT,
  STASH_FORMAT,
  type NumstatRow,
  type RefRow
} from "./parse.ts";
import { createReadOnlyGit, type GitRunner, type GitRunResult } from "./runner.ts";

/** The little file-system access the engine needs: is a marker file there, and when was FETCH_HEAD written. */
export interface RepoFsPort {
  exists(path: string): boolean;
  /** null when the file does not exist. */
  mtimeMs(path: string): number | null;
  /**
   * How much a file or folder holds, counting no further than `maxFiles`
   * files. Links are not followed. Absent on a host that cannot measure; null
   * when the path is gone.
   */
  measure?(path: string, maxFiles: number): PathSize | null;
}

export type GitReadErrorCode = "git_missing" | "timeout" | "cancelled" | "failed";

export class GitReadError extends Error {
  readonly code: GitReadErrorCode;
  constructor(code: GitReadErrorCode, message: string) {
    super(message);
    this.name = "GitReadError";
    this.code = code;
  }
}

export interface GitReaderOptions {
  runner: GitRunner;
  fs: RepoFsPort;
  now?: () => string;
  /** Windows compares paths case-insensitively. */
  caseInsensitivePaths?: boolean;
  /** How many branches (most recent first) get "vs default" comparisons. */
  branchLimit?: number;
  /** Parallel git processes per repository read. */
  concurrency?: number;
  timeoutMs?: number;
}

export interface ReadOptions {
  signal?: AbortSignal;
  /** Compare every branch with the default branch, not just the most recent ones. */
  allBranches?: boolean;
  /** The branch the owner marked as deployed; local branches are compared with it too. */
  deployedBranch?: string | null;
  /** Measure new (untracked) files and folders, so a plan can say when one is very large. */
  measureUntracked?: boolean;
  /** Also list what git ignores. */
  includeIgnored?: boolean;
}

/** New paths measured per read, and files counted per path, at most. */
const MEASURE_PATHS = 60;
const MEASURE_FILES = 2000;
const IGNORED_LIMIT = 200;

export interface HistoryEntry {
  sha: string;
  parents: string[];
  subject: string;
  author: string;
  committedAt: string;
  /** Contained in some remote-tracking ref (as of the last fetch). */
  onRemote: boolean;
}

export interface DiffStat {
  staged: NumstatRow[];
  unstaged: NumstatRow[];
}

export interface GitReader {
  readRepoState(path: string, options?: ReadOptions): Promise<RepoState>;
  undoFacts(path: string, sha: string, options?: ReadOptions): Promise<UndoFacts>;
  history(path: string, options?: ReadOptions & { limit?: number }): Promise<HistoryEntry[]>;
  diffStat(path: string, options?: ReadOptions): Promise<DiffStat>;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createGitReader(options: GitReaderOptions): GitReader {
  const git = createReadOnlyGit(options.runner);
  const now = options.now ?? (() => new Date().toISOString());
  const branchLimit = options.branchLimit ?? 50;
  const concurrency = options.concurrency ?? 4;
  const norm = (path: string) => {
    let out = path.replace(/\\/g, "/");
    if (out.length > 1 && out.endsWith("/") && !/^[A-Za-z]:\/$/.test(out)) out = out.slice(0, -1);
    return options.caseInsensitivePaths ? out.toLowerCase() : out;
  };

  /** Run; a missing git, a timeout or a cancel is an error, a non-zero exit is the caller's to judge. */
  async function run(cwd: string, args: string[], read: ReadOptions, extra: { maxBytes?: number } = {}): Promise<GitRunResult> {
    const result = await git.run(cwd, args, { timeoutMs: options.timeoutMs, signal: read.signal, maxBytes: extra.maxBytes });
    if (result.notFound) throw new GitReadError("git_missing", "Git isn't installed, or isn't on PATH.");
    if (result.cancelled) throw new GitReadError("cancelled", "Cancelled.");
    if (result.timedOut) throw new GitReadError("timeout", `git ${args[0]} took too long.`);
    return result;
  }

  const okOut = (result: GitRunResult) => (result.exitCode === 0 ? result.stdout : "");

  async function compare(cwd: string, base: string, sha: string, read: ReadOptions): Promise<Counts | null> {
    if (base === sha) return { ahead: 0, behind: 0 };
    const result = await run(cwd, ["rev-list", "--left-right", "--count", `${base}...${sha}`, "--"], read);
    const match = /^(\d+)\s+(\d+)/.exec(result.stdout.trim());
    return result.exitCode === 0 && match ? { behind: Number(match[1]), ahead: Number(match[2]) } : null;
  }

  async function readRepoState(path: string, read: ReadOptions = {}): Promise<RepoState> {
    const readAt = now();
    if (!options.fs.exists(path)) return { isRepo: false, reason: "Folder not found.", readAt };
    const where = await run(path, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"], read);
    if (where.exitCode !== 0) {
      if (/must be run in a work tree|bare repository/i.test(where.stderr)) return { isRepo: false, reason: "Bare repository (no working folder).", readAt };
      if (/not a git repository/i.test(where.stderr)) return { isRepo: false, reason: "Not a git repository.", readAt };
      if (/dubious ownership|safe\.directory/i.test(where.stderr)) return { isRepo: false, reason: "Git doesn't trust this folder's owner (safe.directory).", readAt };
      throw new GitReadError("failed", where.stderr.trim().split(/\r?\n/)[0] || "git rev-parse failed.");
    }
    const [gitDir, commonDir, toplevel] = where.stdout.split(/\r?\n/);

    const [status, refs, stashList, worktreeOut, remoteOut, subOut, lastOut] = await Promise.all([
      run(path, ["status", "--porcelain=v2", "--branch", "--show-stash", "-z", "--untracked-files=normal"], read),
      run(path, ["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads", "refs/remotes"], read),
      run(path, ["stash", "list", `--format=${STASH_FORMAT}`], read),
      run(path, ["worktree", "list", "--porcelain", "-z"], read),
      run(path, ["remote", "-v"], read),
      run(toplevel, ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], read),
      run(path, ["log", "-1", `--format=${LOG_FORMAT}`], read)
    ]);
    if (status.exitCode !== 0) throw new GitReadError("failed", status.stderr.trim().split(/\r?\n/)[0] || "git status failed.");

    const st = parseStatusV2(status.stdout);
    const refRows = parseRefs(okOut(refs));
    const remotes = parseRemotes(okOut(remoteOut));
    const remoteNames = remotes.map((r) => r.name).sort((a, b) => b.length - a.length);

    // Worktrees: which branches are checked out somewhere else (Autopilot's runs).
    const worktrees: Worktree[] = parseWorktrees(okOut(worktreeOut)).map((row, index) => {
      const isCurrent = norm(row.path) === norm(toplevel);
      return {
        path: row.path,
        headSha: row.head,
        branch: row.branch,
        isMain: index === 0,
        isCurrent,
        owner: classifyWorktree(row.path, row.branch, isCurrent),
        locked: row.locked,
        prunable: row.prunable
      };
    });

    // Default branch: the remote's HEAD, else main, else master.
    const localNames = new Set(refRows.filter((r) => r.refname.startsWith("refs/heads/")).map((r) => r.refname.slice(11)));
    const remoteHead =
      refRows.find((r) => r.refname === "refs/remotes/origin/HEAD" && r.symref) ??
      refRows.find((r) => /^refs\/remotes\/[^/]+\/HEAD$/.test(r.refname) && r.symref);
    let defaultBranch: string | null = null;
    if (remoteHead?.symref) {
      const remote = remoteHead.refname.slice("refs/remotes/".length, -"/HEAD".length);
      defaultBranch = remoteHead.symref.slice(`refs/remotes/${remote}/`.length) || null;
    }
    if (!defaultBranch) defaultBranch = localNames.has("main") ? "main" : localNames.has("master") ? "master" : null;
    const defaultRef = defaultBranch === null
      ? null
      : refRows.find((r) => r.refname === `refs/heads/${defaultBranch}`) ??
        refRows.find((r) => r.refname === `refs/remotes/origin/${defaultBranch}`) ??
        refRows.find((r) => r.refname.startsWith("refs/remotes/") && r.refname.endsWith(`/${defaultBranch}`) && !r.symref) ??
        null;

    // A local default branch that is only behind its upstream is an old copy
    // of it. Measured against that, every branch looks further ahead than it
    // is (and merged branches look unmerged), so the upstream is the base then.
    let defaultBase = defaultRef;
    if (defaultRef?.refname === `refs/heads/${defaultBranch}` && defaultRef.upstream && defaultRef.track && !defaultRef.track.gone && defaultRef.track.ahead === 0 && defaultRef.track.behind > 0) {
      defaultBase = refRows.find((r) => r.refname === defaultRef.upstream && !r.symref) ?? defaultRef;
    }
    const shortRef = (refname: string) => refname.replace(/^refs\/(heads|remotes)\//, "");

    // The deployed branch: its remote-tracking copy when there is one (what was pushed is what can be live), else the local branch.
    const deployedName = read.deployedBranch?.trim() || null;
    const deployedLocal = deployedName ? refRows.find((r) => r.refname === `refs/heads/${deployedName}`) : undefined;
    const deployedRef = deployedName
      ? (deployedLocal?.upstream ? refRows.find((r) => r.refname === deployedLocal.upstream && !r.symref) : undefined) ??
        refRows.find((r) => r.refname === `refs/remotes/origin/${deployedName}`) ??
        deployedLocal ??
        null
      : null;

    const byRecent = (a: RefRow, b: RefRow) => (b.committedAt ?? "").localeCompare(a.committedAt ?? "");
    const localRows = refRows.filter((r) => r.refname.startsWith("refs/heads/")).sort(byRecent);
    const remoteRows = refRows.filter((r) => r.refname.startsWith("refs/remotes/") && !r.symref && !r.refname.endsWith("/HEAD")).sort(byRecent);

    const compared = new Set<string>([...localRows, ...remoteRows].slice(0, read.allBranches ? Infinity : branchLimit * 2).map((r) => r.refname));
    const toCompare = defaultBase ? [...localRows, ...remoteRows].filter((r) => compared.has(r.refname)) : [];
    const counts = new Map<string, Counts | null>();
    await mapLimit(toCompare, concurrency, async (row) => {
      counts.set(row.refname, await compare(path, defaultBase!.sha, row.sha, read));
    });
    const deployedCounts = new Map<string, Counts | null>();
    if (deployedRef) {
      await mapLimit(localRows.filter((r) => compared.has(r.refname) && r.sha !== deployedRef.sha), concurrency, async (row) => {
        deployedCounts.set(row.refname, await compare(path, deployedRef.sha, row.sha, read));
      });
    }

    const elsewhere = new Map<string, Worktree>();
    for (const wt of worktrees) if (!wt.isCurrent && wt.branch) elsewhere.set(wt.branch, wt);

    const branches: LocalBranch[] = localRows.map((row) => {
      const name = row.refname.slice("refs/heads/".length);
      const isDefault = name === defaultBranch;
      const vs = isDefault ? null : counts.get(row.refname) ?? null;
      const remoteUpstream = row.upstream && row.upstream.startsWith("refs/remotes/") && row.upstreamRemote && row.upstreamBranch;
      const other = elsewhere.get(name);
      return {
        name,
        tipSha: row.sha,
        isCurrent: !st.detached && st.head === name,
        upstream: remoteUpstream
          ? {
              ref: row.upstream!.slice("refs/remotes/".length),
              remote: row.upstreamRemote!,
              branch: row.upstreamBranch!,
              gone: row.track?.gone ?? false,
              counts: row.track && !row.track.gone ? { ahead: row.track.ahead, behind: row.track.behind } : null
            }
          : null,
        lastCommitAt: row.committedAt,
        lastSubject: row.subject,
        vsDefault: vs,
        mergedIntoDefault: isDefault ? null : vs ? vs.ahead === 0 : null,
        ...(deployedRef ? { vsDeployed: deployedCounts.get(row.refname) ?? null } : {}),
        checkedOutElsewhere: other ? { path: other.path, owner: other.owner } : null
      };
    });

    const remoteBranches: RemoteBranch[] = remoteRows.map((row) => {
      const short = row.refname.slice("refs/remotes/".length);
      const remote = remoteNames.find((name) => short.startsWith(`${name}/`)) ?? short.split("/")[0];
      const name = short.slice(remote.length + 1);
      const isDefault = defaultBase?.refname === row.refname;
      const vs = isDefault ? null : counts.get(row.refname) ?? null;
      return {
        remote,
        name,
        ref: short,
        tipSha: row.sha,
        lastCommitAt: row.committedAt,
        lastSubject: row.subject,
        vsDefault: vs,
        mergedIntoDefault: isDefault ? null : vs ? vs.ahead === 0 : null,
        trackedBy: localRows.find((l) => l.upstream === row.refname)?.refname.slice("refs/heads/".length) ?? null
      };
    });

    const stashRows = parseStashList(okOut(stashList));
    const stashes: StashEntry[] = await mapLimit(stashRows, concurrency, async (row) => {
      let files: string[] | null = null;
      if (row.index < 10) {
        const show = await run(path, ["stash", "show", "--name-only", "-z", "--include-untracked", row.sha], read);
        files = show.exitCode === 0 ? show.stdout.split("\0").filter(Boolean) : null;
      }
      return { index: row.index, sha: row.sha, branch: row.branch, createdAt: row.createdAt, message: row.message, files };
    });

    let inProgress: RepoStateOk["inProgress"] = null;
    for (const [marker, operation] of IN_PROGRESS_MARKERS) {
      if (options.fs.exists(`${gitDir}/${marker}`)) {
        inProgress = operation;
        break;
      }
    }

    const submodules = okOut(subOut)
      .split(/\r?\n/)
      .map((line) => line.replace(/^submodule\..*\.path /, ""))
      .filter(Boolean);

    const last = parseLog(okOut(lastOut))[0];
    const fetchMs = options.fs.mtimeMs(`${commonDir}/FETCH_HEAD`);

    if (read.measureUntracked && options.fs.measure) {
      const sizes: Record<string, PathSize> = {};
      for (const entry of st.tree.untracked.slice(0, MEASURE_PATHS)) {
        const size = options.fs.measure(`${toplevel}/${entry.replace(/\/+$/, "")}`, MEASURE_FILES);
        if (size) sizes[entry] = size;
      }
      st.tree.sizes = sizes;
    }
    if (read.includeIgnored) {
      const listed = await run(toplevel, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory", "-z"], read);
      const all = listed.exitCode === 0 ? listed.stdout.split("\0").filter(Boolean) : [];
      st.tree.ignored = all.slice(0, IGNORED_LIMIT);
      st.tree.ignoredTruncated = all.length > IGNORED_LIMIT;
    }

    return {
      isRepo: true,
      head: { branch: st.head, sha: st.oid, detached: st.detached, unborn: st.unborn },
      defaultBranch,
      defaultBase: defaultBase ? shortRef(defaultBase.refname) : null,
      ...(deployedName ? { deployed: { branch: deployedName, base: deployedRef ? shortRef(deployedRef.refname) : null } } : {}),
      remotes,
      branches,
      remoteBranches,
      workingTree: st.tree,
      stashes,
      worktrees,
      inProgress,
      submodules,
      lastCommit: last ? { sha: last.sha, subject: last.subject, committedAt: last.committedAt } : null,
      lastFetchAt: fetchMs === null ? null : new Date(fetchMs).toISOString(),
      readAt
    };
  }

  return {
    readRepoState,

    async undoFacts(path, sha, read = {}) {
      if (!isFullSha(sha)) return { commitOnRemote: null, objectExists: null };
      const [contains, exists] = await Promise.all([
        run(path, ["for-each-ref", "--format=%(refname)", `--contains=${sha}`, "refs/remotes"], read),
        run(path, ["cat-file", "-e", `${sha}^{commit}`], read)
      ]);
      return {
        commitOnRemote: contains.exitCode === 0 ? contains.stdout.trim() !== "" : null,
        objectExists: exists.exitCode === 0
      };
    },

    async history(path, read = {}) {
      const limit = Math.max(1, Math.min(500, read.limit ?? 50));
      const [log, localOnly] = await Promise.all([
        run(path, ["log", `-n${limit}`, `--format=${LOG_FORMAT}`, "HEAD", "--"], read),
        run(path, ["rev-list", `-n${limit}`, "HEAD", "--not", "--remotes", "--"], read)
      ]);
      if (log.exitCode !== 0) return [];
      const local = new Set(okOut(localOnly).split(/\r?\n/).filter(Boolean));
      return parseLog(log.stdout).map((c) => ({ ...c, onRemote: localOnly.exitCode === 0 && !local.has(c.sha) }));
    },

    async diffStat(path, read = {}) {
      const base = ["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "--no-renames"];
      const [unstaged, staged] = await Promise.all([run(path, [...base, "--"], read), run(path, [...base, "--cached", "--"], read)]);
      return { staged: parseNumstat(okOut(staged)), unstaged: parseNumstat(okOut(unstaged)) };
    }
  };
}
