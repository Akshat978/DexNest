import { describe, it, expect } from 'vitest';
import { aggregateSkills } from '../domain/skills.ts';
import { deriveEvidence } from '../domain/evidence.ts';
import { computeStrength, RECENCY_HALF_LIFE_DAYS } from '../domain/strength.ts';
import { buildConstellation } from '../domain/build.ts';
import { CATALOGUE_SKILLS } from '../domain/data/catalogue.ts';
import { commit, input, OPEN, tech, todo } from './fixtures.ts';

const NOW = new Date('2026-06-01T10:00:00.000Z');

describe('skills exist only from evidence', () => {
  it('no facts, no skills - the catalogue and pair list add nothing on their own', () => {
    const build = buildConstellation(input({}), { settings: OPEN, now: NOW });
    expect(build.skills).toEqual([]);
    expect(build.links).toEqual([]);
    expect(build.layout).toEqual([]);
    expect(CATALOGUE_SKILLS.length).toBeGreaterThan(0);
  });

  it('a definition with no evidence is not a skill', () => {
    const definitions = new Map([['react', { id: 'react', name: 'React', category: 'framework' as const }]]);
    expect(aggregateSkills([], definitions)).toEqual([]);
  });

  it('summarises evidence: counts, repositories, kinds, dates, activity', () => {
    const derived = deriveEvidence(
      input({
        technologies: [
          tech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: 'a.ts', evidenceKind: 'file-extension', lastObservedAt: '2026-05-01T00:00:00.000Z' }),
          tech({ repositoryId: 'r-api', category: 'language', name: 'TypeScript', evidencePath: 'b.ts', evidenceKind: 'file-extension', lastObservedAt: '2026-04-01T00:00:00.000Z' }),
        ],
        todos: [todo({ repositoryId: 'r-app', filePath: 'c.ts', status: 'resolved', resolvedAt: '2026-05-20T00:00:00.000Z' })],
        commits: [commit({ repositoryId: 'r-api', sha: 's1', authorDate: '2026-03-01T00:00:00.000Z' })],
      }),
      { settings: OPEN },
    );
    const [ts] = aggregateSkills(derived.evidence, derived.definitions);
    expect(ts).toEqual({
      id: 'typescript',
      name: 'TypeScript',
      category: 'language',
      evidenceCount: 4,
      repositoryCount: 2,
      evidenceKinds: 3,
      firstEvidenceAt: '2026-03-01T00:00:00.000Z',
      lastEvidenceAt: '2026-05-20T00:00:00.000Z',
      lastActivityAt: '2026-05-20T00:00:00.000Z',
    });
  });

  it('presence alone has no activity date', () => {
    const derived = deriveEvidence(input({ technologies: [tech({ repositoryId: 'r-app', name: 'react' })] }), { settings: OPEN });
    expect(aggregateSkills(derived.evidence, derived.definitions)[0]!.lastActivityAt).toBeNull();
  });
});

describe('strength', () => {
  const base = { evidenceCount: 10, repositoryCount: 2, evidenceKinds: 2, lastEvidenceAt: NOW.toISOString() };

  it('is zero with no evidence', () => {
    expect(computeStrength({ ...base, evidenceCount: 0 }, NOW)).toEqual({ volume: 0, recency: 0, variety: 0, score: 0 });
  });

  it('rises with volume, recency and variety, and stays in [0, 1]', () => {
    const s = computeStrength(base, NOW).score;
    expect(computeStrength({ ...base, evidenceCount: 40 }, NOW).score).toBeGreaterThan(s);
    expect(computeStrength({ ...base, repositoryCount: 5 }, NOW).score).toBeGreaterThan(s);
    expect(computeStrength({ ...base, evidenceKinds: 4 }, NOW).score).toBeGreaterThan(s);
    expect(computeStrength({ ...base, lastEvidenceAt: '2025-06-01T00:00:00.000Z' }, NOW).score).toBeLessThan(s);
    const max = computeStrength({ evidenceCount: 1e9, repositoryCount: 1e9, evidenceKinds: 1e9, lastEvidenceAt: NOW.toISOString() }, NOW);
    expect(max.score).toBeLessThanOrEqual(1);
    expect(max.variety).toBe(1);
  });

  it('recency halves every half-life', () => {
    const then = new Date(NOW.getTime() - RECENCY_HALF_LIFE_DAYS * 86_400_000).toISOString();
    expect(computeStrength({ ...base, lastEvidenceAt: then }, NOW).recency).toBeCloseTo(0.5, 3);
  });

  it('treats a future date as now and a broken date as old', () => {
    expect(computeStrength({ ...base, lastEvidenceAt: '2030-01-01T00:00:00.000Z' }, NOW).recency).toBe(1);
    expect(computeStrength({ ...base, lastEvidenceAt: 'not a date' }, NOW).recency).toBe(0);
  });

  it('fades with time alone - same evidence, later clock', () => {
    const later = new Date(NOW.getTime() + 365 * 86_400_000);
    expect(computeStrength(base, later).score).toBeLessThan(computeStrength(base, NOW).score);
  });
});

describe('buildConstellation', () => {
  const facts = input({
    technologies: [
      tech({ repositoryId: 'r-app', name: 'react' }),
      tech({ repositoryId: 'r-app', name: 'vue', status: 'removed', removedAt: '2026-01-01T00:00:00.000Z' }),
    ],
  });

  it('reports skills added and lost against the previous build', () => {
    const build = buildConstellation(facts, { settings: OPEN, now: NOW, previousSkillIds: ['vue', 'svelte'] });
    expect(build.skills.map((s) => s.id)).toEqual(['react', 'vue']);
    expect(build.added).toEqual(['react']);
    expect(build.lost).toEqual(['svelte']);
    expect(build.layout.map((p) => p.skillId)).toEqual(['react', 'vue']);
  });

  it('is deterministic', () => {
    const a = buildConstellation(facts, { settings: OPEN, now: NOW });
    const b = buildConstellation({ ...facts, technologies: [...facts.technologies].reverse() }, { settings: OPEN, now: NOW });
    expect(b).toEqual(a);
  });
});
