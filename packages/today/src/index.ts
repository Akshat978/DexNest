// One day, assembled from every source DexNest has.
//
// THE ONE RULE
//
// Nothing in this file may learn where an item came from beyond a label. No
// `htmlLink`, no `organizer`, no `hangoutLink`, no `recurringEventId` — none of
// the forty fields Google returns and none of the different forty Outlook
// returns. An item is a title, a when, a source label, and whether it needs
// something from you.
//
// That is not tidiness. DexNest's calendar is local today and will be fed by
// Google and then Outlook later. If this model is shaped around whichever
// provider arrives first, the second one rewrites the model — and every screen
// built on it, on two platforms. Kept neutral, a new provider is a new value
// in `source.label` and nothing else changes.
//
// WHY TIMES ARE WALL-CLOCK STRINGS
//
// "09:00", not an instant. The desktop knows the operator's timezone; the
// phone should not have to agree with it. Converting on the desktop means the
// two surfaces cannot disagree about what time something is — a class at nine
// is at nine, and a phone that had to work that out from a UTC instant plus a
// zone is a phone that will eventually be an hour wrong on the one morning it
// matters.

export type AgendaKind = "event" | "block" | "nudge";

export interface AgendaSource {
  /** Stable identifier, e.g. "dexnest.calendar", later "google:work". */
  id: string;
  /** What a person should see, e.g. "Calendar" or "Google · work". */
  label: string;
}

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  title: string;
  /** Local wall-clock "HH:MM", or null for something with no particular time. */
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  source: AgendaSource;
  /** One line of extra context, or null. Never a wall of provider metadata. */
  detail: string | null;
  /**
   * Whether this wants a decision rather than merely wanting to be known.
   *
   * The distinction the phone renders differently, and the reason nudges are
   * in the same list as events rather than in a separate one: at 8am you want
   * one ordered day, not three lists to reconcile.
   */
  needsAction: boolean;
  /** Free-form, source-defined: "planned", "done", "open", "snoozed". */
  status: string | null;
  accent: string | null;
}

export interface TodayAgenda {
  /** The local date this describes, YYYY-MM-DD. */
  date: string;
  items: AgendaItem[];
  counts: { events: number; blocks: number; nudges: number; needsAction: number };
  generatedAt: string;
}

// --- what the builder is given ----------------------------------------------
//
// Deliberately narrow views of the desktop's records: only the fields this
// model uses. Widening them is how provider detail leaks in one field at a
// time, each addition individually reasonable.

export interface EventInput {
  id: string;
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
  sourceModule: string;
  notes?: string | null;
  color?: string | null;
  reminderLevel?: "soft" | "normal" | "urgent";
}

export interface BlockInput {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  title: string;
  category?: string;
  accent?: string;
  notes?: string;
  status?: string;
  statusDate?: string | null;
}

export interface NudgeInput {
  id: string;
  title: string;
  message: string;
  date: string;
  time?: string | null;
  priority: string;
  status: string;
  snoozeUntil?: string | null;
  sourceModule?: string;
}

export interface AgendaRequest {
  /** The local date to build, YYYY-MM-DD. */
  date: string;
  /** Which weekday that date is, lowercase. The caller knows the locale. */
  weekday: string;
  events: readonly EventInput[];
  blocks: readonly BlockInput[];
  nudges: readonly NudgeInput[];
  /** ISO timestamp, for staleness on the phone. */
  now: string;
}

const CALENDAR: AgendaSource = { id: "dexnest.calendar", label: "Calendar" };
const TIMETABLE: AgendaSource = { id: "dexnest.timetable", label: "Timetable" };
const NUDGES: AgendaSource = { id: "dexnest.nudges", label: "Nudge" };

/** "HH:MM" from anything that starts with one, else null. */
function clockTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Ordering: all-day first, then by time, then untimed.
 *
 * All-day at the top because it frames the day rather than occupying a slot in
 * it. Untimed last because an item with no time cannot claim a position among
 * items that have one — putting it at 00:00 would state something false.
 */
function compare(a: AgendaItem, b: AgendaItem): number {
  const rank = (item: AgendaItem) => (item.allDay ? 0 : item.startTime ? 1 : 2);
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  if (a.startTime && b.startTime && a.startTime !== b.startTime) {
    return a.startTime < b.startTime ? -1 : 1;
  }
  // Stable within a slot: action first, then title, so two runs of the same
  // data produce the same list and a screen does not reshuffle on refresh.
  if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export function buildAgenda(input: AgendaRequest): TodayAgenda {
  const items: AgendaItem[] = [];

  for (const event of input.events) {
    if (event.date !== input.date) continue;
    items.push({
      id: `event:${event.id}`,
      kind: "event",
      title: event.title,
      startTime: event.allDay ? null : clockTime(event.startTime),
      endTime: event.allDay ? null : clockTime(event.endTime),
      allDay: event.allDay,
      // sourceModule is carried into the label rather than into a field of its
      // own, so a Google-backed event needs no new shape — only a new label.
      source: event.sourceModule && event.sourceModule !== "calendar"
        ? { id: `dexnest.${event.sourceModule}`, label: titleCase(event.sourceModule) }
        : CALENDAR,
      detail: event.notes?.trim() || null,
      needsAction: false,
      status: null,
      accent: event.color ?? null
    });
  }

  for (const block of input.blocks) {
    if (block.day !== input.weekday) continue;
    // A block's done/skipped mark belongs to the day it was set on. Showing
    // yesterday's "done" against today's block would quietly tell the operator
    // they had already finished something they have not started.
    const status = block.statusDate === input.date ? block.status ?? "planned" : "planned";
    items.push({
      id: `block:${block.id}`,
      kind: "block",
      title: block.title,
      startTime: clockTime(block.startTime),
      endTime: clockTime(block.endTime),
      allDay: false,
      source: TIMETABLE,
      detail: block.notes?.trim() || block.category?.trim() || null,
      needsAction: false,
      status,
      accent: block.accent ?? null
    });
  }

  for (const nudge of input.nudges) {
    if (nudge.date !== input.date) continue;
    // A completed or dismissed nudge is not part of today any more, and a
    // snoozed one is explicitly "not now" — showing it anyway would make the
    // snooze button a lie.
    if (nudge.status === "done" || nudge.status === "completed" || nudge.status === "dismissed") continue;
    const snoozedPast = nudge.snoozeUntil ? Date.parse(nudge.snoozeUntil) > Date.parse(input.now) : false;
    if (snoozedPast) continue;

    items.push({
      id: `nudge:${nudge.id}`,
      kind: "nudge",
      title: nudge.title,
      startTime: clockTime(nudge.time),
      endTime: null,
      allDay: false,
      source: NUDGES,
      detail: nudge.message?.trim() || null,
      needsAction: true,
      status: nudge.status,
      accent: null
    });
  }

  items.sort(compare);

  return {
    date: input.date,
    items,
    counts: {
      events: items.filter(item => item.kind === "event").length,
      blocks: items.filter(item => item.kind === "block").length,
      nudges: items.filter(item => item.kind === "nudge").length,
      needsAction: items.filter(item => item.needsAction).length
    },
    generatedAt: input.now
  };
}

const titleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).replace(/[_-]+/g, " ");

/** The weekday name the timetable uses, from a local Date. */
export function weekdayOf(date: Date): string {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()]!;
}

/**
 * Today's local date as YYYY-MM-DD.
 *
 * Built from the local parts rather than toISOString(), which converts to UTC
 * first and therefore names yesterday for anyone west of Greenwich for part of
 * every evening. The same trap the attention engine's quiet hours had.
 */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
