/**
 * Deterministic continuation ranking with mandatory evidence-based reasons.
 *
 * Weights (explicit constants — not AI judgment):
 * - unfinished git operation: 1000
 * - conflicts (per conflicted file, capped): 200 each, max 2000
 * - failing health check: 800 each
 * - dirty (unstaged+untracked) count: 10 each
 * - staged count: 5 each
 * - recent commits in window: 15 each
 * - open TODOs: 8 each
 * - recency of latest activity in window: up to 500 (more recent = higher)
 *
 * Tie-break: higher score wins; equal score → lexicographic repositoryId ASC.
 * Cap: top CONTINUATION_CAP candidates.
 */

import type {
  ContinuationCandidate,
  StandupEvidenceRef,
} from '@dexnest/dev-intelligence-contracts';
import type { RepoFacts } from './facts.js';

export const CONTINUATION_WEIGHTS = {
  unfinishedGitOp: 1000,
  conflictPerFile: 200,
  conflictCap: 2000,
  failingHealth: 800,
  dirtyPerFile: 10,
  stagedPerFile: 5,
  recentCommit: 15,
  openTodo: 8,
  recencyMax: 500,
} as const;

export const CONTINUATION_CAP = 5;

export interface RankedRepo {
  readonly repositoryId: string;
  readonly score: number;
  readonly reason: string;
  readonly evidence: readonly StandupEvidenceRef[];
  readonly signals: {
    readonly dirty: number;
    readonly staged: number;
    readonly conflicts: number;
    readonly unfinishedOp?: string;
    readonly failingHealth: number;
    readonly recentCommits: number;
    readonly openTodos: number;
    readonly latestActivityAt?: string;
  };
}

function recencyScore(
  latestActivityAt: string | undefined,
  windowFrom: string,
  windowTo: string,
): number {
  if (!latestActivityAt) return 0;
  const from = new Date(windowFrom).getTime();
  const to = new Date(windowTo).getTime();
  const at = new Date(latestActivityAt).getTime();
  if (!(to > from) || Number.isNaN(at)) return 0;
  const ratio = Math.min(1, Math.max(0, (at - from) / (to - from)));
  return Math.round(ratio * CONTINUATION_WEIGHTS.recencyMax);
}

function buildReason(signals: RankedRepo['signals']): string {
  const parts: string[] = [];

  if (signals.unfinishedOp) {
    parts.push(`Unfinished ${signals.unfinishedOp}`);
  }
  if (signals.conflicts > 0) {
    parts.push(
      `${signals.conflicts} conflicted file${signals.conflicts === 1 ? '' : 's'}`,
    );
  }
  if (signals.failingHealth > 0) {
    parts.push(
      `${signals.failingHealth} failing health check${signals.failingHealth === 1 ? '' : 's'}`,
    );
  }

  const dirtyTotal = signals.dirty;
  if (dirtyTotal > 0) {
    parts.push(
      `${dirtyTotal} uncommitted change${dirtyTotal === 1 ? '' : 's'}`,
    );
  }
  if (signals.staged > 0 && dirtyTotal === 0) {
    parts.push(`${signals.staged} staged change${signals.staged === 1 ? '' : 's'}`);
  }
  if (signals.recentCommits > 0) {
    parts.push(
      `${signals.recentCommits} commit${signals.recentCommits === 1 ? '' : 's'} in window`,
    );
  }
  if (signals.openTodos > 0) {
    parts.push(
      `${signals.openTodos} open TODO${signals.openTodos === 1 ? '' : 's'}`,
    );
  }

  if (parts.length === 0) {
    if (signals.latestActivityAt) {
      return `Most recently active repository (last activity ${signals.latestActivityAt}).`;
    }
    return 'Repository present with no outstanding attention signals.';
  }

  // Prefer "Most recently active…" framing when activity + dirty dominate
  if (
    signals.latestActivityAt &&
    !signals.unfinishedOp &&
    signals.conflicts === 0 &&
    signals.failingHealth === 0
  ) {
    return `Most recently active repository with ${parts.join(' and ')}.`;
  }

  // Capitalize first clause
  const body = parts.join(' and ');
  return body.charAt(0).toUpperCase() + body.slice(1) + '.';
}

export function scoreRepository(
  repo: RepoFacts,
  windowFrom: string,
  windowTo: string,
): RankedRepo {
  const git = repo.snapshot?.git;
  const dirty =
    (git?.workingTree.unstagedCount ?? 0) +
    (git?.workingTree.untrackedCount ?? 0);
  const staged = git?.workingTree.stagedCount ?? 0;
  const conflicts = git?.workingTree.conflictedCount ?? 0;
  const unfinishedOp = git?.interruptedOperation;

  let failingHealth = 0;
  for (const check of repo.healthChecks) {
    const run = repo.latestHealthRuns.get(check.id);
    if (
      run &&
      (run.status === 'FAIL' ||
        run.status === 'TIMEOUT' ||
        run.status === 'EXECUTION_ERROR')
    ) {
      failingHealth += 1;
    }
  }

  const recentCommits = repo.events.filter(
    (e) => e.type === 'dev.commit.observed',
  ).length;
  const openTodos = repo.openTodos.length;

  let latestActivityAt: string | undefined;
  for (const e of repo.events) {
    if (!latestActivityAt || e.observedAt > latestActivityAt) {
      latestActivityAt = e.observedAt;
    }
  }
  if (repo.snapshot?.capturedAt) {
    const c = repo.snapshot.capturedAt;
    if (
      c >= windowFrom &&
      c < windowTo &&
      (!latestActivityAt || c > latestActivityAt)
    ) {
      latestActivityAt = c;
    }
  }

  const signals = {
    dirty,
    staged,
    conflicts,
    unfinishedOp,
    failingHealth,
    recentCommits,
    openTodos,
    latestActivityAt,
  };

  let score = 0;
  if (unfinishedOp) score += CONTINUATION_WEIGHTS.unfinishedGitOp;
  score += Math.min(
    CONTINUATION_WEIGHTS.conflictCap,
    conflicts * CONTINUATION_WEIGHTS.conflictPerFile,
  );
  score += failingHealth * CONTINUATION_WEIGHTS.failingHealth;
  score += dirty * CONTINUATION_WEIGHTS.dirtyPerFile;
  score += staged * CONTINUATION_WEIGHTS.stagedPerFile;
  score += recentCommits * CONTINUATION_WEIGHTS.recentCommit;
  score += openTodos * CONTINUATION_WEIGHTS.openTodo;
  score += recencyScore(latestActivityAt, windowFrom, windowTo);

  // Partial failures still rank for attention via NeedsAttention; mild bump here
  if (!repo.ok) score += 50;

  const evidence: StandupEvidenceRef[] = [];
  if (repo.snapshot) {
    evidence.push({
      kind: 'snapshot',
      id: repo.snapshot.id,
      repositoryId: repo.repositoryId,
      observedAt: repo.snapshot.capturedAt,
    });
  }
  for (const e of repo.events.slice(-3)) {
    evidence.push({
      kind: 'event',
      id: e.eventId,
      repositoryId: repo.repositoryId,
      observedAt: e.observedAt,
    });
  }

  const reason = buildReason(signals);
  if (!reason || reason.trim().length === 0) {
    throw new Error('continuation reason must be non-empty');
  }

  return {
    repositoryId: repo.repositoryId,
    score,
    reason,
    evidence,
    signals,
  };
}

/**
 * Rank repositories for Continue section. Deterministic; capped.
 */
export function rankContinuations(
  repos: readonly RepoFacts[],
  windowFrom: string,
  windowTo: string,
  cap: number = CONTINUATION_CAP,
): ContinuationCandidate[] {
  const ranked = repos
    .filter((r) => r.ok || r.snapshot !== undefined)
    .map((r) => scoreRepository(r, windowFrom, windowTo))
    // Only surface candidates with some signal OR any activity
    .filter(
      (r) =>
        r.score > 0 ||
        r.signals.dirty > 0 ||
        r.signals.staged > 0 ||
        r.signals.recentCommits > 0 ||
        r.signals.openTodos > 0 ||
        r.signals.unfinishedOp !== undefined ||
        r.signals.failingHealth > 0 ||
        r.signals.conflicts > 0 ||
        r.signals.latestActivityAt !== undefined,
    );

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.repositoryId.localeCompare(b.repositoryId);
  });

  return ranked.slice(0, cap).map((r, index) => ({
    repositoryId: r.repositoryId,
    reason: r.reason,
    rank: index + 1,
    evidence: r.evidence,
  }));
}
