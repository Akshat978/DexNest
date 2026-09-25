/**
 * Turning observed events into awards.
 *
 * Idempotent by construction: an award's id is a hash of (rule, event), and
 * any pair already in `alreadyAwarded` is skipped - so replaying the same
 * events, in any order and any number of times, awards nothing new. The store
 * enforces the same thing with a unique key.
 *
 * A rule awards only when it is enabled, the event is at or after the rule's
 * effectiveFromSeq, and the rule's daily cap for that local day - counting
 * awards already in the ledger - is not yet reached.
 */

import { stableHash } from './hash.ts';
import { ruleMatches } from './matching.ts';
import { localDay } from './time.ts';
import type { Award, ObservedEvent, Rule } from './types.ts';

export function awardId(ruleId: string, eventId: string): string {
  return `aw_${stableHash(`${ruleId}\u001f${eventId}`)}`;
}

export interface AwardContext {
  /** Award ids already in the ledger. */
  alreadyAwarded: ReadonlySet<string>;
  /** Awards already in the ledger per `${ruleId}|${localDay}`. */
  dailyCounts: ReadonlyMap<string, number>;
  timeZone: string;
}

export function computeAwards(rules: readonly Rule[], events: readonly ObservedEvent[], context: AwardContext): Award[] {
  const active = rules.filter((r) => r.enabled);
  const counts = new Map(context.dailyCounts);
  const seen = new Set(context.alreadyAwarded);
  const out: Award[] = [];

  // Oldest first, so caps fill in the order things happened.
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    const day = localDay(event.occurredAt, context.timeZone);
    if (!day) continue;
    for (const rule of active) {
      if (event.seq < rule.effectiveFromSeq) continue;
      if (!ruleMatches(rule.match, event)) continue;
      const id = awardId(rule.id, event.id);
      if (seen.has(id)) continue;
      const capKey = `${rule.id}|${day}`;
      const used = counts.get(capKey) ?? 0;
      if (rule.dailyCap !== undefined && used >= rule.dailyCap) continue;
      seen.add(id);
      counts.set(capKey, used + 1);
      out.push({
        id,
        ruleId: rule.id,
        ruleVersion: rule.version,
        eventId: event.id,
        eventSeq: event.seq,
        eventType: event.type,
        actionId: event.actionId,
        occurredAt: event.occurredAt,
        localDay: day,
        xp: rule.award.xp,
        stat: rule.award.stat,
      });
    }
  }
  return out;
}
