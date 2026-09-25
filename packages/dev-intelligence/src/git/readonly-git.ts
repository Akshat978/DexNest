/**
 * Read-only Git inspection via structured argv + ProcessRunnerPort.
 * Prefer machine-readable formats (porcelain=v2, for-each-ref, etc.).
 */

import type {
  CancelHandle,
  GitBranch,
  GitCommit,
  GitState,
  ProcessRunnerPort,
  RemoteTrackingConfidence,
  RepositoryExecutionDomain,
  WorkingTreeState,
} from '@dexnest/dev-intelligence-contracts';
import { assertReadOnlyGitArgv } from './forbidden.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUT = 512 * 1024;

export interface GitInspectOptions {
  cwd: string;
  domain: RepositoryExecutionDomain;
  runner: ProcessRunnerPort;
  cancel?: CancelHandle;
  timeoutMs?: number;
  maxBytes?: number;
  recentCommitLimit?: number;
}

async function git(
  opts: GitInspectOptions,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null; ok: boolean }> {
  const argv = ['git', ...args];
  assertReadOnlyGitArgv(argv);
  const result = await opts.runner.run({
    cwd: opts.cwd,
    domain: opts.domain,
    argv,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxStdoutBytes: opts.maxBytes ?? DEFAULT_MAX_OUT,
    maxStderrBytes: opts.maxBytes ?? DEFAULT_MAX_OUT,
    cancel: opts.cancel,
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
    },
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    ok: !result.timedOut && !result.cancelled && result.exitCode === 0,
  };
}

/** Largest file list accepted from `git ls-files`, in bytes of output. */
const MAX_FILE_LIST_BYTES = 16 * 1024 * 1024;

/**
 * Files Git considers part of the working tree: tracked, plus untracked files
 * that no ignore rule excludes. Repository-relative, forward slashes.
 *
 * Fails rather than returning a partial list. The process runner truncates
 * output silently at its byte cap and still reports success, so hitting the
 * cap is treated as failure - a truncated list would make every TODO in the
 * missing files look resolved.
 */
export async function listCandidateFiles(opts: GitInspectOptions): Promise<string[]> {
  const cap = opts.maxBytes ?? MAX_FILE_LIST_BYTES;
  const result = await git({ ...opts, maxBytes: cap, timeoutMs: opts.timeoutMs ?? 30_000 }, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  if (!result.ok) {
    throw new Error(`git ls-files failed (exit ${result.exitCode ?? 'none'}): ${result.stderr.trim().slice(0, 200)}`);
  }
  if (Buffer.byteLength(result.stdout, 'utf8') >= cap) {
    throw new Error(`git ls-files output reached the ${cap}-byte limit; refusing a possibly partial file list`);
  }
  return [...new Set(result.stdout.split('\u0000').filter(Boolean))];
}

export async function revParse(
  opts: GitInspectOptions,
  abspath: string,
): Promise<string | undefined> {
  const r = await git(opts, ['rev-parse', abspath]);
  if (!r.ok) return undefined;
  return r.stdout.trim() || undefined;
}

export async function listRemotes(
  opts: GitInspectOptions,
): Promise<Array<{ name: string; url: string; type: string }>> {
  const r = await git(opts, ['remote', '-v']);
  if (!r.ok) return [];
  const out: Array<{ name: string; url: string; type: string }> = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((\w+)\)/.exec(line.trim());
    if (m) out.push({ name: m[1]!, url: m[2]!, type: m[3]! });
  }
  return out;
}

/** Parse `git status --porcelain=v2 --branch`. */
export function parsePorcelainV2(stdout: string): {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  headSha?: string;
  detached: boolean;
  workingTree: WorkingTreeState;
} {
  let branch: string | undefined;
  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  let headSha: string | undefined;
  let detached = false;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  const samplePaths: string[] = [];

  for (const raw of stdout.split('\n')) {
    const line = raw; // keep leading chars
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      const name = line.slice('# branch.head '.length).trim();
      if (name === '(detached)') {
        detached = true;
        branch = undefined;
      } else {
        branch = name;
      }
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const m = /# branch\.ab \+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length).trim();
      if (oid !== '(initial)') headSha = oid;
    } else if (line.startsWith('? ')) {
      untracked += 1;
      if (samplePaths.length < 20) samplePaths.push(line.slice(2));
    } else if (line.startsWith('u ')) {
      conflicted += 1;
      if (samplePaths.length < 20) {
        const parts = line.split(' ');
        samplePaths.push(parts[parts.length - 1] ?? line);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // ordinary / rename: xy in fields
      const parts = line.split(' ');
      const xy = parts[1] ?? '';
      const x = xy[0] ?? '.';
      const y = xy[1] ?? '.';
      if (x !== '.' && x !== ' ') staged += 1;
      if (y !== '.' && y !== ' ') unstaged += 1;
      if (samplePaths.length < 20) {
        samplePaths.push(parts[parts.length - 1] ?? line);
      }
    }
  }

  const workingTree: WorkingTreeState = {
    isClean: staged === 0 && unstaged === 0 && untracked === 0 && conflicted === 0,
    stagedCount: staged,
    unstagedCount: unstaged,
    untrackedCount: untracked,
    conflictedCount: conflicted,
    samplePaths: samplePaths.length ? samplePaths : undefined,
  };

  return { branch, upstream, ahead, behind, headSha, detached, workingTree };
}

const LOG_FMT = '%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%P%x1e';

export function parseCommitLog(stdout: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of stdout.split('\x1e')) {
    const trimmed = record.replace(/^\n/, '').trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\x1f');
    if (parts.length < 11) continue;
    const [
      sha,
      shortSha,
      subject,
      body,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      parentsRaw,
    ] = parts;
    commits.push({
      sha: sha!,
      shortSha: shortSha || undefined,
      subject: subject ?? '',
      body: body || undefined,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorDate: authorDate ?? '',
      committerName: committerName || undefined,
      committerEmail: committerEmail || undefined,
      committerDate: committerDate || undefined,
      parents: (parentsRaw ?? '').split(' ').filter(Boolean),
    });
  }
  return commits;
}

export async function detectInterruptedOperation(
  cwd: string,
): Promise<string | undefined> {
  const checks: Array<[string, string]> = [
    ['MERGE_HEAD', 'merge'],
    ['REBASE_HEAD', 'rebase'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect'],
  ];
  for (const [name, label] of checks) {
    try {
      await access(join(cwd, '.git', name));
      return label;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

export async function inspectGitState(
  opts: GitInspectOptions,
): Promise<GitState> {
  const inside = await git(opts, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    throw new Error(
      `not a usable git work tree at ${opts.cwd}: ${inside.stderr || inside.stdout || 'rev-parse failed'}`,
    );
  }

  const remoteTrackingConfidence: RemoteTrackingConfidence = 'local_cache';

  const status = await git(opts, [
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=normal',
  ]);
  const parsed = status.ok
    ? parsePorcelainV2(status.stdout)
    : {
        detached: false,
        workingTree: {
          isClean: true,
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          conflictedCount: 0,
        } satisfies WorkingTreeState,
      };

  let headSha = parsed.headSha;
  if (!headSha) {
    headSha = await revParse(opts, 'HEAD');
  }

  const logLimit = opts.recentCommitLimit ?? 20;
  const log = await git(opts, [
    'log',
    `-n${logLimit}`,
    `--format=${LOG_FMT}`,
  ]);
  const recentCommits = log.ok ? parseCommitLog(log.stdout) : [];

  // Branches via for-each-ref
  const refs = await git(opts, [
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(HEAD)',
    'refs/heads',
    'refs/remotes',
  ]);
  const branches: GitBranch[] = [];
  if (refs.ok) {
    for (const line of refs.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, tipSha, upstream, headMark] = line.split('\0');
      if (!name) continue;
      const isRemote = name.includes('/');
      // remote refs look like origin/main — treat as remote
      const remoteish = name.startsWith('origin/') || name.includes('/');
      branches.push({
        name,
        isCurrent: headMark === '*' || name === parsed.branch,
        isRemote: remoteish && !name.startsWith('heads/'),
        upstream: upstream || undefined,
        tipSha: tipSha || undefined,
        remoteTrackingConfidence: upstream
          ? remoteTrackingConfidence
          : undefined,
      });
      void isRemote;
    }
  }

  // Fix isRemote: refs/remotes were requested with short names like origin/foo
  for (const b of branches) {
    if (b.name.includes('/') && b.name !== parsed.branch) {
      // heuristic: local branches usually have no slash; remotes have remote/name
      const localNames = new Set(
        branches.filter((x) => !x.name.includes('/')).map((x) => x.name),
      );
      if (!localNames.has(b.name) && b.name.includes('/')) {
        b.isRemote = true;
      }
    }
  }

  // Annotate current branch upstream from status
  if (parsed.branch) {
    const cur = branches.find((b) => b.name === parsed.branch && !b.isRemote);
    if (cur && parsed.upstream) {
      cur.upstream = parsed.upstream;
      cur.remoteTrackingConfidence = remoteTrackingConfidence;
    }
  }

  const interruptedOperation = await detectInterruptedOperation(opts.cwd);

  return {
    schemaVersion: 1,
    headSha,
    headDetached: parsed.detached,
    currentBranch: parsed.detached ? undefined : parsed.branch,
    branches,
    recentCommits,
    workingTree: parsed.workingTree,
    remoteTrackingConfidence,
    interruptedOperation,
  };
}

/** Ahead/behind from status header when locally knowable (still local_cache). */
export async function getAheadBehind(
  opts: GitInspectOptions,
): Promise<{ ahead?: number; behind?: number; confidence: RemoteTrackingConfidence }> {
  const status = await git(opts, ['status', '--porcelain=v2', '--branch']);
  if (!status.ok) return { confidence: 'unknown' };
  const parsed = parsePorcelainV2(status.stdout);
  return {
    ahead: parsed.ahead,
    behind: parsed.behind,
    confidence: 'local_cache',
  };
}
