/**
 * Skills from evidence. A skill is the summary of its evidence rows, so a
 * skill with no evidence cannot exist: there is nothing to summarise.
 */

import { ACTIVITY_KINDS, type Skill, type SkillDefinition, type SkillEvidence } from './types.ts';

export function aggregateSkills(
  evidence: readonly SkillEvidence[],
  definitions: ReadonlyMap<string, SkillDefinition>,
): Skill[] {
  const groups = new Map<string, SkillEvidence[]>();
  for (const row of evidence) {
    let group = groups.get(row.skillId);
    if (!group) groups.set(row.skillId, (group = []));
    group.push(row);
  }

  const skills: Skill[] = [];
  for (const [skillId, rows] of groups) {
    const definition = definitions.get(skillId);
    // Evidence for a skill nobody defined is a caller bug; it names nothing to show.
    if (!definition || rows.length === 0) continue;
    const dates = rows.map((r) => r.at).sort();
    const activity = rows.filter((r) => ACTIVITY_KINDS.has(r.kind)).map((r) => r.at).sort();
    skills.push({
      id: definition.id,
      name: definition.name,
      category: definition.category,
      evidenceCount: rows.length,
      repositoryCount: new Set(rows.map((r) => r.repositoryId)).size,
      evidenceKinds: new Set(rows.map((r) => r.kind)).size,
      firstEvidenceAt: dates[0]!,
      lastEvidenceAt: dates[dates.length - 1]!,
      lastActivityAt: activity.length > 0 ? activity[activity.length - 1]! : null,
    });
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

/** Repositories each skill is evidenced in. */
export function repositoriesBySkill(evidence: readonly SkillEvidence[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of evidence) {
    let set = out.get(row.skillId);
    if (!set) out.set(row.skillId, (set = new Set()));
    set.add(row.repositoryId);
  }
  return out;
}
