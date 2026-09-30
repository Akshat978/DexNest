import { describe, expect, it } from 'vitest';
import { buildDiSnapshot, dayObservation, groupCommitDays, projectIdFor, skillKey, validateEntity, validateObservation, validateRelation } from '../index.ts';
import { repo, tech } from './world.ts';

const NOW = '2026-06-30T12:00:00.000Z';
const open = { now: NOW, isSensitive: () => false };

describe('DI snapshot', () => {
  it('names a project by its display name, else the last part of its root, with control characters removed', () => {
    const s = buildDiSnapshot([repo('r1', 'C:\\code\\tool\\'), repo('r2', '/x/y', 'my\u0007app'), repo('r3', '/x/z', '')], [], open);
    expect(s.entities.map((e) => e.title)).toEqual(['tool', 'my app', 'z']);
  });

  it('skips repositories with no roots, a sensitive root or an unusable id', () => {
    const s = buildDiSnapshot(
      [{ id: 'r0', roots: [], discoveredAt: NOW }, repo('r1', '/data/x'), repo('bad id!', '/ok'), repo('r2', '/ok')],
      [tech('r1', 'Go'), tech('r2', 'Go')],
      { now: NOW, isSensitive: (p) => p.startsWith('/data') },
    );
    expect(s.skippedRepositories).toBe(3);
    expect([...s.projects.keys()]).toEqual(['r2']);
    expect(s.relations.length).toBe(1);
  });

  it('every row it builds passes validation', () => {
    const s = buildDiSnapshot([repo('r1', '/a'), repo('r2', '/b')], [tech('r1', 'TypeScript'), tech('r2', 'TypeScript', { evidenceKind: 'file-extension' }), tech('r2', 'Cargo', { category: 'packageManager' })], open);
    for (const e of s.entities) expect(validateEntity(e).ok, e.title).toBe(true);
    for (const r of s.relations) expect(validateRelation(r).ok, r.id).toBe(true);
  });

  it('keys skills by name, whatever the case or spacing', () => {
    expect(skillKey(' Type Script ')).toBe('type-script');
    expect(skillKey('TypeScript')).toBe(skillKey('typescript'));
  });
});

describe('commit days', () => {
  const projects = new Map([['r1', projectIdFor('r1')]]);
  const c = (sha: string, at: string, repositoryId = 'r1') => ({ seq: 1, repositoryId, sha, at });

  it('groups by local day and drops unknown repositories', () => {
    const groups = groupCommitDays([c('aaaaaaa', '2026-06-01T23:30:00.000Z'), c('bbbbbbb', '2026-06-01T10:00:00.000Z'), c('ccccccc', '2026-06-01T10:00:00.000Z', 'r9')], projects, 'Asia/Tokyo');
    expect([...groups.values()].map((g) => [g.day, g.commits.length])).toEqual([
      ['2026-06-02', 1],
      ['2026-06-01', 1],
    ]);
  });

  it('merges a day by sha and stays valid', () => {
    const first = dayObservation({ repositoryId: 'r1', day: '2026-06-01', commits: [c('aaaaaaa', '2026-06-01T09:00:00.000Z')] }, undefined, NOW);
    const merged = dayObservation({ repositoryId: 'r1', day: '2026-06-01', commits: [c('aaaaaaa', '2026-06-01T09:00:00.000Z'), c('bbbbbbb', '2026-06-01T08:00:00.000Z')] }, first, '2026-07-01T00:00:00.000Z');
    expect(merged.statement).toBe('2 commits observed');
    expect(merged.id).toBe(first.id);
    expect(merged.createdAt).toBe(NOW);
    expect(merged.observedAt).toBe('2026-06-01T09:00:00.000Z');
    expect(validateObservation(merged).ok).toBe(true);
  });
});
