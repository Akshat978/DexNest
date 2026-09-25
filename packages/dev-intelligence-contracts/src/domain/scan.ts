/** Scan-run lifecycle states (ARCHITECTURE.md). */
export type ScanRunLifecycleState =
  | 'STARTED'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export interface ScanRun {
  schemaVersion: 1;
  id: string;
  state: ScanRunLifecycleState;
  startedAt: string;
  finishedAt?: string;
  /** Roots / repo ids targeted; empty means discovery-driven. */
  targetRepositoryIds?: string[];
  repositoriesAttempted: number;
  repositoriesSucceeded: number;
  repositoriesFailed: number;
  /** Opaque checkpoint blob for crash recovery (implementation-defined). */
  checkpoint?: string;
  errorSummary?: string;
  cancelRequested?: boolean;
}
