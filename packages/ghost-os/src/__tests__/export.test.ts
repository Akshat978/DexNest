import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, EXPORT_VERSION, IMPORT_LIMITS, parseExport, type GhostExport } from '../domain/index.ts';
import { T0, entity, fromDi, observation, relation } from './fixtures.ts';

function sample(): GhostExport {
  const habit = entity({
    id: 'ent_habit001',
    type: 'habit',
    title: 'Commits mostly in the evening',
    details: { cadence: 'daily', mode: 'detected', detectorId: 'time_of_day', parameters: { days: 8 } },
    provenance: { origin: 'derived', sourceId: 'detector:time_of_day', sourceRef: 'time_of_day:commits', evidence: [{ kind: 'observation', observationId: 'obs_00000002' }], confidence: 0.8 },
  });
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: T0,
    entities: [
      entity({ id: 'ent_00000001', tags: ['work'] }),
      entity({ id: 'ent_00000002', type: 'skill', title: 'TypeScript', provenance: fromDi('skill:typescript', [{ kind: 'technology', factId: 'f1', repositoryId: 'repo-1', evidencePath: 'package.json', evidenceKind: 'package.json' }], 0.9) }),
      entity({ id: 'ent_file0001', type: 'file', title: 'plan', details: { path: '/home/me/plan.md', label: 'plan' } }),
      habit,
    ],
    relations: [relation({ id: 'rel_00000001', fromId: 'ent_00000001', toId: 'ent_00000002' })],
    observations: [
      observation({ id: 'obs_00000001', entityId: 'ent_00000001' }),
      observation({ id: 'obs_00000002', entityId: 'ent_00000001', statement: 'commits observed', provenance: fromDi('day:repo-1:2026-06-01', [{ kind: 'commit', repositoryId: 'repo-1', sha: 'abcdef1', at: T0 }], 0.6) }),
    ],
    derivations: [{ child: { kind: 'entity', id: 'ent_habit001' }, parent: { kind: 'observation', id: 'obs_00000002' } }],
    tombstones: [{ sourceId: 'adapter:developer_intelligence', sourceRef: 'repo:gone', forgottenAt: T0 }],
  };
}

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r.errors ?? []));

describe('export file', () => {
  it('round-trips through JSON unchanged', () => {
    const data = sample();
    const r = parseExport(JSON.parse(JSON.stringify(data)));
    expect(errorsOf(r)).toEqual([]);
    expect(r.ok && r.value.data).toEqual(data);
    expect(r.ok && r.value.filePaths).toEqual(['/home/me/plan.md']);
    expect(r.ok && r.value.externalEntityIds).toEqual([]);
  });

  it('refuses anything that is not a GhostOS export of this version', () => {
    expect(errorsOf(parseExport([]))).toEqual(['the file is not a GhostOS export']);
    expect(errorsOf(parseExport({ ...sample(), format: 'other' }))).toEqual(['the file is not a GhostOS export']);
    expect(errorsOf(parseExport({ ...sample(), version: 2 }))[0]).toMatch(/version is not supported/);
  });

  it('one bad row refuses the whole file', () => {
    const data = sample();
    const bad = { ...data, observations: [...data.observations, observation({ id: 'obs_00000003', provenance: fromDi('x', []) })] };
    const r = parseExport(bad);
    expect(r.ok).toBe(false);
    expect(errorsOf(r).join()).toMatch(/observations\[2\].*no evidence/);
  });

  it('refuses duplicate ids and derivations pointing outside the file', () => {
    const data = sample();
    expect(errorsOf(parseExport({ ...data, entities: [...data.entities, data.entities[0]] })).join()).toMatch(/duplicate id/);
    const outside = { ...data, derivations: [...data.derivations, { child: { kind: 'entity', id: 'ent_habit001' }, parent: { kind: 'entity', id: 'ent_elsewhere' } }] };
    expect(errorsOf(parseExport(outside)).join()).toMatch(/not in the file/);
  });

  it('refuses a derived row without its derivations', () => {
    expect(errorsOf(parseExport({ ...sample(), derivations: [] })).join()).toMatch(/derived row needs its derivations/);
  });

  it('lists entity ids referenced but not included, for the store to check', () => {
    const data = sample();
    const r = parseExport({ ...data, relations: [relation({ id: 'rel_00000002', fromId: 'ent_00000001', toId: 'ent_external1' })] });
    expect(r.ok && r.value.externalEntityIds).toEqual(['ent_external1']);
  });

  it('refuses bad tombstones and oversized files, and caps the error list', () => {
    expect(errorsOf(parseExport({ ...sample(), tombstones: [{ sourceId: 'manual', sourceRef: 'x', forgottenAt: T0 }] })).join()).toMatch(/tombstones\[0\]/);
    const huge = { ...sample(), tombstones: { length: IMPORT_LIMITS.maxRows + 1 } };
    expect(parseExport(huge).ok).toBe(false);
    const tooMany = { ...sample(), observations: Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, () => ({})) };
    expect(errorsOf(parseExport(tooMany))[0]).toMatch(/more than/);
    const manyBad = { ...sample(), observations: Array.from({ length: 200 }, () => ({})) };
    expect(errorsOf(parseExport(manyBad)).length).toBe(IMPORT_LIMITS.maxErrors + 1);
  });
});
