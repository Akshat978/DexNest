/**
 * A Standup reports what happened, when it happened.
 *
 * The first real run of this engine told its owner that a repository last
 * touched four months earlier had "20 commits in window", that every
 * repository was the "most recently active", and listed the branch each was
 * first seen on as a change. All three came from treating the moment a scan
 * noticed something as the moment it happened.
 */

import { describe, it, expect } from 'vitest';
import type { DeveloperEvent, ScanRun, StandupReport, TodoMarker } from '@dexnest/dev-intelligence-contracts';
import { createStandupService } from '../service.js';
import { rankContinuations, scoreRepository } from '../ranking.js';
import { collectFacts, currentRepositoryIds, eventTime, isBaseline } from '../facts.js';
import { SECTION_ITEM_CAP } from '../sections.js';
import { createFakePersistence, createFakeStandupStore, makeCommitEvent, makeRepo, makeSnapshot, mutableClock } from './fakes.js';

const NOW = '2026-09-20T18:00:00.000Z';
const BASELINE = '2026-09-20T09:00:00.000Z';

/** A commit made at `madeAt` and noticed by a scan at `seenAt`. */
function commit(repoId: string, sha: string, madeAt: string, seenAt: string, extra: Record<string, unknown> = {}): DeveloperEvent {
  return { ...makeCommitEvent(repoId, sha, seenAt, `subject ${sha}`), occurredAt: madeAt, payload: { sha, subject: `subject ${sha}`, authorDate: madeAt, ...extra } };
}

function event(repoId: string, type: DeveloperEvent['type'], id: string, seenAt: string, payload: unknown, occurredAt = seenAt): DeveloperEvent {
  return { schemaVersion: 1, eventId: id, type, repositoryId: repoId, occurredAt, observedAt: seenAt, source: 'test', sourceIdentity: 't', fingerprint: `fp_${id}`, payload };
}

function todo(repoId: string, id: string, firstObservedAt: string): TodoMarker {
  return { schemaVersion: 1, id, repositoryId: repoId, kind: 'TODO', status: 'open', filePath: 'a.ts', line: 1, text: `do ${id}`, fingerprint: `fp_${id}`, firstObservedAt, lastObservedAt: firstObservedAt };
}

async function reportFor(seed: Parameters<typeof createFakePersistence>[0]): Promise<StandupReport> {
  const svc = createStandupService({ persistence: createFakePersistence(seed), standupStore: createFakeStandupStore(), clock: mutableClock(NOW), timezone: 'UTC', manualNonce: () => 'n' });
  return svc.generateStandup({ triggerKind: 'manual' });
}

const section = (report: StandupReport, kind: string) => report.sections.find((s) => s.kind === kind)!;
const baselined = (id: string) => ({ ...makeRepo(id), baselinedAt: BASELINE });

describe('history is not news', () => {
  it('what a repository held at its first inspection is left out of Changed and of the ranking', async () => {
    const report = await reportFor({
      repositories: [baselined('r1')],
      snapshots: [makeSnapshot('r1')],
      events: [
        // Twenty old commits, all noticed by the first scan this morning.
        ...Array.from({ length: 20 }, (_, i) => commit('r1', `old${i}`, '2026-05-01T10:00:00.000Z', '2026-09-20T08:59:00.000Z', { baseline: true })),
        event('r1', 'dev.branch.changed', 'b1', '2026-09-20T08:59:00.000Z', { currentBranch: 'main' }),
      ],
      todos: [todo('r1', 't-old', '2026-09-20T08:58:00.000Z')],
    });

    const changed = section(report, 'Changed').items;
    expect(changed.map((i) => i.id)).toEqual(['changed:no-activity']);
    expect(report.continuationCandidates?.[0]?.reason ?? '').not.toMatch(/commit/);
    expect(report.diagnostics?.changedTotal).toBe(0);
  });

  it('the baseline flag alone is enough: a repository scanned before baselines existed still hides flagged history', async () => {
    const report = await reportFor({
      repositories: [makeRepo('r1')],
      snapshots: [makeSnapshot('r1')],
      events: [commit('r1', 'old', '2026-05-01T10:00:00.000Z', '2026-09-20T10:00:00.000Z', { baseline: true })],
    });
    expect(section(report, 'Changed').items.map((i) => i.id)).toEqual(['changed:no-activity']);
  });

  it('after the baseline, new work is reported with the time it was made', async () => {
    const report = await reportFor({
      repositories: [baselined('r1')],
      snapshots: [makeSnapshot('r1')],
      events: [
        commit('r1', 'old', '2026-05-01T10:00:00.000Z', '2026-09-20T08:59:00.000Z', { baseline: true }),
        // Made at 14:05, noticed by the 14:30 scan. Git's own offset form, as older rows hold it.
        commit('r1', 'new', '2026-09-20T08:05:00-06:00', '2026-09-20T14:30:00.000Z'),
      ],
      todos: [todo('r1', 't-old', '2026-09-20T08:58:00.000Z'), todo('r1', 't-new', '2026-09-20T14:30:00.000Z')],
    });

    const changed = section(report, 'Changed').items;
    expect(changed.map((i) => i.title)).toEqual(['subject new', 'New TODO: do t-new']);
    expect(changed[0]!.evidence[0]!.observedAt, 'when it was made, in UTC').toBe('2026-09-20T14:05:00.000Z');
    expect(report.continuationCandidates![0]!.reason).toBe('Most recently active repository with 1 new commit and 2 open TODOs.');
  });

  it('isBaseline: nothing is history until a baseline exists', () => {
    expect(isBaseline(undefined, '2026-01-01T00:00:00.000Z')).toBe(false);
    expect(isBaseline(BASELINE, BASELINE)).toBe(true);
    expect(isBaseline(BASELINE, '2026-09-20T09:00:00.001Z')).toBe(false);
  });
});

describe('Changed says what changed', () => {
  it('a branch row is a real switch: not a first sighting, not the same branch gaining a commit', async () => {
    const at = '2026-09-20T15:00:00.000Z';
    const report = await reportFor({
      repositories: [baselined('r1')],
      snapshots: [makeSnapshot('r1')],
      events: [
        event('r1', 'dev.branch.changed', 'first', at, { currentBranch: 'main' }),
        event('r1', 'dev.branch.changed', 'same', at, { previousBranch: 'main', currentBranch: 'main', headSha: 'abc' }),
        event('r1', 'dev.branch.changed', 'switch', at, { previousBranch: 'main', currentBranch: 'feat/x' }),
      ],
    });
    expect(section(report, 'Changed').items.map((i) => i.title)).toEqual(['Branch main → feat/x']);
  });

  it('pushes and pulls appear, at the time Git recorded them', async () => {
    const report = await reportFor({
      repositories: [baselined('r1')],
      snapshots: [makeSnapshot('r1')],
      events: [
        event('r1', 'dev.push.observed', 'p1', '2026-09-20T15:00:00.000Z', { ref: 'origin/main', sha: 'a', detail: 'update by push' }, '2026-09-20T14:40:00.000Z'),
        event('r1', 'dev.pull.observed', 'p2', '2026-09-20T15:00:00.000Z', { ref: 'main', sha: 'b', detail: 'pull: Fast-forward' }, '2026-09-20T14:10:00.000Z'),
      ],
    });
    const items = section(report, 'Changed').items;
    expect(items.map((i) => [i.id, i.title, i.evidence[0]!.observedAt])).toEqual([
      ['changed:pull:p2', 'Pulled into main', '2026-09-20T14:10:00.000Z'],
      ['changed:push:p1', 'Pushed to origin/main', '2026-09-20T14:40:00.000Z'],
    ]);
  });

  it('a capped section keeps its real total, and says how many are not shown', async () => {
    const count = SECTION_ITEM_CAP + 7;
    const report = await reportFor({
      repositories: [baselined('r1')],
      snapshots: [makeSnapshot('r1')],
      events: Array.from({ length: count }, (_, i) => commit('r1', `c${String(i).padStart(3, '0')}`, `2026-09-20T10:${String(i).padStart(2, '0')}:00.000Z`, '2026-09-20T12:00:00.000Z')),
    });
    const items = section(report, 'Changed').items;
    expect(items).toHaveLength(SECTION_ITEM_CAP + 1);
    expect(items.at(-1)).toMatchObject({ id: 'changed:overflow', title: '7 more not shown' });
    expect(report.diagnostics?.changedTotal).toBe(count);
  });
});

describe('only one repository is the most recently active', () => {
  const window = { kind: 'custom' as const, from: '2026-09-19T18:00:00.000Z', to: NOW };

  it('the one with the latest real activity is named; the rest are described by what they hold', async () => {
    const persistence = createFakePersistence({
      repositories: [baselined('a'), baselined('b'), baselined('c')],
      // Every repository is captured by the same scan, at the same moment.
      snapshots: [makeSnapshot('a', { capturedAt: '2026-09-20T17:00:00.000Z', dirty: 3 }), makeSnapshot('b', { capturedAt: '2026-09-20T17:00:00.000Z', dirty: 1 }), makeSnapshot('c', { capturedAt: '2026-09-20T17:00:00.000Z', dirty: 9 })],
      events: [commit('a', 'a1', '2026-09-20T11:00:00.000Z', '2026-09-20T17:00:00.000Z'), commit('b', 'b1', '2026-09-20T16:00:00.000Z', '2026-09-20T17:00:00.000Z')],
    });
    const facts = await collectFacts(persistence, window);
    const ranked = rankContinuations(facts.repositories, window.from, window.to);
    const reasons = Object.fromEntries(ranked.map((r) => [r.repositoryId, r.reason]));

    expect(reasons.b).toBe('Most recently active repository with 1 uncommitted change and 1 new commit.');
    expect(reasons.a).toBe('3 uncommitted changes and 1 new commit.');
    expect(reasons.c, 'being scanned is not activity').toBe('9 uncommitted changes.');
    expect(ranked.filter((r) => r.reason.startsWith('Most recently active'))).toHaveLength(1);
  });

  it('nobody is, when nothing was done anywhere', async () => {
    const persistence = createFakePersistence({
      repositories: [baselined('a'), baselined('b')],
      snapshots: [makeSnapshot('a', { capturedAt: '2026-09-20T17:00:00.000Z', dirty: 2 }), makeSnapshot('b', { capturedAt: '2026-09-20T17:00:00.000Z' })],
    });
    const facts = await collectFacts(persistence, window);
    const ranked = rankContinuations(facts.repositories, window.from, window.to);
    expect(ranked.map((r) => r.reason)).toEqual(['2 uncommitted changes.']);
    expect(scoreRepository(facts.repositories.find((r) => r.repositoryId === 'b')!, window.from, window.to).signals.latestActivityAt).toBeUndefined();
  });

  it('a repository asked about alone is not called the most recent of anything', async () => {
    const persistence = createFakePersistence({ repositories: [baselined('a')], snapshots: [makeSnapshot('a', { dirty: 2 })], events: [commit('a', 'a1', '2026-09-20T11:00:00.000Z', '2026-09-20T12:00:00.000Z')] });
    const facts = await collectFacts(persistence, window);
    expect(scoreRepository(facts.repositories[0]!, window.from, window.to).reason).toBe('2 uncommitted changes and 1 new commit.');
  });

  it('eventTime: the time Git recorded for a commit, push or pull; the scan time for the rest', () => {
    expect(eventTime(commit('a', 'x', '2026-09-20T08:05:00-06:00', '2026-09-20T15:00:00.000Z'))).toBe('2026-09-20T14:05:00.000Z');
    expect(eventTime(commit('a', 'x', 'not a date', '2026-09-20T15:00:00.000Z'))).toBe('2026-09-20T15:00:00.000Z');
    expect(eventTime(event('a', 'dev.working_tree.changed', 'w', '2026-09-20T15:00:00.000Z', {}, '2026-09-20T01:00:00.000Z'))).toBe('2026-09-20T15:00:00.000Z');
  });
});

describe('a repository no longer followed stops appearing', () => {
  const scan = (id: string, startedAt: string, state: ScanRun['state'], targets?: string[]): ScanRun => ({
    schemaVersion: 1,
    id,
    state,
    startedAt,
    repositoriesAttempted: targets?.length ?? 0,
    repositoriesSucceeded: targets?.length ?? 0,
    repositoriesFailed: 0,
    cancelRequested: false,
    ...(targets ? { targetRepositoryIds: targets } : {}),
  });

  it('the last finished scan says what is followed; an unfinished or failed one does not', () => {
    expect(currentRepositoryIds([])).toBeUndefined();
    expect(currentRepositoryIds([scan('s3', '2026-09-20T17:00:00.000Z', 'STARTED', ['a'])])).toBeUndefined();
    const ids = currentRepositoryIds([
      scan('s4', '2026-09-20T17:30:00.000Z', 'FAILED', ['a', 'b', 'c']),
      scan('s3', '2026-09-20T17:00:00.000Z', 'PARTIAL', ['a', 'b']),
      scan('s2', '2026-09-20T16:00:00.000Z', 'COMPLETED', ['a', 'b', 'c']),
    ]);
    expect([...ids!].sort()).toEqual(['a', 'b']);
  });

  it('the Standup covers what the last scan looked for, not everything ever recorded', async () => {
    const report = await reportFor({
      repositories: [baselined('kept'), baselined('archived')],
      snapshots: [makeSnapshot('kept', { dirty: 1 }), makeSnapshot('archived', { dirty: 5 })],
      scanRuns: [scan('s1', '2026-09-20T17:00:00.000Z', 'COMPLETED', ['kept'])],
    });
    expect(section(report, 'RepositoryState').items.map((i) => i.repositoryId)).toEqual(['kept']);
    expect(report.continuationCandidates!.map((c) => c.repositoryId)).toEqual(['kept']);
    expect(report.diagnostics?.repositoryCount).toBe(1);
  });

  it('before any scan has finished, every recorded repository is covered', async () => {
    const report = await reportFor({ repositories: [baselined('a'), baselined('b')], snapshots: [makeSnapshot('a'), makeSnapshot('b')] });
    expect(section(report, 'RepositoryState').items.map((i) => i.repositoryId)).toEqual(['a', 'b']);
  });
});
