/**
 * Reality RPG's tables, all under `rpg_`, created through the foundation's
 * runModuleMigrations so each migration and its ledger row commit together.
 *
 * Nothing here stores event content. The award ledger keeps an event's id,
 * seq, type, action id and time - the allow-listed envelope - and no more.
 */

import type { ModuleMigration } from '@dexnest/foundation';

export const REALITY_RPG_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: 'game',
    sql: `
CREATE TABLE IF NOT EXISTS rpg_rules (
  id                 TEXT PRIMARY KEY,
  version            INTEGER NOT NULL CHECK (version >= 1),
  name               TEXT NOT NULL,
  enabled            INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  effective_from_seq INTEGER NOT NULL DEFAULT 0,
  definition_json    TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rpg_rule_versions (
  rule_id         TEXT NOT NULL,
  version         INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  saved_at        TEXT NOT NULL,
  PRIMARY KEY (rule_id, version)
);

CREATE TABLE IF NOT EXISTS rpg_awards (
  id           TEXT PRIMARY KEY,
  rule_id      TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  event_id     TEXT NOT NULL,
  event_seq    INTEGER NOT NULL,
  event_type   TEXT NOT NULL,
  action_id    TEXT,
  occurred_at  TEXT NOT NULL,
  local_day    TEXT NOT NULL,
  xp           INTEGER NOT NULL CHECK (xp > 0),
  stat         TEXT NOT NULL,
  awarded_at   TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  UNIQUE (rule_id, event_id)
);
CREATE INDEX IF NOT EXISTS rpg_awards_rule_day ON rpg_awards (rule_id, local_day);
CREATE INDEX IF NOT EXISTS rpg_awards_awarded ON rpg_awards (awarded_at);

CREATE TABLE IF NOT EXISTS rpg_achievements (
  id              TEXT PRIMARY KEY,
  definition_json TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rpg_achievement_unlocks (
  achievement_id   TEXT PRIMARY KEY,
  unlocked_at      TEXT NOT NULL,
  tipping_award_id TEXT NOT NULL,
  run_id           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rpg_quests (
  id              TEXT PRIMARY KEY,
  definition_json TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  created_at      TEXT NOT NULL,
  completed_at    TEXT,
  abandoned_at    TEXT
);

CREATE TABLE IF NOT EXISTS rpg_quest_completions (
  quest_id     TEXT NOT NULL,
  period_key   TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  PRIMARY KEY (quest_id, period_key)
);

CREATE TABLE IF NOT EXISTS rpg_levels (
  level      INTEGER PRIMARY KEY,
  reached_at TEXT NOT NULL,
  total_xp   INTEGER NOT NULL,
  run_id     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rpg_runs (
  id            TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL UNIQUE,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'skipped', 'failed')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  from_seq      INTEGER,
  to_seq        INTEGER,
  awards        INTEGER NOT NULL DEFAULT 0,
  xp            INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS rpg_runs_started ON rpg_runs (started_at);

CREATE TABLE IF NOT EXISTS rpg_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
];
