/**
 * ObjectOS tables, all under `obj_`, created through the foundation's
 * runModuleMigrations so each migration and its ledger row commit together.
 *
 * Foreign keys hold the model together: a row cannot point at an object that
 * does not exist. Removal goes through the store (deleteObject, deleteRecord),
 * which deletes an object's own rows and detaches its components - never
 * deletes them. There is deliberately no ON DELETE CASCADE from a parent to
 * its children.
 */

import type { ModuleMigration } from '@dexnest/foundation';

export const OBJECT_OS_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: 'core',
    sql: `
CREATE TABLE IF NOT EXISTS obj_objects (
  id            TEXT PRIMARY KEY CHECK (length(id) = 8),
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('printer', 'computer', 'appliance', 'tool', 'vehicle', 'other')),
  make          TEXT NOT NULL,
  model         TEXT NOT NULL,
  serial        TEXT NOT NULL,
  location      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active', 'stored', 'broken', 'lent_out', 'sold', 'disposed')),
  notes         TEXT NOT NULL,
  parent_id     TEXT REFERENCES obj_objects (id),
  photo_file_id TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS obj_objects_parent ON obj_objects (parent_id);
CREATE INDEX IF NOT EXISTS obj_objects_name ON obj_objects (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS obj_tags (
  object_id TEXT NOT NULL REFERENCES obj_objects (id),
  tag       TEXT NOT NULL,
  PRIMARY KEY (object_id, tag)
);

CREATE TABLE IF NOT EXISTS obj_changes (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id  TEXT NOT NULL REFERENCES obj_objects (id),
  field      TEXT NOT NULL CHECK (field IN ('status', 'location', 'parent')),
  from_value TEXT,
  to_value   TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obj_changes_object ON obj_changes (object_id, at);

CREATE TABLE IF NOT EXISTS obj_state (
  object_id  TEXT NOT NULL REFERENCES obj_objects (id),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (object_id, key)
);

CREATE TABLE IF NOT EXISTS obj_state_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL REFERENCES obj_objects (id),
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obj_state_log_object ON obj_state_log (object_id, at);

CREATE TABLE IF NOT EXISTS obj_schedules (
  id            TEXT PRIMARY KEY,
  object_id     TEXT NOT NULL REFERENCES obj_objects (id),
  title         TEXT NOT NULL,
  rule_json     TEXT NOT NULL,
  starts_at     TEXT NOT NULL,
  start_reading REAL,
  active        INTEGER NOT NULL CHECK (active IN (0, 1)),
  notes         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obj_schedules_object ON obj_schedules (object_id);

CREATE TABLE IF NOT EXISTS obj_maintenance (
  id            TEXT PRIMARY KEY,
  object_id     TEXT NOT NULL REFERENCES obj_objects (id),
  schedule_id   TEXT REFERENCES obj_schedules (id),
  title         TEXT NOT NULL,
  done_at       TEXT NOT NULL,
  done_by       TEXT NOT NULL,
  cost_amount   INTEGER,
  cost_currency TEXT,
  notes         TEXT NOT NULL,
  usage_reading REAL,
  created_at    TEXT NOT NULL,
  CHECK ((cost_amount IS NULL) = (cost_currency IS NULL))
);
CREATE INDEX IF NOT EXISTS obj_maintenance_object ON obj_maintenance (object_id, done_at);
CREATE INDEX IF NOT EXISTS obj_maintenance_schedule ON obj_maintenance (schedule_id, done_at);

CREATE TABLE IF NOT EXISTS obj_parts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  part_number  TEXT NOT NULL,
  supplier     TEXT NOT NULL,
  unit         TEXT NOT NULL,
  quantity     REAL NOT NULL CHECK (quantity >= 0),
  low_stock_at REAL,
  notes        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS obj_part_fits (
  part_id   TEXT NOT NULL REFERENCES obj_parts (id),
  object_id TEXT NOT NULL REFERENCES obj_objects (id),
  PRIMARY KEY (part_id, object_id)
);
CREATE INDEX IF NOT EXISTS obj_part_fits_object ON obj_part_fits (object_id);

CREATE TABLE IF NOT EXISTS obj_maintenance_parts (
  maintenance_id TEXT NOT NULL REFERENCES obj_maintenance (id),
  part_id        TEXT NOT NULL REFERENCES obj_parts (id),
  quantity       REAL NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (maintenance_id, part_id)
);

CREATE TABLE IF NOT EXISTS obj_stock_log (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id        TEXT NOT NULL REFERENCES obj_parts (id),
  delta          REAL NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('restocked', 'used', 'corrected')),
  maintenance_id TEXT,
  at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obj_stock_log_part ON obj_stock_log (part_id, at);

CREATE TABLE IF NOT EXISTS obj_modifications (
  id          TEXT PRIMARY KEY,
  object_id   TEXT NOT NULL REFERENCES obj_objects (id),
  title       TEXT NOT NULL,
  done_at     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  before      TEXT NOT NULL,
  after       TEXT NOT NULL,
  reversible  INTEGER NOT NULL CHECK (reversible IN (0, 1)),
  reverted_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obj_modifications_object ON obj_modifications (object_id, done_at);

CREATE TABLE IF NOT EXISTS obj_settings (
  id          TEXT PRIMARY KEY,
  object_id   TEXT NOT NULL REFERENCES obj_objects (id),
  name        TEXT NOT NULL,
  version     INTEGER NOT NULL CHECK (version >= 1),
  values_json TEXT NOT NULL,
  note        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (object_id, name, version)
);

CREATE TABLE IF NOT EXISTS obj_measurements (
  id          TEXT PRIMARY KEY,
  object_id   TEXT NOT NULL REFERENCES obj_objects (id),
  key         TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  note        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS obj_measurements_series ON obj_measurements (object_id, key, measured_at);

CREATE TABLE IF NOT EXISTS obj_purchase (
  object_id       TEXT PRIMARY KEY REFERENCES obj_objects (id),
  purchased_on    TEXT,
  price_amount    INTEGER,
  price_currency  TEXT,
  shop            TEXT NOT NULL,
  warranty_until  TEXT,
  receipt_file_id TEXT,
  updated_at      TEXT NOT NULL,
  CHECK ((price_amount IS NULL) = (price_currency IS NULL))
);

CREATE TABLE IF NOT EXISTS obj_files (
  id          TEXT PRIMARY KEY,
  object_id   TEXT NOT NULL REFERENCES obj_objects (id),
  role        TEXT NOT NULL CHECK (role IN ('manual', 'photo', 'receipt', 'model', 'config', 'other')),
  name        TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
  type        TEXT NOT NULL,
  sha256      TEXT NOT NULL CHECK (length(sha256) = 64),
  added_at    TEXT NOT NULL,
  UNIQUE (object_id, stored_name)
);
CREATE INDEX IF NOT EXISTS obj_files_object ON obj_files (object_id, added_at);

CREATE TABLE IF NOT EXISTS obj_runs (
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

CREATE TABLE IF NOT EXISTS obj_kv (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'pending_files',
    // Bytes on disk whose rows may not exist: written before a copy or a
    // delete starts, cleared when it finishes. After a crash, start() removes
    // whatever no row claims. stored_name '' stands for the object's whole folder.
    sql: `
CREATE TABLE IF NOT EXISTS obj_pending_files (
  object_id   TEXT NOT NULL CHECK (length(object_id) = 8),
  stored_name TEXT NOT NULL,
  PRIMARY KEY (object_id, stored_name)
);
`,
  },
  {
    version: 3,
    name: 'whereabouts',
    // Where an object is, for finding it again (what Finder used to keep in a
    // file of its own): one row per object, absent until something is set.
    sql: `
CREATE TABLE IF NOT EXISTS obj_whereabouts (
  object_id  TEXT PRIMARY KEY REFERENCES obj_objects (id),
  room       TEXT NOT NULL DEFAULT '',
  container  TEXT NOT NULL DEFAULT '',
  lent_to    TEXT NOT NULL DEFAULT '',
  lent_at    TEXT,
  missing    INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
  located_at TEXT
);
CREATE INDEX IF NOT EXISTS obj_whereabouts_located ON obj_whereabouts (located_at);
`,
  },
];
