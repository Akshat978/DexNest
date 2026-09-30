/**
 * Developer Intelligence, as GhostOS sees it. Pure: the adapter hands in
 * what it read, this says which facts follow and how sure each one is.
 *
 * The input types list every field GhostOS reads from DI - nothing else
 * is asked for, so nothing else can leak in:
 * - a repository: id, roots (paths, to check against the data boundary and
 *   for a fallback name), display name, when DI discovered it;
 * - a technology fact: id, repository, category, name, where DI saw it and
 *   how, whether it is still observed, when first seen;
 * - a commit: repository, sha and time (see privacy.ts projectCommit).
 *
 * What follows:
 * - repository -> project (confidence 1);
 * - technology in a skill category -> skill, one per name across
 *   repositories, and project -uses-> skill (0.9 from a manifest, 0.7
 *   from file extensions only);
 * - commits -> one observation per repository per local day, "N commits
 *   observed" (0.6: DI on main does not say who wrote them).
 */

import { CONFIDENCE, isSkillCategory, technologyConfidence } from './confidence.ts';
import { adapterSourceId, sourceRowId } from './ids.ts';
import type { CommitSample } from './privacy.ts';
import { localDay, normalizeTimestamp } from './time.ts';
import type { Entity, Evidence, Observation, Relation } from './types.ts';
import { LIMITS } from './validation.ts';

export const DI_ADAPTER_ID = 'developer_intelligence';
export const DI_SOURCE_ID = adapterSourceId(DI_ADAPTER_ID);

export interface DiRepository {
  id: string;
  roots: readonly { path: string }[];
  displayName?: string;
  discoveredAt: string;
}

export interface DiTechnology {
  id: string;
  repositoryId: string;
  category: string;
  name: string;
  evidencePath: string;
  evidenceKind: string;
  status: string;
  firstObservedAt: string;
}

export const diRefs = {
  project: (repositoryId: string) => `repo:${repositoryId}`,
  skill: (skillKey: string) => `skill:${skillKey}`,
  uses: (repositoryId: string, skillKey: string) => `uses:${repositoryId}:${skillKey}`,
  day: (repositoryId: string, day: string) => `day:${repositoryId}:${day}`,
};

export const projectIdFor = (repositoryId: string) => sourceRowId('entity', DI_SOURCE_ID, diRefs.project(repositoryId));
export const skillIdFor = (skillKey: string) => sourceRowId('entity', DI_SOURCE_ID, diRefs.skill(skillKey));
export const dayObservationIdFor = (repositoryId: string, day: string) => sourceRowId('observation', DI_SOURCE_ID, diRefs.day(repositoryId, day));

/** One skill per name, whatever the case or spacing DI saw it in. */
export const skillKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80);

const REPO_ID = /^[A-Za-z0-9][A-Za-z0-9_:.@/-]{0,127}$/;

function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function clip(text: string, max: number): string {
  // Strip control characters DI could have carried in, then clip.
  const clean = text.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

export interface DiSnapshot {
  entities: Entity[];
  relations: Relation[];
  /** Repositories GhostOS may know about, by id. */
  projects: Map<string, string>;
  /** Repositories left out: no roots, a root inside DexNest's data, or an unusable id. */
  skippedRepositories: number;
}

/**
 * The projects, skills and "uses" relations DI's records support right now.
 * A repository with no roots, or any root inside DexNest's data, is left out
 * entirely - with its technologies.
 */
export function buildDiSnapshot(
  repositories: readonly DiRepository[],
  technologies: readonly DiTechnology[],
  ctx: { now: string; isSensitive: (path: string) => boolean },
): DiSnapshot {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const projects = new Map<string, string>();
  let skippedRepositories = 0;

  for (const repo of [...repositories].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!REPO_ID.test(repo.id) || repo.roots.length === 0 || repo.roots.some((r) => ctx.isSensitive(r.path))) {
      skippedRepositories += 1;
      continue;
    }
    const id = projectIdFor(repo.id);
    projects.set(repo.id, id);
    const title = clip(repo.displayName || basename(repo.roots[0]?.path ?? repo.id), LIMITS.title) || repo.id;
    entities.push({
      id,
      type: 'project',
      title,
      notes: '',
      tags: [],
      details: {},
      occurredAt: null,
      startedAt: null,
      endedAt: null,
      provenance: {
        origin: 'adapter',
        sourceId: DI_SOURCE_ID,
        sourceRef: diRefs.project(repo.id),
        evidence: [{ kind: 'repository', repositoryId: repo.id }],
        confidence: CONFIDENCE.repositoryProject,
      },
      createdAt: normalizeTimestamp(repo.discoveredAt) ?? ctx.now,
      updatedAt: ctx.now,
    });
  }

  // Skills: one per name; the evidence is every fact naming it, in every known repository.
  const bySkill = new Map<string, { name: string; facts: DiTechnology[] }>();
  for (const fact of technologies) {
    if (fact.status !== 'observed' || !isSkillCategory(fact.category) || !projects.has(fact.repositoryId)) continue;
    const key = skillKey(fact.name);
    if (!key) continue;
    const entry = bySkill.get(key) ?? { name: clip(fact.name, LIMITS.title), facts: [] };
    entry.facts.push(fact);
    bySkill.set(key, entry);
  }

  const evidenceOf = (fact: DiTechnology): Evidence => ({
    kind: 'technology',
    factId: fact.id,
    repositoryId: fact.repositoryId,
    evidencePath: clip(fact.evidencePath, 500),
    evidenceKind: clip(fact.evidenceKind, 80) || 'unknown',
  });
  const confidenceOf = (facts: readonly DiTechnology[]) => Math.max(...facts.map((f) => technologyConfidence(f.evidenceKind)));
  const earliest = (facts: readonly DiTechnology[]) =>
    facts
      .map((f) => normalizeTimestamp(f.firstObservedAt))
      .filter((t): t is string => t !== null)
      .sort()[0] ?? null;

  for (const [key, { name, facts }] of [...bySkill].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...facts].sort((a, b) => a.id.localeCompare(b.id));
    const skillId = skillIdFor(key);
    entities.push({
      id: skillId,
      type: 'skill',
      title: name || key,
      notes: '',
      tags: [],
      details: {},
      occurredAt: null,
      startedAt: earliest(sorted),
      endedAt: null,
      provenance: {
        origin: 'adapter',
        sourceId: DI_SOURCE_ID,
        sourceRef: diRefs.skill(key),
        evidence: sorted.slice(0, LIMITS.evidence).map(evidenceOf),
        confidence: confidenceOf(sorted),
      },
      createdAt: earliest(sorted) ?? ctx.now,
      updatedAt: ctx.now,
    });

    const byRepo = new Map<string, DiTechnology[]>();
    for (const f of sorted) byRepo.set(f.repositoryId, [...(byRepo.get(f.repositoryId) ?? []), f]);
    for (const [repositoryId, repoFacts] of [...byRepo].sort(([a], [b]) => a.localeCompare(b))) {
      const sourceRef = diRefs.uses(repositoryId, key);
      relations.push({
        id: sourceRowId('relation', DI_SOURCE_ID, sourceRef),
        fromId: projects.get(repositoryId) as string,
        toId: skillId,
        type: 'uses',
        strength: 1,
        validFrom: earliest(repoFacts),
        validTo: null,
        notes: '',
        provenance: { origin: 'adapter', sourceId: DI_SOURCE_ID, sourceRef, evidence: repoFacts.slice(0, LIMITS.evidence).map(evidenceOf), confidence: confidenceOf(repoFacts) },
        createdAt: earliest(repoFacts) ?? ctx.now,
        updatedAt: ctx.now,
      });
    }
  }

  return { entities, relations, projects, skippedRepositories };
}

/** Commits grouped by repository and local day. Commits of unknown repositories are dropped. */
export function groupCommitDays(commits: readonly CommitSample[], projects: ReadonlyMap<string, string>, timeZone: string): Map<string, { repositoryId: string; day: string; commits: CommitSample[] }> {
  const groups = new Map<string, { repositoryId: string; day: string; commits: CommitSample[] }>();
  for (const c of commits) {
    if (!projects.has(c.repositoryId)) continue;
    const day = localDay(c.at, timeZone);
    if (day === null) continue;
    const key = diRefs.day(c.repositoryId, day);
    const group = groups.get(key) ?? { repositoryId: c.repositoryId, day, commits: [] };
    group.commits.push(c);
    groups.set(key, group);
  }
  return groups;
}

/**
 * The day's observation, merged with what was already recorded for that day:
 * commits are counted once by sha, however often they are seen.
 */
export function dayObservation(
  group: { repositoryId: string; day: string; commits: readonly CommitSample[] },
  existing: Observation | undefined,
  now: string,
): Observation {
  const bySha = new Map<string, Evidence & { kind: 'commit' }>();
  for (const e of existing?.provenance.evidence ?? []) if (e.kind === 'commit') bySha.set(e.sha, e);
  for (const c of group.commits) if (!bySha.has(c.sha)) bySha.set(c.sha, { kind: 'commit', repositoryId: c.repositoryId, sha: c.sha, at: c.at });
  const all = [...bySha.values()].sort((a, b) => a.at.localeCompare(b.at) || a.sha.localeCompare(b.sha));
  // More than LIMITS.evidence commits in one repository in one day keeps the first ones.
  const evidence = all.slice(0, LIMITS.evidence);
  const counted = evidence.length;
  const sourceRef = diRefs.day(group.repositoryId, group.day);
  return {
    id: dayObservationIdFor(group.repositoryId, group.day),
    entityId: projectIdFor(group.repositoryId),
    statement: `${counted} commit${counted === 1 ? '' : 's'} observed`,
    observedAt: evidence[evidence.length - 1]?.at ?? now,
    provenance: { origin: 'adapter', sourceId: DI_SOURCE_ID, sourceRef, evidence, confidence: CONFIDENCE.commitsObserved },
    createdAt: existing?.createdAt ?? now,
  };
}

/** Activity for habit detection: one sample per commit time, pointing at its day observation. */
export function commitActivity(observations: readonly Observation[]) {
  return observations.flatMap((o) => o.provenance.evidence.flatMap((e) => (e.kind === 'commit' ? [{ observationId: o.id, at: e.at }] : [])));
}
