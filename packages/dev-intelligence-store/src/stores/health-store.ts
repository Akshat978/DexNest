import type { HealthCheck, HealthRun, HealthStore } from '@dexnest/dev-intelligence-contracts';
import { withTransaction } from '@dexnest/foundation';
import type { StoreDb } from '../db.ts';

export function createHealthStore(db: StoreDb): HealthStore {
  function rowToCheck(row: Record<string, unknown>): HealthCheck {
    return {
      schemaVersion: 1,
      id: String(row['id']),
      repositoryId: String(row['repository_id']),
      name: String(row['name']),
      enabled: Boolean(row['enabled']),
      cwd: String(row['cwd']),
      domain: String(row['domain']) as HealthCheck['domain'],
      argv: JSON.parse(String(row['argv_json'])) as string[],
      timeoutMs: Number(row['timeout_ms']),
      maxStdoutBytes: Number(row['max_stdout_bytes']),
      maxStderrBytes: Number(row['max_stderr_bytes']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    };
  }

  function rowToRun(row: Record<string, unknown>): HealthRun {
    return {
      schemaVersion: 1,
      id: String(row['id']),
      healthCheckId: String(row['health_check_id']),
      repositoryId: String(row['repository_id']),
      status: String(row['status']) as HealthRun['status'],
      startedAt: String(row['started_at']),
      finishedAt:
        row['finished_at'] != null ? String(row['finished_at']) : undefined,
      exitCode: row['exit_code'] != null ? Number(row['exit_code']) : undefined,
      stdoutPreview:
        row['stdout_preview'] != null ? String(row['stdout_preview']) : undefined,
      stderrPreview:
        row['stderr_preview'] != null ? String(row['stderr_preview']) : undefined,
      timedOut: row['timed_out'] != null ? Boolean(row['timed_out']) : undefined,
      errorMessage:
        row['error_message'] != null ? String(row['error_message']) : undefined,
      stdoutBytesRetained:
        row['stdout_bytes_retained'] != null
          ? Number(row['stdout_bytes_retained'])
          : undefined,
      stderrBytesRetained:
        row['stderr_bytes_retained'] != null
          ? Number(row['stderr_bytes_retained'])
          : undefined,
    };
  }

  return {
    async upsertCheck(check: HealthCheck): Promise<void> {
      db.run(
        `INSERT INTO dev_health_checks (
          id, schema_version, repository_id, name, enabled, cwd, domain, argv_json,
          timeout_ms, max_stdout_bytes, max_stderr_bytes, created_at, updated_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, enabled = excluded.enabled, cwd = excluded.cwd,
          domain = excluded.domain, argv_json = excluded.argv_json,
          timeout_ms = excluded.timeout_ms, max_stdout_bytes = excluded.max_stdout_bytes,
          max_stderr_bytes = excluded.max_stderr_bytes, updated_at = excluded.updated_at`,
        [
          check.id,
          check.repositoryId,
          check.name,
          check.enabled ? 1 : 0,
          check.cwd,
          check.domain,
          JSON.stringify(check.argv),
          check.timeoutMs,
          check.maxStdoutBytes,
          check.maxStderrBytes,
          check.createdAt,
          check.updatedAt,
        ],
      );
    },
    async getCheck(id: string): Promise<HealthCheck | undefined> {
      const row = db.get('SELECT * FROM dev_health_checks WHERE id = ?', [id]);
      return row ? rowToCheck(row) : undefined;
    },
    async listChecks(repositoryId: string): Promise<HealthCheck[]> {
      return db
        .all(
          'SELECT * FROM dev_health_checks WHERE repository_id = ? ORDER BY name',
          [repositoryId],
        )
        .map(rowToCheck);
    },
    async listEnabledChecks(repositoryId: string): Promise<HealthCheck[]> {
      return db
        .all(
          'SELECT * FROM dev_health_checks WHERE repository_id = ? AND enabled = 1 ORDER BY name',
          [repositoryId],
        )
        .map(rowToCheck);
    },
    async saveRun(run: HealthRun): Promise<void> {
      db.run(
        `INSERT INTO dev_health_runs (
          id, schema_version, health_check_id, repository_id, status, started_at,
          finished_at, exit_code, stdout_preview, stderr_preview, timed_out, error_message,
          stdout_bytes_retained, stderr_bytes_retained
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status, finished_at = excluded.finished_at,
          exit_code = excluded.exit_code, stdout_preview = excluded.stdout_preview,
          stderr_preview = excluded.stderr_preview, timed_out = excluded.timed_out,
          error_message = excluded.error_message,
          stdout_bytes_retained = excluded.stdout_bytes_retained,
          stderr_bytes_retained = excluded.stderr_bytes_retained`,
        [
          run.id,
          run.healthCheckId,
          run.repositoryId,
          run.status,
          run.startedAt,
          run.finishedAt ?? null,
          run.exitCode ?? null,
          run.stdoutPreview ?? null,
          run.stderrPreview ?? null,
          run.timedOut == null ? null : run.timedOut ? 1 : 0,
          run.errorMessage ?? null,
          run.stdoutBytesRetained ?? null,
          run.stderrBytesRetained ?? null,
        ],
      );
    },
    async getRun(id: string): Promise<HealthRun | undefined> {
      const row = db.get('SELECT * FROM dev_health_runs WHERE id = ?', [id]);
      return row ? rowToRun(row) : undefined;
    },
    async listRuns(
      healthCheckId: string,
      options?: { limit?: number },
    ): Promise<HealthRun[]> {
      const limit = options?.limit ?? 50;
      return db
        .all(
          `SELECT * FROM dev_health_runs WHERE health_check_id = ?
           ORDER BY started_at DESC LIMIT ?`,
          [healthCheckId, limit],
        )
        .map(rowToRun);
    },
    async pruneRuns(healthCheckId: string, keepLimit: number): Promise<number> {
      const rows = db.all<{ id: string }>(
        `SELECT id FROM dev_health_runs WHERE health_check_id = ?
         ORDER BY started_at DESC`,
        [healthCheckId],
      );
      if (rows.length <= keepLimit) return 0;
      const toDelete = rows.slice(keepLimit).map((r) => r.id);
      withTransaction(db.sql, () => {
        for (const id of toDelete) {
          db.run('DELETE FROM dev_health_runs WHERE id = ?', [id]);
        }
      });
      return toDelete.length;
    },
  };
}
