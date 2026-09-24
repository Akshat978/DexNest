// What a module may ask DexNest for.
//
// Only capabilities some module demonstrably needs are here. Developer
// Intelligence and Patchwork each arrived with their own port list; most of
// those entries were either already served by something DexNest has, or
// contradicted a DexNest rule. What remains is the intersection that is
// genuinely a host concern.
//
// Deliberately absent, and why:
// - Telemetry: DexNest has none and adds none (AGENTS.md).
// - Auth / identity: DexNest has no accounts and no login.
// - Navigation: views open through registered `desktop.view.*` actions, so a
//   module that wants to navigate runs an action.
// - Theme: modules style with the design tokens in @dexnest/shared-ui; there is
//   nothing to fetch at runtime.
// - Timezone: DexNest runs on one machine; the OS zone via Intl is the answer.
// - Command palette: the palette lists the action registry, so registering an
//   action is registering a command.
// - Alternate storage roots: there is exactly one data root.

import type { SqlDatabase } from "./sql.ts";
import type { EventLog } from "./events.ts";
import type { DataBoundary } from "./boundary.ts";

/** One firing of a scheduled job. */
export interface JobOccurrence {
  /**
   * Stable for one scheduled slot. A module must treat two runs with the same
   * id as one - the host may deliver a slot twice (a resume, a manual trigger
   * racing a timer), and duplicate work must not produce duplicate results.
   */
  occurrenceId: string;
  scheduledAt: string;
  trigger: "scheduled" | "startup" | "manual";
}

export interface ScheduledJob {
  /** Unique per module, e.g. "scan". */
  id: string;
  intervalMs: number;
  /** Fire once shortly after startup as well as on the interval. */
  runAtStartup?: boolean;
  /**
   * Heavy work (walking repositories, indexing). The host skips heavy jobs
   * while Performance Mode is on, so DexNest stays idle-quiet when asked to.
   */
  heavy?: boolean;
  run(occurrence: JobOccurrence): Promise<void> | void;
}

/**
 * The host owns the clock.
 *
 * DexNest's background work already runs on main-process timers that the host
 * controls - calendar sync, timetable effects, the heatmap sampler - and the
 * host is what knows about Performance Mode, shutdown and idle CPU. A module
 * that ran its own setInterval would bypass all three. So a module declares a
 * job and exposes an idempotent entry point; the host decides when it fires.
 */
export interface ModuleScheduler {
  schedule(job: ScheduledJob): () => void;
  /** Runs a job now, outside its interval. Coalesces with a run already in flight. */
  runNow(jobId: string): Promise<void>;
}

/** Module-scoped settings, stored by the host under the data root. */
export interface ModuleSettings<T> {
  read(): T;
  write(value: T): void;
}

export interface ModuleLifecycle {
  /** Runs before DexNest quits. Keep it short: cancel, flush, record. */
  onBeforeQuit(handler: () => void | Promise<void>): () => void;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Runs a registered DexNest action.
 *
 * There is one action system - @dexnest/action-registry, with its danger
 * levels, confirmation rules and journalling. A module or widget never invents
 * a second one; it names a registered action id and asks the host to run it.
 */
export interface ModuleActions {
  run(actionId: string, params?: Record<string, unknown>): Promise<ActionResult>;
}

/** Everything a module is handed at startup. */
export interface ModuleHost<TSettings = unknown> {
  moduleId: string;
  database: SqlDatabase;
  events: EventLog;
  boundary: DataBoundary;
  scheduler: ModuleScheduler;
  settings: ModuleSettings<TSettings>;
  lifecycle: ModuleLifecycle;
  actions: ModuleActions;
}
