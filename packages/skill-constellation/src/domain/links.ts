/**
 * Links between skills.
 *
 * Evidence links: two skills evidenced in the same repositories, weighted by
 * the Jaccard overlap of their repository sets. Kept when they share at least
 * two repositories or overlap by half; at most MAX_EVIDENCE_LINKS_PER_SKILL per
 * star, strongest first, so the drawing stays readable.
 *
 * Curated links: the hand-written pairs in data/related-pairs.ts, drawn only
 * when both skills already exist. They never create a skill.
 */

import { RELATED_PAIRS } from './data/related-pairs.ts';
import type { Skill, SkillLink } from './types.ts';

export const MAX_EVIDENCE_LINKS_PER_SKILL = 4;
export const MIN_SHARED_REPOSITORIES = 2;
export const MIN_WEIGHT = 0.5;

function ordered(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function computeLinks(
  skills: readonly Pick<Skill, 'id'>[],
  repositories: ReadonlyMap<string, ReadonlySet<string>>,
  pairs: readonly (readonly [string, string])[] = RELATED_PAIRS,
): SkillLink[] {
  const ids = skills.map((s) => s.id).sort();
  const present = new Set(ids);

  const candidates: SkillLink[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      const ra = repositories.get(a) ?? new Set<string>();
      const rb = repositories.get(b) ?? new Set<string>();
      const shared = [...ra].filter((r) => rb.has(r)).sort();
      if (shared.length === 0) continue;
      const union = new Set([...ra, ...rb]).size;
      const weight = shared.length / union;
      if (shared.length < MIN_SHARED_REPOSITORIES && weight < MIN_WEIGHT) continue;
      candidates.push({ a, b, source: 'evidence', sharedRepositoryIds: shared, weight: Math.round(weight * 10_000) / 10_000 });
    }
  }

  // Strongest first; ties broken by ids so the result never depends on input order.
  candidates.sort((x, y) => y.weight - x.weight || y.sharedRepositoryIds.length - x.sharedRepositoryIds.length || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const degree = new Map<string, number>();
  const kept = new Map<string, SkillLink>();
  for (const link of candidates) {
    if ((degree.get(link.a) ?? 0) >= MAX_EVIDENCE_LINKS_PER_SKILL) continue;
    if ((degree.get(link.b) ?? 0) >= MAX_EVIDENCE_LINKS_PER_SKILL) continue;
    degree.set(link.a, (degree.get(link.a) ?? 0) + 1);
    degree.set(link.b, (degree.get(link.b) ?? 0) + 1);
    kept.set(`${link.a}|${link.b}`, link);
  }

  for (const [x, y] of pairs) {
    if (x === y || !present.has(x) || !present.has(y)) continue;
    const [a, b] = ordered(x, y);
    if (kept.has(`${a}|${b}`)) continue;
    const ra = repositories.get(a) ?? new Set<string>();
    const rb = repositories.get(b) ?? new Set<string>();
    const shared = [...ra].filter((r) => rb.has(r)).sort();
    const union = new Set([...ra, ...rb]).size;
    kept.set(`${a}|${b}`, {
      a,
      b,
      source: 'curated',
      sharedRepositoryIds: shared,
      weight: union === 0 ? 0 : Math.round((shared.length / union) * 10_000) / 10_000,
    });
  }

  return [...kept.values()].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}
