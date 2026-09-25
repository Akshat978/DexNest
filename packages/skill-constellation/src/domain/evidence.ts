/**
 * From Developer Intelligence's facts to evidence rows.
 *
 * Rules (docs/modules/skill_constellation/PLAN.md, section 8):
 * - A technology fact is evidence only if it resolves to a skill.
 * - A TODO evidences the language of its file; resolving it is dated activity.
 * - A commit is dated activity in its repository, credited to that
 *   repository's evidenced languages only. With `myEmails` set, only the
 *   owner's commits count; one recorded without an author still counts.
 * - A path that looks private, or that the host says is sensitive, is never
 *   recorded. Refusals are counted, never listed.
 * - No commit subject and no TODO text is copied.
 */

import { catalogueSkill, resolveTechnologySkill } from './catalogue.ts';
import { languageForPath } from './extensions.ts';
import { stableHash } from './hash.ts';
import { isPrivateLookingPath, normalizeRelativePath } from './privacy.ts';
import type { SkillConstellationSettings } from './settings.ts';
import type { ConstellationInput, EvidenceKind, SkillDefinition, SkillEvidence } from './types.ts';

export interface DeriveEvidenceOptions {
  settings: Pick<SkillConstellationSettings, 'includeUnmappedLibraries' | 'myEmails'>;
  /**
   * The host's data boundary, asked about a repository-relative path. The
   * engine answers by joining the path to each of the repository's roots.
   */
  isSensitive?: (repositoryId: string, relativePath: string) => boolean;
}

export interface DerivedEvidence {
  evidence: SkillEvidence[];
  definitions: Map<string, SkillDefinition>;
  /** Evidence dropped because its path looked private or was sensitive. */
  refusedPrivate: number;
  /** Commits dropped because their author is not one of `myEmails`. */
  othersCommits: number;
}

export function evidenceId(skillId: string, kind: EvidenceKind, sourceRef: string): string {
  return `ev_${stableHash(`${skillId}\u001f${kind}\u001f${sourceRef}`)}`;
}

export function deriveEvidence(input: ConstellationInput, options: DeriveEvidenceOptions): DerivedEvidence {
  const names = new Map(input.repositories.map((r) => [r.id, r.displayName]));
  const byId = new Map<string, SkillEvidence>();
  const definitions = new Map<string, SkillDefinition>();
  const languagesByRepository = new Map<string, Set<string>>();
  let refusedPrivate = 0;
  let othersCommits = 0;

  const refuses = (repositoryId: string, path: string) =>
    isPrivateLookingPath(path) || (options.isSensitive?.(repositoryId, path) ?? false);

  const add = (skill: SkillDefinition, row: Omit<SkillEvidence, 'id' | 'skillId' | 'repositoryName'>) => {
    const id = evidenceId(skill.id, row.kind, row.sourceRef);
    if (byId.has(id)) return;
    definitions.set(skill.id, skill);
    byId.set(id, { id, skillId: skill.id, repositoryName: names.get(row.repositoryId) ?? null, ...row });
    if (skill.category === 'language') {
      let set = languagesByRepository.get(row.repositoryId);
      if (!set) languagesByRepository.set(row.repositoryId, (set = new Set()));
      set.add(skill.id);
    }
  };

  for (const fact of input.technologies) {
    const skill = resolveTechnologySkill(fact.category, fact.name, options.settings);
    if (!skill) continue;
    const path = normalizeRelativePath(fact.evidencePath);
    if (refuses(fact.repositoryId, path)) {
      refusedPrivate += 1;
      continue;
    }
    const removed = fact.status === 'removed';
    add(skill, {
      kind: removed ? 'technology.removed' : fact.evidenceKind === 'file-extension' ? 'technology.extension' : 'technology.manifest',
      repositoryId: fact.repositoryId,
      path,
      at: removed ? (fact.removedAt ?? fact.lastObservedAt) : fact.lastObservedAt,
      sourceRef: fact.id,
      detail: fact.version ? `${fact.evidenceKind} ${fact.version}` : fact.evidenceKind,
    });
  }

  for (const todo of input.todos) {
    const path = normalizeRelativePath(todo.filePath);
    const language = languageForPath(path);
    const skill = language ? catalogueSkill(language) : undefined;
    if (!skill) continue;
    if (refuses(todo.repositoryId, path)) {
      refusedPrivate += 1;
      continue;
    }
    const resolved = todo.status === 'resolved';
    add(skill, {
      kind: resolved ? 'todo.resolved' : 'todo.open',
      repositoryId: todo.repositoryId,
      path,
      at: resolved ? (todo.resolvedAt ?? todo.firstObservedAt) : todo.firstObservedAt,
      sourceRef: todo.id,
      detail: todo.line !== undefined ? `${todo.kind} line ${todo.line}` : todo.kind,
    });
  }

  const mine = new Set(options.settings.myEmails.map((e) => e.toLowerCase()));
  for (const commit of input.commits) {
    const author = commit.authorEmail?.trim().toLowerCase();
    if (mine.size > 0 && author && !mine.has(author)) {
      othersCommits += 1;
      continue;
    }
    const languages = languagesByRepository.get(commit.repositoryId);
    if (!languages) continue;
    for (const skillId of [...languages].sort()) {
      const skill = definitions.get(skillId);
      if (!skill) continue;
      add(skill, {
        kind: 'commit',
        repositoryId: commit.repositoryId,
        path: null,
        at: commit.authorDate,
        sourceRef: commit.sha,
        detail: null,
      });
    }
  }

  const evidence = [...byId.values()].sort((a, b) => a.skillId.localeCompare(b.skillId) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { evidence, definitions, refusedPrivate, othersCommits };
}
