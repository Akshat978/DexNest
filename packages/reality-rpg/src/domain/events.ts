/**
 * Reality RPG's milestone events: stream "rpg", module "reality_rpg".
 * Awards are not events - they live in the ledger. Payloads carry ids,
 * numbers and dates only.
 */

export const RPG_MODULE_ID = 'reality_rpg';
export const RPG_EVENT_STREAM = 'rpg';
export const RPG_EVENT_NAMESPACE = 'rpg';

export const RPG_EVENT_TYPES = ['rpg.level.reached', 'rpg.achievement.unlocked', 'rpg.quest.completed', 'rpg.run.completed'] as const;
export type RpgEventType = (typeof RPG_EVENT_TYPES)[number];

export interface LevelReachedPayload { level: number; totalXp: number; runId: string }
export interface AchievementUnlockedPayload { achievementId: string; tippingAwardId: string; runId: string }
export interface QuestCompletedPayload { questId: string; periodKey: string; runId: string }
export interface RunCompletedPayload { runId: string; occurrenceId: string; awards: number; xp: number; fromSeq: number; toSeq: number }

export const levelKey = (level: number) => `${RPG_MODULE_ID}:level:${level}`;
export const achievementKey = (achievementId: string) => `${RPG_MODULE_ID}:achievement:${achievementId}`;
export const questKey = (questId: string, periodKey: string) => `${RPG_MODULE_ID}:quest:${questId}:${periodKey}`;
export const runKey = (occurrenceId: string) => `${RPG_MODULE_ID}:run:${occurrenceId}`;
