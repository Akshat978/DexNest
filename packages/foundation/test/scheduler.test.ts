import { strict as assert } from "node:assert";
import { test } from "node:test";

import { createHostScheduler, type SchedulerTimers } from "../src/scheduler.ts";
import type { JobOccurrence } from "../src/host.ts";

/** Timers the test advances by hand. */
function manualClock(start: number) {
  let current = start;
  let seq = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: SchedulerTimers = {
    set(callback, ms) {
      seq += 1;
      pending.set(seq, { at: current + ms, callback });
      return seq;
    },
    clear(handle) {
      pending.delete(handle as number);
    }
  };
  return {
    timers,
    now: () => current,
    pendingCount: () => pending.size,
    /** Moves time forward, firing whatever comes due, in order. */
    advance(ms: number) {
      const target = current + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        current = due[1].at;
        due[1].callback();
      }
      current = target;
    }
  };
}

const HOUR = 60 * 60 * 1000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** One slot at a time, letting each run settle - as real hours would. */
async function advanceHours(clock: ReturnType<typeof manualClock>, hours: number) {
  for (let i = 0; i < hours; i += 1) {
    clock.advance(HOUR);
    await flush();
  }
}
const T0 = Date.parse("2026-09-24T10:15:00.000Z");

test("a job fires once per slot, and the slot start is its occurrence id", async () => {
  const clock = manualClock(T0);
  const seen: JobOccurrence[] = [];
  const scheduler = createHostScheduler({ now: clock.now, timers: clock.timers });
  scheduler.schedule({ id: "scan", intervalMs: HOUR, run: (o) => { seen.push(o); } });

  await advanceHours(clock, 3);
  assert.deepEqual(
    seen.map((o) => o.occurrenceId),
    ["scan:2026-09-24T11:00:00.000Z", "scan:2026-09-24T12:00:00.000Z", "scan:2026-09-24T13:00:00.000Z"]
  );
  assert.ok(seen.every((o) => o.trigger === "scheduled"));
  await scheduler.dispose();
});

test("a startup run and the slot it lands in are delivered once", async () => {
  const clock = manualClock(Date.parse("2026-09-24T10:59:50.000Z"));
  const seen: string[] = [];
  // The startup firing lands after the 11:00 boundary; the scheduled one for
  // that same slot must not run the job a second time.
  const scheduler = createHostScheduler({ now: clock.now, timers: clock.timers, startupDelayMs: 20_000 });
  scheduler.schedule({ id: "standup", intervalMs: HOUR, runAtStartup: true, run: (o) => { seen.push(`${o.trigger} ${o.occurrenceId}`); } });

  clock.advance(HOUR);
  await flush();
  assert.deepEqual(seen, ["startup standup:2026-09-24T11:00:00.000Z"]);
  await scheduler.dispose();
});

test("paused jobs are skipped, not queued, and resume on the next slot", async () => {
  const clock = manualClock(T0);
  let paused = true;
  const seen: string[] = [];
  const skipped: string[] = [];
  const scheduler = createHostScheduler({
    now: clock.now,
    timers: clock.timers,
    isPaused: (job) => Boolean(job.heavy) && paused,
    onSkipped: (_id, o) => { skipped.push(o.occurrenceId); }
  });
  scheduler.schedule({ id: "scan", intervalMs: HOUR, heavy: true, run: (o) => { seen.push(o.occurrenceId); } });

  clock.advance(HOUR);
  await flush();
  assert.deepEqual(seen, []);
  assert.deepEqual(skipped, ["scan:2026-09-24T11:00:00.000Z"]);

  paused = false;
  clock.advance(HOUR);
  await flush();
  assert.deepEqual(seen, ["scan:2026-09-24T12:00:00.000Z"]);
  await scheduler.dispose();
});

test("a manual run joins one already in flight instead of starting another", async () => {
  const clock = manualClock(T0);
  let starts = 0;
  let release: () => void = () => {};
  const scheduler = createHostScheduler({ now: clock.now, timers: clock.timers, isPaused: () => true });
  scheduler.schedule({
    id: "scan",
    intervalMs: HOUR,
    heavy: true,
    run: () => {
      starts += 1;
      return new Promise<void>((resolve) => { release = resolve; });
    }
  });

  // Paused applies to the timer, not to the person pressing the button.
  const first = scheduler.runNow("scan");
  const second = scheduler.runNow("scan");
  assert.equal(first, second);
  await flush();
  release();
  await first;
  assert.equal(starts, 1);

  const third = scheduler.runNow("scan");
  await flush();
  release();
  await third;
  assert.equal(starts, 2);
  await scheduler.dispose();
});

test("a slot that arrives while the last run is still going joins it", async () => {
  const clock = manualClock(T0);
  let starts = 0;
  let release: () => void = () => {};
  const scheduler = createHostScheduler({ now: clock.now, timers: clock.timers });
  scheduler.schedule({
    id: "scan",
    intervalMs: HOUR,
    run: () => {
      starts += 1;
      return new Promise<void>((resolve) => { release = resolve; });
    }
  });
  // Two slots pass while the first scan is still walking repositories: heavy
  // work never overlaps itself.
  clock.advance(2 * HOUR);
  await flush();
  assert.equal(starts, 1);
  release();
  await flush();
  await advanceHours(clock, 1);
  assert.equal(starts, 2);
  release();
  await scheduler.dispose();
});

test("a failing run is reported and does not stop the schedule", async () => {
  const clock = manualClock(T0);
  const errors: string[] = [];
  let runs = 0;
  const scheduler = createHostScheduler({
    now: clock.now,
    timers: clock.timers,
    onError: (id, error) => { errors.push(`${id}: ${(error as Error).message}`); }
  });
  scheduler.schedule({ id: "scan", intervalMs: HOUR, run: () => { runs += 1; throw new Error("git missing"); } });

  await advanceHours(clock, 2);
  assert.equal(runs, 2);
  assert.deepEqual(errors, ["scan: git missing", "scan: git missing"]);
  await scheduler.dispose();
});

test("unscheduling and disposing leave no timers behind", async () => {
  const clock = manualClock(T0);
  const scheduler = createHostScheduler({ now: clock.now, timers: clock.timers });
  const stop = scheduler.schedule({ id: "a", intervalMs: HOUR, run: () => {} });
  scheduler.schedule({ id: "b", intervalMs: HOUR, run: () => {} });
  assert.equal(clock.pendingCount(), 2);
  stop();
  assert.equal(clock.pendingCount(), 1);
  assert.throws(() => scheduler.schedule({ id: "b", intervalMs: HOUR, run: () => {} }), /already scheduled/);
  await scheduler.dispose();
  assert.equal(clock.pendingCount(), 0);
  await assert.rejects(scheduler.runNow("b"), /No job "b"/);
});
