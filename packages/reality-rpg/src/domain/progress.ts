/**
 * Achievement and quest progress, computed from the award ledger.
 *
 * Conditions are measurable and nothing else: a count of awards from named
 * rules, XP (optionally for one stat), or distinct local days with an award
 * from named rules.
 */

import { isoWeekOfDay, localDay } from './time.ts';
import type { AchievementDef, Award, Condition, Progress, Quest } from './types.ts';

type LedgerAward = Pick<Award, 'id' | 'ruleId' | 'xp' | 'stat' | 'localDay' | 'occurredAt' | 'eventSeq'>;

function counts(condition: Condition, award: LedgerAward): boolean {
  if (condition.kind === 'xp') return condition.stat === undefined || condition.stat === award.stat;
  return condition.ruleIds.includes(award.ruleId);
}

export function evaluateCondition(condition: Condition, awards: readonly LedgerAward[]): Progress {
  let current = 0;
  const days = new Set<string>();
  for (const award of awards) {
    if (!counts(condition, award)) continue;
    if (condition.kind === 'count') current += 1;
    else if (condition.kind === 'xp') current += award.xp;
    else days.add(award.localDay);
  }
  if (condition.kind === 'days') current = days.size;
  return { current, target: condition.target, met: current >= condition.target };
}

export interface Unlock {
  achievementId: string;
  /** The award at which the condition first held. */
  tippingAwardId: string;
}

/**
 * Achievements the ledger now satisfies that are not unlocked yet, each with
 * the award that tipped it (walking awards in event order).
 */
export function newUnlocks(
  achievements: readonly AchievementDef[],
  awards: readonly LedgerAward[],
  unlocked: ReadonlySet<string>,
): Unlock[] {
  const ordered = [...awards].sort((a, b) => a.eventSeq - b.eventSeq || a.id.localeCompare(b.id));
  const out: Unlock[] = [];
  for (const achievement of achievements) {
    if (unlocked.has(achievement.id)) continue;
    const c = achievement.condition;
    let current = 0;
    const days = new Set<string>();
    for (const award of ordered) {
      if (!counts(c, award)) continue;
      if (c.kind === 'count') current += 1;
      else if (c.kind === 'xp') current += award.xp;
      else {
        days.add(award.localDay);
        current = days.size;
      }
      if (current >= c.target) {
        out.push({ achievementId: achievement.id, tippingAwardId: award.id });
        break;
      }
    }
  }
  return out;
}

export interface QuestPeriod {
  /** "once", "fixed", a local day (daily) or an ISO week (weekly). */
  key: string;
  /** Whether `now` falls inside the period (a fixed window may have ended or not begun). */
  open: boolean;
}

export function questPeriod(quest: Quest, now: Date, timeZone: string): QuestPeriod {
  const today = localDay(now.toISOString(), timeZone) ?? now.toISOString().slice(0, 10);
  switch (quest.window.kind) {
    case 'none':
      return { key: 'once', open: true };
    case 'fixed': {
      const t = now.getTime();
      return { key: 'fixed', open: t >= Date.parse(quest.window.from) && t < Date.parse(quest.window.to) };
    }
    case 'daily':
      return { key: today, open: true };
    case 'weekly':
      return { key: isoWeekOfDay(today), open: true };
  }
}

/** Awards that count toward a quest in the given period. Nothing before the quest existed counts. */
export function awardsInPeriod(quest: Quest, periodKey: string, awards: readonly LedgerAward[]): LedgerAward[] {
  const created = Date.parse(quest.createdAt);
  return awards.filter((a) => {
    const t = Date.parse(a.occurredAt);
    if (!Number.isFinite(t) || t < created) return false;
    switch (quest.window.kind) {
      case 'none':
        return true;
      case 'fixed':
        return t >= Date.parse(quest.window.from) && t < Date.parse(quest.window.to);
      case 'daily':
        return a.localDay === periodKey;
      case 'weekly':
        return isoWeekOfDay(a.localDay) === periodKey;
    }
  });
}

export interface QuestProgress extends Progress {
  periodKey: string;
  open: boolean;
}

export function questProgress(quest: Quest, awards: readonly LedgerAward[], now: Date, timeZone: string): QuestProgress {
  const period = questPeriod(quest, now, timeZone);
  const progress = evaluateCondition(quest.condition, awardsInPeriod(quest, period.key, awards));
  return { ...progress, periodKey: period.key, open: period.open };
}

/** Recurring quests complete once per period and stay active; one-off quests complete for good. */
export function isRecurring(quest: Quest): boolean {
  return quest.window.kind === 'daily' || quest.window.kind === 'weekly';
}
