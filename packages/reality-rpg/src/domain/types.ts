/**
 * Reality RPG's vocabulary. Pure types: nothing here does I/O.
 *
 * The game is built from three kinds of data - rules, achievements, quests -
 * and one ledger of awards. Rules turn events into awards; everything else
 * (level, stats, achievement and quest progress) is computed from the ledger.
 */

/**
 * The shape of a row from DexNest's event log, as the foundation's EventLog
 * returns it. Declared here structurally so the domain imports nothing; the
 * engine passes foundation events straight in.
 */
export interface RawEvent {
  id: string;
  seq: number;
  type: string;
  stream: string;
  module: string | null;
  occurredAt: string;
  payload: unknown;
}

/**
 * The only view of an event the game keeps. Built by `projectEvent` and
 * nowhere else; no summary, metadata, subject, text or path survives it.
 */
export interface ObservedEvent {
  id: string;
  seq: number;
  type: string;
  stream: string;
  /** The envelope module, or - for legacy audit rows - the payload's `module`. */
  module: string | null;
  /** Legacy audit rows only: the registered action that ran. */
  actionId: string | null;
  /** Legacy audit rows only: "success", "failed", ... */
  status: string | null;
  occurredAt: string;
}

export interface RuleMatch {
  /** Required and explicit: the only event types the game ever asks the log for. */
  types: string[];
  stream?: string;
  module?: string;
  actionIds?: string[];
  status?: 'success' | 'failed';
}

export interface Rule {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  match: RuleMatch;
  award: { xp: number; stat: string };
  /** Most awards this rule gives in one local day. */
  dailyCap?: number;
  /** Events before this seq never earn from this rule (no retroactive surprises). */
  effectiveFromSeq: number;
}

export type Condition =
  | { kind: 'count'; ruleIds: string[]; target: number }
  | { kind: 'xp'; stat?: string; target: number }
  | { kind: 'days'; ruleIds: string[]; target: number };

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  condition: Condition;
}

export type QuestWindow =
  | { kind: 'none' }
  | { kind: 'fixed'; from: string; to: string }
  | { kind: 'daily' }
  | { kind: 'weekly' };

export type QuestStatus = 'active' | 'completed' | 'abandoned';

export interface Quest {
  id: string;
  title: string;
  condition: Condition;
  window: QuestWindow;
  status: QuestStatus;
  createdAt: string;
}

export interface Award {
  /** Deterministic from rule and event: the same pair is always the same award. */
  id: string;
  ruleId: string;
  ruleVersion: number;
  eventId: string;
  eventSeq: number;
  eventType: string;
  actionId: string | null;
  occurredAt: string;
  /** Local calendar day of `occurredAt`, YYYY-MM-DD. */
  localDay: string;
  xp: number;
  stat: string;
}

export interface Progress {
  current: number;
  target: number;
  met: boolean;
}

export interface CharacterSheet {
  totalXp: number;
  level: number;
  /** XP earned since the current level was reached. */
  xpIntoLevel: number;
  /** XP still needed for the next level; null at the top of the curve. */
  xpToNextLevel: number | null;
  stats: { stat: string; xp: number }[];
}
