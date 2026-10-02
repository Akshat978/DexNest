/**
 * Where each star sits. Computed once per build and stored - no simulation
 * runs in the view, so an open constellation costs no CPU.
 *
 * Each category owns a sector of the circle. Within it, stronger skills sit
 * nearer the centre, and a skill's angle comes from a hash of its id, so the
 * same skills always land in the same places and adding one skill does not move
 * the others - unless it lands on one: stars are placed in id order, and a star
 * that would sit closer than MIN_SEPARATION to one already placed steps outward
 * (then sideways within its sector) until it is clear. Two hashed positions can
 * otherwise coincide, which drew one star and label on top of another.
 */

import { stableFraction } from './hash.ts';
import { SKILL_CATEGORIES, type SkillCategory, type SkillLayoutPoint } from './types.ts';

export const VIEW_SIZE = 1000;
const CENTRE = VIEW_SIZE / 2;
const INNER_RADIUS = 90;
const OUTER_RADIUS = 440;
/** Fraction of each sector left empty at both edges, so sectors read as groups. */
const SECTOR_PADDING = 0.12;
/** Closest two star centres may be, in view units (room for a star and its label). */
export const MIN_SEPARATION = 56;
const RADIUS_STEP = 18;
const MAX_STEPS = 400;

export interface LayoutInput {
  id: string;
  category: SkillCategory;
  score: number;
}

export function layoutConstellation(skills: readonly LayoutInput[]): SkillLayoutPoint[] {
  const sector = (2 * Math.PI) / SKILL_CATEGORIES.length;
  const placed: SkillLayoutPoint[] = [];
  for (const skill of [...skills].sort((a, b) => a.id.localeCompare(b.id))) {
    const index = SKILL_CATEGORIES.indexOf(skill.category);
    const start = (index < 0 ? 0 : index) * sector - Math.PI / 2;
    let within = SECTOR_PADDING + stableFraction(`angle:${skill.id}`) * (1 - 2 * SECTOR_PADDING);
    const score = Math.min(Math.max(Number.isFinite(skill.score) ? skill.score : 0, 0), 1);
    // A little radial jitter keeps equal scores in one sector from stacking.
    const jitter = (stableFraction(`radius:${skill.id}`) - 0.5) * 40;
    let radius = Math.min(OUTER_RADIUS, Math.max(INNER_RADIUS, INNER_RADIUS + (1 - score) * (OUTER_RADIUS - INNER_RADIUS) + jitter));
    const at = () => {
      const angle = start + within * sector;
      return { x: Math.round((CENTRE + radius * Math.cos(angle)) * 10) / 10, y: Math.round((CENTRE + radius * Math.sin(angle)) * 10) / 10 };
    };
    let point = at();
    // Step clear of stars already placed: outward first, then sideways within
    // the sector (wrapping inside its padded range), back in from the inside.
    const usable = 1 - 2 * SECTOR_PADDING;
    for (let step = 0; step < MAX_STEPS && placed.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < MIN_SEPARATION); step += 1) {
      if (radius + RADIUS_STEP <= OUTER_RADIUS) {
        radius += RADIUS_STEP;
      } else {
        radius = INNER_RADIUS;
        within = SECTOR_PADDING + ((within - SECTOR_PADDING + 0.07) % usable);
      }
      point = at();
    }
    placed.push({ skillId: skill.id, ...point });
  }
  return placed;
}
