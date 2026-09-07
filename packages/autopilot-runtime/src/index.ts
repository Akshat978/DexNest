// @dexnest/autopilot-runtime
//
// Electron-free Autopilot domain runtime. See docs/AUTOPILOT_ARCHITECTURE.md.
//
// HARD RULE: this package must never import Electron, and must never reach the
// clock, filesystem, process table or database directly. Everything arrives
// through the ports in ./ports.ts. That is what keeps a later extraction into a
// dedicated process mechanical.

export type {
  Clock,
  IdGenerator,
  LogLevel,
  Logger,
  RuntimePorts,
  SqlDatabase,
  SqlStatement,
  StepExecutionContext,
  StepExecutionResult,
  StepExecutor,
  StepProbeResult
} from "./ports.ts";

export {
  RUN_STATES,
  RUN_EVENT_TYPES,
  STEP_STATUSES,
  TERMINAL_STATES,
  SETTLED_STEP_STATUSES,
  REVIEW_STATE,
  IllegalTransitionError,
  assertTransition,
  canTransition,
  isSettled,
  isTerminal,
  legalTargets
} from "./states.ts";
export type { RunEventType, RunState, StepStatus } from "./states.ts";

export {
  RUN_SPEC_SCHEMA_VERSION,
  AUTHORITATIVE_FIELDS,
  RunSpecValidationError,
  authoritativeFingerprint,
  createRunSpec,
  defaultCapabilityPolicy,
  parsePlanText,
  MAX_PLAN_ITEMS,
  MAX_PLAN_ITEM_DETAIL_CHARS
} from "./runSpec.ts";
export type {
  AcceptanceCriterion,
  AcceptanceCriterionKind,
  CapabilityPolicy,
  CompletionPolicy,
  EscalationPolicy,
  FailurePolicy,
  PlanItem,
  RunSpec,
  WorkspaceMode,
  WorkerProfile,
  RunSpecInput,
  SupervisorPreference,
  VerificationConfig,
  WorkerPreference
} from "./runSpec.ts";

export { AUTOPILOT_MIGRATIONS, runAutopilotMigrations } from "./migrations.ts";

export { PlanStore, PlanItemError, renderPlanProgress, renderPlanForWorker } from "./plan.ts";
export { renderRunDigest, MAX_DIGEST_ITERATIONS, MAX_DIGEST_ASSUMPTIONS } from "./digest.ts";
export { OperatorNoteStore, renderOperatorNote, MAX_OPERATOR_NOTE_CHARS } from "./operatorNote.ts";
export { RunQueueStore, QUEUE_OUTCOME } from "./runQueue.ts";
export { AttentionStore, ATTENTION_REASON, DEFAULT_QUIET_HOURS, toLocalIso } from "./attention.ts";
export { DeviceStore } from "./devices.ts";
export type { DeviceRecord, DeviceCapability } from "./devices.ts";
export type { AttentionItem, Decision, GroupDigest, Priority, QuietHours, DeliveryRecord } from "@dexnest/attention";
export { buildUsageReport, renderUsageReport } from "./usage.ts";
export type { UsageReport, TurnCost, PhaseCost } from "./usage.ts";
export type { RunQueueRecord, RunQueueItemRecord, QueueItemInput, RunTemplate } from "./runQueue.ts";
export type { QueueProgress, QueueStatus, QueueAction, QueueBudget, QueueStopReason } from "@dexnest/run-queue";
export type { OperatorNoteRecord } from "./operatorNote.ts";
export type { PlanItemProgress, PlanItemStatus, PlanView, OrphanedProgress } from "./plan.ts";

export { ProjectBranchManager, ProjectBranchError, branchNameForRun, renderProjectBranchSummary } from "./projectBranch.ts";
export type { ProjectBranchRecord } from "./projectBranch.ts";

export { SessionDiscovery, describeSession, SESSION_LIVE_WINDOW_MS } from "./sessionDiscovery.ts";
export type { DiscoveredSession, SessionOrigin } from "./sessionDiscovery.ts";
export {
  DirectionStore, parseDirection, directionProtocolInstructions, directedPrompt, renderDirections,
  MAX_ASSIGNMENT_CHARS
} from "./direction.ts";
export { DirectionAuthorityStore } from "./direction.ts";
export type { DirectionDecision, DirectionVerb, DirectionSource, DirectionAuthority, ParsedDirection } from "./direction.ts";
export { ChatDirector, ChatDirectorError, directorPrompt } from "./chatDirector.ts";
export {
  UnattendedStore, parseAssumptions, unattendedInstructions,
  RESUME_BACKOFF_MINUTES, MAX_ASSUMPTION_CHARS
} from "./unattended.ts";
export type { AssumptionRecord, ResumePlan } from "./unattended.ts";
export { buildMorningSummary, renderMorningSummary } from "./morningSummary.ts";
export { LiveActivity, ActivityStream, readActivityLine, MAX_ACTIVITY_EVENTS } from "./liveActivity.ts";
export type { ActivityEvent } from "./liveActivity.ts";
export type { MorningSummary, MorningAction } from "./morningSummary.ts";
export type { DirectorSession, ChatDirectorOptions } from "./chatDirector.ts";
export { IterationStore, renderIterationStatus, renderWhereToWatch } from "./iterations.ts";
export type { IterationRecord, IterationStatus } from "./iterations.ts";
export { SessionAttachStore, SessionAttachError, ATTACH_BLOCKER_REASONS, renderAttachedSession } from "./sessionAttach.ts";
export type { AttachedSessionRecord, AttachBlocker, SessionCandidate } from "./sessionAttach.ts";
export type { Migration, MigrationResult } from "./migrations.ts";

export { AutopilotStore } from "./store.ts";
export type { AppendEventInput, RunEventRecord, RunRecord, StepRecord } from "./store.ts";

export { AutopilotEngine } from "./engine.ts";
export type {
  EngineOptions,
  RecoverOptions,
  RecoveryOutcome,
  RunSnapshot,
  UncertainResolution
} from "./engine.ts";

export {
  MemorySideEffectLedger,
  ScriptedCrash,
  ScriptedExecutor
} from "./scriptedExecutor.ts";
export type { ScriptedBehaviour, ScriptedExecutorOptions, ScriptedStep, SideEffectLedger } from "./scriptedExecutor.ts";

// --- Phase 2: isolation, capability enforcement, approvals, dispatcher -----

export { canonicalize, contains, joinWithin, samePath } from "./paths.ts";
export type { CanonicalPath } from "./paths.ts";

export {
  canonicalizeExecutable,
  describeIntent,
  executableName,
  fingerprintIntent,
  normalizeIntent
} from "./intent.ts";
export type {
  CreateWorktreeIntent,
  GitOperationIntent,
  Intent,
  IntentKind,
  OperationIntent,
  ReadFileIntent,
  RemoveWorktreeIntent,
  RunCommandIntent,
  TerminateProcessIntent,
  WriteFileIntent
} from "./intent.ts";

export {
  ALWAYS_DENIED_DIRECTORIES,
  ALWAYS_DENIED_FRAGMENTS,
  ALWAYS_DENIED_ROOTS,
  BASELINE_APPROVAL_COMMANDS,
  BASELINE_DENIED_COMMANDS,
  DEFAULT_ENV_ALLOW,
  DEFAULT_ENV_STRIP_PATTERNS,
  buildEnvironment,
  defaultCapabilityPolicy as defaultEnforcedCapabilityPolicy,
  evaluateCommand,
  evaluateGitOperation,
  evaluateIntent,
  evaluatePathAccess
} from "./policy.ts";
export type {
  CapabilityPolicy as EnforcedCapabilityPolicy,
  CommandRule,
  PathAccessRequest,
  PolicyDecision,
  PolicyDecisionKind,
  RiskLevel
} from "./policy.ts";

export { Dispatcher, UnauthorizedDispatchError } from "./dispatcher.ts";
export type { DispatchResult, DispatcherOptions } from "./dispatcher.ts";

export { OperationStore, SETTLED_OPERATION_STATUSES } from "./operations.ts";
export type { ApprovalRecord, ApprovalStatus, OperationRecord, OperationStatus } from "./operations.ts";

export { EffectsGateway } from "./effects.ts";
export type { EffectOutcome, EffectsGatewayOptions } from "./effects.ts";

export { WorkspaceManager, WorkspaceError, worktreeNameForRun, validateRunWorkspace } from "./workspace.ts";
export type { RunWorkspace, WorkspaceManagerOptions } from "./workspace.ts";

export type {
  CommandOutcome,
  EnvironmentPort,
  FileSystemPort,
  GitPort,
  OwnedProcess,
  PlatformPorts,
  ProcessPort,
  WorktreeInfo
} from "./ports.ts";

export { HostileExecutor } from "./hostileExecutor.ts";
export type { HostileAttempt, HostileExecutorOptions } from "./hostileExecutor.ts";

export {
  DurableWorker, MEDIATED, mediatedCapabilities, agenticCapabilities, assertAgenticWorkspace, AgenticWorkspaceError,
  DEFAULT_AGENTIC_TOOLS, DEFAULT_AGENTIC_ALLOWED, DEFAULT_AGENTIC_DENIED, DEFAULT_AGENTIC_MAX_TURNS
} from "./worker.ts";
export type { WorkerCapabilities, WorkerCapabilityProfile, AgenticCapabilities, MediatedCapabilities } from "./worker.ts";
export type { WorkerAdapter, WorkerAvailability, WorkerFailure, WorkerOptions, WorkerProtocol, WorkerResult } from "./worker.ts";
export { WorkerStore } from "./workerStore.ts";
export type { WorkerSession, WorkerSend, WorkerSendStatus } from "./workerStore.ts";
export { ClaudeCodeWorker, claudeCodeProtocol, classifyClaudeFailure } from "./claudeCodeWorker.ts";
export { ControlledWorkerTurns } from "./controlledWorker.ts";
export { CodexWorker, codexProtocol, classifyCodexFailure } from "./codexWorker.ts";
export {
  evaluateRecovery, recordRecoveryDecision, recoveryActivityLabel,
  type RecoveryDecision, type RecoveryAction, type ProviderPreflight, type PreflightProbe
} from "./recovery.ts";
export {
  OwnershipStore, HandoffStore, HandoffBriefings, buildHandoffPackage, packageFingerprint,
  renderHandoffBriefing, currentRoles,
  type HandoffRecord, type HandoffPackage, type HandoffStatus, type HandoffSource,
  type HandoffBlocker, type HandoffScope, type OwnershipRecord
} from "./handoff.ts";
export {
  WorkerDiagnosticsStore, redactSecrets, boundedTail, classifyProviderFailure,
  secretEnvironmentValues, diagnosticActivityLabel,
  MAX_DIAGNOSTIC_TAIL_BYTES, DIAGNOSTIC_CATEGORY_LABELS,
  type WorkerDiagnostics, type DiagnosticCategory, type DiagnosticRole, type DiagnosticScope
} from "./diagnostics.ts";
export type { ControlledWorkerOptions } from "./controlledWorker.ts";
export type { WorkerResolution, WorkerResolutionDecision } from "./workerStore.ts";

// --- Autonomous loop (single sticky provider, bounded human grant) ---------

export { Verifier, initialPrompt, parseCommand, repairPrompt, VERIFICATION_TIER_ORDER } from "./verification.ts";
export type { VerificationOutcome, VerificationReport, VerificationTierResult, VerifierOptions } from "./verification.ts";

export { LoopStore } from "./loopStore.ts";
export type { LoopGrant, LoopGrantStatus, TurnKind, TurnRecord, TurnStatus, VerificationRecord } from "./loopStore.ts";

export { AutonomousLoop } from "./loop.ts";
export type { AutonomousLoopOptions, LoopOutcome, LoopStopReason } from "./loop.ts";

// --- Checkpoints and the run report ----------------------------------------

export { Checkpointer, CheckpointStore, checkpointMarker, checkpointMessage } from "./checkpoints.ts";
export type { CheckpointerOptions, CheckpointRecord, CheckpointStatus, WorkspaceSnapshot } from "./checkpoints.ts";

export { buildRunReport, renderRunReportMarkdown, RUN_REPORT_SCHEMA_VERSION } from "./report.ts";
export type { ReportTurn, ReportContextRequest, RunReport } from "./report.ts";

// --- Verification sanity and selective context -----------------------------

export {
  VERIFICATION_CONFIGURATION_ERROR,
  classifyTierFailure,
  failureSignature,
  showedExecutionProgress
} from "./verificationSanity.ts";
export type { ClassifyInput, FailureClassification, VerificationFailureKind } from "./verificationSanity.ts";

export {
  DEFAULT_CONTEXT_LIMITS,
  extractReferencedPaths,
  selectContextFiles
} from "./contextSelection.ts";
export type { ContextCandidate, ContextLimits, ContextReason, Selection, SelectionInput } from "./contextSelection.ts";

// --- Worker context requests -----------------------------------------------

export { ContextRequestStore } from "./contextRequests.ts";
export type { ContextRequest, ContextRequestStatus } from "./contextRequests.ts";
export { MAX_REQUESTED_BYTES, MAX_REQUESTED_FILES, parseRequests, renderRequestOutcomes } from "./workerOutput.ts";
export { validateRoles, rolesFor, assertPrimary } from "./roles.ts";
export type { WorkerRole, WorkerRoles, CodingProvider } from "./roles.ts";
export { AutopilotControlCenter, validateNewRun, readiness, dashboardCategory, projectRun, CONTROL_TIERS } from "./controlCenter.ts";
export type { NewRunForm, Readiness } from "./controlCenter.ts";

export { evaluatePrimaryProgress, latestPrimaryProgress, STALL_COMPARISONS } from "./progress.ts";
export type { PrimaryProgress } from "./progress.ts";
export { ConsultationStore } from "./consultations.ts";
export type { ConsultationRecord, ConsultationPreview, ConsultationScope, ConsultationStatus } from "./consultations.ts";

// --- Consultant: one bounded read-only diagnosis ---------------------------

export {
  ConsultantStore,
  ConsultantRunner,
  ConsultantExecutionError,
  consultantPrompt,
  renderAdvisory,
  MAX_DIAGNOSIS_CHARS
} from "./consultant.ts";
export type { ConsultantSession, DiagnosisRecord, DiagnosisStatus, ConsultantRunnerOptions } from "./consultant.ts";
