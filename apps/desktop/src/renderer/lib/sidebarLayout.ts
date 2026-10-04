// The sidebar as the owner arranged it: which modules show, in what order, and
// which are tucked away under "Hidden". Pure: the shell renders what this
// returns and saves what it is handed back.
//
// Hiding is not disabling. A hidden module is still reached from the Hidden
// group, the command bar, hotkeys and voice. Settings can never be hidden, so
// nobody can hide the way back.

export interface SidebarPrefs {
  /** Module ids in the owner's order. A module not listed keeps its default place. */
  order: string[];
  hidden: string[];
}

export const EMPTY_SIDEBAR_PREFS: SidebarPrefs = { order: [], hidden: [] };

/** Views that always stay in the rail. */
export const NEVER_HIDDEN: readonly string[] = ["settings"];

interface ViewLike {
  id: string;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && /^[a-z][a-z0-9_-]{0,39}$/.test(item) && !out.includes(item)) out.push(item);
  }
  return out.slice(0, 100);
}

/** Whatever was saved, as prefs: unknown shapes become "no preference". */
export function normalizeSidebarPrefs(raw: unknown): SidebarPrefs {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { order: strings(value.order), hidden: strings(value.hidden).filter((id) => !NEVER_HIDDEN.includes(id)) };
}

/**
 * The rail, top to bottom, and the hidden group. A module the saved order
 * does not mention (one added after the order was saved) goes after the module
 * that precedes it by default, so it lands where it would have been.
 */
export function arrangeSidebar<T extends ViewLike>(views: readonly T[], prefs: SidebarPrefs): { shown: T[]; hidden: T[] } {
  const byId = new Map(views.map((v) => [v.id, v]));
  const ordered: T[] = [];
  for (const id of prefs.order) {
    const view = byId.get(id);
    if (view && !ordered.includes(view)) ordered.push(view);
  }
  if (ordered.length === 0) ordered.push(...views);
  else {
    views.forEach((view, index) => {
      if (ordered.includes(view)) return;
      // After the nearest earlier default neighbour that is already placed; at the top if none is.
      let at = 0;
      for (let i = index - 1; i >= 0; i -= 1) {
        const found = ordered.indexOf(views[i]!);
        if (found >= 0) {
          at = found + 1;
          break;
        }
      }
      ordered.splice(at, 0, view);
    });
  }
  const hiddenIds = new Set(prefs.hidden.filter((id) => !NEVER_HIDDEN.includes(id)));
  return { shown: ordered.filter((v) => !hiddenIds.has(v.id)), hidden: ordered.filter((v) => hiddenIds.has(v.id)) };
}

/** Moves a shown module one place up (-1) or down (1). At an end, nothing changes. */
export function moveSidebarView<T extends ViewLike>(views: readonly T[], prefs: SidebarPrefs, id: string, by: -1 | 1): SidebarPrefs {
  const { shown, hidden } = arrangeSidebar(views, prefs);
  const from = shown.findIndex((v) => v.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= shown.length) return prefs;
  const next = [...shown];
  [next[from], next[to]] = [next[to]!, next[from]!];
  // Hidden modules keep their place at the end of the saved order: they come back where the owner left the rail.
  return { order: [...next, ...hidden].map((v) => v.id), hidden: prefs.hidden };
}

export function setSidebarHidden(prefs: SidebarPrefs, id: string, hidden: boolean): SidebarPrefs {
  if (NEVER_HIDDEN.includes(id)) return prefs;
  const without = prefs.hidden.filter((x) => x !== id);
  return { order: prefs.order, hidden: hidden ? [...without, id] : without };
}

export const canHide = (id: string): boolean => !NEVER_HIDDEN.includes(id);
