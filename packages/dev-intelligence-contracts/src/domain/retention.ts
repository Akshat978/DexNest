/**
 * Retention policy hooks for bounded transient data.
 * Durable commits / Standups / transitions are out of scope for aggressive purge.
 */
export interface RetentionPolicy {
  schemaVersion: 1;
  /** Max raw health stdout/stderr bytes retained per run (after capture cap). */
  maxHealthOutputBytes: number;
  /** Max health runs kept per check (oldest pruned). */
  maxHealthRunsPerCheck: number;
  /** Max age (ms) for scan diagnostic blobs; older eligible for purge. */
  maxDiagnosticAgeMs: number;
  /** Max diagnostic rows retained globally. */
  maxDiagnosticRows: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  schemaVersion: 1,
  maxHealthOutputBytes: 64 * 1024,
  maxHealthRunsPerCheck: 50,
  maxDiagnosticAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxDiagnosticRows: 500,
};

export interface ScanDiagnostic {
  schemaVersion: 1;
  id: string;
  scanRunId: string;
  repositoryId?: string;
  kind: string;
  /** Bounded message / preview — never full env dumps or secrets. */
  message: string;
  createdAt: string;
  /** Soft retention hint (ISO); purge may delete after this. */
  retainUntil?: string;
}

export interface RetentionStore {
  getPolicy(): Promise<RetentionPolicy>;
  setPolicy(policy: RetentionPolicy): Promise<void>;
  saveDiagnostic(diag: ScanDiagnostic): Promise<void>;
  listDiagnostics(options?: {
    scanRunId?: string;
    limit?: number;
  }): Promise<ScanDiagnostic[]>;
  /** Apply policy: truncate oversized health output, prune old runs/diagnostics. */
  applyRetention(policy?: RetentionPolicy): Promise<{
    healthRunsDeleted: number;
    diagnosticsDeleted: number;
    healthOutputsTrimmed: number;
  }>;
}
