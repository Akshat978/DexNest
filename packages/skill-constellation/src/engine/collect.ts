/**
 * Gathering a build's input from Developer Intelligence.
 *
 * Read through DI's stores (repositories, technology facts, TODO markers) and
 * the shared event log's `dev` stream (commits) - never by SQL against `dev_*`,
 * and never from disk.
 *
 * Consistency: the dev cursor is read FIRST, then the facts, and commits are
 * read only up to that cursor. Anything DI records while a build runs has a
 * higher seq, so the next build sees the cursor moved and picks it up.
 */

import type { EventLog } from '@dexnest/foundation';
import type { CommitObservedPayload, RepositoryStore, TechnologyStore, TodoStore } from '@dexnest/dev-intelligence-contracts';
import type { ConstellationInput, InputCommit, InputRepository } from '../domain/types.ts';

export const DEV_STREAM = 'dev';
export const DEV_MODULE = 'developer_intelligence';
export const COMMIT_EVENT = 'dev.commit.observed';
export const DEFAULT_PAGE_SIZE = 500;

/** The part of Developer Intelligence's persistence the constellation reads. */
export interface DevIntelligenceReader {
  repositories: Pick<RepositoryStore, 'listRepositories'>;
  technologies: Pick<TechnologyStore, 'listByRepository'>;
  todos: Pick<TodoStore, 'listByRepository' | 'get'>;
}

export interface RepositoryRoots {
  id: string;
  roots: readonly string[];
}

export interface CollectedInput {
  input: ConstellationInput;
  /** The newest dev event seq this input reflects. */
  devCursorSeq: number;
  /** Roots per repository, for the data boundary. Never stored. */
  repositoryRoots: RepositoryRoots[];
  /** dev.commit.observed events whose payload could not be read. */
  malformedCommits: number;
}

/** The newest seq in Developer Intelligence's stream; 0 when it has written nothing. */
export function latestDevSeq(events: EventLog): number {
  const [latest] = events.query({ stream: DEV_STREAM, module: DEV_MODULE, orderBy: 'seq', order: 'desc', limit: 1 });
  return latest?.seq ?? 0;
}

function toCommit(repositoryId: string | null, payload: unknown): InputCommit | undefined {
  if (!repositoryId || !payload || typeof payload !== 'object') return undefined;
  const p = payload as Partial<Record<keyof CommitObservedPayload, unknown>>;
  if (typeof p.sha !== 'string' || p.sha.length === 0) return undefined;
  if (typeof p.authorDate !== 'string' || !Number.isFinite(Date.parse(p.authorDate))) return undefined;
  return {
    repositoryId,
    sha: p.sha,
    authorDate: p.authorDate,
    ...(typeof p.authorEmail === 'string' && p.authorEmail.length > 0 ? { authorEmail: p.authorEmail } : {}),
  };
}

export async function collectInput(options: {
  reader: DevIntelligenceReader;
  events: EventLog;
  pageSize?: number;
}): Promise<CollectedInput> {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const devCursorSeq = latestDevSeq(options.events);

  const repos = await options.reader.repositories.listRepositories();
  const repositories: InputRepository[] = repos.map((r) => ({ id: r.id, displayName: r.displayName ?? null }));
  const repositoryRoots = repos.map((r) => ({ id: r.id, roots: r.roots.map((root) => root.path) }));

  const technologies: ConstellationInput['technologies'][number][] = [];
  const todos: ConstellationInput['todos'][number][] = [];
  for (const repo of repos) {
    for (const fact of await options.reader.technologies.listByRepository(repo.id)) {
      technologies.push({
        id: fact.id,
        repositoryId: fact.repositoryId,
        category: fact.category,
        name: fact.name,
        ...(fact.version ? { version: fact.version } : {}),
        evidencePath: fact.evidencePath,
        evidenceKind: fact.evidenceKind,
        status: fact.status,
        lastObservedAt: fact.lastObservedAt,
        ...(fact.removedAt ? { removedAt: fact.removedAt } : {}),
      });
    }
    for (const marker of await options.reader.todos.listByRepository(repo.id)) {
      // The marker's text is deliberately not carried into the input.
      todos.push({
        id: marker.id,
        repositoryId: marker.repositoryId,
        kind: String(marker.kind),
        status: marker.status,
        filePath: marker.filePath,
        ...(marker.line !== undefined ? { line: marker.line } : {}),
        firstObservedAt: marker.firstObservedAt,
        ...(marker.resolvedAt ? { resolvedAt: marker.resolvedAt } : {}),
      });
    }
  }

  // Commits: every one DI recorded, in pages, up to the cursor read above.
  const commits: InputCommit[] = [];
  let malformedCommits = 0;
  let after = 0;
  for (;;) {
    const page = options.events.query({
      stream: DEV_STREAM,
      module: DEV_MODULE,
      types: [COMMIT_EVENT],
      afterSeq: after,
      orderBy: 'seq',
      order: 'asc',
      limit: pageSize,
    });
    let reachedCursor = false;
    for (const event of page) {
      if (event.seq > devCursorSeq) {
        reachedCursor = true;
        break;
      }
      const commit = toCommit(event.subject, event.payload);
      if (commit) commits.push(commit);
      else malformedCommits += 1;
    }
    if (reachedCursor || page.length < pageSize) break;
    after = page[page.length - 1]!.seq;
  }

  return { input: { repositories, technologies, todos, commits }, devCursorSeq, repositoryRoots, malformedCommits };
}
