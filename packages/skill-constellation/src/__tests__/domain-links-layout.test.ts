import { describe, it, expect } from 'vitest';
import { computeLinks, MAX_EVIDENCE_LINKS_PER_SKILL } from '../domain/links.ts';
import { layoutConstellation, VIEW_SIZE } from '../domain/layout.ts';
import { RELATED_PAIRS } from '../domain/data/related-pairs.ts';
import { CATALOGUE_NAMES, CATALOGUE_SKILLS } from '../domain/data/catalogue.ts';
import { SKILL_CATEGORIES } from '../domain/types.ts';

const repos = (entries: Record<string, string[]>) => new Map(Object.entries(entries).map(([k, v]) => [k, new Set(v)]));
const skills = (...ids: string[]) => ids.map((id) => ({ id }));

describe('evidence links', () => {
  it('links skills sharing repositories, and explains with the repositories', () => {
    const links = computeLinks(skills('react', 'typescript', 'go'), repos({ react: ['r1', 'r2'], typescript: ['r1', 'r2', 'r3'], go: ['r9'] }), []);
    expect(links).toEqual([{ a: 'react', b: 'typescript', source: 'evidence', sharedRepositoryIds: ['r1', 'r2'], weight: 0.6667 }]);
  });

  it('drops weak overlaps: one shared repository out of many', () => {
    const links = computeLinks(skills('a', 'b'), repos({ a: ['r1', 'r2', 'r3'], b: ['r1', 'r4', 'r5'] }), []);
    expect(links).toEqual([]);
  });

  it('caps links per star, strongest first, independent of input order', () => {
    const ids = ['hub', 's1', 's2', 's3', 's4', 's5', 's6'];
    const map: Record<string, string[]> = { hub: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] };
    ids.slice(1).forEach((id, i) => (map[id] = ['r1', 'r2', ...(i < 2 ? ['r3', 'r4', 'r5', 'r6'] : [])]));
    const forward = computeLinks(skills(...ids), repos(map), []);
    const backward = computeLinks(skills(...[...ids].reverse()), repos(map), []);
    expect(backward).toEqual(forward);
    const hubLinks = forward.filter((l) => l.a === 'hub' || l.b === 'hub');
    expect(hubLinks.length).toBe(MAX_EVIDENCE_LINKS_PER_SKILL);
    expect(hubLinks.map((l) => (l.a === 'hub' ? l.b : l.a))).toEqual(expect.arrayContaining(['s1', 's2']));
  });
});

describe('curated links', () => {
  it('are drawn only when both skills exist', () => {
    const pairs = [['typescript', 'javascript'], ['react', 'javascript']] as const;
    const links = computeLinks(skills('javascript', 'typescript'), repos({ javascript: ['r1'], typescript: ['r2'] }), pairs);
    expect(links).toEqual([{ a: 'javascript', b: 'typescript', source: 'curated', sharedRepositoryIds: [], weight: 0 }]);
  });

  it('do not duplicate an evidence link', () => {
    const links = computeLinks(skills('javascript', 'typescript'), repos({ javascript: ['r1', 'r2'], typescript: ['r1', 'r2'] }), [['typescript', 'javascript']]);
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe('evidence');
  });
});

describe('data files', () => {
  const ids = new Set(CATALOGUE_SKILLS.map((s) => s.id));

  it('catalogue ids are unique, slug-shaped and of a known category', () => {
    expect(ids.size).toBe(CATALOGUE_SKILLS.length);
    for (const skill of CATALOGUE_SKILLS) {
      expect(skill.id).toMatch(/^[a-z0-9]+$/);
      expect(SKILL_CATEGORIES).toContain(skill.category);
      expect(skill.name.trim()).toBe(skill.name);
    }
  });

  it('every recorded name maps to a catalogue id, with lowercase keys', () => {
    for (const names of Object.values(CATALOGUE_NAMES)) {
      for (const [name, id] of Object.entries(names)) {
        expect(name).toBe(name.toLowerCase());
        expect(ids.has(id), `${name} -> ${id}`).toBe(true);
      }
    }
  });

  it('related pairs name two different catalogue skills, each pair once', () => {
    const seen = new Set<string>();
    for (const [a, b] of RELATED_PAIRS) {
      expect(ids.has(a), a).toBe(true);
      expect(ids.has(b), b).toBe(true);
      expect(a).not.toBe(b);
      const key = [a, b].sort().join('|');
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });
});

describe('layout', () => {
  const stars = [
    { id: 'typescript', category: 'language' as const, score: 0.9 },
    { id: 'go', category: 'language' as const, score: 0.2 },
    { id: 'react', category: 'framework' as const, score: 0.5 },
    { id: 'docker', category: 'tooling' as const, score: 0.5 },
  ];

  it('is deterministic and inside the view box', () => {
    const a = layoutConstellation(stars);
    expect(layoutConstellation([...stars].reverse())).toEqual(a);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEW_SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(VIEW_SIZE);
    }
  });

  it('adding a star does not move the others', () => {
    const before = layoutConstellation(stars);
    const after = layoutConstellation([...stars, { id: 'rust', category: 'language', score: 0.4 }]);
    expect(after.filter((p) => p.skillId !== 'rust')).toEqual(before);
  });

  it('places stronger stars nearer the centre', () => {
    const [strong, weak] = [
      layoutConstellation([{ id: 'x', category: 'language', score: 1 }])[0]!,
      layoutConstellation([{ id: 'x', category: 'language', score: 0 }])[0]!,
    ];
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - VIEW_SIZE / 2, p.y - VIEW_SIZE / 2);
    expect(d(strong)).toBeLessThan(d(weak));
  });

  it('survives a non-finite score', () => {
    const [p] = layoutConstellation([{ id: 'x', category: 'language', score: Number.NaN }]);
    expect(Number.isFinite(p!.x) && Number.isFinite(p!.y)).toBe(true);
  });
});
