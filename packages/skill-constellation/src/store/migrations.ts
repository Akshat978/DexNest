/**
 * Skill Constellation's tables. All under the `skill_` prefix, all created
 * through the foundation's runModuleMigrations, so each migration and its
 * ledger row commit together.
 *
 * Everything but skill_builds, skill_state and skill_strength_history is the
 * *current* constellation and is replaced whole by each completed build.
 */

import type { ModuleMigration } from '@dexnest/foundation';

export const SKILL_CONSTELLATION_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: 'constellation',
    sql: `
CREATE TABLE IF NOT EXISTS skill_builds (
  id                   TEXT PRIMARY KEY,
  occurrence_id        TEXT NOT NULL UNIQUE,
  trigger              TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('running', 'completed', 'skipped', 'failed')),
  started_at           TEXT NOT NULL,
  finished_at          TEXT,
  dev_cursor_seq       INTEGER,
  settings_fingerprint TEXT,
  skills               INTEGER NOT NULL DEFAULT 0,
  evidence             INTEGER NOT NULL DEFAULT 0,
  links                INTEGER NOT NULL DEFAULT 0,
  added                INTEGER NOT NULL DEFAULT 0,
  lost                 INTEGER NOT NULL DEFAULT 0,
  refused_private      INTEGER NOT NULL DEFAULT 0,
  others_commits       INTEGER NOT NULL DEFAULT 0,
  error                TEXT
);
CREATE INDEX IF NOT EXISTS skill_builds_started ON skill_builds (started_at);

CREATE TABLE IF NOT EXISTS skill_skills (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  evidence_count    INTEGER NOT NULL CHECK (evidence_count > 0),
  repository_count  INTEGER NOT NULL,
  evidence_kinds    INTEGER NOT NULL,
  first_evidence_at TEXT NOT NULL,
  last_evidence_at  TEXT NOT NULL,
  last_activity_at  TEXT,
  build_id          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_evidence (
  id              TEXT PRIMARY KEY,
  skill_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  repository_id   TEXT NOT NULL,
  repository_name TEXT,
  path            TEXT,
  at              TEXT NOT NULL,
  source_ref      TEXT NOT NULL,
  detail          TEXT
);
CREATE INDEX IF NOT EXISTS skill_evidence_by_skill ON skill_evidence (skill_id, at);

CREATE TABLE IF NOT EXISTS skill_links (
  a                          TEXT NOT NULL,
  b                          TEXT NOT NULL,
  source                     TEXT NOT NULL CHECK (source IN ('evidence', 'curated')),
  shared_repository_ids_json TEXT NOT NULL,
  weight                     REAL NOT NULL,
  PRIMARY KEY (a, b),
  CHECK (a < b)
);

CREATE TABLE IF NOT EXISTS skill_layout (
  skill_id TEXT PRIMARY KEY,
  x        REAL NOT NULL,
  y        REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_strength_history (
  build_id       TEXT NOT NULL,
  skill_id       TEXT NOT NULL,
  at             TEXT NOT NULL,
  evidence_count INTEGER NOT NULL,
  volume         REAL NOT NULL,
  recency        REAL NOT NULL,
  variety        REAL NOT NULL,
  score          REAL NOT NULL,
  PRIMARY KEY (build_id, skill_id)
);
CREATE INDEX IF NOT EXISTS skill_strength_history_by_skill ON skill_strength_history (skill_id, at);
`,
  },
];
