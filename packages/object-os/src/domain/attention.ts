/**
 * "Needs attention": due and overdue maintenance, warranties ending or
 * ended, parts at or below their low-stock threshold. Computed on demand
 * from rows the caller loaded; ids and states only - never names, serials
 * or prices, so the result can go into a notification as counts.
 */

import { dueStatus, type DueStatus } from './maintenance.ts';
import { daysBetween } from './time.ts';
import type { MaintenanceEntry, Measurement, ObjectRecord, Part, Purchase, Schedule } from './types.ts';

export const WARRANTY_ENDING_DAYS = 30;

export type WarrantyState = 'none' | 'active' | 'ending' | 'expired';

/** `until` is the last covered day (YYYY-MM-DD). */
export function warrantyState(until: string | null, now: string): { state: WarrantyState; daysLeft: number | null } {
  if (!until) return { state: 'none', daysLeft: null };
  const daysLeft = daysBetween(now.slice(0, 10) + 'T00:00:00.000Z', `${until}T00:00:00.000Z`);
  if (daysLeft < 0) return { state: 'expired', daysLeft };
  return { state: daysLeft <= WARRANTY_ENDING_DAYS ? 'ending' : 'active', daysLeft };
}

export function isLowStock(part: Pick<Part, 'quantity' | 'lowStockAt'>): boolean {
  return part.lowStockAt !== null && part.quantity <= part.lowStockAt;
}

/** Objects that no longer need looking after. */
const RETIRED = new Set(['sold', 'disposed']);

export type AttentionItem =
  | { kind: 'maintenance'; objectId: string; scheduleId: string; status: Exclude<DueStatus, { state: 'ok' | 'no_reading' | 'inactive' }> }
  | { kind: 'warranty'; objectId: string; state: 'ending' | 'expired'; daysLeft: number }
  | { kind: 'stock'; partId: string; quantity: number; lowStockAt: number };

export interface AttentionSummary {
  items: AttentionItem[];
  counts: { overdue: number; dueSoon: number; warrantyEnding: number; lowStock: number };
}

export interface AttentionInput {
  objects: readonly Pick<ObjectRecord, 'id' | 'status'>[];
  schedules: readonly Schedule[];
  log: readonly MaintenanceEntry[];
  readings: readonly Measurement[];
  purchases: readonly Purchase[];
  parts: readonly Part[];
  now: string;
}

export function attention(input: AttentionInput): AttentionSummary {
  const live = new Set(input.objects.filter((o) => !RETIRED.has(o.status)).map((o) => o.id));
  const items: AttentionItem[] = [];
  const counts = { overdue: 0, dueSoon: 0, warrantyEnding: 0, lowStock: 0 };

  for (const s of input.schedules) {
    if (!live.has(s.objectId)) continue;
    const status = dueStatus(s, input.log, input.readings, input.now);
    if (status.state === 'overdue' || status.state === 'due_soon') {
      items.push({ kind: 'maintenance', objectId: s.objectId, scheduleId: s.id, status });
      if (status.state === 'overdue') counts.overdue += 1;
      else counts.dueSoon += 1;
    }
  }
  for (const p of input.purchases) {
    if (!live.has(p.objectId)) continue;
    const w = warrantyState(p.warrantyUntil, input.now);
    // Only recently expired ones need attention; an old expiry is just history.
    if (w.state === 'ending' || (w.state === 'expired' && (w.daysLeft ?? 0) >= -WARRANTY_ENDING_DAYS)) {
      items.push({ kind: 'warranty', objectId: p.objectId, state: w.state, daysLeft: w.daysLeft ?? 0 });
      counts.warrantyEnding += 1;
    }
  }
  for (const part of input.parts) {
    if (isLowStock(part)) {
      items.push({ kind: 'stock', partId: part.id, quantity: part.quantity, lowStockAt: part.lowStockAt as number });
      counts.lowStock += 1;
    }
  }
  const rank = (i: AttentionItem) => (i.kind === 'maintenance' ? (i.status.state === 'overdue' ? 0 : 2) : i.kind === 'warranty' ? 1 : 3);
  items.sort((a, b) => rank(a) - rank(b));
  return { items, counts };
}
