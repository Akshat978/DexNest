/**
 * Skill Constellation's event types, payloads and idempotency keys.
 *
 * Stream "skill", module "skill_constellation". Payloads carry ids, counts and
 * dates only - never a path and never text from a repository.
 */

export const SKILL_MODULE_ID = 'skill_constellation';
export const SKILL_EVENT_STREAM = 'skill';
export const SKILL_EVENT_NAMESPACE = 'skill';

export const SKILL_EVENT_TYPES = ['skill.constellation.built', 'skill.discovered', 'skill.evidence_lost'] as const;
export type SkillEventType = (typeof SKILL_EVENT_TYPES)[number];

export interface ConstellationBuiltPayload {
  buildId: string;
  occurrenceId: string;
  skills: number;
  evidence: number;
  links: number;
  added: number;
  lost: number;
  refusedPrivate: number;
  othersCommits: number;
}

export interface SkillDiscoveredPayload {
  skillId: string;
  buildId: string;
  evidenceCount: number;
  firstEvidenceAt: string;
}

export interface SkillEvidenceLostPayload {
  skillId: string;
  buildId: string;
}

export function builtKey(occurrenceId: string): string {
  return `${SKILL_MODULE_ID}:build:${occurrenceId}`;
}

/** Once ever per skill: a skill that fades and returns is not discovered twice. */
export function discoveredKey(skillId: string): string {
  return `${SKILL_MODULE_ID}:discovered:${skillId}`;
}

export function evidenceLostKey(skillId: string, buildId: string): string {
  return `${SKILL_MODULE_ID}:lost:${skillId}:${buildId}`;
}
