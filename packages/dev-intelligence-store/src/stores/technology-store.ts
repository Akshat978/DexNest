import type { TechnologyFact, TechnologyStore } from '@dexnest/dev-intelligence-contracts';
import type { StoreDb } from '../db.ts';

export function createTechnologyStore(db: StoreDb): TechnologyStore {
  function rowToFact(row: Record<string, unknown>): TechnologyFact {
    const observedAt = String(row['observed_at']);
    const first =
      row['first_observed_at'] != null
        ? String(row['first_observed_at'])
        : observedAt;
    const last =
      row['last_observed_at'] != null
        ? String(row['last_observed_at'])
        : observedAt;
    return {
      schemaVersion: 1,
      id: String(row['id']),
      repositoryId: String(row['repository_id']),
      category: String(row['category']),
      name: String(row['name']),
      version: row['version'] != null ? String(row['version']) : undefined,
      evidencePath: String(row['evidence_path']),
      evidenceKind: String(row['evidence_kind']),
      fingerprint: String(row['fingerprint']),
      status: (row['status'] != null
        ? String(row['status'])
        : 'observed') as TechnologyFact['status'],
      firstObservedAt: first,
      lastObservedAt: last,
      removedAt:
        row['removed_at'] != null ? String(row['removed_at']) : undefined,
      observedAt: last,
    };
  }

  return {
    async upsert(fact: TechnologyFact): Promise<void> {
      db.run(
        `INSERT INTO dev_technologies (
          id, schema_version, repository_id, category, name, version,
          evidence_path, evidence_kind, fingerprint, observed_at,
          status, first_observed_at, last_observed_at, removed_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repository_id, fingerprint) DO UPDATE SET
          category = excluded.category, name = excluded.name, version = excluded.version,
          evidence_path = excluded.evidence_path, evidence_kind = excluded.evidence_kind,
          observed_at = excluded.observed_at,
          status = excluded.status,
          last_observed_at = excluded.last_observed_at,
          removed_at = excluded.removed_at,
          first_observed_at = COALESCE(dev_technologies.first_observed_at, excluded.first_observed_at)`,
        [
          fact.id,
          fact.repositoryId,
          fact.category,
          fact.name,
          fact.version ?? null,
          fact.evidencePath,
          fact.evidenceKind,
          fact.fingerprint,
          fact.lastObservedAt || fact.observedAt,
          fact.status,
          fact.firstObservedAt || fact.observedAt,
          fact.lastObservedAt || fact.observedAt,
          fact.removedAt ?? null,
        ],
      );
    },
    async get(id: string): Promise<TechnologyFact | undefined> {
      const row = db.get('SELECT * FROM dev_technologies WHERE id = ?', [id]);
      return row ? rowToFact(row) : undefined;
    },
    async findByFingerprint(
      repositoryId: string,
      fingerprint: string,
    ): Promise<TechnologyFact | undefined> {
      const row = db.get(
        'SELECT * FROM dev_technologies WHERE repository_id = ? AND fingerprint = ?',
        [repositoryId, fingerprint],
      );
      return row ? rowToFact(row) : undefined;
    },
    async listByRepository(
      repositoryId: string,
      options?: { status?: string },
    ): Promise<TechnologyFact[]> {
      if (options?.status) {
        return db
          .all(
            'SELECT * FROM dev_technologies WHERE repository_id = ? AND status = ? ORDER BY category, name',
            [repositoryId, options.status],
          )
          .map(rowToFact);
      }
      return db
        .all(
          'SELECT * FROM dev_technologies WHERE repository_id = ? ORDER BY category, name',
          [repositoryId],
        )
        .map(rowToFact);
    },
    async markRemoved(
      repositoryId: string,
      fingerprint: string,
      removedAt: string,
    ): Promise<TechnologyFact | undefined> {
      db.run(
        `UPDATE dev_technologies SET status = 'removed', removed_at = ?, last_observed_at = last_observed_at
         WHERE repository_id = ? AND fingerprint = ? AND status != 'removed'`,
        [removedAt, repositoryId, fingerprint],
      );
      return this.findByFingerprint(repositoryId, fingerprint);
    },
  };
}
