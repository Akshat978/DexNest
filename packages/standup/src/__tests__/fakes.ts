/**
 * In-memory fakes for StandupStore + PersistencePorts (engine unit tests).
 */

import type {
  DeveloperEvent,
  HealthCheck,
  HealthRun,
  IssueLifecycleState,
  ListStandupReportsQuery,
  ListStandupReportsResult,
  PersistencePorts,
  Repository,
  RetentionPolicy,
  ScanDiagnostic,
  RepositorySnapshot,
  ScanRun,
  StandupReport,
  StandupStore,
  StandupTriggerKind,
  TechnologyFact,
  TodoMarker,
} from '@dexnest/dev-intelligence-contracts';
import { DEFAULT_RETENTION_POLICY } from '@dexnest/dev-intelligence-contracts';

export function createFakeStandupStore(
  seed?: StandupReport[],
): StandupStore & {
  _reports: StandupReport[];
  _issueStates: IssueLifecycleState[];
} {
  const reports: StandupReport[] = [...(seed ?? [])];
  let issueStates: IssueLifecycleState[] = [];

  return {
    _reports: reports,
    get _issueStates() {
      return issueStates;
    },
    set _issueStates(v: IssueLifecycleState[]) {
      issueStates = v;
    },

    async saveReport(report: StandupReport): Promise<StandupReport> {
      const existing = reports.find(
        (r) =>
          r.occurrenceId === report.occurrenceId &&
          r.triggerKind === report.triggerKind,
      );
      if (existing) return existing;
      reports.push(report);
      return report;
    },

    async findByOccurrence(
      occurrenceId: string,
      triggerKind: StandupTriggerKind,
    ): Promise<StandupReport | null> {
      return (
        reports.find(
          (r) =>
            r.occurrenceId === occurrenceId && r.triggerKind === triggerKind,
        ) ?? null
      );
    },

    async getReport(id: string): Promise<StandupReport | null> {
      return reports.find((r) => r.id === id) ?? null;
    },

    async listReports(
      query: ListStandupReportsQuery,
    ): Promise<ListStandupReportsResult> {
      let list = [...reports];
      if (query.triggerKind) {
        list = list.filter((r) => r.triggerKind === query.triggerKind);
      }
      if (query.occurrenceId) {
        list = list.filter((r) => r.occurrenceId === query.occurrenceId);
      }
      if (query.windowKind) {
        list = list.filter((r) => r.timeWindow.kind === query.windowKind);
      }
      if (query.generatedFrom) {
        list = list.filter((r) => r.generatedAt >= query.generatedFrom!);
      }
      if (query.generatedTo) {
        list = list.filter((r) => r.generatedAt < query.generatedTo!);
      }
      list.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 50;
      return { reports: list.slice(offset, offset + limit), total: list.length };
    },

    async getLatestSuccessfulReport(): Promise<StandupReport | null> {
      const list = [...reports].sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      );
      return list[0] ?? null;
    },

    async getIssueStates(): Promise<readonly IssueLifecycleState[]> {
      return issueStates.filter((s) => s.lifecycle !== 'RESOLVED');
    },

    async upsertIssueStates(
      states: readonly IssueLifecycleState[],
    ): Promise<void> {
      issueStates = states.filter((s) => s.lifecycle !== 'RESOLVED').map((s) => ({
        ...s,
      }));
    },
  };
}

export interface FakePersistenceSeed {
  repositories?: Repository[];
  snapshots?: RepositorySnapshot[];
  events?: DeveloperEvent[];
  todos?: TodoMarker[];
  healthChecks?: HealthCheck[];
  healthRuns?: HealthRun[];
  scanRuns?: ScanRun[];
  /** repositoryId → throw when loading facts */
  failingRepoIds?: Set<string>;
}

export function createFakePersistence(
  seed: FakePersistenceSeed = {},
): PersistencePorts {
  const repositories = [...(seed.repositories ?? [])];
  const snapshots = [...(seed.snapshots ?? [])];
  const events = [...(seed.events ?? [])];
  const todos = [...(seed.todos ?? [])];
  const healthChecks = [...(seed.healthChecks ?? [])];
  const healthRuns = [...(seed.healthRuns ?? [])];
  const scanRuns = [...(seed.scanRuns ?? [])];
  const failing = seed.failingRepoIds ?? new Set<string>();
  const technologies: TechnologyFact[] = [];
  let retentionPolicy: RetentionPolicy = { ...DEFAULT_RETENTION_POLICY };
  const diagnostics: ScanDiagnostic[] = [];

  const pruneRunsFor = (healthCheckId: string, keepLimit: number): number => {
    const newestFirst = healthRuns
      .filter((r) => r.healthCheckId === healthCheckId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (newestFirst.length <= keepLimit) return 0;
    const doomed = new Set(newestFirst.slice(keepLimit).map((r) => r.id));
    for (let i = healthRuns.length - 1; i >= 0; i--) {
      if (doomed.has(healthRuns[i]!.id)) healthRuns.splice(i, 1);
    }
    return doomed.size;
  };

  const trim = (text: string | undefined, maxBytes: number): string | undefined => {
    if (text === undefined || Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
    return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  };

  return {
    repositories: {
      async upsertRepository(repo) {
        const i = repositories.findIndex((r) => r.id === repo.id);
        if (i >= 0) repositories[i] = repo;
        else repositories.push(repo);
      },
      async getRepository(id) {
        return repositories.find((r) => r.id === id);
      },
      async listRepositories() {
        return [...repositories];
      },
      async saveSnapshot(snapshot) {
        snapshots.push(snapshot);
      },
      async getLatestSnapshot(repositoryId) {
        if (failing.has(repositoryId)) {
          throw new Error(`simulated load failure for ${repositoryId}`);
        }
        const list = snapshots
          .filter((s) => s.repositoryId === repositoryId)
          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
        return list[0];
      },
      async getSnapshot(snapshotId) {
        return snapshots.find((s) => s.id === snapshotId);
      },
    },
    events: {
      async append(event) {
        if (events.some((e) => e.fingerprint === event.fingerprint)) return false;
        events.push(event);
        return true;
      },
      async getById(eventId) {
        return events.find((e) => e.eventId === eventId);
      },
      async listByRepository(repositoryId, options) {
        if (failing.has(repositoryId)) {
          throw new Error(`simulated event load failure for ${repositoryId}`);
        }
        let list = events.filter((e) => e.repositoryId === repositoryId);
        if (options?.type) list = list.filter((e) => e.type === options.type);
        if (options?.since) {
          list = list.filter((e) => e.observedAt >= options.since!);
        }
        list.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
        return list.slice(0, options?.limit ?? 500);
      },
      async findByFingerprint(fingerprint) {
        return events.find((e) => e.fingerprint === fingerprint);
      },
    },
    scanRuns: {
      async create(run) {
        scanRuns.push(run);
      },
      async update(run) {
        const i = scanRuns.findIndex((s) => s.id === run.id);
        if (i >= 0) scanRuns[i] = run;
      },
      async get(id) {
        return scanRuns.find((s) => s.id === id);
      },
      async listRecent(limit = 20) {
        return [...scanRuns]
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, limit);
      },
      async listIncomplete() {
        return scanRuns.filter((s) => s.state === 'STARTED');
      },
    },
    todos: {
      async upsert(marker) {
        const i = todos.findIndex((t) => t.id === marker.id);
        if (i >= 0) todos[i] = marker;
        else todos.push(marker);
      },
      async get(id) {
        return todos.find((t) => t.id === id);
      },
      async findByFingerprint(repositoryId, fingerprint) {
        return todos.find(
          (t) => t.repositoryId === repositoryId && t.fingerprint === fingerprint,
        );
      },
      async listByRepository(repositoryId, options) {
        let list = todos.filter((t) => t.repositoryId === repositoryId);
        if (options?.status) list = list.filter((t) => t.status === options.status);
        return list;
      },
    },
    health: {
      async upsertCheck(check) {
        const i = healthChecks.findIndex((c) => c.id === check.id);
        if (i >= 0) healthChecks[i] = check;
        else healthChecks.push(check);
      },
      async getCheck(id) {
        return healthChecks.find((c) => c.id === id);
      },
      async listChecks(repositoryId) {
        return healthChecks.filter((c) => c.repositoryId === repositoryId);
      },
      // Mirrors sqlite-store: enabled only, ordered by name.
      async listEnabledChecks(repositoryId) {
        return healthChecks
          .filter((c) => c.repositoryId === repositoryId && c.enabled)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      async saveRun(run) {
        healthRuns.push(run);
      },
      async getRun(id) {
        return healthRuns.find((r) => r.id === id);
      },
      async listRuns(healthCheckId, options) {
        const list = healthRuns
          .filter((r) => r.healthCheckId === healthCheckId)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        return list.slice(0, options?.limit ?? 50);
      },
      // Mirrors sqlite-store: keep the newest `keepLimit` by startedAt, delete the rest.
      async pruneRuns(healthCheckId, keepLimit) {
        return pruneRunsFor(healthCheckId, keepLimit);
      },
    },
    technologies: {
      // An upsert, as in sqlite-store - this used to append, so a fact observed
      // twice appeared twice and anything counting technologies saw double.
      async upsert(fact) {
        const i = technologies.findIndex((t) => t.id === fact.id);
        if (i >= 0) technologies[i] = fact;
        else technologies.push(fact);
      },
      async get(id) {
        return technologies.find((t) => t.id === id);
      },
      async findByFingerprint(repositoryId, fingerprint) {
        return technologies.find(
          (t) =>
            t.repositoryId === repositoryId && t.fingerprint === fingerprint,
        );
      },
      async listByRepository(repositoryId) {
        return technologies.filter((t) => t.repositoryId === repositoryId);
      },
      // Mirrors sqlite-store: only a fact not already removed changes.
      async markRemoved(repositoryId, fingerprint, removedAt) {
        const fact = technologies.find(
          (t) => t.repositoryId === repositoryId && t.fingerprint === fingerprint,
        );
        if (fact && fact.status !== 'removed') {
          fact.status = 'removed';
          fact.removedAt = removedAt;
        }
        return fact;
      },
    },
    // Mirrors sqlite-store's retention: trim oversized health output, keep the
    // newest runs per check, drop diagnostics past their age or the row cap.
    // This was missing entirely; the fake only compiled because tests were
    // never typechecked.
    retention: {
      async getPolicy() {
        return { ...retentionPolicy };
      },
      async setPolicy(policy) {
        retentionPolicy = { ...policy };
      },
      async saveDiagnostic(diag) {
        diagnostics.push(diag);
      },
      async listDiagnostics(options) {
        const list = diagnostics
          .filter((d) => !options?.scanRunId || d.scanRunId === options.scanRunId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return list.slice(0, options?.limit ?? list.length);
      },
      async applyRetention(policy) {
        const p = policy ?? retentionPolicy;
        let healthOutputsTrimmed = 0;
        for (const run of healthRuns) {
          const stdout = trim(run.stdoutPreview, p.maxHealthOutputBytes);
          const stderr = trim(run.stderrPreview, p.maxHealthOutputBytes);
          if (stdout !== run.stdoutPreview || stderr !== run.stderrPreview) {
            run.stdoutPreview = stdout;
            run.stderrPreview = stderr;
            healthOutputsTrimmed += 1;
          }
        }
        let healthRunsDeleted = 0;
        for (const check of healthChecks) {
          healthRunsDeleted += pruneRunsFor(check.id, p.maxHealthRunsPerCheck);
        }
        const cutoff = new Date(Date.now() - p.maxDiagnosticAgeMs).toISOString();
        const before = diagnostics.length;
        const keep = diagnostics
          .filter((d) => d.createdAt >= cutoff)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, p.maxDiagnosticRows);
        diagnostics.splice(0, diagnostics.length, ...keep);
        return { healthRunsDeleted, diagnosticsDeleted: before - keep.length, healthOutputsTrimmed };
      },
    },
  };
}

export function makeRepo(
  id: string,
  displayName?: string,
): Repository {
  return {
    schemaVersion: 1,
    id,
    displayName: displayName ?? id,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    roots: [{ path: `/repos/${id}`, domain: 'wsl' }],
  };
}

export function makeSnapshot(
  repoId: string,
  opts: {
    capturedAt?: string;
    branch?: string;
    dirty?: number;
    staged?: number;
    conflicts?: number;
    unfinished?: string;
    samplePaths?: string[];
  } = {},
): RepositorySnapshot {
  const unstaged = opts.dirty ?? 0;
  const staged = opts.staged ?? 0;
  const conflicted = opts.conflicts ?? 0;
  return {
    schemaVersion: 1,
    id: `snap_${repoId}`,
    repositoryId: repoId,
    capturedAt: opts.capturedAt ?? '2026-09-20T12:00:00.000Z',
    root: { path: `/repos/${repoId}`, domain: 'wsl' },
    git: {
      schemaVersion: 1,
      headDetached: false,
      currentBranch: opts.branch ?? 'main',
      branches: [
        {
          name: opts.branch ?? 'main',
          isCurrent: true,
          isRemote: false,
        },
      ],
      recentCommits: [],
      workingTree: {
        isClean: unstaged + staged + conflicted === 0,
        stagedCount: staged,
        unstagedCount: unstaged,
        untrackedCount: 0,
        conflictedCount: conflicted,
        samplePaths: opts.samplePaths,
      },
      remoteTrackingConfidence: 'local_cache',
      interruptedOperation: opts.unfinished,
    },
  };
}

export function makeCommitEvent(
  repoId: string,
  sha: string,
  observedAt: string,
  subject = 'commit',
): DeveloperEvent {
  return {
    schemaVersion: 1,
    eventId: `evt_commit_${repoId}_${sha}`,
    type: 'dev.commit.observed',
    repositoryId: repoId,
    occurredAt: observedAt,
    observedAt,
    source: 'test',
    sourceIdentity: 't',
    fingerprint: `fp_commit_${repoId}_${sha}`,
    payload: { sha, subject, authorDate: observedAt },
  };
}

export function mutableClock(iso: string): { now: () => Date; set: (iso: string) => void } {
  let current = iso;
  return {
    now: () => new Date(current),
    set: (next: string) => {
      current = next;
    },
  };
}
