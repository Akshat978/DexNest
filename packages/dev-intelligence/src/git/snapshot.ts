/**
 * Build RepositorySnapshot from inspectGitState + remotes.
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  GitState,
  RepositoryRoot,
  RepositorySnapshot,
} from '@dexnest/dev-intelligence-contracts';
import type { GitInspectOptions } from './readonly-git.js';
import { inspectGitState, listRemotes } from './readonly-git.js';

export function contentFingerprintFromGit(git: GitState): string {
  const wt = git.workingTree;
  const parts = [
    git.headSha ?? '',
    git.currentBranch ?? '',
    git.headDetached ? '1' : '0',
    String(wt.stagedCount),
    String(wt.unstagedCount),
    String(wt.untrackedCount),
    String(wt.conflictedCount),
    git.interruptedOperation ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

export interface SnapshotBuildResult {
  snapshot: RepositorySnapshot;
  remotes: Array<{ name: string; url: string; type: string }>;
  ahead?: number;
  behind?: number;
}

export async function buildRepositorySnapshot(
  repositoryId: string,
  root: RepositoryRoot,
  opts: GitInspectOptions,
): Promise<SnapshotBuildResult> {
  const git = await inspectGitState(opts);
  const remotes = await listRemotes(opts);
  const fp = contentFingerprintFromGit(git);

  // Parse ahead/behind from a fresh status already inside inspect — re-derive from branches if needed
  // Status porcelain sets branch.ab; we don't store ahead/behind on GitState directly,
  // but consumers can use remotes + local_cache confidence.

  const snapshot: RepositorySnapshot = {
    schemaVersion: 1,
    id: `snap_${randomUUID().replace(/-/g, '')}`,
    repositoryId,
    capturedAt: new Date().toISOString(),
    root,
    git,
    contentFingerprint: fp,
  };

  return { snapshot, remotes };
}
