/**
 * Placing a day's events on a time grid.
 *
 * A list only has to decide an order. A grid has to decide where each event
 * starts, how tall it is, and what to do when three of them claim the same
 * hour - and getting the last one wrong means events drawn on top of each
 * other, which reads as a missing appointment rather than as a layout bug.
 *
 * Pure, and shared by the week and day views so the two cannot disagree about
 * where the same 3pm meeting sits.
 */

export interface TimedEvent {
  id: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
}

export interface PlacedEvent<T> {
  event: T;
  /** Fractions of the day, 0 at midnight and 1 at the end of it. */
  top: number;
  height: number;
  /** Fractions of the column's width, for events sharing an hour. */
  left: number;
  width: number;
}

/** Minutes past midnight, or null for anything that is not "HH:MM". */
export function minutesOf(time: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const DAY_MINUTES = 24 * 60;
/** Below this an event is unreadable and unclickable, so it is drawn taller. */
export const MIN_EVENT_MINUTES = 20;

/**
 * The span an event occupies, in minutes past midnight.
 *
 * An event with no end is given an hour, matching what gets sent to Google. An
 * end at or before the start is treated as a missing end rather than drawn as
 * a zero-height sliver that cannot be clicked.
 */
export function spanOf(event: TimedEvent): { start: number; end: number } | null {
  const start = minutesOf(event.startTime);
  if (start === null) return null;
  const rawEnd = minutesOf(event.endTime);
  const end = rawEnd !== null && rawEnd > start ? rawEnd : start + 60;
  return { start, end: Math.min(end, DAY_MINUTES) };
}

/**
 * Lays out one day's timed events.
 *
 * Events that overlap in time are placed side by side, each taking an equal
 * share of the width. The share is computed per cluster of transitively
 * overlapping events rather than for the day as a whole: one busy hour in the
 * morning should not make every event in the day a quarter as wide.
 *
 * All-day events are not laid out here. They belong in their own row above the
 * grid, because an event with no time has no position on a time axis and
 * stretching it over the whole column would claim it fills the day.
 */
export function layoutDay<T extends TimedEvent>(events: readonly T[]): Array<PlacedEvent<T>> {
  const timed = events
    .filter(event => !event.allDay)
    .map(event => ({ event, span: spanOf(event) }))
    .filter((entry): entry is { event: T; span: { start: number; end: number } } => entry.span !== null)
    // Longest first within the same start, so a two-hour block is the left
    // column and the short things inside it sit to its right - which is how a
    // person reads a containing block.
    .sort((left, right) => left.span.start - right.span.start || (right.span.end - right.span.start) - (left.span.end - left.span.start));

  const placed: Array<PlacedEvent<T>> = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // Greedy column assignment: an event takes the first column whose last
    // occupant has finished. Two events that merely touch - one ending at
    // 10:00 and one starting at 10:00 - share a column rather than splitting
    // the width, since they do not actually overlap.
    const columnEnds: number[] = [];
    const columnOf = new Map<string, number>();
    for (const entry of cluster) {
      let column = columnEnds.findIndex(end => end <= entry.span.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(entry.span.end);
      } else {
        columnEnds[column] = entry.span.end;
      }
      columnOf.set(entry.event.id, column);
    }

    const columns = columnEnds.length;
    for (const entry of cluster) {
      const column = columnOf.get(entry.event.id) ?? 0;
      // Drawn at least MIN_EVENT_MINUTES tall. A fifteen-minute standup at a
      // true height is a line too thin to read or hit.
      const height = Math.max(entry.span.end - entry.span.start, MIN_EVENT_MINUTES);
      placed.push({
        event: entry.event,
        top: entry.span.start / DAY_MINUTES,
        height: Math.min(height, DAY_MINUTES - entry.span.start) / DAY_MINUTES,
        left: column / columns,
        width: 1 / columns
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const entry of timed) {
    // A new cluster starts where nothing before it is still running. Comparing
    // against the furthest end so far, not the previous event's end: A 9-11,
    // B 9:30-10, C 10:30-11:30 all belong together even though B ends before C
    // begins.
    if (entry.span.start >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.span.end);
  }
  flush();

  return placed;
}

/** Where in the day a pointer at this fraction of the grid landed. */
export function minutesAt(fraction: number, snapMinutes = 15): number {
  const raw = Math.max(0, Math.min(1, fraction)) * DAY_MINUTES;
  const snapped = Math.round(raw / snapMinutes) * snapMinutes;
  // Never past the last slot: a drag released at the very bottom would
  // otherwise produce 24:00, which is not a time DexNest can store.
  return Math.min(snapped, DAY_MINUTES - snapMinutes);
}

/** Minutes past midnight as "HH:MM". */
export function timeOf(minutes: number): string {
  const capped = Math.max(0, Math.min(minutes, DAY_MINUTES - 1));
  return `${String(Math.floor(capped / 60)).padStart(2, "0")}:${String(capped % 60).padStart(2, "0")}`;
}

/**
 * The start and end a drag between two points describes.
 *
 * Direction-independent, and never zero-length: dragging upward is as ordinary
 * as downward, and a click that barely moves should still make an event of a
 * sensible size rather than one with no duration.
 */
export function dragToSpan(fromFraction: number, toFraction: number, snapMinutes = 15): { startTime: string; endTime: string } {
  const a = minutesAt(fromFraction, snapMinutes);
  const b = minutesAt(toFraction, snapMinutes);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const length = Math.max(end - start, snapMinutes * 2);
  return { startTime: timeOf(start), endTime: timeOf(Math.min(start + length, DAY_MINUTES - 1)) };
}
