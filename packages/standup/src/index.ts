/**
 * `@dexnest/standup` — Phase 4 Standup for One report engine.
 *
 * Pure logic: depends on `@dexnest/dev-intelligence-contracts` only at runtime.
 * No React, no node:fs, no sql.js, no child_process, no LLM, no network, no scan.
 */

export type {
  StandupReport,
  StandupItem,
  StandupService,
  StandupTimeWindow,
  StandupIdempotencyKey,
  StandupEvidenceRef,
  StandupSection,
  ContinuationCandidate,
  ProjectGroup,
  GenerateStandupInput,
  GetStandupReportInput,
  ListStandupReportsQuery,
  ListStandupReportsResult,
  IssueIdentity,
  IssueLifecycleState,
  RepositoryId,
  StandupStore,
} from '@dexnest/dev-intelligence-contracts';

export {
  IssueLifecycle,
  StandupSectionKind,
  StandupWindowKind,
  StandupTriggerKind,
} from '@dexnest/dev-intelligence-contracts';

export const STANDUP_ENGINE_PHASE = 'phase4-engine' as const;

export const PACKAGE_NAME = '@dexnest/standup' as const;

/** @deprecated Phase 1 stub retained for compatibility; engine is real now. */
export function standupEngineStub(): {
  ready: true;
  phase: typeof STANDUP_ENGINE_PHASE;
} {
  return { ready: true, phase: STANDUP_ENGINE_PHASE };
}

export {
  createStandupService,
  type CreateStandupServiceOptions,
  type StandupClock,
  type StandupTimezone,
  localDateString,
  scheduledOccurrenceId,
} from './service.js';

export {
  resolveWindow,
  startOfLocalDay,
  zonedYmd,
  timezoneOffsetMs,
  type ResolveWindowContext,
} from './windows.js';

export {
  CONTINUATION_WEIGHTS,
  CONTINUATION_CAP,
  rankContinuations,
  scoreRepository,
} from './ranking.js';

export { SECTION_ITEM_CAP, STANDUP_SCHEMA_VERSION, buildSections } from './sections.js';

export { collectFacts, type RepoFacts, type CollectedFacts } from './facts.js';

export {
  detectOpenIssues,
  transitionLifecycle,
  type ObservedIssue,
  type LifecycleTransitionResult,
} from './lifecycle.js';
