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
  RefTransferPayload,
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
  fingerprintFromParts,
  fingerprintBranchChanged,
  fingerprintCommitObserved,
  fingerprintConflictObserved,
  fingerprintGitOperation,
  fingerprintHealthCompleted,
  fingerprintRefTransfer,
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

/**
 * Git writes dates with the author's own offset ("...T16:44:57-06:00"). Stored
 * like that, two instants do not compare as text, and every reader of
 * `occurredAt` compares as text. One form: UTC.
 */
function utcOrNow(date: string | undefined): string {
  const time = date ? new Date(date) : undefined;
  return time && !Number.isNaN(time.getTime()) ? time.toISOString() : new Date().toISOString();
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
  /** The commit was already there at the repository's first inspection. */
  baseline = false,
): Promise<boolean> {
  const fp = fingerprintCommitObserved(repositoryId, commit.sha);
  const payload: CommitObservedPayload = {
    sha: commit.sha,
    subject: commit.subject,
    authorDate: commit.authorDate,
    branch,
    ...(commit.authorEmail ? { authorEmail: commit.authorEmail } : {}),
    ...(baseline ? { baseline: true } : {}),
  };
  return ctx.events.append(
    envelope(
      'dev.commit.observed',
      repositoryId,
      fp,
      payload,
      utcOrNow(commit.authorDate),
      ctx.sourceIdentity,
    ),
  );
}

/** A push or pull read from the reflog. `occurredAt` is the time Git recorded. */
export async function emitRefTransfer(
  ctx: EmitContext,
  repositoryId: string,
  transfer: { kind: 'push' | 'pull'; ref: string; sha: string; at: string; detail: string },
): Promise<boolean> {
  const type = transfer.kind === 'push' ? 'dev.push.observed' : 'dev.pull.observed';
  const payload: RefTransferPayload = { ref: transfer.ref, sha: transfer.sha, detail: transfer.detail };
  return ctx.events.append(
    envelope(
      type,
      repositoryId,
      fingerprintRefTransfer(type, repositoryId, transfer.ref, transfer.sha, transfer.at),
      payload,
      transfer.at,
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

/**
 * A repository that had uncommitted changes at the last scan and has none
 * now: the work was committed, stashed or put away. Said as its own event,
 * with no payload, so something that only reads event types (Reality RPG)
 * can tell "left it tidy" from every other change to the working tree.
 * Never on a first inspection: there is no "before" to have tidied.
 */
export async function emitWorkingTreeCleanedIfNeeded(
  ctx: EmitContext,
  repositoryId: string,
  previous: GitState | undefined,
  current: GitState,
): Promise<boolean> {
  if (!previous || previous.workingTree.isClean || !current.workingTree.isClean) return false;
  const at = new Date().toISOString();
  // One per tidy-up: keyed on the commit it was left at and the day, so the same state seen twice is one event.
  const fp = fingerprintFromParts('dev.working_tree.cleaned', repositoryId, current.headSha ?? '', at.slice(0, 10));
  return ctx.events.append(envelope('dev.working_tree.cleaned', repositoryId, fp, {}, at, ctx.sourceIdentity));
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
