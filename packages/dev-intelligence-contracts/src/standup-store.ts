/**
 * Standup-owned persistence port (collision-safe with DI PersistencePorts).
 *
 * Standup reports, items, and open issue lifecycle states live behind this
 * interface. Implementations live in @dexnest/dev-intelligence-store
 * (`createStandupStore`) but are NOT part of DI's PersistencePorts facade.
 *
 * Pure types only: no React, filesystem, or SQLite imports.
 */

import type { IssueLifecycleState } from './issue-lifecycle.js';
import type {
  ListStandupReportsQuery,
  ListStandupReportsResult,
  StandupReport,
  StandupTriggerKind,
} from './standup.js';

/**
 * Persistence for Standup reports and cross-report open issue states.
 *
 * - `saveReport` is idempotent on (occurrenceId, triggerKind) for scheduled
 *   occurrences: inserting a duplicate scheduled key MUST return the existing
 *   report unchanged (no second consequential write / lifecycle mutation).
 * - Open issue states are keyed by fingerprint; the engine upserts the open set
 *   after each successful report generation.
 */
export interface StandupStore {
  /**
   * Persist a completed report. For scheduled triggers, UNIQUE(occurrence_id,
   * trigger_kind) collision returns the already-stored report (INSERT OR IGNORE
   * semantics). Manual occurrences use distinct occurrenceIds and always insert.
   */
  saveReport(report: StandupReport): Promise<StandupReport>;

  /** Lookup by occurrence identity (scheduled duplicate detection). */
  findByOccurrence(
    occurrenceId: string,
    triggerKind: StandupTriggerKind,
  ): Promise<StandupReport | null>;

  getReport(id: string): Promise<StandupReport | null>;

  listReports(query: ListStandupReportsQuery): Promise<ListStandupReportsResult>;

  /**
   * Most recent successfully completed report (any triggerKind), ordered by
   * generatedAt descending. Used for since_last_standup window anchoring and
   * History pointers. Only status=completed reports qualify.
   */
  getLatestSuccessfulReport(): Promise<StandupReport | null>;

  /** Currently open (non-resolved) issue lifecycle states, keyed by fingerprint. */
  getIssueStates(): Promise<readonly IssueLifecycleState[]>;

  /**
   * Replace / upsert the open issue set after a successful report.
   * Resolved issues SHOULD be removed from the open set (or marked resolved and
   * dropped on next upsert); implementations may delete fingerprints absent from
   * `states` when the engine passes the full open set.
   */
  upsertIssueStates(states: readonly IssueLifecycleState[]): Promise<void>;
}
