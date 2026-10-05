// One way to write a date, on every screen: "3 Oct 2026", and with a time
// "3 Oct 2026, 15:50". Day first, month as a word, so it cannot be misread as
// month/day, and never the raw 2026-10-03 the data is stored in.
//
// The day is the one it was where you are. A commit made at nine in the
// evening in Saskatchewan is stored as three in the morning, UTC, of the next
// day; it is shown as the evening it was made.
//
// Two kinds of value are a day and not a moment, and are shown as written
// whatever the time zone:
//   - "2026-10-03", a plain day;
//   - a day picked in a form and stored as that day at exactly midnight or
//     noon UTC (GhostOS and ObjectOS store a picked day this way).
// Moving those by a time zone would turn the day you picked into the day
// before or after it.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const UNKNOWN_DATE = "unknown date";

const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A picked day as GhostOS (midnight) and ObjectOS (noon) store it. */
const DAY_STAMP = /^(\d{4}-\d{2}-\d{2})T(?:00|12):00:00(?:\.0{1,3})?Z$/;

// Kept on the global object, not in this module, so a test that renders a
// separately bundled screen (with its own copy of this file) can set it too.
const ZONE_KEY = "__dexnestDisplayTimeZone";
const shared = globalThis as { [ZONE_KEY]?: string | null };

/**
 * The time zone dates are shown in. Null means this computer's, which is what
 * the app uses; tests name one so they read the same on every machine.
 */
export function setDisplayTimeZone(timeZone: string | null): void {
  shared[ZONE_KEY] = timeZone;
}

export function displayTimeZone(): string {
  return shared[ZONE_KEY] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(time: number, timeZone: string): Record<string, string> {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, format);
  }
  const out: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(time))) out[part.type] = part.value;
  return out;
}

/** Whether a value is a day and not a moment: a plain day, or a picked day's stamp. */
export function isDayValue(value: string): boolean {
  return PLAIN_DAY.test(value) || DAY_STAMP.test(value);
}

/**
 * YYYY-MM-DD: the day as written for a day value, and for a moment the day it
 * was in `timeZone`. Null when the value is neither.
 */
export function dayKey(value: string | null | undefined, timeZone: string = displayTimeZone()): string | null {
  if (!value) return null;
  if (PLAIN_DAY.test(value)) return value;
  const stamp = DAY_STAMP.exec(value);
  if (stamp) return stamp[1]!;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const p = parts(time, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Today where you are, YYYY-MM-DD. */
export function todayKey(now: Date = new Date(), timeZone: string = displayTimeZone()): string {
  const p = parts(now.getTime(), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "3 Oct 2026" from a moment or a day. */
export function dayLabel(value: string | null | undefined, timeZone: string = displayTimeZone()): string {
  const key = dayKey(value, timeZone);
  if (!key) return UNKNOWN_DATE;
  const [year, month, day] = key.split("-").map(Number);
  const name = MONTHS[(month ?? 0) - 1];
  return name ? `${day} ${name} ${year}` : UNKNOWN_DATE;
}

/**
 * "3 Oct 2026, 15:50" for something that is known to be a moment (a commit, a
 * sync, a report): always the day and time it was where you are, even when
 * it happened at exactly noon or midnight UTC.
 */
export function momentLabel(value: string | null | undefined, timeZone: string = displayTimeZone()): string {
  const time = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) return UNKNOWN_DATE;
  const p = parts(time, timeZone);
  return `${dayLabel(`${p.year}-${p.month}-${p.day}`)}, ${p.hour}:${p.minute}`;
}

/**
 * The same for a field that may hold either a moment or a picked day (an
 * ObjectOS entry logged "now" or for an earlier day): a day value has no time
 * to show and is written as the day alone.
 */
export function dayTimeLabel(value: string | null | undefined, timeZone: string = displayTimeZone()): string {
  if (!value) return UNKNOWN_DATE;
  return isDayValue(value) ? dayLabel(value, timeZone) : momentLabel(value, timeZone);
}
