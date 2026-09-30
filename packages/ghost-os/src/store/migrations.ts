/**
 * GhostOS tables, all under `ghost_`, created through the foundation's
 * runModuleMigrations so each migration and its ledger row commit together.
 *
 * Two ledgers:
 * - `ghost_os`: the core tables. Required.
 * - `ghost_os_search`: the FTS5 index and the triggers that keep it in step
 *   with ghost_entities. Optional: if the SQLite build has no FTS5 this
 *   ledger fails on its own, the core is untouched, and search uses LIKE.
 *
 * Provenance is stored on every row. `origin = 'manual'` exactly when there
 * is no source id and no source reference (a CHECK), and a source's
 * reference is unique per source (a partial unique index), so one source
 * fact is at most one row.
 *
 * Foreign keys without ON DELETE CASCADE, on purpose: removal goes through
 * the planned cascade (domain/cascade.ts), which also removes derived rows,
 * writes tombstones and keeps the search index clean. A delete that skipped
 * it would fail on the foreign key instead of leaving orphans.
 */

import type { ModuleMigration } from '@dexnest/foundation';

const provenanceColumns = `
  origin        TEXT NOT NULL CHECK (origin IN ('manual', 'adapter', 'derived')),
  source_id     TEXT,
  source_ref    TEXT,
  evidence_json TEXT NOT NULL,
  confidence    REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1)`;

const provenanceCheck = `CHECK ((origin = 'manual') = (source_id IS NULL AND source_ref IS NULL))`;

export const GHOST_OS_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: 'core',
    sql: `
CREATE TABLE IF NOT EXISTS ghost_entities (
  id           TEXT PRIMARY KEY,
  fts_rowid    INTEGER NOT NULL UNIQUE,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL,
  tags_text    TEXT NOT NULL,
  details_json TEXT NOT NULL,
  occurred_at  TEXT,
  started_at   TEXT,
  ended_at     TEXT,
  timeline_at  TEXT NOT NULL,
  ${provenanceColumns},
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  ${provenanceCheck}
);
CREATE UNIQUE INDEX IF NOT EXISTS ghost_entities_source ON ghost_entities (source_id, source_ref) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ghost_entities_timeline ON ghost_entities (timeline_at, id);
CREATE INDEX IF NOT EXISTS ghost_entities_type_timeline ON ghost_entities (type, timeline_at);

CREATE TABLE IF NOT EXISTS ghost_tags (
  entity_id TEXT NOT NULL REFERENCES ghost_entities (id),
  tag       TEXT NOT NULL,
  PRIMARY KEY (entity_id, tag)
);
CREATE INDEX IF NOT EXISTS ghost_tags_tag ON ghost_tags (tag);

CREATE TABLE IF NOT EXISTS ghost_relations (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES ghost_entities (id),
  to_id      TEXT NOT NULL REFERENCES ghost_entities (id),
  type       TEXT NOT NULL,
  strength   REAL NOT NULL CHECK (strength >= 0 AND strength <= 1),
  valid_from TEXT,
  valid_to   TEXT,
  notes      TEXT NOT NULL,
  ${provenanceColumns},
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ${provenanceCheck},
  CHECK (from_id <> to_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ghost_relations_source ON ghost_relations (source_id, source_ref) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ghost_relations_from ON ghost_relations (from_id);
CREATE INDEX IF NOT EXISTS ghost_relations_to ON ghost_relations (to_id);

CREATE TABLE IF NOT EXISTS ghost_observations (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES ghost_entities (id),
  statement   TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  ${provenanceColumns},
  created_at  TEXT NOT NULL,
  ${provenanceCheck}
);
CREATE UNIQUE INDEX IF NOT EXISTS ghost_observations_source ON ghost_observations (source_id, source_ref) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ghost_observations_entity ON ghost_observations (entity_id, observed_at);
CREATE INDEX IF NOT EXISTS ghost_observations_time ON ghost_observations (observed_at, id);

CREATE TABLE IF NOT EXISTS ghost_derivations (
  child_kind  TEXT NOT NULL CHECK (child_kind IN ('entity', 'relation', 'observation')),
  child_id    TEXT NOT NULL,
  parent_kind TEXT NOT NULL CHECK (parent_kind IN ('entity', 'relation', 'observation')),
  parent_id   TEXT NOT NULL,
  PRIMARY KEY (child_kind, child_id, parent_kind, parent_id)
);
CREATE INDEX IF NOT EXISTS ghost_derivations_parent ON ghost_derivations (parent_kind, parent_id);

CREATE TABLE IF NOT EXISTS ghost_tombstones (
  source_id    TEXT NOT NULL,
  source_ref   TEXT NOT NULL,
  forgotten_at TEXT NOT NULL,
  PRIMARY KEY (source_id, source_ref)
);

CREATE TABLE IF NOT EXISTS ghost_adapters (
  id           TEXT PRIMARY KEY,
  enabled      INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  cursor       TEXT,
  last_sync_at TEXT,
  counts_json  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ghost_runs (
  id            TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'skipped', 'failed')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  summary_json  TEXT NOT NULL,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS ghost_runs_started ON ghost_runs (started_at);

CREATE TABLE IF NOT EXISTS ghost_state (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
];

export const GHOST_OS_SEARCH_LEDGER = 'ghost_os_search';

export const GHOST_OS_SEARCH_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: 'fts5',
    sql: `
CREATE VIRTUAL TABLE IF NOT EXISTS ghost_search USING fts5 (title, notes, tags, tokenize = 'unicode61 remove_diacritics 2');
DELETE FROM ghost_search;
INSERT INTO ghost_search (rowid, title, notes, tags) SELECT fts_rowid, title, notes, tags_text FROM ghost_entities;
CREATE TRIGGER IF NOT EXISTS ghost_search_insert AFTER INSERT ON ghost_entities BEGIN INSERT INTO ghost_search (rowid, title, notes, tags) VALUES (new.fts_rowid, new.title, new.notes, new.tags_text); END;
CREATE TRIGGER IF NOT EXISTS ghost_search_delete AFTER DELETE ON ghost_entities BEGIN DELETE FROM ghost_search WHERE rowid = old.fts_rowid; END;
CREATE TRIGGER IF NOT EXISTS ghost_search_update AFTER UPDATE OF title, notes, tags_text, fts_rowid ON ghost_entities BEGIN DELETE FROM ghost_search WHERE rowid = old.fts_rowid; INSERT INTO ghost_search (rowid, title, notes, tags) VALUES (new.fts_rowid, new.title, new.notes, new.tags_text); END;
`,
  },
];
