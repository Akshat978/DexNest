/**
 * Phase 7: what happens when things go wrong.
 *
 * - a disk fault at every single write of a sync, a forget and an import:
 *   the data is either untouched or complete, never half-written, and the
 *   next clean attempt reaches the same result as if nothing had failed;
 * - a restart in the middle of a sync;
 * - the same slot delivered several times at once;
 * - forget racing a sync that is reading;
 * - cycles in the derivation graph;
 * - huge and hostile import files;
 * - 50,000 commits.
 *
 * All synthetic, in temp directories.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEventLog, runFoundationMigrations, withTransaction, type EventLog, type ScheduledJob, type SqlDatabase, type SqlStatement } from '@dexnest/foundation';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import {
  CascadeLimitError,
  createGhostOsModule,
  IMPORT_LIMITS,
  openGhostStore,
  planCascade,
  projectIdFor,
  refKey,
  skillIdFor,
  type CascadeReader,
  type DiRepository,
  type DiTechnology,
  type GhostOsModule,
  type RowRef,
} from '../index.ts';
import { daysBefore } from './world.ts';

const NOW = '2026-06-30T12:00:00.000Z';

// --- a database that fails when told to ---------------------------------------------

interface Faults {
  /** Writes seen since the last reset. */
  writes: number;
  /** Throw on this write (1-based). */
  failAt: number;
  reset(): void;
}

const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

/** Counts every write statement and COMMIT; throws an I/O error on the chosen one. A failed COMMIT rolls back, as SQLite does on an I/O error. */
function faulty(db: SqlDatabase): { db: SqlDatabase; faults: Faults } {
  const faults: Faults = {
    writes: 0,
    failAt: Number.POSITIVE_INFINITY,
    reset() {
      faults.writes = 0;
      faults.failAt = Number.POSITIVE_INFINITY;
    },
  };
  const hit = () => {
    faults.writes += 1;
    if (faults.writes === faults.failAt) throw new Error('disk I/O error (injected)');
  };
  const wrapped: SqlDatabase = {
    exec(sql) {
      if (/^\s*COMMIT\b/i.test(sql)) {
        try {
          hit();
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      db.exec(sql);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!WRITE.test(sql)) return statement;
      const counted: SqlStatement = {
        run(params) {
          hit();
          return statement.run(params);
        },
        get: (params) => statement.get(params),
        all: (params) => statement.all(params),
      };
      return counted;
    },
  };
  return { db: wrapped, faults };
}

// --- a GhostOS with Developer Intelligence behind it ---------------------------------

interface Box {
  handle: TestDatabase;
  db: SqlDatabase;
  faults: Faults;
  log: EventLog;
  module: GhostOsModule;
  repos: DiRepository[];
  techs: DiTechnology[];
  gate: { wait: Promise<void> | null };
  jobs: Map<string, ScheduledJob>;
  /** GhostOS's data, without run records or timestamps that differ by attempt. */
  data(): string;
}

const boxes: TestDatabase[] = [];
afterEach(() => {
  for (const b of boxes.splice(0)) b.dispose();
});

let seq = 0;

function box(options: { handle?: TestDatabase; seed?: boolean } = {}): Box {
  const handle = options.handle ?? createTestDatabase('ghost-hard-');
  if (!options.handle) boxes.push(handle);
  const { db, faults } = faulty(handle.db);
  runFoundationMigrations(db);
  const log = createEventLog(db);
  const repos: DiRepository[] = [];
  const techs: DiTechnology[] = [];
  const gate: Box['gate'] = { wait: null };
  const jobs = new Map<string, ScheduledJob>();
  const module = createGhostOsModule({
    database: db,
    events: log,
    scheduler: {
      schedule(job) {
        jobs.set(job.id, job);
        return () => jobs.delete(job.id);
      },
      async runNow() {},
    },
    isSensitive: () => false,
    developerIntelligence: {
      async listRepositories() {
        if (gate.wait) await gate.wait;
        return repos;
      },
      async listTechnologies(id) {
        return techs.filter((t) => t.repositoryId === id);
      },
    },
    audit(actionId, summary, metadata, status) {
      log.append({ type: 'action_executed', stream: 'audit', module: 'ghost_os', source: 'module_ui', payload: { actionId, summary, status, metadata } });
    },
    timeZone: 'UTC',
    now: () => new Date(NOW),
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  });
  const b: Box = {
    handle,
    db,
    faults,
    log,
    module,
    repos,
    techs,
    gate,
    jobs,
    data() {
      const q = (sql: string) => JSON.stringify(handle.db.prepare(sql).all());
      return [
        q('SELECT id, type, title, notes, tags_text, details_json, origin, source_id, source_ref, evidence_json, confidence FROM ghost_entities ORDER BY id'),
        q('SELECT * FROM ghost_tags ORDER BY entity_id, tag'),
        q('SELECT id, from_id, to_id, type, strength, origin, source_ref, evidence_json FROM ghost_relations ORDER BY id'),
        q('SELECT id, entity_id, statement, observed_at, source_ref, evidence_json, confidence FROM ghost_observations ORDER BY id'),
        q('SELECT * FROM ghost_derivations ORDER BY child_id, parent_id'),
        q('SELECT source_id, source_ref FROM ghost_tombstones ORDER BY source_id, source_ref'),
      ].join('\n');
    },
  };
  if (options.seed !== false) seedDi(b);
  return b;
}

function seedDi(b: Box, commitsPerRepo = 12) {
  b.repos.push(
    { id: 'repo-app', roots: [{ path: '/home/dev/app' }], displayName: 'app', discoveredAt: '2026-01-01T00:00:00.000Z' },
    { id: 'repo-cli', roots: [{ path: '/home/dev/cli' }], displayName: 'cli', discoveredAt: '2026-01-01T00:00:00.000Z' },
  );
  b.techs.push(
    { id: 'tf-1', repositoryId: 'repo-app', category: 'language', name: 'TypeScript', evidencePath: 'package.json', evidenceKind: 'package.json', status: 'observed', firstObservedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'tf-2', repositoryId: 'repo-cli', category: 'language', name: 'Rust', evidencePath: 'src/lib.rs', evidenceKind: 'file-extension', status: 'observed', firstObservedAt: '2026-01-02T00:00:00.000Z' },
  );
  for (const repo of ['repo-app', 'repo-cli']) {
    for (let i = 0; i < commitsPerRepo; i++) {
      b.log.append({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', subject: repo, source: 'developer_intelligence', idempotencyKey: `seed:${repo}:${i}`, payload: { sha: `${repo === 'repo-app' ? 'a' : 'b'}${String(i).padStart(7, '0')}`, subject: 'x', authorDate: daysBefore(NOW, i, '20:00') } });
    }
  }
  b.faults.reset();
}

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.value;
}

/** Runs `attempt` with a fault at every write it makes in turn; `check` sees the box after each failed attempt. */
async function atEveryWrite(prepare: () => Box | Promise<Box>, attempt: (b: Box) => Promise<unknown> | unknown, check: (b: Box, k: number) => Promise<void> | void) {
  const probe = await prepare();
  probe.faults.reset();
  await attempt(probe);
  const total = probe.faults.writes;
  expect(total).toBeGreaterThan(5);
  for (let k = 1; k <= total; k++) {
    const b = await prepare();
    b.faults.reset();
    b.faults.failAt = k;
    try {
      await attempt(b);
    } catch {
      // A fault may surface as a thrown error or as a failed result; either is fine.
    }
    b.faults.reset();
    await check(b, k);
  }
  return total;
}

// --- disk faults ----------------------------------------------------------------------

describe('a disk fault at any write', () => {
  it('sync: the data is untouched or complete, and the next sync reaches the same result', async () => {
    const reference = box();
    ok(reference.module.enableAdapter('developer_intelligence'));
    await reference.module.syncNow();
    const complete = reference.data();
    const nothing = box().data();

    const prepare = () => {
      const b = box();
      ok(b.module.enableAdapter('developer_intelligence'));
      return b;
    };
    const total = await atEveryWrite(prepare, (b) => b.module.syncNow(), async (b, k) => {
      expect([nothing, complete], `fault at write ${k}`).toContain(b.data());
      // A new slot after the fault: the same end state as a sync that never failed.
      await b.module.engine.sync('developer_intelligence', { occurrenceId: `retry-${k}`, trigger: 'manual' });
      expect(b.data(), `retry after fault at write ${k}`).toBe(complete);
    });
    expect(total).toBeGreaterThan(40);
  });

  it('forget: all of the cascade or none of it', async () => {
    const make = async () => {
      const b = box();
      ok(b.module.enableAdapter('developer_intelligence'));
      await b.module.syncNow();
      return b;
    };
    const before = (await make()).data();
    const after = await (async () => {
      const b = await make();
      ok(b.module.forget({ kind: 'entity', id: projectIdFor('repo-app') }));
      return b.data();
    })();
    const total = await atEveryWrite(
      make,
      (b) => b.module.forget({ kind: 'entity', id: projectIdFor('repo-app') }),
      (b, k) => {
        expect([before, after], `fault at write ${k}`).toContain(b.data());
      },
    );
    expect(total).toBeGreaterThan(20);
  });

  it('import: all of the file or none of it', async () => {
    const source = box();
    ok(source.module.enableAdapter('developer_intelligence'));
    await source.module.syncNow();
    ok(source.module.saveEntity({ type: 'person', title: 'Me', tags: ['self'] }));
    const file = JSON.parse(JSON.stringify(source.module.exportData())) as unknown;
    const complete = (() => {
      const b = box({ seed: false });
      ok(b.module.importData(file));
      return b.data();
    })();
    const nothing = box({ seed: false }).data();
    await atEveryWrite(
      () => box({ seed: false }),
      (b) => b.module.importData(file),
      (b, k) => {
        expect([nothing, complete], `fault at write ${k}`).toContain(b.data());
      },
    );
  });
});

// --- restart, duplicates, races --------------------------------------------------------

describe('restarts and races', () => {
  it('a restart in the middle of a sync: the interrupted run is closed and the next sync completes normally', async () => {
    const reference = box();
    ok(reference.module.enableAdapter('developer_intelligence'));
    await reference.module.syncNow();

    const handle = createTestDatabase('ghost-restart-');
    boxes.push(handle);
    const first = box({ handle });
    ok(first.module.enableAdapter('developer_intelligence'));
    first.gate.wait = new Promise(() => {}); // DI never answers: the process "dies" while reading
    void first.module.syncNow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    first.module.stop();
    handle.close();

    const reopened = handle.reopen();
    boxes.push(reopened);
    const second = box({ handle: reopened, seed: false });
    second.repos.push(...first.repos);
    second.techs.push(...first.techs);
    second.module.start();
    expect(second.module.store.listRuns(5).map((r) => [r.status, r.error])).toEqual([['failed', 'interrupted']]);
    expect(second.jobs.has('sync')).toBe(true); // still on after the restart
    // The next slot: the interrupted occurrence stays spent, a new one runs.
    await (second.jobs.get('sync') as ScheduledJob).run({ occurrenceId: 'sync:after-restart', scheduledAt: NOW, trigger: 'scheduled' });
    expect(second.module.store.getRunByOccurrence('sync:after-restart:developer_intelligence')?.status).toBe('completed');
    expect(second.data()).toBe(reference.data());
  });

  it('the same slot delivered several times at once runs once; manual syncs queue behind it', async () => {
    const reference = box();
    ok(reference.module.enableAdapter('developer_intelligence'));
    await reference.module.syncNow();

    const b = box();
    b.module.start();
    ok(b.module.enableAdapter('developer_intelligence'));
    const job = b.jobs.get('sync') as ScheduledJob;
    const occurrence = { occurrenceId: 'sync:slot-1', scheduledAt: NOW, trigger: 'scheduled' as const };
    await Promise.all([job.run(occurrence), job.run(occurrence), job.run({ ...occurrence, trigger: 'startup' }), b.module.syncNow(), b.module.syncNow()]);
    expect(b.data()).toBe(reference.data());
    expect(b.log.query({ stream: 'ghost', types: ['ghost.adapter.synced'] })).toHaveLength(1);
    const runs = b.module.store.listRuns(20);
    expect(new Set(runs.map((r) => r.occurrenceId)).size).toBe(runs.length);
    expect(runs.filter((r) => r.status === 'failed')).toEqual([]);
  });

  it('forget while a sync is reading: the sync does not bring it back', async () => {
    const b = box();
    ok(b.module.enableAdapter('developer_intelligence'));
    await b.module.syncNow();
    let release: () => void = () => {};
    b.gate.wait = new Promise((resolve) => {
      release = resolve;
    });
    b.log.append({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', subject: 'repo-app', source: 'developer_intelligence', payload: { sha: 'c0ffee1', subject: 'x', authorDate: NOW } });
    b.faults.reset();
    const syncing = b.module.engine.sync('developer_intelligence', { occurrenceId: 'racing', trigger: 'manual' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    ok(b.module.forget({ kind: 'entity', id: projectIdFor('repo-app') }));
    ok(b.module.forget({ kind: 'entity', id: skillIdFor('rust') }));
    b.gate.wait = null;
    release();
    const outcome = await syncing;
    expect(outcome.status).toBe('completed');
    expect(b.module.store.getEntity(projectIdFor('repo-app'))).toBeUndefined();
    expect(b.module.store.getEntity(skillIdFor('rust'))).toBeUndefined();
    expect(b.module.store.observationsOf(projectIdFor('repo-app'))).toEqual([]);
    expect(b.module.store.relationsOf(projectIdFor('repo-cli'))).toEqual([]);
  });
});

// --- cycles ------------------------------------------------------------------------------

describe('cycles in the derivation graph', () => {
  it('forget walks a cycle once and removes all of it', async () => {
    const b = box({ seed: false });
    const person = ok(b.module.saveEntity({ type: 'person', title: 'A' }));
    const other = ok(b.module.saveEntity({ type: 'person', title: 'B' }));
    // Only a corrupted database or a bug could make one; the walk must survive it anyway.
    withTransaction(b.handle.db, () => {
      const link = b.handle.db.prepare('INSERT INTO ghost_derivations (child_kind, child_id, parent_kind, parent_id) VALUES (?, ?, ?, ?)');
      link.run(['entity', person.id, 'entity', other.id]);
      link.run(['entity', other.id, 'entity', person.id]);
      link.run(['entity', person.id, 'entity', person.id]);
    });
    const r = ok(b.module.forget({ kind: 'entity', id: person.id }));
    expect(r.removed.entity).toBe(2);
    expect(b.module.status().counts.entity).toBe(0);
  });

  it('an import whose derived rows depend on each other lands neither, and does not hang', () => {
    const b = box({ seed: false });
    const habit = (id: string, parent: string) => ({
      id,
      type: 'habit',
      title: id,
      notes: '',
      tags: [],
      details: { cadence: 'daily', mode: 'detected', detectorId: 'time_of_day', parameters: {} },
      occurredAt: null,
      startedAt: null,
      endedAt: null,
      provenance: { origin: 'derived', sourceId: 'detector:time_of_day', sourceRef: `ref-${id}`, evidence: [{ kind: 'observation', observationId: 'obs_00000001' }], confidence: 0.5 },
      createdAt: NOW,
      updatedAt: NOW,
      parent,
    });
    const a = habit('ent_habitaaa1', 'ent_habitbbb1');
    const c = habit('ent_habitbbb1', 'ent_habitaaa1');
    const file = {
      format: 'dexnest.ghost_os',
      version: 1,
      exportedAt: NOW,
      entities: [a, c].map(({ parent: _parent, ...rest }) => rest),
      relations: [],
      observations: [],
      derivations: [
        { child: { kind: 'entity', id: a.id }, parent: { kind: 'entity', id: c.id } },
        { child: { kind: 'entity', id: c.id }, parent: { kind: 'entity', id: a.id } },
      ],
      tombstones: [],
    };
    const r = ok(b.module.importData(file));
    expect(r.added.entity).toBe(0);
    expect(r.skippedForgotten.entity).toBe(2);
  });

  it('a walk that stops converging fails loudly instead of looping', () => {
    // A reader that invents a new child for every row: no real graph does this.
    let n = 0;
    const endless: CascadeReader = {
      info: () => ({ origin: 'manual', sourceId: null, sourceRef: null }),
      relationsTouching: () => [],
      observationsOf: () => [],
      derivedFrom: (): RowRef[] => [{ kind: 'entity', id: `ent_x${++n}` }],
    };
    expect(() => planCascade(endless, [{ kind: 'entity', id: 'ent_root' }], 'forget', 10_000)).toThrow(CascadeLimitError);
    expect(refKey({ kind: 'entity', id: 'x' })).toBe('entity:x');
  });
});

// --- hostile imports -----------------------------------------------------------------------

describe('hostile import files', () => {
  const base = () => ({ format: 'dexnest.ghost_os', version: 1, exportedAt: NOW, entities: [] as unknown[], relations: [], observations: [], derivations: [], tombstones: [] as unknown[] });
  const person = (over: Record<string, unknown> = {}) => ({
    id: 'ent_00000001',
    type: 'person',
    title: 'P',
    notes: '',
    tags: [],
    details: {},
    occurredAt: null,
    startedAt: null,
    endedAt: null,
    provenance: { origin: 'manual', sourceId: null, sourceRef: null, evidence: [{ kind: 'manual' }], confidence: 1 },
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  it('cannot pollute prototypes', () => {
    const b = box({ seed: false });
    const polluted = JSON.parse(`{"format":"dexnest.ghost_os","version":1,"exportedAt":"${NOW}","entities":[${JSON.stringify(person()).replace('"details":{}', '"details":{"__proto__":{"polluted":true}}')}],"relations":[],"observations":[],"derivations":[],"tombstones":[]}`) as unknown;
    expect(b.module.importData(polluted).ok).toBe(false);
    const habit = person({ type: 'habit', details: JSON.parse('{"cadence":"daily","mode":"declared","detectorId":null,"parameters":{"__proto__":{"polluted":true}}}') as unknown });
    expect(b.module.importData({ ...base(), entities: [habit] }).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(b.module.status().counts.entity).toBe(0);
  });

  it('refuses oversized text and too many rows quickly, before writing anything', () => {
    const b = box({ seed: false });
    const started = Date.now();
    expect(b.module.importData({ ...base(), entities: [person({ title: 'x'.repeat(10_000_000) })] }).ok).toBe(false);
    expect(b.module.importData({ ...base(), tombstones: Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, () => ({})) }).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(b.module.status().counts.entity).toBe(0);
  });

  it('refuses wrong shapes everywhere, and never throws', () => {
    const b = box({ seed: false });
    const hostile: unknown[] = [
      null,
      42,
      'a string',
      [],
      { ...base(), format: 'dexnest.ghost_os\u0000' },
      { ...base(), entities: 'nope' },
      { ...base(), entities: [person({ id: '../../etc/passwd' })] },
      { ...base(), entities: [person({ type: 'constructor' })] },
      { ...base(), entities: [person({ tags: [{ toString: 'x' }] })] },
      { ...base(), entities: [person({ provenance: { origin: 'adapter', sourceId: 'adapter:x', sourceRef: 'r', evidence: [], confidence: 1 } })] },
      { ...base(), entities: [person({ createdAt: 'yesterday' })] },
      { ...base(), entities: [person(), person()] },
      { ...base(), tombstones: [{ sourceId: 'adapter:developer_intelligence', sourceRef: 'x'.repeat(10_000), forgottenAt: NOW }] },
    ];
    for (const file of hostile) {
      const r = b.module.importData(file);
      expect(r.ok, JSON.stringify(file)?.slice(0, 80)).toBe(false);
    }
    expect(b.module.status().counts).toEqual({ entity: 0, relation: 0, observation: 0 });
  });

  it('a tombstone in the file for a fact still held here is not applied', async () => {
    const b = box();
    ok(b.module.enableAdapter('developer_intelligence'));
    await b.module.syncNow();
    const r = ok(b.module.importData({ ...base(), tombstones: [{ sourceId: 'adapter:developer_intelligence', sourceRef: 'repo:repo-app', forgottenAt: NOW }, { sourceId: 'adapter:developer_intelligence', sourceRef: 'repo:elsewhere', forgottenAt: NOW }] }));
    expect(r.tombstonesSkipped).toBe(1);
    expect(r.tombstones).toBe(1);
    expect(b.module.store.getEntity(projectIdFor('repo-app'))).toBeDefined();
  });
});

// --- scale -----------------------------------------------------------------------------------

describe('50,000 commits', () => {
  it('syncs to one observation per repository per day, quickly, and a quiet sync after it is cheap', async () => {
    const b = box({ seed: false });
    const repos = Array.from({ length: 20 }, (_, i) => `repo-${String(i).padStart(2, '0')}`);
    for (const id of repos) b.repos.push({ id, roots: [{ path: `/home/dev/${id}` }], discoveredAt: '2025-01-01T00:00:00.000Z' });
    withTransaction(b.handle.db, () => {
      const raw = createEventLog(b.handle.db);
      for (let i = 0; i < 50_000; i++) {
        const repo = repos[i % repos.length] as string;
        raw.append({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', subject: repo, source: 'developer_intelligence', idempotencyKey: `bulk:${i}`, payload: { sha: i.toString(16).padStart(8, '0'), subject: 'x', authorDate: new Date(Date.parse(NOW) - (Math.floor(i / repos.length) % 365) * 86_400_000 - (i % 7) * 3_600_000).toISOString() } });
      }
    });
    ok(b.module.enableAdapter('developer_intelligence'));

    let started = performance.now();
    const [first] = await b.module.syncNow();
    const firstMs = performance.now() - started;
    expect(first?.status).toBe('completed');
    const observations = b.module.status().counts.observation;
    expect(observations).toBeGreaterThan(20 * 300);
    expect(observations).toBeLessThanOrEqual(20 * 366);
    expect(firstMs).toBeLessThan(60_000);

    started = performance.now();
    const [quiet] = await b.module.engine.sync('developer_intelligence', { occurrenceId: 'quiet', trigger: 'manual' }).then((o) => [o]);
    const quietMs = performance.now() - started;
    expect(quiet?.added).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(quietMs).toBeLessThan(firstMs);

    started = performance.now();
    const forgot = ok(b.module.forget({ kind: 'entity', id: projectIdFor('repo-00') }));
    expect(forgot.removed.observation).toBeGreaterThan(300);
    expect(performance.now() - started).toBeLessThan(20_000);

    console.info(`[ghost-os hardening] 50k commits: first sync ${Math.round(firstMs)} ms, quiet sync ${Math.round(quietMs)} ms, ${observations} observations`);
  }, 180_000);

  it('a large export imports back unchanged', async () => {
    const b = box({ seed: false });
    b.repos.push({ id: 'repo-big', roots: [{ path: '/home/dev/big' }], discoveredAt: '2025-01-01T00:00:00.000Z' });
    withTransaction(b.handle.db, () => {
      const raw = createEventLog(b.handle.db);
      for (let i = 0; i < 5_000; i++) {
        raw.append({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', subject: 'repo-big', source: 'developer_intelligence', idempotencyKey: `big:${i}`, payload: { sha: `f${i.toString(16).padStart(7, '0')}`, subject: 'x', authorDate: new Date(Date.parse(NOW) - i * 7_200_000).toISOString() } });
      }
    });
    ok(b.module.enableAdapter('developer_intelligence'));
    await b.module.syncNow();
    const file = JSON.parse(JSON.stringify(b.module.exportData())) as unknown;
    const target = box({ seed: false });
    const r = ok(target.module.importData(file));
    expect(r.added.observation).toBe(b.module.status().counts.observation);
    expect(target.data()).toBe(b.data());
  }, 120_000);
});
