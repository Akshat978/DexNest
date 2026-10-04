/**
 * Where each star sits. Computed once per build and stored - no simulation
 * runs in the view, so an open constellation costs no CPU.
 *
 * - Each category present owns a slice of the circle, wider the more skills it
 *   holds, so six languages are not squeezed into the room one runtime gets.
 * - Distance from the centre is the skill's rank by strength across the whole
 *   constellation: the strongest sits innermost and the rest step outward
 *   evenly, so the sky is used edge to edge instead of every weak skill
 *   sharing the rim.
 * - Within its slice a skill takes one of evenly spaced angles, handed out by
 *   a hash of its id, so angle and rank are unrelated and neighbours in rank
 *   are rarely neighbours on the page.
 * - The whole is an ellipse, wider than tall like the panel it is drawn in,
 *   so the sides of the sky are used and not only its middle.
 * - Stars still closer than MIN_SEPARATION are then pushed apart until every
 *   one has room for its name.
 *
 * Deterministic: the same skills and scores always give the same sky.
 */

import { stableFraction } from './hash.ts';
import { SKILL_CATEGORIES, type SkillCategory, type SkillLayoutPoint } from './types.ts';

export const VIEW_SIZE = 1000;
const CENTRE = VIEW_SIZE / 2;
const INNER_RADIUS = 70;
const OUTER_RADIUS = 460;
/** Height of the ellipse as a fraction of its width: the sky is drawn 16:10. */
const FLATTEN = 0.62;
/** Fraction of each slice left empty at both edges, so slices read as groups. */
const SECTOR_PADDING = 0.1;
/** Closest two star centres may be, in view units (room for a star and its label). */
export const MIN_SEPARATION = 96;
const RELAX_PASSES = 120;

export interface LayoutInput {
  id: string;
  category: SkillCategory;
  score: number;
}

export function layoutConstellation(skills: readonly LayoutInput[]): SkillLayoutPoint[] {
  if (skills.length === 0) return [];
  const score = (s: LayoutInput) => Math.min(Math.max(Number.isFinite(s.score) ? s.score : 0, 0), 1);
  const ranked = [...skills].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const rank = new Map(ranked.map((s, i) => [s.id, i]));

  // Slices in category order, each as wide as its share of the stars (plus one, so a lone skill still has room).
  const groups = SKILL_CATEGORIES.map((category) => skills.filter((s) => s.category === category)).filter((g) => g.length > 0);
  const unknown = skills.filter((s) => !SKILL_CATEGORIES.includes(s.category));
  if (unknown.length > 0) groups.push(unknown);
  const weight = groups.reduce((n, g) => n + g.length + 1, 0);

  const points: { id: string; x: number; y: number }[] = [];
  let start = -Math.PI / 2;
  for (const group of groups) {
    const width = ((group.length + 1) / weight) * 2 * Math.PI;
    const slots = [...group].sort(
      (a, b) => stableFraction(`angle:${a.id}`) - stableFraction(`angle:${b.id}`) || a.id.localeCompare(b.id),
    );
    slots.forEach((skill, slot) => {
      const within = SECTOR_PADDING + ((slot + 0.5) / slots.length) * (1 - 2 * SECTOR_PADDING);
      const angle = start + within * width;
      const outward = skills.length === 1 ? 0 : rank.get(skill.id)! / (skills.length - 1);
      const radius = INNER_RADIUS + outward * (OUTER_RADIUS - INNER_RADIUS);
      points.push({ id: skill.id, x: CENTRE + radius * Math.cos(angle), y: CENTRE + radius * Math.sin(angle) * FLATTEN });
    });
    start += width;
  }

  // Push apart any two stars that are too close, a little each pass, keeping everyone inside the sky.
  points.sort((a, b) => a.id.localeCompare(b.id));
  for (let pass = 0; pass < RELAX_PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!;
        const b = points[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= MIN_SEPARATION) continue;
        if (distance < 0.001) {
          // Exactly on top of each other: part them in a direction their ids decide.
          const angle = stableFraction(`part:${a.id}:${b.id}`) * 2 * Math.PI;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (MIN_SEPARATION - distance) / 2 + 0.5;
        a.x -= (dx / distance) * push;
        a.y -= (dy / distance) * push;
        b.x += (dx / distance) * push;
        b.y += (dy / distance) * push;
        moved = true;
      }
    }
    for (const p of points) {
      // How far out it is, as a fraction of the ellipse's edge in its direction.
      const out = Math.hypot((p.x - CENTRE) / OUTER_RADIUS, (p.y - CENTRE) / (OUTER_RADIUS * FLATTEN));
      if (out > 1) {
        p.x = CENTRE + (p.x - CENTRE) / out;
        p.y = CENTRE + (p.y - CENTRE) / out;
      }
    }
    if (!moved) break;
  }

  const round = (n: number) => Math.round(n * 10) / 10;
  return points.map((p) => ({ skillId: p.id, x: round(p.x), y: round(p.y) }));
}
