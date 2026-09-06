// Durable persistence for runs, the append-only journal and step records.
//
// Every state change is written together with its journal event in a single
// transaction. There is no code path that changes a run's state without
// appending the corresponding event, so the journal is a complete history rather
// than a best-effort log.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { RunEventType, RunState, StepStatus } from "./states.ts";
import { assertTransition } from "./states.ts";
import type { RunSpec } from "./runSpec.ts";
import { authoritativeFingerprint } from "./runSpec.ts";
import { ConsultationStore, isConsultationEvidence } from "./consultations.ts";
import { HandoffStore } from "./handoff.ts";

export interface RunRecord {
  id: string;
  state: RunState;
  spec: RunSpec;
  specFingerprint: string;
  specRevision: number;
  executorId: string;
  projectId: string | null;
  goal: string;
  eventSeq: number;
  pauseRequested: boolean;
  stopRequested: boolean;
  reconcileReason: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  seq: number;
  type: RunEventType;
  fromState: RunState | null;
  toState: RunState | null;
  stepKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface StepRecord {
  id: string;
  runId: string;
  stepKey: string;
  ordinal: number;
  status: StepStatus;
  idempotencyKey: string;
  attempts: number;
  summary: string | null;
  detail: Record<string, unknown> | null;
  intentAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RunRow {
  id: string;
  state: string;
  spec_json: string;
  spec_fingerprint: string;
  spec_revision: number;
  executor_id: string;
  project_id: string | null;
  goal: string;
  event_seq: number;
  pause_requested: number;
  stop_requested: number;
  reconcile_reason: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  run_id: string;
  seq: number;
  type: string;
  from_state: string | null;
  to_state: string | null;
  step_key: string | null;
  payload_json: string;
  created_at: string;
}

interface StepRow {
  id: string;
  run_id: string;
  step_key: string;
  ordinal: number;
  status: string;
  idempotency_key: string;
  attempts: number;
  summary: string | null;
  detail_json: string | null;
  intent_at: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

function toRunRecord(row: RunRow): RunRecord {
  const spec = JSON.parse(row.spec_json) as RunSpec & { provider?: string };
  if (!spec.workers && (spec.provider === "claude" || spec.provider === "codex")) {
    spec.workers = { primary: spec.provider, fallback: null, sticky: true, consultantMode: false };
  }
  return {
    id: row.id,
    state: row.state as RunState,
    spec,
    specFingerprint: row.spec_fingerprint,
    specRevision: row.spec_revision,
    executorId: row.executor_id,
    projectId: row.project_id,
    goal: row.goal,
    eventSeq: row.event_seq,
    pauseRequested: row.pause_requested === 1,
    stopRequested: row.stop_requested === 1,
    reconcileReason: row.reconcile_reason,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toEventRecord(row: EventRow): RunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    type: row.type as RunEventType,
    fromState: row.from_state as RunState | null,
    toState: row.to_state as RunState | null,
    stepKey: row.step_key,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at
  };
}

function toStepRecord(row: StepRow): StepRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    ordinal: row.ordinal,
    status: row.status as StepStatus,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    summary: row.summary,
    detail: row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null,
    intentAt: row.intent_at,
    settledAt: row.settled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface AppendEventInput {
  type: RunEventType;
  toState?: RunState;
  stepKey?: string | null;
  payload?: Record<string, unknown>;
  /** Flags written atomically with the transition. */
  pauseRequested?: boolean;
  stopRequested?: boolean;
  reconcileReason?: string | null;
  failureReason?: string | null;
}

/** Transaction depth per database connection; see AutopilotStore.transaction. */
const TRANSACTION_DEPTH = new WeakMap<object, number>();

export class AutopilotStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
  }

  /**
   * Runs `work` inside one database transaction.
   *
   * Nested calls join the outermost transaction instead of failing. SQLite has
   * no nested transactions, and stores are constructed per call site, so the
   * depth is tracked per connection rather than per instance. This makes a
   * composite operation — an ownership handoff retires a session, opens the next
   * ownership period, closes one grant and issues another — commit or roll back
   * as a single unit, which is what "never two owners" requires.
   */
  transaction<T>(work: () => T): T {
    const depth = TRANSACTION_DEPTH.get(this.db) ?? 0;
    if (depth > 0) {
      TRANSACTION_DEPTH.set(this.db, depth + 1);
      try {
        return work();
      } finally {
        TRANSACTION_DEPTH.set(this.db, (TRANSACTION_DEPTH.get(this.db) ?? 1) - 1);
      }
    }

    this.db.exec("BEGIN IMMEDIATE");
    TRANSACTION_DEPTH.set(this.db, 1);
    try {
      const result = work();
      TRANSACTION_DEPTH.set(this.db, 0);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      TRANSACTION_DEPTH.set(this.db, 0);
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // A rollback failure must not mask the original error.
      }
      throw error;
    }
  }

  createRun(input: { spec: RunSpec; executorId: string }): RunRecord {
    const now = this.ports.clock.now();
    const fingerprint = authoritativeFingerprint(input.spec);

    return this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO autopilot_runs
             (id, state, spec_json, spec_fingerprint, spec_revision, executor_id, project_id,
              goal, event_seq, pause_requested, stop_requested, reconcile_reason, failure_reason,
              created_at, updated_at)
           VALUES
             (:id, 'CREATED', :specJson, :fingerprint, :revision, :executorId, :projectId,
              :goal, 0, 0, 0, NULL, NULL, :now, :now)`
        )
        .run({
          id: input.spec.id,
          specJson: JSON.stringify(input.spec),
          fingerprint,
          revision: input.spec.revision,
          executorId: input.executorId,
          projectId: input.spec.projectId,
          goal: input.spec.goal,
          now
        });

      this.appendEventUnsafe(input.spec.id, "CREATED", {
        type: "RUN_CREATED",
        payload: { specFingerprint: fingerprint, specRevision: input.spec.revision }
      });

      return this.requireRunUnsafe(input.spec.id);
    });
  }

  getRun(runId: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM autopilot_runs WHERE id = :id").get<RunRow>({ id: runId });
    return row ? toRunRecord(row) : null;
  }

  requireRun(runId: string): RunRecord {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Autopilot run ${runId} was not found.`);
    }
    return run;
  }

  private requireRunUnsafe(runId: string): RunRecord {
    return this.requireRun(runId);
  }

  listRuns(limit = 50): RunRecord[] {
    return this.db
      .prepare("SELECT * FROM autopilot_runs ORDER BY created_at DESC LIMIT :limit")
      .all<RunRow>({ limit })
      .map(toRunRecord);
  }

  /** Runs left mid-flight by a crash: everything not in a terminal state. */
  listUnfinishedRuns(): RunRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM autopilot_runs
         WHERE state NOT IN ('STOPPED', 'COMPLETED', 'FAILED')
         ORDER BY created_at ASC`
      )
      .all<RunRow>()
      .map(toRunRecord);
  }

  listEvents(runId: string): RunEventRecord[] {
    return this.db
      .prepare("SELECT * FROM autopilot_run_events WHERE run_id = :runId ORDER BY seq ASC")
      .all<EventRow>({ runId })
      .map(toEventRecord);
  }

  listSteps(runId: string): StepRecord[] {
    return this.db
      .prepare("SELECT * FROM autopilot_run_steps WHERE run_id = :runId ORDER BY ordinal ASC")
      .all<StepRow>({ runId })
      .map(toStepRecord);
  }

  getStep(runId: string, stepKey: string): StepRecord | null {
    const row = this.db
      .prepare("SELECT * FROM autopilot_run_steps WHERE run_id = :runId AND step_key = :stepKey")
      .get<StepRow>({ runId, stepKey });
    return row ? toStepRecord(row) : null;
  }

  /**
   * Appends a journal event and, when `toState` is present, transitions the run.
   * Both happen in one transaction; a caller can never record one without the
   * other.
   */
  appendEvent(runId: string, input: AppendEventInput): RunEventRecord {
    return this.transaction(() => {
      const run = this.requireRun(runId);
      return this.appendEventUnsafe(runId, run.state, input);
    });
  }

  /** Caller must already hold a transaction. */
  appendEventUnsafe(runId: string, fromState: RunState, input: AppendEventInput): RunEventRecord {
    const now = this.ports.clock.now();
    const toState = input.toState ?? null;

    if (toState && toState !== fromState) {
      assertTransition(fromState, toState);
    }

    const seqRow = this.db
      .prepare("SELECT event_seq FROM autopilot_runs WHERE id = :id")
      .get<{ event_seq: number }>({ id: runId });
    if (!seqRow) {
      throw new Error(`Autopilot run ${runId} was not found.`);
    }
    const seq = seqRow.event_seq + 1;

    const eventId = this.ports.ids.next("ap-evt");
    this.db
      .prepare(
        `INSERT INTO autopilot_run_events
           (id, run_id, seq, type, from_state, to_state, step_key, payload_json, created_at)
         VALUES
           (:id, :runId, :seq, :type, :fromState, :toState, :stepKey, :payloadJson, :now)`
      )
      .run({
        id: eventId,
        runId,
        seq,
        type: input.type,
        fromState,
        toState,
        stepKey: input.stepKey ?? null,
        payloadJson: JSON.stringify(input.payload ?? {}),
        now
      });

    const assignments: string[] = ["event_seq = :seq", "updated_at = :now"];
    const params: Record<string, unknown> = { id: runId, seq, now };

    if (toState) {
      assignments.push("state = :state");
      params.state = toState;
    }
    if (input.pauseRequested !== undefined) {
      assignments.push("pause_requested = :pauseRequested");
      params.pauseRequested = input.pauseRequested ? 1 : 0;
    }
    if (input.stopRequested !== undefined) {
      assignments.push("stop_requested = :stopRequested");
      params.stopRequested = input.stopRequested ? 1 : 0;
    }
    if (input.reconcileReason !== undefined) {
      assignments.push("reconcile_reason = :reconcileReason");
      params.reconcileReason = input.reconcileReason;
    }
    if (input.failureReason !== undefined) {
      assignments.push("failure_reason = :failureReason");
      params.failureReason = input.failureReason;
    }

    this.db.prepare(`UPDATE autopilot_runs SET ${assignments.join(", ")} WHERE id = :id`).run(params);

    // Consultation state and its audit events commit with PRIMARY evidence.
    // Consultation events are not evidence triggers, so this cannot recurse.
    if (isConsultationEvidence({ type: input.type, payload: input.payload ?? {} })) {
      new ConsultationStore(this.ports).reconcileUnsafe(runId);
      new HandoffStore(this.ports).reconcile(runId);
    }

    return {
      id: eventId,
      runId,
      seq,
      type: input.type,
      fromState,
      toState: toState as RunState | null,
      stepKey: input.stepKey ?? null,
      payload: input.payload ?? {},
      createdAt: now
    };
  }

  /**
   * Journals the intent to execute a step and commits before the caller performs
   * any side effect. The UNIQUE (run_id, step_key) index makes a second intent
   * for the same logical step impossible, so a restart cannot create a duplicate
   * logical execution.
   *
   * Returns null when the step already exists — the caller must then inspect its
   * status rather than executing.
   */
  recordStepIntent(input: {
    runId: string;
    stepKey: string;
    ordinal: number;
    idempotencyKey: string;
  }): StepRecord | null {
    return this.transaction(() => {
      const existing = this.getStep(input.runId, input.stepKey);
      if (existing) {
        return null;
      }

      const now = this.ports.clock.now();
      const run = this.requireRun(input.runId);

      this.db
        .prepare(
          `INSERT INTO autopilot_run_steps
             (id, run_id, step_key, ordinal, status, idempotency_key, attempts,
              summary, detail_json, intent_at, settled_at, created_at, updated_at)
           VALUES
             (:id, :runId, :stepKey, :ordinal, 'INTENT', :idempotencyKey, 0,
              NULL, NULL, :now, NULL, :now, :now)`
        )
        .run({
          id: this.ports.ids.next("ap-step"),
          runId: input.runId,
          stepKey: input.stepKey,
          ordinal: input.ordinal,
          idempotencyKey: input.idempotencyKey,
          now
        });

      this.appendEventUnsafe(input.runId, run.state, {
        type: "STEP_INTENT_RECORDED",
        stepKey: input.stepKey,
        payload: { idempotencyKey: input.idempotencyKey, ordinal: input.ordinal }
      });

      const step = this.getStep(input.runId, input.stepKey);
      if (!step) {
        throw new Error(`Step ${input.stepKey} vanished immediately after insert.`);
      }
      return step;
    });
  }

  updateStep(input: {
    runId: string;
    stepKey: string;
    status: StepStatus;
    summary?: string | null;
    detail?: Record<string, unknown> | null;
    incrementAttempts?: boolean;
    settled?: boolean;
    event?: { type: RunEventType; toState?: RunState; payload?: Record<string, unknown> };
  }): StepRecord {
    return this.transaction(() => {
      const now = this.ports.clock.now();
      const run = this.requireRun(input.runId);

      const assignments = ["status = :status", "updated_at = :now"];
      const params: Record<string, unknown> = {
        runId: input.runId,
        stepKey: input.stepKey,
        status: input.status,
        now
      };

      if (input.summary !== undefined) {
        assignments.push("summary = :summary");
        params.summary = input.summary;
      }
      if (input.detail !== undefined) {
        assignments.push("detail_json = :detailJson");
        params.detailJson = input.detail ? JSON.stringify(input.detail) : null;
      }
      if (input.incrementAttempts) {
        assignments.push("attempts = attempts + 1");
      }
      if (input.settled) {
        assignments.push("settled_at = :now");
      }

      this.db
        .prepare(`UPDATE autopilot_run_steps SET ${assignments.join(", ")} WHERE run_id = :runId AND step_key = :stepKey`)
        .run(params);

      if (input.event) {
        this.appendEventUnsafe(input.runId, run.state, {
          type: input.event.type,
          toState: input.event.toState,
          stepKey: input.stepKey,
          payload: input.event.payload
        });
      }

      const step = this.getStep(input.runId, input.stepKey);
      if (!step) {
        throw new Error(`Step ${input.stepKey} was not found for run ${input.runId}.`);
      }
      return step;
    });
  }
}
