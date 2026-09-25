/**
 * Public Developer Intelligence API surface for consumers (Standup via contracts).
 * Persistence stays behind PersistencePorts — no raw SQL.
 */

import type {
  HealthCheck,
  PersistencePorts,
  ProcessRunnerPort,
  TodoMarker,
  TechnologyFact,
  HealthRun,
  Repository,
  RepositorySnapshot,
  ScanRun,
} from '@dexnest/dev-intelligence-contracts';
import type { DiscoveryConfig } from '../config/roots.js';
import type { DomainRegistry } from '../domain/execution-domains.js';
import {
  ScanOrchestrator,
  type ScanOrchestratorOptions,
  type ScanResult,
} from '../scan/orchestrator.js';
import { runConfiguredHealthCheck } from '../health/runner.js';
import { listDiscoveredScriptCandidates } from '../health/auto-discover.js';

export interface DeveloperIntelligenceApi {
  recoverInterruptedScans(): Promise<ScanRun[]>;
  runScan(options?: Partial<ScanOrchestratorOptions>): Promise<ScanResult>;
  requestCancel(): void;
  listRepositories(): Promise<Repository[]>;
  getLatestSnapshot(
    repositoryId: string,
  ): Promise<RepositorySnapshot | undefined>;
  listTodos(
    repositoryId: string,
    options?: { status?: string },
  ): Promise<TodoMarker[]>;
  listTechnologies(
    repositoryId: string,
    options?: { status?: string },
  ): Promise<TechnologyFact[]>;
  upsertHealthCheck(check: HealthCheck): Promise<void>;
  listHealthChecks(repositoryId: string): Promise<HealthCheck[]>;
  runHealthCheck(
    check: HealthCheck,
    runner: ProcessRunnerPort,
  ): Promise<HealthRun>;
  /** Candidates only — never executed. */
  listScriptCandidates(rootPath: string): Promise<
    Array<{ name: string; source: string; suggestedArgv: string[] }>
  >;
  applyRetention(): Promise<{
    healthRunsDeleted: number;
    diagnosticsDeleted: number;
    healthOutputsTrimmed: number;
  }>;
}

export function createDeveloperIntelligenceApi(options: {
  persistence: PersistencePorts;
  domains: DomainRegistry;
  discovery: DiscoveryConfig;
  runner?: ProcessRunnerPort;
  concurrency?: number;
}): DeveloperIntelligenceApi {
  let orch = new ScanOrchestrator({
    persistence: options.persistence,
    domains: options.domains,
    discovery: options.discovery,
    runner: options.runner,
    concurrency: options.concurrency,
  });

  return {
    recoverInterruptedScans: () => orch.recoverInterruptedScans(),
    async runScan(overrides) {
      orch = new ScanOrchestrator({
        persistence: options.persistence,
        domains: options.domains,
        discovery: options.discovery,
        runner: options.runner,
        concurrency: options.concurrency,
        ...overrides,
      });
      return orch.runScan();
    },
    requestCancel: () => orch.requestCancel(),
    listRepositories: () => options.persistence.repositories.listRepositories(),
    getLatestSnapshot: (id) =>
      options.persistence.repositories.getLatestSnapshot(id),
    listTodos: (id, o) => options.persistence.todos.listByRepository(id, o),
    listTechnologies: (id, o) =>
      options.persistence.technologies.listByRepository(id, o),
    upsertHealthCheck: (c) => options.persistence.health.upsertCheck(c),
    listHealthChecks: (id) => options.persistence.health.listChecks(id),
    runHealthCheck: (check, runner) =>
      runConfiguredHealthCheck({ check, runner }),
    listScriptCandidates: async (rootPath) =>
      (await listDiscoveredScriptCandidates(rootPath)).map((c) => ({
        name: c.name,
        source: c.source,
        suggestedArgv: c.suggestedArgv,
      })),
    applyRetention: () => options.persistence.retention.applyRetention(),
  };
}
