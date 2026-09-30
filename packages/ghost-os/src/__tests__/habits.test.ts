import { describe, expect, it } from 'vitest';
import { CONFIDENCE, HABIT_LOOKBACK_DAYS, HABIT_THRESHOLDS, detectHabits, detectTimeOfDay, detectWeeklyRhythm, habitSourceRef, partOfDay, type ActivitySample } from '../domain/index.ts';

const NOW = '2026-06-30T12:00:00.000Z'; // a Tuesday, ISO week 2026-W27
const ctx = { now: NOW, timeZone: 'UTC', subject: 'commits' };

/** One sample `daysAgo` days before NOW at the given UTC time. */
function at(daysAgo: number, hhmm: string, id = `obs_d${daysAgo}h${hhmm.replace(':', '')}`): ActivitySample {
  const day = new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return { observationId: id, at: `${day}T${hhmm}:00.000Z` };
}

describe('time-of-day habit', () => {
  it('needs 8 active days: 7 evenings are not a habit, 8 are', () => {
    const seven = Array.from({ length: 7 }, (_, i) => at(i, '19:00'));
    expect(detectTimeOfDay(seven, ctx)).toBeNull();
    const eight = [...seven, at(7, '19:00')];
    const h = detectTimeOfDay(eight, ctx);
    expect(h).toMatchObject({ detectorId: 'time_of_day', subject: 'commits', title: 'Commits mostly in the evening', cadence: 'daily' });
    expect(h?.confidence).toBe(CONFIDENCE.habitCeiling);
    expect(h?.derivedFrom.length).toBe(8);
  });

  it('needs 60% of active days in one part of the day', () => {
    const sixOfTen = [...Array.from({ length: 6 }, (_, i) => at(i, '19:00')), ...Array.from({ length: 4 }, (_, i) => at(10 + i, '08:00'))];
    const h = detectTimeOfDay(sixOfTen, ctx);
    expect(h?.confidence).toBe(0.6);
    expect(h?.parameters).toEqual({ partOfDay: 'evening', days: 6, activeDays: 10, windowDays: 30 });
    // Only the evening observations are its evidence.
    expect(h?.derivedFrom.every((id) => id.endsWith('h1900'))).toBe(true);

    const fiveOfTen = [...Array.from({ length: 5 }, (_, i) => at(i, '19:00')), ...Array.from({ length: 5 }, (_, i) => at(10 + i, '08:00'))];
    expect(detectTimeOfDay(fiveOfTen, ctx)).toBeNull();
  });

  it('counts days, not commits, and only inside the 30-day window', () => {
    const manyInOneDay = Array.from({ length: 50 }, (_, i) => at(0, '19:00', `obs_many${i}`));
    expect(detectTimeOfDay(manyInOneDay, ctx)).toBeNull();
    const old = Array.from({ length: 8 }, (_, i) => at(HABIT_THRESHOLDS.timeOfDay.windowDays + i, '19:00'));
    expect(detectTimeOfDay(old, ctx)).toBeNull();
  });

  it('uses the local time zone', () => {
    const lateUtc = Array.from({ length: 8 }, (_, i) => at(i + 1, '23:30'));
    expect(detectTimeOfDay(lateUtc, ctx)?.parameters.partOfDay).toBe('night');
    expect(detectTimeOfDay(lateUtc, { ...ctx, timeZone: 'Asia/Tokyo' })?.parameters.partOfDay).toBe('morning');
  });

  it('ignores unreadable times instead of failing', () => {
    const samples = [...Array.from({ length: 8 }, (_, i) => at(i, '19:00')), { observationId: 'obs_bad', at: 'not a time' }];
    expect(detectTimeOfDay(samples, ctx)?.derivedFrom).not.toContain('obs_bad');
  });

  it('parts of the day', () => {
    expect([4, 5, 11, 12, 16, 17, 21, 22].map(partOfDay)).toEqual(['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night']);
  });
});

describe('weekly-rhythm habit', () => {
  /** `days` active days in each of the 8 full weeks before this one. */
  const weeks = (perWeek: number[]) =>
    perWeek.flatMap((n, w) => {
      // NOW is a Tuesday: 8 days back is the Monday of last week.
      const monday = 8 + 7 * w;
      return Array.from({ length: n }, (_, d) => at(monday - d, '10:00'));
    });

  it('three steady days a week is a habit', () => {
    const h = detectWeeklyRhythm(weeks([3, 3, 3, 3, 3, 3, 3, 3]), ctx);
    expect(h).toMatchObject({ detectorId: 'weekly_rhythm', title: 'Commits on about 3 days a week', cadence: 'weekly', periodKey: '2026-W27' });
    expect(h?.confidence).toBe(CONFIDENCE.habitCeiling);
    expect(h?.derivedFrom.length).toBe(24);
  });

  it('two days a week is not', () => {
    expect(detectWeeklyRhythm(weeks([2, 2, 2, 2, 2, 2, 2, 2]), ctx)).toBeNull();
  });

  it('an unsteady rhythm is not, even with a high median', () => {
    expect(detectWeeklyRhythm(weeks([1, 6, 1, 6, 1, 6, 1, 6]), ctx)).toBeNull();
    // 6 of 8 weeks within one day of the median is steady enough.
    const h = detectWeeklyRhythm(weeks([4, 4, 5, 3, 4, 4, 0, 0]), ctx);
    expect(h?.parameters).toEqual({ medianDays: 4, stableWeeks: 6, weeks: 8 });
    expect(h?.confidence).toBe(0.75);
  });

  it('ignores this week and anything older than eight weeks', () => {
    const thisWeek = [at(0, '10:00'), at(1, '10:00')];
    const ancient = Array.from({ length: 30 }, (_, i) => at(70 + i, '10:00'));
    const h = detectWeeklyRhythm([...weeks([3, 3, 3, 3, 3, 3, 3, 3]), ...thisWeek, ...ancient], ctx);
    expect(h?.derivedFrom.length).toBe(24);
  });
});

describe('detectHabits', () => {
  it('finds nothing in nothing, and never a habit without evidence', () => {
    expect(detectHabits([], ctx)).toEqual([]);
    const found = detectHabits(Array.from({ length: 60 }, (_, i) => at(i, '19:00')), ctx);
    expect(found.map((h) => h.detectorId).sort()).toEqual(['time_of_day', 'weekly_rhythm']);
    for (const h of found) {
      expect(h.derivedFrom.length).toBeGreaterThan(0);
      expect(h.confidence).toBeLessThanOrEqual(CONFIDENCE.habitCeiling);
    }
  });

  it('a habit keeps its identity when its numbers change', () => {
    const a = detectTimeOfDay(Array.from({ length: 8 }, (_, i) => at(i, '19:00')), ctx);
    const b = detectTimeOfDay(Array.from({ length: 12 }, (_, i) => at(i, '19:00')), ctx);
    expect(a && habitSourceRef(a)).toBe(b && habitSourceRef(b));
  });
});

describe('lookback', () => {
  it('covers every detector window: older observations cannot change a result', () => {
    expect(HABIT_LOOKBACK_DAYS).toBeGreaterThanOrEqual(HABIT_THRESHOLDS.timeOfDay.windowDays + 1);
    // Eight full weeks before this one, plus this one, plus a day for time zones.
    expect(HABIT_LOOKBACK_DAYS).toBeGreaterThanOrEqual((HABIT_THRESHOLDS.weeklyRhythm.weeks + 1) * 7 + 1);
  });
});
