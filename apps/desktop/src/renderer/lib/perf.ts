// Records the most recent module-switch render time (to first paint) so it can
// be shown in Settings diagnostics / App Health. Module-level + subscribe so it
// never causes the whole App to re-render on every measurement.
export interface PerfStats {
  lastModule: string;
  lastModuleSwitchMs: number | null;
  worstModuleSwitchMs: number | null;
  lastDataLoadModule: string;
  lastDataLoadMs: number | null;
  lastTotalReadyMs: number | null;
  slowModuleWarning: string | null;
}

let perfStats: PerfStats = {
  lastModule: "",
  lastModuleSwitchMs: null,
  worstModuleSwitchMs: null,
  lastDataLoadModule: "",
  lastDataLoadMs: null,
  lastTotalReadyMs: null,
  slowModuleWarning: null
};
const perfListeners = new Set<() => void>();

export function getPerfStats(): PerfStats { return perfStats; }
export function subscribePerf(listener: () => void): () => void { perfListeners.add(listener); return () => perfListeners.delete(listener); }
function emitPerf(): void { for (const listener of perfListeners) { listener(); } }

// firstPaintMs is approximated by the module-switch time (request → painted frame).
export function recordModuleSwitch(view: string, ms: number): void {
  const rounded = Math.round(ms);
  perfStats = {
    ...perfStats,
    lastModule: view,
    lastModuleSwitchMs: rounded,
    worstModuleSwitchMs: Math.max(rounded, perfStats.worstModuleSwitchMs ?? 0)
  };
  emitPerf();
}

// Records how long a module's heavy data took to load (off the first-paint path)
// and the total ready time; warns if a module took over 1000ms end-to-end.
export function recordModuleDataLoaded(view: string, dataMs: number, totalMs: number): void {
  const data = Math.round(dataMs);
  const total = Math.round(totalMs);
  perfStats = {
    ...perfStats,
    lastDataLoadModule: view,
    lastDataLoadMs: data,
    lastTotalReadyMs: total,
    slowModuleWarning: total > 1000 ? `${view} took ${total}ms to load` : perfStats.slowModuleWarning
  };
  emitPerf();
}
