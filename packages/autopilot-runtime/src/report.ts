import { latestPrimaryProgress, type PrimaryProgress } from "./progress.ts";
import { ConsultationStore, type ConsultationRecord } from "./consultations.ts";
// The run report.
//
// Rebuilt entirely from SQLite: runs, the append-only journal, worker sessions
// and sends, loop grants and turns, verification records, checkpoints and
// workspace snapshots. It runs no git and reads no renderer state, so the same
// report is produced before and after a restart, and for a run that stopped or
// failed just as much as one that completed.
//
// Content policy follows AGENTS.md: the report records what happened, not
// private content. Prompts and provider output are already stored deliberately
// by the worker layer and are referenced by id and length here, not copied.

import type { RunSpec } from "./runSpec.ts";
import type { RuntimePorts } from "./ports.ts";
import { AutopilotStore, type RunEventRecord } from "./store.ts";
import { OperationStore } from "./operations.ts";
import { WorkerStore } from "./workerStore.ts";
import { LoopStore } from "./loopStore.ts";
import { CheckpointStore } from "./checkpoints.ts";
import type { VerificationTierResult } from "./verification.ts";
import { ContextRequestStore, type ContextRequest } from "./contextRequests.ts";
import { ConsultantStore, type ConsultantSession, type DiagnosisRecord } from "./consultant.ts";
import { WorkerDiagnosticsStore, DIAGNOSTIC_CATEGORY_LABELS, type WorkerDiagnostics } from "./diagnostics.ts";
import { rolesFor } from "./roles.ts";
import { OwnershipStore, HandoffStore, currentRoles, type OwnershipRecord, type HandoffRecord } from "./handoff.ts";
import { evaluateRecovery, type RecoveryDecision, type PreflightProbe } from "./recovery.ts";
import { DirectionStore, DirectionAuthorityStore, type DirectionDecision, type DirectionSource, type DirectionAuthority } from "./direction.ts";
import { IterationStore, type IterationRecord } from "./iterations.ts";
import { PlanStore, type PlanView } from "./plan.ts";

export const RUN_REPORT_SCHEMA_VERSION = 5;
const ACTIVITY_LABELS: Record<string, string> = {
  CONSULTATION_RECOMMENDED: "Consultation recommended", CONSULTATION_APPROVED: "Consultation approved",
  CONSULTATION_REQUESTED: "Operator requested a second opinion",
  HANDOFF_PROPOSED: "Handoff proposed", HANDOFF_APPROVED: "Handoff approved",
  HANDOFF_CANCELLED: "Handoff cancelled", HANDOFF_SUPERSEDED: "Handoff superseded",
  HANDOFF_ACTIVATING: "Handoff activating", HANDOFF_FAILED: "Handoff failed",
  HANDOFF_ACTIVATED: "Handoff activated", PRIMARY_OWNERSHIP_CHANGED: "Primary ownership changed",
  RECOVERY_EVALUATED: "Recovery recommendation changed",
  CONSULTATION_CANCELLED: "Consultation cancelled", CONSULTATION_SUPERSEDED: "Consultation superseded",
  CONSULTANT_SESSION_STARTED: "Consultant session started", CONSULTANT_SESSION_RESUMED: "Consultant session resumed",
  CONSULTANT_DIAGNOSIS_INTENT: "Consultant diagnosis journaled", CONSULTANT_DIAGNOSIS_COMPLETED: "Consultant diagnosis complete",
  CONSULTANT_DIAGNOSIS_FAILED: "Consultant diagnosis failed", CONSULTANT_DIAGNOSIS_UNCERTAIN: "Consultant send uncertain",
  CONSULTANT_OUTPUT_REFUSED: "Consultant file changes refused", CONSULTATION_HOLD_RELEASED: "Consultation hold released",
  DIAGNOSIS_SUPPLIED_TO_PRIMARY: "Diagnosis supplied to primary",
  WORKER_DIAGNOSTICS_RECORDED: "Provider process failed",
  PRIMARY_PROGRESS_EVALUATED: "Primary progress evaluated",
  RUN_CREATED: "Run created", WORKSPACE_CREATED: "Workspace prepared", WORKER_SESSION_CREATED: "Primary session started",
  WORKER_SESSION_RESUMED: "Primary session resumed", LOOP_TURN_PLANNED: "Primary turn planned", LOOP_TURN_SETTLED: "Primary turn settled",
  WORKER_SEND_INTENT: "Primary prompt journaled", WORKER_SEND_COMPLETED: "Primary turn completed",
  WORKER_SEND_DISPATCHING: "Primary turn started", WORKER_SEND_RESULT: "Primary result recorded",
  CONTEXT_REQUESTED: "Context requested", CONTEXT_REQUEST_FULFILLED: "Context supplied", CONTEXT_REQUEST_DENIED: "Context denied",
  VERIFICATION_PASSED: "Verification passed", VERIFICATION_FAILED: "Verification failed", VERIFICATION_INDETERMINATE: "Verification indeterminate", VERIFICATION_RECORDED: "Verification recorded",
  CHECKPOINT_CREATED: "Checkpoint created", CHECKPOINT_RECOVERED: "Checkpoint recovered",
  APPROVAL_REQUESTED: "Approval required", APPROVAL_RESOLVED: "Approval resolved", RUN_PAUSED: "Paused", RUN_RESUMED: "Resumed",
  APPROVAL_GRANTED: "Approval granted", APPROVAL_REJECTED: "Approval rejected", VERIFICATION_STARTED: "Verification started",
  PAUSE_REQUESTED: "Pause requested", STOP_REQUESTED: "Stop requested", RUN_FAILED: "Failed",
  WORKER_SEND_RESOLVED_BY_HUMAN: "Uncertain send resolved by human", RECONCILIATION_RESOLVED: "Restart reconciliation resolved",
  RUN_NEEDS_REVIEW: "Needs review", RUN_STOPPED: "Stopped", RUN_COMPLETED: "Completed", LOOP_HELD: "Primary loop held"
};

export interface ReportContextRequest {
  id: string;
  path: string;
  requestedTurnId: string;
  requestedTurnOrdinal: number | null;
  consumedTurnId: string | null;
  consumedTurnOrdinal: number | null;
  status: ContextRequest["status"];
  allowed: boolean | null;
  denialReason: string | null;
  availabilityReason: string;
  bytesSupplied: number;
  bytesUnit: ContextRequest["bytesUnit"];
  fulfilledAfterRestart: boolean | null;
  consumingWorker: { provider: string; sessionId: string; providerSessionId: string | null } | null;
}

export interface ReportTurn {
  ordinal: number;
  turnId: string;
  kind: string;
  status: string;
  grantConsumed: boolean;
  promptLength: number;
  sendId: string | null;
  sendStatus: string | null;
  sendFailure: string | null;
  sendCertain: boolean | null;
  verification: {
    outcome: string;
    summary: string;
    changedFiles: number;
    tiers: VerificationTierResult[];
  } | null;
  checkpoint: {
    status: string;
    commitSha: string | null;
    detail: string | null;
  } | null;
}

export interface RunReport {
  consultations: ConsultationRecord[];
  /** CONSULTANT sessions. Always distinct from the PRIMARY session. */
  consultantSessions: ConsultantSession[];
  /** Bounded, redacted evidence from failed provider processes. */
  workerDiagnostics: Array<WorkerDiagnostics & { categoryLabel: string }>;
  /** Who has owned implementation, in order. Empty when never handed off. */
  ownership: OwnershipRecord[];
  /** Every handoff proposal and its outcome. */
  handoffs: HandoffRecord[];
  /** The single current routing recommendation, derived from durable evidence. */
  recovery: RecoveryDecision;
  /** Who decides what happens next, now and over time. */
  direction: { source: DirectionSource; authority: DirectionAuthority[]; decisions: DirectionDecision[] };
  /** One row per piece of work, joining its turn, verification and checkpoint. */
  iterations: IterationRecord[];
  /** The human's plan, with each item's progress. */
  plan: PlanView;
  /** One read-only diagnosis per approved consultation, with its outcome. */
  diagnoses: DiagnosisRecord[];
  primaryProgress: PrimaryProgress | null;
  execution: { consecutiveFailures: number; failureLimit: number };
  roles: {
    primary: { role: "PRIMARY"; provider: string; sessionId: string | null; providerSessionId: string | null; established: boolean; restored: boolean };
    consultant: { role: "CONSULTANT"; provider: string | null; sessionId: null; providerSessionId: null; established: false; restored: false };
  };
  activity: Array<{ id: string; at: string; label: string }>;
  contextRequests: ReportContextRequest[];
  schemaVersion: number;
  generatedAt: string;
  run: {
    id: string;
    state: string;
    goal: string;
    createdAt: string;
    updatedAt: string;
    reconcileReason: string | null;
    failureReason: string | null;
    specFingerprint: string;
    specRevision: number;
  };
  spec: RunSpec;
  provider: {
    id: string | null;
    sticky: boolean;
    fallback: string | null;
    sessionId: string | null;
    providerSessionId: string | null;
    sessionEstablished: boolean | null;
    workspaceRoot: string | null;
  };
  loop: {
    grants: Array<{ id: string; role: "PRIMARY"; maxTurns: number; turnsUsed: number; status: string; grantedBy: string; grantedAt: string; closedAt: string | null; closedReason: string | null }>;
    turns: ReportTurn[];
  };
  acceptanceCriteria: Array<{ id: string; text: string; kind: string; check: string | null; status: "passed" | "failed" | "not_evaluated" | "needs_human" }>;
  checkpoints: Array<{ turnOrdinal: number | null; status: string; commitSha: string | null; message: string; createdAt: string; detail: string | null }>;
  workspace: {
    headSha: string | null;
    status: string;
    diffStat: string;
    changedFiles: number;
    capturedAt: string | null;
  };
  humanActions: {
    approvals: Array<{ id: string; summary: string; risk: string; status: string; requestedAt: string; resolvedAt: string | null; resolutionSource: string | null }>;
    uncertainResolutions: Array<{ sendId: string; decision: string; source: string; createdAt: string; evidenceLength: number }>;
    interventionCount: number;
  };
  deniedOperations: Array<{ id: string; summary: string; rule: string; reason: string; risk: string; createdAt: string }>;
  outcome: {
    state: string;
    classification: "completed" | "failed" | "stopped" | "needs_review" | "in_progress";
    reason: string;
  };
  eventCount: number;
}

function classify(state: string): RunReport["outcome"]["classification"] {
  if (state === "COMPLETED") return "completed";
  if (state === "FAILED") return "failed";
  if (state === "STOPPED") return "stopped";
  if (state === "NEEDS_REVIEW") return "needs_review";
  return "in_progress";
}

/** The last journalled reason the run settled where it did. */
function outcomeReason(state: string, events: RunEventRecord[], run: { failureReason: string | null; reconcileReason: string | null }): string {
  if (run.failureReason) return run.failureReason;
  if (run.reconcileReason) return run.reconcileReason;
  const held = [...events].reverse().find((event) => event.type === "LOOP_HELD");
  if (held) return String(held.payload.detail ?? held.payload.reason ?? "held");
  if (state === "COMPLETED") return "All gating checks and acceptance criteria passed.";
  if (state === "STOPPED") return "The operator stopped the run.";
  return `Run is ${state}.`;
}

export function buildRunReport(ports: RuntimePorts, runId: string, preflight?: PreflightProbe): RunReport {
  const store = new AutopilotStore(ports);
  const operations = new OperationStore(ports);
  const workers = new WorkerStore(ports);
  const loops = new LoopStore(ports);
  const checkpoints = new CheckpointStore(ports);

  const run = store.requireRun(runId);
  const events = store.listEvents(runId);
  const session = workers.session(runId);
  const sends = workers.list(runId);
  const resolutions = workers.resolutions(runId);
  const turns = loops.turns(runId);
  const verifications = loops.verifications(runId);
  const allCheckpoints = checkpoints.list(runId);
  const snapshot = checkpoints.latestSnapshot(runId);
  const allOperations = operations.listForRun(runId);

  const sendById = new Map(sends.map((send) => [send.id, send]));
  const verificationByTurn = new Map(verifications.map((record) => [record.turnId, record]));
  const checkpointByTurn = new Map(allCheckpoints.map((record) => [record.turnId, record]));

  const reportTurns: ReportTurn[] = turns.map((turn) => {
    const send = turn.sendId ? sendById.get(turn.sendId) ?? null : null;
    const verification = verificationByTurn.get(turn.id) ?? null;
    const checkpoint = checkpointByTurn.get(turn.id) ?? null;
    return {
      ordinal: turn.ordinal,
      turnId: turn.id,
      kind: turn.kind,
      status: turn.status,
      grantConsumed: turn.grantConsumed,
      // Length only: the prompt itself already lives in the worker store.
      promptLength: turn.prompt.length,
      sendId: turn.sendId,
      sendStatus: send?.status ?? null,
      sendFailure: send?.result?.failure ?? null,
      sendCertain: send?.result ? send.result.certain : null,
      verification: verification
        ? {
            outcome: verification.outcome,
            summary: verification.summary,
            changedFiles: verification.report.changedFiles,
            tiers: verification.report.tiers
          }
        : null,
      checkpoint: checkpoint ? { status: checkpoint.status, commitSha: checkpoint.commitSha, detail: checkpoint.detail } : null
    };
  });

  // Acceptance criteria status is read from the LAST verification, which is the
  // only one that describes the final state of the workspace.
  const finalVerification = verifications.at(-1) ?? null;
  const acceptanceCriteria = run.spec.acceptanceCriteria.map((criterion) => {
    if (criterion.kind === "judgment") {
      return { id: criterion.id, text: criterion.text, kind: criterion.kind, check: criterion.check ?? null, status: "needs_human" as const };
    }
    const tier = finalVerification?.report.tiers.find((entry) => entry.tier === `acceptance:${criterion.id}`);
    const status = !tier ? ("not_evaluated" as const) : tier.ok ? ("passed" as const) : ("failed" as const);
    return { id: criterion.id, text: criterion.text, kind: criterion.kind, check: criterion.check ?? null, status };
  });

  const approvals = allOperations
    .map((operation) => operations.getApprovalForOperation(operation.id))
    .filter((approval): approval is NonNullable<typeof approval> => Boolean(approval))
    .map((approval) => ({
      id: approval.id,
      summary: approval.summary,
      risk: approval.risk,
      status: approval.status,
      requestedAt: approval.requestedAt,
      resolvedAt: approval.resolvedAt,
      resolutionSource: approval.resolutionSource
    }));

  // A human intervention is an approval a person resolved directly plus every
  // uncertain-send resolution. Turns covered by a loop grant are attributed to
  // the grant, not counted as fresh interventions.
  const interventionCount =
    approvals.filter((approval) => approval.resolutionSource && !approval.resolutionSource.startsWith("loop_grant:")).length +
    resolutions.filter((resolution) => resolution.decision !== "keep_unresolved").length;

  const turnOrdinalById = new Map(turns.map((turn) => [turn.id, turn.ordinal]));
  let consecutiveFailures = 0;
  for (const verification of [...verifications].reverse()) {
    if (verification.outcome !== "FAILED") break;
    consecutiveFailures++;
  }
  const grants = loops.grants(runId);
  const contextRequests: ReportContextRequest[] = new ContextRequestStore(ports).list(runId).map(request => {
    const planned = events.find(event => event.type === "LOOP_TURN_PLANNED" && event.payload.turnId === request.requestedTurnId);
    const previousPlan = planned ? events.filter(event => event.seq < planned.seq && event.type === "LOOP_TURN_PLANNED").at(-1) : undefined;
    const selection = planned ? events.filter(event => event.seq < planned.seq && event.seq > (previousPlan?.seq ?? 0) && event.type === "WORKSPACE_CONTEXT_READ").at(-1) : undefined;
    const selected = selection?.payload.selected;
    // Selection evidence proves inclusion/omission, not the worker's motivation.
    const availabilityReason = !Array.isArray(selected) ? "Prior context selection not recorded." :
      selected.some(entry => entry && typeof entry === "object" && entry.path === request.path)
        ? "Already included in originating turn; worker requested it again."
        : "Not included in originating turn's bounded context; exact omission reason not recorded.";
    const consumingTurn = turns.find(turn => turn.id === request.consumedTurnId);
    const grant = consumingTurn ? grants.find(entry => entry.id === consumingTurn.grantId) : null;
    const send = consumingTurn?.sendId ? sendById.get(consumingTurn.sendId) : null;
    return {
      id: request.id, path: request.path, requestedTurnId: request.requestedTurnId,
      requestedTurnOrdinal: turnOrdinalById.get(request.requestedTurnId) ?? null,
      consumedTurnId: request.consumedTurnId,
      consumedTurnOrdinal: request.consumedTurnId ? turnOrdinalById.get(request.consumedTurnId) ?? null : null,
      status: request.status, allowed: request.status === "PENDING" ? null : request.status === "FULFILLED",
      denialReason: request.denialReason, availabilityReason,
      bytesSupplied: request.bytesSupplied, bytesUnit: request.bytesUnit,
      fulfilledAfterRestart: request.status !== "FULFILLED" || !request.requestedRuntimeId || !request.resolvedRuntimeId
        ? null : request.requestedRuntimeId !== request.resolvedRuntimeId,
      consumingWorker: grant ? { provider: grant.provider, sessionId: grant.sessionId,
        providerSessionId: send?.result?.providerSessionId ?? null } : null
    };
  });

  return {
    primaryProgress: latestPrimaryProgress(ports, runId),
    consultations: new ConsultationStore(ports).list(runId),
    recovery: evaluateRecovery(ports, runId, preflight),
    iterations: new IterationStore(ports).list(runId),
    plan: new PlanStore(ports).view(runId, run.spec),
    direction: {
      source: new DirectionAuthorityStore(ports).current(runId),
      authority: new DirectionAuthorityStore(ports).history(runId),
      decisions: new DirectionStore(ports).list(runId)
    },
    ownership: new OwnershipStore(ports).history(runId),
    handoffs: new HandoffStore(ports).list(runId),
    consultantSessions: new ConsultantStore(ports).sessions(runId),
    // The human label travels with the record so the renderer needs no copy of
    // the category vocabulary and cannot drift from it.
    workerDiagnostics: new WorkerDiagnosticsStore(ports).list(runId)
      .map(entry => ({ ...entry, categoryLabel: DIAGNOSTIC_CATEGORY_LABELS[entry.category] ?? entry.category })),
    diagnoses: new ConsultantStore(ports).diagnoses(runId),
    execution: { consecutiveFailures, failureLimit: run.spec.failurePolicy.maxConsecutiveFailures },
    roles: {
      primary: { role: "PRIMARY", provider: currentRoles(ports, runId, run.spec).primary, sessionId: session?.sessionId ?? null, providerSessionId: session?.providerSessionId ?? (session?.provider === "claude" ? session.sessionId : null), established: session?.established ?? false, restored: workers.ownership(runId)?.restored ?? false },
      consultant: { role: "CONSULTANT", provider: currentRoles(ports, runId, run.spec).consultant, sessionId: null, providerSessionId: null, established: false, restored: false }
    },
    activity: (() => { const name = (p: unknown) => p === "codex" ? "Codex" : p === "claude" ? "Claude" : String(p); return events.filter(event => ACTIVITY_LABELS[event.type]).map(event => ({ id: event.id, at: event.createdAt, label: event.type === "PRIMARY_PROGRESS_EVALUATED" ? "Primary " + String((event.payload.decision as unknown as PrimaryProgress).status) + ": " + String((event.payload.decision as unknown as PrimaryProgress).reason)
      : event.type === "WORKER_DIAGNOSTICS_RECORDED" && typeof event.payload.label === "string" ? event.payload.label
      : event.type === "RECOVERY_EVALUATED" && typeof event.payload.label === "string" ? event.payload.label
      : event.type === "PRIMARY_OWNERSHIP_CHANGED" && typeof event.payload.toProvider === "string"
        ? `${name(event.payload.fromProvider)} handed PRIMARY ownership to ${name(event.payload.toProvider)}`
      : event.type === "HANDOFF_PROPOSED" && typeof event.payload.toProvider === "string"
        ? `Handoff to ${name(event.payload.toProvider)} proposed`
      : event.type === "CONSULTATION_REQUESTED" && typeof event.payload.consultantProvider === "string"
        ? `Operator requested ${event.payload.consultantProvider === "codex" ? "Codex" : "Claude"} second opinion`
      : event.type === "DIAGNOSIS_SUPPLIED_TO_PRIMARY" && typeof event.payload.turnOrdinal === "number"
        ? `Diagnosis supplied to PRIMARY turn ${event.payload.turnOrdinal}`
      : ACTIVITY_LABELS[event.type]! })); })(),
    contextRequests,
    schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    generatedAt: ports.clock.now(),
    run: {
      id: run.id,
      state: run.state,
      goal: run.goal,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      reconcileReason: run.reconcileReason,
      failureReason: run.failureReason,
      specFingerprint: run.specFingerprint,
      specRevision: run.specRevision
    },
    spec: run.spec,
    provider: {
      id: session?.provider ?? run.spec.workers.primary ?? null,
      sticky: run.spec.workers.sticky,
      fallback: run.spec.workers.fallback,
      sessionId: session?.sessionId ?? null,
      providerSessionId: session?.providerSessionId ?? null,
      sessionEstablished: session ? session.established : null,
      workspaceRoot: run.spec.capabilities.workspaceRoot
    },
    loop: {
      grants: loops.grants(runId).map((grant) => ({
        role: "PRIMARY",
        id: grant.id,
        maxTurns: grant.maxTurns,
        turnsUsed: grant.turnsUsed,
        status: grant.status,
        grantedBy: grant.grantedBy,
        grantedAt: grant.grantedAt,
        closedAt: grant.closedAt,
        closedReason: grant.closedReason
      })),
      turns: reportTurns
    },
    acceptanceCriteria,
    checkpoints: allCheckpoints.map((checkpoint) => ({
      turnOrdinal: turnOrdinalById.get(checkpoint.turnId) ?? null,
      status: checkpoint.status,
      commitSha: checkpoint.commitSha,
      message: checkpoint.message,
      createdAt: checkpoint.createdAt,
      detail: checkpoint.detail
    })),
    workspace: {
      headSha: snapshot?.headSha ?? null,
      status: snapshot?.statusText ?? "",
      diffStat: snapshot?.diffStat ?? "",
      changedFiles: snapshot?.changedFiles ?? 0,
      capturedAt: snapshot?.createdAt ?? null
    },
    humanActions: {
      approvals,
      uncertainResolutions: resolutions.map((resolution) => ({
        sendId: resolution.sendId,
        decision: resolution.decision,
        source: resolution.source,
        createdAt: resolution.createdAt,
        // Length only; the operator's evidence text stays in its own table.
        evidenceLength: resolution.evidence.length
      })),
      interventionCount
    },
    deniedOperations: allOperations
      .filter((operation) => operation.decision === "DENY")
      .map((operation) => ({
        id: operation.id,
        summary: operation.summary,
        rule: operation.decisionRule,
        reason: operation.decisionReason,
        risk: operation.risk,
        createdAt: operation.createdAt
      })),
    outcome: {
      state: run.state,
      classification: classify(run.state),
      reason: outcomeReason(run.state, events, run)
    },
    eventCount: events.length
  };
}

function fence(value: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? `\n\`\`\`\n${trimmed}\n\`\`\`\n` : "\n_(none)_\n";
}

/** Human-readable rendering of exactly the same durable evidence. */
export function renderRunReportMarkdown(report: RunReport): string {
  const lines: string[] = [];

  lines.push(`# Autopilot run report`);
  lines.push("");
  lines.push(`**Run:** \`${report.run.id}\`  `);
  lines.push(`**Outcome:** ${report.outcome.classification.toUpperCase()} (${report.run.state})  `);
  lines.push(`**Reason:** ${report.outcome.reason}  `);
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push("");

  lines.push("## Goal");
  lines.push("");
  lines.push(report.spec.goal);
  if (report.spec.constraints.length) {
    lines.push("");
    lines.push("**Constraints**");
    for (const constraint of report.spec.constraints) lines.push(`- ${constraint}`);
  }
  if (report.spec.nonGoals.length) {
    lines.push("");
    lines.push("**Non-goals**");
    for (const nonGoal of report.spec.nonGoals) lines.push(`- ${nonGoal}`);
  }
  lines.push("");

  if (report.primaryProgress) {
    const p = report.primaryProgress;
    lines.push("## Primary progress", "", p.status + ": " + p.reason,
      "Turn: " + p.turnOrdinal + "; equivalent comparisons: " + p.consecutiveStalled,
      "Failure fingerprint: " + (p.failureFingerprint ?? "none") + "; workspace fingerprint: " + (p.workspaceFingerprint ?? "unknown"),
      "Context request fingerprint: " + (p.requestFingerprint ?? "none"),
      "consultant_recommended: " + p.consultantRecommended, "");
  }
  if (report.consultations.length) {
    lines.push("## Consultations", "");
    for (const c of report.consultations) {
      lines.push(`- ${c.id}: ${c.status}; PRIMARY ${c.primaryProvider}; CONSULTANT ${c.consultantProvider}; turn ${c.preview.triggeringTurn ?? "not started"}.`,
        `  Trigger: ${c.triggerType}${c.triggerType === "OPERATOR" ? " (operator requested)" : ""}; ${c.triggerReason}. One future diagnosis; eligible: ${c.executionEligible}.`,
        `  Created: ${c.createdAt}; resolved: ${c.resolvedAt ?? "pending"}; approval source: ${c.approvalSource ?? "none"}.`,
        `  Evidence: ${c.preview.failureSummary}; ${c.preview.changedPaths.length} changed path(s); ${c.preview.contextRequests.length} relevant context request(s).`);
    }
    lines.push("");
  }
  if (report.ownership.length > 1 || report.handoffs.length) {
    lines.push("## Implementation ownership", "");
    for (const period of report.ownership) {
      lines.push(`- #${period.ordinal} ${period.provider} ${period.status}; session ${period.sessionId ?? "none"}; from ${period.startedAt}${period.retiredAt ? ` to ${period.retiredAt}` : " (current)"}.`);
    }
    if (report.handoffs.length) {
      lines.push("", "Handoffs:", "");
      for (const handoff of report.handoffs) {
        lines.push(`- ${handoff.id}: ${handoff.fromProvider} -> ${handoff.toProvider}; ${handoff.status}; source ${handoff.source}.`,
          `  Reason: ${handoff.reason}. Package ${handoff.packageFingerprint}; spec ${handoff.specFingerprint}.`,
          `  Proposed ${handoff.proposedAt}; approved ${handoff.approvedAt ?? "not approved"} (${handoff.approvalSource ?? "none"}); activated ${handoff.activatedAt ?? "not activated"}.`,
          `  Sessions: ${handoff.fromSessionId ?? "none"} -> ${handoff.toSessionId ?? "none"}.${handoff.failure ? ` Failure: ${handoff.failure}.` : ""}`);
      }
    }
    lines.push("");
  }
  if (report.workerDiagnostics.length) {
    lines.push("## Provider failures", "");
    lines.push("Bounded, redacted evidence from failed provider processes. Successful provider output is never recorded here.", "");
    for (const d of report.workerDiagnostics) {
      lines.push(`- ${d.provider} ${d.role} · ${d.categoryLabel}; operation ${d.operationId}.`,
        `  Exit code: ${d.exitCode ?? "none"}; signal: ${d.signal ?? "none"}; recorded ${d.createdAt}.`,
        `  stderr: ${d.stderrBytes} byte(s)${d.stderrTruncated ? ", truncated to the tail" : ""}; stdout: ${d.stdoutBytes} byte(s)${d.stdoutTruncated ? ", truncated to the tail" : ""}.`);
      if (d.stderrTail.trim()) lines.push("", "```", d.stderrTail.trim(), "```", "");
      else if (d.stdoutTail.trim()) lines.push("", "```", d.stdoutTail.trim(), "```", "");
    }
    lines.push("");
  }
  if (report.diagnoses.length) {
    lines.push("## Consultant diagnoses", "");
    lines.push("Read-only second opinions. The consultant never wrote a file, earned a checkpoint or owned a turn.", "");
    for (const d of report.diagnoses) {
      lines.push(`- ${d.consultantProvider} · ${d.status}${d.failure ? ` (${d.failure})` : ""}; consultation ${d.consultationId}.`,
        `  Session: ${d.consultantSessionId}; started ${d.startedAt}; completed ${d.completedAt ?? "pending"}.`,
        `  Output: ${d.outputLength ?? 0} chars, fingerprint ${d.outputFingerprint ?? "none"}; refused file blocks: ${d.refusedFileBlocks}.`,
        `  Supplied to PRIMARY turn: ${d.suppliedToTurnId ?? "not yet"}.`);
      if (d.diagnosis) {
        lines.push("", "```", d.diagnosis.slice(0, 4000), "```");
      }
    }
    lines.push("");
  }
  lines.push("## Worker");
  lines.push("");
  lines.push(`PRIMARY: ${report.roles.primary.provider}; established: ${report.roles.primary.established}; restored: ${report.roles.primary.restored}.`);
  lines.push(`CONSULTANT: ${report.roles.consultant.provider ?? "None"}; ${report.roles.consultant.provider ? "Not started (configuration only)." : "No session."}`, "");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Provider | ${report.provider.id ?? "none"} |`);
  lines.push(`| Sticky | ${report.provider.sticky} |`);
  lines.push(`| Fallback | ${report.provider.fallback ?? "none"} |`);
  lines.push(`| Session | \`${report.provider.sessionId ?? "none"}\` |`);
  lines.push(`| Provider session | \`${report.provider.providerSessionId ?? "not bound"}\` |`);
  lines.push(`| Workspace | \`${report.provider.workspaceRoot ?? "none"}\` |`);
  lines.push("");

  lines.push("## Authorization");
  lines.push("");
  if (report.loop.grants.length === 0) {
    lines.push("_No loop authorization was granted._");
  } else {
    lines.push("| Grant | Budget | Used | Status | Granted by | Closed |");
    lines.push("|---|---|---|---|---|---|");
    for (const grant of report.loop.grants) {
      lines.push(`| \`${grant.id}\` | ${grant.maxTurns} | ${grant.turnsUsed} | ${grant.status} | ${grant.grantedBy} | ${grant.closedReason ?? "—"} |`);
    }
  }
  lines.push("");

  lines.push("## Turns");
  lines.push("");
  if (report.loop.turns.length === 0) {
    lines.push("_No turns ran._");
  } else {
    lines.push("| # | Kind | Turn | Send | Verification | Checkpoint |");
    lines.push("|---|---|---|---|---|---|");
    for (const turn of report.loop.turns) {
      const verification = turn.verification ? `${turn.verification.outcome} — ${turn.verification.summary}` : "—";
      const checkpoint = turn.checkpoint
        ? turn.checkpoint.commitSha
          ? `${turn.checkpoint.status} \`${turn.checkpoint.commitSha.slice(0, 12)}\``
          : turn.checkpoint.status
        : "—";
      lines.push(`| ${turn.ordinal} | ${turn.kind} | ${turn.status} | ${turn.sendStatus ?? "—"}${turn.sendFailure ? ` (${turn.sendFailure})` : ""} | ${verification} | ${checkpoint} |`);
    }
  }
  lines.push("");

  lines.push("### Verification detail");
  lines.push("");
  for (const turn of report.loop.turns) {
    if (!turn.verification) continue;
    lines.push(`**Turn ${turn.ordinal}** — ${turn.verification.outcome}, ${turn.verification.changedFiles} changed path(s)`);
    lines.push("");
    lines.push("| Tier | Ran | Result | Exit |");
    lines.push("|---|---|---|---|");
    for (const tier of turn.verification.tiers) {
      lines.push(`| ${tier.tier} | ${tier.ran} | ${tier.gating ? (tier.ok ? "pass" : "FAIL") : "info"} | ${tier.exitCode ?? "—"} |`);
    }
    lines.push("");
  }

  lines.push("## Context requests", "");
  if (!report.contextRequests.length) lines.push("_None._");
  else {
    // Request paths are worker-controlled data, not Markdown markup.
    const cell = (value: string) => value.replace(/[&<>|`*_\[\]\\]/g, char => `&#${char.charCodeAt(0)};`).replace(/[\r\n]+/g, " ");
    lines.push("| Path | From turn | Status / allowed | Reason | Consumed by | Supplied | After restart |",
      "|---|---|---|---|---|---|---|");
    for (const request of report.contextRequests) {
      lines.push(`| ${cell(request.path)} | ${request.requestedTurnOrdinal ?? cell(request.requestedTurnId)} | ${request.status} / ${request.allowed === null ? "pending" : request.allowed ? "yes" : "no"} | ${cell([request.availabilityReason, request.denialReason].filter(Boolean).join(" "))} | ${request.consumedTurnOrdinal ?? (request.consumedTurnId ? cell(request.consumedTurnId) : "pending / none")} | ${request.bytesSupplied} ${request.bytesUnit === "utf8_bytes" ? "bytes" : "legacy UTF-16 units"} | ${request.fulfilledAfterRestart === null ? "unknown / n/a" : request.fulfilledAfterRestart ? "yes" : "no"} |`);
    }
  }
  lines.push("");

  lines.push("## Acceptance criteria");
  lines.push("");
  if (report.acceptanceCriteria.length === 0) {
    lines.push("_The Run Spec declares none, so completion could not be established mechanically._");
  } else {
    lines.push("| Criterion | Kind | Status | Check |");
    lines.push("|---|---|---|---|");
    for (const criterion of report.acceptanceCriteria) {
      lines.push(`| ${criterion.text} | ${criterion.kind} | **${criterion.status}** | ${criterion.check ? `\`${criterion.check}\`` : "—"} |`);
    }
  }
  lines.push("");

  lines.push("## Checkpoints");
  lines.push("");
  if (report.checkpoints.length === 0) {
    lines.push("_No checkpoints were created._");
  } else {
    lines.push("| Turn | Status | Commit | Note |");
    lines.push("|---|---|---|---|");
    for (const checkpoint of report.checkpoints) {
      lines.push(`| ${checkpoint.turnOrdinal ?? "—"} | ${checkpoint.status} | ${checkpoint.commitSha ? `\`${checkpoint.commitSha}\`` : "—"} | ${checkpoint.detail ?? "—"} |`);
    }
  }
  lines.push("");

  lines.push("## Final workspace");
  lines.push("");
  lines.push(`HEAD: \`${report.workspace.headSha ?? "unknown"}\` · ${report.workspace.changedFiles} uncommitted path(s) · captured ${report.workspace.capturedAt ?? "never"}`);
  lines.push("");
  lines.push("**git status --porcelain**");
  lines.push(fence(report.workspace.status));
  lines.push("**git diff --stat**");
  lines.push(fence(report.workspace.diffStat));

  lines.push("## Human involvement");
  lines.push("");
  lines.push(`Direct interventions: **${report.humanActions.interventionCount}**`);
  lines.push("");
  if (report.humanActions.approvals.length) {
    lines.push("| Approval | Risk | Status | Resolved by |");
    lines.push("|---|---|---|---|");
    for (const approval of report.humanActions.approvals) {
      lines.push(`| ${approval.summary} | ${approval.risk} | ${approval.status} | ${approval.resolutionSource ?? "—"} |`);
    }
    lines.push("");
  }
  if (report.humanActions.uncertainResolutions.length) {
    lines.push("**Uncertain-send resolutions**");
    lines.push("");
    for (const resolution of report.humanActions.uncertainResolutions) {
      lines.push(`- \`${resolution.sendId}\` → **${resolution.decision}** (${resolution.source}, ${resolution.createdAt})`);
    }
    lines.push("");
  }

  lines.push("## Blocked operations");
  lines.push("");
  if (report.deniedOperations.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Operation | Rule | Reason |");
    lines.push("|---|---|---|");
    for (const denied of report.deniedOperations) {
      lines.push(`| ${denied.summary} | \`${denied.rule}\` | ${denied.reason} |`);
    }
  }
  lines.push("");
  lines.push(`_Reconstructed from ${report.eventCount} journalled events. No provider output or prompt text is reproduced here._`);
  lines.push("");

  return lines.join("\n");
}
