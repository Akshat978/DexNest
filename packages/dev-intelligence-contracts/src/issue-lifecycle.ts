/**
 * Issue lifecycle contracts for Standup for One.
 *
 * Cross-report semantics (do not re-announce unchanged problems as new each morning):
 *
 * 1. **NEW** — first observed in the current report's time window (or first successful
 *    Standup that surfaces this issue fingerprint). Announce once as new.
 * 2. **ONGOING** — previously observed and still present / unresolved relative to the
 *    prior successful Standup. Mention as ongoing; do not treat as a fresh "new" finding.
 * 3. **RESOLVED** — previously observed and no longer present (or explicitly closed by
 *    evidence) since the prior successful Standup. Announce resolution once.
 *
 * Implementations MUST key lifecycle transitions by a stable issue identity (fingerprint /
 * occurrence key), not by free-text title alone. Ranking and copy remain deterministic
 * evidence interpretation — no LLM judgment.
 *
 * Pure types only: no React, filesystem, or SQLite dependencies.
 */

/**
 * Lifecycle state of a Standup issue / finding across successive reports.
 *
 * @see module documentation for cross-report NEW → ONGOING → RESOLVED rules.
 */
export type IssueLifecycle = 'NEW' | 'ONGOING' | 'RESOLVED';

/**
 * Const object mirroring {@link IssueLifecycle} for runtime-safe comparisons without enums.
 */
export const IssueLifecycle = {
  NEW: 'NEW',
  ONGOING: 'ONGOING',
  RESOLVED: 'RESOLVED',
} as const satisfies Record<IssueLifecycle, IssueLifecycle>;

/**
 * Stable identity for an issue tracked across Standup reports.
 *
 * Implementations SHOULD derive `fingerprint` from deterministic evidence
 * (e.g. repo id + finding kind + normalized path / conflict identity), so
 * duplicate scheduled Standups and rescan-without-change do not invent new issues.
 */
export interface IssueIdentity {
  /** Opaque stable id for persistence / joins (UUID or content-addressed). */
  readonly id: string;
  /**
   * Deterministic fingerprint used for idempotent inserts and lifecycle matching.
   * Same evidence → same fingerprint.
   */
  readonly fingerprint: string;
  /** Optional human-readable kind discriminator (e.g. "conflict", "todo", "dirty_tree"). */
  readonly kind?: string;
}

/**
 * Snapshot of an issue's lifecycle relative to a specific Standup report occurrence.
 */
export interface IssueLifecycleState {
  readonly identity: IssueIdentity;
  readonly lifecycle: IssueLifecycle;
  /**
   * ISO-8601 UTC timestamp when this issue fingerprint was first successfully
   * recorded in a Standup (or underlying durable store).
   */
  readonly firstObservedAt: string;
  /**
   * ISO-8601 UTC timestamp of the most recent observation that kept the issue open,
   * or when it flipped to RESOLVED.
   */
  readonly lastObservedAt: string;
  /**
   * Standup report id that first announced this fingerprint as NEW, when known.
   */
  readonly firstReportId?: string;
  /**
   * Standup report id that announced RESOLVED, when applicable.
   */
  readonly resolvedInReportId?: string;
}
