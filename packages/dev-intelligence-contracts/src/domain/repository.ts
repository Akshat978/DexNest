/**
 * Core repository identity and snapshot domain models.
 * DI owns facts only — no skill/XP/proficiency inference.
 */

/** Execution domain for a repository root (Windows host vs WSL). */
export type RepositoryExecutionDomain = 'windows' | 'wsl';

/**
 * Confidence that remote-tracking refs reflect the actual remote.
 * Core paths do not fetch/pull; remote state is often only as good as the local cache.
 */
export type RemoteTrackingConfidence = 'local_cache' | 'unknown';

export interface RepositoryRoot {
  /** Absolute path in the execution domain's native form. */
  path: string;
  domain: RepositoryExecutionDomain;
}

export interface Repository {
  schemaVersion: 1;
  /** Stable id for this repository identity (content-addressed later; opaque string for now). */
  id: string;
  roots: RepositoryRoot[];
  /** Display name / basename hint; not authoritative identity. */
  displayName?: string;
  discoveredAt: string; // ISO-8601
  lastSeenAt: string; // ISO-8601
}

export interface GitCommit {
  sha: string;
  shortSha?: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail: string;
  authorDate: string; // ISO-8601
  committerName?: string;
  committerEmail?: string;
  committerDate?: string; // ISO-8601
  parents: string[];
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  tipSha?: string;
  /**
   * When upstream is present, how confident we are that remote-tracking
   * tip matches the actual remote (no network fetch in core paths).
   */
  remoteTrackingConfidence?: RemoteTrackingConfidence;
}

export interface WorkingTreeState {
  isClean: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  /** Optional sample of paths; bounded by callers — not a full dump. */
  samplePaths?: string[];
}

export interface GitState {
  schemaVersion: 1;
  headSha?: string;
  headDetached: boolean;
  currentBranch?: string;
  branches: GitBranch[];
  recentCommits: GitCommit[];
  workingTree: WorkingTreeState;
  /** Overall confidence for remote-tracking data on this snapshot. */
  remoteTrackingConfidence: RemoteTrackingConfidence;
  /** True if an interrupted merge/rebase/cherry-pick/etc. was detected. */
  interruptedOperation?: string;
}

export interface RepositorySnapshot {
  schemaVersion: 1;
  id: string;
  repositoryId: string;
  capturedAt: string; // ISO-8601
  root: RepositoryRoot;
  git: GitState;
  /** Optional opaque fingerprint of consequential snapshot content for idempotency. */
  contentFingerprint?: string;
}
