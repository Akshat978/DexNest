import type {
  Repository,
  RepositorySnapshot,
  RepositoryStore,
} from '@dexnest/dev-intelligence-contracts';
import type { StoreDb } from '../db.ts';

export function createRepositoryStore(db: StoreDb): RepositoryStore {
  function rowToRepo(row: Record<string, unknown>): Repository {
    return {
      schemaVersion: 1,
      id: String(row['id']),
      displayName: row['display_name'] != null ? String(row['display_name']) : undefined,
      discoveredAt: String(row['discovered_at']),
      lastSeenAt: String(row['last_seen_at']),
      roots: JSON.parse(String(row['roots_json'])) as Repository['roots'],
    };
  }

  function rowToSnapshot(row: Record<string, unknown>): RepositorySnapshot {
    return {
      schemaVersion: 1,
      id: String(row['id']),
      repositoryId: String(row['repository_id']),
      capturedAt: String(row['captured_at']),
      root: JSON.parse(String(row['root_json'])) as RepositorySnapshot['root'],
      git: JSON.parse(String(row['git_json'])) as RepositorySnapshot['git'],
      contentFingerprint:
        row['content_fingerprint'] != null
          ? String(row['content_fingerprint'])
          : undefined,
    };
  }

  return {
    async upsertRepository(repo: Repository): Promise<void> {
      const primary = repo.roots[0];
      db.run(
        `INSERT INTO dev_repositories (
          id, schema_version, display_name, discovered_at, last_seen_at,
          roots_json, disabled, canonical_path, domain
        ) VALUES (?, 1, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          last_seen_at = excluded.last_seen_at,
          roots_json = excluded.roots_json,
          canonical_path = excluded.canonical_path,
          domain = excluded.domain`,
        [
          repo.id,
          repo.displayName ?? null,
          repo.discoveredAt,
          repo.lastSeenAt,
          JSON.stringify(repo.roots),
          primary?.path ?? null,
          primary?.domain ?? null,
        ],
      );
    },

    async getRepository(id: string): Promise<Repository | undefined> {
      const row = db.get('SELECT * FROM dev_repositories WHERE id = ?', [id]);
      return row ? rowToRepo(row) : undefined;
    },

    async listRepositories(): Promise<Repository[]> {
      return db
        .all('SELECT * FROM dev_repositories WHERE disabled = 0 ORDER BY last_seen_at DESC')
        .map(rowToRepo);
    },

    async saveSnapshot(snapshot: RepositorySnapshot): Promise<void> {
      db.run(
        `INSERT INTO dev_repository_snapshots (
          id, schema_version, repository_id, captured_at, root_json, git_json, content_fingerprint
        ) VALUES (?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          captured_at = excluded.captured_at,
          root_json = excluded.root_json,
          git_json = excluded.git_json,
          content_fingerprint = excluded.content_fingerprint`,
        [
          snapshot.id,
          snapshot.repositoryId,
          snapshot.capturedAt,
          JSON.stringify(snapshot.root),
          JSON.stringify(snapshot.git),
          snapshot.contentFingerprint ?? null,
        ],
      );
    },

    async getLatestSnapshot(
      repositoryId: string,
    ): Promise<RepositorySnapshot | undefined> {
      const row = db.get(
        `SELECT * FROM dev_repository_snapshots
         WHERE repository_id = ?
         ORDER BY captured_at DESC LIMIT 1`,
        [repositoryId],
      );
      return row ? rowToSnapshot(row) : undefined;
    },

    async getSnapshot(
      snapshotId: string,
    ): Promise<RepositorySnapshot | undefined> {
      const row = db.get('SELECT * FROM dev_repository_snapshots WHERE id = ?', [
        snapshotId,
      ]);
      return row ? rowToSnapshot(row) : undefined;
    },
  };
}
