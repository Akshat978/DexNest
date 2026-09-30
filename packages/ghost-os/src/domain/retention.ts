/**
 * How much of its own bookkeeping GhostOS keeps. Only bookkeeping: the run
 * log and GhostOS's own events. Entities, relations and observations are
 * the owner's model and are never pruned - only forget removes them.
 */

export const RETENTION = {
  /** Newest runs kept in ghost_runs. */
  maxRuns: 500,
  /** Days of `ghost` stream events kept in the shared event log. */
  eventDays: 180,
} as const;

/** Events that happened before this are pruned. */
export function eventCutoff(now: string): string {
  return new Date(Date.parse(now) - RETENTION.eventDays * 86_400_000).toISOString();
}
