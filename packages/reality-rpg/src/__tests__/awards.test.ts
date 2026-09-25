import { describe, it, expect } from 'vitest';
import { awardId, computeAwards } from '../domain/awards.ts';
import { ruleMatches } from '../domain/matching.ts';
import { observed, rule, UTC } from './fixtures.ts';

const empty = { alreadyAwarded: new Set<string>(), dailyCounts: new Map<string, number>(), timeZone: UTC };

describe('matching', () => {
  const audit = observed({ type: 'action_executed', stream: 'audit', module: 'standup', actionId: 'standup.generate', status: 'success' });
  it('needs the type, and every optional field that is set', () => {
    expect(ruleMatches({ types: ['action_executed'] }, audit)).toBe(true);
    expect(ruleMatches({ types: ['other'] }, audit)).toBe(false);
    expect(ruleMatches({ types: ['action_executed'], stream: 'dev' }, audit)).toBe(false);
    expect(ruleMatches({ types: ['action_executed'], module: 'standup' }, audit)).toBe(true);
    expect(ruleMatches({ types: ['action_executed'], actionIds: ['standup.generate'] }, audit)).toBe(true);
    expect(ruleMatches({ types: ['action_executed'], actionIds: ['backup.create'] }, audit)).toBe(false);
    expect(ruleMatches({ types: ['action_executed'], status: 'failed' }, audit)).toBe(false);
    expect(ruleMatches({ types: ['action_executed'], actionIds: ['x'] }, observed({ type: 'action_executed', actionId: null }))).toBe(false);
  });
});

describe('computeAwards', () => {
  it('awards each matching event once per rule, with a deterministic id', () => {
    const events = [observed(), observed()];
    const awards = computeAwards([rule()], events, empty);
    expect(awards.map((a) => a.id)).toEqual(events.map((e) => awardId('commit-observed', e.id)));
    expect(awards[0]).toMatchObject({ xp: 5, stat: 'Craft', ruleVersion: 1, localDay: '2026-06-01', eventType: 'dev.commit.observed' });
  });

  it('is idempotent: the same events again, duplicated or reordered, award nothing new', () => {
    const events = [observed(), observed(), observed()];
    const first = computeAwards([rule()], events, empty);
    const ledger = new Set(first.map((a) => a.id));
    expect(computeAwards([rule()], events, { ...empty, alreadyAwarded: ledger })).toEqual([]);
    expect(computeAwards([rule()], [...events, ...events].reverse(), { ...empty, alreadyAwarded: ledger })).toEqual([]);
    // Duplicates within one batch count once too.
    expect(computeAwards([rule()], [events[0]!, events[0]!], empty)).toHaveLength(1);
  });

  it('two rules can each award for the same event', () => {
    const e = observed();
    const awards = computeAwards([rule(), rule({ id: 'second', award: { xp: 1, stat: 'Focus' } })], [e], empty);
    expect(awards.map((a) => a.ruleId).sort()).toEqual(['commit-observed', 'second']);
  });

  it('respects enabled and effectiveFromSeq - no retroactive awards', () => {
    const early = observed({ seq: 10 });
    const late = observed({ seq: 20 });
    expect(computeAwards([rule({ enabled: false })], [late], empty)).toEqual([]);
    expect(computeAwards([rule({ effectiveFromSeq: 15 })], [early, late], empty).map((a) => a.eventSeq)).toEqual([20]);
  });

  it('caps awards per local day, counting what the ledger already holds', () => {
    const day1 = Array.from({ length: 5 }, () => observed({ occurredAt: '2026-06-01T09:00:00.000Z' }));
    const day2 = [observed({ occurredAt: '2026-06-02T09:00:00.000Z' })];
    const capped = rule({ dailyCap: 3 });
    expect(computeAwards([capped], [...day1, ...day2], empty)).toHaveLength(4);
    const already = new Map([['commit-observed|2026-06-01', 2]]);
    expect(computeAwards([capped], day1, { ...empty, dailyCounts: already })).toHaveLength(1);
  });

  it('caps by the local day, not the UTC day', () => {
    // 23:30 and 00:30 in Kolkata are different local days, but the same UTC day.
    const a = observed({ occurredAt: '2026-06-01T18:00:00.000Z' }); // 23:30 IST, June 1
    const b = observed({ occurredAt: '2026-06-01T19:00:00.000Z' }); // 00:30 IST, June 2
    const awards = computeAwards([rule({ dailyCap: 1 })], [a, b], { ...empty, timeZone: 'Asia/Kolkata' });
    expect(awards.map((x) => x.localDay)).toEqual(['2026-06-01', '2026-06-02']);
  });

  it('skips events with an unreadable time rather than guessing a day', () => {
    expect(computeAwards([rule()], [observed({ occurredAt: 'not a date' })], empty)).toEqual([]);
  });
});
