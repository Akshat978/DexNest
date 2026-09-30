import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE,
  ENTITY_TYPES,
  isAbsoluteFilePath,
  parseDecisionOutcome,
  parseEntityInput,
  parseObservationInput,
  parseRelationInput,
  validateEntity,
  validateObservation,
  validateRelation,
  withOutcome,
  type DecisionDetails,
  type FileDetails,
  type HabitDetails,
} from '../domain/index.ts';
import { T0, entity, fromDi, manual, observation, relation } from './fixtures.ts';

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r.errors ?? []));

describe('manual entity input', () => {
  it('accepts every type with its details', () => {
    const details: Record<string, unknown> = {
      memory: { text: 'first day', occurredAt: '2026-05-01T10:00:00Z' },
      event: { occurredAt: '2026-05-01T10:00:00Z' },
      decision: { decidedAt: '2026-05-01T10:00:00Z', choice: 'SQLite', alternatives: ['Postgres', 'Postgres', 'files'], rationale: 'local' },
      habit: { cadence: 'daily' },
      file: { path: 'D:\\Notes\\plan.md', label: 'plan' },
      conversation: { text: 'A: hi\nB: hello', participants: ['A', 'B'] },
    };
    for (const type of ENTITY_TYPES) {
      const r = parseEntityInput({ type, title: `a ${type}`, details: details[type] }, T0);
      expect(errorsOf(r), type).toEqual([]);
    }
  });

  it('trims, lowercases and deduplicates tags, and refuses odd ones', () => {
    const r = parseEntityInput({ type: 'skill', title: 'Rust', tags: ['Systems', ' systems ', 'Low Level'] }, T0);
    expect(r.ok && r.value.tags).toEqual(['low level', 'systems']);
    expect(errorsOf(parseEntityInput({ type: 'skill', title: 'x', tags: ['#bad'] }, T0))).not.toEqual([]);
    expect(errorsOf(parseEntityInput({ type: 'skill', title: 'x', tags: 'rust' }, T0))).not.toEqual([]);
  });

  it('requires a title and a known type, and refuses control characters', () => {
    expect(errorsOf(parseEntityInput({ type: 'skill', title: '  ' }, T0))).toContain('title is required');
    expect(errorsOf(parseEntityInput({ type: 'robot', title: 'x' }, T0)).join()).toMatch(/type must be one of/);
    expect(errorsOf(parseEntityInput({ type: 'skill', title: 'a\u0000b' }, T0)).join()).toMatch(/control/);
  });

  it('takes the timeline time from the details for point-in-time types', () => {
    const r = parseEntityInput({ type: 'memory', title: 'm', details: { text: 't', occurredAt: '2026-05-01T12:00:00+02:00' } }, T0);
    expect(r.ok && r.value.occurredAt).toBe('2026-05-01T10:00:00.000Z');
    const d = parseEntityInput({ type: 'decision', title: 'd', details: { decidedAt: '2026-04-01T00:00:00Z', choice: 'x' } }, T0);
    expect(d.ok && d.value.occurredAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('refuses details a type does not have, and bad times', () => {
    expect(errorsOf(parseEntityInput({ type: 'person', title: 'p', details: { text: 'x' } }, T0))).toContain('a person has no details');
    expect(errorsOf(parseEntityInput({ type: 'event', title: 'e', details: { occurredAt: 'yesterday' } }, T0)).join()).toMatch(/ISO 8601/);
    expect(errorsOf(parseEntityInput({ type: 'project', title: 'p', startedAt: '2026-05-02T00:00:00Z', endedAt: '2026-05-01T00:00:00Z' }, T0))).toContain('endedAt is before startedAt');
  });

  it('a habit the owner enters is declared; it cannot claim to be detected', () => {
    const r = parseEntityInput({ type: 'habit', title: 'h', details: { cadence: 'weekly' } }, T0);
    expect(r.ok && (r.value.details as HabitDetails).mode).toBe('declared');
    expect(errorsOf(parseEntityInput({ type: 'habit', title: 'h', details: { cadence: 'weekly', mode: 'detected' } }, T0)).join()).toMatch(/declared/);
  });

  it('a file is a path and a label, the path absolute', () => {
    const r = parseEntityInput({ type: 'file', title: 'f', details: { path: '/home/me/a.txt', label: 'a' } }, T0);
    expect(r.ok && (r.value.details as FileDetails)).toEqual({ path: '/home/me/a.txt', label: 'a' });
    expect(errorsOf(parseEntityInput({ type: 'file', title: 'f', details: { path: 'notes/a.txt' } }, T0))).toContain('path must be absolute');
    expect(isAbsoluteFilePath('C:\\x')).toBe(true);
    expect(isAbsoluteFilePath('\\\\server\\share\\x')).toBe(true);
    expect(isAbsoluteFilePath('..\\x')).toBe(false);
  });

  it('a pasted conversation is stamped now and labelled pasted', () => {
    const r = parseEntityInput({ type: 'conversation', title: 'c', details: { text: 'hi', importedAt: '2020-01-01T00:00:00Z' } }, T0);
    expect(r.ok && r.value.details).toMatchObject({ importedAt: T0, sourceLabel: 'pasted' });
  });
});

describe('provenance: a fact with no evidence does not exist', () => {
  it('accepts a manual row and an adapter row with evidence', () => {
    expect(errorsOf(validateEntity(entity()))).toEqual([]);
    expect(errorsOf(validateEntity(entity({ provenance: fromDi('repo:repo-1') })))).toEqual([]);
  });

  it('refuses an adapter fact with no evidence', () => {
    expect(errorsOf(validateEntity(entity({ provenance: fromDi('repo:repo-1', []) })))).toContain('a fact with no evidence does not exist');
    expect(errorsOf(validateRelation(relation({ provenance: fromDi('uses:1', []) })))).toContain('a fact with no evidence does not exist');
    expect(errorsOf(validateObservation(observation({ provenance: fromDi('day:1', []) })))).toContain('a fact with no evidence does not exist');
  });

  it('refuses a derived fact with no evidence', () => {
    const habit = entity({
      type: 'habit',
      details: { cadence: 'daily', mode: 'detected', detectorId: 'time_of_day', parameters: {} },
      provenance: { origin: 'derived', sourceId: 'detector:time_of_day', sourceRef: 'time_of_day:commits', evidence: [], confidence: 0.8 },
    });
    expect(errorsOf(validateEntity(habit))).toContain('a fact with no evidence does not exist');
    const withEvidence = { ...habit, provenance: { ...habit.provenance, evidence: [{ kind: 'observation' as const, observationId: 'obs_00000009' }] } };
    expect(errorsOf(validateEntity(withEvidence))).toEqual([]);
  });

  it('refuses confidence outside 0..1, zero for a non-manual fact, and a derived fact above the ceiling', () => {
    expect(errorsOf(validateEntity(entity({ provenance: fromDi('r', undefined, 1.2) }))).join()).toMatch(/0 to 1/);
    expect(errorsOf(validateEntity(entity({ provenance: fromDi('r', undefined, -0.1) }))).join()).toMatch(/0 to 1/);
    expect(errorsOf(validateEntity(entity({ provenance: fromDi('r', undefined, 0) })))).toContain('provenance.confidence must be above 0');
    expect(errorsOf(validateEntity(entity({ provenance: { ...manual(), confidence: Number.NaN } }))).join()).toMatch(/0 to 1/);
    const habit = entity({
      type: 'habit',
      details: { cadence: 'daily', mode: 'detected', detectorId: 'time_of_day', parameters: {} },
      provenance: { origin: 'derived', sourceId: 'detector:time_of_day', sourceRef: 'x', evidence: [{ kind: 'observation', observationId: 'obs_00000009' }], confidence: 0.99 },
    });
    expect(errorsOf(validateEntity(habit)).join()).toMatch(new RegExp(`never more than ${CONFIDENCE.habitCeiling}`));
  });

  it('only the owner gives manual evidence, and a manual row says so', () => {
    expect(errorsOf(validateEntity(entity({ provenance: fromDi('r', [{ kind: 'manual' }]) })))).toContain('only the owner can give manual evidence');
    expect(errorsOf(validateEntity(entity({ provenance: { ...manual(), evidence: [{ kind: 'repository', repositoryId: 'r' }] } })))).toContain(
      'a manual row carries exactly the manual evidence',
    );
    expect(errorsOf(validateEntity(entity({ provenance: { ...manual(), sourceId: 'adapter:developer_intelligence' } })))).toContain('a manual row has no source id or reference');
  });

  it('checks the source id against the origin and the evidence shape', () => {
    expect(errorsOf(validateEntity(entity({ provenance: { ...fromDi('r'), sourceId: 'detector:x' } }))).join()).toMatch(/adapter:<id>/);
    expect(errorsOf(validateEntity(entity({ provenance: fromDi('r', [{ kind: 'commit', repositoryId: 'r', sha: 'XYZ', at: T0 }]) }))).join()).toMatch(/sha/);
    expect(errorsOf(validateEntity(entity({ provenance: { ...fromDi('r'), evidence: [{ kind: 'shell' }] } as never })))).toContain('evidence kind is unknown');
  });

  it('only habits are derived, and only derived habits are detected', () => {
    const derivedProject = entity({ provenance: { origin: 'derived', sourceId: 'detector:x', sourceRef: 'x', evidence: [{ kind: 'observation', observationId: 'obs_00000009' }], confidence: 0.5 } });
    expect(errorsOf(validateEntity(derivedProject))).toContain('GhostOS derives habits only');
    const fakeDetected = entity({ type: 'habit', details: { cadence: 'daily', mode: 'detected', detectorId: 'time_of_day', parameters: {} } });
    expect(errorsOf(validateEntity(fakeDetected))).toContain('only a derived habit is detected');
  });
});

describe('relations', () => {
  it('parses owner input with defaults', () => {
    const r = parseRelationInput({ fromId: 'ent_00000001', toId: 'ent_00000002', type: 'worked_on' });
    expect(r.ok && r.value).toMatchObject({ id: null, strength: 1, validFrom: null, validTo: null });
  });

  it('accepts free-form lowercase types and refuses others', () => {
    expect(errorsOf(parseRelationInput({ fromId: 'ent_00000001', toId: 'ent_00000002', type: 'mentored_by' }))).toEqual([]);
    for (const type of ['Uses', 'uses-it', '1uses', '', 'a'.repeat(41)]) {
      expect(errorsOf(parseRelationInput({ fromId: 'ent_00000001', toId: 'ent_00000002', type })), type).not.toEqual([]);
    }
  });

  it('refuses self-relations, bad strength and an inverted validity range', () => {
    expect(errorsOf(parseRelationInput({ fromId: 'ent_00000001', toId: 'ent_00000001', type: 'uses' }))).toContain('a relation joins two different entities');
    expect(errorsOf(parseRelationInput({ fromId: 'ent_00000001', toId: 'ent_00000002', type: 'uses', strength: 2 })).join()).toMatch(/strength/);
    expect(errorsOf(parseRelationInput({ fromId: 'ent_00000001', toId: 'ent_00000002', type: 'uses', validFrom: '2026-02-01T00:00:00Z', validTo: '2026-01-01T00:00:00Z' }))).toContain(
      'validTo is before validFrom',
    );
  });
});

describe('observations', () => {
  it('parses owner input, defaulting the time to now and confidence to 1', () => {
    const r = parseObservationInput({ entityId: 'ent_00000001', statement: 'finished the course' }, T0);
    expect(r.ok && r.value).toEqual({ entityId: 'ent_00000001', statement: 'finished the course', observedAt: T0, confidence: 1 });
  });

  it('refuses a missing statement or entity', () => {
    expect(errorsOf(parseObservationInput({ entityId: 'nope', statement: '' }, T0)).length).toBe(2);
  });
});

describe('decisions', () => {
  const details: DecisionDetails = { decidedAt: '2026-05-01T00:00:00.000Z', choice: 'x', alternatives: [], rationale: '', outcome: null, outcomeAt: null, reviewAt: null };

  it('records an outcome later', () => {
    const o = parseDecisionOutcome({ id: 'ent_00000001', outcome: 'worked out' }, T0);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const r = withOutcome(details, o.value);
    expect(r.ok && r.value).toMatchObject({ outcome: 'worked out', outcomeAt: T0 });
  });

  it('refuses an outcome dated before the decision', () => {
    const o = parseDecisionOutcome({ id: 'ent_00000001', outcome: 'x', outcomeAt: '2026-04-01T00:00:00Z' }, T0);
    expect(o.ok && withOutcome(details, o.value).ok).toBe(false);
  });
});
