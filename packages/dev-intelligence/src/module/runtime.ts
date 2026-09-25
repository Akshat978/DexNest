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
 *     day's scheduled Standup; every later trigger for the same day resolves to
 *     the same report, because the engine keys scheduled reports by occurrence.
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
import { createStandupService, type StandupClock } from '@dexnest/standup';
import { defaultDiscoveryConfig, type DiscoveryConfig } from '../config/roots.js';
import { createDomainRegistry, type DomainRegistry } from '../domain/execution-domains.js';
import { createGitAvailabilityProbe, type DomainAvailabilityProbe } from '../domain/availability.js';
import { ScanOrchestrator, type ScanResult } from '../scan/orchestrator.js';

export const DEV_SCAN_JOB = 'scan';

export interface DevIntelligenceRoot {
  path: string;
  domain: RepositoryExecutionDomain;
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
  const standup = createStandupService({
    persistence,
    standupStore: persistence.standup,
    ...(options.clock ? { clock: options.clock } : {}),
    timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

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
    return {
      discovery: defaultDiscoveryConfig({
        roots: roots.allowed,
        manualRepositories: manual.allowed,
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
        // Scheduled: one report per local day, however many scans run.
        const report = await standup.generateStandup({ triggerKind: 'scheduled' });
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
        `Developer scan ${result.scanRun.state.toLowerCase()}: ${result.scanRun.repositoriesSucceeded} of ${result.scanRun.repositoriesAttempted} repositories`,
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
      options.audit?.(`Developer scan failed: ${lastError}`, { trigger: occurrence.trigger }, 'failure');
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
        repositories: (await persistence.repositories.listRepositories()).length,
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

    async generateStandup(generateOptions) {
      const report = await standup.generateStandup({
        triggerKind: 'manual',
        ...(generateOptions?.forceNew ? { forceNewOccurrence: true } : {}),
      });
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
      return persistence.repositories.listRepositories();
    },
  };
}
