/**
 * The only inference GhostOS makes. PLAN.md section 9.
 *
 * Detectors read activity samples (a time and the observation it came from)
 * and either find a habit - with the observations that support it as its
 * evidence - or find nothing. Thresholds are fixed and documented; below
 * them there is no habit, however close.
 */

import { CONFIDENCE } from './confidence.ts';
import { addDays, isoWeekOfDay, localDay, localHour, partOfDay, PARTS_OF_DAY, type PartOfDay } from './time.ts';
import type { HabitCadence } from './types.ts';

export interface ActivitySample {
  observationId: string;
  at: string;
}

export interface DetectedHabit {
  detectorId: HabitDetectorId;
  /** What the habit is about; with detectorId, the habit's stable identity. */
  subject: string;
  title: string;
  cadence: HabitCadence;
  confidence: number;
  parameters: Record<string, number | string>;
  /** The observations it counted, sorted. Never empty. */
  derivedFrom: string[];
  /** The detection period, for the event's idempotency key. */
  periodKey: string;
}

export const HABIT_DETECTORS = ['time_of_day', 'weekly_rhythm'] as const;
export type HabitDetectorId = (typeof HABIT_DETECTORS)[number];

/** How far back any detector looks, with room for the current week and time zones. */
export const HABIT_LOOKBACK_DAYS = 70;

export const HABIT_THRESHOLDS = {
  timeOfDay: { windowDays: 30, minActiveDays: 8, minShare: 0.6 },
  weeklyRhythm: { weeks: 8, minMedianDays: 3, minStableWeeks: 6, tolerance: 1 },
} as const;

export interface DetectContext {
  now: string;
  timeZone: string;
  /** e.g. "commits"; appears in the title and the habit's identity. */
  subject: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const capped = (n: number) => Math.min(CONFIDENCE.habitCeiling, round2(n));

interface DaySample {
  day: string;
  part: PartOfDay;
  observationId: string;
}

function localise(samples: ActivitySample[], timeZone: string): DaySample[] {
  const out: DaySample[] = [];
  for (const s of samples) {
    const day = localDay(s.at, timeZone);
    const hour = localHour(s.at, timeZone);
    if (day === null || hour === null) continue;
    out.push({ day, part: partOfDay(hour), observationId: s.observationId });
  }
  return out;
}

/** "Commits most evenings": in the last 30 days, >= 8 active days, >= 60% of them in one part of the day. */
export function detectTimeOfDay(samples: ActivitySample[], ctx: DetectContext): DetectedHabit | null {
  const { windowDays, minActiveDays, minShare } = HABIT_THRESHOLDS.timeOfDay;
  const today = localDay(ctx.now, ctx.timeZone);
  if (today === null) return null;
  const first = addDays(today, -(windowDays - 1));
  const inWindow = localise(samples, ctx.timeZone).filter((s) => s.day >= first && s.day <= today);

  const activeDays = new Set(inWindow.map((s) => s.day));
  if (activeDays.size < minActiveDays) return null;

  let best: { part: PartOfDay; days: number } | null = null;
  for (const part of PARTS_OF_DAY) {
    const days = new Set(inWindow.filter((s) => s.part === part).map((s) => s.day)).size;
    if (!best || days > best.days) best = { part, days };
  }
  if (!best) return null;
  const share = best.days / activeDays.size;
  if (share < minShare) return null;

  const part = best.part;
  return {
    detectorId: 'time_of_day',
    subject: ctx.subject,
    title: `${capitalise(ctx.subject)} mostly in the ${part}`,
    cadence: 'daily',
    confidence: capped(share),
    parameters: { partOfDay: part, days: best.days, activeDays: activeDays.size, windowDays },
    derivedFrom: uniqueSorted(inWindow.filter((s) => s.part === part).map((s) => s.observationId)),
    periodKey: today,
  };
}

/** "Commits on about N days a week": over the last 8 full ISO weeks, median >= 3 active days, and stable. */
export function detectWeeklyRhythm(samples: ActivitySample[], ctx: DetectContext): DetectedHabit | null {
  const { weeks, minMedianDays, minStableWeeks, tolerance } = HABIT_THRESHOLDS.weeklyRhythm;
  const today = localDay(ctx.now, ctx.timeZone);
  if (today === null) return null;
  const currentWeek = isoWeekOfDay(today);

  const weekKeys: string[] = [];
  for (let k = 1; weekKeys.length < weeks; k++) {
    const week = isoWeekOfDay(addDays(today, -7 * k));
    if (week !== currentWeek && !weekKeys.includes(week)) weekKeys.push(week);
  }

  const days = new Map<string, Set<string>>(weekKeys.map((w) => [w, new Set<string>()]));
  const counted: string[] = [];
  for (const s of localise(samples, ctx.timeZone)) {
    const set = days.get(isoWeekOfDay(s.day));
    if (!set) continue;
    set.add(s.day);
    counted.push(s.observationId);
  }

  const perWeek = weekKeys.map((w) => days.get(w)?.size ?? 0);
  const sorted = [...perWeek].sort((a, b) => a - b);
  const median = Math.floor(((sorted[weeks / 2 - 1] ?? 0) + (sorted[weeks / 2] ?? 0)) / 2);
  if (median < minMedianDays) return null;
  const stable = perWeek.filter((n) => Math.abs(n - median) <= tolerance).length;
  if (stable < minStableWeeks) return null;

  return {
    detectorId: 'weekly_rhythm',
    subject: ctx.subject,
    title: `${capitalise(ctx.subject)} on about ${median} days a week`,
    cadence: 'weekly',
    confidence: capped(stable / weeks),
    parameters: { medianDays: median, stableWeeks: stable, weeks },
    derivedFrom: uniqueSorted(counted),
    periodKey: currentWeek,
  };
}

export function detectHabits(samples: ActivitySample[], ctx: DetectContext): DetectedHabit[] {
  return [detectTimeOfDay(samples, ctx), detectWeeklyRhythm(samples, ctx)].filter((h): h is DetectedHabit => h !== null);
}

/** The habit's stable reference: re-detection updates the same habit. */
export const habitSourceRef = (h: Pick<DetectedHabit, 'detectorId' | 'subject'>) => `${h.detectorId}:${h.subject}`;

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}
