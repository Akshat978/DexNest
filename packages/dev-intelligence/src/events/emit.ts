/**
 * Emit Developer Events with contract fingerprint helpers.
 * Idempotency is enforced by EventStore.append (fingerprint UNIQUE).
 */

import { randomUUID } from 'node:crypto';
import type {
  BranchChangedPayload,
  CommitObservedPayload,
  ConflictObservedPayload,
  DeveloperEvent,
  EventStore,
  GitCommit,
  GitState,
  HealthCompletedPayload,
  HealthRun,
  RepoDiscoveredPayload,
  RepoSnapshotPayload,
  RepositorySnapshot,
  TechnologyFact,
  TechnologyObservedPayload,
  TechnologyRemovedPayload,
  TodoEventPayload,
  TodoMarker,
  WorkingTreeChangedPayload,
} from '@dexnest/dev-intelligence-contracts';
import {
  fingerprintBranchChanged,
  fingerprintCommitObserved,
  fingerprintConflictObserved,
  fingerprintGitOperation,
  fingerprintHealthCompleted,
  fingerprintRepoDiscovered,
  fingerprintRepoSnapshot,
  fingerprintTechnologyObserved,
  fingerprintTechnologyRemoved,
  fingerprintTodo,
  fingerprintWorkingTreeChanged,
} from '@dexnest/dev-intelligence-contracts';

const SOURCE = 'repository-intelligence';

function envelope<T>(
  type: DeveloperEvent['type'],
  repositoryId: string,
  fingerprint: string,
  payload: T,
  occurredAt: string,
  sourceIdentity: string,
): DeveloperEvent<T> {
  const observedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    eventId: `evt_${randomUUID().replace(/-/g, '')}`,
    type,
    repositoryId,
    occurredAt,
    observedAt,
    source: SOURCE,
    sourceIdentity,
    fingerprint,
    payload,
  };
}

export interface EmitContext {
  events: EventStore;
  sourceIdentity: string;
}

export async function emitRepoDiscovered(
  ctx: EmitContext,
  repositoryId: string,
  payload: RepoDiscoveredPayload,
): Promise<boolean> {
  const fp = fingerprintRepoDiscovered(
    repositoryId,
    payload.rootPath,
    payload.domain,
  );
  return ctx.events.append(
    envelope(
      'dev.repo.discovered',
      repositoryId,
      fp,
      payload,
      new Date().toISOString(),
      ctx.sourceIdentity,
    ),
  );
}

export async function emitRepoSnapshot(
  ctx: EmitContext,
  snapshot: RepositorySnapshot,
): Promise<boolean> {
  const contentFp =
    snapshot.contentFingerprint ??
    `${snapshot.git.headSha ?? ''}|${snapshot.git.currentBranch ?? ''}`;
  const fp = fingerprintRepoSnapshot(snapshot.repositoryId, contentFp);
  const payload: RepoSnapshotPayload = {
    snapshotId: snapshot.id,
    contentFingerprint: snapshot.contentFingerprint,
    headSha: snapshot.git.headSha,
    currentBranch: snapshot.git.currentBranch,
  };
  return ctx.events.append(
    envelope(
      'dev.repo.snapshot',
      snapshot.repositoryId,
      fp,
      payload,
      snapshot.capturedAt,
      ctx.sourceIdentity,
    ),
  );
}

export async function emitCommitObserved(
  ctx: EmitContext,
  repositoryId: string,
  commit: GitCommit,
  branch?: string,
): Promise<boolean> {
  const fp = fingerprintCommitObserved(repositoryId, commit.sha);
  const payload: CommitObservedPayload = {
    sha: commit.sha,
    subject: commit.subject,
    authorDate: commit.authorDate,
    branch,
    ...(commit.authorEmail ? { authorEmail: commit.authorEmail } : {}),
  };
  return ctx.events.append(
    envelope(
      'dev.commit.observed',
      repositoryId,
      fp,
      payload,
      commit.authorDate || new Date().toISOString(),
      ctx.sourceIdentity,
    ),
  );
}

export async function emitBranchChangedIfNeeded(
  ctx: EmitContext,
  repositoryId: string,
  previous: GitState | undefined,
  current: GitState,
): Promise<boolean> {
  const prevBranch = previous?.currentBranch;
  const prevHead = previous?.headSha;
  if (
    previous &&
    prevBranch === current.currentBranch &&
    prevHead === current.headSha
  ) {
    return false;
  }
  const fp = fingerprintBranchChanged(
    repositoryId,
    prevBranch,
    current.currentBranch,
    current.headSha,
  );
  const payload: BranchChangedPayload = {
    previousBranch: prevBranch,
    currentBranch: current.currentBranch,
    headSha: current.headSha,
  };
  return ctx.events.append(
    envelope(
      'dev.branch.changed',
      repositoryId,
      fp,
      payload,
      new Date().toISOString(),
      ctx.sourceIdentity,
    ),
  );
}

export async function emitWorkingTreeChangedIfNeeded(
  ctx: EmitContext,
  repositoryId: string,
  previous: GitState | undefined,
  current: GitState,
): Promise<boolean> {
  const wt = current.workingTree;
  const prev = previous?.workingTree;
  if (
    prev &&
    prev.isClean === wt.isClean &&
    prev.stagedCount === wt.stagedCount &&
    prev.unstagedCount === wt.unstagedCount &&
    prev.untrackedCount === wt.untrackedCount &&
    prev.conflictedCount === wt.conflictedCount
  ) {
    return false;
  }
  const fp = fingerprintWorkingTreeChanged(
    repositoryId,
    wt.isClean,
    wt.stagedCount,
    wt.unstagedCount,
    wt.untrackedCount,
    wt.conflictedCount,
  );
  const payload: WorkingTreeChangedPayload = {
    isClean: wt.isClean,
    stagedCount: wt.stagedCount,
    unstagedCount: wt.unstagedCount,
    untrackedCount: wt.untrackedCount,
    conflictedCount: wt.conflictedCount,
  };
  return ctx.events.append(
    envelope(
      'dev.working_tree.changed',
      repositoryId,
      fp,
      payload,
      new Date().toISOString(),
      ctx.sourceIdentity,
    ),
  );
}

export async function emitConflictIfNeeded(
  ctx: EmitContext,
  repositoryId: string,
  current: GitState,
): Promise<boolean> {
  if (current.workingTree.conflictedCount <= 0) return false;
  const signature = [
    current.interruptedOperation ?? 'conflict',
    String(current.workingTree.conflictedCount),
    ...(current.workingTree.samplePaths ?? []).slice(0, 5),
  ].join('|');
  const fp = fingerprintConflictObserved(repositoryId, signature);
  const payload: ConflictObservedPayload = {
    conflictedCount: current.workingTree.conflictedCount,
    samplePaths: current.workingTree.samplePaths,
  };
  return ctx.events.append(
    envelope(
      'dev.conflict.observed',
      repositoryId,
      fp,
      payload,
      new Date().toISOString(),
      ctx.sourceIdentity,
    ),
  );
}

export async function emitGitOperationIfNeeded(
  ctx: EmitContext,
  repositoryId: string,
  previous: GitState | undefined,
  current: GitState,
): Promise<void> {
  const prevOp = previous?.interruptedOperation;
  const curOp = current.interruptedOperation;
  if (curOp && curOp !== prevOp) {
    const fp = fingerprintGitOperation(
      'dev.git_operation.started',
      repositoryId,
      curOp,
    );
    await ctx.events.append(
      envelope(
        'dev.git_operation.started',
        repositoryId,
        fp,
        { operation: curOp },
        new Date().toISOString(),
        ctx.sourceIdentity,
      ),
    );
  }
  if (prevOp && !curOp) {
    const fp = fingerprintGitOperation(
      'dev.git_operation.resolved',
      repositoryId,
      prevOp,
    );
    await ctx.events.append(
      envelope(
        'dev.git_operation.resolved',
        repositoryId,
        fp,
        { operation: prevOp },
        new Date().toISOString(),
        ctx.sourceIdentity,
      ),
    );
  }
}

export async function emitTodoObserved(
  ctx: EmitContext,
  marker: TodoMarker,
  action?: string,
): Promise<boolean> {
  const fp = fingerprintTodo(
    'dev.todo.observed',
    marker.repositoryId,
    marker.fingerprint,
  );
  const payload: TodoEventPayload = {
    todoId: marker.id,
    fingerprint: marker.fingerprint,
    kind: marker.kind,
    filePath: marker.filePath,
    text: marker.text,
    previousFilePath: marker.previousFilePath,
    action,
  };
  return ctx.events.append(
    envelope(
      'dev.todo.observed',
      marker.repositoryId,
      fp,
      payload,
      marker.firstObservedAt,
      ctx.sourceIdentity,
    ),
  );
}

export async function emitTodoResolved(
  ctx: EmitContext,
  marker: TodoMarker,
): Promise<boolean> {
  const fp = fingerprintTodo(
    'dev.todo.resolved',
    marker.repositoryId,
    marker.fingerprint,
  );
  const payload: TodoEventPayload = {
    todoId: marker.id,
    fingerprint: marker.fingerprint,
    kind: marker.kind,
    filePath: marker.filePath,
    text: marker.text,
  };
  return ctx.events.append(
    envelope(
      'dev.todo.resolved',
      marker.repositoryId,
      fp,
      payload,
      marker.resolvedAt ?? new Date().toISOString(),
      ctx.sourceIdentity,
    ),
  );
}

export async function emitTechnologyObserved(
  ctx: EmitContext,
  fact: TechnologyFact,
): Promise<boolean> {
  const fp = fingerprintTechnologyObserved(fact.repositoryId, fact.fingerprint);
  const payload: TechnologyObservedPayload = {
    technologyId: fact.id,
    fingerprint: fact.fingerprint,
    category: fact.category,
    name: fact.name,
    version: fact.version,
    evidencePath: fact.evidencePath,
  };
  return ctx.events.append(
    envelope(
      'dev.technology.observed',
      fact.repositoryId,
      fp,
      payload,
      fact.firstObservedAt,
      ctx.sourceIdentity,
    ),
  );
}

export async function emitTechnologyRemoved(
  ctx: EmitContext,
  fact: TechnologyFact,
): Promise<boolean> {
  const fp = fingerprintTechnologyRemoved(fact.repositoryId, fact.fingerprint);
  const payload: TechnologyRemovedPayload = {
    technologyId: fact.id,
    fingerprint: fact.fingerprint,
    category: fact.category,
    name: fact.name,
    evidencePath: fact.evidencePath,
  };
  return ctx.events.append(
    envelope(
      'dev.technology.removed',
      fact.repositoryId,
      fp,
      payload,
      fact.removedAt ?? new Date().toISOString(),
      ctx.sourceIdentity,
    ),
  );
}

export async function emitHealthCompleted(
  ctx: EmitContext,
  run: HealthRun,
): Promise<boolean> {
  const fp = fingerprintHealthCompleted(run.repositoryId, run.id);
  const payload: HealthCompletedPayload = {
    healthCheckId: run.healthCheckId,
    healthRunId: run.id,
    status: run.status,
  };
  return ctx.events.append(
    envelope(
      'dev.health.completed',
      run.repositoryId,
      fp,
      payload,
      run.finishedAt ?? run.startedAt,
      ctx.sourceIdentity,
    ),
  );
}
