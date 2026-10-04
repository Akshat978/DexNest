/**
 * One constellation from one set of inputs. Pure: the engine gathers the
 * inputs and stores the result; everything decided in between is here.
 */

import { deriveEvidence, type DeriveEvidenceOptions } from './evidence.ts';
import { layoutConstellation } from './layout.ts';
import { computeLinks } from './links.ts';
import { aggregateSkills, repositoriesBySkill } from './skills.ts';
import { computeStrength } from './strength.ts';
import type { ConstellationInput, RepositoryActivityRow, Skill, SkillEvidence, SkillLayoutPoint, SkillLink, SkillStrength } from './types.ts';

export interface ConstellationBuild {
  skills: (Skill & { strength: SkillStrength })[];
  evidence: SkillEvidence[];
  links: SkillLink[];
  layout: SkillLayoutPoint[];
  /** Counted commits per repository: the real dates behind the evidence. */
  repositoryActivity: RepositoryActivityRow[];
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
  const skills = aggregateSkills(derived.evidence, derived.definitions, derived.repositoryActivity).map((skill) => ({
    ...skill,
    strength: computeStrength(skill, options.now),
  }));
  const links = computeLinks(skills, repositoriesBySkill(derived.evidence));
  const layout = layoutConstellation(skills.map((s) => ({ id: s.id, category: s.category, score: s.strength.score })));

  const evidenced = new Set(derived.evidence.map((e) => e.repositoryId));
  const current = new Set(skills.map((s) => s.id));
  const previous = new Set(options.previousSkillIds ?? []);
  return {
    skills,
    evidence: derived.evidence,
    links,
    layout,
    repositoryActivity: [...derived.repositoryActivity]
      // Only repositories that evidence something: one whose evidence was all
      // refused (it sits inside the data root, say) is not named here either.
      .filter(([repositoryId]) => evidenced.has(repositoryId))
      .map(([repositoryId, activity]) => ({ repositoryId, ...activity }))
      .sort((a, b) => a.repositoryId.localeCompare(b.repositoryId)),
    added: [...current].filter((id) => !previous.has(id)).sort(),
    lost: [...previous].filter((id) => !current.has(id)).sort(),
    refusedPrivate: derived.refusedPrivate,
    othersCommits: derived.othersCommits,
  };
}
