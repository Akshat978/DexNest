// Durable state for the autonomous loop: grants, turns and verification runs.
//
// The grant is the authority object. Budget usage is DERIVED by counting turns
// whose grant_consumed flag is set, so a crash between consuming and sending can
// never double-spend: consumption is idempotent per turn.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import { assertPrimary, type WorkerRole } from "./roles.ts";
import { OwnershipStore } from "./handoff.ts";
import type { VerificationReport } from "./verification.ts";

export type LoopGrantStatus = "ACTIVE" | "EXHAUSTED" | "REVOKED" | "COMPLETED";
export type TurnKind = "INITIAL" | "REPAIR";
export type TurnStatus =
  | "PLANNED"
  | "SENT"
  | "VERIFIED"
  | "FAILED_VERIFICATION"
  | "UNCERTAIN"
  | "ABANDONED"
  /** The worker only asked for more context; settled, so the loop moves on. */
  | "REQUESTED_CONTEXT";

export interface LoopGrant {
  role?: WorkerRole;
  id: string;
  runId: string;
  provider: string;
  sessionId: string;
  workspaceRoot: string;
  maxTurns: number;
  turnsUsed: number;
  status: LoopGrantStatus;
  grantedBy: string;
  grantedAt: string;
  closedAt: string | null;
  closedReason: string | null;
}

export interface TurnRecord {
  id: string;
  runId: string;
  grantId: string;
  ordinal: number;
  kind: TurnKind;
  prompt: string;
  sendId: string | null;
  status: TurnStatus;
  grantConsumed: boolean;
  verificationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationRecord {
  id: string;
  runId: string;
  turnId: string;
  outcome: string;
  summary: string;
  report: VerificationReport;
  createdAt: string;
}

interface GrantRow {
  role: WorkerRole;
  id: string; run_id: string; provider: string; session_id: string; workspace_root: string;
  max_turns: number; status: string; granted_by: string; granted_at: string;
  closed_at: string | null; closed_reason: string | null;
}
interface TurnRow {
  id: string; run_id: string; grant_id: string; ordinal: number; kind: string; prompt_text: string;
  send_id: string | null; status: string; grant_consumed: number; verification_id: string | null;
  created_at: string; updated_at: string;
}
interface VerificationRow {
  id: string; run_id: string; turn_id: string; outcome: string; summary: string;
  tiers_json: string; created_at: string;
}

export class LoopStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private toGrant(row: GrantRow): LoopGrant {
    const used = this.db
      .prepare("SELECT COUNT(*) AS used FROM autopilot_turns WHERE grant_id = :grantId AND grant_consumed = 1")
      .get<{ used: number }>({ grantId: row.id });
    return {
      role: row.role ?? "PRIMARY",
      id: row.id,
      runId: row.run_id,
      provider: row.provider,
      sessionId: row.session_id,
      workspaceRoot: row.workspace_root,
      maxTurns: row.max_turns,
      turnsUsed: used?.used ?? 0,
      status: row.status as LoopGrantStatus,
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
      closedAt: row.closed_at,
      closedReason: row.closed_reason
    };
  }

  /**
   * Creates the loop authorization. This is a human act and the only thing that
   * lets turns proceed without a per-turn button press.
   */
  grant(input: {
    role?: WorkerRole;
    runId: string;
    provider: string;
    sessionId: string;
    workspaceRoot: string;
    maxTurns: number;
    grantedBy: string;
  }): LoopGrant {
    assertPrimary(input.role);
    // Ownership decides this, so a grant issued to a displaced provider is
    // refused and a grant for the new owner is allowed after a handoff.
    if (new OwnershipStore(this.ports).primaryProvider(input.runId, this.store.requireRun(input.runId).spec) !== input.provider) {
      throw new Error("Only the PRIMARY provider may receive a LoopGrant.");
    }
    if (!Number.isInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 50) {
      throw new Error("A loop grant must authorize between 1 and 50 turns.");
    }
    if (!input.grantedBy.trim()) throw new Error("A loop grant must record who granted it.");

    return this.store.transaction(() => {
      if (this.activeGrant(input.runId)) throw new Error("This run already has an active loop grant.");
      const id = this.ports.ids.next("loop-grant");
      const now = this.ports.clock.now();
      this.db
        .prepare(
          `INSERT INTO autopilot_loop_grants
             (id, run_id, provider, session_id, workspace_root, max_turns, status, granted_by, granted_at)
           VALUES (:id, :runId, :provider, :sessionId, :workspaceRoot, :maxTurns, 'ACTIVE', :grantedBy, :now)`
        )
        .run({ runId: input.runId, provider: input.provider, sessionId: input.sessionId, workspaceRoot: input.workspaceRoot, maxTurns: input.maxTurns, grantedBy: input.grantedBy, id, now });

      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: "LOOP_GRANTED",
        payload: {
          grantId: id,
          provider: input.provider,
          sessionId: input.sessionId,
          maxTurns: input.maxTurns,
          grantedBy: input.grantedBy
        }
      });
      return this.requireGrant(id);
    });
  }

  activeGrant(runId: string): LoopGrant | null {
    const row = this.db
      .prepare("SELECT * FROM autopilot_loop_grants WHERE run_id = :runId AND status = 'ACTIVE'")
      .get<GrantRow>({ runId });
    return row ? this.toGrant(row) : null;
  }

  requireGrant(grantId: string): LoopGrant {
    const row = this.db.prepare("SELECT * FROM autopilot_loop_grants WHERE id = :id").get<GrantRow>({ id: grantId });
    if (!row) throw new Error(`Loop grant ${grantId} was not found.`);
    return this.toGrant(row);
  }

  grants(runId: string): LoopGrant[] {
    return this.db
      .prepare("SELECT * FROM autopilot_loop_grants WHERE run_id = :runId ORDER BY granted_at, rowid")
      .all<GrantRow>({ runId })
      .map((row) => this.toGrant(row));
  }

  /** Closes a grant. Revocation is immediate and irreversible for that grant. */
  /** Closes whatever grant is active for a run, if any. Unsafe: caller holds the transaction. */
  close(runId: string, reason: string): void {
    const active = this.activeGrant(runId);
    if (active) this.closeGrant({ grantId: active.id, status: "REVOKED", reason });
  }

  closeGrant(input: { grantId: string; status: Exclude<LoopGrantStatus, "ACTIVE">; reason: string }): LoopGrant {
    return this.store.transaction(() => {
      const grant = this.requireGrant(input.grantId);
      if (grant.status !== "ACTIVE") return grant;
      this.db
        .prepare("UPDATE autopilot_loop_grants SET status = :status, closed_at = :now, closed_reason = :reason WHERE id = :id AND status = 'ACTIVE'")
        .run({ id: grant.id, status: input.status, now: this.ports.clock.now(), reason: input.reason });
      const run = this.store.requireRun(grant.runId);
      this.store.appendEventUnsafe(grant.runId, run.state, {
        type: input.status === "REVOKED" ? "LOOP_REVOKED" : "LOOP_TURN_LIMIT_REACHED",
        payload: { grantId: grant.id, status: input.status, reason: input.reason, turnsUsed: grant.turnsUsed }
      });
      return this.requireGrant(grant.id);
    });
  }

  turns(runId: string): TurnRecord[] {
    return this.db
      .prepare("SELECT * FROM autopilot_turns WHERE run_id = :runId ORDER BY ordinal")
      .all<TurnRow>({ runId })
      .map((row) => this.toTurn(row));
  }

  turn(turnId: string): TurnRecord | null {
    const row = this.db.prepare("SELECT * FROM autopilot_turns WHERE id = :id").get<TurnRow>({ id: turnId });
    return row ? this.toTurn(row) : null;
  }

  /** The most recent turn that has not reached a settled status. */
  openTurn(runId: string): TurnRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM autopilot_turns
         WHERE run_id = :runId AND status IN ('PLANNED', 'SENT')
         ORDER BY ordinal DESC LIMIT 1`
      )
      .get<TurnRow>({ runId });
    return row ? this.toTurn(row) : null;
  }

  private toTurn(row: TurnRow): TurnRecord {
    return {
      id: row.id,
      runId: row.run_id,
      grantId: row.grant_id,
      ordinal: row.ordinal,
      kind: row.kind as TurnKind,
      prompt: row.prompt_text,
      sendId: row.send_id,
      status: row.status as TurnStatus,
      grantConsumed: row.grant_consumed === 1,
      verificationId: row.verification_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /** Journals the turn and its exact prompt BEFORE anything is sent. */
  planTurn(input: { runId: string; grantId: string; kind: TurnKind; prompt: string }): TurnRecord {
    return this.store.transaction(() => {
      const grant = this.requireGrant(input.grantId);
      if (grant.status !== "ACTIVE") throw new Error("The loop grant is no longer active.");
      if (grant.turnsUsed >= grant.maxTurns) throw new Error("The loop grant has no remaining turns.");
      if (this.openTurn(input.runId)) throw new Error("An earlier turn is still open.");

      const ordinal = this.turns(input.runId).length + 1;
      const id = this.ports.ids.next("loop-turn");
      const now = this.ports.clock.now();
      this.db
        .prepare(
          `INSERT INTO autopilot_turns
             (id, run_id, grant_id, ordinal, kind, prompt_text, status, grant_consumed, created_at, updated_at)
           VALUES (:id, :runId, :grantId, :ordinal, :kind, :prompt, 'PLANNED', 0, :now, :now)`
        )
        .run({ id, runId: input.runId, grantId: input.grantId, ordinal, kind: input.kind, prompt: input.prompt, now });

      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: "LOOP_TURN_PLANNED",
        payload: { turnId: id, ordinal, kind: input.kind, grantId: input.grantId, promptLength: input.prompt.length }
      });
      return this.turn(id)!;
    });
  }

  /**
   * Spends one turn of the grant, attributed to this exact turn.
   *
   * Idempotent: calling twice for the same turn spends nothing more. That is why
   * budget is counted from turns rather than held in a mutable counter.
   */
  consumeGrantForTurn(turnId: string, role: WorkerRole = "PRIMARY"): LoopGrant {
    assertPrimary(role);
    return this.store.transaction(() => {
      const turn = this.turn(turnId);
      if (!turn) throw new Error(`Turn ${turnId} was not found.`);
      const grant = this.requireGrant(turn.grantId);
      assertPrimary(grant.role);
      if (new OwnershipStore(this.ports).primaryProvider(turn.runId, this.store.requireRun(turn.runId).spec) !== grant.provider) {
        throw new Error("PRIMARY grant ownership changed.");
      }
      if (turn.grantConsumed) return grant;
      if (grant.status !== "ACTIVE") throw new Error("The loop grant is no longer active.");
      if (grant.turnsUsed >= grant.maxTurns) throw new Error("The loop grant has no remaining turns.");

      this.db.prepare("UPDATE autopilot_turns SET grant_consumed = 1, updated_at = :now WHERE id = :id").run({
        id: turnId,
        now: this.ports.clock.now()
      });
      const run = this.store.requireRun(turn.runId);
      this.store.appendEventUnsafe(turn.runId, run.state, {
        type: "LOOP_TURN_CONSUMED_GRANT",
        payload: { turnId, grantId: grant.id, ordinal: turn.ordinal, turnsUsed: grant.turnsUsed + 1, maxTurns: grant.maxTurns }
      });
      return this.requireGrant(grant.id);
    });
  }

  updateTurn(input: { turnId: string; status: TurnStatus; sendId?: string | null; verificationId?: string | null }): TurnRecord {
    return this.store.transaction(() => {
      const assignments = ["status = :status", "updated_at = :now"];
      const params: Record<string, unknown> = { id: input.turnId, status: input.status, now: this.ports.clock.now() };
      if (input.sendId !== undefined) {
        assignments.push("send_id = :sendId");
        params.sendId = input.sendId;
      }
      if (input.verificationId !== undefined) {
        assignments.push("verification_id = :verificationId");
        params.verificationId = input.verificationId;
      }
      this.db.prepare(`UPDATE autopilot_turns SET ${assignments.join(", ")} WHERE id = :id`).run(params);

      const turn = this.turn(input.turnId)!;
      const run = this.store.requireRun(turn.runId);
      this.store.appendEventUnsafe(turn.runId, run.state, {
        type: "LOOP_TURN_SETTLED",
        payload: { turnId: turn.id, ordinal: turn.ordinal, status: input.status }
      });
      return turn;
    });
  }

  recordVerification(input: { runId: string; turnId: string; report: VerificationReport }): VerificationRecord {
    return this.store.transaction(() => {
      const id = this.ports.ids.next("loop-verify");
      const now = this.ports.clock.now();
      this.db
        .prepare(
          `INSERT INTO autopilot_verification_runs (id, run_id, turn_id, outcome, summary, tiers_json, created_at)
           VALUES (:id, :runId, :turnId, :outcome, :summary, :tiers, :now)`
        )
        .run({
          id,
          runId: input.runId,
          turnId: input.turnId,
          outcome: input.report.outcome,
          summary: input.report.summary,
          tiers: JSON.stringify(input.report),
          now
        });

      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type:
          input.report.outcome === "PASSED"
            ? "VERIFICATION_PASSED"
            : input.report.outcome === "FAILED"
              ? "VERIFICATION_FAILED"
              : "VERIFICATION_INDETERMINATE",
        payload: {
          turnId: input.turnId,
          outcome: input.report.outcome,
          summary: input.report.summary,
          failingTier: input.report.failingTier?.tier ?? null,
          changedFiles: input.report.changedFiles
        }
      });
      return this.verification(id)!;
    });
  }

  verification(id: string): VerificationRecord | null {
    const row = this.db.prepare("SELECT * FROM autopilot_verification_runs WHERE id = :id").get<VerificationRow>({ id });
    if (!row) return null;
    return {
      id: row.id,
      runId: row.run_id,
      turnId: row.turn_id,
      outcome: row.outcome,
      summary: row.summary,
      report: JSON.parse(row.tiers_json) as VerificationReport,
      createdAt: row.created_at
    };
  }

  verifications(runId: string): VerificationRecord[] {
    return this.db
      .prepare("SELECT id FROM autopilot_verification_runs WHERE run_id = :runId ORDER BY created_at, rowid")
      .all<{ id: string }>({ runId })
      .map((row) => this.verification(row.id)!);
  }
}
