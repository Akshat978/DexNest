// Developer Intelligence and Standup schemas, on DexNest's shared database.
//
// Carried over from the standalone build's SQL files with three changes, none
// of which alter what a column means:
//   - every table and index is prefixed (dev_, standup_), because this is the
//     one database every module shares and generic names like "repositories"
//     or "idx_tech_repo" would collide sooner or later;
//   - developer_events is gone - developer events live in the shared event_log
//     (see stores/event-store.ts) - and so is the module's own
//     schema_migrations, replaced by the shared migration ledger;
//   - PRAGMA lines are dropped: the runner owns the transaction, and PRAGMA
//     foreign_keys is a no-op inside one (local-db sets it on the connection).
//
// Versions keep the standalone numbering so the history stays readable.

import type { ModuleMigration } from '@dexnest/foundation';

export const DEV_INTELLIGENCE_MODULE = 'developer_intelligence';
export const STANDUP_MODULE = 'standup';

export const DEV_INTELLIGENCE_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
CREATE TABLE IF NOT EXISTS dev_repositories (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT,
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  roots_json TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  canonical_path TEXT,
  domain TEXT
);

CREATE INDEX IF NOT EXISTS idx_dev_repositories_canonical
  ON dev_repositories(domain, canonical_path);

CREATE TABLE IF NOT EXISTS dev_repository_snapshots (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  repository_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  root_json TEXT NOT NULL,
  git_json TEXT NOT NULL,
  content_fingerprint TEXT,
  FOREIGN KEY (repository_id) REFERENCES dev_repositories(id)
);

CREATE INDEX IF NOT EXISTS idx_dev_snapshots_repo_captured
  ON dev_repository_snapshots(repository_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS dev_observed_commits (
  repository_id TEXT NOT NULL,
  sha TEXT NOT NULL,
  subject TEXT,
  author_date TEXT,
  first_observed_at TEXT NOT NULL,
  PRIMARY KEY (repository_id, sha)
);

CREATE TABLE IF NOT EXISTS dev_scan_runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  target_repository_ids_json TEXT,
  repositories_attempted INTEGER NOT NULL DEFAULT 0,
  repositories_succeeded INTEGER NOT NULL DEFAULT 0,
  repositories_failed INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT,
  error_summary TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dev_scan_runs_state
  ON dev_scan_runs(state);

CREATE INDEX IF NOT EXISTS idx_dev_scan_runs_started
  ON dev_scan_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS dev_todos (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER,
  column_pos INTEGER,
  text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (repository_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_dev_todos_repo_status
  ON dev_todos(repository_id, status);

CREATE TABLE IF NOT EXISTS dev_health_checks (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  repository_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  cwd TEXT NOT NULL,
  domain TEXT NOT NULL,
  argv_json TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  max_stdout_bytes INTEGER NOT NULL,
  max_stderr_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_health_runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  health_check_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  stdout_preview TEXT,
  stderr_preview TEXT,
  timed_out INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_dev_health_runs_check
  ON dev_health_runs(health_check_id, started_at DESC);

CREATE TABLE IF NOT EXISTS dev_technologies (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  repository_id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  evidence_path TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE (repository_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_dev_tech_repo
  ON dev_technologies(repository_id);
`,
  },
  {
    version: 2,
    name: 'enrichment',
    sql: `
ALTER TABLE dev_technologies ADD COLUMN status TEXT NOT NULL DEFAULT 'observed';
ALTER TABLE dev_technologies ADD COLUMN first_observed_at TEXT;
ALTER TABLE dev_technologies ADD COLUMN last_observed_at TEXT;
ALTER TABLE dev_technologies ADD COLUMN removed_at TEXT;

UPDATE dev_technologies
SET first_observed_at = COALESCE(first_observed_at, observed_at),
    last_observed_at = COALESCE(last_observed_at, observed_at)
WHERE first_observed_at IS NULL OR last_observed_at IS NULL;

ALTER TABLE dev_todos ADD COLUMN previous_file_path TEXT;

ALTER TABLE dev_health_runs ADD COLUMN stdout_bytes_retained INTEGER;
ALTER TABLE dev_health_runs ADD COLUMN stderr_bytes_retained INTEGER;

CREATE TABLE IF NOT EXISTS dev_retention_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL DEFAULT 1,
  max_health_output_bytes INTEGER NOT NULL,
  max_health_runs_per_check INTEGER NOT NULL,
  max_diagnostic_age_ms INTEGER NOT NULL,
  max_diagnostic_rows INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO dev_retention_policy (
  id, schema_version, max_health_output_bytes, max_health_runs_per_check,
  max_diagnostic_age_ms, max_diagnostic_rows, updated_at
) VALUES (
  1, 1, 65536, 50, 604800000, 500, '1970-01-01T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS dev_scan_diagnostics (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  scan_run_id TEXT NOT NULL,
  repository_id TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retain_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_dev_scan_diagnostics_created
  ON dev_scan_diagnostics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dev_scan_diagnostics_scan
  ON dev_scan_diagnostics(scan_run_id);
`,
  },
];

export const STANDUP_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 10,
    name: 'standup',
    sql: `
CREATE TABLE IF NOT EXISTS standup_reports (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  timezone TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  previous_report_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  report_json TEXT NOT NULL,
  UNIQUE (occurrence_id, trigger_kind)
);

CREATE INDEX IF NOT EXISTS idx_standup_reports_generated
  ON standup_reports(generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_standup_reports_occurrence
  ON standup_reports(occurrence_id, trigger_kind);

CREATE INDEX IF NOT EXISTS idx_standup_reports_status_generated
  ON standup_reports(status, generated_at DESC);

CREATE TABLE IF NOT EXISTS standup_items (
  report_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  section TEXT NOT NULL,
  repository_id TEXT,
  lifecycle TEXT,
  issue_fingerprint TEXT,
  sort_key TEXT,
  item_json TEXT NOT NULL,
  PRIMARY KEY (report_id, item_id),
  FOREIGN KEY (report_id) REFERENCES standup_reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_standup_items_report_section
  ON standup_items(report_id, section);

CREATE INDEX IF NOT EXISTS idx_standup_items_fingerprint
  ON standup_items(issue_fingerprint);

CREATE TABLE IF NOT EXISTS standup_issue_states (
  fingerprint TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  first_report_id TEXT,
  resolved_in_report_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_standup_issue_lifecycle
  ON standup_issue_states(lifecycle);
`,
  },
];
