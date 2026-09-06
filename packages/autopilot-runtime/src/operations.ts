// Durable operations and approvals.
//
// An "operation" is one effect intent with a durable identity. It is written and
// COMMITTED before anything happens, carries the policy decision that authorized
// it, and records its outcome. This is the Phase 1 journal-before-side-effect
// discipline applied at intent granularity.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { Intent } from "./intent.ts";
import { describeIntent, fingerprintIntent } from "./intent.ts";
import type { PolicyDecision, RiskLevel } from "./policy.ts";

/**
 * Authorization/outcome state of an operation.
 *
 * Deliberately does NOT include a "dispatched" value: dispatch is progress, not
 * authority, and is carried by dispatched_at. Overloading status here would
 * erase the record of why an operation was allowed.
 */
export type OperationStatus =
  | "PENDING_POLICY"
  | "DENIED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "FAILED"
  | "UNCERTAIN";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

/** Operations whose outcome is settled and which must never be dispatched again. */
export const SETTLED_OPERATION_STATUSES: readonly OperationStatus[] = ["DENIED", "REJECTED", "COMPLETED", "FAILED"];

export interface OperationRecord {
  id: string;
  runId: string;
  stepKey: string | null;
  kind: string;
  fingerprint: string;
  intent: Intent;
  summary: string;
  decision: string;
  decisionRule: string;
  decisionReason: string;
  capability: string;
  risk: RiskLevel;
  status: OperationStatus;
  approvalId: string | null;
  exitCode: number | null;
  resultSummary: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  settledAt: string | null;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  operationId: string;
  fingerprint: string;
  summary: string;
  reason: string;
  capability: string;
  risk: RiskLevel;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolutionSource: string | null;
}

interface OperationRow {
  id: string; run_id: string; step_key: string | null; kind: string; fingerprint: string;
  intent_json: string; summary: string; decision: string; decision_rule: string;
  decision_reason: string; capability: string; risk: string; status: string;
  approval_id: string | null; exit_code: number | null; result_summary: string | null;
  created_at: string; dispatched_at: string | null; settled_at: string | null;
}

interface ApprovalRow {
  id: string; run_id: string; operation_id: string; fingerprint: string; summary: string;
  reason: string; capability: string; risk: string; status: string; requested_at: string;
  resolved_at: string | null; resolution_source: string | null;
}

function toOperation(row: OperationRow): OperationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    kind: row.kind,
    fingerprint: row.fingerprint,
    intent: JSON.parse(row.intent_json) as Intent,
    summary: row.summary,
    decision: row.decision,
    decisionRule: row.decision_rule,
    decisionReason: row.decision_reason,
    capability: row.capability,
    risk: row.risk as RiskLevel,
    status: row.status as OperationStatus,
    approvalId: row.approval_id,
    exitCode: row.exit_code,
    resultSummary: row.result_summary,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
    settledAt: row.settled_at
  };
}

function toApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    operationId: row.operation_id,
    fingerprint: row.fingerprint,
    summary: row.summary,
    reason: row.reason,
    capability: row.capability,
    risk: row.risk as RiskLevel,
    status: row.status as ApprovalStatus,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    resolutionSource: row.resolution_source
  };
}

export class OperationStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
  }

  /**
   * Records an operation and its policy decision. Callers must have this
   * committed before performing any effect.
   */
  record(input: {
    runId: string;
    stepKey: string | null;
    intent: Intent;
    decision: PolicyDecision;
    status: OperationStatus;
  }): OperationRecord {
    const now = this.ports.clock.now();
    const id = this.ports.ids.next("ap-op");
    const fingerprint = fingerprintIntent(input.intent);

    this.db
      .prepare(
        `INSERT INTO autopilot_operations
           (id, run_id, step_key, kind, fingerprint, intent_json, summary,
            decision, decision_rule, decision_reason, capability, risk, status,
            approval_id, exit_code, result_summary, created_at, dispatched_at, settled_at)
         VALUES
           (:id, :runId, :stepKey, :kind, :fingerprint, :intentJson, :summary,
            :decision, :rule, :reason, :capability, :risk, :status,
            NULL, NULL, NULL, :now, NULL, :settledAt)`
      )
      .run({
        id,
        runId: input.runId,
        stepKey: input.stepKey,
        kind: input.intent.kind,
        fingerprint,
        intentJson: JSON.stringify(input.intent.kind === "RUN_COMMAND" ? { ...input.intent, stdin: undefined } : input.intent),
        summary: describeIntent(input.intent),
        decision: input.decision.decision,
        rule: input.decision.rule,
        reason: input.decision.reason,
        capability: input.decision.capability,
        risk: input.decision.risk,
        status: input.status,
        now,
        settledAt: SETTLED_OPERATION_STATUSES.includes(input.status) ? now : null
      });

    return this.require(id);
  }

  get(operationId: string): OperationRecord | null {
    const row = this.db.prepare("SELECT * FROM autopilot_operations WHERE id = :id").get<OperationRow>({ id: operationId });
    return row ? toOperation(row) : null;
  }

  require(operationId: string): OperationRecord {
    const record = this.get(operationId);
    if (!record) throw new Error(`Autopilot operation ${operationId} was not found.`);
    return record;
  }

  /**
   * An existing, not-yet-settled operation for the same logical intent.
   *
   * This is what makes approvals survive a restart cleanly: when a step re-runs
   * after a crash and issues the same intent, we find the operation that already
   * exists rather than creating a second one and asking the human twice.
   * Settled operations are deliberately excluded, so a completed effect is never
   * matched and never repeated.
   */
  findReusable(input: { runId: string; stepKey: string | null; fingerprint: string }): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM autopilot_operations
         WHERE run_id = :runId
           AND fingerprint = :fingerprint
           AND (step_key IS :stepKey OR step_key = :stepKey)
           AND settled_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get<OperationRow>({ runId: input.runId, fingerprint: input.fingerprint, stepKey: input.stepKey });
    return row ? toOperation(row) : null;
  }

  /** A settled operation for this intent, i.e. one that must never run again. */
  findSettled(input: { runId: string; stepKey: string | null; fingerprint: string }): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM autopilot_operations
         WHERE run_id = :runId
           AND fingerprint = :fingerprint
           AND (step_key IS :stepKey OR step_key = :stepKey)
           AND settled_at IS NOT NULL
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get<OperationRow>({ runId: input.runId, fingerprint: input.fingerprint, stepKey: input.stepKey });
    return row ? toOperation(row) : null;
  }

  listForRun(runId: string): OperationRecord[] {
    return this.db
      .prepare("SELECT * FROM autopilot_operations WHERE run_id = :runId ORDER BY created_at ASC, id ASC")
      .all<OperationRow>({ runId })
      .map(toOperation);
  }

  /**
   * Records that dispatch is about to happen, WITHOUT changing status.
   *
   * `status` means authorization state (APPROVED, DENIED, REJECTED); progress is
   * carried by the timestamps. Keeping them separate matters: overloading status
   * with "DISPATCHED" would erase the record of why the operation was allowed,
   * and the dispatcher's own authorization check would then fail. An operation
   * with dispatched_at set and settled_at null is the uncertain-outcome window.
   */
  markDispatched(operationId: string): OperationRecord {
    const result = this.db
      .prepare("UPDATE autopilot_operations SET dispatched_at = :now WHERE id = :id AND dispatched_at IS NULL AND settled_at IS NULL")
      .run({ id: operationId, now: this.ports.clock.now() });
    if (result.changes !== 1) throw new Error("Operation already dispatched or settled; reconciliation is required.");
    return this.require(operationId);
  }

  updateStatus(input: {
    operationId: string;
    status: OperationStatus;
    exitCode?: number | null;
    resultSummary?: string | null;
    dispatched?: boolean;
  }): OperationRecord {
    const now = this.ports.clock.now();
    const assignments = ["status = :status"];
    const params: Record<string, unknown> = { id: input.operationId, status: input.status, now };

    if (input.exitCode !== undefined) {
      assignments.push("exit_code = :exitCode");
      params.exitCode = input.exitCode;
    }
    if (input.resultSummary !== undefined) {
      assignments.push("result_summary = :resultSummary");
      params.resultSummary = input.resultSummary;
    }
    if (input.dispatched) {
      assignments.push("dispatched_at = :now");
    }
    if (SETTLED_OPERATION_STATUSES.includes(input.status)) {
      assignments.push("settled_at = :now");
    }

    this.db.prepare(`UPDATE autopilot_operations SET ${assignments.join(", ")} WHERE id = :id`).run(params);
    return this.require(input.operationId);
  }

  // --- approvals -----------------------------------------------------------

  createApproval(input: { operation: OperationRecord; decision: PolicyDecision }): ApprovalRecord {
    const now = this.ports.clock.now();
    const id = this.ports.ids.next("ap-approval");

    this.db
      .prepare(
        `INSERT INTO autopilot_approvals
           (id, run_id, operation_id, fingerprint, summary, reason, capability, risk,
            status, requested_at, resolved_at, resolution_source)
         VALUES
           (:id, :runId, :operationId, :fingerprint, :summary, :reason, :capability, :risk,
            'PENDING', :now, NULL, NULL)`
      )
      .run({
        id,
        runId: input.operation.runId,
        operationId: input.operation.id,
        fingerprint: input.operation.fingerprint,
        summary: input.decision.approvalSummary ?? input.operation.summary,
        reason: input.decision.reason,
        capability: input.decision.capability,
        risk: input.decision.risk,
        now
      });

    this.db
      .prepare("UPDATE autopilot_operations SET approval_id = :approvalId, status = 'AWAITING_APPROVAL' WHERE id = :id")
      .run({ approvalId: id, id: input.operation.id });

    return this.requireApproval(id);
  }

  getApproval(approvalId: string): ApprovalRecord | null {
    const row = this.db.prepare("SELECT * FROM autopilot_approvals WHERE id = :id").get<ApprovalRow>({ id: approvalId });
    return row ? toApproval(row) : null;
  }

  requireApproval(approvalId: string): ApprovalRecord {
    const record = this.getApproval(approvalId);
    if (!record) throw new Error(`Autopilot approval ${approvalId} was not found.`);
    return record;
  }

  getApprovalForOperation(operationId: string): ApprovalRecord | null {
    const row = this.db
      .prepare("SELECT * FROM autopilot_approvals WHERE operation_id = :operationId")
      .get<ApprovalRow>({ operationId });
    return row ? toApproval(row) : null;
  }

  listPendingApprovals(runId?: string): ApprovalRecord[] {
    const sql = runId
      ? "SELECT * FROM autopilot_approvals WHERE status = 'PENDING' AND run_id = :runId ORDER BY requested_at ASC"
      : "SELECT * FROM autopilot_approvals WHERE status = 'PENDING' ORDER BY requested_at ASC";
    return this.db.prepare(sql).all<ApprovalRow>(runId ? { runId } : undefined).map(toApproval);
  }

  resolveApproval(input: { approvalId: string; status: Exclude<ApprovalStatus, "PENDING">; source: string }): ApprovalRecord {
    const now = this.ports.clock.now();
    const existing = this.requireApproval(input.approvalId);
    if (existing.status !== "PENDING") {
      // Resolving twice must not overwrite the first decision.
      return existing;
    }

    this.db
      .prepare(
        `UPDATE autopilot_approvals
         SET status = :status, resolved_at = :now, resolution_source = :source
         WHERE id = :id AND status = 'PENDING'`
      )
      .run({ id: input.approvalId, status: input.status, now, source: input.source });

    this.db
      .prepare("UPDATE autopilot_operations SET status = :opStatus WHERE id = :operationId")
      .run({
        opStatus: input.status === "APPROVED" ? "APPROVED" : "REJECTED",
        operationId: existing.operationId
      });

    if (input.status !== "APPROVED") {
      this.db
        .prepare("UPDATE autopilot_operations SET settled_at = :now WHERE id = :operationId")
        .run({ now, operationId: existing.operationId });
    }

    return this.requireApproval(input.approvalId);
  }
}
