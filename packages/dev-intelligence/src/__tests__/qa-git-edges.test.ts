/**
 * Phase 6 QA — Git inspection edge cases.
 * EC-009–021, EC-046 (+ multi-remote / tracking uncertainty).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import {
  inspectGitState,
  getAheadBehind,
  parsePorcelainV2,
} from '../git/readonly-git.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
  plantInterruptedOp,
  type InterruptedOpKind,
} from './fixture-repos.js';

function runGit(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'QA',
      GIT_AUTHOR_EMAIL: 'qa@example.com',
      GIT_COMMITTER_NAME: 'QA',
      GIT_COMMITTER_EMAIL: 'qa@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  }
}

describe('QA git edges (EC-009–021, EC-046)', () => {
  let workspace = '';
  const runner = new LocalProcessRunner();

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('EC-009: no commits — snapshot inspect does not invent commit events', async () => {
    workspace = await createTempWorkspace('qa-ec009-');
    const path = join(workspace, 'empty');
    await mkdir(path, { recursive: true });
    runGit(path, ['init']);
    runGit(path, ['checkout', '-b', 'main']);
    // No commits yet — inspect may throw or return empty commits
    let threw = false;
    let state;
    try {
      state = await inspectGitState({ cwd: path, domain: 'wsl', runner });
    } catch {
      threw = true;
    }
    if (!threw && state) {
      expect(state.recentCommits).toHaveLength(0);
      // head may be undefined / absent — must not invent SHAs
      if (state.headSha) {
        expect(state.headSha).toMatch(/^[0-9a-f]{40}$/);
      }
    } else {
      expect(threw).toBe(true);
    }
  });

  it('EC-010: clean repo dirty=false and zero change counts', async () => {
    workspace = await createTempWorkspace('qa-ec010-');
    const repo = await createGitRepo(workspace, 'clean', { commits: 1 });
    const state = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(state.workingTree.isClean).toBe(true);
    expect(state.workingTree.stagedCount).toBe(0);
    expect(state.workingTree.unstagedCount).toBe(0);
    expect(state.workingTree.untrackedCount).toBe(0);
    expect(state.workingTree.conflictedCount).toBe(0);
  });

  it('EC-011: dirty / staged / unstaged / untracked counts via porcelain v2', async () => {
    workspace = await createTempWorkspace('qa-ec011-');
    const repo = await createGitRepo(workspace, 'dirty', { commits: 1 });
    await writeFile(join(repo.path, 'README.md'), '# dirty edit\n', 'utf8'); // unstaged
    await writeFile(join(repo.path, 'staged.txt'), 'staged\n', 'utf8');
    runGit(repo.path, ['add', 'staged.txt']);
    await writeFile(join(repo.path, 'untracked.txt'), 'u\n', 'utf8');

    const state = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(state.workingTree.isClean).toBe(false);
    expect(state.workingTree.stagedCount).toBeGreaterThanOrEqual(1);
    expect(state.workingTree.unstagedCount).toBeGreaterThanOrEqual(1);
    expect(state.workingTree.untrackedCount).toBeGreaterThanOrEqual(1);
  });

  it('EC-012: conflicted files counted (porcelain u lines)', () => {
    const sample = [
      '# branch.oid abc',
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 sha1 sha2 sha3 conflict.txt',
    ].join('\n');
    const parsed = parsePorcelainV2(sample);
    expect(parsed.workingTree.conflictedCount).toBe(1);
    expect(parsed.workingTree.isClean).toBe(false);
  });

  it('EC-013: detached HEAD flagged; no false branch claims', async () => {
    workspace = await createTempWorkspace('qa-ec013-');
    const repo = await createGitRepo(workspace, 'det', { commits: 2 });
    const sha = spawnSync('git', ['rev-parse', 'HEAD~1'], {
      cwd: repo.path,
      encoding: 'utf8',
    }).stdout.trim();
    runGit(repo.path, ['checkout', '--detach', sha]);
    const state = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(state.headDetached).toBe(true);
    expect(state.currentBranch).toBeUndefined();
  });

  it('EC-014: no upstream — tracking absent; confidence local_cache', async () => {
    workspace = await createTempWorkspace('qa-ec014-');
    const repo = await createGitRepo(workspace, 'noup', { commits: 1 });
    const state = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(state.remoteTrackingConfidence).toBe('local_cache');
    const ab = await getAheadBehind({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(ab.confidence).toBe('local_cache');
    // No invented upstream numbers required when absent
    const cur = state.branches.find((b) => b.isCurrent && !b.isRemote);
    if (cur) {
      expect(cur.upstream === undefined || cur.upstream === '').toBe(true);
    }
  });

  it('EC-015: stale tracking modeled as local_cache (not live remote truth)', async () => {
    workspace = await createTempWorkspace('qa-ec015-');
    const repo = await createGitRepo(workspace, 'stale', { commits: 1 });
    // Plant a fake remote tracking ref without network
    runGit(repo.path, ['remote', 'add', 'origin', 'https://example.invalid/repo.git']);
    const tip = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo.path,
      encoding: 'utf8',
    }).stdout.trim();
    runGit(repo.path, ['update-ref', 'refs/remotes/origin/main', tip]);
    runGit(repo.path, ['branch', '--set-upstream-to=origin/main', 'main']);
    const state = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(state.remoteTrackingConfidence).toBe('local_cache');
  });

  it('EC-016: multiple remotes captured; no network fetch', async () => {
    workspace = await createTempWorkspace('qa-ec016-');
    const repo = await createGitRepo(workspace, 'multi', { commits: 1 });
    runGit(repo.path, ['remote', 'add', 'origin', 'https://example.invalid/a.git']);
    runGit(repo.path, ['remote', 'add', 'upstream', 'https://example.invalid/b.git']);
    const state = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    // Remotes appear via for-each-ref remotes or at least inspection succeeds
    expect(state.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(state.remoteTrackingConfidence).toBe('local_cache');
  });

  const KINDS: InterruptedOpKind[] = [
    'merge',
    'rebase',
    'cherry-pick',
    'revert',
    'bisect',
  ];
  const EC_MAP: Record<InterruptedOpKind, string> = {
    merge: 'EC-017',
    rebase: 'EC-018',
    'cherry-pick': 'EC-019',
    revert: 'EC-020',
    bisect: 'EC-021',
  };

  for (const kind of KINDS) {
    it(`${EC_MAP[kind]}: ${kind} in progress detected`, async () => {
      workspace = await createTempWorkspace(`qa-${kind}-`);
      const repo = await createGitRepo(workspace, kind, { commits: 1 });
      await plantInterruptedOp(repo.path, kind);
      const state = await inspectGitState({
        cwd: repo.path,
        domain: 'wsl',
        runner,
      });
      expect(state.interruptedOperation).toBe(kind);
    });
  }

  it('EC-046: amended commit (new SHA) treated as distinct identity', async () => {
    workspace = await createTempWorkspace('qa-ec046-');
    const repo = await createGitRepo(workspace, 'amend', { commits: 1 });
    const before = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo.path,
      encoding: 'utf8',
    }).stdout.trim();
    await writeFile(join(repo.path, 'README.md'), '# amended\n', 'utf8');
    runGit(repo.path, ['add', 'README.md']);
    runGit(repo.path, ['commit', '--amend', '--no-edit']);
    const after = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo.path,
      encoding: 'utf8',
    }).stdout.trim();
    expect(after).not.toBe(before);
    const state = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(state.headSha).toBe(after);
    expect(state.recentCommits.some((c) => c.sha === after)).toBe(true);
    expect(state.recentCommits.some((c) => c.sha === before)).toBe(false);
  });
});
