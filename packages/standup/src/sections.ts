/**
 * Build Standup report sections from facts + lifecycle + rankings.
 * Bounded / deterministic: SECTION_ITEM_CAP per section + overflow item.
 */

import type {
  ContinuationCandidate,
  StandupEvidenceRef,
  StandupItem,
  StandupReport,
  StandupSection,
  StandupTimeWindow,
} from '@dexnest/dev-intelligence-contracts';
import type { RepoFacts } from './facts.js';
import type { LifecycleTransitionResult } from './lifecycle.js';
import { rankContinuations } from './ranking.js';

/** Max items retained per section before an overflow summary item. */
export const SECTION_ITEM_CAP = 50;

export const STANDUP_SCHEMA_VERSION = 1;

function truncateItems(
  section: StandupSection['kind'],
  items: StandupItem[],
): StandupItem[] {
  if (items.length <= SECTION_ITEM_CAP) return items;
  const kept = items.slice(0, SECTION_ITEM_CAP);
  const overflow = items.length - SECTION_ITEM_CAP;
  kept.push({
    id: `${section.toLowerCase()}:overflow`,
    section,
    title: `${overflow} more item(s) omitted`,
    summary: `Section capped at ${SECTION_ITEM_CAP} items for bounded reports (${items.length} total before cap).`,
    evidence: [],
    sortKey: `zzz-overflow`,
    severity: 'info',
  });
  return kept;
}

function sortItems(items: StandupItem[]): StandupItem[] {
  return [...items].sort((a, b) => {
    const sk = (a.sortKey ?? a.id).localeCompare(b.sortKey ?? b.id);
    if (sk !== 0) return sk;
    return a.id.localeCompare(b.id);
  });
}

export interface BuildSectionsInput {
  readonly reportId: string;
  readonly window: StandupTimeWindow;
  readonly repos: readonly RepoFacts[];
  readonly lifecycle: LifecycleTransitionResult;
  readonly previousReportId?: string;
  readonly previousWindowSummary?: string;
  readonly generatedAt: string;
}

export interface BuiltSections {
  readonly sections: readonly StandupSection[];
  readonly items: readonly StandupItem[];
  readonly continuationCandidates: readonly ContinuationCandidate[];
}

export function buildSections(input: BuildSectionsInput): BuiltSections {
  const { repos, window, lifecycle, previousReportId, previousWindowSummary } =
    input;

  // --- Continue ---
  const continuationCandidates = rankContinuations(
    repos,
    window.from,
    window.to,
  );
  const continueItems: StandupItem[] = continuationCandidates.map((c) => ({
    id: `continue:${c.repositoryId}`,
    section: 'Continue',
    title: c.repositoryId,
    summary: c.reason,
    repositoryId: c.repositoryId,
    evidence: c.evidence,
    sortKey: `continue:${String(c.rank).padStart(4, '0')}:${c.repositoryId}`,
  }));

  // --- Changed ---
  const changedItems: StandupItem[] = [];
  for (const repo of repos) {
    const commits = repo.events.filter((e) => e.type === 'dev.commit.observed');
    for (const e of commits) {
      const payload = e.payload as { sha?: string; subject?: string };
      changedItems.push({
        id: `changed:commit:${e.eventId}`,
        section: 'Changed',
        title: payload.subject ?? `Commit ${payload.sha ?? e.eventId}`,
        summary: `Commit observed in ${repo.repositoryId}`,
        repositoryId: repo.repositoryId,
        evidence: [
          {
            kind: 'commit',
            id: e.eventId,
            repositoryId: repo.repositoryId,
            observedAt: e.observedAt,
          },
        ],
        sortKey: `changed:commit:${e.observedAt}:${e.eventId}`,
      });
    }

    const branches = repo.events.filter((e) => e.type === 'dev.branch.changed');
    for (const e of branches) {
      const payload = e.payload as {
        previousBranch?: string;
        currentBranch?: string;
      };
      changedItems.push({
        id: `changed:branch:${e.eventId}`,
        section: 'Changed',
        title: `Branch ${payload.previousBranch ?? '?'} → ${payload.currentBranch ?? '?'}`,
        repositoryId: repo.repositoryId,
        evidence: [
          {
            kind: 'event',
            id: e.eventId,
            repositoryId: repo.repositoryId,
            observedAt: e.observedAt,
          },
        ],
        sortKey: `changed:branch:${e.observedAt}:${e.eventId}`,
      });
    }

    for (const t of repo.openTodos) {
      if (t.firstObservedAt >= window.from && t.firstObservedAt < window.to) {
        changedItems.push({
          id: `changed:todo-new:${t.id}`,
          section: 'Changed',
          title: `New ${t.kind}: ${t.text.slice(0, 80)}`,
          repositoryId: repo.repositoryId,
          evidence: [
            {
              kind: 'todo',
              id: t.id,
              repositoryId: repo.repositoryId,
              observedAt: t.firstObservedAt,
            },
          ],
          sortKey: `changed:todo:${t.firstObservedAt}:${t.id}`,
        });
      }
    }
    for (const t of repo.resolvedTodos) {
      changedItems.push({
        id: `changed:todo-resolved:${t.id}`,
        section: 'Changed',
        title: `Resolved ${t.kind}: ${t.text.slice(0, 80)}`,
        repositoryId: repo.repositoryId,
        evidence: [
          {
            kind: 'todo',
            id: t.id,
            repositoryId: repo.repositoryId,
            observedAt: t.resolvedAt,
          },
        ],
        sortKey: `changed:todo-res:${t.resolvedAt ?? ''}:${t.id}`,
      });
    }
  }

  // Empty / no-changes deterministic marker when nothing changed and no repos activity
  if (changedItems.length === 0) {
    changedItems.push({
      id: 'changed:no-activity',
      section: 'Changed',
      title: 'No activity in window',
      summary: `No commits, branch changes, or TODO transitions between ${window.from} and ${window.to}.`,
      evidence: [],
      sortKey: 'changed:zzz-empty',
      severity: 'info',
    });
  }

  // --- NeedsAttention ---
  const attentionItems: StandupItem[] = [];
  for (const ann of lifecycle.announcements) {
    const issue = ann.issue;
    const unresolved =
      ann.lifecycle === 'ONGOING' && ann.unresolvedDays !== undefined
        ? ` Unresolved for ${ann.unresolvedDays} day(s).`
        : '';
    const evidence: StandupEvidenceRef[] = [
      {
        kind: issue.evidenceKind,
        id: issue.evidenceId,
        repositoryId: issue.repositoryId,
        observedAt: issue.observedAt,
      },
    ];
    attentionItems.push({
      id: `attention:${ann.lifecycle}:${issue.identity.fingerprint}`,
      section: 'NeedsAttention',
      title: `[${ann.lifecycle}] ${issue.title}`,
      summary: `${issue.summary}${unresolved}`,
      repositoryId: 'repositoryId' in issue ? issue.repositoryId : undefined,
      lifecycle: ann.lifecycle,
      issueIdentity: issue.identity,
      evidence,
      severity: issue.severity,
      sortKey: `attention:${ann.lifecycle}:${issue.identity.fingerprint}`,
    });
  }

  if (attentionItems.length === 0) {
    attentionItems.push({
      id: 'attention:none',
      section: 'NeedsAttention',
      title: 'No issues needing attention',
      summary: 'No failing health checks, conflicts, unfinished git operations, or load failures.',
      evidence: [],
      sortKey: 'attention:zzz-empty',
      severity: 'info',
    });
  }

  // --- RepositoryState ---
  const stateItems: StandupItem[] = [];
  for (const repo of repos) {
    if (!repo.ok && !repo.snapshot) {
      stateItems.push({
        id: `state:${repo.repositoryId}:error`,
        section: 'RepositoryState',
        title: `${repo.displayName ?? repo.repositoryId}: facts unavailable`,
        summary: repo.errorMessage ?? 'Load failure',
        repositoryId: repo.repositoryId,
        evidence: [
          {
            kind: 'diagnostics',
            id: `${repo.repositoryId}:${repo.errorKind ?? 'error'}`,
            repositoryId: repo.repositoryId,
          },
        ],
        severity: 'warning',
        sortKey: `state:${repo.repositoryId}`,
      });
      continue;
    }
    const git = repo.snapshot?.git;
    const branch = git?.currentBranch ?? '(detached)';
    const dirty =
      (git?.workingTree.unstagedCount ?? 0) +
      (git?.workingTree.untrackedCount ?? 0);
    const staged = git?.workingTree.stagedCount ?? 0;
    stateItems.push({
      id: `state:${repo.repositoryId}`,
      section: 'RepositoryState',
      title: `${repo.displayName ?? repo.repositoryId} @ ${branch}`,
      summary: `dirty=${dirty}, staged=${staged}, conflicts=${git?.workingTree.conflictedCount ?? 0}, clean=${git?.workingTree.isClean ?? true}`,
      repositoryId: repo.repositoryId,
      evidence: repo.snapshot
        ? [
            {
              kind: 'snapshot',
              id: repo.snapshot.id,
              repositoryId: repo.repositoryId,
              observedAt: repo.snapshot.capturedAt,
            },
          ]
        : [],
      sortKey: `state:${repo.repositoryId}`,
    });
  }

  if (stateItems.length === 0) {
    stateItems.push({
      id: 'state:no-repos',
      section: 'RepositoryState',
      title: 'No repositories',
      summary: 'DI PersistencePorts returned no repositories for this report.',
      evidence: [],
      sortKey: 'state:zzz-empty',
      severity: 'info',
    });
  }

  // --- History ---
  const historyItems: StandupItem[] = [];
  const resolved = lifecycle.announcements.filter(
    (a) => a.lifecycle === 'RESOLVED',
  );
  for (const ann of resolved) {
    historyItems.push({
      id: `history:resolved:${ann.issue.identity.fingerprint}`,
      section: 'History',
      title: `Resolved ${ann.issue.identity.kind ?? 'issue'}`,
      summary: ann.issue.summary,
      lifecycle: 'RESOLVED',
      issueIdentity: ann.issue.identity,
      evidence: [
        {
          kind: 'lifecycle',
          id: ann.issue.identity.fingerprint,
        },
      ],
      sortKey: `history:resolved:${ann.issue.identity.fingerprint}`,
    });
  }
  if (previousReportId) {
    historyItems.push({
      id: `history:prev:${previousReportId}`,
      section: 'History',
      title: `Previous report ${previousReportId}`,
      summary:
        previousWindowSummary ??
        `Prior successful report id=${previousReportId}`,
      evidence: [
        {
          kind: 'report',
          id: previousReportId,
        },
      ],
      sortKey: `history:prev:${previousReportId}`,
    });
  }
  if (historyItems.length === 0) {
    historyItems.push({
      id: 'history:empty',
      section: 'History',
      title: 'No prior history',
      summary: 'First successful report or no resolved issues since last standup.',
      evidence: [],
      sortKey: 'history:zzz-empty',
      severity: 'info',
    });
  }

  const sections: StandupSection[] = [
    {
      kind: 'Continue',
      items: truncateItems('Continue', sortItems(continueItems)),
      continuationCandidates,
    },
    {
      kind: 'Changed',
      items: truncateItems('Changed', sortItems(changedItems)),
    },
    {
      kind: 'NeedsAttention',
      items: truncateItems('NeedsAttention', sortItems(attentionItems)),
    },
    {
      kind: 'RepositoryState',
      items: truncateItems('RepositoryState', sortItems(stateItems)),
    },
    {
      kind: 'History',
      items: truncateItems('History', sortItems(historyItems)),
    },
  ];

  const items = sections.flatMap((s) => s.items);
  return { sections, items, continuationCandidates };
}

export function emptyReportSkeleton(
  partial: Pick<
    StandupReport,
    | 'id'
    | 'occurrenceId'
    | 'triggerKind'
    | 'generatedAt'
    | 'timeWindow'
    | 'previousSuccessfulReportId'
  >,
): StandupReport {
  const built = buildSections({
    reportId: partial.id,
    window: partial.timeWindow,
    repos: [],
    lifecycle: { announcements: [], openStates: [] },
    previousReportId: partial.previousSuccessfulReportId,
    generatedAt: partial.generatedAt,
  });
  return {
    ...partial,
    schemaVersion: STANDUP_SCHEMA_VERSION,
    sections: built.sections,
    items: built.items,
    continuationCandidates: built.continuationCandidates,
    issueStates: [],
  };
}
