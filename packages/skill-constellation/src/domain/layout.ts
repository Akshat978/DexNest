/**
 * Where each star sits. Computed once per build and stored - no simulation
 * runs in the view, so an open constellation costs no CPU.
 *
 * Each category owns a sector of the circle. Within it, stronger skills sit
 * nearer the centre, and a skill's angle comes from a hash of its id, so the
 * same skills always land in the same places and adding one skill does not move
 * the others.
 */

import { stableFraction } from './hash.ts';
import { SKILL_CATEGORIES, type SkillCategory, type SkillLayoutPoint } from './types.ts';

export const VIEW_SIZE = 1000;
const CENTRE = VIEW_SIZE / 2;
const INNER_RADIUS = 90;
const OUTER_RADIUS = 440;
/** Fraction of each sector left empty at both edges, so sectors read as groups. */
const SECTOR_PADDING = 0.12;

export interface LayoutInput {
  id: string;
  category: SkillCategory;
  score: number;
}

export function layoutConstellation(skills: readonly LayoutInput[]): SkillLayoutPoint[] {
  const sector = (2 * Math.PI) / SKILL_CATEGORIES.length;
  return [...skills]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((skill) => {
      const index = SKILL_CATEGORIES.indexOf(skill.category);
      const start = (index < 0 ? 0 : index) * sector - Math.PI / 2;
      const within = SECTOR_PADDING + stableFraction(`angle:${skill.id}`) * (1 - 2 * SECTOR_PADDING);
      const angle = start + within * sector;
      const score = Math.min(Math.max(Number.isFinite(skill.score) ? skill.score : 0, 0), 1);
      // A little radial jitter keeps equal scores in one sector from stacking.
      const jitter = (stableFraction(`radius:${skill.id}`) - 0.5) * 40;
      const radius = Math.min(OUTER_RADIUS, Math.max(INNER_RADIUS, INNER_RADIUS + (1 - score) * (OUTER_RADIUS - INNER_RADIUS) + jitter));
      return {
        skillId: skill.id,
        x: Math.round((CENTRE + radius * Math.cos(angle)) * 10) / 10,
        y: Math.round((CENTRE + radius * Math.sin(angle)) * 10) / 10,
      };
    });
}
