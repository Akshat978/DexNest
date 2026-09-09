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
  },
  {
    id: 15,
    name: "plan_item_progress",
    up: `
      -- Progress against the human's plan.
      --
      -- Item CONTENT lives in the Run Spec and is authoritative and immutable:
      -- no agent may rewrite what it was asked to build. Only STATUS lives
      -- here, because status is runtime state that changes as work proceeds.
      -- A row exists only once an item leaves PENDING.
      CREATE TABLE autopilot_plan_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        -- References RunSpec.plan[].id. Not a foreign key: the spec is JSON,
        -- so a row whose item vanished from the spec is reported as an orphan
        -- rather than silently deleted.
        item_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','DONE','BLOCKED','SKIPPED')),
        note TEXT,
        started_at TEXT NOT NULL,
        settled_at TEXT,
        UNIQUE(run_id, item_id)
      );

      -- At most one item may be in progress per run, enforced by the database
      -- rather than by convention.
      CREATE UNIQUE INDEX idx_autopilot_plan_items_active
        ON autopilot_plan_items(run_id) WHERE status='ACTIVE';

      CREATE INDEX IF NOT EXISTS idx_autopilot_plan_items_run
        ON autopilot_plan_items (run_id);
    `
  },
  {
    id: 16,
    name: "project_branch_workspace",
    up: `
      -- Where a project-branch run branched from.
      --
      -- Working in the project instead of a worktree gives up the free
      -- reversibility of "delete the directory", so the way back has to be
      -- durable instead: the branch the operator was on and the commit the run
      -- started at. Written once and never updated, so a resumed run still
      -- reverts to where it actually began rather than to wherever the project
      -- happened to be at the time of the restart.
      CREATE TABLE autopilot_project_branches (
        run_id      TEXT PRIMARY KEY REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        repo_root   TEXT NOT NULL,
        branch      TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        base_sha    TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
    `
  },
  {
    id: 17,
    name: "attached_provider_sessions",
    up: `
      -- Runs that continue a session the operator already had.
      --
      -- The session identity itself lives in autopilot_worker_sessions, which
      -- already enforces one session per run and one run per session. This
      -- table records only the provenance the operator needs later: where the
      -- conversation came from and what it was called at the moment it was
      -- adopted. Transcript CONTENT is never stored — it is the operator's own
      -- conversation, and DexNest has no reason to keep a copy.
      CREATE TABLE autopilot_attached_sessions (
        run_id          TEXT PRIMARY KEY REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL,
        session_id      TEXT NOT NULL UNIQUE,
        origin          TEXT NOT NULL,
        title           TEXT,
        transcript_path TEXT,
        attached_at     TEXT NOT NULL
      );
    `
  },
  {
    id: 18,
    name: "run_iterations",
    up: `
      -- One durable cycle: assignment, work, verification, checkpoint.
      --
      -- Turns, verifications and checkpoints were already durable but nothing
      -- joined them, so "what happened on iteration 7" meant correlating three
      -- tables by turn id. This is the row that later phases count, bound and
      -- resume against.
      --
      -- It holds POINTERS, not content. The conversation lives in the agent's
      -- own session, which the operator can open; DexNest orchestrates and does
      -- not keep a second, worse copy of a transcript.
      CREATE TABLE autopilot_iterations (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        ordinal         INTEGER NOT NULL,
        plan_item_id    TEXT,
        turn_id         TEXT,
        verification_id TEXT,
        checkpoint_id   TEXT,
        status          TEXT NOT NULL CHECK(status IN ('ACTIVE','VERIFIED','FAILED','INDETERMINATE','ABANDONED')),
        summary         TEXT,
        started_at      TEXT NOT NULL,
        settled_at      TEXT,
        UNIQUE(run_id, ordinal)
      );

      -- One iteration in flight per run, enforced by the database.
      CREATE UNIQUE INDEX idx_autopilot_iterations_active
        ON autopilot_iterations(run_id) WHERE status='ACTIVE';

      CREATE UNIQUE INDEX idx_autopilot_iterations_turn
        ON autopilot_iterations(run_id, turn_id);
    `
  },
  {
    id: 19,
    name: "self_direction_decisions",
    up: `
      -- What the agent said it would do next.
      --
      -- A PROPOSAL ABOUT WORK, never a change of authority. The assignment is
      -- embedded inside a DexNest-authored prompt that restates the
      -- authoritative goal and constraints; it is never sent as the prompt, so
      -- persuasive text here cannot widen the run's scope.
      --
      -- consumed_by_turn_id moves away from NULL exactly once, which is what
      -- makes "an assignment is acted on at most once" survive a restart.
      CREATE TABLE autopilot_direction_decisions (
        id                  TEXT PRIMARY KEY,
        run_id              TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        turn_id             TEXT NOT NULL,
        source              TEXT NOT NULL CHECK(source IN ('self')),
        verb                TEXT NOT NULL CHECK(verb IN ('CONTINUE','PLAN_COMPLETE','NEEDS_HUMAN')),
        assignment          TEXT,
        reason              TEXT,
        plan_item_id        TEXT,
        consumed_by_turn_id TEXT,
        created_at          TEXT NOT NULL
      );

      -- One decision per turn: a second would overwrite what was already acted on.
      CREATE UNIQUE INDEX idx_autopilot_direction_turn
        ON autopilot_direction_decisions(run_id, turn_id);

      CREATE INDEX idx_autopilot_direction_pending
        ON autopilot_direction_decisions(run_id) WHERE consumed_by_turn_id IS NULL;
    `
  },
  {
    id: 20,
    name: "milestone_iteration_budget",
    up: `
      -- The budget a human actually thinks in.
      --
      -- The turn budget stays: it is the safety ceiling that stops a runaway
      -- repair loop. But a turn is an implementation detail — repairs and
      -- context round-trips are turns too — so what an operator authorizes is
      -- ITERATIONS: distinct pieces of work, each with its own assignment,
      -- however many turns it takes to land one.
      --
      -- NULL means the grant predates iteration budgeting and is bounded by
      -- turns alone, so existing runs are unaffected.
      ALTER TABLE autopilot_loop_grants ADD COLUMN max_iterations INTEGER;
    `
  },
  {
    id: 21,
    name: "chat_direction_and_authority",
    up: `
      -- Who decides what happens next, over time.
      --
      -- Deliberately shaped like autopilot_primary_ownership: the Run Spec
      -- stays authoritative and untouched, and switching the source of
      -- direction is separate durable state with a full history. Exactly one
      -- row per run is CURRENT, enforced by the database.
      --
      -- This is the PLANNING axis. Who writes the code is ownership; who
      -- decides what to write next is this. They move independently.
      CREATE TABLE autopilot_direction_authority (
        id         TEXT PRIMARY KEY,
        run_id     TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        ordinal    INTEGER NOT NULL,
        source     TEXT NOT NULL CHECK(source IN ('self','chat')),
        status     TEXT NOT NULL CHECK(status IN ('CURRENT','HISTORICAL')),
        reason     TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at   TEXT,
        UNIQUE(run_id, ordinal)
      );
      CREATE UNIQUE INDEX idx_autopilot_direction_authority_current
        ON autopilot_direction_authority(run_id) WHERE status='CURRENT';

      -- The chat that writes assignments.
      --
      -- A separate session from the worker's, and read-only: it never receives
      -- a workspace, never emits files, and its answer is parsed only as a
      -- decision. One per run, sticky so the conversation accumulates the
      -- project's history the way a human's chat would.
      CREATE TABLE autopilot_director_sessions (
        run_id              TEXT PRIMARY KEY REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        provider            TEXT NOT NULL CHECK(provider IN ('claude','codex')),
        session_id          TEXT NOT NULL UNIQUE,
        provider_session_id TEXT,
        cwd                 TEXT NOT NULL,
        established         INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL
      );

      -- Widen the decision source to include the chat.
      --
      -- SQLite cannot alter a CHECK constraint, so the table is rebuilt rather
      -- than left with a constraint that forbids the feature. Rows are copied
      -- first: existing decisions are evidence of what a run was told to do and
      -- are not disposable.
      CREATE TABLE autopilot_direction_decisions_new (
        id                  TEXT PRIMARY KEY,
        run_id              TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        turn_id             TEXT NOT NULL,
        source              TEXT NOT NULL CHECK(source IN ('self','chat')),
        verb                TEXT NOT NULL CHECK(verb IN ('CONTINUE','PLAN_COMPLETE','NEEDS_HUMAN')),
        assignment          TEXT,
        reason              TEXT,
        plan_item_id        TEXT,
        consumed_by_turn_id TEXT,
        created_at          TEXT NOT NULL
      );
      INSERT INTO autopilot_direction_decisions_new
        SELECT id, run_id, turn_id, source, verb, assignment, reason, plan_item_id, consumed_by_turn_id, created_at
          FROM autopilot_direction_decisions;
      DROP TABLE autopilot_direction_decisions;
      ALTER TABLE autopilot_direction_decisions_new RENAME TO autopilot_direction_decisions;

      CREATE UNIQUE INDEX idx_autopilot_direction_turn
        ON autopilot_direction_decisions(run_id, turn_id);
      CREATE INDEX idx_autopilot_direction_pending
        ON autopilot_direction_decisions(run_id) WHERE consumed_by_turn_id IS NULL;
    `
  },
  {
    id: 22,
    name: "unattended_operation",
    up: `
      -- Decisions the agent made because it could not ask.
      --
      -- A question at 3am is a stall, so the agent chooses and writes down what
      -- it assumed. These are the morning's review list: the operator reads a
      -- handful of decisions instead of a whole conversation.
      CREATE TABLE autopilot_assumptions (
        id           TEXT PRIMARY KEY,
        run_id       TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        turn_id      TEXT NOT NULL,
        iteration_id TEXT,
        text         TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_autopilot_assumptions_run ON autopilot_assumptions(run_id);

      -- When to try a limited provider again.
      --
      -- One row per waiting run, replaced as the backoff escalates, deleted the
      -- moment the run moves on. It records a WAIT, never an authorization: the
      -- grant is untouched, so waiting out a limit can never buy a run more
      -- work than a human allowed it.
      CREATE TABLE autopilot_resume_schedule (
        run_id     TEXT PRIMARY KEY REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        attempt    INTEGER NOT NULL,
        not_before TEXT NOT NULL,
        reason     TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_autopilot_resume_due ON autopilot_resume_schedule(not_before);
    `
  },
  {
    id: 23,
    name: "answerable_stop_conditions",
    up: `
      -- Bounds an operator can actually answer before pressing start.
      --
      -- "How many iterations" is unanswerable on work you have not done yet,
      -- so it was always a guess standing in for something else. These are the
      -- questions that DO have honest answers at midnight: when do I want this
      -- to stop, how much am I willing to spend, and how long should it keep
      -- trying without getting anywhere.
      --
      -- All NULL means bounded by turns and iterations alone, exactly as
      -- before, so existing grants are unaffected.
      ALTER TABLE autopilot_loop_grants ADD COLUMN stop_at TEXT;
      ALTER TABLE autopilot_loop_grants ADD COLUMN max_cost_usd REAL;
      -- Turns since anything last verified. Counting unverified ITERATIONS
      -- would never fire: a piece of work that never passes never settles.
      ALTER TABLE autopilot_loop_grants ADD COLUMN max_idle_turns INTEGER;

      -- What each turn cost, as the provider reported it.
      --
      -- On a subscription this is the API-equivalent value the CLI reports,
      -- not a bill. It is a usage proxy, and it is the only per-turn number
      -- available, so the cost budget is expressed in it and described as such
      -- wherever an operator sees it.
      ALTER TABLE autopilot_turns ADD COLUMN cost_usd REAL;
    `
  },
  {
    id: 24,
    name: "operator_notes",
    up: `
      -- What a person says before letting a run carry on.
      --
      -- Reading a stopped run almost always produces a sentence, and until now
      -- there was nowhere to put it: editing the Run Spec is the wrong
      -- instrument because the goal has not changed, and typing into the
      -- agent's session by hand is the manual shuttling this exists to remove.
      --
      -- Consumed exactly once, like an assignment and a diagnosis:
      -- consumed_by_turn_id can only move away from NULL a single time. A note
      -- that reappeared every turn would read as a standing instruction, which
      -- is not what one sentence at breakfast meant.
      CREATE TABLE IF NOT EXISTS autopilot_operator_notes (
        id                  TEXT PRIMARY KEY,
        run_id              TEXT NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
        text                TEXT NOT NULL,
        -- Free text. DexNest has no accounts, and "operator" is honest about
        -- that in a way a fabricated identity would not be.
        author              TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        consumed_by_turn_id TEXT REFERENCES autopilot_turns(id)
      );
      CREATE INDEX IF NOT EXISTS idx_operator_notes_run
        ON autopilot_operator_notes(run_id, consumed_by_turn_id);
    `
  },
  {
    id: 25,
    name: "run_queue",
    up: `
      -- Several projects in one night, on one budget.
      --
      -- An authorization covers one run in one repository, which is why an
      -- overnight session could only ever improve one project. A queue is the
      -- ordered list, and the budget spans it rather than each run getting its
      -- own: three projects share one deadline and one spend cap.
      CREATE TABLE IF NOT EXISTS autopilot_run_queues (
        id                       TEXT PRIMARY KEY,
        status                   TEXT NOT NULL CHECK(status IN ('ACTIVE','CLOSED')),
        deadline                 TEXT,
        max_cost_usd             REAL,
        max_items                INTEGER,
        max_consecutive_failures INTEGER,
        -- How every run in this queue is set up. One template, because a queue
        -- is "do the same thing to these projects" -- if two projects needed
        -- different models they were never one night's work.
        model                    TEXT,
        effort                   TEXT,
        max_turns                INTEGER NOT NULL DEFAULT 50,
        max_iterations           INTEGER NOT NULL DEFAULT 25,
        max_idle_turns           INTEGER NOT NULL DEFAULT 5,
        max_failures             INTEGER NOT NULL DEFAULT 5,
        created_at               TEXT NOT NULL,
        closed_at                TEXT,
        closed_reason            TEXT
      );

      -- The item row is the ONLY place an item's status lives. The decision
      -- engine takes "records" as input, and those are built from these rows
      -- every time rather than stored a second time -- two places holding the
      -- same truth is how they come to disagree, and a queue that thought an
      -- item was PENDING while the row said DONE would start work twice.
      CREATE TABLE IF NOT EXISTS autopilot_run_queue_items (
        id           TEXT PRIMARY KEY,
        queue_id     TEXT NOT NULL REFERENCES autopilot_run_queues(id) ON DELETE CASCADE,
        ordinal      INTEGER NOT NULL,
        project_path TEXT NOT NULL,
        goal         TEXT NOT NULL,
        plan_text    TEXT,
        label        TEXT,
        status       TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','DONE','FAILED','SKIPPED','ABANDONED')),
        started_at   TEXT,
        settled_at   TEXT,
        reason       TEXT,
        -- Set when the item becomes a real run. Unique, so one run can never
        -- be claimed by two items.
        run_id       TEXT UNIQUE REFERENCES autopilot_runs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_queue_items_queue
        ON autopilot_run_queue_items(queue_id, ordinal);
    `
  },
  {
    id: 26,
    name: "manual_resume_after_provider_limit",
    up: `
      -- Who decides when a run continues after the provider says no.
      --
      -- Running out of capacity used to schedule its own retry, on a backoff of
      -- 15/30/60/120/240 minutes, and there was no way to say "try now" —
      -- retryProviderLimit was passed only by that timer. So the one decision
      -- the operator most wanted (it is back, carry on) was the one they could
      -- not make.
      --
      -- Waiting is still the right answer for a genuinely unattended night, so
      -- it stays available. It is no longer the default: 0 means the run holds
      -- until a person says otherwise.
      ALTER TABLE autopilot_loop_grants ADD COLUMN auto_resume_on_limit INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    id: 27,
    name: "rotate_session_between_phases",
    up: `
      -- Whether each piece of work gets a fresh conversation.
      --
      -- One session resumed across a whole run means every model call carries
      -- every phase before it. Measured on a real 22-phase night: context per
      -- call grew from 12k tokens to 165k, a 14x climb, 11.7M input tokens
      -- across 144 calls, growing almost perfectly linearly. That is what
      -- paying for your own history looks like.
      --
      -- The digest exists precisely so a phase does not need the transcript:
      -- what carries forward is the code on disk and the record of what was
      -- done and decided. So rotation is the default, and 0 opts out.
      --
      -- Rotation happens ONLY between settled pieces of work. A repair turn
      -- keeps its session, because repairing needs the failure in context.
      ALTER TABLE autopilot_loop_grants ADD COLUMN rotate_session INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    id: 28,
    name: "queue_schedule",
    up: `
      -- When a queue comes back on its own.
      --
      -- The engine could already parse "nightly at 01:00" and work out when it
      -- next fires; nothing called either function, so a queue still needed a
      -- person to press start every evening. That is most of what "run this
      -- automation nightly" was supposed to mean.
      --
      -- Stored as the operator's own words rather than a parsed shape: it is
      -- what they typed, it is what the UI shows back, and re-parsing it costs
      -- nothing. A queue with no schedule runs once, exactly as before.
      ALTER TABLE autopilot_run_queues ADD COLUMN schedule TEXT;

      -- Which queue this one repeats. Set on every queue a schedule created,
      -- so a night's history is its own row rather than a reset of the last
      -- one -- a queue that erased last night to run tonight would leave the
      -- morning summary describing work nobody can go back and read.
      ALTER TABLE autopilot_run_queues ADD COLUMN repeats_queue_id TEXT;
    `
  },
  {
    id: 29,
    name: "attention_deliveries",
    up: `
      -- What has already been said, so a cooldown means something.
      --
      -- The attention engine decides what deserves telling someone about, and
      -- one of its rules is "I already told you twenty minutes ago". That rule
      -- needs a memory surviving a restart, or every launch would repeat the
      -- night's news.
      --
      -- Only the group key, the priority it went out at, and when. Not the
      -- text: an item is re-derived from the run's own durable state, and
      -- storing a rendered sentence would give the same truth two homes.
      CREATE TABLE IF NOT EXISTS autopilot_attention_deliveries (
        group_key    TEXT NOT NULL,
        priority     TEXT NOT NULL CHECK(priority IN ('INFO','ATTENTION','ACTION_REQUIRED','URGENT')),
        delivered_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attention_deliveries_group
        ON autopilot_attention_deliveries(group_key, delivered_at);
    `
  },
  {
    id: 30,
    name: "devices",
    up: `
      -- The phones DexNest may speak to.
      --
      -- A push token names one installation of one app on one device. It is
      -- issued by the device, rotates on reinstall, and is useless without the
      -- sending credentials -- but it still names a device the operator owns,
      -- so it is durable state with a history rather than a value in memory.
      --
      -- Registering grants nothing. It says "send notifications here". Reading
      -- a run or answering a question happens over the control path, with its
      -- own token and its own capabilities, which is a separate decision made
      -- later and deliberately not this one.
      CREATE TABLE IF NOT EXISTS autopilot_devices (
        id            TEXT PRIMARY KEY,
        label         TEXT NOT NULL,
        platform      TEXT NOT NULL,
        -- Unique: two records for one device would double every notification.
        push_token    TEXT NOT NULL UNIQUE,
        status        TEXT NOT NULL CHECK(status IN ('ACTIVE','DISABLED')),
        registered_at TEXT NOT NULL,
        last_sent_at  TEXT,
        -- Why FCM last refused it. A rejected token is evidence, not noise, so
        -- a dead device is disabled rather than deleted.
        last_failure  TEXT
      );
    `
  },
  {
    id: 31,
    name: "device_pairing",
    up: `
      -- Letting a phone talk back.
      --
      -- Until now a device was only somewhere to SEND to, and the push token it
      -- registered granted nothing: a token is useless without the sending
      -- credentials, which never leave this machine. Reading a run or answering
      -- a question is the other direction, and needs real authority.
      --
      -- Stored as a hash, never the token itself. The phone is shown it once at
      -- pairing and keeps it in Android's keystore; a database anyone can read
      -- should not also be a database anyone can authenticate with.
      ALTER TABLE autopilot_devices ADD COLUMN token_hash TEXT;

      -- Read and control are separate grants, and a device starts with read.
      -- Being able to see that a run is blocked is a much smaller thing to hand
      -- a phone than being able to stop one, and bundling them would mean
      -- deciding both at the moment someone is fumbling with a pairing code.
      ALTER TABLE autopilot_devices ADD COLUMN capabilities TEXT NOT NULL DEFAULT 'read';
      ALTER TABLE autopilot_devices ADD COLUMN paired_at TEXT;
      ALTER TABLE autopilot_devices ADD COLUMN last_seen_at TEXT;

      -- A short-lived code the operator reads off the desktop and types into
      -- the phone. Single use and expiring, because a pairing code that
      -- outlived its moment would be a password nobody remembers setting.
      CREATE TABLE IF NOT EXISTS autopilot_pairings (
        code       TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at    TEXT,
        device_id  TEXT REFERENCES autopilot_devices(id)
      );
    `
  },
  {
    id: 32,
    name: "existing_pairings_keep_drop",
    up: `
      -- Drop became its own capability after these devices had already paired.
      --
      -- New pairings are granted 'read,drop', but a phone paired before that
      -- change still says only 'read' — so the Drop gate refused it and fell
      -- through to the localhost-only rule, telling the operator to enable LAN
      -- exposure to fix something that was not a network problem at all.
      --
      -- Only devices that actually hold a token are touched. A row with no
      -- token_hash is a push target that was never paired, and granting it a
      -- capability would be inventing authority nobody conferred.
      UPDATE autopilot_devices
         SET capabilities = capabilities || ',drop'
       WHERE token_hash IS NOT NULL
         AND capabilities NOT LIKE '%drop%';
    `
  },
  {
    id: 33,
    name: "attention_snoozes",
    up: `
      -- "Not now" as a durable fact.
      --
      -- A snooze is per QUESTION, not per run. A group key is one per run,
      -- so keying on it alone meant "not now" to a completion proposal also
      -- silenced a worker failure that arrived an hour later on the same run
      -- — a different question the operator never heard. The question text
      -- is part of the key: the same question re-asked stays quiet, anything
      -- new gets through.
      --
      -- Kept here rather than on the phone so the desktop panel and every
      -- paired device agree about what has been put off. A snooze only one
      -- screen knew about would be a notification that arrived anyway on the
      -- other.
      CREATE TABLE IF NOT EXISTS autopilot_attention_snoozes (
        group_key  TEXT NOT NULL,
        question   TEXT NOT NULL,
        run_id     TEXT,
        until      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (group_key, question)
      );
    `
  },
  {
    id: 34,
    name: "auto_accept_complete",
    up: `
      -- Letting a run that finished cleanly finish itself.
      --
      -- A grant already carries the bounds an operator can answer before
      -- pressing start; this is another of them. Default 0, because a run
      -- completing without anyone looking is a decision rather than a
      -- convenience, and the default has to be the one that asks.
      ALTER TABLE autopilot_loop_grants ADD COLUMN auto_accept_complete INTEGER NOT NULL DEFAULT 0;
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
