import { describe, it, expect } from 'vitest';
import { computeLinks, MAX_EVIDENCE_LINKS_PER_SKILL } from '../domain/links.ts';
import { layoutConstellation, MIN_SEPARATION, VIEW_SIZE } from '../domain/layout.ts';
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

  // The sky is an ellipse, wider than tall: distance is measured as a fraction of its edge.
  const centre = (p: { x: number; y: number }) => Math.hypot((p.x - VIEW_SIZE / 2) / 460, (p.y - VIEW_SIZE / 2) / (460 * 0.62));

  it('places stronger stars nearer the centre, by rank, so the sky is used from the middle to the rim', () => {
    const by = new Map(layoutConstellation(stars).map((p) => [p.skillId, p]));
    expect(centre(by.get('typescript')!)).toBeLessThan(centre(by.get('react')!));
    expect(centre(by.get('react')!)).toBeLessThan(centre(by.get('go')!));
    // Real data after phase 5: one strong language and a dozen weak skills. By
    // score they all sat on the rim; by rank they step outward evenly.
    const weak = Array.from({ length: 12 }, (_, i) => ({ id: `lib-${i}`, category: 'library' as const, score: 0.1 + i / 1000 }));
    const sky = layoutConstellation([{ id: 'typescript', category: 'language', score: 0.9 }, ...weak]);
    const distances = sky.map(centre).sort((a, b) => a - b);
    expect(distances[0]).toBeLessThan(0.3);
    expect(distances[distances.length - 1]).toBeGreaterThan(0.9);
    expect(distances.filter((d) => d > 0.35 && d < 0.85).length, 'the middle of the sky is not empty').toBeGreaterThanOrEqual(5);
    // Wider than tall, like the panel it is drawn in.
    const span = (axis: 'x' | 'y') => Math.max(...sky.map((p) => p[axis])) - Math.min(...sky.map((p) => p[axis]));
    expect(span('x')).toBeGreaterThan(span('y') * 1.2);
  });

  it('gives a category with more skills a wider slice', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `lang-${i}`, category: 'language' as const, score: 0.5 }));
    const sky = layoutConstellation([...many, { id: 'npm', category: 'packageManager', score: 0.5 }]);
    const angle = (p: { x: number; y: number }) => Math.atan2(p.y - VIEW_SIZE / 2, p.x - VIEW_SIZE / 2);
    const languages = sky.filter((p) => p.skillId.startsWith('lang-')).map(angle).sort((a, b) => a - b);
    // Nine of ten stars: they span well over half the circle, not one sixth of it.
    let widestGap = 2 * Math.PI - (languages[languages.length - 1]! - languages[0]!);
    for (let i = 1; i < languages.length; i += 1) widestGap = Math.max(widestGap, languages[i]! - languages[i - 1]!);
    expect(2 * Math.PI - widestGap).toBeGreaterThan(Math.PI);
  });

  it('never draws two stars on top of each other, even in one crowded sector', () => {
    // Integration QA F5: on real data "Docker" landed on "Vite" and "Next.js" on "React".
    // 18 of one category, all the same strength, still each get room for a name.
    const crowded = Array.from({ length: 18 }, (_, i) => ({ id: `tool-${i}`, category: 'tooling' as const, score: 0.5 }));
    const points = layoutConstellation(crowded);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        expect(d, `${points[i]!.skillId} / ${points[j]!.skillId}`).toBeGreaterThanOrEqual(MIN_SEPARATION);
      }
    }
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEW_SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(VIEW_SIZE);
    }
    expect(layoutConstellation([...crowded].reverse())).toEqual(points);
  });

  it('parts two stars that would land on the same spot', () => {
    const twin = layoutConstellation([
      { id: 'aa-first', category: 'language', score: 0.3 },
      { id: 'zz-solo', category: 'language', score: 0.3 },
    ]);
    expect(Math.hypot(twin[0]!.x - twin[1]!.x, twin[0]!.y - twin[1]!.y)).toBeGreaterThanOrEqual(MIN_SEPARATION);
  });

  it('survives a non-finite score', () => {
    const [p] = layoutConstellation([{ id: 'x', category: 'language', score: Number.NaN }]);
    expect(Number.isFinite(p!.x) && Number.isFinite(p!.y)).toBe(true);
  });
});
