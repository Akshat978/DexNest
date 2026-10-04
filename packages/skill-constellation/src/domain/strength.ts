/**
 * Strength from evidence. Each component and the score are in [0, 1].
 *
 *   score = category weight × volume × (0.5 + 0.3 × recency + 0.2 × variety)
 *
 * Volume gates the score: it multiplies, so little evidence is a low strength
 * however recent it is. Recency and variety only shape what volume allows.
 *
 * - Volume. A language: its commits and resolved TODOs, plus one per
 *   repository. Anything else is only ever named in a manifest, so it counts
 *   the repositories that name it - reading the same line again adds nothing.
 * - Recency: from the last dated work, never from the day a scan ran. No
 *   dated work is zero.
 * - Variety: how many repositories and how many kinds of evidence.
 * - Category weight: tools that sit beside the work (a test runner, a linter,
 *   a package manager) rank below the languages and frameworks it is written in.
 * - Named in a manifest with no dated work anywhere is a declared dependency,
 *   not practice: its score is halved again.
 *
 * Computed when read, from a skill's stored counts and dates and the current
 * time. Recency fades as time passes even when nothing is rescanned; storing it
 * would make a finished build wrong the next day.
 *
 * The constants are fixed and documented, not settings: a number the user can
 * turn up is a number that stops meaning anything.
 */

import type { Skill, SkillCategory, SkillStrength, StrengthBasis } from './types.ts';

/** Commits and resolved TODOs (plus repositories) at which a language's volume reaches ~63%. */
export const VOLUME_SCALE = 20;
/** Repositories at which the volume of anything else reaches ~63%. */
export const DECLARED_VOLUME_SCALE = 2.5;
/** Days for recency to halve. */
export const RECENCY_HALF_LIFE_DAYS = 90;
/** Repositories and kinds at which variety's two halves saturate. */
export const VARIETY_REPOSITORIES = 5;
export const VARIETY_KINDS = 4;

/** What volume is multiplied by: a floor, plus what recency and variety add. */
export const SHAPE = { base: 0.5, recency: 0.3, variety: 0.2 } as const;

export const CATEGORY_WEIGHT: Readonly<Record<SkillCategory, number>> = {
  language: 1,
  framework: 1,
  library: 0.9,
  runtime: 0.7,
  tooling: 0.6,
  packageManager: 0.4,
};

/** Applied when nothing dates the skill at all. */
export const DECLARED_ONLY_FACTOR = 0.5;

const DAY_MS = 86_400_000;

type StrengthInput = Pick<Skill, 'category' | 'evidenceCount' | 'repositoryCount' | 'evidenceKinds' | 'activityCount' | 'lastActivityAt'>;

export function strengthBasis(skill: Pick<Skill, 'category' | 'lastActivityAt'>): StrengthBasis {
  if (!skill.lastActivityAt) return 'declared';
  return skill.category === 'language' ? 'work' : 'project';
}

export function computeStrength(skill: StrengthInput, now: Date): SkillStrength {
  if (skill.evidenceCount <= 0) return { volume: 0, recency: 0, variety: 0, score: 0 };
  const volume =
    skill.category === 'language'
      ? 1 - Math.exp(-(Math.max(0, skill.activityCount) + skill.repositoryCount) / VOLUME_SCALE)
      : 1 - Math.exp(-skill.repositoryCount / DECLARED_VOLUME_SCALE);
  const last = skill.lastActivityAt ? Date.parse(skill.lastActivityAt) : Number.NaN;
  // No dated work, or an unparseable date, counts as never; a date in the future (clock skew) as now.
  const recency = Number.isFinite(last) ? 0.5 ** (Math.max(0, (now.getTime() - last) / DAY_MS) / RECENCY_HALF_LIFE_DAYS) : 0;
  const variety =
    (Math.min(skill.repositoryCount / VARIETY_REPOSITORIES, 1) + Math.min(skill.evidenceKinds / VARIETY_KINDS, 1)) / 2;
  const weight = (CATEGORY_WEIGHT[skill.category] ?? 1) * (strengthBasis(skill) === 'declared' ? DECLARED_ONLY_FACTOR : 1);
  const score = weight * volume * (SHAPE.base + SHAPE.recency * recency + SHAPE.variety * variety);
  return { volume: round(volume), recency: round(recency), variety: round(variety), score: round(score) };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
