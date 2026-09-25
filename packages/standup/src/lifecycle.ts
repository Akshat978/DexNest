/**
 * Issue lifecycle: stable fingerprints → NEW / ONGOING / RESOLVED.
 *
 * Issue kinds (deterministic conditions):
 * - failing/timeout/error health check: repo + checkId
 * - conflicts: repo + sorted conflict paths signature
 * - unfinished git operation: repo + operation name
 * - repository load/scan failure: repo + error kind
 *
 * Fingerprints use contracts `fingerprintFromParts` with a related event type
 * so the same evidence always yields the same fingerprint.
 */

import {
  fingerprintFromParts,
  type IssueIdentity,
  type IssueLifecycle,
  type IssueLifecycleState,
} from '@dexnest/dev-intelligence-contracts';
import type { RepoFacts } from './facts.js';

export interface ObservedIssue {
  readonly identity: IssueIdentity;
  readonly title: string;
  readonly summary: string;
  readonly repositoryId: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly evidenceKind: string;
  readonly evidenceId: string;
  readonly observedAt: string;
}

/**
 * Detect currently-open issues from collected facts (present-tense conditions).
 */
export function detectOpenIssues(
  repos: readonly RepoFacts[],
  observedAt: string,
): ObservedIssue[] {
  const issues: ObservedIssue[] = [];

  for (const repo of repos) {
    if (!repo.ok) {
      const kind = repo.errorKind ?? 'load_failure';
      const fp = fingerprintFromParts(
        'dev.repo.snapshot',
        repo.repositoryId,
        'standup_issue',
        kind,
      );
      issues.push({
        identity: {
          id: fp,
          fingerprint: fp,
          kind: kind === 'scan_failed' ? 'scan_failed' : 'load_failure',
        },
        title: `Repository facts unavailable (${kind})`,
        summary: repo.errorMessage ?? 'Unknown error loading repository facts',
        repositoryId: repo.repositoryId,
        severity: 'warning',
        evidenceKind: 'diagnostics',
        evidenceId: `${repo.repositoryId}:${kind}`,
        observedAt,
      });
      // Still try to surface other issues from partial data below when present.
    }

    const git = repo.snapshot?.git;
    if (git) {
      const conflicted = git.workingTree.conflictedCount;
      if (conflicted > 0) {
        const paths = [...(git.workingTree.samplePaths ?? [])].sort();
        const signature =
          paths.length > 0 ? paths.join('|') : `count:${conflicted}`;
        const fp = fingerprintFromParts(
          'dev.conflict.observed',
          repo.repositoryId,
          signature,
        );
        issues.push({
          identity: {
            id: fp,
            fingerprint: fp,
            kind: 'conflict',
          },
          title: `${conflicted} conflicted path(s)`,
          summary:
            paths.length > 0
              ? `Conflicts involving: ${paths.slice(0, 5).join(', ')}`
              : `${conflicted} conflicted file(s) in working tree`,
          repositoryId: repo.repositoryId,
          severity: 'critical',
          evidenceKind: 'working_tree',
          evidenceId: repo.snapshot!.id,
          observedAt,
        });
      }

      if (git.interruptedOperation) {
        const op = git.interruptedOperation;
        const fp = fingerprintFromParts(
          'dev.git_operation.started',
          repo.repositoryId,
          op,
        );
        issues.push({
          identity: {
            id: fp,
            fingerprint: fp,
            kind: 'unfinished_git_operation',
          },
          title: `Unfinished git operation: ${op}`,
          summary: `Repository has an interrupted ${op} in progress`,
          repositoryId: repo.repositoryId,
          severity: 'critical',
          evidenceKind: 'git_operation',
          evidenceId: `${repo.repositoryId}:${op}`,
          observedAt,
        });
      }
    }

    for (const check of repo.healthChecks) {
      const run = repo.latestHealthRuns.get(check.id);
      if (!run) continue;
      if (
        run.status === 'FAIL' ||
        run.status === 'TIMEOUT' ||
        run.status === 'EXECUTION_ERROR'
      ) {
        const fp = fingerprintFromParts(
          'dev.health.completed',
          repo.repositoryId,
          check.id,
          'failing',
        );
        issues.push({
          identity: {
            id: fp,
            fingerprint: fp,
            kind: 'failing_health_check',
          },
          title: `Health check ${check.name} ${run.status}`,
          summary:
            run.errorMessage ??
            `Latest run ${run.id} finished with status ${run.status}`,
          repositoryId: repo.repositoryId,
          severity: run.status === 'TIMEOUT' ? 'warning' : 'critical',
          evidenceKind: 'health',
          evidenceId: run.id,
          observedAt: run.finishedAt ?? run.startedAt,
        });
      }
    }
  }

  // Stable order by fingerprint
  issues.sort((a, b) =>
    a.identity.fingerprint.localeCompare(b.identity.fingerprint),
  );
  return issues;
}

export interface LifecycleTransitionResult {
  /** Issues to announce in NeedsAttention (NEW / ONGOING / RESOLVED). */
  readonly announcements: ReadonlyArray<{
    issue: ObservedIssue | { identity: IssueIdentity; repositoryId?: string; title: string; summary: string; severity: 'info' | 'warning' | 'critical'; evidenceKind: string; evidenceId: string; observedAt: string };
    lifecycle: IssueLifecycle;
    state: IssueLifecycleState;
    unresolvedDays?: number;
  }>;
  /** Open set to persist after successful report (NEW + ONGOING only). */
  readonly openStates: readonly IssueLifecycleState[];
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

/**
 * Compare currently observed open issues against persisted open states.
 *
 * - absent before ⇒ NEW
 * - present before and now ⇒ ONGOING (with unresolved day count)
 * - present before, absent now ⇒ RESOLVED (announce once; drop from open set)
 */
export function transitionLifecycle(
  observed: readonly ObservedIssue[],
  previousOpen: readonly IssueLifecycleState[],
  reportId: string,
  nowIso: string,
): LifecycleTransitionResult {
  const prevByFp = new Map(
    previousOpen.map((s) => [s.identity.fingerprint, s] as const),
  );
  const observedFps = new Set(observed.map((o) => o.identity.fingerprint));

  type Ann = LifecycleTransitionResult['announcements'][number];
  const announcements: Ann[] = [];
  const openStates: IssueLifecycleState[] = [];

  for (const issue of observed) {
    const prev = prevByFp.get(issue.identity.fingerprint);
    if (!prev) {
      const announceState: IssueLifecycleState = {
        identity: issue.identity,
        lifecycle: 'NEW',
        firstObservedAt: nowIso,
        lastObservedAt: nowIso,
        firstReportId: reportId,
      };
      announcements.push({ issue, lifecycle: 'NEW', state: announceState });
      // Persist as open (ONGOING marker in open set) so the next report sees
      // the fingerprint as previously present → ONGOING, not NEW again.
      openStates.push({
        identity: issue.identity,
        lifecycle: 'ONGOING',
        firstObservedAt: nowIso,
        lastObservedAt: nowIso,
        firstReportId: reportId,
      });
    } else {
      const unresolvedDays = daysBetween(prev.firstObservedAt, nowIso);
      const state: IssueLifecycleState = {
        identity: issue.identity,
        lifecycle: 'ONGOING',
        firstObservedAt: prev.firstObservedAt,
        lastObservedAt: nowIso,
        firstReportId: prev.firstReportId ?? reportId,
      };
      announcements.push({
        issue,
        lifecycle: 'ONGOING',
        state,
        unresolvedDays,
      });
      openStates.push(state);
    }
  }

  // RESOLVED: previously open, not observed now
  for (const prev of previousOpen) {
    if (observedFps.has(prev.identity.fingerprint)) continue;
    const state: IssueLifecycleState = {
      identity: prev.identity,
      lifecycle: 'RESOLVED',
      firstObservedAt: prev.firstObservedAt,
      lastObservedAt: nowIso,
      firstReportId: prev.firstReportId,
      resolvedInReportId: reportId,
    };
    announcements.push({
      issue: {
        identity: prev.identity,
        repositoryId: undefined,
        title: `Resolved: ${prev.identity.kind ?? 'issue'}`,
        summary: `Issue ${prev.identity.fingerprint} no longer observed`,
        severity: 'info',
        evidenceKind: 'lifecycle',
        evidenceId: prev.identity.fingerprint,
        observedAt: nowIso,
      },
      lifecycle: 'RESOLVED',
      state,
    });
  }

  announcements.sort((a, b) =>
    a.issue.identity.fingerprint.localeCompare(b.issue.identity.fingerprint),
  );
  openStates.sort((a, b) =>
    a.identity.fingerprint.localeCompare(b.identity.fingerprint),
  );

  return { announcements, openStates };
}
