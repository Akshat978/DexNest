import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import type { SqlDatabase } from '@dexnest/foundation';
import {
  GHOST_OS_MIGRATIONS,
  GHOST_OS_SEARCH_MIGRATIONS,
  manifestProblems,
  openGhostStore,
  parseExport,
  parseTimelineQuery,
  type Entity,
  type GhostStore,
  type Observation,
  type Provenance,
  type TimelineQuery,
} from '../index.ts';
import { T0, entity, fromDi, observation, relation } from './fixtures.ts';

const opened: TestDatabase[] = [];
afterEach(() => {
  for (const t of opened.splice(0)) t.dispose();
});

function fresh(options: Parameters<typeof openGhostStore>[1] = {}) {
  const t = createTestDatabase('ghost-store-');
  opened.push(t);
  return { t, store: openGhostStore(t.db, { now: T0, ...options }) };
}

const DI = 'adapter:developer_intelligence';
const commitEvidence = (sha: string) => [{ kind: 'commit' as const, repositoryId: 'repo-1', sha, at: T0 }];
const habitProvenance = (evidenceIds: string[]): Provenance => ({
  origin: 'derived',
  sourceId: 'detector:time_of_day',
  sourceRef: 'time_of_day:commits',
  evidence: evidenceIds.map((observationId) => ({ kind: 'observation' as const, observationId })),
  confidence: 0.8,
});

/** A small world: me, a DI project using a DI skill, two commit-day observations, a habit from them. */
function world(store: GhostStore) {
  const me = entity({ id: 'ent_me000001', type: 'person', title: 'Me' });
  const project = entity({ id: 'ent_proj0001', title: 'Zephyr app', notes: 'the tracker', tags: ['work'], provenance: fromDi('repo:repo-1') });
  const skill = entity({ id: 'ent_skill001', type: 'skill', title: 'TypeScript', provenance: fromDi('skill:typescript', [{ kind: 'technology', factId: 'f1', repositoryId: 'repo-1', evidencePath: 'package.json', evidenceKind: 'package.json' }], 0.9) });
  for (const e of [me, project, skill]) expect(store.putEntity(e)).toBe('created');
  store.putRelation(relation({ id: 'rel_uses0001', fromId: project.id, toId: skill.id, type: 'uses', provenance: fromDi('uses:repo-1:typescript', [{ kind: 'technology', factId: 'f1', repositoryId: 'repo-1', evidencePath: 'package.json', evidenceKind: 'package.json' }], 0.9) }));
  store.putRelation(relation({ id: 'rel_mine0001', fromId: me.id, toId: project.id, type: 'worked_on' }));
  const day1 = observation({ id: 'obs_day00001', entityId: project.id, statement: '2 commits observed', provenance: fromDi('day:repo-1:2026-06-01', commitEvidence('aaaaaaa'), 0.6) });
  const day2 = observation({ id: 'obs_day00002', entityId: project.id, statement: '1 commit observed', observedAt: '2026-06-02T09:00:00.000Z', provenance: fromDi('day:repo-1:2026-06-02', commitEvidence('bbbbbbb'), 0.6) });
  store.putObservation(day1);
  store.putObservation(day2);
  const habit = entity({
    id: 'ent_habit001',
    type: 'habit',
    title: 'Commits mostly in the evening',
    details: { cadence: 'daily', mode: 'detected', detectorId: 'time_of_day', parameters: {} },
    provenance: habitProvenance([day1.id, day2.id]),
  });
  store.putEntity(habit, { derivedFrom: [{ kind: 'observation', id: day1.id }, { kind: 'observation', id: day2.id }] });
  store.putObservation(observation({ id: 'obs_note0001', entityId: habit.id, statement: 'true, sadly' }));
  return { me, project, skill, habit, day1, day2 };
}

const ftsRows = (t: TestDatabase) => Number(t.db.prepare('SELECT count(*) AS n FROM ghost_search').get<{ n: number }>()?.n);

describe('migrations and manifest', () => {
  it('the manifest validates, and every table, index and trigger is under ghost_', () => {
    expect(manifestProblems()).toEqual([]);
    const names = [...GHOST_OS_MIGRATIONS, ...GHOST_OS_SEARCH_MIGRATIONS].flatMap((m) =>
      [...m.sql.matchAll(/\bCREATE\s+(?:VIRTUAL\s+TABLE|TABLE|UNIQUE\s+INDEX|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)].map((x) => x[1]),
    );
    expect(names.length).toBeGreaterThan(15);
    expect(names.filter((n) => !n?.startsWith('ghost_'))).toEqual([]);
  });

  it('survives close and reopen: data stays, nothing is applied twice', () => {
    const { t, store } = fresh();
    world(store);
    const before = store.exportAll(T0);
    t.close();
    const t2 = t.reopen();
    opened.push(t2);
    const again = openGhostStore(t2.db, { now: T0 });
    expect(again.exportAll(T0)).toEqual(before);
    expect(again.searchMode).toBe('fts');
    const ledger = t2.db.prepare("SELECT module, version FROM dexnest_module_migrations WHERE module LIKE 'ghost_os%' ORDER BY module").all();
    expect(ledger).toEqual([
      { module: 'ghost_os', version: 1 },
      { module: 'ghost_os_search', version: 1 },
    ]);
    expect(again.search('zephyr').map((h) => h.id)).toEqual(['ent_proj0001']);
  });
});

describe('writing rows', () => {
  it('creates, updates and recognises an unchanged row; keeps the creation time', () => {
    const { store } = fresh();
    const e = entity({ id: 'ent_a0000001', title: 'Alpha', tags: ['one', 'two'] });
    expect(store.putEntity(e)).toBe('created');
    expect(store.putEntity({ ...e, updatedAt: '2026-06-02T00:00:00.000Z' })).toBe('unchanged');
    expect(store.putEntity({ ...e, title: 'Alpha 2', tags: ['two'], createdAt: '2026-06-05T00:00:00.000Z', updatedAt: '2026-06-06T00:00:00.000Z' })).toBe('updated');
    expect(store.getEntity(e.id)).toMatchObject({ title: 'Alpha 2', tags: ['two'], createdAt: T0, updatedAt: '2026-06-06T00:00:00.000Z' });
  });

  it('refuses an invalid row and writes nothing', () => {
    const { store } = fresh();
    expect(() => store.putEntity(entity({ provenance: fromDi('repo:x', []) }))).toThrow(/no evidence/);
    expect(store.counts()).toEqual({ entity: 0, relation: 0, observation: 0 });
  });

  it('a row keeps its source; one source fact is one row', () => {
    const { store } = fresh();
    store.putEntity(entity({ id: 'ent_a0000001', provenance: fromDi('repo:1') }));
    expect(() => store.putEntity(entity({ id: 'ent_a0000001' }))).toThrow(/different source/);
    expect(() => store.putEntity(entity({ id: 'ent_b0000001', provenance: fromDi('repo:1') }))).toThrow(/already ent_a0000001/);
    expect(store.findBySource('entity', DI, 'repo:1')).toBe('ent_a0000001');
  });

  it('a derived row needs parents that exist; others may not list parents', () => {
    const { store } = fresh();
    const habit = entity({ id: 'ent_habit001', type: 'habit', details: { cadence: 'daily', mode: 'detected', detectorId: 'time_of_day', parameters: {} }, provenance: habitProvenance(['obs_00000001']) });
    expect(() => store.putEntity(habit)).toThrow(/needs what it was derived from/);
    expect(() => store.putEntity(habit, { derivedFrom: [{ kind: 'observation', id: 'obs_00000001' }] })).toThrow(/does not exist/);
    expect(() => store.putEntity(entity(), { derivedFrom: [{ kind: 'entity', id: 'ent_x0000001' }] })).toThrow(/only a derived row/);
    expect(store.counts().entity).toBe(0);
  });

  it('relations need both ends; observations need their entity', () => {
    const { store } = fresh();
    store.putEntity(entity({ id: 'ent_00000001' }));
    expect(() => store.putRelation(relation({ fromId: 'ent_00000001', toId: 'ent_00000002' }))).toThrow(/both entities/);
    expect(() => store.putObservation(observation({ entityId: 'ent_00000009' }))).toThrow(/does not exist/);
  });
});

describe('forget', () => {
  it('cascades through relations, observations and derived rows, and leaves no trace in search, links or the export', () => {
    const { t, store } = fresh();
    const w = world(store);
    expect(ftsRows(t)).toBe(4);

    const plan = store.forget({ kind: 'entity', id: w.project.id }, '2026-07-01T00:00:00.000Z');
    expect(plan.counts).toEqual({ entity: 2, relation: 2, observation: 3 });

    expect(store.getEntity(w.project.id)).toBeUndefined();
    expect(store.getEntity(w.habit.id)).toBeUndefined();
    expect(store.getObservation(w.day1.id)).toBeUndefined();
    expect(store.getObservation('obs_note0001')).toBeUndefined();
    expect(store.getRelation('rel_mine0001')).toBeUndefined();
    expect(store.getEntity(w.me.id)).toBeDefined();
    expect(store.getEntity(w.skill.id)).toBeDefined();

    expect(store.search('zephyr')).toEqual([]);
    expect(store.search('tracker')).toEqual([]);
    expect(ftsRows(t)).toBe(2);
    expect(t.db.prepare('SELECT count(*) AS n FROM ghost_derivations').get()).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT count(*) AS n FROM ghost_tags WHERE entity_id = 'ent_proj0001'").get()).toEqual({ n: 0 });

    const dump = JSON.stringify({ ...store.exportAll(T0), tombstones: [] });
    for (const trace of ['Zephyr', 'tracker', w.project.id, w.habit.id, w.day1.id, 'sadly']) expect(dump, trace).not.toContain(trace);
  });

  it('forgetting one observation removes the habit derived from it', () => {
    const { store } = fresh();
    const w = world(store);
    store.forget({ kind: 'observation', id: w.day2.id }, T0);
    expect(store.getEntity(w.habit.id)).toBeUndefined();
    expect(store.getObservation(w.day1.id)).toBeDefined();
  });

  it('tombstones what a source contributed, so it is not written again', () => {
    const { store } = fresh();
    const w = world(store);
    store.forget({ kind: 'entity', id: w.project.id }, T0);
    expect(store.listTombstones().map((x) => x.sourceRef).sort()).toEqual(['day:repo-1:2026-06-01', 'day:repo-1:2026-06-02', 'repo:repo-1', 'time_of_day:commits', 'uses:repo-1:typescript']);
    expect(store.putEntity(w.project)).toBe('forgotten');
    expect(store.putObservation({ ...w.day1, entityId: w.skill.id })).toBe('forgotten');
    expect(store.getEntity(w.project.id)).toBeUndefined();
  });

  it('is all or nothing', () => {
    const { store } = fresh();
    const w = world(store);
    const before = store.exportAll(T0);
    expect(() =>
      store.forget({ kind: 'entity', id: w.project.id }, T0, () => {
        throw new Error('event log unavailable');
      }),
    ).toThrow('event log unavailable');
    expect(store.exportAll(T0)).toEqual(before);
  });

  it('forgetting a missing row does nothing', () => {
    const { store } = fresh();
    expect(store.forget({ kind: 'entity', id: 'ent_missing1' }, T0).rows).toEqual([]);
  });
});

describe('withdrawing a source', () => {
  it('removes what it contributed and what was derived from it, and leaves no tombstones', () => {
    const { store } = fresh();
    const w = world(store);
    const other = entity({ id: 'ent_book0001', type: 'knowledge', title: 'A book' });
    store.putEntity(other);
    const plan = store.withdrawSource(DI);
    expect(plan.counts).toEqual({ entity: 3, relation: 2, observation: 3 });
    expect(store.counts()).toEqual({ entity: 2, relation: 0, observation: 0 });
    expect(store.getEntity(w.me.id)).toBeDefined();
    expect(store.getEntity(other.id)).toBeDefined();
    expect(store.listTombstones()).toEqual([]);
    expect(store.putEntity(w.project)).toBe('created');
  });
});

describe('search', () => {
  it('finds titles, notes and tags by prefix, filters by type, and follows updates', () => {
    const { store } = fresh();
    world(store);
    store.putEntity(entity({ id: 'ent_cafe0001', type: 'place', title: 'Café Noir', notes: 'good coffee', tags: ['coffee'] }));
    expect(store.search('zeph').map((h) => h.id)).toEqual(['ent_proj0001']);
    expect(store.search('tracker').map((h) => h.id)).toEqual(['ent_proj0001']);
    expect(store.search('work').map((h) => h.id)).toEqual(['ent_proj0001']);
    expect(store.search('cafe').map((h) => h.id)).toEqual(['ent_cafe0001']);
    expect(store.search('coffee', { types: ['project'] })).toEqual([]);
    const e = store.getEntity('ent_cafe0001') as Entity;
    store.putEntity({ ...e, title: 'Blue Bottle', updatedAt: '2026-06-03T00:00:00.000Z' });
    expect(store.search('noir')).toEqual([]);
    expect(store.search('bottle').map((h) => h.id)).toEqual(['ent_cafe0001']);
    expect(store.search('"; DROP TABLE ghost_entities; --')).toEqual([]);
    expect(store.counts().entity).toBe(5);
  });

  it('falls back to LIKE when SQLite has no FTS5, and the core still works', () => {
    const t = createTestDatabase('ghost-nofts-');
    opened.push(t);
    const noFts: SqlDatabase = {
      exec(sql) {
        if (/fts5/i.test(sql)) throw new Error('no such module: fts5');
        t.db.exec(sql);
      },
      prepare: (sql) => t.db.prepare(sql),
    };
    const store = openGhostStore(noFts, { now: T0 });
    expect(store.searchMode).toBe('like');
    world(store);
    store.putEntity(entity({ id: 'ent_pct00001', title: '100% done' }));
    expect(store.search('zeph').map((h) => h.id)).toEqual(['ent_proj0001']);
    expect(store.search('work tracker').map((h) => h.id)).toEqual(['ent_proj0001']);
    expect(store.search('100%').map((h) => h.id)).toEqual(['ent_pct00001']); // "%" is not a word, and is never a wildcard
    expect(store.search('100').map((h) => h.id)).toEqual(['ent_pct00001']);
    const w = store.getEntity('ent_proj0001') as Entity;
    store.forget({ kind: 'entity', id: w.id }, T0);
    expect(store.search('zeph')).toEqual([]);

    // Once FTS5 is there, the index is built from what exists.
    const withFts = openGhostStore(t.db, { now: T0 });
    expect(withFts.searchMode).toBe('fts');
    expect(withFts.search('type').map((h) => h.id)).toEqual(['ent_skill001']);
    expect(withFts.search('100').map((h) => h.id)).toEqual(['ent_pct00001']);
  });

  it("search: 'off' never creates the index", () => {
    const { t, store } = fresh({ search: 'off' });
    expect(store.searchMode).toBe('like');
    expect(t.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ghost_search'").get()).toEqual({ n: 0 });
  });
});

describe('timeline', () => {
  const q = (input: unknown): TimelineQuery => {
    const r = parseTimelineQuery(input);
    if (!r.ok) throw new Error(r.errors.join());
    return r.value;
  };

  function dated(store: GhostStore) {
    store.putEntity(entity({ id: 'ent_mem00001', type: 'memory', title: 'Beach', details: { text: 'sand', occurredAt: '2026-03-01T10:00:00.000Z' }, occurredAt: '2026-03-01T10:00:00.000Z' }));
    store.putEntity(entity({ id: 'ent_dec00001', type: 'decision', title: 'Move', details: { decidedAt: '2026-04-01T10:00:00.000Z', choice: 'go', alternatives: [], rationale: '', outcome: null, outcomeAt: null, reviewAt: null }, occurredAt: '2026-04-01T10:00:00.000Z' }));
    store.putEntity(entity({ id: 'ent_proj0001', title: 'Proj', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', provenance: fromDi('repo:1') }));
    const obs: Observation = observation({ id: 'obs_day00001', entityId: 'ent_proj0001', statement: '1 commit observed', observedAt: '2026-05-01T00:00:00.000Z', provenance: fromDi('day:1', commitEvidence('ccccccc'), 0.6) });
    store.putObservation(obs);
  }

  it('lists entities and observations newest first', () => {
    const { store } = fresh();
    dated(store);
    expect(store.timeline(q({})).map((i) => `${i.kind}:${i.id}`)).toEqual(['observation:obs_day00001', 'entity:ent_dec00001', 'entity:ent_mem00001', 'entity:ent_proj0001']);
    const o = store.timeline(q({}))[0];
    expect(o).toMatchObject({ entityId: 'ent_proj0001', entityType: 'project', title: 'Proj', statement: '1 commit observed', origin: 'adapter', confidence: 0.6 });
  });

  it('filters by range, type and origin, and can leave observations out', () => {
    const { store } = fresh();
    dated(store);
    const ids = (input: unknown) => store.timeline(q(input)).map((i) => i.id);
    expect(ids({ from: '2026-03-01T00:00:00Z', to: '2026-04-15T00:00:00Z' })).toEqual(['ent_dec00001', 'ent_mem00001']);
    expect(ids({ types: ['project'] })).toEqual(['obs_day00001', 'ent_proj0001']);
    expect(ids({ origins: ['manual'] })).toEqual(['ent_dec00001', 'ent_mem00001']);
    expect(ids({ observations: false, types: ['project'] })).toEqual(['ent_proj0001']);
  });

  it('pages without gaps or repeats', () => {
    const { store } = fresh();
    for (let i = 0; i < 25; i++) store.putEntity(entity({ id: `ent_same${String(i).padStart(4, '0')}`, title: `e${i}`, createdAt: i < 10 ? T0 : `2026-06-${String(i).padStart(2, '0')}T00:00:00.000Z`, updatedAt: '2026-07-01T00:00:00.000Z' }));
    const seen: string[] = [];
    let before: { at: string; id: string } | null = null;
    for (;;) {
      const page = store.timeline(q({ limit: 7, before }));
      if (page.length === 0) break;
      seen.push(...page.map((i) => i.id));
      const last = page[page.length - 1]!;
      before = { at: last.at, id: last.id };
    }
    expect(seen.length).toBe(25);
    expect(new Set(seen).size).toBe(25);
  });
});

describe('export and import', () => {
  const parse = (value: unknown) => {
    const r = parseExport(JSON.parse(JSON.stringify(value)));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  };

  it('round-trips everything into an empty GhostOS', () => {
    const { store } = fresh();
    const w = world(store);
    store.putEntity(entity({ id: 'ent_gone0001', provenance: fromDi('repo:gone') }));
    store.forget({ kind: 'entity', id: 'ent_gone0001' }, T0);
    const data = store.exportAll('2026-07-01T00:00:00.000Z');

    const { store: target } = fresh();
    const result = target.importAll(parse(data));
    expect(result).toEqual({ added: { entity: 4, relation: 2, observation: 3 }, skippedExisting: { entity: 0, relation: 0, observation: 0 }, skippedForgotten: { entity: 0, relation: 0, observation: 0 }, derivations: 2, tombstones: 1 });
    expect(target.exportAll('2026-07-01T00:00:00.000Z')).toEqual(data);
    expect(target.search('zephyr').map((h) => h.id)).toEqual([w.project.id]);
  });

  it('merges: rows already present are skipped and reported', () => {
    const { store } = fresh();
    world(store);
    const data = store.exportAll(T0);
    const result = store.importAll(parse(data));
    expect(result.added).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(result.skippedExisting).toEqual({ entity: 4, relation: 2, observation: 3 });
  });

  it('skips forgotten facts in the file, and what depends on them', () => {
    const { store } = fresh();
    world(store);
    const data = store.exportAll(T0);
    const { store: target } = fresh();
    target.putEntity(entity({ id: 'ent_other001', provenance: fromDi('repo:repo-1') }));
    target.forget({ kind: 'entity', id: 'ent_other001' }, T0);
    const result = target.importAll(parse(data));
    // The project is forgotten here, so its commit days, its relations and the habit built on them stay out.
    expect(result.skippedForgotten).toEqual({ entity: 2, relation: 2, observation: 3 });
    expect(target.counts()).toEqual({ entity: 2, relation: 0, observation: 0 });
  });

  it('rolls back completely when anything fails', () => {
    const { store } = fresh();
    world(store);
    const data = store.exportAll(T0);
    const { store: target } = fresh();
    target.putEntity(entity({ id: 'ent_keep0001', title: 'already here' }));
    const before = target.exportAll(T0);

    const dangling = parse({ ...data, relations: [...data.relations, relation({ id: 'rel_dangle01', fromId: 'ent_me000001', toId: 'ent_nowhere1' })] });
    expect(() => target.importAll(dangling)).toThrow(/ent_nowhere1/);
    expect(target.exportAll(T0)).toEqual(before);

    expect(() =>
      target.importAll(parse(data), () => {
        throw new Error('disk full');
      }),
    ).toThrow('disk full');
    expect(target.exportAll(T0)).toEqual(before);
  });
});

describe('runs, adapters and settings', () => {
  it('an occurrence is claimed once', () => {
    const { store } = fresh();
    const a = store.claimRun({ id: 'run-1', occurrenceId: 'sync:2026-06-01T10:00', kind: 'sync', trigger: 'scheduled', now: T0 });
    expect(a?.status).toBe('running');
    expect(store.claimRun({ id: 'run-2', occurrenceId: 'sync:2026-06-01T10:00', kind: 'sync', trigger: 'scheduled', now: T0 })).toBeNull();
    expect(store.finishRun('run-1', 'completed', T0, { added: 3 })).toMatchObject({ status: 'completed', summary: { added: 3 } });
    expect(store.getRunByOccurrence('sync:2026-06-01T10:00')?.id).toBe('run-1');
    expect(store.listRuns().length).toBe(1);
  });

  it('adapters are off until turned on, and that survives a restart', () => {
    const { t, store } = fresh();
    expect(store.getSettings().adapters.developer_intelligence.enabled).toBe(false);
    store.setAdapterEnabled('developer_intelligence', true, T0);
    store.recordAdapterSync('developer_intelligence', '42', { entity: 1, relation: 2, observation: 3 }, T0);
    store.saveSettings({ ...store.getSettings(), syncIntervalMinutes: 120 }, T0);
    t.close();
    const t2 = t.reopen();
    opened.push(t2);
    const again = openGhostStore(t2.db, { now: T0 });
    expect(again.getSettings()).toEqual({ schemaVersion: 1, adapters: { developer_intelligence: { enabled: true } }, syncIntervalMinutes: 120 });
    expect(again.getAdapter('developer_intelligence')).toEqual({ id: 'developer_intelligence', enabled: true, cursor: '42', lastSyncAt: T0, counts: { entity: 1, relation: 2, observation: 3 } });
  });

  it('settings never turn an adapter on by themselves', () => {
    const { store } = fresh();
    const saved = store.saveSettings({ schemaVersion: 1, adapters: { developer_intelligence: { enabled: true } }, syncIntervalMinutes: 60 }, T0);
    expect(saved.adapters.developer_intelligence.enabled).toBe(false);
  });
});
