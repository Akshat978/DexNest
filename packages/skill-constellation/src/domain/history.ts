/**
 * Strength history: one row per skill per build, for the last HISTORY_BUILDS_KEPT builds.
 */

import type { Skill, SkillStrength, SkillStrengthSnapshot } from './types.ts';

export const HISTORY_BUILDS_KEPT = 52;

export function strengthSnapshots(
  buildId: string,
  at: string,
  skills: readonly (Pick<Skill, 'id' | 'evidenceCount'> & { strength: SkillStrength })[],
): SkillStrengthSnapshot[] {
  return skills.map((skill) => ({ buildId, skillId: skill.id, at, evidenceCount: skill.evidenceCount, ...skill.strength }));
}

/**
 * Builds whose history rows should go: everything but the newest `keep`.
 * `builds` may be in any order; ties on time break by id.
 */
export function buildsToPrune(
  builds: readonly { id: string; at: string }[],
  keep: number = HISTORY_BUILDS_KEPT,
): string[] {
  const newestFirst = [...builds].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return newestFirst.slice(Math.max(0, keep)).map((b) => b.id);
}
