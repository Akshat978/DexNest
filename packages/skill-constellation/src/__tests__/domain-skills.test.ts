import { describe, it, expect } from 'vitest';
import { aggregateSkills } from '../domain/skills.ts';
import { deriveEvidence } from '../domain/evidence.ts';
import { computeStrength, RECENCY_HALF_LIFE_DAYS, strengthBasis } from '../domain/strength.ts';
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
      activityCount: 2,
      firstActivityAt: '2026-03-01T00:00:00.000Z',
      lastActivityAt: '2026-05-20T00:00:00.000Z',
    });
  });

  it('presence alone has no activity date', () => {
    const derived = deriveEvidence(input({ technologies: [tech({ repositoryId: 'r-app', name: 'react' })] }), { settings: OPEN });
    const [react] = aggregateSkills(derived.evidence, derived.definitions, derived.repositoryActivity);
    expect(react).toMatchObject({ activityCount: 0, firstActivityAt: null, lastActivityAt: null });
  });

  it('a dependency is dated by the commits in the repositories that declare it, not by the scan that read it', () => {
    const derived = deriveEvidence(
      input({
        technologies: [
          // Read by a scan on 1 June; the work was months earlier.
          tech({ repositoryId: 'r-app', name: 'react', lastObservedAt: '2026-06-01T09:00:00.000Z' }),
          tech({ repositoryId: 'r-api', name: 'react', lastObservedAt: '2026-06-01T09:00:00.000Z' }),
          tech({ repositoryId: 'r-old', name: 'jest', status: 'removed', removedAt: '2026-02-01T00:00:00.000Z' }),
        ],
        commits: [
          commit({ repositoryId: 'r-app', sha: 'a1', authorDate: '2025-11-03T00:00:00.000Z' }),
          commit({ repositoryId: 'r-app', sha: 'a2', authorDate: '2026-01-15T00:00:00.000Z' }),
          commit({ repositoryId: 'r-api', sha: 'b1', authorDate: '2026-03-09T00:00:00.000Z' }),
          commit({ repositoryId: 'r-old', sha: 'c1', authorDate: '2026-05-30T00:00:00.000Z' }),
        ],
      }),
      { settings: OPEN },
    );
    const skills = aggregateSkills(derived.evidence, derived.definitions, derived.repositoryActivity);
    const react = skills.find((s) => s.id === 'react')!;
    expect(react).toMatchObject({
      evidenceCount: 2,
      lastEvidenceAt: '2026-06-01T09:00:00.000Z',
      activityCount: 3,
      firstActivityAt: '2025-11-03T00:00:00.000Z',
      lastActivityAt: '2026-03-09T00:00:00.000Z',
    });
    // Removed from the only repository that named it: later commits there are not work in it.
    expect(skills.find((s) => s.id === 'jest')).toMatchObject({ activityCount: 0, lastActivityAt: null });
  });

  it("someone else's commits date nothing", () => {
    const derived = deriveEvidence(
      input({
        technologies: [tech({ repositoryId: 'r-app', name: 'react' })],
        commits: [commit({ repositoryId: 'r-app', sha: 'a1', authorDate: '2026-05-01T00:00:00.000Z', authorEmail: 'other@example.com' })],
      }),
      { settings: { ...OPEN, myEmails: ['me@example.com'] } },
    );
    expect(derived.repositoryActivity.size).toBe(0);
    expect(aggregateSkills(derived.evidence, derived.definitions, derived.repositoryActivity)[0]!.lastActivityAt).toBeNull();
  });
});

describe('strength', () => {
  const at = NOW.toISOString();
  const base = { category: 'language' as const, evidenceCount: 12, repositoryCount: 2, evidenceKinds: 2, activityCount: 10, lastActivityAt: at };
  const declared = { category: 'tooling' as const, evidenceCount: 1, repositoryCount: 1, evidenceKinds: 1, activityCount: 0, lastActivityAt: null };

  it('is zero with no evidence', () => {
    expect(computeStrength({ ...base, evidenceCount: 0 }, NOW)).toEqual({ volume: 0, recency: 0, variety: 0, score: 0 });
  });

  it('rises with work, recency and variety, and stays in [0, 1]', () => {
    const s = computeStrength(base, NOW).score;
    expect(computeStrength({ ...base, activityCount: 40 }, NOW).score).toBeGreaterThan(s);
    expect(computeStrength({ ...base, repositoryCount: 5 }, NOW).score).toBeGreaterThan(s);
    expect(computeStrength({ ...base, evidenceKinds: 4 }, NOW).score).toBeGreaterThan(s);
    expect(computeStrength({ ...base, lastActivityAt: '2025-06-01T00:00:00.000Z' }, NOW).score).toBeLessThan(s);
    const max = computeStrength({ ...base, evidenceCount: 1e9, repositoryCount: 1e9, evidenceKinds: 1e9, activityCount: 1e9 }, NOW);
    expect(max.score).toBe(1);
    expect(max.variety).toBe(1);
  });

  it('counts work, not rows: more open TODOs or manifest lines do not raise a language', () => {
    expect(computeStrength({ ...base, evidenceCount: 500 }, NOW)).toEqual(computeStrength(base, NOW));
  });

  it('volume gates the score: one manifest line is weak however fresh the project', () => {
    // Jest, named once in one package.json, in a project committed to today.
    const jest = computeStrength({ ...declared, activityCount: 300, lastActivityAt: at }, NOW);
    expect(jest.recency).toBe(1);
    expect(jest.score).toBeLessThan(0.2);
    // The same line under the old average of the three bars was 43%.
    expect(jest.score).toBeLessThan((jest.volume + jest.recency + jest.variety) / 3);
    // And with nothing dating it at all, it is fainter still.
    const never = computeStrength(declared, NOW);
    expect(never.recency).toBe(0);
    expect(never.score).toBeLessThan(0.06);
    expect(never.score).toBeLessThan(jest.score / 2);
  });

  it('a package manager in every project stays below a framework in a few', () => {
    const everywhere = { evidenceCount: 6, repositoryCount: 6, evidenceKinds: 1, activityCount: 400, lastActivityAt: at };
    const npm = computeStrength({ ...everywhere, category: 'packageManager' }, NOW).score;
    const react = computeStrength({ ...everywhere, category: 'framework', evidenceCount: 3, repositoryCount: 3 }, NOW).score;
    const typescript = computeStrength({ ...everywhere, category: 'language', evidenceKinds: 3 }, NOW).score;
    expect(npm).toBeLessThan(0.4);
    expect(react).toBeGreaterThan(npm);
    expect(typescript).toBeGreaterThan(react);
    const order = (['language', 'framework', 'library', 'runtime', 'tooling', 'packageManager'] as const).map(
      (category) => computeStrength({ ...everywhere, category: category === 'language' ? 'framework' : category }, NOW).score,
    );
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  it('says what a strength rests on', () => {
    expect(strengthBasis(base)).toBe('work');
    expect(strengthBasis({ category: 'framework', lastActivityAt: at })).toBe('project');
    expect(strengthBasis(declared)).toBe('declared');
    expect(strengthBasis({ category: 'language', lastActivityAt: null })).toBe('declared');
  });

  it('recency halves every half-life', () => {
    const then = new Date(NOW.getTime() - RECENCY_HALF_LIFE_DAYS * 86_400_000).toISOString();
    expect(computeStrength({ ...base, lastActivityAt: then }, NOW).recency).toBeCloseTo(0.5, 3);
  });

  it('treats a future date as now, and a broken or missing date as never', () => {
    expect(computeStrength({ ...base, lastActivityAt: '2030-01-01T00:00:00.000Z' }, NOW).recency).toBe(1);
    expect(computeStrength({ ...base, lastActivityAt: 'not a date' }, NOW).recency).toBe(0);
    expect(computeStrength({ ...base, lastActivityAt: null }, NOW).recency).toBe(0);
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
