/**
 * Scan lifecycle: STARTED | COMPLETED | PARTIAL | FAILED | CANCELLED
 * Bounded concurrency (~4), cancel, partial failure isolation, crash-recovery hooks.
 * Phase 3: incremental skip of heavy enrichment when fingerprint unchanged;
 * TODO/tech/configured-health enrichment; retention diagnostics hooks.
 */

import { randomUUID } from 'node:crypto';
import type {
  PersistencePorts,
  ProcessRunnerPort,
  Repository,
  RepositorySnapshot,
  ScanRun,
} from '@dexnest/dev-intelligence-contracts';
import { DEFAULT_RETENTION_POLICY } from '@dexnest/dev-intelligence-contracts';
import type { DiscoveryConfig } from '../config/roots.js';
import { discoverRepositories } from '../discovery/discover.js';
import { MutableCancelHandle } from '../domain/local-process-runner.js';
import type { DomainRegistry } from '../domain/execution-domains.js';
import { buildRepositorySnapshot } from '../git/snapshot.js';
import {
  emitBranchChangedIfNeeded,
  emitCommitObserved,
  emitConflictIfNeeded,
  emitGitOperationIfNeeded,
  emitHealthCompleted,
  emitRepoDiscovered,
  emitRepoSnapshot,
  emitTechnologyObserved,
  emitTechnologyRemoved,
  emitTodoObserved,
  emitTodoResolved,
  emitWorkingTreeChangedIfNeeded,
  type EmitContext,
} from '../events/emit.js';
import { mapPool } from './concurrency.js';
import { scanTodoCandidates } from '../todo/scan.js';
import { listCandidateFiles } from '../git/readonly-git.js';
import { reconcileTodos } from '../todo/lifecycle.js';
import { reconcileTechnologies } from '../tech/lifecycle.js';
import { runEnabledHealthChecks } from '../health/runner.js';
import { listDiscoveredScriptCandidates } from '../health/auto-discover.js';
import type { DomainAvailabilityProbe } from '../domain/availability.js';
import { availabilityFailureMessage } from '../domain/availability.js';

export interface ScanOrchestratorOptions {
  persistence: PersistencePorts;
  domains: DomainRegistry;
  discovery: DiscoveryConfig;
  /** Default 4. */
  concurrency?: number;
  /** Process runner override (else domain runner). */
  runner?: ProcessRunnerPort;
  sourceIdentity?: string;
  /** When true (default), skip TODO/tech heavy work if fingerprint unchanged. */
  incremental?: boolean;
  /** Run enabled configured health checks during scan (default true). */
  runHealth?: boolean;
  /**
   * Optional domain availability probe (EC-040/051).
   * When a domain is unavailable, repos on that domain fail in isolation.
   */
  availabilityProbe?: DomainAvailabilityProbe;
  /**
   * The host's data boundary. Files it marks sensitive are never read, and
   * repositories inside it are never scanned. DexNest passes its own; without
   * one, the TODO scan still reads only what Git lists.
   */
  isSensitive?: (absolutePath: string) => boolean;
}

export interface RepoScanMeta {
  repositoryId: string;
  skippedHeavy: boolean;
  todosTouched: number;
  techObserved: number;
  techRemoved: number;
  healthRuns: number;
}

export interface ScanResult {
  scanRun: ScanRun;
  snapshots: RepositorySnapshot[];
  repositories: Repository[];
  meta: RepoScanMeta[];
}

export class ScanOrchestrator {
  private readonly persistence: PersistencePorts;
  private readonly domains: DomainRegistry;
  private readonly discovery: DiscoveryConfig;
  private readonly concurrency: number;
  private readonly runnerOverride?: ProcessRunnerPort;
  private readonly sourceIdentity: string;
  private readonly incremental: boolean;
  private readonly runHealth: boolean;
  private readonly availabilityProbe?: DomainAvailabilityProbe;
  private readonly isSensitive?: (absolutePath: string) => boolean;
  private activeCancel?: MutableCancelHandle;
  private readonly availabilityCache = new Map<
    string,
    Awaited<ReturnType<DomainAvailabilityProbe>>
  >();

  constructor(options: ScanOrchestratorOptions) {
    this.persistence = options.persistence;
    this.domains = options.domains;
    this.discovery = options.discovery;
    this.concurrency = options.concurrency ?? 4;
    this.runnerOverride = options.runner;
    this.sourceIdentity =
      options.sourceIdentity ?? `scan_${randomUUID().slice(0, 8)}`;
    this.incremental = options.incremental !== false;
    this.runHealth = options.runHealth !== false;
    this.availabilityProbe = options.availabilityProbe;
    this.isSensitive = options.isSensitive;
  }

  requestCancel(): void {
    this.activeCancel?.cancel();
  }

  /**
   * Mark any leftover STARTED runs as FAILED (crash recovery hook).
   * Call on process start before beginning new scans.
   */
  async recoverInterruptedScans(): Promise<ScanRun[]> {
    const incomplete = await this.persistence.scanRuns.listIncomplete();
    const recovered: ScanRun[] = [];
    for (const run of incomplete) {
      const updated: ScanRun = {
        ...run,
        state: 'FAILED',
        finishedAt: new Date().toISOString(),
        errorSummary:
          (run.errorSummary ? run.errorSummary + '; ' : '') +
          'recovered after interrupted STARTED (crash recovery)',
      };
      await this.persistence.scanRuns.update(updated);
      recovered.push(updated);
    }
    return recovered;
  }

  async runScan(): Promise<ScanResult> {
    const cancel = new MutableCancelHandle();
    this.activeCancel = cancel;
    this.availabilityCache.clear();

    const scanId = `scan_${randomUUID().replace(/-/g, '')}`;
    const startedAt = new Date().toISOString();
    let run: ScanRun = {
      schemaVersion: 1,
      id: scanId,
      state: 'STARTED',
      startedAt,
      repositoriesAttempted: 0,
      repositoriesSucceeded: 0,
      repositoriesFailed: 0,
      cancelRequested: false,
      checkpoint: JSON.stringify({ phase: 'discovery' }),
    };
    await this.persistence.scanRuns.create(run);

    const emitCtx: EmitContext = {
      events: this.persistence.events,
      sourceIdentity: this.sourceIdentity,
    };

    const snapshots: RepositorySnapshot[] = [];
    const repositories: Repository[] = [];
    const meta: RepoScanMeta[] = [];
    const errorParts: string[] = [];

    try {
      const discovery = await discoverRepositories(this.discovery, cancel, {
        isSensitive: this.isSensitive,
      });

      if (cancel.aborted || discovery.cancelled) {
        run = {
          ...run,
          state: 'CANCELLED',
          finishedAt: new Date().toISOString(),
          cancelRequested: true,
          errorSummary: 'cancelled during discovery',
          checkpoint: JSON.stringify({ phase: 'cancelled_discovery' }),
        };
        await this.persistence.scanRuns.update(run);
        return { scanRun: run, snapshots, repositories, meta };
      }

      for (const f of discovery.failures) {
        errorParts.push(`discover:${f.path}:${f.error}`);
      }

      const targets = discovery.found.map((d) => d.repository);
      run = {
        ...run,
        targetRepositoryIds: targets.map((t) => t.id),
        checkpoint: JSON.stringify({
          phase: 'inspect',
          repoIds: targets.map((t) => t.id),
        }),
      };
      await this.persistence.scanRuns.update(run);

      type RepoOutcome =
        | {
            ok: true;
            repo: Repository;
            snapshot: RepositorySnapshot;
            meta: RepoScanMeta;
          }
        | { ok: false; repo?: Repository; error: string; path: string };

      const outcomes = await mapPool(
        discovery.found,
        this.concurrency,
        async (item): Promise<RepoOutcome> => {
          if (cancel.aborted) {
            return {
              ok: false,
              error: 'cancelled',
              path: item.root.path,
              repo: item.repository,
            };
          }
          try {
            if (this.availabilityProbe) {
              const key = item.root.domain;
              let avail = this.availabilityCache.get(key);
              if (!avail) {
                avail = await this.availabilityProbe(item.root.domain);
                this.availabilityCache.set(key, avail);
              }
              if (!avail.available) {
                return {
                  ok: false,
                  repo: item.repository,
                  path: item.root.path,
                  error: availabilityFailureMessage(avail),
                };
              }
            }

            const domainPort = this.domains.get(item.root.domain);
            const runner = this.runnerOverride ?? domainPort.processRunner;

            const now = new Date().toISOString();
            const repo: Repository = {
              ...item.repository,
              lastSeenAt: now,
            };

            const existing = await this.persistence.repositories.getRepository(
              repo.id,
            );
            if (!existing) {
              await this.persistence.repositories.upsertRepository(repo);
              await emitRepoDiscovered(emitCtx, repo.id, {
                rootPath: item.root.path,
                domain: item.root.domain,
                displayName: repo.displayName,
              });
            } else {
              await this.persistence.repositories.upsertRepository({
                ...existing,
                lastSeenAt: now,
                roots: repo.roots,
                displayName: repo.displayName ?? existing.displayName,
              });
            }

            const previousSnap =
              await this.persistence.repositories.getLatestSnapshot(repo.id);

            const { snapshot } = await buildRepositorySnapshot(
              repo.id,
              item.root,
              {
                cwd: item.root.path,
                domain: item.root.domain,
                runner,
                cancel,
              },
            );

            await this.persistence.repositories.saveSnapshot(snapshot);

            await emitRepoSnapshot(emitCtx, snapshot);

            for (const commit of snapshot.git.recentCommits) {
              await emitCommitObserved(
                emitCtx,
                repo.id,
                commit,
                snapshot.git.currentBranch,
              );
            }

            await emitBranchChangedIfNeeded(
              emitCtx,
              repo.id,
              previousSnap?.git,
              snapshot.git,
            );
            await emitWorkingTreeChangedIfNeeded(
              emitCtx,
              repo.id,
              previousSnap?.git,
              snapshot.git,
            );
            await emitConflictIfNeeded(emitCtx, repo.id, snapshot.git);
            await emitGitOperationIfNeeded(
              emitCtx,
              repo.id,
              previousSnap?.git,
              snapshot.git,
            );

            const fingerprintUnchanged =
              !!previousSnap?.contentFingerprint &&
              previousSnap.contentFingerprint === snapshot.contentFingerprint;

            const skippedHeavy =
              this.incremental && fingerprintUnchanged && !!previousSnap;

            let todosTouched = 0;
            let techObserved = 0;
            let techRemoved = 0;
            let healthRuns = 0;

            if (!skippedHeavy && !cancel.aborted) {
              // TODO lifecycle
              const todoScan = await scanTodoCandidates({
                repositoryId: repo.id,
                rootPath: item.root.path,
                listFiles: () =>
                  listCandidateFiles({
                    cwd: item.root.path,
                    domain: item.root.domain,
                    runner,
                    cancel,
                  }),
                isSensitive: this.isSensitive,
              });
              const todoResult = await reconcileTodos({
                repositoryId: repo.id,
                observed: todoScan.todos,
                store: this.persistence.todos,
                now,
                complete: todoScan.complete,
              });
              for (const r of todoResult.results) {
                if (r.action === 'resolved') {
                  await emitTodoResolved(emitCtx, r.marker);
                } else if (r.action === 'created') {
                  await emitTodoObserved(emitCtx, r.marker, r.action);
                } else if (r.action === 'moved' || r.action === 'renamed') {
                  await emitTodoObserved(emitCtx, r.marker, r.action);
                }
                todosTouched += 1;
              }

              // Technology facts
              // From the TODO scan's vetted list: no second walk of the tree.
              const tech = await reconcileTechnologies({
                repositoryId: repo.id,
                rootPath: item.root.path,
                files: todoScan.safeFiles,
                complete: todoScan.complete,
                store: this.persistence.technologies,
                now,
              });
              for (const f of tech.observed) {
                await emitTechnologyObserved(emitCtx, f);
                techObserved += 1;
              }
              for (const f of tech.removed) {
                await emitTechnologyRemoved(emitCtx, f);
                techRemoved += 1;
              }

              // Discovered scripts are listed for diagnostics ONLY — never executed.
              const candidates = await listDiscoveredScriptCandidates(
                item.root.path,
              );
              if (candidates.length > 0) {
                await this.persistence.retention.saveDiagnostic({
                  schemaVersion: 1,
                  id: `diag_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
                  scanRunId: scanId,
                  repositoryId: repo.id,
                  kind: 'discovered_scripts_not_executed',
                  message: `Found ${candidates.length} script candidate(s); not executed (configured health only).`,
                  createdAt: now,
                });
              }
            }

            // Configured health: only enabled HealthCheck rows; never auto-run scripts.
            if (this.runHealth && !cancel.aborted) {
              const policy =
                (await this.persistence.retention.getPolicy()) ??
                DEFAULT_RETENTION_POLICY;
              const runs = await runEnabledHealthChecks({
                repositoryId: repo.id,
                store: this.persistence.health,
                runner,
                cancel,
                retention: policy,
              });
              for (const hr of runs) {
                await emitHealthCompleted(emitCtx, hr);
                healthRuns += 1;
              }
            }

            return {
              ok: true,
              repo,
              snapshot,
              meta: {
                repositoryId: repo.id,
                skippedHeavy,
                todosTouched,
                techObserved,
                techRemoved,
                healthRuns,
              },
            };
          } catch (err) {
            return {
              ok: false,
              repo: item.repository,
              path: item.root.path,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
        () => cancel.aborted,
      );

      let succeeded = 0;
      let failed = 0;
      for (const o of outcomes) {
        if (!o) continue;
        if (o.ok) {
          succeeded += 1;
          repositories.push(o.repo);
          snapshots.push(o.snapshot);
          meta.push(o.meta);
        } else {
          failed += 1;
          errorParts.push(`inspect:${o.path}:${o.error}`);
        }
      }

      const attempted = succeeded + failed;
      let state: ScanRun['state'];
      if (cancel.aborted) {
        state = 'CANCELLED';
      } else if (attempted === 0 && errorParts.length > 0) {
        state = 'FAILED';
      } else if (failed > 0 && succeeded > 0) {
        state = 'PARTIAL';
      } else if (failed > 0 && succeeded === 0) {
        state = 'FAILED';
      } else {
        state = 'COMPLETED';
      }

      if (
        state === 'COMPLETED' &&
        discovery.failures.length > 0 &&
        succeeded > 0
      ) {
        state = 'PARTIAL';
      }

      // Retention foundations: apply policy hooks after scan
      try {
        await this.persistence.retention.applyRetention();
      } catch {
        /* non-fatal */
      }

      run = {
        ...run,
        state,
        finishedAt: new Date().toISOString(),
        repositoriesAttempted: attempted,
        repositoriesSucceeded: succeeded,
        repositoriesFailed: failed,
        cancelRequested: cancel.aborted,
        errorSummary: errorParts.length
          ? errorParts.slice(0, 20).join(' | ')
          : undefined,
        checkpoint: JSON.stringify({ phase: 'done', state }),
      };
      await this.persistence.scanRuns.update(run);
      return { scanRun: run, snapshots, repositories, meta };
    } catch (err) {
      run = {
        ...run,
        state: 'FAILED',
        finishedAt: new Date().toISOString(),
        errorSummary: err instanceof Error ? err.message : String(err),
        checkpoint: JSON.stringify({ phase: 'failed' }),
      };
      await this.persistence.scanRuns.update(run);
      return { scanRun: run, snapshots, repositories, meta };
    } finally {
      this.activeCancel = undefined;
    }
  }
}
