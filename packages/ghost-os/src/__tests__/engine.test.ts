import { afterEach, describe, expect, it } from 'vitest';
import { DI_SOURCE_ID, dayObservationIdFor, detectorSourceId, projectIdFor, skillIdFor, sourceRowId, type HabitDetails } from '../index.ts';
import { createWorld, daysBefore, repo, tech, type World } from './world.ts';

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

function world(options?: Parameters<typeof createWorld>[0]) {
  const w = createWorld(options);
  worlds.push(w);
  return w;
}

/** Two repositories, a few technologies, commits on two days. */
function seeded(options?: Parameters<typeof createWorld>[0]) {
  const w = world(options);
  w.repos.push(repo('repo-app', '/home/dev/app', 'app'), repo('repo-cli', 'C:\\code\\cli'));
  w.techs.push(
    tech('repo-app', 'TypeScript'),
    tech('repo-cli', 'typescript', { evidenceKind: 'file-extension', evidencePath: 'src/main.ts' }),
    tech('repo-cli', 'Rust', { evidenceKind: 'file-extension', evidencePath: 'src/lib.rs' }),
    tech('repo-app', 'pnpm', { category: 'packageManager', evidencePath: 'package.json', evidenceKind: 'package.json#packageManager' }),
    tech('repo-app', 'react', { category: 'library', evidenceKind: 'package.json#dependencies' }),
    tech('repo-app', 'Go', { status: 'removed' }),
  );
  w.commit('repo-app', 'aaaaaaa', '2026-06-01T09:00:00.000Z');
  w.commit('repo-app', 'bbbbbbb', '2026-06-01T15:00:00.000Z');
  w.commit('repo-app', 'ccccccc', '2026-06-02T10:00:00.000Z');
  w.commit('repo-cli', 'ddddddd', '2026-06-02T11:00:00.000Z');
  return w;
}

const obsCount = (w: World) => w.store.sourceRowIds('observation', DI_SOURCE_ID).length;

describe('off by default', () => {
  it('reads nothing and writes nothing until the adapter is turned on', async () => {
    const w = seeded();
    const out = await w.sync();
    expect(out).toMatchObject({ status: 'skipped', reason: 'adapter is off' });
    expect(w.queries).toEqual([]);
    expect(w.techRequests).toEqual([]);
    expect(w.store.counts()).toEqual({ entity: 0, relation: 0, observation: 0 });
  });
});

describe('Developer Intelligence sync', () => {
  it('repositories become projects, technologies skills, commits one observation per repository per day', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    const out = await w.sync();
    expect(out.status).toBe('completed');
    expect(out.added).toEqual({ entity: 5, relation: 4, observation: 3 });

    expect(w.store.getEntity(projectIdFor('repo-app'))).toMatchObject({ type: 'project', title: 'app', provenance: { origin: 'adapter', confidence: 1, evidence: [{ kind: 'repository', repositoryId: 'repo-app' }] } });
    expect(w.store.getEntity(projectIdFor('repo-cli'))?.title).toBe('cli');

    // One TypeScript skill across both repositories; the manifest makes it 0.9, the extension-only repo's relation 0.7.
    const ts = w.store.getEntity(skillIdFor('typescript'));
    expect(ts).toMatchObject({ type: 'skill', title: 'TypeScript', provenance: { confidence: 0.9 } });
    expect(ts?.provenance.evidence.length).toBe(2);
    const rels = w.store.relationsOf(skillIdFor('typescript'));
    expect(rels.map((r) => [r.fromId, r.type, r.provenance.confidence]).sort()).toEqual([
      [projectIdFor('repo-app'), 'uses', 0.9],
      [projectIdFor('repo-cli'), 'uses', 0.7],
    ]);
    expect(w.store.getEntity(skillIdFor('rust'))?.provenance.confidence).toBe(0.7);
    expect(w.store.getEntity(skillIdFor('pnpm'))).toBeDefined();
    // Libraries and removed facts are not skills.
    expect(w.store.getEntity(skillIdFor('react'))).toBeUndefined();
    expect(w.store.getEntity(skillIdFor('go'))).toBeUndefined();

    const day = w.store.getObservation(dayObservationIdFor('repo-app', '2026-06-01'));
    expect(day).toMatchObject({ entityId: projectIdFor('repo-app'), statement: '2 commits observed', observedAt: '2026-06-01T15:00:00.000Z', provenance: { confidence: 0.6 } });
    expect(day?.provenance.evidence.map((e) => (e.kind === 'commit' ? e.sha : ''))).toEqual(['aaaaaaa', 'bbbbbbb']);
  });

  it('the same occurrence twice does the work once', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    const first = await w.sync('sync:2026-06-30T12:00');
    const before = w.dump();
    const second = await w.sync('sync:2026-06-30T12:00');
    expect(first.status).toBe('completed');
    expect(second).toMatchObject({ status: 'skipped', reason: 'this occurrence already ran' });
    expect(w.dump()).toBe(before);
  });

  it('a later sync reads only new commits, merges them by sha, and changes nothing else', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    await w.sync();
    const again = await w.sync();
    expect(again.added).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(again.updated).toEqual({ entity: 0, relation: 0, observation: 0 });

    w.commit('repo-app', 'eeeeeee', '2026-06-01T20:00:00.000Z');
    w.commit('repo-app', 'aaaaaaa', '2026-06-01T09:00:00.000Z'); // seen again
    const third = await w.sync();
    expect(third.updated.observation).toBe(1);
    expect(w.store.getObservation(dayObservationIdFor('repo-app', '2026-06-01'))?.statement).toBe('3 commits observed');
    const lastQuery = w.queries[w.queries.length - 1];
    expect(lastQuery?.afterSeq).toBeGreaterThan(0);
  });

  it('reads commits page by page', async () => {
    const w = world({ pageSize: 2 });
    w.repos.push(repo('repo-app', '/home/dev/app'));
    for (let i = 0; i < 7; i++) w.commit('repo-app', `abcdef${i}`, `2026-06-0${i + 1}T10:00:00.000Z`);
    w.engine.enable('developer_intelligence');
    await w.sync();
    expect(obsCount(w)).toBe(7);
  });

  it('a project GhostOS did not hold yet gets its whole commit history', async () => {
    const w = world();
    w.repos.push(repo('repo-app', '/home/dev/app'));
    w.commit('repo-new', '1111111', '2026-06-01T10:00:00.000Z');
    w.engine.enable('developer_intelligence');
    await w.sync();
    expect(obsCount(w)).toBe(0); // the cursor has passed repo-new's commit

    w.repos.push(repo('repo-new', '/home/dev/new'));
    await w.sync();
    expect(w.store.getObservation(dayObservationIdFor('repo-new', '2026-06-01'))?.statement).toBe('1 commit observed');
  });

  it('starts over when the log\'s seqs go backwards, without counting anything twice', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    await w.sync();
    w.store.recordAdapterSync('developer_intelligence', '999999', w.store.getAdapter('developer_intelligence').counts, w.clock.now);
    await w.sync();
    expect(w.queries.some((q) => q.afterSeq === 0)).toBe(true);
    expect(w.store.getObservation(dayObservationIdFor('repo-app', '2026-06-01'))?.statement).toBe('2 commits observed');
  });

  it('leaves out a repository inside DexNest\'s data: no technologies asked for, no commits kept', async () => {
    const w = seeded({ isSensitive: (p) => p.startsWith('C:\\code') });
    w.engine.enable('developer_intelligence');
    const out = await w.sync();
    expect(out.skippedSource).toBe(1);
    expect(w.techRequests).toEqual(['repo-app']);
    expect(w.store.getEntity(projectIdFor('repo-cli'))).toBeUndefined();
    expect(w.store.getEntity(skillIdFor('rust'))).toBeUndefined();
    expect(w.store.getObservation(dayObservationIdFor('repo-cli', '2026-06-02'))).toBeUndefined();
  });

  it('withdraws what DI no longer supports, without tombstones', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    await w.sync();
    w.repos.splice(1, 1); // repo-cli is gone from DI
    const out = await w.sync();
    expect(out.withdrawn).toEqual({ entity: 2, relation: 2, observation: 1 }); // the project, Rust, both of its uses, its day
    expect(w.store.getEntity(projectIdFor('repo-cli'))).toBeUndefined();
    expect(w.store.getEntity(skillIdFor('typescript'))).toBeDefined();
    expect(w.store.listTombstones()).toEqual([]);
  });
});

describe('forget and adapters', () => {
  it('a re-sync does not bring back what was forgotten', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    await w.sync();
    w.store.forget({ kind: 'entity', id: projectIdFor('repo-cli') }, w.clock.now);
    w.store.forget({ kind: 'entity', id: skillIdFor('pnpm') }, w.clock.now);
    w.commit('repo-cli', '2222222', '2026-06-03T10:00:00.000Z');
    const out = await w.sync();
    expect(out.added).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(out.skippedForgotten).toBeGreaterThan(0);
    expect(w.store.getEntity(projectIdFor('repo-cli'))).toBeUndefined();
    expect(w.store.getEntity(skillIdFor('pnpm'))).toBeUndefined();
    expect(w.store.getObservation(dayObservationIdFor('repo-cli', '2026-06-03'))).toBeUndefined();
  });

  it('turning the adapter off removes everything it contributed, habits included; on again reads from the start and keeps what was forgotten', async () => {
    const w = world();
    w.repos.push(repo('repo-app', '/home/dev/app'), repo('repo-old', '/home/dev/old'));
    w.techs.push(tech('repo-app', 'TypeScript'));
    for (let i = 0; i < 12; i++) w.commit('repo-app', `a1b2c3${String(i).padStart(2, '0')}`, daysBefore(w.clock.now, i, '19:30'));
    const mine = { id: 'ent_me000001', type: 'person' as const, title: 'Me', notes: '', tags: [], details: {}, occurredAt: null, startedAt: null, endedAt: null, provenance: { origin: 'manual' as const, sourceId: null, sourceRef: null, evidence: [{ kind: 'manual' as const }], confidence: 1 }, createdAt: w.clock.now, updatedAt: w.clock.now };
    w.store.putEntity(mine);
    w.engine.enable('developer_intelligence');
    const first = await w.sync();
    expect(first.habits.map((h) => h.detectorId)).toContain('time_of_day');
    w.store.forget({ kind: 'entity', id: projectIdFor('repo-old') }, w.clock.now);

    const off = w.engine.disable('developer_intelligence');
    expect(off.removed.entity).toBe(3); // app, TypeScript, the habit
    expect(w.store.counts()).toEqual({ entity: 1, relation: 0, observation: 0 });
    expect(w.store.getAdapter('developer_intelligence')).toMatchObject({ enabled: false, cursor: null });
    expect(await w.sync()).toMatchObject({ status: 'skipped', reason: 'adapter is off' });

    w.engine.enable('developer_intelligence');
    const back = await w.sync();
    expect(back.added.observation).toBe(12);
    expect(w.store.getEntity(projectIdFor('repo-old'))).toBeUndefined();
  });
});

describe('habits', () => {
  function evenings(w: World, days: number) {
    w.repos.push(repo('repo-app', '/home/dev/app'));
    for (let i = 0; i < days; i++) w.commit('repo-app', `fedcba${String(i).padStart(2, '0')}`, daysBefore(w.clock.now, i, '20:00'));
  }
  const habitId = sourceRowId('entity', detectorSourceId('time_of_day'), 'time_of_day:commits');

  it('detects an evidence-backed habit and links it to the observations it counted', async () => {
    const w = world();
    evenings(w, 10);
    w.engine.enable('developer_intelligence');
    const out = await w.sync();
    const h = out.habits.find((x) => x.detectorId === 'time_of_day');
    expect(h).toMatchObject({ id: habitId, evidenceCount: 10, status: 'created', confidence: 0.95 });
    const habit = w.store.getEntity(habitId);
    expect(habit?.provenance.origin).toBe('derived');
    expect((habit?.details as HabitDetails).mode).toBe('detected');
    expect(w.store.derivationsOf({ kind: 'entity', id: habitId }).length).toBe(10);
  });

  it('seven evenings are not a habit', async () => {
    const w = world();
    evenings(w, 7);
    w.engine.enable('developer_intelligence');
    expect((await w.sync()).habits).toEqual([]);
    expect(w.store.getEntity(habitId)).toBeUndefined();
  });

  it('forgetting evidence removes the habit, and a forgotten habit stays forgotten', async () => {
    const w = world();
    evenings(w, 10);
    w.engine.enable('developer_intelligence');
    await w.sync();
    const day = w.store.derivationsOf({ kind: 'entity', id: habitId })[0]!;
    w.store.forget(day, w.clock.now);
    expect(w.store.getEntity(habitId)).toBeUndefined();
    const out = await w.sync();
    expect(out.habits.find((h) => h.id === habitId)?.status).toBe('forgotten');
    expect(w.store.getEntity(habitId)).toBeUndefined();
  });

  it('a habit that no longer holds is removed', async () => {
    const w = world();
    evenings(w, 10);
    w.engine.enable('developer_intelligence');
    await w.sync();
    w.clock.now = '2026-09-30T12:00:00.000Z';
    const out = await w.sync();
    expect(out.habitsLapsed).toBe(1);
    expect(w.store.getEntity(habitId)).toBeUndefined();
    expect(w.store.listTombstones()).toEqual([]);
  });
});

describe('failures', () => {
  it('a failed read writes nothing and records the run as failed', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    w.failReads.on = true;
    const out = await w.sync('sync:x');
    expect(out).toMatchObject({ status: 'failed', reason: 'DI store unavailable' });
    expect(w.store.counts()).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(w.store.getRunByOccurrence('sync:x')).toMatchObject({ status: 'failed', error: 'DI store unavailable' });
  });

  it('a failure while committing rolls the whole sync back', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    const out = await w.engine.sync('developer_intelligence', {
      occurrenceId: 'sync:y',
      trigger: 'manual',
      withinTransaction: () => {
        throw new Error('event log full');
      },
    });
    expect(out.status).toBe('failed');
    expect(w.store.counts()).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(w.store.getAdapter('developer_intelligence').cursor).toBeNull();
  });

  it('turned off while reading: nothing is written', async () => {
    const w = seeded();
    w.engine.enable('developer_intelligence');
    w.duringNextRead.hook = () => w.engine.disable('developer_intelligence');
    const out = await w.sync();
    expect(out).toMatchObject({ status: 'skipped', reason: 'adapter turned off during sync' });
    expect(w.store.counts()).toEqual({ entity: 0, relation: 0, observation: 0 });
  });
});
