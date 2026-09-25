/**
 * Helpers to create small real git repos under a temp directory.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import { listCandidateFiles } from '../git/readonly-git.js';

function runGit(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'DI Test',
      GIT_AUTHOR_EMAIL: 'di-test@example.com',
      GIT_COMMITTER_NAME: 'DI Test',
      GIT_COMMITTER_EMAIL: 'di-test@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${r.stderr || r.stdout || r.status}`,
    );
  }
}

export interface FixtureRepo {
  path: string;
  name: string;
}

export async function createTempWorkspace(prefix = 'di-kernel-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function createGitRepo(
  parent: string,
  name: string,
  options?: { commits?: number; dirty?: boolean; fileName?: string },
): Promise<FixtureRepo> {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  runGit(path, ['init']);
  runGit(path, ['checkout', '-b', 'main']);
  const commits = options?.commits ?? 1;
  const fileName = options?.fileName ?? 'README.md';
  for (let i = 1; i <= commits; i++) {
    await writeFile(
      join(path, fileName),
      `# ${name}\n\ncommit ${i}\n`,
      'utf8',
    );
    runGit(path, ['add', fileName]);
    runGit(path, ['commit', '-m', `${name}: commit ${i}`]);
  }
  if (options?.dirty) {
    await writeFile(join(path, 'dirty.txt'), 'dirty\n', 'utf8');
  }
  return { path, name };
}

export async function createBrokenRepoDir(
  parent: string,
  name: string,
): Promise<string> {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  // Fake .git that is not a valid repo (empty dir) — git commands fail
  await mkdir(join(path, '.git'), { recursive: true });
  return path;
}

export async function createPathWithSpaces(
  parent: string,
): Promise<FixtureRepo> {
  return createGitRepo(parent, 'repo with spaces', { commits: 1 });
}

export async function createUnicodePathRepo(
  parent: string,
): Promise<FixtureRepo> {
  return createGitRepo(parent, 'репо-项目', { commits: 1 });
}

export type InterruptedOpKind =
  | 'merge'
  | 'rebase'
  | 'cherry-pick'
  | 'revert'
  | 'bisect';

/**
 * Plant interrupted-op marker files under .git (read-only detection fixtures).
 * Does not perform real merge/rebase — detection is file-presence based.
 */
export async function plantInterruptedOp(
  repoPath: string,
  kind: InterruptedOpKind,
): Promise<void> {
  const gitDir = join(repoPath, '.git');
  switch (kind) {
    case 'merge':
      await writeFile(join(gitDir, 'MERGE_HEAD'), '0'.repeat(40) + '\n', 'utf8');
      break;
    case 'rebase':
      await mkdir(join(gitDir, 'rebase-merge'), { recursive: true });
      await writeFile(
        join(gitDir, 'REBASE_HEAD'),
        '0'.repeat(40) + '\n',
        'utf8',
      );
      break;
    case 'cherry-pick':
      await writeFile(
        join(gitDir, 'CHERRY_PICK_HEAD'),
        '0'.repeat(40) + '\n',
        'utf8',
      );
      break;
    case 'revert':
      await writeFile(
        join(gitDir, 'REVERT_HEAD'),
        '0'.repeat(40) + '\n',
        'utf8',
      );
      break;
    case 'bisect':
      await writeFile(join(gitDir, 'BISECT_LOG'), 'git bisect start\n', 'utf8');
      break;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unknown interrupted op: ${_exhaustive}`);
    }
  }
}

/**
 * The execution domain local temp directories belong to.
 *
 * Tests used 'wsl' for local paths, which was right on the Linux machine they
 * were written on and wrong on Windows, where C:\Users\... is not a WSL path.
 */
export const nativeDomain = process.platform === 'win32' ? ('windows' as const) : ('wsl' as const);

/**
 * Makes `dir` unreadable for the current user, for real.
 *
 * POSIX: chmod 000. Windows ignores that, so a deny ACE on the current user
 * is added with icacls instead - a genuine access-denied, which needs no
 * elevation on a folder the user owns. Undo with restoreAccess.
 */
export function denyAccess(dir: string): void {
  if (process.platform === 'win32') {
    const who = process.env.USERNAME ?? '';
    const res = spawnSync('icacls', [dir, '/deny', `${who}:(OI)(CI)(RX)`], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`icacls deny failed: ${res.stderr || res.stdout}`);
    return;
  }
  spawnSync('chmod', ['000', dir]);
}

/** Reverses denyAccess. As the owner, the user can always rewrite the ACL. */
export function restoreAccess(dir: string): void {
  if (process.platform === 'win32') {
    spawnSync('icacls', [dir, '/remove:d', process.env.USERNAME ?? ''], { encoding: 'utf8' });
    return;
  }
  spawnSync('chmod', ['755', dir]);
}

/**
 * A directory link that works without privileges on both platforms: a
 * junction on Windows (symlinks need Developer Mode or elevation there), a
 * symlink elsewhere.
 */
export async function linkDirectory(target: string, linkPath: string): Promise<void> {
  const { symlink } = await import('node:fs/promises');
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

/**
 * The file list the scanner gets in production: `git ls-files` in the
 * repository, through the real process runner. Tests use it rather than a
 * hand-written list so they exercise ignore rules for real.
 */
export function gitFiles(root: string): () => Promise<readonly string[]> {
  return () =>
    listCandidateFiles({
      cwd: root,
      domain: process.platform === 'win32' ? 'windows' : 'wsl',
      runner: new LocalProcessRunner(),
    });
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
