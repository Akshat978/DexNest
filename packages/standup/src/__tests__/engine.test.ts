import { describe, it, expect } from 'vitest';
import { createStandupService } from '../service.js';
import { rankContinuations, CONTINUATION_CAP } from '../ranking.js';
import { SECTION_ITEM_CAP } from '../sections.js';
import {
  createFakePersistence,
  createFakeStandupStore,
  makeRepo,
  makeSnapshot,
  makeCommitEvent,
  mutableClock,
} from './fakes.js';
import type { HealthCheck, HealthRun } from '@dexnest/dev-intelligence-contracts';

describe('standup engine', () => {
  it('1. first report (no prior → 24h lookback window)', async () => {
    const clock = mutableClock('2026-09-20T18:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [makeRepo('r1')],
      snapshots: [makeSnapshot('r1', { dirty: 2 })],
    });
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => 'n1',
    });
    const report = await svc.generateStandup({
      triggerKind: 'manual',
      window: { kind: 'since_last_standup' },
    });
    expect(report.timeWindow.from).toBe('2026-09-19T18:00:00.000Z');
    expect(report.timeWindow.to).toBe('2026-09-20T18:00:00.000Z');
    expect(report.previousSuccessfulReportId).toBeUndefined();
  });

  it('2. since-last (window starts at previous report\'s to)', async () => {
    const clock = mutableClock('2026-09-21T12:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [makeRepo('r1')],
      snapshots: [makeSnapshot('r1')],
    });
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => 'a',
    });
    const first = await svc.generateStandup({ triggerKind: 'manual' });
    expect(first.timeWindow.to).toBe('2026-09-21T12:00:00.000Z');

    clock.set('2026-09-22T15:00:00.000Z');
    const second = await svc.generateStandup({
      triggerKind: 'manual',
      window: { kind: 'since_last_standup' },
    });
    expect(second.timeWindow.from).toBe(first.timeWindow.to);
    expect(second.previousSuccessfulReportId).toBe(first.id);
  });

  it('3. missed days (prev 4 days ago → activity from day 2 included)', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [makeRepo('r1')],
      snapshots: [makeSnapshot('r1')],
      events: [
        // day 2 relative to first report (Sep 20): Sep 22 commit
        makeCommitEvent('r1', 'abc', '2026-09-22T10:00:00.000Z', 'day2 work'),
      ],
    });
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => 'm',
    });
    await svc.generateStandup({ triggerKind: 'manual' });

    clock.set('2026-09-24T12:00:00.000Z'); // 4 days later
    const report = await svc.generateStandup({
      triggerKind: 'manual',
      window: { kind: 'since_last_standup' },
    });
    const span =
      new Date(report.timeWindow.to).getTime() -
      new Date(report.timeWindow.from).getTime();
    expect(span).toBe(4 * 24 * 60 * 60 * 1000);
    const changed = report.sections.find((s) => s.kind === 'Changed')!;
    expect(
      changed.items.some((i) => i.title.includes('day2 work')),
    ).toBe(true);
  });

  it('4. NEW → ONGOING → RESOLVED across three reports with stable fingerprints', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const store = createFakeStandupStore();
    let conflicts = 2;
    let samplePaths = ['a.ts', 'b.ts'];

    const persistence = createFakePersistence({
      repositories: [makeRepo('r1')],
    });
    // Dynamic snapshot via mutating seed — re-save each time
    const snap = () =>
      makeSnapshot('r1', {
        conflicts,
        samplePaths,
        capturedAt: clock.now().toISOString(),
      });
    await persistence.repositories.saveSnapshot(snap());

    let nonce = 0;
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => String(++nonce),
    });

    const r1 = await svc.generateStandup({ triggerKind: 'manual' });
    const attn1 = r1.sections.find((s) => s.kind === 'NeedsAttention')!;
    const newItem = attn1.items.find((i) => i.lifecycle === 'NEW');
    expect(newItem).toBeTruthy();
    const fp = newItem!.issueIdentity!.fingerprint;

    // Same conflicts still present
    clock.set('2026-09-21T12:00:00.000Z');
    await persistence.repositories.saveSnapshot(snap());
    const r2 = await svc.generateStandup({ triggerKind: 'manual' });
    const attn2 = r2.sections.find((s) => s.kind === 'NeedsAttention')!;
    const ongoing = attn2.items.find(
      (i) =>
        i.lifecycle === 'ONGOING' && i.issueIdentity?.fingerprint === fp,
    );
    expect(ongoing).toBeTruthy();
    expect(ongoing!.summary).toMatch(/Unresolved for 1 day/);
    // Must NOT reappear as NEW
    expect(
      attn2.items.some(
        (i) =>
          i.lifecycle === 'NEW' && i.issueIdentity?.fingerprint === fp,
      ),
    ).toBe(false);

    // Conflicts cleared → RESOLVED
    conflicts = 0;
    samplePaths = [];
    clock.set('2026-09-22T12:00:00.000Z');
    await persistence.repositories.saveSnapshot(snap());
    const r3 = await svc.generateStandup({ triggerKind: 'manual' });
    const attn3 = r3.sections.find((s) => s.kind === 'NeedsAttention')!;
    const resolved = attn3.items.find(
      (i) =>
        i.lifecycle === 'RESOLVED' && i.issueIdentity?.fingerprint === fp,
    );
    expect(resolved).toBeTruthy();
  });

  it('5. duplicate scheduled trigger same occurrence → same report id (also concurrent)', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [makeRepo('r1')],
      snapshots: [makeSnapshot('r1', { dirty: 1 })],
    });
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
    });

    const occ = 'standup:2026-09-20:since_last_standup';
    const a = await svc.generateStandup({
      triggerKind: 'scheduled',
      occurrenceId: occ,
    });
    const b = await svc.generateStandup({
      triggerKind: 'scheduled',
      occurrenceId: occ,
    });
    expect(b.id).toBe(a.id);
    expect(store._reports).toHaveLength(1);

    // Concurrent duplicates
    clock.set('2026-09-21T12:00:00.000Z');
    const occ2 = 'standup:2026-09-21:since_last_standup';
    const [c, d, e] = await Promise.all([
      svc.generateStandup({ triggerKind: 'scheduled', occurrenceId: occ2 }),
      svc.generateStandup({ triggerKind: 'scheduled', occurrenceId: occ2 }),
      svc.generateStandup({ triggerKind: 'scheduled', occurrenceId: occ2 }),
    ]);
    expect(c.id).toBe(d.id);
    expect(d.id).toBe(e.id);
    expect(store._reports.filter((r) => r.occurrenceId === occ2)).toHaveLength(
      1,
    );
  });

  it('6. manual regen → new report marked manual, distinct occurrenceId', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [makeRepo('r1')],
      snapshots: [makeSnapshot('r1')],
    });
    let n = 0;
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => String(++n),
    });
    const scheduled = await svc.generateStandup({
      triggerKind: 'scheduled',
      occurrenceId: 'standup:2026-09-20:since_last_standup',
    });
    const manual = await svc.generateStandup({
      triggerKind: 'manual',
      forceNewOccurrence: true,
    });
    expect(manual.triggerKind).toBe('manual');
    expect(manual.occurrenceId).not.toBe(scheduled.occurrenceId);
    expect(manual.id).not.toBe(scheduled.id);
    expect(manual.occurrenceId.startsWith('manual:')).toBe(true);
  });

  it('7. empty report (no repos) and no-changes report', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const store = createFakeStandupStore();
    const emptyPersistence = createFakePersistence({ repositories: [] });
    const svc = createStandupService({
      persistence: emptyPersistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => 'e',
    });
    const empty = await svc.generateStandup({ triggerKind: 'manual' });
    expect(empty.sections).toHaveLength(5);
    expect(
      empty.sections
        .find((s) => s.kind === 'RepositoryState')!
        .items.some((i) => i.id === 'state:no-repos'),
    ).toBe(true);
    expect(
      empty.sections
        .find((s) => s.kind === 'Changed')!
        .items.some((i) => i.id === 'changed:no-activity'),
    ).toBe(true);

    // no-changes with a clean repo
    const store2 = createFakeStandupStore();
    const svc2 = createStandupService({
      persistence: createFakePersistence({
        repositories: [makeRepo('clean')],
        snapshots: [makeSnapshot('clean')],
      }),
      standupStore: store2,
      clock,
      timezone: 'UTC',
      manualNonce: () => 'c',
    });
    const noChange = await svc2.generateStandup({ triggerKind: 'manual' });
    expect(
      noChange.sections
        .find((s) => s.kind === 'Changed')!
        .items.some((i) => i.id === 'changed:no-activity'),
    ).toBe(true);
  });

  it('8. large report (200 repos, bounded sections, deterministic ordering)', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const repos = Array.from({ length: 200 }, (_, i) =>
      makeRepo(`repo_${String(i).padStart(3, '0')}`),
    );
    const snapshots = repos.map((r, i) =>
      makeSnapshot(r.id, { dirty: (i % 7) + 1, staged: i % 3 }),
    );
    const events = repos.flatMap((r, i) =>
      Array.from({ length: 5 }, (_, j) =>
        makeCommitEvent(
          r.id,
          `sha_${i}_${j}`,
          `2026-09-20T0${j}:00:00.000Z`,
          `c${j}`,
        ),
      ),
    );
    const store = createFakeStandupStore();
    const svc = createStandupService({
      persistence: createFakePersistence({
        repositories: repos,
        snapshots,
        events,
      }),
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => 'L',
    });

    const t0 = Date.now();
    const report = await svc.generateStandup({ triggerKind: 'manual' });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(15_000);

    for (const section of report.sections) {
      // Cap + optional overflow item
      expect(section.items.length).toBeLessThanOrEqual(SECTION_ITEM_CAP + 1);
    }
    const cont = report.continuationCandidates ?? [];
    expect(cont.length).toBeLessThanOrEqual(CONTINUATION_CAP);
    // Deterministic: same inputs → same ordering
    const report2 = await svc.generateStandup({
      triggerKind: 'manual',
      forceNewOccurrence: true,
    });
    expect(
      (report.continuationCandidates ?? []).map((c) => c.repositoryId),
    ).toEqual(
      (report2.continuationCandidates ?? []).map((c) => c.repositoryId),
    );
    // ranks ascending
    for (let i = 1; i < cont.length; i++) {
      expect(cont[i]!.rank).toBeGreaterThan(cont[i - 1]!.rank);
    }
  });

  it('9. partially failed repo shown while others render', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [makeRepo('ok'), makeRepo('bad')],
      snapshots: [makeSnapshot('ok', { dirty: 3 })],
      failingRepoIds: new Set(['bad']),
    });
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'UTC',
      manualNonce: () => 'p',
    });
    const report = await svc.generateStandup({ triggerKind: 'manual' });
    const state = report.sections.find((s) => s.kind === 'RepositoryState')!;
    expect(state.items.some((i) => i.repositoryId === 'ok')).toBe(true);
    expect(
      state.items.some(
        (i) =>
          i.repositoryId === 'bad' &&
          (i.title.includes('unavailable') || i.severity === 'warning'),
      ),
    ).toBe(true);
    const attn = report.sections.find((s) => s.kind === 'NeedsAttention')!;
    expect(
      attn.items.some(
        (i) =>
          i.repositoryId === 'bad' &&
          (i.lifecycle === 'NEW' || i.title.includes('unavailable')),
      ),
    ).toBe(true);
  });

  it('continuation reason always non-empty', () => {
    const repos = [
      {
        repositoryId: 'r1',
        ok: true,
        events: [makeCommitEvent('r1', 'x', '2026-09-20T10:00:00.000Z')],
        openTodos: [],
        resolvedTodos: [],
        healthChecks: [],
        latestHealthRuns: new Map(),
        snapshot: makeSnapshot('r1', { dirty: 6 }),
      },
    ];
    const cands = rankContinuations(
      repos,
      '2026-09-19T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
    );
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('failing health check surfaces as NeedsAttention NEW', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const check: HealthCheck = {
      schemaVersion: 1,
      id: 'hc1',
      repositoryId: 'r1',
      name: 'lint',
      enabled: true,
      cwd: '/repos/r1',
      domain: 'wsl',
      argv: ['pnpm', 'lint'],
      timeoutMs: 1000,
      maxStdoutBytes: 1000,
      maxStderrBytes: 1000,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const run: HealthRun = {
      schemaVersion: 1,
      id: 'hr1',
      healthCheckId: 'hc1',
      repositoryId: 'r1',
      status: 'FAIL',
      startedAt: '2026-09-20T11:00:00.000Z',
      finishedAt: '2026-09-20T11:00:01.000Z',
      exitCode: 1,
    };
    const svc = createStandupService({
      persistence: createFakePersistence({
        repositories: [makeRepo('r1')],
        snapshots: [makeSnapshot('r1')],
        healthChecks: [check],
        healthRuns: [run],
      }),
      standupStore: createFakeStandupStore(),
      clock,
      timezone: 'UTC',
      manualNonce: () => 'h',
    });
    const report = await svc.generateStandup({ triggerKind: 'manual' });
    const attn = report.sections.find((s) => s.kind === 'NeedsAttention')!;
    expect(
      attn.items.some(
        (i) =>
          i.lifecycle === 'NEW' &&
          i.issueIdentity?.kind === 'failing_health_check',
      ),
    ).toBe(true);
  });
});
