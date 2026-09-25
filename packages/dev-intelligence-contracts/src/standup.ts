/**
 * Standup for One — report model, windows, service interface, and occurrence identity.
 *
 * Design rules (Week 1):
 * - No LLM / cloud calls; deterministic evidence only.
 * - Consumes Developer Intelligence via shared contracts only — do NOT duplicate scan logic.
 * - Continuation candidates MUST include an evidence-based `reason` (WHY), never "AI judgment".
 * - Persist timestamps as ISO-8601 UTC; render using the host/local timezone
 *   (the host supplies an IANA zone; DexNest uses the OS zone via `Intl`).
 * - Pure types: no React, Node fs, or SQLite imports here.
 *
 * Phase 4 owns the real engine implementation; these types are the Phase 1 contract surface.
 */

import type { IssueLifecycle, IssueIdentity, IssueLifecycleState } from './issue-lifecycle.js';

/**
 * Stable Standup report section identifiers.
 * Exact UX copy may evolve; these string values are the contract vocabulary
 * (Acceptance Criteria E / ARCHITECTURE standup engine rules).
 */
export type StandupSectionKind =
  | 'Continue'
  | 'Changed'
  | 'NeedsAttention'
  | 'RepositoryState'
  | 'History';

export const StandupSectionKind = {
  Continue: 'Continue',
  Changed: 'Changed',
  NeedsAttention: 'NeedsAttention',
  RepositoryState: 'RepositoryState',
  History: 'History',
} as const satisfies Record<StandupSectionKind, StandupSectionKind>;

/**
 * How the Standup activity window is selected.
 *
 * - `since_last_standup` — **default**: from previous *successfully generated* Standup
 *   (completed report) to "now". If none exists, first-run lookback ≈ last 24 hours
 *   (D-009). Missed / skipped scheduled Standups must NOT permanently drop activity:
 *   the next successful report may cover since the previous successful report.
 * - `today` — calendar day in the configured local timezone (HostTimezonePort).
 * - `last_24_hours` — rolling 24h ending at generation time.
 * - `last_3_days` — rolling 72h ending at generation time.
 * - `custom` — explicit `[from, to]` bounds supplied by the caller.
 */
export type StandupWindowKind =
  | 'since_last_standup'
  | 'today'
  | 'last_24_hours'
  | 'last_3_days'
  | 'custom';

export const StandupWindowKind = {
  SinceLastStandup: 'since_last_standup',
  Today: 'today',
  Last24Hours: 'last_24_hours',
  Last3Days: 'last_3_days',
  Custom: 'custom',
} as const;

/**
 * Resolved activity window for a report.
 *
 * Persist `from` / `to` as ISO-8601 UTC. UI and section copy SHOULD render those
 * instants via the host-supplied IANA timezone. Do not
 * redefine that port in this module. Midnight / "today" boundaries use the
 * configured local timezone so timezone edges do not silently drop a day of
 * activity (EC-050).
 */
export interface StandupTimeWindow {
  readonly kind: StandupWindowKind;
  /** Inclusive lower bound, ISO-8601 UTC. */
  readonly from: string;
  /** Upper bound as documented by the engine; ISO-8601 UTC. */
  readonly to: string;
  /**
   * IANA timezone id snapshotted at generation for calendar kinds (`today`) and display.
   * Optional on stored reports; engine may copy the configured host zone.
   */
  readonly timezone?: string;
}

/**
 * What caused report generation.
 *
 * - `scheduled` — timer / HostSchedulerPort / background trigger. Duplicate scheduled
 *   triggers for the **same occurrence** MUST NOT create a second consequential report
 *   or duplicate consequential findings (EC-033, EC-042, EC-055). Reuse the existing
 *   report for that occurrenceId / idempotency key.
 * - `manual` — explicit user "regenerate" / "generate now". Manual regeneration MAY
 *   create a **new** occurrence (new occurrenceId) and a new report even if a scheduled
 *   report already exists for the same calendar slot, so the user can force a fresh
 *   snapshot. Document intent in UI; still use deterministic evidence.
 */
export type StandupTriggerKind = 'scheduled' | 'manual';

export const StandupTriggerKind = {
  Scheduled: 'scheduled',
  Manual: 'manual',
} as const;

/**
 * Shape of an idempotency key for Standup generation.
 *
 * Scheduled duplicates with the same key return/reuse the prior report.
 * Manual regeneration SHOULD use a distinct key (e.g. include a fresh nonce or
 * `triggerKind: "manual"` plus generation request id) so it is allowed to create
 * a new occurrence without colliding with the scheduled slot.
 */
export interface StandupIdempotencyKey {
  /**
   * Stable occurrence bucket, e.g. `standup:${localDate}:${windowKind}` for scheduled
   * morning runs, or a request-scoped id for manual runs.
   */
  readonly occurrenceId: string;
  readonly triggerKind: StandupTriggerKind;
  /**
   * Optional content/version salt so schema or settings changes can intentionally
   * invalidate a prior scheduled result when product policy allows.
   */
  readonly keyVersion?: string;
}

/**
 * Opaque repository id as issued by Developer Intelligence (string contract only;
 * DI owns discovery — Standup must not invent scanning APIs here).
 */
export type RepositoryId = string;

/**
 * Pointer to stored evidence that backs a Standup claim (EC-038).
 * Pure reference shape — persistence lives behind `@dexnest/dev-intelligence-store`.
 */
export interface StandupEvidenceRef {
  /** Evidence kind discriminator (e.g. "commit", "working_tree", "todo", "health", "event"). */
  readonly kind: string;
  /** Stable id or fingerprint of the evidence record. */
  readonly id: string;
  /** Optional repository scope. */
  readonly repositoryId?: RepositoryId;
  /** Optional ISO-8601 UTC when the evidence was observed. */
  readonly observedAt?: string;
}

/**
 * Individual finding / line item inside a Standup report.
 */
export interface StandupItem {
  readonly id: string;
  /** Section this item belongs to. */
  readonly section: StandupSectionKind;
  /** Short deterministic title suitable for list UI. */
  readonly title: string;
  /** Optional longer body; still evidence-based, not LLM advice. */
  readonly summary?: string;
  readonly repositoryId?: RepositoryId;
  /** Cross-report lifecycle when this item tracks a durable issue. */
  readonly lifecycle?: IssueLifecycle;
  readonly issueIdentity?: IssueIdentity;
  /** Evidence refs that justify this item's claim. */
  readonly evidence: readonly StandupEvidenceRef[];
  /**
   * Optional severity / priority hint for NeedsAttention ordering.
   * Ranking MUST remain deterministic (counts, recency, configured weights) — not AI.
   */
  readonly severity?: 'info' | 'warning' | 'critical';
  /** Opaque stable sort key for deterministic ordering within a section. */
  readonly sortKey?: string;
}

/**
 * Contract-only grouping of repositories / items for Continuations or Changed sections.
 * Implementation of grouping algorithms is optional until Phase 4.
 */
export interface ProjectGroup {
  readonly id: string;
  readonly label: string;
  readonly repositoryIds: readonly RepositoryId[];
  /** Optional parent group for nested project trees. */
  readonly parentId?: string;
}

/**
 * A repository (or project) suggested as the next place to continue work.
 *
 * `reason` is **mandatory** and MUST be evidence-based prose explaining WHY this
 * candidate was ranked (example style: "Most recently active repository with six
 * uncommitted changes."). Ranking is deterministic evidence interpretation, not
 * "AI judgment".
 */
export interface ContinuationCandidate {
  readonly repositoryId: RepositoryId;
  /** Optional project grouping this candidate belongs to. */
  readonly projectGroupId?: string;
  /**
   * Mandatory human-readable WHY grounded in stored facts
   * (activity recency, dirty files, conflicts, open TODOs, etc.).
   */
  readonly reason: string;
  /** Deterministic rank (lower = higher priority), stable across identical inputs. */
  readonly rank: number;
  /** Supporting evidence for the reason string. */
  readonly evidence: readonly StandupEvidenceRef[];
}

/**
 * One rendered section inside a report (ordered list of items + optional candidates).
 */
export interface StandupSection {
  readonly kind: StandupSectionKind;
  readonly items: readonly StandupItem[];
  /** Populated for Continue (and optionally others) when ranking is applied. */
  readonly continuationCandidates?: readonly ContinuationCandidate[];
  readonly projectGroups?: readonly ProjectGroup[];
}

/**
 * Persisted Standup report — durable personal developer state snapshot.
 */
export interface StandupReport {
  /** Unique report id (UUID or store-assigned). */
  readonly id: string;
  /**
   * Occurrence identity for idempotency.
   * Scheduled duplicates sharing this id MUST reuse the same consequential report.
   */
  readonly occurrenceId: string;
  readonly triggerKind: StandupTriggerKind;
  /** Optional full idempotency key snapshot. */
  readonly idempotencyKey?: StandupIdempotencyKey;
  /** ISO-8601 UTC generation time. */
  readonly generatedAt: string;
  /** Activity window covered by this report. */
  readonly timeWindow: StandupTimeWindow;
  /** Schema version for forward-compatible persistence. */
  readonly schemaVersion: number;
  readonly sections: readonly StandupSection[];
  /** Flattened items (optional denormalization; may mirror section.items). */
  readonly items: readonly StandupItem[];
  /** Issue lifecycle states referenced by this report. */
  readonly issueStates?: readonly IssueLifecycleState[];
  /** Continuations promoted to report top-level for convenience. */
  readonly continuationCandidates?: readonly ContinuationCandidate[];
  /** Prior successful report this window followed, when kind is since_last_standup. */
  readonly previousSuccessfulReportId?: string;
  /** Free-form generation diagnostics (non-secret); not user-facing productivity advice. */
  readonly diagnostics?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Input for {@link StandupService.generateStandup}.
 *
 * Window selection: omit `window` / use `since_last_standup` for the default.
 * First-run (no prior successful report) resolves to ~24h lookback.
 */
export interface GenerateStandupInput {
  /**
   * Desired window. Defaults to `{ kind: "since_last_standup" }`.
   * For `custom`, both `from` and `to` (ISO-8601 UTC) are required.
   */
  readonly window?: {
    readonly kind: StandupWindowKind;
    readonly from?: string;
    readonly to?: string;
    readonly timezone?: string;
  };
  /**
   * Trigger metadata. Defaults SHOULD be `manual` for explicit API calls and
   * `scheduled` for background jobs. Scheduled callers MUST supply a stable
   * `occurrenceId` / idempotency key so duplicates collapse.
   */
  readonly triggerKind?: StandupTriggerKind;
  readonly occurrenceId?: string;
  readonly idempotencyKey?: StandupIdempotencyKey;
  /**
   * When true with `triggerKind: "manual"`, force a new occurrence even if a
   * scheduled report already exists for the current slot.
   */
  readonly forceNewOccurrence?: boolean;
  /** Optional repository filter; omit = all known repos from DI. */
  readonly repositoryIds?: readonly RepositoryId[];
}

export interface GetStandupReportInput {
  readonly id: string;
}

/**
 * Query for listing historical Standups.
 * Window filters apply to `generatedAt` and/or the report's covered `timeWindow`
 * as implemented by the engine (document in Phase 4).
 */
export interface ListStandupReportsQuery {
  readonly limit?: number;
  readonly offset?: number;
  /** Filter reports whose generatedAt is >= this ISO-8601 UTC instant. */
  readonly generatedFrom?: string;
  /** Filter reports whose generatedAt is < this ISO-8601 UTC instant. */
  readonly generatedTo?: string;
  /**
   * Optional activity-window kind filter (e.g. only reports that used
   * `since_last_standup`).
   */
  readonly windowKind?: StandupWindowKind;
  readonly triggerKind?: StandupTriggerKind;
  readonly occurrenceId?: string;
  readonly repositoryId?: RepositoryId;
}

export interface ListStandupReportsResult {
  readonly reports: readonly StandupReport[];
  readonly total?: number;
}

/**
 * Standup application service — generate, fetch, and list reports.
 *
 * The implementation lives in `@dexnest/standup`. This interface is the
 * Phase 1 contract boundary for harness / future DexNest host wiring.
 */
export interface StandupService {
  /**
   * Generate (or idempotently reuse) a Standup report for the selected window.
   * Duplicate scheduled triggers for the same occurrence MUST NOT duplicate
   * consequential findings.
   */
  generateStandup(input: GenerateStandupInput): Promise<StandupReport>;

  /** Fetch a single report by id; reject / return null policy is implementation-defined. */
  getStandupReport(input: GetStandupReportInput): Promise<StandupReport | null>;

  /** List historical reports with optional window / trigger filters. */
  listStandupReports(query: ListStandupReportsQuery): Promise<ListStandupReportsResult>;
}
