/**
 * Timestamps, calendar dates and intervals. Pure: Date is used only as a
 * calculator in UTC.
 */

import type { IntervalUnit } from './types.ts';

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A canonical ISO timestamp (UTC, milliseconds), or null. A bare date is midnight UTC. */
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_LIKE.test(value.trim())) return null;
  const t = Date.parse(value.trim());
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  return year < 1900 || year > 9999 ? null : d.toISOString();
}

/** A real calendar date YYYY-MM-DD (2026-02-30 is refused), or null. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const v = value.trim();
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 1900 ? v : null;
}

/**
 * `at` plus `every` units. Months and years keep the day of the month when it
 * exists and otherwise land on the month's last day: Jan 31 + 1 month = Feb 28
 * (29 in a leap year); Feb 29 + 1 year = Feb 28.
 */
export function addInterval(at: string, every: number, unit: IntervalUnit): string {
  const d = new Date(at);
  if (unit === 'days' || unit === 'weeks') {
    d.setUTCDate(d.getUTCDate() + every * (unit === 'weeks' ? 7 : 1));
    return d.toISOString();
  }
  const months = unit === 'years' ? every * 12 : every;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (negative when `to` is earlier), rounding toward the past. */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar day (YYYY-MM-DD) an instant falls on for someone in
 * `timeZone`. "Today" for the owner is this, not the UTC day: late in the
 * evening west of UTC the two differ. Null for an unparseable timestamp.
 */
export function localDay(iso: string, timeZone: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  let f = dayFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(t));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);
}
