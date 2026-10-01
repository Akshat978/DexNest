// Projects tables, all under `proj_`, created through the foundation's
// runModuleMigrations so each migration and its ledger row commit together.
//
// The journal (proj_operations) deliberately has no foreign key to
// proj_projects: an operation's history outlives the project being removed
// from DexNest. A partial unique index allows only one running operation per
// project, so two operations can never run in one repository at once, even
// if two callers race past the in-memory lock.

import type { ModuleMigration } from "@dexnest/foundation";

export const PROJECTS_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: "core",
    sql: `
CREATE TABLE IF NOT EXISTS proj_groups (
  id       TEXT PRIMARY KEY CHECK (length(id) > 0),
  name     TEXT NOT NULL CHECK (length(name) > 0),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS proj_groups_name ON proj_groups (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS proj_projects (
  id               TEXT PRIMARY KEY CHECK (length(id) > 0),
  name             TEXT NOT NULL CHECK (length(name) > 0),
  path             TEXT NOT NULL CHECK (length(path) > 0),
  real_path        TEXT,
  remote_identity  TEXT,
  description      TEXT NOT NULL,
  accent           TEXT NOT NULL,
  project_type     TEXT CHECK (project_type IS NULL OR project_type IN ('local_app', 'live_website', 'mobile_app', 'external_server')),
  group_id         TEXT REFERENCES proj_groups (id),
  favourite        INTEGER NOT NULL CHECK (favourite IN (0, 1)),
  pinned           INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  archived_at      TEXT,
  notes            TEXT NOT NULL,
  health_url       TEXT NOT NULL,
  stop_command     TEXT NOT NULL,
  log_command      TEXT NOT NULL,
  log_path         TEXT NOT NULL,
  docker_compose   INTEGER NOT NULL CHECK (docker_compose IN (0, 1)),
  is_git           INTEGER CHECK (is_git IS NULL OR is_git IN (0, 1)),
  remote_name      TEXT,
  remote_url       TEXT,
  hosting_owner    TEXT,
  hosting_repo     TEXT,
  default_branch   TEXT,
  package_manager  TEXT,
  framework        TEXT,
  workspace_file   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_opened_at   TEXT,
  last_activity_at TEXT,
  legacy_json      TEXT
);
CREATE INDEX IF NOT EXISTS proj_projects_real_path ON proj_projects (real_path);
CREATE INDEX IF NOT EXISTS proj_projects_remote ON proj_projects (remote_identity);
CREATE INDEX IF NOT EXISTS proj_projects_group ON proj_projects (group_id);

CREATE TABLE IF NOT EXISTS proj_commands (
  project_id            TEXT NOT NULL REFERENCES proj_projects (id),
  kind                  TEXT NOT NULL CHECK (kind IN ('start', 'build', 'test', 'typecheck', 'custom', 'list')),
  entry_id              TEXT NOT NULL,
  label                 TEXT NOT NULL,
  command               TEXT NOT NULL,
  requires_confirmation INTEGER NOT NULL CHECK (requires_confirmation IN (0, 1)),
  position              INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind, entry_id)
);

CREATE TABLE IF NOT EXISTS proj_urls (
  project_id TEXT NOT NULL REFERENCES proj_projects (id),
  kind       TEXT NOT NULL CHECK (kind IN ('local', 'link')),
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind, position)
);

CREATE TABLE IF NOT EXISTS proj_folders (
  project_id TEXT NOT NULL REFERENCES proj_projects (id),
  label      TEXT NOT NULL,
  path       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (project_id, position)
);

CREATE TABLE IF NOT EXISTS proj_ports (
  project_id TEXT NOT NULL REFERENCES proj_projects (id),
  port       INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  position   INTEGER NOT NULL,
  PRIMARY KEY (project_id, port)
);

CREATE TABLE IF NOT EXISTS proj_tags (
  project_id TEXT NOT NULL REFERENCES proj_projects (id),
  tag        TEXT NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (project_id, tag)
);

CREATE TABLE IF NOT EXISTS proj_fetch_state (
  project_id    TEXT PRIMARY KEY REFERENCES proj_projects (id),
  last_fetch_at TEXT NOT NULL,
  outcome       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proj_operations (
  id               TEXT PRIMARY KEY CHECK (length(id) > 0),
  project_id       TEXT NOT NULL,
  verb             TEXT NOT NULL,
  safety           TEXT NOT NULL CHECK (safety IN ('read', 'normal', 'caution', 'strong')),
  state            TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed', 'refused', 'interrupted')),
  outcome          TEXT,
  params_json      TEXT NOT NULL,
  refs_before_json TEXT,
  refs_after_json  TEXT,
  undo_json        TEXT,
  undo_of          TEXT,
  undone_by        TEXT,
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  error_code       TEXT
);
CREATE INDEX IF NOT EXISTS proj_operations_project ON proj_operations (project_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS proj_operations_one_running ON proj_operations (project_id) WHERE state = 'running';

CREATE TABLE IF NOT EXISTS proj_meta (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
  }
];
