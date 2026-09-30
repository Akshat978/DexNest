/** Synthetic rows for tests. No real data, nothing read from disk. */

import type { Entity, Evidence, Observation, Provenance, Relation } from '../domain/index.ts';

export const T0 = '2026-06-01T09:00:00.000Z';

export const manual = (): Provenance => ({ origin: 'manual', sourceId: null, sourceRef: null, evidence: [{ kind: 'manual' }], confidence: 1 });

export const fromDi = (sourceRef: string, evidence: Evidence[] = [{ kind: 'repository', repositoryId: 'repo-1' }], confidence = 1): Provenance => ({
  origin: 'adapter',
  sourceId: 'adapter:developer_intelligence',
  sourceRef,
  evidence,
  confidence,
});

export function entity(over: Partial<Entity> = {}): Entity {
  return {
    id: 'ent_00000001',
    type: 'project',
    title: 'App',
    notes: '',
    tags: [],
    details: {},
    occurredAt: null,
    startedAt: null,
    endedAt: null,
    provenance: manual(),
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function relation(over: Partial<Relation> = {}): Relation {
  return {
    id: 'rel_00000001',
    fromId: 'ent_00000001',
    toId: 'ent_00000002',
    type: 'uses',
    strength: 1,
    validFrom: null,
    validTo: null,
    notes: '',
    provenance: manual(),
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function observation(over: Partial<Observation> = {}): Observation {
  return {
    id: 'obs_00000001',
    entityId: 'ent_00000001',
    statement: 'shipped v1',
    observedAt: T0,
    provenance: manual(),
    createdAt: T0,
    ...over,
  };
}
