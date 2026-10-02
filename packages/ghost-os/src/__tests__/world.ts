/**
 * A synthetic DexNest for engine tests: the foundation's event log and
 * GhostOS's tables on one real SQLite file in a temp directory, and a fake
 * Developer Intelligence reader. Nothing real is read.
 */
import { createEventLog, runFoundationMigrations, type EventLog, type EventQuery } from '@dexnest/foundation';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import {
  createAllowedEventReader,
  createDeveloperIntelligenceAdapter,
  createGhostEngine,
  openGhostStore,
  type DiRepository,
  type DiTechnology,
  type GhostEngine,
  type GhostStore,
} from '../index.ts';

export interface World {
  handle: TestDatabase;
  log: EventLog;
  store: GhostStore;
  engine: GhostEngine;
  queries: EventQuery[];
  techRequests: string[];
  clock: { now: string };
  repos: DiRepository[];
  techs: DiTechnology[];
  failReads: { on: boolean };
  /** Runs `hook` once, the next time DI is read (inside collect, before any write). */
  duringNextRead: { hook: (() => void) | null };
  commit(repositoryId: string, sha: string, at: string, extra?: Record<string, unknown>): void;
  sync(occurrenceId?: string): ReturnType<GhostEngine['sync']>;
  /** Every ghost_ table's rows as JSON. */
  dump(): string;
  dispose(): void;
}

let n = 0;

export function repo(id: string, root: string, displayName?: string): DiRepository {
  return { id, roots: [{ path: root }], displayName, discoveredAt: '2026-01-01T00:00:00.000Z' };
}

export function tech(repositoryId: string, name: string, over: Partial<DiTechnology> = {}): DiTechnology {
  return {
    id: `tf-${repositoryId}-${name}`.toLowerCase(),
    repositoryId,
    category: 'language',
    name,
    evidencePath: 'package.json',
    evidenceKind: 'package.json',
    status: 'observed',
    firstObservedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

export function createWorld(options: { isSensitive?: (path: string) => boolean; pageSize?: number } = {}): World {
  const handle = createTestDatabase('ghost-engine-');
  runFoundationMigrations(handle.db);
  const log = createEventLog(handle.db);
  const store = openGhostStore(handle.db, { now: '2026-06-01T00:00:00.000Z' });
  const queries: EventQuery[] = [];
  const techRequests: string[] = [];
  const clock = { now: '2026-06-30T12:00:00.000Z' };
  const repos: DiRepository[] = [];
  const techs: DiTechnology[] = [];
  const failReads = { on: false };
  const duringNextRead: World['duringNextRead'] = { hook: null };

  const spyLog = {
    query<TPayload = unknown>(filter?: EventQuery) {
      queries.push(filter ?? {});
      return log.query<TPayload>(filter);
    },
  };
  const adapter = createDeveloperIntelligenceAdapter({
    reader: {
      async listRepositories() {
        if (failReads.on) throw new Error('DI store unavailable');
        const hook = duringNextRead.hook;
        duringNextRead.hook = null;
        hook?.();
        return repos.map((r) => ({ ...r }));
      },
      async listTechnologies(repositoryId) {
        techRequests.push(repositoryId);
        return techs.filter((t) => t.repositoryId === repositoryId);
      },
    },
    events: createAllowedEventReader(spyLog),
    isSensitive: options.isSensitive ?? (() => false),
    pageSize: options.pageSize,
  });
  const engine = createGhostEngine({ store, adapters: [adapter], now: () => clock.now, timeZone: () => 'UTC', newId: () => `run-${++n}` });

  return {
    handle,
    log,
    store,
    engine,
    queries,
    techRequests,
    clock,
    repos,
    techs,
    failReads,
    duringNextRead,
    commit(repositoryId, sha, at, extra = {}) {
      log.append({
        type: 'dev.commit.observed',
        stream: 'dev',
        module: 'developer_intelligence',
        subject: repositoryId,
        source: 'developer_intelligence',
        occurredAt: at,
        idempotencyKey: `test:commit:${repositoryId}:${sha}:${++n}`,
        payload: { sha, subject: 'a commit subject', authorDate: at, ...extra },
      });
    },
    sync(occurrenceId = `sync:${++n}`) {
      return engine.sync('developer_intelligence', { occurrenceId, trigger: 'manual' });
    },
    dump() {
      const tables = handle.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ghost\\_%' ESCAPE '\\' ORDER BY name")
        .all<{ name: string }>()
        .map((r) => r.name);
      return JSON.stringify(tables.map((t) => [t, handle.db.prepare(`SELECT * FROM "${t}"`).all()]));
    },
    dispose() {
      handle.dispose();
    },
  };
}

/** An ISO time `daysAgo` days before `now`, at hh:mm UTC. */
export function daysBefore(now: string, daysAgo: number, hhmm: string): string {
  const day = new Date(Date.parse(now) - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return `${day}T${hhmm}:00.000Z`;
}
