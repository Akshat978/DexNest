/**
 * Strength from evidence: volume, recency, variety. Each in [0, 1].
 *
 * Computed when read, from a skill's stored counts and dates and the current
 * time. Recency fades as time passes even when nothing is rescanned; storing it
 * would make a finished build wrong the next day.
 *
 * The constants are fixed and documented, not settings: a number the user can
 * turn up is a number that stops meaning anything.
 */

import type { Skill, SkillStrength } from './types.ts';

/** Evidence rows at which volume reaches ~63%. */
export const VOLUME_SCALE = 20;
/** Days for recency to halve. */
export const RECENCY_HALF_LIFE_DAYS = 90;
/** Repositories and kinds at which variety's two halves saturate. */
export const VARIETY_REPOSITORIES = 5;
export const VARIETY_KINDS = 4;

export const WEIGHTS = { volume: 0.4, recency: 0.35, variety: 0.25 } as const;

const DAY_MS = 86_400_000;

type StrengthInput = Pick<Skill, 'evidenceCount' | 'repositoryCount' | 'evidenceKinds' | 'lastEvidenceAt'>;

export function computeStrength(skill: StrengthInput, now: Date): SkillStrength {
  if (skill.evidenceCount <= 0) return { volume: 0, recency: 0, variety: 0, score: 0 };
  const volume = 1 - Math.exp(-skill.evidenceCount / VOLUME_SCALE);
  const last = Date.parse(skill.lastEvidenceAt);
  // Unparseable dates count as old; dates in the future (clock skew) as now.
  const days = Number.isFinite(last) ? Math.max(0, (now.getTime() - last) / DAY_MS) : Number.POSITIVE_INFINITY;
  const recency = Number.isFinite(days) ? 0.5 ** (days / RECENCY_HALF_LIFE_DAYS) : 0;
  const variety =
    (Math.min(skill.repositoryCount / VARIETY_REPOSITORIES, 1) + Math.min(skill.evidenceKinds / VARIETY_KINDS, 1)) / 2;
  const score = WEIGHTS.volume * volume + WEIGHTS.recency * recency + WEIGHTS.variety * variety;
  return { volume: round(volume), recency: round(recency), variety: round(variety), score: round(score) };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
