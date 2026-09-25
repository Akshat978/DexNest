// The host's scheduler: the one place module background work is timed.
//
// A module declares a job; this decides when it fires. Three properties are
// the point of having it here instead of a setInterval per module:
//
//   - Slots, not ticks. A job fires once per interval-aligned slot, and the
//     slot's start is its occurrence id. A timer that fires early, a resume
//     from sleep, a startup run landing in the same slot - each is delivered at
//     most once per slot, and the id lets the module stay idempotent anyway.
//   - One run at a time per job. A manual trigger, or a slot that comes due,
//     while a run is in flight joins that run instead of starting a second
//     walk of the same repos.
//   - The host can say no. `isPaused` is asked before every scheduled firing,
//     which is how Performance Mode keeps heavy jobs off. A manual run is the
//     user asking, so it is not paused.
//
// Nothing here touches Electron or the filesystem; the timer is injected so
// tests run without waiting.

import type { JobOccurrence, ModuleScheduler, ScheduledJob } from "./host.ts";

export interface SchedulerTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface HostSchedulerOptions {
  /** Asked before each scheduled or startup firing. */
  isPaused?(job: ScheduledJob): boolean;
  now?(): number;
  timers?: SchedulerTimers;
  /** How long after scheduling a `runAtStartup` job first fires. Default 30s. */
  startupDelayMs?: number;
  onError?(jobId: string, error: unknown): void;
  /** Told when a scheduled firing is skipped because the host paused it. */
  onSkipped?(jobId: string, occurrence: JobOccurrence): void;
}

export interface HostScheduler extends ModuleScheduler {
  /** Stops every timer and waits for runs already in flight. */
  dispose(): Promise<void>;
}

const nodeTimers: SchedulerTimers = {
  set(callback, ms) {
    const handle = setTimeout(callback, ms);
    // A pending job is never a reason to keep the process alive.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

interface Entry {
  job: ScheduledJob;
  timer?: unknown;
  lastSlot?: number;
  inFlight?: Promise<void>;
}

export function createHostScheduler(options: HostSchedulerOptions = {}): HostScheduler {
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? nodeTimers;
  const startupDelayMs = options.startupDelayMs ?? 30_000;
  const entries = new Map<string, Entry>();
  let disposed = false;

  function execute(entry: Entry, occurrence: JobOccurrence): Promise<void> {
    if (entry.inFlight) return entry.inFlight;
    // Started on a microtask, never inline: a job that throws synchronously
    // would otherwise settle before `inFlight` is assigned, and the stale
    // promise would swallow every later run.
    const run: Promise<void> = Promise.resolve()
      .then(() => entry.job.run(occurrence))
      .catch((error: unknown) => {
        options.onError?.(entry.job.id, error);
      })
      .finally(() => {
        if (entry.inFlight === run) entry.inFlight = undefined;
      });
    entry.inFlight = run;
    return run;
  }

  function fire(entry: Entry, trigger: "scheduled" | "startup"): void {
    if (disposed || entries.get(entry.job.id) !== entry) return;
    const at = now();
    const slot = Math.floor(at / entry.job.intervalMs) * entry.job.intervalMs;
    if (entry.lastSlot !== slot) {
      const occurrence: JobOccurrence = {
        occurrenceId: `${entry.job.id}:${new Date(slot).toISOString()}`,
        scheduledAt: new Date(at).toISOString(),
        trigger
      };
      if (options.isPaused?.(entry.job)) {
        options.onSkipped?.(entry.job.id, occurrence);
      } else {
        entry.lastSlot = slot;
        void execute(entry, occurrence);
      }
    }
    arm(entry);
  }

  function arm(entry: Entry): void {
    const at = now();
    const next = (Math.floor(at / entry.job.intervalMs) + 1) * entry.job.intervalMs;
    entry.timer = timers.set(() => fire(entry, "scheduled"), Math.max(1, next - at));
  }

  return {
    schedule(job) {
      if (disposed) throw new Error("The scheduler has been disposed.");
      if (!Number.isFinite(job.intervalMs) || job.intervalMs < 1000) {
        throw new Error(`Job "${job.id}" needs an interval of at least one second.`);
      }
      if (entries.has(job.id)) throw new Error(`Job "${job.id}" is already scheduled.`);
      const entry: Entry = { job };
      entries.set(job.id, entry);
      if (job.runAtStartup) {
        entry.timer = timers.set(() => fire(entry, "startup"), startupDelayMs);
      } else {
        arm(entry);
      }
      return () => {
        if (entries.get(job.id) !== entry) return;
        if (entry.timer !== undefined) timers.clear(entry.timer);
        entries.delete(job.id);
      };
    },

    runNow(jobId) {
      const entry = entries.get(jobId);
      if (!entry) return Promise.reject(new Error(`No job "${jobId}" is scheduled.`));
      const at = new Date(now()).toISOString();
      return execute(entry, { occurrenceId: `${jobId}:manual:${at}`, scheduledAt: at, trigger: "manual" });
    },

    async dispose() {
      disposed = true;
      const running: Promise<void>[] = [];
      for (const entry of entries.values()) {
        if (entry.timer !== undefined) timers.clear(entry.timer);
        if (entry.inFlight) running.push(entry.inFlight);
      }
      entries.clear();
      await Promise.all(running);
    }
  };
}
