/**
 * Developer Intelligence as a DexNest module.
 *
 * Everything the desktop host needs, behind the foundation's host ports, so the
 * host file is wiring and nothing else: it hands over the shared database, the
 * event log, the data boundary, the scheduler and module settings, and gets
 * back scan and Standup entry points.
 *
 * What this adds on top of the scan orchestrator and the Standup engine:
 *
 *   - Off until asked. Nothing is scanned until the user has named at least one
 *     root and turned the module on. An enabled module scans on the host's
 *     schedule, as heavy work, so Performance Mode holds it off.
 *   - The data boundary is enforced twice. A configured root inside DexNest's
 *     data is refused outright, and the orchestrator gets the boundary as
 *     `isSensitive` so no file under it is read even from an allowed root.
 *   - Standup follows the scan. The first scan of the local day produces that
 *     day's scheduled Standup; every later scheduled trigger for the same day
 *     resolves to the same report, because the engine keys scheduled reports
 *     by occurrence.
 *   - Asking is different from the timer. A scan or a Standup the user asked
 *     for writes a new report, and one that replaces today's covers the same
 *     ground: it starts where today's started and runs to now. Otherwise
 *     "Scan now" would rescan and then show the morning's report unchanged, or
 *     show only the minutes since the last press.
 */

import { randomUUID } from 'node:crypto';
import type { DataBoundary, EventLog, JobOccurrence, ModuleScheduler, ModuleSettings, SqlDatabase } from '@dexnest/foundation';
import type {
  ProcessRunnerPort,
  Repository,
  RepositoryExecutionDomain,
  ScanRun,
  StandupReport,
} from '@dexnest/dev-intelligence-contracts';
import { createDevIntelligencePersistence, type DevIntelligencePersistence } from '@dexnest/dev-intelligence-store';
import { createStandupService, currentRepositoryIds, localDateString, type StandupClock } from '@dexnest/standup';
import { defaultDiscoveryConfig, type DiscoveryConfig } from '../config/roots.js';
import { createDomainRegistry, type DomainRegistry } from '../domain/execution-domains.js';
import { createGitAvailabilityProbe, type DomainAvailabilityProbe } from '../domain/availability.js';
import { ScanOrchestrator, type ScanResult } from '../scan/orchestrator.js';

export const DEV_SCAN_JOB = 'scan';

export interface DevIntelligenceRoot {
  path: string;
  domain: RepositoryExecutionDomain;
}

/** A repository the host already knows by name: a project. */
export interface LinkedRepository extends DevIntelligenceRoot {
  displayName?: string;
}

export interface DevIntelligenceSettings {
  schemaVersion: 1;
  /** Off by default: DexNest does not walk anyone's disk until asked to. */
  enabled: boolean;
  roots: DevIntelligenceRoot[];
  manualRepositories: DevIntelligenceRoot[];
  excludedRoots: string[];
  scanIntervalMinutes: number;
  /** Runs health checks the user configured and enabled. Never auto-discovered ones. */
  runHealthChecks: boolean;
}

export const MIN_SCAN_INTERVAL_MINUTES = 5;

export function defaultDevIntelligenceSettings(): DevIntelligenceSettings {
  return {
    schemaVersion: 1,
    enabled: false,
    roots: [],
    manualRepositories: [],
    excludedRoots: [],
    scanIntervalMinutes: 30,
    runHealthChecks: true,
  };
}

/** Accepts anything read back from disk and returns a usable settings object. */
export function normalizeDevIntelligenceSettings(input: unknown): DevIntelligenceSettings {
  const base = defaultDevIntelligenceSettings();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<Record<keyof DevIntelligenceSettings, unknown>>;
  const roots = (value: unknown): DevIntelligenceRoot[] =>
    Array.isArray(value)
      ? value
          .filter((r): r is { path: string; domain?: unknown } => Boolean(r) && typeof (r as { path?: unknown }).path === 'string')
          .map((r): DevIntelligenceRoot => ({ path: r.path.trim(), domain: r.domain === 'wsl' ? 'wsl' : 'windows' }))
          .filter((r) => r.path.length > 0)
      : [];
  const interval = Number(raw.scanIntervalMinutes);
  return {
    schemaVersion: 1,
    enabled: raw.enabled === true,
    roots: roots(raw.roots),
    manualRepositories: roots(raw.manualRepositories),
    excludedRoots: Array.isArray(raw.excludedRoots)
      ? raw.excludedRoots.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [],
    scanIntervalMinutes: Number.isFinite(interval)
      ? Math.max(MIN_SCAN_INTERVAL_MINUTES, Math.floor(interval))
      : base.scanIntervalMinutes,
    runHealthChecks: raw.runHealthChecks !== false,
  };
}

export interface ScanOutcome {
  scanRun: ScanRun;
  repositories: number;
  /** Configured roots that were not scanned because they are inside DexNest's data. */
  refusedRoots: string[];
  standupReportId?: string;
}

export interface DevIntelligenceStatus {
  enabled: boolean;
  scanning: boolean;
  lastScan?: ScanOutcome & { trigger: JobOccurrence['trigger'] };
  lastError?: string;
  repositories: number;
}

export interface DevIntelligenceModuleOptions {
  database: SqlDatabase;
  events: EventLog;
  boundary: DataBoundary;
  scheduler: ModuleScheduler;
  settings: ModuleSettings<DevIntelligenceSettings>;
  domains?: DomainRegistry;
  runner?: ProcessRunnerPort;
  availabilityProbe?: DomainAvailabilityProbe;
  timezone?: string;
  clock?: StandupClock;
  /**
   * Repositories the host keeps a list of - DexNest's Projects. They are
   * scanned without being configured here, under the names given there, so
   * there is one list of projects and one name for each. Read at every scan.
   */
  linkedRepositories?(): LinkedRepository[];
  /** A line in DexNest's audit log. Meaningful actions go there as well as to the dev stream. */
  audit?(summary: string, metadata: Record<string, unknown>, status: 'success' | 'failure'): void;
}

export interface DevIntelligenceModule {
  readonly persistence: DevIntelligencePersistence;
  /** Recovers interrupted scans and schedules the scan job. */
  start(): Promise<void>;
  stop(): void;
  status(): Promise<DevIntelligenceStatus>;
  getSettings(): DevIntelligenceSettings;
  /** Saves settings and reschedules; refuses roots inside DexNest's data. */
  updateSettings(next: unknown): DevIntelligenceSettings;
  /** A scan the user asked for. Joins one already running. */
  scanNow(): Promise<ScanOutcome | undefined>;
  generateStandup(options?: { forceNew?: boolean }): Promise<StandupReport>;
  latestStandup(): Promise<StandupReport | null>;
  listStandups(limit?: number): Promise<readonly StandupReport[]>;
  listRepositories(): Promise<Repository[]>;
}

export function createDevIntelligenceModule(options: DevIntelligenceModuleOptions): DevIntelligenceModule {
  const persistence = createDevIntelligencePersistence({ database: options.database, events: options.events });
  const domains = options.domains ?? createDomainRegistry();
  const availabilityProbe = options.availabilityProbe ?? createGitAvailabilityProbe(options.runner);
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const standup = createStandupService({
    persistence,
    standupStore: persistence.standup,
    ...(options.clock ? { clock: options.clock } : {}),
    timezone,
  });

  /**
   * A new report because the user asked for one. If today already has a
   * report, the new one starts where that one started, so it shows the whole
   * day so far rather than only what happened since the last time they asked.
   */
  async function refreshStandup(): Promise<StandupReport> {
    const now = options.clock?.now() ?? new Date();
    const latest = await persistence.standup.getLatestSuccessfulReport();
    const today = latest !== null && latest !== undefined && localDateString(new Date(latest.generatedAt), timezone) === localDateString(now, timezone);
    return standup.generateStandup({
      triggerKind: 'manual',
      forceNewOccurrence: true,
      ...(today && latest.timeWindow.from < now.toISOString()
        ? { window: { kind: 'custom', from: latest.timeWindow.from, to: now.toISOString(), timezone } }
        : {}),
    });
  }

  /**
   * The repositories being followed now: those the last finished scan looked
   * for. One recorded earlier and since dropped - its project archived, its
   * folder no longer watched - keeps its history in the store but is not listed.
   */
  async function currentRepositories(): Promise<Repository[]> {
    const all = await persistence.repositories.listRepositories();
    const current = currentRepositoryIds(await persistence.scanRuns.listRecent(20));
    return current ? all.filter((repo) => current.has(repo.id)) : all;
  }

  let unschedule: (() => void) | undefined;
  let scanning = false;
  let lastScan: DevIntelligenceStatus['lastScan'];
  let lastError: string | undefined;
  let lastScanPromise: Promise<void> | undefined;

  const isSensitive = (path: string) => options.boundary.isSensitive(path);

  function partitionRoots(roots: DevIntelligenceRoot[]): { allowed: DevIntelligenceRoot[]; refused: string[] } {
    const allowed: DevIntelligenceRoot[] = [];
    const refused: string[] = [];
    for (const root of roots) {
      // WSL paths name another filesystem; the boundary judges Windows paths.
      if (root.domain === 'windows' && isSensitive(root.path)) refused.push(root.path);
      else allowed.push(root);
    }
    return { allowed, refused };
  }

  function discoveryFor(settings: DevIntelligenceSettings): { discovery: DiscoveryConfig; refused: string[] } {
    const roots = partitionRoots(settings.roots);
    const manual = partitionRoots(settings.manualRepositories);
    // A project inside DexNest's data is left out like any other folder there;
    // it is not reported as refused, because nobody asked for it to be scanned.
    const linked = (options.linkedRepositories?.() ?? []).filter((repo) => repo.domain !== 'windows' || !isSensitive(repo.path));
    return {
      discovery: defaultDiscoveryConfig({
        roots: roots.allowed,
        manualRepositories: [...linked, ...manual.allowed],
        // The data root is excluded from discovery as well, so a root that
        // contains it - DexNest's own checkout, say - walks around it.
        excludedRoots: [...settings.excludedRoots, ...options.boundary.sensitiveRoots],
      }),
      refused: [...roots.refused, ...manual.refused],
    };
  }

  async function scan(occurrence: JobOccurrence): Promise<void> {
    const settings = options.settings.read();
    // The timer only runs while enabled, but a slot can land during a toggle.
    if (!settings.enabled && occurrence.trigger !== 'manual') return;

    const { discovery, refused } = discoveryFor(settings);
    scanning = true;
    try {
      const orchestrator = new ScanOrchestrator({
        persistence,
        domains,
        discovery,
        ...(options.runner ? { runner: options.runner } : {}),
        availabilityProbe,
        runHealth: settings.runHealthChecks,
        sourceIdentity: `dexnest:${occurrence.occurrenceId}`,
        isSensitive,
      });
      await orchestrator.recoverInterruptedScans();
      const result: ScanResult = await orchestrator.runScan();

      let standupReportId: string | undefined;
      if (result.scanRun.state !== 'FAILED' && result.scanRun.state !== 'CANCELLED') {
        // On the timer: one report per local day, however many scans run.
        // Asked for: a fresh report over the same day, so the scan shows.
        const report =
          occurrence.trigger === 'manual' ? await refreshStandup() : await standup.generateStandup({ triggerKind: 'scheduled' });
        standupReportId = report.id;
      }

      lastScan = {
        scanRun: result.scanRun,
        repositories: result.repositories.length,
        refusedRoots: refused,
        ...(standupReportId ? { standupReportId } : {}),
        trigger: occurrence.trigger,
      };
      lastError = undefined;
      const ok = result.scanRun.state === 'COMPLETED' || result.scanRun.state === 'PARTIAL';
      options.audit?.(
        `Repository scan ${result.scanRun.state.toLowerCase()}: ${result.scanRun.repositoriesSucceeded} of ${result.scanRun.repositoriesAttempted} repositories`,
        {
          scanRunId: result.scanRun.id,
          state: result.scanRun.state,
          trigger: occurrence.trigger,
          repositoriesFailed: result.scanRun.repositoriesFailed,
          refusedRoots: refused.length,
          standupReportId: standupReportId ?? null,
        },
        ok ? 'success' : 'failure',
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      options.audit?.(`Repository scan failed: ${lastError}`, { trigger: occurrence.trigger }, 'failure');
      throw error;
    } finally {
      scanning = false;
    }
  }

  function reschedule(): void {
    unschedule?.();
    unschedule = undefined;
    const settings = options.settings.read();
    if (!settings.enabled) return;
    unschedule = options.scheduler.schedule({
      id: DEV_SCAN_JOB,
      intervalMs: settings.scanIntervalMinutes * 60_000,
      runAtStartup: true,
      heavy: true,
      run: (occurrence) => {
        const run = scan(occurrence);
        lastScanPromise = run.catch(() => undefined);
        return run;
      },
    });
  }

  return {
    persistence,

    async start() {
      // A scan killed mid-run leaves a STARTED row; close it out before anything reads it.
      await new ScanOrchestrator({ persistence, domains, discovery: defaultDiscoveryConfig() }).recoverInterruptedScans();
      reschedule();
    },

    stop() {
      unschedule?.();
      unschedule = undefined;
    },

    async status() {
      return {
        enabled: options.settings.read().enabled,
        scanning,
        ...(lastScan ? { lastScan } : {}),
        ...(lastError ? { lastError } : {}),
        repositories: (await currentRepositories()).length,
      };
    },

    getSettings() {
      return options.settings.read();
    },

    updateSettings(next) {
      const settings = normalizeDevIntelligenceSettings(next);
      const refused = [
        ...partitionRoots(settings.roots).refused,
        ...partitionRoots(settings.manualRepositories).refused,
      ];
      if (refused.length > 0) {
        throw new Error(`These folders are inside DexNest's private data and cannot be scanned: ${refused.join(', ')}`);
      }
      options.settings.write(settings);
      reschedule();
      return settings;
    },

    async scanNow() {
      if (unschedule) {
        // Through the scheduler, so it joins a scheduled scan already running.
        await options.scheduler.runNow(DEV_SCAN_JOB);
        await lastScanPromise;
      } else {
        const at = new Date().toISOString();
        await scan({ occurrenceId: `${DEV_SCAN_JOB}:manual:${randomUUID()}`, scheduledAt: at, trigger: 'manual' });
      }
      if (lastError) throw new Error(lastError);
      return lastScan;
    },

    async generateStandup() {
      const report = await refreshStandup();
      options.audit?.('Standup generated', { reportId: report.id, occurrenceId: report.occurrenceId }, 'success');
      return report;
    },

    latestStandup() {
      return persistence.standup.getLatestSuccessfulReport();
    },

    async listStandups(limit = 20) {
      return (await standup.listStandupReports({ limit })).reports;
    },

    listRepositories() {
      return currentRepositories();
    },
  };
}
