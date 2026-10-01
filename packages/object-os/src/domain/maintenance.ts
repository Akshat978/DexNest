/**
 * When maintenance is due. Computed on demand, never stored.
 *
 * Everything counts from the **last completion**: the newest log entry for
 * the schedule. Before the first completion a time schedule counts from its
 * start and a usage schedule from its start reading (or the counter's first
 * reading).
 *
 * - time:  due at base + interval; "due soon" from DUE_SOON_DAYS before.
 * - usage: used = latest reading - base reading; due at `every`; "due soon"
 *          when what is left is at most USAGE_DUE_SOON_SHARE of `every`.
 *          No reading yet means nothing is known: never due.
 */

import { addInterval, daysBetween } from './time.ts';
import type { MaintenanceEntry, Measurement, Schedule } from './types.ts';

export const DUE_SOON_DAYS = 14;
export const USAGE_DUE_SOON_SHARE = 0.1;

export type DueState = 'ok' | 'due_soon' | 'overdue' | 'no_reading' | 'inactive';

export type DueStatus =
  | { state: 'inactive' }
  | { state: 'no_reading'; measurementKey: string }
  | { state: 'ok' | 'due_soon' | 'overdue'; kind: 'time'; dueAt: string; daysLeft: number; lastDoneAt: string | null }
  | { state: 'ok' | 'due_soon' | 'overdue'; kind: 'usage'; dueAtReading: number; latestReading: number; left: number; lastDoneAt: string | null };

/** The newest completion of this schedule, or null. */
export function lastCompletion(scheduleId: string, log: readonly MaintenanceEntry[]): MaintenanceEntry | null {
  let best: MaintenanceEntry | null = null;
  for (const e of log) if (e.scheduleId === scheduleId && (!best || e.doneAt > best.doneAt || (e.doneAt === best.doneAt && e.id > best.id))) best = e;
  return best;
}

/** The newest reading of a key for an object, or null. */
export function latestReading(objectId: string, key: string, readings: readonly Measurement[]): Measurement | null {
  let best: Measurement | null = null;
  for (const m of readings) if (m.objectId === objectId && m.key === key && (!best || m.measuredAt > best.measuredAt || (m.measuredAt === best.measuredAt && m.id > best.id))) best = m;
  return best;
}

function firstReading(objectId: string, key: string, readings: readonly Measurement[]): Measurement | null {
  let best: Measurement | null = null;
  for (const m of readings) if (m.objectId === objectId && m.key === key && (!best || m.measuredAt < best.measuredAt || (m.measuredAt === best.measuredAt && m.id < best.id))) best = m;
  return best;
}

/**
 * The counter value usage is measured from:
 * - after a completion: the reading recorded with it, else the last reading
 *   taken at or before it, else the latest reading (as if just done);
 * - before any: the schedule's start reading, else the first reading ever.
 */
function usageBase(schedule: Schedule, last: MaintenanceEntry | null, readings: readonly Measurement[], latest: Measurement): number {
  const key = schedule.rule.kind === 'usage' ? schedule.rule.measurementKey : '';
  if (last) {
    if (last.usageReading !== null) return last.usageReading;
    let before: Measurement | null = null;
    for (const m of readings) {
      if (m.objectId !== schedule.objectId || m.key !== key || m.measuredAt > last.doneAt) continue;
      if (!before || m.measuredAt > before.measuredAt) before = m;
    }
    return before?.value ?? latest.value;
  }
  return schedule.startReading ?? firstReading(schedule.objectId, key, readings)?.value ?? latest.value;
}

export function dueStatus(schedule: Schedule, log: readonly MaintenanceEntry[], readings: readonly Measurement[], now: string): DueStatus {
  if (!schedule.active) return { state: 'inactive' };
  const last = lastCompletion(schedule.id, log);
  const lastDoneAt = last?.doneAt ?? null;

  if (schedule.rule.kind === 'time') {
    const base = last?.doneAt ?? schedule.startsAt;
    const dueAt = addInterval(base, schedule.rule.every, schedule.rule.unit);
    const daysLeft = daysBetween(now, dueAt);
    const state = now >= dueAt ? 'overdue' : daysLeft < DUE_SOON_DAYS ? 'due_soon' : 'ok';
    return { state, kind: 'time', dueAt, daysLeft, lastDoneAt };
  }

  const { measurementKey, every } = schedule.rule;
  const latest = latestReading(schedule.objectId, measurementKey, readings);
  if (!latest) return { state: 'no_reading', measurementKey };
  const base = usageBase(schedule, last, readings, latest);
  const dueAtReading = base + every;
  const left = dueAtReading - latest.value;
  const state = left <= 0 ? 'overdue' : left <= every * USAGE_DUE_SOON_SHARE ? 'due_soon' : 'ok';
  return { state, kind: 'usage', dueAtReading, latestReading: latest.value, left, lastDoneAt };
}
