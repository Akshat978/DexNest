import { describe, it, expect, afterEach } from 'vitest';
import {
  assertReadOnlyGitArgv,
  isForbiddenGitVerb,
} from '../git/forbidden.js';
import { parsePorcelainV2, parseCommitLog } from '../git/readonly-git.js';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import { inspectGitState } from '../git/readonly-git.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
  createPathWithSpaces,
} from './fixture-repos.js';

describe('read-only git helpers', () => {
  it('rejects forbidden verbs', () => {
    expect(isForbiddenGitVerb('fetch')).toBe(true);
    expect(isForbiddenGitVerb('pull')).toBe(true);
    expect(isForbiddenGitVerb('push')).toBe(true);
    expect(isForbiddenGitVerb('checkout')).toBe(true);
    expect(isForbiddenGitVerb('status')).toBe(false);
    expect(() => assertReadOnlyGitArgv(['git', 'fetch', 'origin'])).toThrow(
      /forbidden/,
    );
    expect(() =>
      assertReadOnlyGitArgv(['git', 'status', '--porcelain=v2']),
    ).not.toThrow();
  });

  it('parses porcelain v2 status', () => {
    const sample = [
      '# branch.oid abcdef0123456789',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +1 -2',
      '1 M. N... 100644 100644 100644 sha1 sha2 file.txt',
      '? untracked.txt',
    ].join('\n');
    const parsed = parsePorcelainV2(sample);
    expect(parsed.branch).toBe('main');
    expect(parsed.upstream).toBe('origin/main');
    expect(parsed.ahead).toBe(1);
    expect(parsed.behind).toBe(2);
    expect(parsed.headSha).toBe('abcdef0123456789');
    expect(parsed.workingTree.stagedCount).toBe(1);
    expect(parsed.workingTree.untrackedCount).toBe(1);
    expect(parsed.workingTree.isClean).toBe(false);
  });

  it('parses delimited commit log', () => {
    const rec =
      'aa\x1fbb\x1fsubj\x1fbody\x1fAnn\x1fa@e.com\x1f2026-01-01T00:00:00Z\x1fCn\x1fc@e.com\x1f2026-01-01T00:00:00Z\x1fparent1\x1e';
    const commits = parseCommitLog(rec);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.sha).toBe('aa');
    expect(commits[0]!.subject).toBe('subj');
  });
});

describe('inspect real fixture repos', () => {
  let workspace = '';
  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('inspects clean repo and path with spaces', async () => {
    workspace = await createTempWorkspace();
    const plain = await createGitRepo(workspace, 'plain', { commits: 1 });
    const spaced = await createPathWithSpaces(workspace);
    const runner = new LocalProcessRunner();

    for (const repo of [plain, spaced]) {
      const state = await inspectGitState({
        cwd: repo.path,
        domain: 'wsl',
        runner,
      });
      expect(state.headSha).toMatch(/^[0-9a-f]{40}$/);
      expect(state.headDetached).toBe(false);
      expect(state.currentBranch).toBe('main');
      expect(state.workingTree.isClean).toBe(true);
      expect(state.recentCommits.length).toBeGreaterThanOrEqual(1);
      expect(state.remoteTrackingConfidence).toBe('local_cache');
    }
  });
});
