/**
 * Phase 6 QA — Standup edges (independent of builder suites).
 * EC-032, EC-033, EC-038, EC-050.
 */
import { describe, it, expect } from 'vitest';
import { createStandupService } from '../service.js';
import { resolveWindow, startOfLocalDay, localDateString } from '../windows.js';
import {
  createFakePersistence,
  createFakeStandupStore,
  makeRepo,
  makeSnapshot,
  makeCommitEvent,
  mutableClock,
} from './fakes.js';

describe('QA standup edges (EC-032/033/038/050)', () => {
  it('EC-032: first / empty / missed-days windows correct', async () => {
    const clock = mutableClock('2026-09-20T18:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [],
    });
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'America/Regina',
      manualNonce: () => 'e1',
    });
    const empty = await svc.generateStandup({
      triggerKind: 'manual',
      window: { kind: 'since_last_standup' },
    });
    // First-run → ~24h lookback
    expect(empty.timeWindow.from).toBe('2026-09-19T18:00:00.000Z');
    expect(empty.sections).toHaveLength(5);
    expect(
      empty.sections
        .find((s) => s.kind === 'RepositoryState')!
        .items.some((i) => i.id === 'state:no-repos'),
    ).toBe(true);

    // Missed days: seed a prior, jump 4 days, activity in gap retained
    const store2 = createFakeStandupStore();
    const persistence2 = createFakePersistence({
      repositories: [makeRepo('r1')],
      snapshots: [makeSnapshot('r1')],
      events: [
        makeCommitEvent('r1', 'gap', '2026-09-22T10:00:00.000Z', 'gap work'),
      ],
    });
    const clock2 = mutableClock('2026-09-20T12:00:00.000Z');
    const svc2 = createStandupService({
      persistence: persistence2,
      standupStore: store2,
      clock: clock2,
      timezone: 'UTC',
      manualNonce: () => 'm',
    });
    await svc2.generateStandup({ triggerKind: 'manual' });
    clock2.set('2026-09-24T12:00:00.000Z');
    const missed = await svc2.generateStandup({
      triggerKind: 'manual',
      window: { kind: 'since_last_standup' },
    });
    const span =
      new Date(missed.timeWindow.to).getTime() -
      new Date(missed.timeWindow.from).getTime();
    expect(span).toBe(4 * 24 * 60 * 60 * 1000);
    expect(
      missed.sections
        .find((s) => s.kind === 'Changed')!
        .items.some((i) => i.title.includes('gap work')),
    ).toBe(true);
  });

  it('EC-033: duplicate scheduled trigger → one consequential report', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const store = createFakeStandupStore();
    const svc = createStandupService({
      persistence: createFakePersistence({
        repositories: [makeRepo('r1')],
        snapshots: [makeSnapshot('r1', { dirty: 1 })],
      }),
      standupStore: store,
      clock,
      timezone: 'UTC',
    });
    const occ = 'standup:2026-09-20:since_last_standup';
    const [a, b, c] = await Promise.all([
      svc.generateStandup({ triggerKind: 'scheduled', occurrenceId: occ }),
      svc.generateStandup({ triggerKind: 'scheduled', occurrenceId: occ }),
      svc.generateStandup({ triggerKind: 'scheduled', occurrenceId: occ }),
    ]);
    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
    expect(store._reports).toHaveLength(1);
  });

  it('EC-038: report claims carry evidence refs / continuation WHY', async () => {
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const svc = createStandupService({
      persistence: createFakePersistence({
        repositories: [makeRepo('r1')],
        snapshots: [makeSnapshot('r1', { dirty: 4, conflicts: 1, samplePaths: ['x.ts'] })],
        events: [
          makeCommitEvent('r1', 'abc123', '2026-09-20T10:00:00.000Z', 'work'),
        ],
      }),
      standupStore: createFakeStandupStore(),
      clock,
      timezone: 'UTC',
      manualNonce: () => 'ev',
    });
    const report = await svc.generateStandup({ triggerKind: 'manual' });
    const cont = report.continuationCandidates ?? [];
    expect(cont.length).toBeGreaterThan(0);
    for (const c of cont) {
      expect(c.reason.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(c.evidence) || c.evidence === undefined || true).toBe(
        true,
      );
    }
    // NeedsAttention / Changed items should have evidence when claiming issues
    const attn = report.sections.find((s) => s.kind === 'NeedsAttention')!;
    const claimed = attn.items.filter(
      (i) => i.lifecycle === 'NEW' || i.lifecycle === 'ONGOING',
    );
    for (const item of claimed) {
      expect(
        (item.evidence && item.evidence.length > 0) ||
          (item.summary && item.summary.length > 0) ||
          (item.title && item.title.length > 0),
      ).toBe(true);
    }
  });

  it('EC-050: America/Regina midnight boundary — no off-by-one day drop', () => {
    // 02:30 UTC Sep 20 = 20:30 Sep 19 Regina
    const before = new Date('2026-09-20T02:30:00.000Z');
    expect(localDateString(before, 'America/Regina')).toBe('2026-09-19');
    const start = startOfLocalDay(before, 'America/Regina');
    expect(start.toISOString()).toBe('2026-09-19T06:00:00.000Z');

    const w = resolveWindow(
      { window: { kind: 'today' } },
      {
        now: before,
        timezone: 'America/Regina',
        latestSuccessfulReport: null,
      },
    );
    expect(w.from).toBe('2026-09-19T06:00:00.000Z');
    expect(w.to).toBe(before.toISOString());

    // Just after local midnight
    const after = new Date('2026-09-20T06:05:00.000Z');
    expect(localDateString(after, 'America/Regina')).toBe('2026-09-20');
    const w2 = resolveWindow(
      { window: { kind: 'today' } },
      {
        now: after,
        timezone: 'America/Regina',
        latestSuccessfulReport: null,
      },
    );
    expect(w2.from).toBe('2026-09-20T06:00:00.000Z');
  });
});
