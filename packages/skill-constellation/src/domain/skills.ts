/**
 * Skills from evidence. A skill is the summary of its evidence rows, so a
 * skill with no evidence cannot exist: there is nothing to summarise.
 */

import { ACTIVITY_KINDS, type RepositoryActivity, type Skill, type SkillDefinition, type SkillEvidence } from './types.ts';

export function aggregateSkills(
  evidence: readonly SkillEvidence[],
  definitions: ReadonlyMap<string, SkillDefinition>,
  repositoryActivity: ReadonlyMap<string, RepositoryActivity> = new Map(),
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
    const work = datedWork(definition, rows, repositoryActivity);
    skills.push({
      id: definition.id,
      name: definition.name,
      category: definition.category,
      evidenceCount: rows.length,
      repositoryCount: new Set(rows.map((r) => r.repositoryId)).size,
      evidenceKinds: new Set(rows.map((r) => r.kind)).size,
      firstEvidenceAt: dates[0]!,
      lastEvidenceAt: dates[dates.length - 1]!,
      activityCount: work.count,
      firstActivityAt: work.firstAt,
      lastActivityAt: work.lastAt,
    });
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A language is dated by its own commits and resolved TODOs. Nothing else has
 * rows of its own beyond "a manifest names it", and the day a scan read that
 * line says nothing about when the work happened, so it is dated by the
 * commits in the repositories that still declare it.
 */
function datedWork(
  definition: SkillDefinition,
  rows: readonly SkillEvidence[],
  repositoryActivity: ReadonlyMap<string, RepositoryActivity>,
): { count: number; firstAt: string | null; lastAt: string | null } {
  if (definition.category === 'language') {
    const dates = rows.filter((r) => ACTIVITY_KINDS.has(r.kind)).map((r) => r.at).sort();
    return { count: dates.length, firstAt: dates[0] ?? null, lastAt: dates[dates.length - 1] ?? null };
  }
  const declaring = new Set(rows.filter((r) => r.kind !== 'technology.removed').map((r) => r.repositoryId));
  let count = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for (const repositoryId of declaring) {
    const activity = repositoryActivity.get(repositoryId);
    if (!activity) continue;
    count += activity.count;
    if (firstAt === null || activity.firstAt < firstAt) firstAt = activity.firstAt;
    if (lastAt === null || activity.lastAt > lastAt) lastAt = activity.lastAt;
  }
  return { count, firstAt, lastAt };
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
