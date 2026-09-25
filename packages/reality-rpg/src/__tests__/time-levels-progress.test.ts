import { describe, it, expect } from 'vitest';
import { isoWeekOfDay, localDay } from '../domain/time.ts';
import { characterSheet, levelFor, levelsReached } from '../domain/levels.ts';
import { LEVEL_THRESHOLDS } from '../domain/data/levels.ts';
import { awardsInPeriod, evaluateCondition, isRecurring, newUnlocks, questPeriod, questProgress } from '../domain/progress.ts';
import { normalizeRealityRpgSettings, defaultRealityRpgSettings, MIN_INTERVAL_MINUTES } from '../domain/settings.ts';
import { RPG_EVENT_NAMESPACE, RPG_EVENT_TYPES, achievementKey, levelKey, questKey, runKey } from '../domain/events.ts';
import type { Award, Quest } from '../domain/types.ts';

let seq = 0;
function award(o: Partial<Award> = {}): Award {
  seq += 1;
  return { id: `aw${seq}`, ruleId: 'r', ruleVersion: 1, eventId: `e${seq}`, eventSeq: seq, eventType: 't', actionId: null, occurredAt: '2026-06-01T10:00:00.000Z', localDay: '2026-06-01', xp: 10, stat: 'Craft', ...o };
}

describe('time', () => {
  it('local day follows the zone, across DST changes', () => {
    expect(localDay('2026-03-08T06:30:00.000Z', 'America/New_York')).toBe('2026-03-08'); // just after spring-forward
    expect(localDay('2026-03-08T04:30:00.000Z', 'America/New_York')).toBe('2026-03-07');
    expect(localDay('2026-10-25T00:30:00.000Z', 'Europe/London')).toBe('2026-10-25'); // BST, 01:30 local
    expect(localDay('2026-10-24T23:30:00.000Z', 'Europe/London')).toBe('2026-10-25');
    expect(localDay('bad', 'UTC')).toBeNull();
  });

  it('ISO weeks, including year edges', () => {
    expect(isoWeekOfDay('2026-01-01')).toBe('2026-W01'); // Thursday
    expect(isoWeekOfDay('2027-01-01')).toBe('2026-W53'); // Friday belongs to the last week of 2026
    expect(isoWeekOfDay('2026-09-28')).toBe('2026-W40'); // Monday
    expect(isoWeekOfDay('2026-10-04')).toBe('2026-W40'); // Sunday, same week
  });
});

describe('levels', () => {
  it('the curve starts at 0 and strictly increases', () => {
    expect(LEVEL_THRESHOLDS[0]).toBe(0);
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) expect(LEVEL_THRESHOLDS[i]!).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]!);
  });

  it('level and the sheet come from the awards', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(2);
    expect(levelFor(Number.MAX_SAFE_INTEGER)).toBe(LEVEL_THRESHOLDS.length);
    const sheet = characterSheet([award({ xp: 250, stat: 'Craft' }), award({ xp: 60, stat: 'Focus' })]);
    expect(sheet).toEqual({ totalXp: 310, level: 3, xpIntoLevel: 10, xpToNextLevel: 290, stats: [{ stat: 'Craft', xp: 250 }, { stat: 'Focus', xp: 60 }] });
    expect(characterSheet([]).level).toBe(1);
    expect(characterSheet([award({ xp: Number.MAX_SAFE_INTEGER })]).xpToNextLevel).toBeNull();
  });

  it('levels reached between two totals', () => {
    expect(levelsReached(90, 310)).toEqual([2, 3]);
    expect(levelsReached(310, 310)).toEqual([]);
  });
});

describe('conditions', () => {
  const awards = [award({ ruleId: 'a', localDay: '2026-06-01' }), award({ ruleId: 'a', localDay: '2026-06-01' }), award({ ruleId: 'a', localDay: '2026-06-02' }), award({ ruleId: 'b', stat: 'Focus', xp: 5 })];
  it('count, xp (optionally per stat) and distinct days', () => {
    expect(evaluateCondition({ kind: 'count', ruleIds: ['a'], target: 3 }, awards)).toEqual({ current: 3, target: 3, met: true });
    expect(evaluateCondition({ kind: 'xp', target: 100 }, awards)).toEqual({ current: 35, target: 100, met: false });
    expect(evaluateCondition({ kind: 'xp', stat: 'Focus', target: 5 }, awards)).toEqual({ current: 5, target: 5, met: true });
    expect(evaluateCondition({ kind: 'days', ruleIds: ['a'], target: 3 }, awards)).toEqual({ current: 2, target: 3, met: false });
  });

  it('achievements unlock once, naming the award that tipped them', () => {
    const defs = [{ id: 'x', name: 'X', description: 'd', condition: { kind: 'count' as const, ruleIds: ['a'], target: 2 } }];
    const unlocks = newUnlocks(defs, awards, new Set());
    expect(unlocks).toEqual([{ achievementId: 'x', tippingAwardId: awards[1]!.id }]);
    expect(newUnlocks(defs, awards, new Set(['x']))).toEqual([]);
    expect(newUnlocks(defs, awards.slice(0, 1), new Set())).toEqual([]);
  });
});

describe('quests', () => {
  const base: Quest = { id: 'q', title: 'Q', condition: { kind: 'count', ruleIds: ['r'], target: 2 }, window: { kind: 'none' }, status: 'active', createdAt: '2026-06-01T00:00:00.000Z' };
  const now = new Date('2026-06-03T12:00:00.000Z');

  it('nothing before the quest existed counts', () => {
    const before = award({ occurredAt: '2026-05-31T23:00:00.000Z' });
    const after = award({ occurredAt: '2026-06-02T10:00:00.000Z' });
    expect(awardsInPeriod(base, 'once', [before, after])).toEqual([after]);
  });

  it('daily quests count today only and recur; weekly by ISO week', () => {
    const daily: Quest = { ...base, window: { kind: 'daily' } };
    const today = [award({ occurredAt: '2026-06-03T09:00:00.000Z', localDay: '2026-06-03' }), award({ occurredAt: '2026-06-03T10:00:00.000Z', localDay: '2026-06-03' })];
    const yesterday = award({ occurredAt: '2026-06-02T09:00:00.000Z', localDay: '2026-06-02' });
    expect(questProgress(daily, [...today, yesterday], now, 'UTC')).toEqual({ current: 2, target: 2, met: true, periodKey: '2026-06-03', open: true });
    expect(isRecurring(daily)).toBe(true);
    expect(questPeriod({ ...base, window: { kind: 'weekly' } }, now, 'UTC').key).toBe('2026-W23');
    expect(isRecurring(base)).toBe(false);
  });

  it('a fixed window counts only inside it and says whether it is open', () => {
    const fixed: Quest = { ...base, window: { kind: 'fixed', from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' } };
    const inside = award({ occurredAt: '2026-06-01T12:00:00.000Z' });
    const outside = award({ occurredAt: '2026-06-02T12:00:00.000Z' });
    expect(questProgress(fixed, [inside, outside], now, 'UTC')).toMatchObject({ current: 1, open: false, periodKey: 'fixed' });
  });
});

describe('settings and event names', () => {
  it('are off by default and survive garbage', () => {
    expect(defaultRealityRpgSettings().enabled).toBe(false);
    for (const junk of [null, 'on', 42, [], { enabled: 'true', intervalMinutes: 'soon' }]) {
      expect(normalizeRealityRpgSettings(junk)).toEqual(defaultRealityRpgSettings());
    }
    expect(normalizeRealityRpgSettings({ enabled: true, intervalMinutes: 1 })).toEqual({ schemaVersion: 1, enabled: true, intervalMinutes: MIN_INTERVAL_MINUTES });
  });

  it('event types stay in the rpg namespace and keys are stable', () => {
    for (const t of RPG_EVENT_TYPES) expect(t.startsWith(`${RPG_EVENT_NAMESPACE}.`)).toBe(true);
    expect([levelKey(3), achievementKey('a'), questKey('q', '2026-06-03'), runKey('process:1')]).toEqual([
      'reality_rpg:level:3', 'reality_rpg:achievement:a', 'reality_rpg:quest:q:2026-06-03', 'reality_rpg:run:process:1',
    ]);
  });
});
