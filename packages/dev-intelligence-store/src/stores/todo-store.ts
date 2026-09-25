import type { TodoMarker, TodoStore } from '@dexnest/dev-intelligence-contracts';
import type { StoreDb } from '../db.ts';

export function createTodoStore(db: StoreDb): TodoStore {
  function rowToTodo(row: Record<string, unknown>): TodoMarker {
    return {
      schemaVersion: 1,
      id: String(row['id']),
      repositoryId: String(row['repository_id']),
      kind: String(row['kind']),
      status: String(row['status']) as TodoMarker['status'],
      filePath: String(row['file_path']),
      line: row['line'] != null ? Number(row['line']) : undefined,
      column: row['column_pos'] != null ? Number(row['column_pos']) : undefined,
      text: String(row['text']),
      fingerprint: String(row['fingerprint']),
      firstObservedAt: String(row['first_observed_at']),
      lastObservedAt: String(row['last_observed_at']),
      resolvedAt:
        row['resolved_at'] != null ? String(row['resolved_at']) : undefined,
      previousFilePath:
        row['previous_file_path'] != null
          ? String(row['previous_file_path'])
          : undefined,
    };
  }

  return {
    async upsert(marker: TodoMarker): Promise<void> {
      db.run(
        `INSERT INTO dev_todos (
          id, schema_version, repository_id, kind, status, file_path, line, column_pos,
          text, fingerprint, first_observed_at, last_observed_at, resolved_at, previous_file_path
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repository_id, fingerprint) DO UPDATE SET
          status = excluded.status,
          file_path = excluded.file_path,
          line = excluded.line,
          column_pos = excluded.column_pos,
          text = excluded.text,
          last_observed_at = excluded.last_observed_at,
          resolved_at = excluded.resolved_at,
          previous_file_path = excluded.previous_file_path`,
        [
          marker.id,
          marker.repositoryId,
          marker.kind,
          marker.status,
          marker.filePath,
          marker.line ?? null,
          marker.column ?? null,
          marker.text,
          marker.fingerprint,
          marker.firstObservedAt,
          marker.lastObservedAt,
          marker.resolvedAt ?? null,
          marker.previousFilePath ?? null,
        ],
      );
    },
    async get(id: string): Promise<TodoMarker | undefined> {
      const row = db.get('SELECT * FROM dev_todos WHERE id = ?', [id]);
      return row ? rowToTodo(row) : undefined;
    },
    async findByFingerprint(
      repositoryId: string,
      fingerprint: string,
    ): Promise<TodoMarker | undefined> {
      const row = db.get(
        'SELECT * FROM dev_todos WHERE repository_id = ? AND fingerprint = ?',
        [repositoryId, fingerprint],
      );
      return row ? rowToTodo(row) : undefined;
    },
    async listByRepository(
      repositoryId: string,
      options?: { status?: string },
    ): Promise<TodoMarker[]> {
      if (options?.status) {
        return db
          .all(
            'SELECT * FROM dev_todos WHERE repository_id = ? AND status = ? ORDER BY file_path, line',
            [repositoryId, options.status],
          )
          .map(rowToTodo);
      }
      return db
        .all(
          'SELECT * FROM dev_todos WHERE repository_id = ? ORDER BY file_path, line',
          [repositoryId],
        )
        .map(rowToTodo);
    },
  };
}
