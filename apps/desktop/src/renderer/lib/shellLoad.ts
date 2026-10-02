// Views that render only from the shell's shared state (refreshShellData),
// not from a per-view loader. When that shared load fails they used to show
// default or stale data as if it were real; they now show the same "Could not
// load this module" card, with Retry, that the per-view loaders show.

export type ShellLoad = "loading" | "ready" | "error";

export const SHELL_DATA_VIEWS: readonly string[] = ["command", "clipboard", "drop", "tools", "calendar", "timetable", "utilities", "news", "deck", "settings"];

/** What to put over the active view for the shared load: the error card, or nothing. */
export function shellLoadOverlay(view: string, load: ShellLoad): "error" | null {
  return load === "error" && SHELL_DATA_VIEWS.includes(view) ? "error" : null;
}
