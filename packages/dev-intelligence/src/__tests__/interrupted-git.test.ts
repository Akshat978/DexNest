import { describe, it, expect, afterEach } from 'vitest';
import { detectInterruptedOperation, inspectGitState } from '../git/readonly-git.js';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
  plantInterruptedOp,
  type InterruptedOpKind,
} from './fixture-repos.js';

const KINDS: InterruptedOpKind[] = [
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'bisect',
];

describe('interrupted Git ops detection', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  for (const kind of KINDS) {
    it(`detects ${kind} state fixture`, async () => {
      workspace = await createTempWorkspace(`di-int-${kind}-`);
      const repo = await createGitRepo(workspace, kind, { commits: 1 });
      await plantInterruptedOp(repo.path, kind);

      const detected = await detectInterruptedOperation(repo.path);
      expect(detected).toBe(kind);

      const state = await inspectGitState({
        cwd: repo.path,
        domain: 'wsl',
        runner: new LocalProcessRunner(),
      });
      expect(state.interruptedOperation).toBe(kind);
    });
  }

  it('returns undefined when no interrupted op', async () => {
    workspace = await createTempWorkspace('di-int-clean-');
    const repo = await createGitRepo(workspace, 'clean', { commits: 1 });
    expect(await detectInterruptedOperation(repo.path)).toBeUndefined();
  });
});
