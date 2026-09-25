import { describe, it, expect } from 'vitest';
import {
  resolveWindow,
  startOfLocalDay,
  localDateString,
  timezoneOffsetMs,
} from '../windows.js';

describe('window resolution', () => {
  it('first report (no prior → 24h lookback window)', () => {
    const now = new Date('2026-09-20T18:00:00.000Z');
    const w = resolveWindow(
      { window: { kind: 'since_last_standup' } },
      { now, timezone: 'America/Regina', latestSuccessfulReport: null },
    );
    expect(w.kind).toBe('since_last_standup');
    expect(w.to).toBe('2026-09-20T18:00:00.000Z');
    expect(w.from).toBe('2026-09-19T18:00:00.000Z');
    expect(w.timezone).toBe('America/Regina');
  });

  it('since-last (window starts at previous report\'s to)', () => {
    const now = new Date('2026-09-22T15:00:00.000Z');
    const prev = {
      id: 'r1',
      occurrenceId: 'occ1',
      triggerKind: 'scheduled' as const,
      generatedAt: '2026-09-21T14:00:00.000Z',
      timeWindow: {
        kind: 'since_last_standup' as const,
        from: '2026-09-20T14:00:00.000Z',
        to: '2026-09-21T14:30:00.000Z',
        timezone: 'UTC',
      },
      schemaVersion: 1,
      sections: [],
      items: [],
    };
    const w = resolveWindow(
      {},
      { now, timezone: 'UTC', latestSuccessfulReport: prev },
    );
    // Anchored at timeWindow.to, NOT generatedAt
    expect(w.from).toBe('2026-09-21T14:30:00.000Z');
    expect(w.to).toBe('2026-09-22T15:00:00.000Z');
  });

  it('missed days (prev report 4 days ago → window spans 4 days)', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    const prev = {
      id: 'r1',
      occurrenceId: 'occ1',
      triggerKind: 'scheduled' as const,
      generatedAt: '2026-09-20T12:00:00.000Z',
      timeWindow: {
        kind: 'since_last_standup' as const,
        from: '2026-09-19T12:00:00.000Z',
        to: '2026-09-20T12:00:00.000Z',
        timezone: 'UTC',
      },
      schemaVersion: 1,
      sections: [],
      items: [],
    };
    const w = resolveWindow(
      { window: { kind: 'since_last_standup' } },
      { now, timezone: 'UTC', latestSuccessfulReport: prev },
    );
    expect(w.from).toBe('2026-09-20T12:00:00.000Z');
    expect(w.to).toBe('2026-09-24T12:00:00.000Z');
    const spanMs =
      new Date(w.to).getTime() - new Date(w.from).getTime();
    expect(spanMs).toBe(4 * 24 * 60 * 60 * 1000);
  });

  it('today across midnight in America/Regina (UTC-6 fixed)', () => {
    // 2026-09-20 02:30 UTC = 2026-09-19 20:30 America/Regina
    const beforeMidnightUtc = new Date('2026-09-20T02:30:00.000Z');
    const startRegina = startOfLocalDay(beforeMidnightUtc, 'America/Regina');
    expect(localDateString(beforeMidnightUtc, 'America/Regina')).toBe(
      '2026-09-19',
    );
    // Local midnight Sep 19 Regina = 2026-09-19T06:00:00.000Z
    expect(startRegina.toISOString()).toBe('2026-09-19T06:00:00.000Z');

    const w = resolveWindow(
      { window: { kind: 'today' } },
      {
        now: beforeMidnightUtc,
        timezone: 'America/Regina',
        latestSuccessfulReport: null,
      },
    );
    expect(w.from).toBe('2026-09-19T06:00:00.000Z');
    expect(w.to).toBe(beforeMidnightUtc.toISOString());

    // After local midnight
    const after = new Date('2026-09-20T06:30:00.000Z'); // 00:30 Regina Sep 20
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

  it('today across DST boundary in America/New_York', () => {
    // US DST 2026: spring forward March 8, 2026 02:00 → 03:00 local
    // Pick a time after spring forward: 2026-03-09 15:00 New York (EDT = UTC-4)
    const edt = new Date('2026-03-09T19:00:00.000Z'); // 15:00 EDT
    expect(localDateString(edt, 'America/New_York')).toBe('2026-03-09');
    const start = startOfLocalDay(edt, 'America/New_York');
    // Local midnight EDT = 04:00 UTC
    expect(start.toISOString()).toBe('2026-03-09T04:00:00.000Z');

    // Before spring forward: 2026-03-07 15:00 EST (UTC-5)
    const est = new Date('2026-03-07T20:00:00.000Z'); // 15:00 EST
    const startEst = startOfLocalDay(est, 'America/New_York');
    expect(startEst.toISOString()).toBe('2026-03-07T05:00:00.000Z');

    // Offsets differ across DST
    const offEdt = timezoneOffsetMs(edt, 'America/New_York');
    const offEst = timezoneOffsetMs(est, 'America/New_York');
    expect(offEdt).not.toBe(offEst);
  });

  it('custom validation rejects missing bounds and from>=to', () => {
    const now = new Date('2026-09-20T12:00:00.000Z');
    expect(() =>
      resolveWindow(
        { window: { kind: 'custom' } },
        { now, timezone: 'UTC', latestSuccessfulReport: null },
      ),
    ).toThrow(/custom window requires both/);

    expect(() =>
      resolveWindow(
        {
          window: {
            kind: 'custom',
            from: '2026-09-20T12:00:00.000Z',
            to: '2026-09-20T11:00:00.000Z',
          },
        },
        { now, timezone: 'UTC', latestSuccessfulReport: null },
      ),
    ).toThrow(/from < to/);
  });

  it('last_24_hours and last_3_days rolling', () => {
    const now = new Date('2026-09-20T12:00:00.000Z');
    const h24 = resolveWindow(
      { window: { kind: 'last_24_hours' } },
      { now, timezone: 'UTC', latestSuccessfulReport: null },
    );
    expect(h24.from).toBe('2026-09-19T12:00:00.000Z');
    const d3 = resolveWindow(
      { window: { kind: 'last_3_days' } },
      { now, timezone: 'UTC', latestSuccessfulReport: null },
    );
    expect(d3.from).toBe('2026-09-17T12:00:00.000Z');
  });
});
