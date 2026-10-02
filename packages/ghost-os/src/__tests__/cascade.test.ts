import { describe, expect, it } from 'vitest';
import { planCascade, refKey, type CascadeReader, type CascadeRowInfo, type RowRef } from '../domain/index.ts';

/** An in-memory graph standing in for the store. */
function graph() {
  const rows = new Map<string, CascadeRowInfo>();
  const relations = new Map<string, { from: string; to: string }>();
  const observations = new Map<string, string>();
  const derivations = new Map<string, RowRef[]>();
  const manual: CascadeRowInfo = { origin: 'manual', sourceId: null, sourceRef: null };
  const g = {
    entity(id: string, info: CascadeRowInfo = manual) {
      rows.set(`entity:${id}`, info);
      return g;
    },
    relation(id: string, from: string, to: string, info: CascadeRowInfo = manual) {
      rows.set(`relation:${id}`, info);
      relations.set(id, { from, to });
      return g;
    },
    observation(id: string, entityId: string, info: CascadeRowInfo = manual) {
      rows.set(`observation:${id}`, info);
      observations.set(id, entityId);
      return g;
    },
    derive(child: RowRef, parent: RowRef) {
      derivations.set(refKey(parent), [...(derivations.get(refKey(parent)) ?? []), child]);
      return g;
    },
    reader(): CascadeReader {
      return {
        info: (ref) => rows.get(refKey(ref)) ?? null,
        relationsTouching: (id) => [...relations].filter(([, r]) => r.from === id || r.to === id).map(([rid]) => rid),
        observationsOf: (id) => [...observations].filter(([, e]) => e === id).map(([oid]) => oid),
        derivedFrom: (ref) => derivations.get(refKey(ref)) ?? [],
      };
    },
  };
  return g;
}

const di = (ref: string): CascadeRowInfo => ({ origin: 'adapter', sourceId: 'adapter:developer_intelligence', sourceRef: ref });
const habitInfo: CascadeRowInfo = { origin: 'derived', sourceId: 'detector:time_of_day', sourceRef: 'time_of_day:commits' };
const keys = (rows: RowRef[]) => rows.map(refKey).sort();

describe('forget cascades', () => {
  it('an entity takes its relations, its observations and everything derived from them', () => {
    const g = graph()
      .entity('ent_project', di('repo:1'))
      .entity('ent_skill', di('skill:ts'))
      .entity('ent_me')
      .entity('ent_habit', habitInfo)
      .relation('rel_uses', 'ent_project', 'ent_skill', di('uses:1:ts'))
      .relation('rel_mine', 'ent_me', 'ent_project')
      .observation('obs_day1', 'ent_project', di('day:1:2026-06-01'))
      .observation('obs_day2', 'ent_project', di('day:1:2026-06-02'))
      .observation('obs_other', 'ent_skill', di('x'))
      .derive({ kind: 'entity', id: 'ent_habit' }, { kind: 'observation', id: 'obs_day1' })
      .derive({ kind: 'entity', id: 'ent_habit' }, { kind: 'observation', id: 'obs_day2' });

    const plan = planCascade(g.reader(), [{ kind: 'entity', id: 'ent_project' }], 'forget');
    expect(keys(plan.rows)).toEqual(
      ['entity:ent_habit', 'entity:ent_project', 'observation:obs_day1', 'observation:obs_day2', 'relation:rel_mine', 'relation:rel_uses'].sort(),
    );
    expect(plan.rows[0]).toEqual({ kind: 'entity', id: 'ent_project' });
    expect(plan.counts).toEqual({ entity: 2, relation: 2, observation: 2 });
  });

  it('one forgotten parent is enough to remove a derived row, and its own dependents go too', () => {
    const g = graph()
      .entity('ent_p', di('repo:1'))
      .observation('obs_a', 'ent_p', di('a'))
      .observation('obs_b', 'ent_p', di('b'))
      .entity('ent_habit', habitInfo)
      .observation('obs_on_habit', 'ent_habit')
      .relation('rel_to_habit', 'ent_p', 'ent_habit')
      .derive({ kind: 'entity', id: 'ent_habit' }, { kind: 'observation', id: 'obs_a' })
      .derive({ kind: 'entity', id: 'ent_habit' }, { kind: 'observation', id: 'obs_b' });
    const plan = planCascade(g.reader(), [{ kind: 'observation', id: 'obs_a' }], 'forget');
    expect(keys(plan.rows)).toEqual(['entity:ent_habit', 'observation:obs_a', 'observation:obs_on_habit', 'relation:rel_to_habit']);
  });

  it('a relation or observation alone takes only what was derived from it', () => {
    const g = graph().entity('ent_a').entity('ent_b').relation('rel_1', 'ent_a', 'ent_b').observation('obs_1', 'ent_a');
    expect(keys(planCascade(g.reader(), [{ kind: 'relation', id: 'rel_1' }], 'forget').rows)).toEqual(['relation:rel_1']);
    expect(keys(planCascade(g.reader(), [{ kind: 'observation', id: 'obs_1' }], 'forget').rows)).toEqual(['observation:obs_1']);
  });

  it('ends on a derivation cycle and lists every row once', () => {
    const g = graph()
      .entity('ent_a', habitInfo)
      .entity('ent_b', { ...habitInfo, sourceRef: 'b' })
      .derive({ kind: 'entity', id: 'ent_a' }, { kind: 'entity', id: 'ent_b' })
      .derive({ kind: 'entity', id: 'ent_b' }, { kind: 'entity', id: 'ent_a' })
      .derive({ kind: 'entity', id: 'ent_a' }, { kind: 'entity', id: 'ent_a' });
    const plan = planCascade(g.reader(), [{ kind: 'entity', id: 'ent_a' }, { kind: 'entity', id: 'ent_a' }], 'forget');
    expect(keys(plan.rows)).toEqual(['entity:ent_a', 'entity:ent_b']);
  });

  it('skips rows that do not exist', () => {
    const plan = planCascade(graph().reader(), [{ kind: 'entity', id: 'ent_missing' }], 'forget');
    expect(plan.rows).toEqual([]);
    expect(plan.tombstones).toEqual([]);
  });

  it('forget tombstones every non-manual row it removes, once each; manual rows need none', () => {
    const g = graph()
      .entity('ent_p', di('repo:1'))
      .entity('ent_me')
      .relation('rel_mine', 'ent_me', 'ent_p')
      .observation('obs_a', 'ent_p', di('a'))
      .observation('obs_dup', 'ent_p', di('a'));
    const plan = planCascade(g.reader(), [{ kind: 'entity', id: 'ent_p' }], 'forget');
    expect(plan.tombstones).toEqual([
      { sourceId: 'adapter:developer_intelligence', sourceRef: 'repo:1' },
      { sourceId: 'adapter:developer_intelligence', sourceRef: 'a' },
    ]);
  });

  it('withdrawing an adapter removes the same rows but leaves no tombstones', () => {
    const g = graph().entity('ent_p', di('repo:1')).observation('obs_a', 'ent_p', di('a'));
    const plan = planCascade(g.reader(), [{ kind: 'entity', id: 'ent_p' }], 'withdraw');
    expect(plan.rows.length).toBe(2);
    expect(plan.tombstones).toEqual([]);
  });

  it('handles a long derivation chain', () => {
    const g = graph().entity('ent_0', di('0'));
    for (let i = 1; i <= 20_000; i++) g.entity(`ent_${i}`, { ...habitInfo, sourceRef: String(i) }).derive({ kind: 'entity', id: `ent_${i}` }, { kind: 'entity', id: `ent_${i - 1}` });
    expect(planCascade(g.reader(), [{ kind: 'entity', id: 'ent_0' }], 'forget').rows.length).toBe(20_001);
  });
});
