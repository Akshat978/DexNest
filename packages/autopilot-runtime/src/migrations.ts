// Autopilot schema migrations.
//
// These run against DexNest's existing SQLite database, alongside the existing
// event_log table. They are strictly additive: no existing table is dropped,
// altered or rewritten, so existing user data is preserved.

import type { SqlDatabase } from "./ports.ts";

export interface Migration {
  id: number;
  name: string;
  up: string;
}

export const AUTOPILOT_MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "autopilot_runs_and_journal",
    up: `
      CREATE TABLE IF NOT EXISTS autopilot_runs (
        id                TEXT PRIMARY KEY,
        state             TEXT NOT NULL,
        spec_json         TEXT NOT NULL,
        spec_fingerprint  TEXT NOT NULL,
        spec_revision     INTEGER NOT NULL DEFAULT 1,
        executor_id       TEXT NOT NULL,
        project_id        TEXT,
        goal              TEXT NOT NULL,
        event_seq         INTEGER NOT NULL DEFAULT 0,
        pause_requested   INTEGER NOT NULL DEFAULT 0,
        stop_requested    INTEGER NOT NULL DEFAULT 0,
        reconcile_reason  TEXT,
        failure_reason    TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_autopilot_runs_state
        ON autopilot_runs (state);

      CREATE TABLE IF NOT EXISTS autopilot_run_events (
        id          TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        type        TEXT NOT NULL,
        from_state  TEXT,
        to_state    TEXT,
        step_key    TEXT,
        payload_json TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_run_events_seq
        ON autopilot_run_events (run_id, seq);

      CREATE INDEX IF NOT EXISTS idx_autopilot_run_events_run
        ON autopilot_run_events (run_id, seq);

      CREATE TABLE IF NOT EXISTS autopilot_run_steps (
        id               TEXT PRIMARY KEY,
        run_id           TEXT NOT NULL,
        step_key         TEXT NOT NULL,
        ordinal          INTEGER NOT NULL,
        status           TEXT NOT NULL,
        idempotency_key  TEXT NOT NULL,
        attempts         INTEGER NOT NULL DEFAULT 0,
        summary          TEXT,
        detail_json      TEXT,
        intent_at        TEXT,
        settled_at       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      -- The duplicate-prevention primitive: one logical step per run, enforced
      -- by the database rather than by in-memory bookkeeping that a crash loses.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_run_steps_key
        ON autopilot_run_steps (run_id, step_key);
    `
  },
  {
    id: 2,
    name: "autopilot_operations_approvals_workspace",
    up: `
      -- One row per effect intent. This is the durable identity that policy
      -- decisions, approvals and exactly-once dispatch all attach to.
      CREATE TABLE IF NOT EXISTS autopilot_operations (
        id                TEXT PRIMARY KEY,
        run_id            TEXT NOT NULL,
        step_key          TEXT,
        kind              TEXT NOT NULL,
        fingerprint       TEXT NOT NULL,
        intent_json       TEXT NOT NULL,
        summary           TEXT NOT NULL,
        decision          TEXT NOT NULL,
        decision_rule     TEXT NOT NULL,
        decision_reason   TEXT NOT NULL,
        capability        TEXT NOT NULL,
        risk              TEXT NOT NULL,
        status            TEXT NOT NULL,
        approval_id       TEXT,
        exit_code         INTEGER,
        result_summary    TEXT,
        created_at        TEXT NOT NULL,
        dispatched_at     TEXT,
        settled_at        TEXT,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_autopilot_operations_run
        ON autopilot_operations (run_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_autopilot_operations_status
        ON autopilot_operations (status);

      CREATE TABLE IF NOT EXISTS autopilot_approvals (
        id               TEXT PRIMARY KEY,
        run_id           TEXT NOT NULL,
        operation_id     TEXT NOT NULL,
        fingerprint      TEXT NOT NULL,
        summary          TEXT NOT NULL,
        reason           TEXT NOT NULL,
        capability       TEXT NOT NULL,
        risk             TEXT NOT NULL,
        status           TEXT NOT NULL,
        requested_at     TEXT NOT NULL,
        resolved_at      TEXT,
        resolution_source TEXT,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      -- One approval per operation: an approval authorizes a single concrete
      -- intent, never a standing permission.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_approvals_operation
        ON autopilot_approvals (operation_id);

      CREATE INDEX IF NOT EXISTS idx_autopilot_approvals_status
        ON autopilot_approvals (status, requested_at);

      -- Workspace identity lives on the run so recovery can revalidate it.
      ALTER TABLE autopilot_runs ADD COLUMN workspace_root TEXT;
      ALTER TABLE autopilot_runs ADD COLUMN workspace_repo_root TEXT;
      ALTER TABLE autopilot_runs ADD COLUMN workspace_branch TEXT;
      ALTER TABLE autopilot_runs ADD COLUMN scratch_root TEXT;
    `
  },
  {
    id: 3,
    name: "autopilot_worker_sessions_and_sends",
    up: `
      CREATE TABLE autopilot_worker_sessions (
        run_id TEXT PRIMARY KEY REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        cwd TEXT NOT NULL,
        established INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE autopilot_worker_sends (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_worker_sessions(run_id) ON DELETE CASCADE,
        prompt_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('INTENT','AWAITING_APPROVAL','DISPATCHING','COMPLETED','FAILED','UNCERTAIN','CANCELLED')),
        operation_id TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_autopilot_worker_one_pending_send
        ON autopilot_worker_sends(run_id)
        WHERE status IN ('INTENT','AWAITING_APPROVAL','DISPATCHING','UNCERTAIN');
    `
  },
  {
    id: 4,
    name: "autopilot_worker_human_resolution",
    up: `
      ALTER TABLE autopilot_worker_sends ADD COLUMN retry_of TEXT REFERENCES autopilot_worker_sends(id);
      CREATE UNIQUE INDEX idx_autopilot_worker_one_retry ON autopilot_worker_sends(retry_of) WHERE retry_of IS NOT NULL;
      CREATE TABLE autopilot_worker_resolutions (
        id TEXT PRIMARY KEY,
        send_id TEXT NOT NULL REFERENCES autopilot_worker_sends(id),
        decision TEXT NOT NULL CHECK(decision IN ('completed','not_sent','keep_unresolved')),
        evidence TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_autopilot_worker_final_resolution ON autopilot_worker_resolutions(send_id)
        WHERE decision != 'keep_unresolved';
    `
  },
  {
    id: 5,
    name: "autopilot_provider_assigned_session_identity",
    up: `ALTER TABLE autopilot_worker_sessions ADD COLUMN provider_session_id TEXT;
      ALTER TABLE autopilot_worker_sessions ADD COLUMN provider_options_json TEXT;
      CREATE UNIQUE INDEX idx_autopilot_provider_session ON autopilot_worker_sessions(provider,provider_session_id)
      WHERE provider_session_id IS NOT NULL;`
  },
  {
    id: 6,
    name: "autopilot_autonomous_loop",
    up: `
      -- A bounded, human-created authorization to run N worker turns for ONE run,
      -- provider, session and workspace.
      --
      -- This is NOT "approve everything for this session". Policy still returns
      -- REQUIRE_APPROVAL for every prompt and every turn still creates its own
      -- approval row; the grant is what resolves those approvals, is capped by
      -- max_turns, is revocable at any moment, and is recorded per turn. The
      -- human authorizes the loop, not each keystroke inside it.
      CREATE TABLE IF NOT EXISTS autopilot_loop_grants (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL,
        provider        TEXT NOT NULL,
        session_id      TEXT NOT NULL,
        workspace_root  TEXT NOT NULL,
        max_turns       INTEGER NOT NULL,
        status          TEXT NOT NULL,
        granted_by      TEXT NOT NULL,
        granted_at      TEXT NOT NULL,
        closed_at       TEXT,
        closed_reason   TEXT,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      -- At most one live grant per run.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_loop_grant_active
        ON autopilot_loop_grants (run_id) WHERE status = 'ACTIVE';

      CREATE TABLE IF NOT EXISTS autopilot_turns (
        id               TEXT PRIMARY KEY,
        run_id           TEXT NOT NULL,
        grant_id         TEXT NOT NULL,
        ordinal          INTEGER NOT NULL,
        kind             TEXT NOT NULL,
        prompt_text      TEXT NOT NULL,
        send_id          TEXT,
        status           TEXT NOT NULL,
        -- Budget usage is derived by counting this flag, so a crash between
        -- consuming and sending can never double-spend the grant.
        grant_consumed   INTEGER NOT NULL DEFAULT 0,
        verification_id  TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_turn_ordinal
        ON autopilot_turns (run_id, ordinal);

      CREATE TABLE IF NOT EXISTS autopilot_verification_runs (
        id          TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL,
        turn_id     TEXT NOT NULL,
        outcome     TEXT NOT NULL,
        summary     TEXT NOT NULL,
        tiers_json  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_autopilot_verification_turn
        ON autopilot_verification_runs (run_id, turn_id);
    `
  },
  {
    id: 7,
    name: "autopilot_checkpoints_and_snapshots",
    up: `
      -- One known-good checkpoint per green turn.
      --
      -- The marker is a token embedded in the commit message. It is the bridge
      -- across a crash: if the SHA was never recorded, the commit can still be
      -- found by searching history for its marker rather than committing again.
      CREATE TABLE IF NOT EXISTS autopilot_checkpoints (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL,
        turn_id         TEXT NOT NULL,
        verification_id TEXT,
        marker          TEXT NOT NULL,
        status          TEXT NOT NULL,
        commit_sha      TEXT,
        head_before     TEXT,
        message         TEXT NOT NULL,
        detail          TEXT,
        created_at      TEXT NOT NULL,
        settled_at      TEXT,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      -- Structural duplicate prevention: a turn can never gain a second checkpoint.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_checkpoint_turn
        ON autopilot_checkpoints (turn_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_checkpoint_marker
        ON autopilot_checkpoints (marker);

      -- Durable evidence of the workspace at a point in time, so the report can
      -- be rebuilt after a restart without re-running git.
      CREATE TABLE IF NOT EXISTS autopilot_workspace_snapshots (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL,
        turn_id       TEXT,
        reason        TEXT NOT NULL,
        head_sha      TEXT,
        status_text   TEXT NOT NULL,
        diff_stat     TEXT NOT NULL,
        changed_files INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_autopilot_workspace_snapshot_run
        ON autopilot_workspace_snapshots (run_id, created_at);
    `
  },
  {
    id: 8,
    name: "autopilot_context_requests",
    up: `
      -- Files the worker asked to be shown, and what DexNest did about it.
      --
      -- Durable so a crash between the request and the next turn cannot lose it:
      -- a PENDING row is what the next turn looks for.
      CREATE TABLE IF NOT EXISTS autopilot_context_requests (
        id                TEXT PRIMARY KEY,
        run_id            TEXT NOT NULL,
        requested_turn_id TEXT NOT NULL,
        consumed_turn_id  TEXT,
        path              TEXT NOT NULL,
        status            TEXT NOT NULL,
        denial_reason     TEXT,
        bytes_supplied    INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        resolved_at       TEXT,
        FOREIGN KEY (run_id) REFERENCES autopilot_runs (id) ON DELETE CASCADE
      );

      -- One request per path per originating turn, so a repeated envelope in the
      -- same response can never create two rows.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_context_request_turn_path
        ON autopilot_context_requests (requested_turn_id, path);

      CREATE INDEX IF NOT EXISTS idx_autopilot_context_request_pending
        ON autopilot_context_requests (run_id, status);
    `
  },
  {
    id: 9,
    name: "context_request_evidence",
    up: `
      ALTER TABLE autopilot_context_requests ADD COLUMN requested_runtime_id TEXT;
      ALTER TABLE autopilot_context_requests ADD COLUMN resolved_runtime_id TEXT;
      ALTER TABLE autopilot_context_requests ADD COLUMN bytes_unit TEXT NOT NULL DEFAULT 'legacy_utf16_units';
    `
  },
  {
    id: 10,
    name: "primary_role_ownership",
    up: `
      ALTER TABLE autopilot_worker_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'PRIMARY' CHECK(role='PRIMARY');
      ALTER TABLE autopilot_worker_sessions ADD COLUMN restored INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE autopilot_loop_grants ADD COLUMN role TEXT NOT NULL DEFAULT 'PRIMARY' CHECK(role='PRIMARY');
    `
  },
  {
    id: 11,
    name: "consultation_requests",
    up: `
      CREATE TABLE autopilot_consultations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        trigger_event_id TEXT NOT NULL REFERENCES autopilot_run_events(id),
        identity_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('RECOMMENDED','APPROVED','CANCELLED','SUPERSEDED')),
        approved_identity_json TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        approval_source TEXT,
        resolution_source TEXT,
        UNIQUE(run_id, trigger_event_id)
      );
      CREATE UNIQUE INDEX idx_autopilot_consultation_active ON autopilot_consultations(run_id)
        WHERE status IN ('RECOMMENDED','APPROVED');
    `
  },
  {
    id: 12,
    name: "consultant_sessions_and_diagnoses",
    up: `
      -- CONSULTANT sessions live in their own table. The PRIMARY table is keyed
      -- by run_id and constrained to CHECK(role='PRIMARY'), so a consultant can
      -- never occupy, replace or mutate the PRIMARY session identity.
      CREATE TABLE autopilot_consultant_sessions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'CONSULTANT' CHECK(role='CONSULTANT'),
        provider TEXT NOT NULL CHECK(provider IN ('claude','codex')),
        session_id TEXT NOT NULL UNIQUE,
        provider_session_id TEXT,
        cwd TEXT NOT NULL,
        established INTEGER NOT NULL DEFAULT 0,
        -- Provider options discovered before the first prompt (Codex MCP names
        -- to disable). Names only; transports and tokens are never retained.
        provider_options_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, provider)
      );

      -- One diagnosis per approved consultation, enforced by the database.
      CREATE TABLE autopilot_consultant_diagnoses (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        consultation_id TEXT NOT NULL UNIQUE REFERENCES autopilot_consultations(id),
        consultant_provider TEXT NOT NULL,
        consultant_session_id TEXT NOT NULL,
        provider_session_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('INTENT','COMPLETED','FAILED','UNCERTAIN')),
        operation_id TEXT,
        prompt_length INTEGER NOT NULL,
        diagnosis TEXT,
        output_length INTEGER,
        output_fingerprint TEXT,
        failure TEXT,
        refused_file_blocks INTEGER NOT NULL DEFAULT 0,
        -- Set once, when a PRIMARY repair turn consumes it. NULL means pending.
        supplied_to_turn_id TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX idx_autopilot_diagnosis_pending
        ON autopilot_consultant_diagnoses(run_id, status, supplied_to_turn_id);
    `
  },
  {
    id: 13,
    name: "worker_process_diagnostics",
    up: `
      -- Bounded, redacted evidence from failed provider processes.
      --
      -- A new table rather than columns on autopilot_operations: the strings are
      -- large, they exist only for failures, and keeping them in one place means
      -- no other table ever duplicates them. Rows written before this migration
      -- simply have no diagnostics, which every reader treats as "none".
      CREATE TABLE autopilot_worker_diagnostics (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        -- One diagnostic per operation, enforced by the database.
        operation_id TEXT NOT NULL UNIQUE REFERENCES autopilot_operations(id),
        provider TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('PRIMARY','CONSULTANT','PROBE')),
        category TEXT NOT NULL,
        exit_code INTEGER,
        signal TEXT,
        -- Already redacted and bounded when written. Never raw provider output.
        stdout_tail TEXT NOT NULL DEFAULT '',
        stderr_tail TEXT NOT NULL DEFAULT '',
        -- What the process actually emitted, before bounding.
        stdout_bytes INTEGER NOT NULL DEFAULT 0,
        stderr_bytes INTEGER NOT NULL DEFAULT 0,
        stdout_truncated INTEGER NOT NULL DEFAULT 0,
        stderr_truncated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_autopilot_worker_diagnostics_run
        ON autopilot_worker_diagnostics(run_id);
    `
  },
  {
    id: 14,
    name: "primary_ownership_and_handoff",
    up: `
      -- Who owns implementation, over time.
      --
      -- The Run Spec stays authoritative and immutable: ownership is separate
      -- durable state, so a handoff never rewrites the spec or its fingerprint.
      -- Exactly one row per run may be ACTIVE, enforced by the database.
      CREATE TABLE autopilot_primary_ownership (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('claude','codex')),
        role TEXT NOT NULL DEFAULT 'PRIMARY' CHECK(role='PRIMARY'),
        -- The PRIMARY session identity for this ownership period. Retained here
        -- when the period ends: autopilot_worker_sends references
        -- autopilot_worker_sessions(run_id), so that row is never deleted.
        session_id TEXT,
        provider_session_id TEXT,
        cwd TEXT,
        established INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','HISTORICAL')),
        handoff_id TEXT,
        started_at TEXT NOT NULL,
        retired_at TEXT,
        UNIQUE(run_id, ordinal)
      );
      CREATE UNIQUE INDEX idx_autopilot_ownership_active
        ON autopilot_primary_ownership(run_id) WHERE status='ACTIVE';

      -- A proposed change of implementation owner. Never activates itself.
      CREATE TABLE autopilot_handoffs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('OPERATOR','SYSTEM_RECOMMENDED')),
        from_provider TEXT NOT NULL CHECK(from_provider IN ('claude','codex')),
        to_provider TEXT NOT NULL CHECK(to_provider IN ('claude','codex')),
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PROPOSED','APPROVED','ACTIVATING','ACTIVE','CANCELLED','SUPERSEDED','FAILED')),
        -- The frozen package and the fingerprint an approval is bound to.
        package_json TEXT NOT NULL,
        package_fingerprint TEXT NOT NULL,
        spec_fingerprint TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        trigger_event_id TEXT NOT NULL REFERENCES autopilot_run_events(id),
        trigger_seq INTEGER NOT NULL,
        from_session_id TEXT,
        to_session_id TEXT,
        approval_source TEXT,
        proposed_at TEXT NOT NULL,
        approved_at TEXT,
        activating_at TEXT,
        activated_at TEXT,
        resolved_at TEXT,
        resolution_source TEXT,
        failure TEXT,
        UNIQUE(run_id, trigger_event_id)
      );
      -- At most one handoff may be in flight for a run at a time.
      CREATE UNIQUE INDEX idx_autopilot_handoff_open
        ON autopilot_handoffs(run_id) WHERE status IN ('PROPOSED','APPROVED','ACTIVATING');
      CREATE INDEX idx_autopilot_handoff_run ON autopilot_handoffs(run_id);
    `
  }
];

const MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS autopilot_schema_migrations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

export interface MigrationResult {
  applied: number[];
  alreadyApplied: number[];
}

/**
 * Applies pending migrations inside a transaction.
 *
 * Safe to call on an empty database and on an existing database that already
 * contains event_log rows: nothing outside the autopilot_* namespace is touched.
 */
export function runAutopilotMigrations(
  db: SqlDatabase,
  now: string,
  migrations: readonly Migration[] = AUTOPILOT_MIGRATIONS
): MigrationResult {
  db.exec(MIGRATION_TABLE);

  const appliedRows = db.prepare("SELECT id FROM autopilot_schema_migrations").all<{ id: number }>();
  const appliedIds = new Set(appliedRows.map((row) => row.id));

  const applied: number[] = [];
  const alreadyApplied: number[] = [];

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      alreadyApplied.push(migration.id);
      continue;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.up);
      db.prepare(
        "INSERT INTO autopilot_schema_migrations (id, name, applied_at) VALUES (:id, :name, :appliedAt)"
      ).run({ id: migration.id, name: migration.name, appliedAt: now });
      db.exec("COMMIT");
      applied.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return { applied, alreadyApplied };
}
