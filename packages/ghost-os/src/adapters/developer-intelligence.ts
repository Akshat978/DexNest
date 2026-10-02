/**
 * The Developer Intelligence adapter: repositories -> projects,
 * technologies -> skills, commits -> dated observations.
 *
 * It reads DI through two narrow readers the host builds from DI's stores
 * and the allowed event reader - never the disk, never the rest of the log.
 * A repository inside DexNest's data is not read past its record: its
 * technologies are not asked for and its commits are dropped.
 */

import {
  buildDiSnapshot,
  commitActivity,
  dayObservation,
  dayObservationIdFor,
  DI_SOURCE_ID,
  groupCommitDays,
  type DiRepository,
  type DiTechnology,
} from '../domain/developer-intelligence.ts';
import { DI_EVENT_READ, type CommitSample } from '../domain/privacy.ts';
import type { AllowedEventReader } from './event-reader.ts';
import type { SourceAdapter } from './types.ts';

/** What the host passes in from DI's stores: these two calls and nothing else. */
export interface DiReader {
  listRepositories(): Promise<readonly DiRepository[]>;
  /** Observed technology facts of one repository. */
  listTechnologies(repositoryId: string): Promise<readonly DiTechnology[]>;
}

export interface DeveloperIntelligenceAdapterOptions {
  reader: DiReader;
  events: AllowedEventReader;
  /** The host's data boundary. */
  isSensitive(path: string): boolean;
  /** Commits read per page. */
  pageSize?: number;
}

const COMMITS = { stream: DI_EVENT_READ.stream, module: DI_EVENT_READ.module, types: DI_EVENT_READ.types };

export function createDeveloperIntelligenceAdapter(options: DeveloperIntelligenceAdapterOptions): SourceAdapter {
  const pageSize = options.pageSize ?? 1000;

  function readCommits(afterSeq: number, subject?: string): { commits: CommitSample[]; lastSeq: number | null } {
    const commits: CommitSample[] = [];
    let cursor = afterSeq;
    let lastSeq: number | null = null;
    for (;;) {
      const page = options.events.query({ ...COMMITS, afterSeq: cursor, subject, limit: pageSize });
      commits.push(...page.commits);
      if (page.lastSeq !== null) {
        lastSeq = page.lastSeq;
        cursor = page.lastSeq;
      }
      if (page.rows < pageSize) return { commits, lastSeq };
    }
  }

  return {
    id: 'developer_intelligence',
    sourceId: DI_SOURCE_ID,
    habitSubject: 'commits',

    async collect(ctx) {
      const repositories = await options.reader.listRepositories();
      // Ask for technologies only of repositories GhostOS may know about.
      const allowed = repositories.filter((r) => r.roots.length > 0 && !r.roots.some((root) => options.isSensitive(root.path)));
      const technologies: DiTechnology[] = [];
      for (const repo of allowed) technologies.push(...(await options.reader.listTechnologies(repo.id)));
      const snapshot = buildDiSnapshot(allowed, technologies, { now: ctx.now, isSensitive: options.isSensitive });
      const skipped = repositories.length - allowed.length + snapshot.skippedRepositories;

      // Commits since the cursor. If the log's seqs went backwards (pruned and reused), start over:
      // merging by sha makes a re-read harmless.
      let from = Number(ctx.cursor ?? 0);
      if (!Number.isInteger(from) || from < 0) from = 0;
      const latest = options.events.latestSeq(COMMITS);
      if (latest === null || latest < from) from = 0;
      const recent = readCommits(from);
      // A project GhostOS does not hold yet gets its whole history, not just what is new.
      const earlier = [...snapshot.projects].filter(([, projectId]) => !ctx.entityExists(projectId)).flatMap(([repositoryId]) => readCommits(0, repositoryId).commits);

      const groups = groupCommitDays([...earlier, ...recent.commits], snapshot.projects, ctx.timeZone);
      const observations = [...groups.values()].map((g) => dayObservation(g, ctx.getObservation(dayObservationIdFor(g.repositoryId, g.day)), ctx.now));

      return {
        entities: snapshot.entities,
        relations: snapshot.relations,
        observations,
        cursor: String(recent.lastSeq ?? from),
        skipped,
      };
    },

    activity: (observations) => commitActivity(observations),
  };
}
