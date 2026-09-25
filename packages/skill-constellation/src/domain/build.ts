/**
 * One constellation from one set of inputs. Pure: the engine gathers the
 * inputs and stores the result; everything decided in between is here.
 */

import { deriveEvidence, type DeriveEvidenceOptions } from './evidence.ts';
import { layoutConstellation } from './layout.ts';
import { computeLinks } from './links.ts';
import { aggregateSkills, repositoriesBySkill } from './skills.ts';
import { computeStrength } from './strength.ts';
import type { ConstellationInput, Skill, SkillEvidence, SkillLayoutPoint, SkillLink, SkillStrength } from './types.ts';

export interface ConstellationBuild {
  skills: (Skill & { strength: SkillStrength })[];
  evidence: SkillEvidence[];
  links: SkillLink[];
  layout: SkillLayoutPoint[];
  /** Skill ids present now and not in `previousSkillIds`. */
  added: string[];
  /** Skill ids in `previousSkillIds` with no evidence left. */
  lost: string[];
  refusedPrivate: number;
  othersCommits: number;
}

export function buildConstellation(
  input: ConstellationInput,
  options: DeriveEvidenceOptions & { now: Date; previousSkillIds?: Iterable<string> },
): ConstellationBuild {
  const derived = deriveEvidence(input, options);
  const skills = aggregateSkills(derived.evidence, derived.definitions).map((skill) => ({
    ...skill,
    strength: computeStrength(skill, options.now),
  }));
  const links = computeLinks(skills, repositoriesBySkill(derived.evidence));
  const layout = layoutConstellation(skills.map((s) => ({ id: s.id, category: s.category, score: s.strength.score })));

  const current = new Set(skills.map((s) => s.id));
  const previous = new Set(options.previousSkillIds ?? []);
  return {
    skills,
    evidence: derived.evidence,
    links,
    layout,
    added: [...current].filter((id) => !previous.has(id)).sort(),
    lost: [...previous].filter((id) => !current.has(id)).sort(),
    refusedPrivate: derived.refusedPrivate,
    othersCommits: derived.othersCommits,
  };
}
