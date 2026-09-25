/**
 * @dexnest/dev-intelligence
 * Phase 3 DI enrichment: TODO/tech/health/incremental/retention + Phase 2 kernel.
 */

export const PACKAGE_NAME = '@dexnest/dev-intelligence' as const;
export const PACKAGE_PHASE = 3 as const;

// Domain / process
export {
  LocalProcessRunner,
  MutableCancelHandle,
} from './domain/local-process-runner.js';
export {
  DefaultPathTranslation,
  canonicalPath,
} from './domain/path-translation.js';
export {
  createDomainRegistry,
  createWindowsDomain,
  createWslDomain,
  WslBridgeProcessRunner,
  type DomainRegistry,
} from './domain/execution-domains.js';
export {
  createGitAvailabilityProbe,
  createForcedUnavailableProbe,
  availabilityFailureMessage,
  type DomainAvailability,
  type DomainAvailabilityProbe,
  type DomainDegradeReason,
} from './domain/availability.js';

// Discovery
export {
  defaultDiscoveryConfig,
  type DiscoveryConfig,
} from './config/roots.js';
export {
  discoverRepositories,
  type DiscoveryResult,
  type DiscoveredRepo,
  type DiscoveryFailure,
} from './discovery/discover.js';
export {
  isExcludedDirName,
  isExcludedPath,
  EXCLUDED_DIR_NAMES,
} from './discovery/exclusions.js';
export {
  stableRepositoryId,
  displayNameFromPath,
} from './discovery/identity.js';

// Git (read-only)
export {
  assertReadOnlyGitArgv,
  isForbiddenGitVerb,
  FORBIDDEN_GIT_VERBS,
} from './git/forbidden.js';
export {
  inspectGitState,
  parsePorcelainV2,
  parseCommitLog,
  listRemotes,
  revParse,
  detectInterruptedOperation,
  getAheadBehind,
  type GitInspectOptions,
} from './git/readonly-git.js';
export {
  buildRepositorySnapshot,
  contentFingerprintFromGit,
  type SnapshotBuildResult,
} from './git/snapshot.js';

// Events
export {
  emitRepoDiscovered,
  emitRepoSnapshot,
  emitCommitObserved,
  emitBranchChangedIfNeeded,
  emitWorkingTreeChangedIfNeeded,
  emitConflictIfNeeded,
  emitGitOperationIfNeeded,
  emitTodoObserved,
  emitTodoResolved,
  emitTechnologyObserved,
  emitTechnologyRemoved,
  emitHealthCompleted,
  type EmitContext,
} from './events/emit.js';

// TODO / tech / health / retention
export {
  scanTodos,
  extractMarkersFromText,
  isSecretLikePath,
  observationToMarker,
  type ObservedTodo,
  type TodoScanOptions,
} from './todo/scan.js';
export {
  reconcileTodos,
  type ReconcileTodosResult,
} from './todo/lifecycle.js';
export {
  detectTechnologies,
  observationToFact,
  type RawTechObservation,
} from './tech/detect.js';
export {
  reconcileTechnologies,
  type ReconcileTechResult,
} from './tech/lifecycle.js';
export {
  runConfiguredHealthCheck,
  runEnabledHealthChecks,
} from './health/runner.js';
export {
  evaluateHealthArgv,
  assertHealthArgvAllowed,
  HealthArgvRejectedError,
  type ArgvPolicyResult,
  type ArgvRejectReason,
} from './health/argv-policy.js';
export {
  listDiscoveredScriptCandidates,
  assertNeverAutoRunDiscoveredScripts,
  type DiscoveredScriptCandidate,
} from './health/auto-discover.js';

// Scan
export { mapPool } from './scan/concurrency.js';
export {
  ScanOrchestrator,
  type ScanOrchestratorOptions,
  type ScanResult,
  type RepoScanMeta,
} from './scan/orchestrator.js';

// Public API
export {
  createDeveloperIntelligenceApi,
  type DeveloperIntelligenceApi,
} from './api/public-api.js';

/** @deprecated Phase 1 stub — kernel+enrichment implemented (Phase 3). */
export function repositoryIntelligenceStub(): {
  ready: true;
  phase: 3;
  package: typeof PACKAGE_NAME;
} {
  return { ready: true, phase: 3, package: PACKAGE_NAME };
}

// DexNest module runtime
export {
  createDevIntelligenceModule,
  defaultDevIntelligenceSettings,
  normalizeDevIntelligenceSettings,
  DEV_SCAN_JOB,
  MIN_SCAN_INTERVAL_MINUTES,
  type DevIntelligenceModule,
  type DevIntelligenceModuleOptions,
  type DevIntelligenceSettings,
  type DevIntelligenceStatus,
  type DevIntelligenceRoot,
  type ScanOutcome,
} from './module/runtime.js';
