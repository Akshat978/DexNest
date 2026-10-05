// What you did in DexNest, by weekday and hour, for the Heatmap.
//
// The Heatmap shows which windows were in front. This is the other half: the
// things you set off in DexNest itself, counted from the event log that every
// action already writes to. It is worked out when the Heatmap asks for it and
// kept nowhere; only counts leave this file, never what an event was about.
//
// Electron-free: main.ts hands in the events.

export interface OverlayEvent {
  /** When it was recorded, ISO. */
  at: string;
  /** Where it came from: the window, the command bar, voice, a hotkey, the system… */
  source: string | null;
  module: string | null;
}

export interface ActivityOverlay {
  /** Seven rows, Monday first; twenty-four columns, midnight first. */
  grid: number[][];
  total: number;
  /** The busiest modules, most first. */
  byModule: Array<{ module: string; count: number }>;
  days: number;
  /** True when the log held more events in the period than were read, so the counts are a floor. */
  partial: boolean;
}

export const OVERLAY_DAYS = 28;
export const OVERLAY_READ_LIMIT = 5000;

/** Sources that are you doing something, as against DexNest doing something by itself. */
const BY_HAND = new Set(["module_ui", "command", "voice", "keyboard_shortcut", "deck", "stream_deck_http", "phone_pwa", "companion", "routine"]);

export function isByHand(source: string | null | undefined): boolean {
  return typeof source === "string" && BY_HAND.has(source);
}

/** Monday = 0 … Sunday = 6, and the hour, where this computer is. */
export function localSlot(iso: string): { day: number; hour: number } | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return { day: (date.getDay() + 6) % 7, hour: date.getHours() };
}

/**
 * Counts the events of the last `days` that were set off by hand. `events`
 * is newest first, as the log returns them; `limit` is how many were asked
 * for, to tell a full read from a cut-off one.
 */
export function buildActivityOverlay(
  events: readonly OverlayEvent[],
  now: Date,
  options: { days?: number; limit?: number; slot?: (iso: string) => { day: number; hour: number } | null } = {}
): ActivityOverlay {
  const days = options.days ?? OVERLAY_DAYS;
  const slot = options.slot ?? localSlot;
  const since = now.getTime() - days * 86_400_000;
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const modules = new Map<string, number>();
  let total = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const time = Date.parse(event.at);
    if (!Number.isFinite(time)) continue;
    oldest = Math.min(oldest, time);
    if (time < since || time > now.getTime() || !isByHand(event.source)) continue;
    const where = slot(event.at);
    if (!where || where.day < 0 || where.day > 6 || where.hour < 0 || where.hour > 23) continue;
    grid[where.day]![where.hour]! += 1;
    total += 1;
    const module = event.module?.trim() || "DexNest";
    modules.set(module, (modules.get(module) ?? 0) + 1);
  }
  const byModule = [...modules.entries()].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count || a.module.localeCompare(b.module)).slice(0, 6);
  // Every event asked for came back and the oldest of them is still inside the period: there were more.
  const partial = options.limit !== undefined && events.length >= options.limit && oldest >= since;
  return { grid, total, byModule, days, partial };
}
