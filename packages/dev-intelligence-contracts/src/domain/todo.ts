/** Marker kinds commonly observed in source (facts only). */
export type TodoMarkerKind = 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'NOTE' | 'BUG' | string;

export type TodoMarkerStatus = 'open' | 'resolved';

/** Lifecycle classification produced by reconcile (facts only). */
export type TodoLifecycleAction =
  | 'created'
  | 'unchanged'
  | 'moved'
  | 'renamed'
  | 'resolved';

export interface TodoMarker {
  schemaVersion: 1;
  id: string;
  repositoryId: string;
  kind: TodoMarkerKind;
  status: TodoMarkerStatus;
  /** Relative path within the repository root. */
  filePath: string;
  line?: number;
  column?: number;
  text: string;
  /**
   * Deterministic content fingerprint (kind + normalized text).
   * Path/line are mutable attributes so moves/renames keep identity.
   */
  fingerprint: string;
  firstObservedAt: string;
  lastObservedAt: string;
  resolvedAt?: string;
  /** Previous path when last reconcile classified a move/rename. */
  previousFilePath?: string;
}

export interface TodoLifecycleResult {
  action: TodoLifecycleAction;
  marker: TodoMarker;
}
