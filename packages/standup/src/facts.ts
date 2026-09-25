/**
 * Read-only fact collection from DI PersistencePorts.
 * Per-repo try/catch: a failing repo becomes a partial-failure fact and does
 * NOT abort the whole report. No scanning / git / network.
 */

import type {
  DeveloperEvent,
  HealthCheck,
  HealthRun,
  PersistencePorts,
  Repository,
  RepositorySnapshot,
  ScanRun,
  StandupTimeWindow,
  TodoMarker,
} from '@dexnest/dev-intelligence-contracts';

export interface RepoFacts {
  readonly repositoryId: string;
  readonly displayName?: string;
  readonly ok: boolean;
  /** When ok=false: diagnostic message. */
  readonly errorMessage?: string;
  readonly errorKind?: 'load_failure' | 'scan_failed';
  readonly snapshot?: RepositorySnapshot;
  readonly events: readonly DeveloperEvent[];
  readonly openTodos: readonly TodoMarker[];
  readonly resolvedTodos: readonly TodoMarker[];
  readonly healthChecks: readonly HealthCheck[];
  /** Latest run per check id (may be empty). */
  readonly latestHealthRuns: ReadonlyMap<string, HealthRun>;
  readonly lastScanRelevant?: ScanRun;
}

export interface CollectedFacts {
  readonly repositories: readonly RepoFacts[];
  readonly window: StandupTimeWindow;
}

const EVENT_TYPES_OF_INTEREST = [
  'dev.commit.observed',
  'dev.branch.changed',
  'dev.working_tree.changed',
  'dev.conflict.observed',
  'dev.git_operation.started',
  'dev.git_operation.resolved',
  'dev.todo.observed',
  'dev.todo.resolved',
  'dev.health.completed',
] as const;

async function loadRepoFacts(
  persistence: PersistencePorts,
  repo: Repository,
  window: StandupTimeWindow,
  recentScans: readonly ScanRun[],
): Promise<RepoFacts> {
  try {
    const snapshot = await persistence.repositories.getLatestSnapshot(repo.id);

    const events: DeveloperEvent[] = [];
    for (const type of EVENT_TYPES_OF_INTEREST) {
      const batch = await persistence.events.listByRepository(repo.id, {
        type,
        since: window.from,
        limit: 500,
      });
      // Upper bound: drop events at/after window.to
      for (const e of batch) {
        if (e.observedAt < window.to) {
          events.push(e);
        }
      }
    }
    events.sort((a, b) => a.observedAt.localeCompare(b.observedAt));

    const openTodos = await persistence.todos.listByRepository(repo.id, {
      status: 'open',
    });
    const resolvedTodos = (
      await persistence.todos.listByRepository(repo.id, { status: 'resolved' })
    ).filter(
      (t) =>
        t.resolvedAt !== undefined &&
        t.resolvedAt >= window.from &&
        t.resolvedAt < window.to,
    );

    const healthChecks = await persistence.health.listChecks(repo.id);
    const latestHealthRuns = new Map<string, HealthRun>();
    for (const check of healthChecks) {
      const runs = await persistence.health.listRuns(check.id, { limit: 1 });
      if (runs[0]) latestHealthRuns.set(check.id, runs[0]);
    }

    // Scan relevance: any recent scan that targeted this repo and failed/partial
    const lastScanRelevant = recentScans.find((s) => {
      if (!s.targetRepositoryIds || s.targetRepositoryIds.length === 0) {
        return s.state === 'FAILED' || s.state === 'PARTIAL';
      }
      return (
        s.targetRepositoryIds.includes(repo.id) &&
        (s.state === 'FAILED' || s.state === 'PARTIAL')
      );
    });

    if (lastScanRelevant?.state === 'FAILED') {
      return {
        repositoryId: repo.id,
        displayName: repo.displayName,
        ok: false,
        errorMessage:
          lastScanRelevant.errorSummary ??
          `Last scan ${lastScanRelevant.id} marked FAILED`,
        errorKind: 'scan_failed',
        snapshot,
        events,
        openTodos,
        resolvedTodos,
        healthChecks,
        latestHealthRuns,
        lastScanRelevant,
      };
    }

    return {
      repositoryId: repo.id,
      displayName: repo.displayName,
      ok: true,
      snapshot,
      events,
      openTodos,
      resolvedTodos,
      healthChecks,
      latestHealthRuns,
      lastScanRelevant,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      repositoryId: repo.id,
      displayName: repo.displayName,
      ok: false,
      errorMessage: message,
      errorKind: 'load_failure',
      events: [],
      openTodos: [],
      resolvedTodos: [],
      healthChecks: [],
      latestHealthRuns: new Map(),
    };
  }
}

/**
 * Collect facts for all (or filtered) repositories. Never throws on per-repo errors.
 */
export async function collectFacts(
  persistence: PersistencePorts,
  window: StandupTimeWindow,
  repositoryIds?: readonly string[],
): Promise<CollectedFacts> {
  let repos = await persistence.repositories.listRepositories();
  if (repositoryIds && repositoryIds.length > 0) {
    const want = new Set(repositoryIds);
    repos = repos.filter((r) => want.has(r.id));
  }
  // Stable order
  repos = [...repos].sort((a, b) => a.id.localeCompare(b.id));

  const recentScans = await persistence.scanRuns.listRecent(20);

  const repositories: RepoFacts[] = [];
  for (const repo of repos) {
    repositories.push(
      await loadRepoFacts(persistence, repo, window, recentScans),
    );
  }

  return { repositories, window };
}
