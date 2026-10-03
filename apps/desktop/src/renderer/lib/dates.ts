// One way to write a date, on every screen: "3 Oct 2026", and with a time
// "3 Oct 2026, 15:50". Day first, month as a word, so it cannot be misread as
// month/day, and never the raw 2026-10-03 the data is stored in.
//
// The day is the one in the stored instant's UTC form, which is what the
// modules that use this already showed as YYYY-MM-DD; only the wording
// changes here. Screens that know a timezone (Today, from the Standup report)
// format in it themselves.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const UNKNOWN_DATE = "unknown date";

/** YYYY-MM-DD of an instant or of a day already written that way; null when it is neither. */
export function dayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

/** "3 Oct 2026" from an instant or a YYYY-MM-DD day. */
export function dayLabel(value: string | null | undefined): string {
  const key = dayKey(value);
  if (!key) return UNKNOWN_DATE;
  const [year, month, day] = key.split("-").map(Number);
  const name = MONTHS[(month ?? 0) - 1];
  return name ? `${day} ${name} ${year}` : UNKNOWN_DATE;
}

/** "3 Oct 2026, 15:50" from an instant. */
export function dayTimeLabel(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) return UNKNOWN_DATE;
  const iso = new Date(time).toISOString();
  return `${dayLabel(iso)}, ${iso.slice(11, 16)}`;
}
