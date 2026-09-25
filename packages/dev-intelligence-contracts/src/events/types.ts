/**
 * Developer Event type union and envelope.
 * Every event carries a deterministic fingerprint for idempotent inserts.
 */

export type DeveloperEventType =
  | 'dev.repo.discovered'
  | 'dev.repo.snapshot'
  | 'dev.commit.observed'
  | 'dev.branch.changed'
  | 'dev.working_tree.changed'
  | 'dev.conflict.observed'
  | 'dev.git_operation.started'
  | 'dev.git_operation.resolved'
  | 'dev.todo.observed'
  | 'dev.todo.resolved'
  | 'dev.health.completed'
  | 'dev.technology.observed'
  | 'dev.technology.removed';

/** Provenance of the observation (scanner, harness, etc.). */
export interface DeveloperEventSource {
  kind: string;
  /** Opaque identity of the producer instance / process / scan. */
  identity?: string;
}

/**
 * Immutable developer event envelope.
 * `fingerprint` MUST be deterministic for the same consequential observation
 * so re-scans do not duplicate events.
 */
export interface DeveloperEvent<TPayload = unknown> {
  schemaVersion: 1;
  eventId: string;
  type: DeveloperEventType;
  repositoryId: string;
  /** When the underlying fact occurred (best effort; may equal observedAt). */
  occurredAt: string;
  /** When DI observed / emitted the event. */
  observedAt: string;
  source: string;
  sourceIdentity: string;
  fingerprint: string;
  payload: TPayload;
}

/** Payload shapes (loose facts; refine in later phases). */
export interface RepoDiscoveredPayload {
  rootPath: string;
  domain: string;
  displayName?: string;
}

export interface RepoSnapshotPayload {
  snapshotId: string;
  contentFingerprint?: string;
  headSha?: string;
  currentBranch?: string;
}

export interface CommitObservedPayload {
  sha: string;
  subject: string;
  authorDate: string;
  branch?: string;
}

export interface BranchChangedPayload {
  previousBranch?: string;
  currentBranch?: string;
  headSha?: string;
}

export interface WorkingTreeChangedPayload {
  isClean: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
}

export interface ConflictObservedPayload {
  conflictedCount: number;
  samplePaths?: string[];
}

export interface GitOperationPayload {
  operation: string;
  detail?: string;
}

export interface TodoEventPayload {
  todoId: string;
  fingerprint: string;
  kind: string;
  filePath: string;
  text: string;
  previousFilePath?: string;
  action?: string;
}

export interface HealthCompletedPayload {
  healthCheckId: string;
  healthRunId: string;
  status: string;
}

export interface TechnologyObservedPayload {
  technologyId: string;
  fingerprint: string;
  category: string;
  name: string;
  version?: string;
  evidencePath: string;
}

export interface TechnologyRemovedPayload {
  technologyId: string;
  fingerprint: string;
  category: string;
  name: string;
  evidencePath: string;
}
