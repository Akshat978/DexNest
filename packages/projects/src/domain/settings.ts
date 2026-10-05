// Projects settings. Everything that would do work in the background is off
// by default: no fetch at startup, no scheduled fetch until the owner turns it
// on.

export type TerminalChoice = "auto" | "windows_terminal" | "powershell";
export type HomeLayout = "grid" | "list";

export interface ProjectsSettings {
  schemaVersion: 1;
  /** A branch with no commits for this many days is "stale". */
  staleDays: number;
  scheduledFetch: { enabled: boolean; intervalMinutes: number };
  /** How many projects "fetch all" fetches at once. */
  fetchConcurrency: number;
  terminal: TerminalChoice;
  /** Owner-chosen VS Code executable, when it isn't found automatically. */
  vscodePath: string | null;
  layout: HomeLayout;
  /** Folders "Import projects" last looked in, newest first, so a re-check is one click. */
  importRoots: string[];
  /**
   * The ones among them the owner asked DexNest to watch: a repository that
   * appears inside one is added as a project the next time Projects is opened
   * (or "Check now" is pressed). Never on a timer. Empty by default.
   */
  watchedRoots: string[];
  /** Repositories in a watched folder the owner removed, so they are not added back. */
  watchSkipped: string[];
}

export const MAX_IMPORT_ROOTS = 5;
export const MAX_WATCH_SKIPPED = 500;

export const SCHEDULED_FETCH_MIN_MINUTES = 15;

export const DEFAULT_PROJECTS_SETTINGS: ProjectsSettings = {
  schemaVersion: 1,
  staleDays: 30,
  scheduledFetch: { enabled: false, intervalMinutes: 30 },
  fetchConcurrency: 4,
  terminal: "auto",
  vscodePath: null,
  layout: "grid",
  importRoots: [],
  watchedRoots: [],
  watchSkipped: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** Accepts anything read back from disk; unknown or out-of-range values fall back to defaults. */
export function normaliseProjectsSettings(raw: unknown): ProjectsSettings {
  const d = DEFAULT_PROJECTS_SETTINGS;
  if (!isRecord(raw)) return { ...d, scheduledFetch: { ...d.scheduledFetch }, importRoots: [], watchedRoots: [], watchSkipped: [] };
  const fetch = isRecord(raw.scheduledFetch) ? raw.scheduledFetch : {};
  const strings = (value: unknown, max: number): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.trim()))].slice(0, max) : [];
  const importRoots = strings(raw.importRoots, MAX_IMPORT_ROOTS);
  // Only a folder that is still remembered can be watched: forgetting it stops the watching.
  const key = (path: string) => path.replace(/[\\/]+$/, "").toLowerCase();
  const remembered = new Set(importRoots.map(key));
  return {
    schemaVersion: 1,
    staleDays: intIn(raw.staleDays, 1, 3650, d.staleDays),
    scheduledFetch: {
      enabled: fetch.enabled === true,
      intervalMinutes: intIn(fetch.intervalMinutes, SCHEDULED_FETCH_MIN_MINUTES, 24 * 60, d.scheduledFetch.intervalMinutes)
    },
    fetchConcurrency: intIn(raw.fetchConcurrency, 1, 8, d.fetchConcurrency),
    terminal: raw.terminal === "windows_terminal" || raw.terminal === "powershell" ? raw.terminal : "auto",
    vscodePath: typeof raw.vscodePath === "string" && raw.vscodePath.trim() ? raw.vscodePath.trim() : null,
    layout: raw.layout === "list" ? "list" : "grid",
    importRoots,
    watchedRoots: strings(raw.watchedRoots, MAX_IMPORT_ROOTS).filter((root) => remembered.has(key(root))),
    watchSkipped: strings(raw.watchSkipped, MAX_WATCH_SKIPPED)
  };
}
