import type { ScanRun, ScanRunStore } from '@dexnest/dev-intelligence-contracts';
import type { StoreDb } from '../db.ts';

export function createScanRunStore(db: StoreDb): ScanRunStore {
  function rowToRun(row: Record<string, unknown>): ScanRun {
    const targets =
      row['target_repository_ids_json'] != null
        ? (JSON.parse(String(row['target_repository_ids_json'])) as string[])
        : undefined;
    return {
      schemaVersion: 1,
      id: String(row['id']),
      state: String(row['state']) as ScanRun['state'],
      startedAt: String(row['started_at']),
      finishedAt:
        row['finished_at'] != null ? String(row['finished_at']) : undefined,
      targetRepositoryIds: targets,
      repositoriesAttempted: Number(row['repositories_attempted'] ?? 0),
      repositoriesSucceeded: Number(row['repositories_succeeded'] ?? 0),
      repositoriesFailed: Number(row['repositories_failed'] ?? 0),
      checkpoint: row['checkpoint'] != null ? String(row['checkpoint']) : undefined,
      errorSummary:
        row['error_summary'] != null ? String(row['error_summary']) : undefined,
      cancelRequested: Boolean(row['cancel_requested']),
    };
  }

  return {
    async create(run: ScanRun): Promise<void> {
      db.run(
        `INSERT INTO dev_scan_runs (
          id, schema_version, state, started_at, finished_at,
          target_repository_ids_json, repositories_attempted, repositories_succeeded,
          repositories_failed, checkpoint, error_summary, cancel_requested
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          run.id,
          run.state,
          run.startedAt,
          run.finishedAt ?? null,
          run.targetRepositoryIds
            ? JSON.stringify(run.targetRepositoryIds)
            : null,
          run.repositoriesAttempted,
          run.repositoriesSucceeded,
          run.repositoriesFailed,
          run.checkpoint ?? null,
          run.errorSummary ?? null,
          run.cancelRequested ? 1 : 0,
        ],
      );
    },
    async update(run: ScanRun): Promise<void> {
      db.run(
        `UPDATE dev_scan_runs SET
          state = ?, finished_at = ?, target_repository_ids_json = ?,
          repositories_attempted = ?, repositories_succeeded = ?,
          repositories_failed = ?, checkpoint = ?, error_summary = ?,
          cancel_requested = ?
         WHERE id = ?`,
        [
          run.state,
          run.finishedAt ?? null,
          run.targetRepositoryIds
            ? JSON.stringify(run.targetRepositoryIds)
            : null,
          run.repositoriesAttempted,
          run.repositoriesSucceeded,
          run.repositoriesFailed,
          run.checkpoint ?? null,
          run.errorSummary ?? null,
          run.cancelRequested ? 1 : 0,
          run.id,
        ],
      );
    },
    async get(id: string): Promise<ScanRun | undefined> {
      const row = db.get('SELECT * FROM dev_scan_runs WHERE id = ?', [id]);
      return row ? rowToRun(row) : undefined;
    },
    async listRecent(limit = 50): Promise<ScanRun[]> {
      return db
        .all('SELECT * FROM dev_scan_runs ORDER BY started_at DESC LIMIT ?', [limit])
        .map(rowToRun);
    },
    async listIncomplete(): Promise<ScanRun[]> {
      return db
        .all(`SELECT * FROM dev_scan_runs WHERE state = 'STARTED' ORDER BY started_at ASC`)
        .map(rowToRun);
    },
  };
}
