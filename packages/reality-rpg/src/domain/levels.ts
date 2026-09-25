/** Level and the character sheet, computed from the ledger. Never stored as counters. */

import { LEVEL_THRESHOLDS } from './data/levels.ts';
import type { Award, CharacterSheet } from './types.ts';

export function levelFor(totalXp: number, thresholds: readonly number[] = LEVEL_THRESHOLDS): number {
  let level = 1;
  for (let i = 1; i < thresholds.length; i++) {
    if (totalXp >= thresholds[i]!) level = i + 1;
    else break;
  }
  return level;
}

export function characterSheet(awards: readonly Pick<Award, 'xp' | 'stat'>[], thresholds: readonly number[] = LEVEL_THRESHOLDS): CharacterSheet {
  let totalXp = 0;
  const stats = new Map<string, number>();
  for (const a of awards) {
    totalXp += a.xp;
    stats.set(a.stat, (stats.get(a.stat) ?? 0) + a.xp);
  }
  const level = levelFor(totalXp, thresholds);
  const floor = thresholds[level - 1] ?? 0;
  const next = thresholds[level];
  return {
    totalXp,
    level,
    xpIntoLevel: totalXp - floor,
    xpToNextLevel: next === undefined ? null : next - totalXp,
    stats: [...stats].map(([stat, xp]) => ({ stat, xp })).sort((a, b) => b.xp - a.xp || a.stat.localeCompare(b.stat)),
  };
}

/** Levels passed when total XP goes from `before` to `after`, in order. */
export function levelsReached(before: number, after: number, thresholds: readonly number[] = LEVEL_THRESHOLDS): number[] {
  const out: number[] = [];
  for (let level = levelFor(before, thresholds) + 1; level <= levelFor(after, thresholds); level++) out.push(level);
  return out;
}
