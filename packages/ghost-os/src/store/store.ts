/**
 * GhostOS persistence on the shared SqlDatabase.
 *
 * What holds everything up:
 * - Every row is validated by the domain before it is written; an invalid
 *   row throws and nothing is written.
 * - A derived row is written together with what it was derived from, in one
 *   transaction; without parents it is refused.
 * - A source fact the owner forgot (a tombstone) is not written again.
 * - Forget and withdraw execute a plan from domain/cascade.ts in one
 *   transaction: relations, observations, derived rows, tags, the search
 *   index (by trigger) and derivation links all go, or none do.
 * - An import is one transaction: all of it lands, or none.
 */

import { ModuleMigrationError, runModuleMigrations, withTransaction, type SqlDatabase } from '@dexnest/foundation';
import { planCascade, type CascadePlan, type CascadeReader } from '../domain/cascade.ts';
import { EXPORT_FORMAT, EXPORT_VERSION, type GhostExport, type ParsedImport } from '../domain/export.ts';
import type { RowCounts } from '../domain/events.ts';
import { toFtsQuery, searchTerms, toLikePattern, SEARCH_LIMITS, type TimelineQuery } from '../domain/search.ts';
import { ADAPTER_IDS, defaultGhostOsSettings, normalizeGhostOsSettings, type AdapterId, type GhostOsSettings } from '../domain/settings.ts';
import type { Derivation, Entity, EntityType, Evidence, Observation, Origin, Relation, RowKind, RowRef, Tombstone } from '../domain/types.ts';
import { validateEntity, validateObservation, validateRelation, type Parsed } from '../domain/validation.ts';
import { GHOST_OS_MIGRATIONS, GHOST_OS_SEARCH_LEDGER, GHOST_OS_SEARCH_MIGRATIONS } from './migrations.ts';

export const GHOST_MIGRATION_MODULE = 'ghost_os';

export type PutStatus = 'created' | 'updated' | 'unchanged' | 'forgotten';

export interface PutOptions {
  /** Required for a derived row: what it came from. Replaces any earlier links. */
  derivedFrom?: readonly RowRef[];
}

export interface SearchHit {
  id: string;
  type: EntityType;
  title: string;
  timelineAt: string;
  origin: Origin;
}

export interface TimelineItem {
  kind: 'entity' | 'observation';
  id: string;
  at: string;
  entityId: string;
  entityType: EntityType;
  title: string;
  statement: string | null;
  origin: Origin;
  confidence: number;
}

export interface AdapterState {
  id: AdapterId;
  enabled: boolean;
  cursor: string | null;
  lastSyncAt: string | null;
  counts: RowCounts;
}

export type RunKind = 'sync';
export type RunTrigger = 'scheduled' | 'startup' | 'manual';
export type RunStatus = 'running' | 'completed' | 'skipped' | 'failed';

export interface RunRecord {
  id: string;
  occurrenceId: string;
  kind: RunKind;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface ImportResult {
  added: RowCounts;
  skippedExisting: RowCounts;
  skippedForgotten: RowCounts;
  derivations: number;
  tombstones: number;
}

export class GhostStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhostStoreError';
  }
}

export interface GhostStore {
  readonly searchMode: 'fts' | 'like';

  getEntity(id: string): Entity | undefined;
  findBySource(kind: RowKind, sourceId: string, sourceRef: string): string | undefined;
  putEntity(entity: Entity, options?: PutOptions): PutStatus;
  listEntities(options?: { type?: EntityType; limit?: number; offset?: number }): Entity[];

  getRelation(id: string): Relation | undefined;
  putRelation(relation: Relation, options?: PutOptions): PutStatus;
  relationsOf(entityId: string): Relation[];

  getObservation(id: string): Observation | undefined;
  putObservation(observation: Observation, options?: PutOptions): PutStatus;
  observationsOf(entityId: string, limit?: number): Observation[];
  /** Observations from one source, oldest first. */
  observationsFromSource(sourceId: string): Observation[];

  derivationsOf(child: RowRef): RowRef[];
  isForgotten(sourceId: string, sourceRef: string): boolean;
  listTombstones(): Tombstone[];

  /** Plans and executes a forget in one transaction. `alsoInTransaction` commits with it. */
  forget(target: RowRef, now: string, alsoInTransaction?: (plan: CascadePlan) => void): CascadePlan;
  /** Removes every row one source contributed and everything derived from it. No tombstones. */
  withdrawSource(sourceId: string, alsoInTransaction?: (plan: CascadePlan) => void): CascadePlan;
  /** Removes rows and what depends on them without tombstones: the source no longer says so. */
  removeRows(roots: readonly RowRef[]): CascadePlan;
  /** Ids of the rows one source contributed. */
  sourceRowIds(kind: RowKind, sourceId: string): string[];

  search(text: string, options?: { types?: readonly EntityType[]; limit?: number }): SearchHit[];
  timeline(query: TimelineQuery): TimelineItem[];
  counts(): RowCounts;

  getSettings(): GhostOsSettings;
  saveSettings(settings: GhostOsSettings, now: string): GhostOsSettings;
  getAdapter(id: AdapterId): AdapterState;
  setAdapterEnabled(id: AdapterId, enabled: boolean, now: string): AdapterState;
  recordAdapterSync(id: AdapterId, cursor: string | null, counts: RowCounts, now: string): AdapterState;
  /** Off, and back to the start: the next time it is turned on it reads from the beginning. */
  resetAdapter(id: AdapterId, now: string): AdapterState;

  /** Claims an occurrence. Null when it was already claimed: the caller does nothing. */
  claimRun(input: { id: string; occurrenceId: string; kind: RunKind; trigger: RunTrigger; now: string }): RunRecord | null;
  finishRun(id: string, status: Exclude<RunStatus, 'running'>, now: string, summary: Record<string, unknown>, error?: string | null): RunRecord;
  getRunByOccurrence(occurrenceId: string): RunRecord | undefined;
  listRuns(limit?: number): RunRecord[];
  /** Runs left 'running' by a crash become 'failed'. Returns how many. */
  recoverInterruptedRuns(now: string): number;

  exportAll(now: string): GhostExport;
  importAll(parsed: ParsedImport, alsoInTransaction?: (result: ImportResult) => void): ImportResult;

  /** Runs `work` in one transaction (for callers that combine writes with their events). */
  transaction<T>(work: () => T): T;
}

// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const zero = (): RowCounts => ({ entity: 0, relation: 0, observation: 0 });
const TABLE: Record<RowKind, string> = { entity: 'ghost_entities', relation: 'ghost_relations', observation: 'ghost_observations' };

function orThrow<T>(parsed: Parsed<T>, what: string): T {
  if (!parsed.ok) throw new GhostStoreError(`${what} refused: ${parsed.errors.join('; ')}`);
  return parsed.value;
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function provenanceOf(row: Row) {
  return {
    origin: row.origin as Origin,
    sourceId: str(row.source_id),
    sourceRef: str(row.source_ref),
    evidence: JSON.parse(String(row.evidence_json)) as Evidence[],
    confidence: Number(row.confidence),
  };
}

function toEntity(row: Row, tags: string[]): Entity {
  return {
    id: String(row.id),
    type: row.type as EntityType,
    title: String(row.title),
    notes: String(row.notes),
    tags,
    details: JSON.parse(String(row.details_json)) as Entity['details'],
    occurredAt: str(row.occurred_at),
    startedAt: str(row.started_at),
    endedAt: str(row.ended_at),
    provenance: provenanceOf(row),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toRelation(row: Row): Relation {
  return {
    id: String(row.id),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    type: String(row.type),
    strength: Number(row.strength),
    validFrom: str(row.valid_from),
    validTo: str(row.valid_to),
    notes: String(row.notes),
    provenance: provenanceOf(row),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toObservation(row: Row): Observation {
  return {
    id: String(row.id),
    entityId: String(row.entity_id),
    statement: String(row.statement),
    observedAt: String(row.observed_at),
    provenance: provenanceOf(row),
    createdAt: String(row.created_at),
  };
}

function toRun(row: Row): RunRecord {
  return {
    id: String(row.id),
    occurrenceId: String(row.occurrence_id),
    kind: row.kind as RunKind,
    trigger: row.trigger as RunTrigger,
    status: row.status as RunStatus,
    startedAt: String(row.started_at),
    finishedAt: str(row.finished_at),
    summary: JSON.parse(String(row.summary_json)) as Record<string, unknown>,
    error: str(row.error),
  };
}

const timelineAt = (e: Entity) => e.occurredAt ?? e.startedAt ?? e.createdAt;

export interface OpenGhostStoreOptions {
  now?: string;
  /** 'auto' tries FTS5 and falls back to LIKE; 'off' never creates the index. */
  search?: 'auto' | 'off';
}

export function openGhostStore(db: SqlDatabase, options: OpenGhostStoreOptions = {}): GhostStore {
  const now = options.now ?? new Date().toISOString();
  runModuleMigrations(db, GHOST_MIGRATION_MODULE, GHOST_OS_MIGRATIONS, now);
  if (options.search !== 'off') {
    try {
      runModuleMigrations(db, GHOST_OS_SEARCH_LEDGER, GHOST_OS_SEARCH_MIGRATIONS, now);
    } catch (error) {
      // No FTS5 in this SQLite build: the core stands, search uses LIKE.
      if (!(error instanceof ModuleMigrationError)) throw error;
    }
  }
  const searchMode: 'fts' | 'like' = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'ghost_search'").get<{ ok: number }>() ? 'fts' : 'like';

  const one = <T = Row>(sql: string, params: readonly unknown[] = []) => db.prepare(sql).get<T>(params);
  const all = <T = Row>(sql: string, params: readonly unknown[] = []) => db.prepare(sql).all<T>(params);
  const run = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).run(params);

  const tagsOf = (id: string) => all<{ tag: string }>('SELECT tag FROM ghost_tags WHERE entity_id = ? ORDER BY tag', [id]).map((r) => r.tag);
  const exists = (ref: RowRef) => one(`SELECT 1 AS ok FROM ${TABLE[ref.kind]} WHERE id = ?`, [ref.id]) !== undefined;

  const isForgotten = (sourceId: string, sourceRef: string) =>
    one('SELECT 1 AS ok FROM ghost_tombstones WHERE source_id = ? AND source_ref = ?', [sourceId, sourceRef]) !== undefined;

  /** Shared checks for every put: tombstones, a stable identity, and parents for derived rows. */
  function prepareWrite(kind: RowKind, row: { id: string; provenance: Entity['provenance'] }, options: PutOptions | undefined): { existing: Row | undefined; forgotten: boolean } {
    const { origin, sourceId, sourceRef } = row.provenance;
    if (sourceId && sourceRef && isForgotten(sourceId, sourceRef)) return { existing: undefined, forgotten: true };
    const existing = one(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`, [row.id]);
    if (existing && (existing.origin !== origin || str(existing.source_id) !== sourceId || str(existing.source_ref) !== sourceRef)) {
      throw new GhostStoreError(`${kind} ${row.id} already exists with a different source`);
    }
    if (!existing && sourceId && sourceRef) {
      const clash = one(`SELECT id FROM ${TABLE[kind]} WHERE source_id = ? AND source_ref = ?`, [sourceId, sourceRef]);
      if (clash) throw new GhostStoreError(`${kind} ${row.id}: that source fact is already ${String(clash.id)}`);
    }
    const parents = options?.derivedFrom ?? [];
    if (origin === 'derived') {
      if (parents.length === 0) throw new GhostStoreError(`derived ${kind} ${row.id} needs what it was derived from`);
      for (const p of parents) if (!exists(p)) throw new GhostStoreError(`derived ${kind} ${row.id}: parent ${p.kind} ${p.id} does not exist`);
    } else if (parents.length > 0) {
      throw new GhostStoreError(`only a derived row lists parents`);
    }
    return { existing, forgotten: false };
  }

  function writeDerivations(child: RowRef, parents: readonly RowRef[] | undefined) {
    if (!parents) return;
    run('DELETE FROM ghost_derivations WHERE child_kind = ? AND child_id = ?', [child.kind, child.id]);
    for (const p of parents) run('INSERT OR IGNORE INTO ghost_derivations (child_kind, child_id, parent_kind, parent_id) VALUES (?, ?, ?, ?)', [child.kind, child.id, p.kind, p.id]);
  }

  const provParams = (p: Entity['provenance']) => [p.origin, p.sourceId, p.sourceRef, JSON.stringify(p.evidence), p.confidence];

  function insertEntity(e: Entity) {
    run(
      `INSERT INTO ghost_entities (id, fts_rowid, type, title, notes, tags_text, details_json, occurred_at, started_at, ended_at, timeline_at,
         origin, source_id, source_ref, evidence_json, confidence, created_at, updated_at)
       VALUES (?, (SELECT coalesce(max(fts_rowid), 0) + 1 FROM ghost_entities), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.type, e.title, e.notes, e.tags.join(' '), JSON.stringify(e.details), e.occurredAt, e.startedAt, e.endedAt, timelineAt(e), ...provParams(e.provenance), e.createdAt, e.updatedAt],
    );
    for (const tag of e.tags) run('INSERT INTO ghost_tags (entity_id, tag) VALUES (?, ?)', [e.id, tag]);
  }

  function insertRelation(r: Relation) {
    run(
      `INSERT INTO ghost_relations (id, from_id, to_id, type, strength, valid_from, valid_to, notes, origin, source_id, source_ref, evidence_json, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.fromId, r.toId, r.type, r.strength, r.validFrom, r.validTo, r.notes, ...provParams(r.provenance), r.createdAt, r.updatedAt],
    );
  }

  function insertObservation(o: Observation) {
    run(
      `INSERT INTO ghost_observations (id, entity_id, statement, observed_at, origin, source_id, source_ref, evidence_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.id, o.entityId, o.statement, o.observedAt, ...provParams(o.provenance), o.createdAt],
    );
  }

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  function putEntity(input: Entity, options?: PutOptions): PutStatus {
    const e = orThrow(validateEntity(input), 'entity');
    return withTransaction(db, () => {
      const { existing, forgotten } = prepareWrite('entity', e, options);
      if (forgotten) return 'forgotten';
      if (!existing) {
        insertEntity(e);
        writeDerivations({ kind: 'entity', id: e.id }, options?.derivedFrom);
        return 'created';
      }
      const before = toEntity(existing, tagsOf(e.id));
      const next: Entity = { ...e, createdAt: before.createdAt };
      if (same({ ...before, updatedAt: '' }, { ...next, updatedAt: '' })) {
        writeDerivations({ kind: 'entity', id: e.id }, options?.derivedFrom);
        return 'unchanged';
      }
      run(
        `UPDATE ghost_entities SET type = ?, title = ?, notes = ?, tags_text = ?, details_json = ?, occurred_at = ?, started_at = ?, ended_at = ?, timeline_at = ?,
           evidence_json = ?, confidence = ?, updated_at = ? WHERE id = ?`,
        [next.type, next.title, next.notes, next.tags.join(' '), JSON.stringify(next.details), next.occurredAt, next.startedAt, next.endedAt, timelineAt(next), JSON.stringify(next.provenance.evidence), next.provenance.confidence, next.updatedAt, next.id],
      );
      run('DELETE FROM ghost_tags WHERE entity_id = ?', [e.id]);
      for (const tag of next.tags) run('INSERT INTO ghost_tags (entity_id, tag) VALUES (?, ?)', [e.id, tag]);
      writeDerivations({ kind: 'entity', id: e.id }, options?.derivedFrom);
      return 'updated';
    });
  }

  function putRelation(input: Relation, options?: PutOptions): PutStatus {
    const r = orThrow(validateRelation(input), 'relation');
    return withTransaction(db, () => {
      const { existing, forgotten } = prepareWrite('relation', r, options);
      if (forgotten) return 'forgotten';
      if (!exists({ kind: 'entity', id: r.fromId }) || !exists({ kind: 'entity', id: r.toId })) throw new GhostStoreError(`relation ${r.id}: both entities must exist`);
      if (!existing) {
        insertRelation(r);
        writeDerivations({ kind: 'relation', id: r.id }, options?.derivedFrom);
        return 'created';
      }
      const before = toRelation(existing);
      const next: Relation = { ...r, createdAt: before.createdAt };
      if (same({ ...before, updatedAt: '' }, { ...next, updatedAt: '' })) {
        writeDerivations({ kind: 'relation', id: r.id }, options?.derivedFrom);
        return 'unchanged';
      }
      run(
        `UPDATE ghost_relations SET from_id = ?, to_id = ?, type = ?, strength = ?, valid_from = ?, valid_to = ?, notes = ?, evidence_json = ?, confidence = ?, updated_at = ? WHERE id = ?`,
        [next.fromId, next.toId, next.type, next.strength, next.validFrom, next.validTo, next.notes, JSON.stringify(next.provenance.evidence), next.provenance.confidence, next.updatedAt, next.id],
      );
      writeDerivations({ kind: 'relation', id: r.id }, options?.derivedFrom);
      return 'updated';
    });
  }

  function putObservation(input: Observation, options?: PutOptions): PutStatus {
    const o = orThrow(validateObservation(input), 'observation');
    return withTransaction(db, () => {
      const { existing, forgotten } = prepareWrite('observation', o, options);
      if (forgotten) return 'forgotten';
      if (!exists({ kind: 'entity', id: o.entityId })) throw new GhostStoreError(`observation ${o.id}: entity ${o.entityId} does not exist`);
      if (!existing) {
        insertObservation(o);
        writeDerivations({ kind: 'observation', id: o.id }, options?.derivedFrom);
        return 'created';
      }
      const before = toObservation(existing);
      const next: Observation = { ...o, createdAt: before.createdAt };
      if (same(before, next)) {
        writeDerivations({ kind: 'observation', id: o.id }, options?.derivedFrom);
        return 'unchanged';
      }
      run('UPDATE ghost_observations SET entity_id = ?, statement = ?, observed_at = ?, evidence_json = ?, confidence = ? WHERE id = ?', [
        next.entityId,
        next.statement,
        next.observedAt,
        JSON.stringify(next.provenance.evidence),
        next.provenance.confidence,
        next.id,
      ]);
      writeDerivations({ kind: 'observation', id: o.id }, options?.derivedFrom);
      return 'updated';
    });
  }

  // --- cascade -------------------------------------------------------------

  const cascadeReader: CascadeReader = {
    info(ref) {
      const row = one(`SELECT origin, source_id, source_ref FROM ${TABLE[ref.kind]} WHERE id = ?`, [ref.id]);
      return row ? { origin: row.origin as Origin, sourceId: str(row.source_id), sourceRef: str(row.source_ref) } : null;
    },
    relationsTouching: (entityId) => all<{ id: string }>('SELECT id FROM ghost_relations WHERE from_id = ? UNION SELECT id FROM ghost_relations WHERE to_id = ?', [entityId, entityId]).map((r) => r.id),
    observationsOf: (entityId) => all<{ id: string }>('SELECT id FROM ghost_observations WHERE entity_id = ?', [entityId]).map((r) => r.id),
    derivedFrom: (ref) =>
      all<{ child_kind: RowKind; child_id: string }>('SELECT child_kind, child_id FROM ghost_derivations WHERE parent_kind = ? AND parent_id = ?', [ref.kind, ref.id]).map((r) => ({
        kind: r.child_kind,
        id: r.child_id,
      })),
  };

  function execute(plan: CascadePlan, forgottenAt: string | null) {
    // Links first, then rows that point at entities, then the entities (and, by trigger, their search rows).
    for (const ref of plan.rows) {
      run('DELETE FROM ghost_derivations WHERE child_kind = ? AND child_id = ?', [ref.kind, ref.id]);
      run('DELETE FROM ghost_derivations WHERE parent_kind = ? AND parent_id = ?', [ref.kind, ref.id]);
    }
    for (const kind of ['observation', 'relation', 'entity'] as const) {
      for (const ref of plan.rows) {
        if (ref.kind !== kind) continue;
        if (kind === 'entity') run('DELETE FROM ghost_tags WHERE entity_id = ?', [ref.id]);
        run(`DELETE FROM ${TABLE[kind]} WHERE id = ?`, [ref.id]);
      }
    }
    if (forgottenAt) for (const t of plan.tombstones) run('INSERT OR IGNORE INTO ghost_tombstones (source_id, source_ref, forgotten_at) VALUES (?, ?, ?)', [t.sourceId, t.sourceRef, forgottenAt]);
  }

  function forget(target: RowRef, now: string, alsoInTransaction?: (plan: CascadePlan) => void): CascadePlan {
    return withTransaction(db, () => {
      const plan = planCascade(cascadeReader, [target], 'forget');
      execute(plan, now);
      alsoInTransaction?.(plan);
      return plan;
    });
  }

  function withdrawSource(sourceId: string, alsoInTransaction?: (plan: CascadePlan) => void): CascadePlan {
    return withTransaction(db, () => {
      const roots: RowRef[] = [];
      for (const kind of ['entity', 'relation', 'observation'] as const) {
        for (const r of all<{ id: string }>(`SELECT id FROM ${TABLE[kind]} WHERE source_id = ? ORDER BY id`, [sourceId])) roots.push({ kind, id: r.id });
      }
      const plan = planCascade(cascadeReader, roots, 'withdraw');
      execute(plan, null);
      alsoInTransaction?.(plan);
      return plan;
    });
  }

  function removeRows(roots: readonly RowRef[]): CascadePlan {
    return withTransaction(db, () => {
      const plan = planCascade(cascadeReader, [...roots], 'withdraw');
      execute(plan, null);
      return plan;
    });
  }

  // --- search and timeline -----------------------------------------------------

  function search(text: string, options: { types?: readonly EntityType[]; limit?: number } = {}): SearchHit[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, SEARCH_LIMITS.maxResults));
    const types = options.types ?? [];
    const typeSql = types.length ? ` AND e.type IN (${types.map(() => '?').join(', ')})` : '';
    const map = (r: Row): SearchHit => ({ id: String(r.id), type: r.type as EntityType, title: String(r.title), timelineAt: String(r.timeline_at), origin: r.origin as Origin });
    if (searchMode === 'fts') {
      const q = toFtsQuery(text);
      if (q === null) return [];
      return all(
        `SELECT e.id, e.type, e.title, e.timeline_at, e.origin FROM ghost_search s JOIN ghost_entities e ON e.fts_rowid = s.rowid
         WHERE ghost_search MATCH ?${typeSql} ORDER BY s.rank, e.id LIMIT ?`,
        [q, ...types, limit],
      ).map(map);
    }
    const terms = searchTerms(text);
    if (terms.length === 0) return [];
    const where = terms.map(() => "(e.title LIKE ? ESCAPE '\\' OR e.notes LIKE ? ESCAPE '\\' OR e.tags_text LIKE ? ESCAPE '\\')").join(' AND ');
    const params = terms.flatMap((t) => [toLikePattern(t), toLikePattern(t), toLikePattern(t)]);
    return all(`SELECT e.id, e.type, e.title, e.timeline_at, e.origin FROM ghost_entities e WHERE ${where}${typeSql} ORDER BY e.updated_at DESC, e.id LIMIT ?`, [...params, ...types, limit]).map(map);
  }

  function timeline(q: TimelineQuery): TimelineItem[] {
    const entityWhere: string[] = [];
    const entityParams: unknown[] = [];
    const obsWhere: string[] = [];
    const obsParams: unknown[] = [];
    const add = (where: string[], params: unknown[], col: string, sql: string, values: unknown[]) => {
      where.push(sql.replace(/\$/g, col));
      params.push(...values);
    };
    for (const [where, params, at, originCol] of [
      [entityWhere, entityParams, 'e.timeline_at', 'e.origin'],
      [obsWhere, obsParams, 'o.observed_at', 'o.origin'],
    ] as const) {
      if (q.from) add(where, params, at, '$ >= ?', [q.from]);
      if (q.to) add(where, params, at, '$ < ?', [q.to]);
      if (q.types.length) add(where, params, 'e.type', `$ IN (${q.types.map(() => '?').join(', ')})`, q.types);
      if (q.origins.length) add(where, params, originCol, `$ IN (${q.origins.map(() => '?').join(', ')})`, q.origins);
    }
    const w = (list: string[]) => (list.length ? `WHERE ${list.join(' AND ')}` : '');
    const parts = [
      `SELECT 'entity' AS kind, e.id AS id, e.timeline_at AS at, e.id AS entity_id, e.type AS entity_type, e.title AS title, NULL AS statement, e.origin AS origin, e.confidence AS confidence
       FROM ghost_entities e ${w(entityWhere)}`,
    ];
    const params: unknown[] = [...entityParams];
    if (q.observations) {
      parts.push(
        `SELECT 'observation', o.id, o.observed_at, o.entity_id, e.type, e.title, o.statement, o.origin, o.confidence
         FROM ghost_observations o JOIN ghost_entities e ON e.id = o.entity_id ${w(obsWhere)}`,
      );
      params.push(...obsParams);
    }
    let sql = `SELECT * FROM (${parts.join(' UNION ALL ')})`;
    if (q.before) {
      sql += ' WHERE (at < ? OR (at = ? AND id < ?))';
      params.push(q.before.at, q.before.at, q.before.id);
    }
    sql += ' ORDER BY at DESC, id DESC LIMIT ?';
    params.push(q.limit);
    return all(sql, params).map((r) => ({
      kind: r.kind as 'entity' | 'observation',
      id: String(r.id),
      at: String(r.at),
      entityId: String(r.entity_id),
      entityType: r.entity_type as EntityType,
      title: String(r.title),
      statement: str(r.statement),
      origin: r.origin as Origin,
      confidence: Number(r.confidence),
    }));
  }

  function counts(): RowCounts {
    const n = (table: string) => Number(one<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)?.n ?? 0);
    return { entity: n('ghost_entities'), relation: n('ghost_relations'), observation: n('ghost_observations') };
  }

  // --- settings, adapters, runs ------------------------------------------------

  function getAdapter(id: AdapterId): AdapterState {
    const row = one('SELECT * FROM ghost_adapters WHERE id = ?', [id]);
    if (!row) return { id, enabled: false, cursor: null, lastSyncAt: null, counts: zero() };
    return { id, enabled: Number(row.enabled) === 1, cursor: str(row.cursor), lastSyncAt: str(row.last_sync_at), counts: { ...zero(), ...(JSON.parse(String(row.counts_json)) as Partial<RowCounts>) } };
  }

  function upsertAdapter(state: AdapterState, now: string): AdapterState {
    run(
      `INSERT INTO ghost_adapters (id, enabled, cursor, last_sync_at, counts_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, cursor = excluded.cursor, last_sync_at = excluded.last_sync_at, counts_json = excluded.counts_json, updated_at = excluded.updated_at`,
      [state.id, state.enabled ? 1 : 0, state.cursor, state.lastSyncAt, JSON.stringify(state.counts), now],
    );
    return state;
  }

  function getSettings(): GhostOsSettings {
    const row = one<{ value_json: string }>("SELECT value_json FROM ghost_state WHERE key = 'settings'");
    const settings = row ? normalizeGhostOsSettings(JSON.parse(row.value_json)) : defaultGhostOsSettings();
    // The adapter table is the truth for on/off: it changes in the same transaction as the data.
    for (const id of ADAPTER_IDS) settings.adapters[id] = { enabled: getAdapter(id).enabled };
    return settings;
  }

  function saveSettings(input: GhostOsSettings, now: string): GhostOsSettings {
    const s = normalizeGhostOsSettings(input);
    run(
      `INSERT INTO ghost_state (key, value_json, updated_at) VALUES ('settings', ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [JSON.stringify({ schemaVersion: 1, syncIntervalMinutes: s.syncIntervalMinutes }), now],
    );
    return getSettings();
  }

  function claimRun(input: { id: string; occurrenceId: string; kind: RunKind; trigger: RunTrigger; now: string }): RunRecord | null {
    const res = run(
      `INSERT OR IGNORE INTO ghost_runs (id, occurrence_id, kind, trigger, status, started_at, finished_at, summary_json, error) VALUES (?, ?, ?, ?, 'running', ?, NULL, '{}', NULL)`,
      [input.id, input.occurrenceId, input.kind, input.trigger, input.now],
    );
    if (Number(res.changes) === 0) return null;
    return toRun(one('SELECT * FROM ghost_runs WHERE id = ?', [input.id]) as Row);
  }

  function finishRun(id: string, status: Exclude<RunStatus, 'running'>, now: string, summary: Record<string, unknown>, error: string | null = null): RunRecord {
    run('UPDATE ghost_runs SET status = ?, finished_at = ?, summary_json = ?, error = ? WHERE id = ?', [status, now, JSON.stringify(summary), error, id]);
    const row = one('SELECT * FROM ghost_runs WHERE id = ?', [id]);
    if (!row) throw new GhostStoreError(`run ${id} does not exist`);
    return toRun(row);
  }

  // --- export and import -------------------------------------------------------

  function allDerivations(): Derivation[] {
    return all<{ child_kind: RowKind; child_id: string; parent_kind: RowKind; parent_id: string }>(
      'SELECT child_kind, child_id, parent_kind, parent_id FROM ghost_derivations ORDER BY child_kind, child_id, parent_kind, parent_id',
    ).map((r) => ({ child: { kind: r.child_kind, id: r.child_id }, parent: { kind: r.parent_kind, id: r.parent_id } }));
  }

  function listTombstones(): Tombstone[] {
    return all<{ source_id: string; source_ref: string; forgotten_at: string }>('SELECT * FROM ghost_tombstones ORDER BY source_id, source_ref').map((r) => ({
      sourceId: r.source_id,
      sourceRef: r.source_ref,
      forgottenAt: r.forgotten_at,
    }));
  }

  function exportAll(now: string): GhostExport {
    const tags = new Map<string, string[]>();
    for (const r of all<{ entity_id: string; tag: string }>('SELECT entity_id, tag FROM ghost_tags ORDER BY entity_id, tag')) tags.set(r.entity_id, [...(tags.get(r.entity_id) ?? []), r.tag]);
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now,
      entities: all('SELECT * FROM ghost_entities ORDER BY id').map((r) => toEntity(r, tags.get(String(r.id)) ?? [])),
      relations: all('SELECT * FROM ghost_relations ORDER BY id').map(toRelation),
      observations: all('SELECT * FROM ghost_observations ORDER BY id').map(toObservation),
      derivations: allDerivations(),
      tombstones: listTombstones(),
    };
  }

  /**
   * Merge: rows whose id (or source fact) already exists are skipped, and so
   * are forgotten source facts. Derived rows land only when every parent is
   * present afterwards; their links are written only for rows this import added.
   */
  function importAll(parsed: ParsedImport, alsoInTransaction?: (result: ImportResult) => void): ImportResult {
    const { data } = parsed;
    return withTransaction(db, () => {
      for (const id of parsed.externalEntityIds) {
        if (!exists({ kind: 'entity', id })) throw new GhostStoreError(`the file refers to entity ${id}, which is not in the file or in GhostOS`);
      }
      const result: ImportResult = { added: zero(), skippedExisting: zero(), skippedForgotten: zero(), derivations: 0, tombstones: 0 };
      for (const t of data.tombstones) {
        result.tombstones += Number(run('INSERT OR IGNORE INTO ghost_tombstones (source_id, source_ref, forgotten_at) VALUES (?, ?, ?)', [t.sourceId, t.sourceRef, t.forgottenAt]).changes);
      }
      const parentsOf = new Map<string, RowRef[]>();
      for (const d of data.derivations) {
        const key = `${d.child.kind}:${d.child.id}`;
        parentsOf.set(key, [...(parentsOf.get(key) ?? []), d.parent]);
      }
      const added = new Set<string>();

      type Pending = { kind: RowKind; row: Entity | Relation | Observation };
      let pending: Pending[] = [];
      const queue = (kind: RowKind, rows: readonly (Entity | Relation | Observation)[]) => {
        for (const row of rows) {
          const { sourceId, sourceRef } = row.provenance;
          if (exists({ kind, id: row.id }) || (sourceId && sourceRef && one(`SELECT 1 AS ok FROM ${TABLE[kind]} WHERE source_id = ? AND source_ref = ?`, [sourceId, sourceRef]))) {
            result.skippedExisting[kind] += 1;
          } else if (sourceId && sourceRef && isForgotten(sourceId, sourceRef)) {
            result.skippedForgotten[kind] += 1;
          } else {
            pending.push({ kind, row });
          }
        }
      };
      queue('entity', data.entities);
      queue('observation', data.observations);
      queue('relation', data.relations);

      // What a row needs before it can land: its entities, and for a derived row every parent.
      const ready = ({ kind, row }: Pending) => {
        if (kind === 'relation' && !(exists({ kind: 'entity', id: (row as Relation).fromId }) && exists({ kind: 'entity', id: (row as Relation).toId }))) return false;
        if (kind === 'observation' && !exists({ kind: 'entity', id: (row as Observation).entityId })) return false;
        return row.provenance.origin !== 'derived' || (parentsOf.get(`${kind}:${row.id}`) ?? []).every(exists);
      };
      // Rounds until nothing more can land: a derived row may wait on rows that wait on other rows.
      for (let progress = true; progress && pending.length > 0; ) {
        progress = false;
        const waiting: Pending[] = [];
        for (const item of pending) {
          if (!ready(item)) {
            waiting.push(item);
            continue;
          }
          if (item.kind === 'entity') insertEntity(item.row as Entity);
          else if (item.kind === 'observation') insertObservation(item.row as Observation);
          else insertRelation(item.row as Relation);
          added.add(`${item.kind}:${item.row.id}`);
          result.added[item.kind] += 1;
          progress = true;
        }
        pending = waiting;
      }
      // What is left depends on something skipped as forgotten: it stays out too.
      for (const item of pending) result.skippedForgotten[item.kind] += 1;

      for (const d of data.derivations) {
        if (!added.has(`${d.child.kind}:${d.child.id}`) || !exists(d.parent)) continue;
        result.derivations += Number(
          run('INSERT OR IGNORE INTO ghost_derivations (child_kind, child_id, parent_kind, parent_id) VALUES (?, ?, ?, ?)', [d.child.kind, d.child.id, d.parent.kind, d.parent.id]).changes,
        );
      }
      alsoInTransaction?.(result);
      return result;
    });
  }

  return {
    searchMode,
    getEntity: (id) => {
      const row = one('SELECT * FROM ghost_entities WHERE id = ?', [id]);
      return row ? toEntity(row, tagsOf(id)) : undefined;
    },
    findBySource: (kind, sourceId, sourceRef) => str(one(`SELECT id FROM ${TABLE[kind]} WHERE source_id = ? AND source_ref = ?`, [sourceId, sourceRef])?.id) ?? undefined,
    putEntity,
    listEntities: (options = {}) => {
      const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
      const rows = options.type
        ? all('SELECT * FROM ghost_entities WHERE type = ? ORDER BY timeline_at DESC, id DESC LIMIT ? OFFSET ?', [options.type, limit, options.offset ?? 0])
        : all('SELECT * FROM ghost_entities ORDER BY timeline_at DESC, id DESC LIMIT ? OFFSET ?', [limit, options.offset ?? 0]);
      return rows.map((r) => toEntity(r, tagsOf(String(r.id))));
    },
    getRelation: (id) => {
      const row = one('SELECT * FROM ghost_relations WHERE id = ?', [id]);
      return row ? toRelation(row) : undefined;
    },
    putRelation,
    relationsOf: (entityId) => all('SELECT * FROM ghost_relations WHERE from_id = ? UNION SELECT * FROM ghost_relations WHERE to_id = ? ORDER BY created_at, id', [entityId, entityId]).map(toRelation),
    getObservation: (id) => {
      const row = one('SELECT * FROM ghost_observations WHERE id = ?', [id]);
      return row ? toObservation(row) : undefined;
    },
    putObservation,
    observationsOf: (entityId, limit = 200) => all('SELECT * FROM ghost_observations WHERE entity_id = ? ORDER BY observed_at DESC, id DESC LIMIT ?', [entityId, limit]).map(toObservation),
    observationsFromSource: (sourceId) => all('SELECT * FROM ghost_observations WHERE source_id = ? ORDER BY observed_at, id', [sourceId]).map(toObservation),
    derivationsOf: (child) =>
      all<{ parent_kind: RowKind; parent_id: string }>('SELECT parent_kind, parent_id FROM ghost_derivations WHERE child_kind = ? AND child_id = ? ORDER BY parent_kind, parent_id', [child.kind, child.id]).map((r) => ({
        kind: r.parent_kind,
        id: r.parent_id,
      })),
    isForgotten,
    listTombstones,
    forget,
    withdrawSource,
    removeRows,
    sourceRowIds: (kind, sourceId) => all<{ id: string }>(`SELECT id FROM ${TABLE[kind]} WHERE source_id = ? ORDER BY id`, [sourceId]).map((r) => r.id),
    search,
    timeline,
    counts,
    getSettings,
    saveSettings,
    getAdapter,
    setAdapterEnabled: (id, enabled, now) => upsertAdapter({ ...getAdapter(id), enabled }, now),
    recordAdapterSync: (id, cursor, rowCounts, now) => upsertAdapter({ ...getAdapter(id), cursor, lastSyncAt: now, counts: rowCounts }, now),
    resetAdapter: (id, now) => upsertAdapter({ ...getAdapter(id), enabled: false, cursor: null, counts: zero() }, now),
    claimRun,
    finishRun,
    getRunByOccurrence: (occurrenceId) => {
      const row = one('SELECT * FROM ghost_runs WHERE occurrence_id = ?', [occurrenceId]);
      return row ? toRun(row) : undefined;
    },
    recoverInterruptedRuns: (now) => Number(run("UPDATE ghost_runs SET status = 'failed', finished_at = ?, error = 'interrupted' WHERE status = 'running'", [now]).changes),
    listRuns: (limit = 20) => all('SELECT * FROM ghost_runs ORDER BY started_at DESC, id DESC LIMIT ?', [limit]).map(toRun),
    exportAll,
    importAll,
    transaction: (work) => withTransaction(db, work),
  };
}
