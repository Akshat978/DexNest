/**
 * Phase 9: a relation a source stops supporting ends instead of disappearing.
 * It keeps its history (validTo = the sync time); if the source supports it
 * again, that is a new relation from then on. Forget and turning the source
 * off still remove everything.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DI_SOURCE_ID, ENDED_MARK, parseExport, parseTimelineQuery, projectIdFor, skillIdFor, type Relation, type TimelineQuery } from '../index.ts';
import { createWorld, repo, tech, type World } from './world.ts';

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const MARCH = '2026-03-15T10:00:00.000Z';
const MAY = '2026-05-20T10:00:00.000Z';
const JULY = '2026-07-01T10:00:00.000Z';

/** repo-app and repo-cli both use TypeScript, so the skill stays when one of them stops. */
async function started() {
  const w = createWorld();
  worlds.push(w);
  w.repos.push(repo('repo-app', '/home/dev/app', 'app'), repo('repo-cli', '/home/dev/cli', 'cli'));
  w.techs.push(tech('repo-app', 'TypeScript'), tech('repo-cli', 'TypeScript'));
  w.engine.enable('developer_intelligence');
  w.clock.now = '2026-02-01T10:00:00.000Z';
  expect((await w.sync()).status).toBe('completed');
  return w;
}

const cliUsesTs = (w: World): Relation[] =>
  w.store.relationsOf(projectIdFor('repo-cli')).filter((r) => r.toId === skillIdFor('typescript')).sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''));

function stopUsing(w: World) {
  const i = w.techs.findIndex((t) => t.repositoryId === 'repo-cli');
  w.techs.splice(i, 1);
}

describe('a relation the source stops supporting', () => {
  it('ends at the sync time and stays as history, without a tombstone', async () => {
    const w = await started();
    const [live] = cliUsesTs(w);
    expect(live?.validTo).toBeNull();

    stopUsing(w);
    w.clock.now = MARCH;
    const out = await w.sync();
    expect(out.ended).toBe(1);
    expect(out.withdrawn).toEqual({ entity: 0, relation: 0, observation: 0 });

    const [ended] = cliUsesTs(w);
    expect(ended).toMatchObject({ type: 'uses', validTo: MARCH, provenance: { origin: 'adapter', sourceId: DI_SOURCE_ID, confidence: live?.provenance.confidence } });
    expect(ended?.provenance.sourceRef).toBe(`${live?.provenance.sourceRef}${ENDED_MARK}${MARCH}`);
    expect(ended?.id).not.toBe(live?.id);
    expect(w.store.getRelation(live?.id as string)).toBeUndefined();
    expect(w.store.listTombstones()).toEqual([]);
    // The other repository still uses TypeScript: untouched.
    expect(w.store.relationsOf(projectIdFor('repo-app')).map((r) => r.validTo)).toEqual([null]);
  });

  it('an unchanged sync after that changes nothing', async () => {
    const w = await started();
    stopUsing(w);
    w.clock.now = MARCH;
    await w.sync();
    const before = w.store.exportAll(MAY);
    w.clock.now = MAY;
    const out = await w.sync();
    expect(out.ended).toBe(0);
    expect(out.added).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(out.updated).toEqual({ entity: 0, relation: 0, observation: 0 });
    expect(w.store.exportAll(MAY)).toEqual(before);
  });

  it('supported again: a new relation from the time the old one ended; the old one stays ended', async () => {
    const w = await started();
    stopUsing(w);
    w.clock.now = MARCH;
    await w.sync();
    w.techs.push(tech('repo-cli', 'TypeScript'));
    w.clock.now = MAY;
    const back = await w.sync();
    expect(back.added.relation).toBe(1);
    const [old, current] = cliUsesTs(w);
    expect(old).toMatchObject({ validTo: MARCH });
    expect(current).toMatchObject({ validFrom: MARCH, validTo: null });
    // Steady afterwards: the new one keeps its start.
    w.clock.now = JULY;
    await w.sync();
    expect(cliUsesTs(w).map((r) => [r.validFrom, r.validTo])).toEqual([
      [old?.validFrom ?? null, MARCH],
      [MARCH, null],
    ]);

    // Ending again keeps both periods.
    stopUsing(w);
    await w.sync();
    expect(cliUsesTs(w).map((r) => [r.validFrom, r.validTo])).toEqual([
      [old?.validFrom ?? null, MARCH],
      [MARCH, JULY],
    ]);
  });

  it('a relation whose entry goes away goes with it (history needs both ends)', async () => {
    const w = await started();
    w.repos.splice(1, 1);
    w.clock.now = MARCH;
    const out = await w.sync();
    expect(out.ended).toBe(0);
    expect(out.withdrawn).toEqual({ entity: 1, relation: 1, observation: 0 });
  });

  it('a relation you entered is never ended by a sync', async () => {
    const w = await started();
    const me = { id: 'ent_me000001', type: 'person' as const, title: 'Me', notes: '', tags: [], details: {}, occurredAt: null, startedAt: null, endedAt: null, provenance: { origin: 'manual' as const, sourceId: null, sourceRef: null, evidence: [{ kind: 'manual' as const }], confidence: 1 }, createdAt: MARCH, updatedAt: MARCH };
    w.store.putEntity(me);
    w.store.putRelation({ id: 'rel_mine0001', fromId: me.id, toId: projectIdFor('repo-cli'), type: 'worked_on', strength: 1, validFrom: null, validTo: null, notes: '', provenance: me.provenance, createdAt: MARCH, updatedAt: MARCH });
    w.clock.now = MAY;
    await w.sync();
    expect(w.store.getRelation('rel_mine0001')?.validTo).toBeNull();
  });
});

describe('forget and turning the source off still remove everything', () => {
  it('forgetting an entry removes its ended relations too', async () => {
    const w = await started();
    stopUsing(w);
    w.clock.now = MARCH;
    await w.sync();
    const plan = w.store.forget({ kind: 'entity', id: projectIdFor('repo-cli') }, MAY);
    expect(plan.counts.relation).toBe(1);
    expect(w.store.relationsOf(skillIdFor('typescript')).map((r) => r.fromId)).toEqual([projectIdFor('repo-app')]);
  });

  it('an ended relation can be forgotten on its own', async () => {
    const w = await started();
    stopUsing(w);
    w.clock.now = MARCH;
    await w.sync();
    const [ended] = cliUsesTs(w);
    w.store.forget({ kind: 'relation', id: ended?.id as string }, MAY);
    expect(cliUsesTs(w)).toEqual([]);
    // Re-support after forgetting the history: a fresh relation, nothing brought back.
    w.techs.push(tech('repo-cli', 'TypeScript'));
    w.clock.now = JULY;
    await w.sync();
    expect(cliUsesTs(w).map((r) => r.validTo)).toEqual([null]);
  });

  it('turning the source off removes ended relations with everything else', async () => {
    const w = await started();
    stopUsing(w);
    w.clock.now = MARCH;
    await w.sync();
    w.engine.disable('developer_intelligence');
    expect(w.store.counts()).toEqual({ entity: 0, relation: 0, observation: 0 });
  });
});

describe('timeline and export', () => {
  const q = (input: unknown): TimelineQuery => {
    const r = parseTimelineQuery(input);
    if (!r.ok) throw new Error(r.errors.join());
    return r.value;
  };

  it('the timeline shows an ended relation when it ended, and can leave it out', async () => {
    const w = await started();
    stopUsing(w);
    w.clock.now = MARCH;
    await w.sync();
    const items = w.store.timeline(q({}));
    const ended = items.find((i) => i.kind === 'relation');
    expect(ended).toMatchObject({ at: MARCH, entityId: projectIdFor('repo-cli'), entityType: 'project', title: 'cli', statement: 'uses TypeScript', origin: 'adapter' });
    expect(w.store.timeline(q({ relations: false })).some((i) => i.kind === 'relation')).toBe(false);
    expect(w.store.timeline(q({ types: ['skill'] })).some((i) => i.kind === 'relation')).toBe(false);
    expect(w.store.timeline(q({ from: '2026-04-01T00:00:00Z' })).some((i) => i.kind === 'relation')).toBe(false);
    // Paging past a relation item works.
    const page = w.store.timeline(q({ limit: 1, before: { at: MARCH, id: ended?.id } }));
    expect(page.every((i) => i.at <= MARCH)).toBe(true);
  });

  it('export and import keep an ended relation ended', async () => {
    const w = await started();
    stopUsing(w);
    w.clock.now = MARCH;
    await w.sync();
    expect(cliUsesTs(w).map((r) => r.validTo)).toEqual([MARCH]);
    const data = JSON.parse(JSON.stringify(w.store.exportAll(MAY))) as unknown;
    const parsed = parseExport(data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const target = createWorld();
    worlds.push(target);
    target.store.importAll(parsed.value);
    expect(cliUsesTs(target).map((r) => [r.id, r.validTo, r.provenance.sourceRef])).toEqual(cliUsesTs(w).map((r) => [r.id, r.validTo, r.provenance.sourceRef]));
    expect(target.store.exportAll(MAY)).toEqual(w.store.exportAll(MAY));
  });
});
