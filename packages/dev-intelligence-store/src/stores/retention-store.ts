import {
  DEFAULT_RETENTION_POLICY,
  type RetentionPolicy,
  type RetentionStore,
  type ScanDiagnostic,
} from '@dexnest/dev-intelligence-contracts';
import { withTransaction } from '@dexnest/foundation';
import type { StoreDb } from '../db.ts';

export function createRetentionStore(db: StoreDb): RetentionStore {
  function rowToDiag(row: Record<string, unknown>): ScanDiagnostic {
    return {
      schemaVersion: 1,
      id: String(row['id']),
      scanRunId: String(row['scan_run_id']),
      repositoryId:
        row['repository_id'] != null ? String(row['repository_id']) : undefined,
      kind: String(row['kind']),
      message: String(row['message']),
      createdAt: String(row['created_at']),
      retainUntil:
        row['retain_until'] != null ? String(row['retain_until']) : undefined,
    };
  }

  return {
    async getPolicy(): Promise<RetentionPolicy> {
      const row = db.get('SELECT * FROM dev_retention_policy WHERE id = 1');
      if (!row) return { ...DEFAULT_RETENTION_POLICY };
      return {
        schemaVersion: 1,
        maxHealthOutputBytes: Number(row['max_health_output_bytes']),
        maxHealthRunsPerCheck: Number(row['max_health_runs_per_check']),
        maxDiagnosticAgeMs: Number(row['max_diagnostic_age_ms']),
        maxDiagnosticRows: Number(row['max_diagnostic_rows']),
      };
    },

    async setPolicy(policy: RetentionPolicy): Promise<void> {
      db.run(
        `INSERT INTO dev_retention_policy (
          id, schema_version, max_health_output_bytes, max_health_runs_per_check,
          max_diagnostic_age_ms, max_diagnostic_rows, updated_at
        ) VALUES (1, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          max_health_output_bytes = excluded.max_health_output_bytes,
          max_health_runs_per_check = excluded.max_health_runs_per_check,
          max_diagnostic_age_ms = excluded.max_diagnostic_age_ms,
          max_diagnostic_rows = excluded.max_diagnostic_rows,
          updated_at = excluded.updated_at`,
        [
          policy.maxHealthOutputBytes,
          policy.maxHealthRunsPerCheck,
          policy.maxDiagnosticAgeMs,
          policy.maxDiagnosticRows,
          new Date().toISOString(),
        ],
      );
    },

    async saveDiagnostic(diag: ScanDiagnostic): Promise<void> {
      // Bound message length defensively
      const message =
        diag.message.length > 8 * 1024
          ? diag.message.slice(0, 8 * 1024)
          : diag.message;
      db.run(
        `INSERT INTO dev_scan_diagnostics (
          id, schema_version, scan_run_id, repository_id, kind, message, created_at, retain_until
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          message = excluded.message, retain_until = excluded.retain_until`,
        [
          diag.id,
          diag.scanRunId,
          diag.repositoryId ?? null,
          diag.kind,
          message,
          diag.createdAt,
          diag.retainUntil ?? null,
        ],
      );
    },

    async listDiagnostics(options?: {
      scanRunId?: string;
      limit?: number;
    }): Promise<ScanDiagnostic[]> {
      const limit = options?.limit ?? 100;
      if (options?.scanRunId) {
        return db
          .all(
            `SELECT * FROM dev_scan_diagnostics WHERE scan_run_id = ?
             ORDER BY created_at DESC LIMIT ?`,
            [options.scanRunId, limit],
          )
          .map(rowToDiag);
      }
      return db
        .all(
          `SELECT * FROM dev_scan_diagnostics ORDER BY created_at DESC LIMIT ?`,
          [limit],
        )
        .map(rowToDiag);
    },

    async applyRetention(policy?: RetentionPolicy): Promise<{
      healthRunsDeleted: number;
      diagnosticsDeleted: number;
      healthOutputsTrimmed: number;
    }> {
      const p = policy ?? (await this.getPolicy());
      // One transaction: retention either applies completely or not at all.
      // Under sql.js each DELETE committed on its own, so a crash mid-run
      // left some runs pruned and their diagnostics not.
      return withTransaction(db.sql, () => {
        let healthRunsDeleted = 0;
        let diagnosticsDeleted = 0;
        let healthOutputsTrimmed = 0;

        // Trim oversized health output previews
        const fat = db.all<{ id: string; stdout_preview: string | null; stderr_preview: string | null }>(
          `SELECT id, stdout_preview, stderr_preview FROM dev_health_runs`,
        );
        for (const row of fat) {
          let stdout = row.stdout_preview ?? '';
          let stderr = row.stderr_preview ?? '';
          let changed = false;
          if (Buffer.byteLength(stdout, 'utf8') > p.maxHealthOutputBytes) {
            stdout = Buffer.from(stdout, 'utf8')
              .subarray(0, p.maxHealthOutputBytes)
              .toString('utf8');
            changed = true;
          }
          if (Buffer.byteLength(stderr, 'utf8') > p.maxHealthOutputBytes) {
            stderr = Buffer.from(stderr, 'utf8')
              .subarray(0, p.maxHealthOutputBytes)
              .toString('utf8');
            changed = true;
          }
          if (changed) {
            db.run(
              `UPDATE dev_health_runs SET stdout_preview = ?, stderr_preview = ?,
               stdout_bytes_retained = ?, stderr_bytes_retained = ? WHERE id = ?`,
              [
                stdout || null,
                stderr || null,
                Buffer.byteLength(stdout, 'utf8'),
                Buffer.byteLength(stderr, 'utf8'),
                row.id,
              ],
            );
            healthOutputsTrimmed += 1;
          }
        }

        // Prune health runs per check
        const checks = db.all<{ id: string }>(`SELECT id FROM dev_health_checks`);
        for (const c of checks) {
          const rows = db.all<{ id: string }>(
            `SELECT id FROM dev_health_runs WHERE health_check_id = ?
             ORDER BY started_at DESC`,
            [c.id],
          );
          if (rows.length > p.maxHealthRunsPerCheck) {
            for (const doomed of rows.slice(p.maxHealthRunsPerCheck)) {
              db.run('DELETE FROM dev_health_runs WHERE id = ?', [doomed.id]);
              healthRunsDeleted += 1;
            }
          }
        }

        // Age-based diagnostic purge
        const cutoff = new Date(Date.now() - p.maxDiagnosticAgeMs).toISOString();
        const aged = db.all<{ id: string }>(
          `SELECT id FROM dev_scan_diagnostics
           WHERE created_at < ? OR (retain_until IS NOT NULL AND retain_until < ?)`,
          [cutoff, new Date().toISOString()],
        );
        for (const d of aged) {
          db.run('DELETE FROM dev_scan_diagnostics WHERE id = ?', [d.id]);
          diagnosticsDeleted += 1;
        }

        // Row-count cap
        const allDiags = db.all<{ id: string }>(
          `SELECT id FROM dev_scan_diagnostics ORDER BY created_at DESC`,
        );
        if (allDiags.length > p.maxDiagnosticRows) {
          for (const d of allDiags.slice(p.maxDiagnosticRows)) {
            db.run('DELETE FROM dev_scan_diagnostics WHERE id = ?', [d.id]);
            diagnosticsDeleted += 1;
          }
        }

        return { healthRunsDeleted, diagnosticsDeleted, healthOutputsTrimmed };
      });
    },
  };
}
