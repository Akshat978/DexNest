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
  /**
   * When the repository's first complete inspection finished. What was
   * observed up to then is what it already held, and is not in `events`.
   */
  readonly baselinedAt?: string;
  /** What happened in the window. History found at the first inspection is left out. */
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
  'dev.push.observed',
  'dev.pull.observed',
  'dev.working_tree.changed',
  'dev.conflict.observed',
  'dev.git_operation.started',
  'dev.git_operation.resolved',
  'dev.todo.observed',
  'dev.todo.resolved',
  'dev.health.completed',
] as const;

/** Events whose own time is when the thing happened, not when a scan noticed it. */
const DATED_BY_OCCURRENCE = new Set(['dev.commit.observed', 'dev.push.observed', 'dev.pull.observed']);

/**
 * When the event happened, as a UTC instant. A commit, push or pull carries
 * the time Git recorded; everything else is known only by when it was seen.
 */
export function eventTime(event: DeveloperEvent): string {
  if (!DATED_BY_OCCURRENCE.has(event.type)) return event.observedAt;
  const time = new Date(event.occurredAt);
  return Number.isNaN(time.getTime()) ? event.observedAt : time.toISOString();
}

/**
 * Whether something was already there when the repository was first inspected.
 * A repository scanned before baselines existed has none until its next scan;
 * until then nothing is treated as history.
 */
export function isBaseline(baselinedAt: string | undefined, observedAt: string): boolean {
  return baselinedAt !== undefined && observedAt <= baselinedAt;
}

function isHistory(event: DeveloperEvent, baselinedAt: string | undefined): boolean {
  if ((event.payload as { baseline?: unknown } | null)?.baseline === true) return true;
  return isBaseline(baselinedAt, event.observedAt);
}

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
        if (e.observedAt < window.to && !isHistory(e, repo.baselinedAt)) {
          events.push(e);
        }
      }
    }
    events.sort((a, b) => eventTime(a).localeCompare(eventTime(b)));

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
        baselinedAt: repo.baselinedAt,
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
      baselinedAt: repo.baselinedAt,
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
 * The repositories the last finished scan looked for, or undefined when no
 * scan has finished. A repository recorded once stays in the store; when its
 * project is archived or its folder is no longer watched, the next scan does
 * not look for it, and it should stop appearing as if it were still followed.
 */
export function currentRepositoryIds(recentScans: readonly ScanRun[]): ReadonlySet<string> | undefined {
  const last = recentScans.find((scan) => (scan.state === 'COMPLETED' || scan.state === 'PARTIAL') && scan.targetRepositoryIds !== undefined);
  return last?.targetRepositoryIds ? new Set(last.targetRepositoryIds) : undefined;
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
  const recentScans = await persistence.scanRuns.listRecent(20);
  const current = currentRepositoryIds(recentScans);
  if (current) repos = repos.filter((r) => current.has(r.id));

  // Stable order
  repos = [...repos].sort((a, b) => a.id.localeCompare(b.id));

  const repositories: RepoFacts[] = [];
  for (const repo of repos) {
    repositories.push(
      await loadRepoFacts(persistence, repo, window, recentScans),
    );
  }

  return { repositories, window };
}
