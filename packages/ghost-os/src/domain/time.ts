/**
 * Timestamps, local days, ISO weeks and parts of the day, in the time zone
 * DexNest runs in. Intl does the time-zone work (no I/O), so a day is the
 * calendar date where something happened locally, across DST changes too.
 */

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A canonical ISO timestamp (UTC, milliseconds), or null for anything else. */
export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_LIKE.test(value.trim())) return null;
  const t = Date.parse(value.trim());
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  return year < 1000 || year > 9999 ? null : d.toISOString();
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(iso: string, timeZone: string): { day: string; hour: number } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = formatter(timeZone).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/** YYYY-MM-DD in `timeZone`; null for an unparseable timestamp. */
export function localDay(iso: string, timeZone: string): string | null {
  return localParts(iso, timeZone)?.day ?? null;
}

/** 0..23 in `timeZone`; null for an unparseable timestamp. */
export function localHour(iso: string, timeZone: string): number | null {
  return localParts(iso, timeZone)?.hour ?? null;
}

export const PARTS_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const;
export type PartOfDay = (typeof PARTS_OF_DAY)[number];

/** morning 05-12, afternoon 12-17, evening 17-22, night 22-05. */
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** ISO week of a local day, e.g. "2026-W40". Weeks start on Monday. */
export function isoWeekOfDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // Thursday of this week decides the year
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The local day `n` days before `day` (calendar arithmetic, no time zone). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}
