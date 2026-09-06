import type { RuntimePorts } from "./ports.ts";
import { AutopilotStore, type RunEventRecord } from "./store.ts";
import { latestPrimaryProgress, type PrimaryProgress } from "./progress.ts";
import { LoopStore } from "./loopStore.ts";
import { CheckpointStore } from "./checkpoints.ts";
import { ContextRequestStore } from "./contextRequests.ts";
import { WorkerStore } from "./workerStore.ts";
import { ConsultantStore } from "./consultant.ts";
import { rolesFor, type CodingProvider } from "./roles.ts";
import { authoritativeFingerprint } from "./runSpec.ts";

export type ConsultationStatus = "RECOMMENDED" | "APPROVED" | "CANCELLED" | "SUPERSEDED";

/**
 * Why this consultation exists.
 *
 * STALLED and BLOCKED are raised by the deterministic progress detector.
 * OPERATOR is raised by a human who wants a second opinion on a run that is
 * making progress. It is a separate value rather than a reinterpretation of the
 * other two, so historical rows keep their original meaning.
 */
export type ConsultationTrigger = "STALLED" | "BLOCKED" | "OPERATOR";

/** Why an operator consultation cannot be requested right now. */
export type OperatorConsultationBlocker =
  | "no_consultant_configured"
  | "consultant_is_primary"
  | "run_finished"
  | "no_primary_evidence"
  | "primary_turn_in_flight"
  | "consultation_already_active"
  | "diagnosis_already_pending";
export interface ConsultationPreview {
  goal: string;
  constraints: string[];
  acceptanceCriteria: string[];
  primaryProvider: string;
  triggeringTurn: number | null;
  failingTier: string | null;
  failureSummary: string;
  changedPaths: string[];
  latestCheckpoint: { id: string; commitSha: string | null; status: string } | null;
  contextRequests: Array<{ path: string; status: string; reason: string | null; bytesSupplied: number; requestedTurnId: string; consumedTurnId: string | null }>;
  /** Sticky PRIMARY session this consultation was frozen against. Identity only. */
  primarySessionId: string | null;
  /** Latest gating verification outcome, or null when none has run yet. */
  latestVerification: string | null;
  /** Bounded worktree state at freeze time. Never file contents. */
  workspace: { headSha: string | null; changedFiles: number } | null;
  /** The progress decision in force when this was frozen, if any. */
  progressStatus: string | null;
}
interface ConsultationIdentity {
  version: 1;
  id: string;
  runId: string;
  primaryProvider: CodingProvider;
  consultantProvider: CodingProvider;
  triggerEventId: string;
  triggerSeq: number;
  triggeringTurnId: string | null;
  triggerType: ConsultationTrigger;
  triggerReason: string;
  specFingerprint: string;
  diagnosisLimit: 1;
  preview: ConsultationPreview;
}
export interface ConsultationRecord extends ConsultationIdentity {
  status: ConsultationStatus;
  createdAt: string;
  resolvedAt: string | null;
  approvalSource: string | null;
  resolutionSource: string | null;
  /** Authority for one FUTURE diagnosis only. No execution/claim path exists yet. */
  executionEligible: boolean;
  canApprove: boolean;
  canCancel: boolean;
}
export interface ConsultationScope { runId: string; requestId: string; consultantProvider: CodingProvider }
interface Row {
  id: string; run_id: string; trigger_event_id: string; identity_json: string;
  status: ConsultationStatus; approved_identity_json: string | null;
  created_at: string; resolved_at: string | null; approval_source: string | null; resolution_source: string | null;
}

/** Preview prose is bounded and redacts common credential forms. Never use raw
 * provider text, auth output or verification stdout as a failure summary. */
function prose(value: string, limit = 1000): string {
  return value
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/g, "[redacted private key]")
    .replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|AKIA[A-Z0-9]{16})\b/g, "[redacted credential]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[redacted authorization]")
    .replace(/\b[\w.-]*(?:api[_-]?key|token|secret|password|credential)[\w.-]*\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted credential]")
    .replace(/\b[a-z]+:\/\/[^\s/@]+:[^\s/@]+@/gi, "[redacted credentials]@")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
}
function safePath(path: string): string {
  return /^(?:[a-z]:|[\\/])|(?:^|[\\/])(?:\.\.|local-data|vault|finance|\.env(?:\.[^/]*)?)(?:[\\/]|$)/i.test(path)
    ? "[restricted path]" : prose(path, 240);
}

// Any fresh attempt conservatively invalidates old evidence, even before it can
// be proven useful. These are durable PRIMARY events, not renderer state.
const NEW_EVIDENCE = new Set([
  "LOOP_TURN_PLANNED", "WORKER_SEND_INTENT", "VERIFICATION_PASSED", "VERIFICATION_FAILED",
  "VERIFICATION_INDETERMINATE", "CHECKPOINT_CREATED", "CHECKPOINT_RECOVERED", "RUN_COMPLETED", "STOP_REQUESTED", "RUN_STOPPED"
]);
export function isConsultationEvidence(event: Pick<RunEventRecord, "type" | "payload">): boolean {
  return event.type === "PRIMARY_PROGRESS_EVALUATED" || NEW_EVIDENCE.has(event.type) ||
    event.type === "WORKER_OUTPUT_APPLIED" && Number(event.payload.applied) > 0;
}

/** Local control state only. No worker, effects gateway or platform capability. */
export class ConsultationStore {
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;
  constructor(ports: RuntimePorts) { this.ports = ports; this.store = new AutopilotStore(ports); }

  private rows(runId: string): Row[] {
    return this.ports.db.prepare("SELECT * FROM autopilot_consultations WHERE run_id=:runId ORDER BY rowid").all<Row>({ runId });
  }
  private fresh(identity: ConsultationIdentity): boolean {
    const run = this.store.requireRun(identity.runId);
    const roles = rolesFor(run.spec);
    if (roles.primary !== identity.primaryProvider || roles.consultant !== identity.consultantProvider ||
      authoritativeFingerprint(run.spec) !== identity.specFingerprint || identity.diagnosisLimit !== 1) return false;
    const events = this.store.listEvents(identity.runId);
    const trigger = events.find(e => e.id === identity.triggerEventId && e.seq === identity.triggerSeq);
    if (!trigger) return false;
    if (identity.triggerType === "OPERATOR") {
      if (trigger.type !== "CONSULTATION_REQUESTED" || trigger.payload.requestId !== identity.id ||
        trigger.payload.consultantProvider !== identity.consultantProvider) return false;
    } else {
      const decision = trigger.payload.decision as PrimaryProgress | undefined;
      if (trigger.type !== "PRIMARY_PROGRESS_EVALUATED" || decision?.status !== identity.triggerType ||
        decision.turnId !== identity.triggeringTurnId || decision.reason !== identity.triggerReason || !decision.consultantRecommended) return false;
    }
    return !events.some(e => e.seq > identity.triggerSeq && isConsultationEvidence(e));
  }
  private project(row: Row): ConsultationRecord {
    const identity = JSON.parse(row.identity_json) as ConsultationIdentity;
    const intact = identity.id === row.id && identity.runId === row.run_id && identity.triggerEventId === row.trigger_event_id;
    const fresh = intact && this.fresh(identity);
    return { ...identity, id: row.id, runId: row.run_id, status: row.status, createdAt: row.created_at,
      resolvedAt: row.resolved_at, approvalSource: row.approval_source, resolutionSource: row.resolution_source,
      executionEligible: fresh && row.status === "APPROVED" && row.approval_source === "desktop_ui" && row.approved_identity_json === row.identity_json,
      canApprove: fresh && row.status === "RECOMMENDED", canCancel: ["RECOMMENDED", "APPROVED"].includes(row.status) };
  }
  /** Read-only report projection; never creates requests or repairs state. */
  list(runId: string): ConsultationRecord[] { return this.rows(runId).map(row => this.project(row)); }
  executionEligible(scope: ConsultationScope): boolean {
    const row = this.rows(scope.runId).find(r => r.id === scope.requestId);
    if (!row) return false;
    const record = this.project(row);
    return record.consultantProvider === scope.consultantProvider && record.executionEligible;
  }

  private preview(runId: string, basis: {
    turnId: string | null; turnOrdinal: number | null; reason: string;
    failureFingerprint: string | null; progressStatus: string | null;
  }): ConsultationPreview {
    const run = this.store.requireRun(runId);
    const verification = new LoopStore(this.ports).verifications(runId).filter(v => v.turnId === basis.turnId).at(-1)
      // An operator request may arrive on a turn that produced no verification of
      // its own; the most recent one is still the honest current evidence.
      ?? new LoopStore(this.ports).verifications(runId).at(-1);
    const checkpoint = new CheckpointStore(this.ports).list(runId).filter(c => ["COMMITTED", "NO_CHANGES"].includes(c.status)).at(-1);
    const paths = this.store.listEvents(runId).filter(e => e.type === "WORKER_OUTPUT_APPLIED")
      .flatMap(e => Array.isArray(e.payload.paths) ? e.payload.paths.filter((p): p is string => typeof p === "string") : []);
    const tier = verification?.report.failingTier;
    return {
      goal: prose(run.spec.goal, 16000), constraints: run.spec.constraints.slice(0, 30).map(s => prose(s)),
      acceptanceCriteria: run.spec.acceptanceCriteria.slice(0, 30).map(c => prose(c.text)),
      primaryProvider: rolesFor(run.spec).primary, triggeringTurn: basis.turnOrdinal,
      failingTier: tier ? prose(tier.tier, 80) : null,
      failureSummary: tier ? `${verification!.outcome}: ${prose(tier.tier, 80)}; exit ${tier.exitCode ?? "unavailable"}; fingerprint ${basis.failureFingerprint ?? "none"}` : prose(basis.reason, 300),
      changedPaths: [...new Set(paths.map(safePath))].slice(0, 40),
      latestCheckpoint: checkpoint ? { id: checkpoint.id, commitSha: checkpoint.commitSha, status: checkpoint.status } : null,
      contextRequests: new ContextRequestStore(this.ports).list(runId)
        .filter(r => r.requestedTurnId === basis.turnId || r.consumedTurnId === basis.turnId || r.status === "PENDING")
        .slice(-20).map(r => ({ path: safePath(r.path), status: r.status, reason: r.denialReason ? prose(r.denialReason, 240) : null,
          bytesSupplied: r.bytesSupplied, requestedTurnId: r.requestedTurnId, consumedTurnId: r.consumedTurnId })),
      primarySessionId: new WorkerStore(this.ports).session(runId)?.sessionId ?? null,
      latestVerification: verification?.outcome ?? null,
      workspace: (() => {
        const snapshot = new CheckpointStore(this.ports).latestSnapshot(runId);
        return snapshot ? { headSha: snapshot.headSha, changedFiles: snapshot.changedFiles } : null;
      })(),
      progressStatus: basis.progressStatus
    };
  }
  private event(row: Row, type: "CONSULTATION_APPROVED" | "CONSULTATION_CANCELLED" | "CONSULTATION_SUPERSEDED", source: string): void {
    this.store.appendEventUnsafe(row.run_id, this.store.requireRun(row.run_id).state, {
      type, payload: { requestId: row.id, consultantProvider: (JSON.parse(row.identity_json) as ConsultationIdentity).consultantProvider, source }
    });
  }
  /** Called inside the same transaction as the triggering evidence event. */
  reconcileUnsafe(runId: string): void {
    // Legacy migration tests can construct an older database deliberately.
    if (!this.ports.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_consultations'").get()) return;
    for (const row of this.rows(runId)) {
      if (!["RECOMMENDED", "APPROVED"].includes(row.status)) continue;
      const projected = this.project(row);
      if (!projected.canApprove && !projected.executionEligible) {
        this.ports.db.prepare("UPDATE autopilot_consultations SET status='SUPERSEDED', resolved_at=:now, resolution_source='new_or_changed_primary_evidence' WHERE id=:id")
          .run({ id: row.id, now: this.ports.clock.now() });
        this.event(row, "CONSULTATION_SUPERSEDED", "new_or_changed_primary_evidence");
      }
    }
    const trigger = this.store.listEvents(runId).reverse().find(e => e.type === "PRIMARY_PROGRESS_EVALUATED");
    const decision = trigger?.payload.decision as PrimaryProgress | undefined;
    const run = this.store.requireRun(runId);
    const roles = rolesFor(run.spec);
    if (!trigger || !decision?.consultantRecommended || !["STALLED", "BLOCKED"].includes(decision.status) ||
      !roles.consultant || roles.primary === roles.consultant || !["claude", "codex"].includes(roles.primary)) return;
    if (this.rows(runId).some(r => r.trigger_event_id === trigger.id || ["RECOMMENDED", "APPROVED"].includes(r.status))) return;
    const identity: ConsultationIdentity = {
      version: 1, id: this.ports.ids.next("consultation"), runId, primaryProvider: roles.primary as CodingProvider,
      consultantProvider: roles.consultant, triggerEventId: trigger.id, triggerSeq: trigger.seq,
      triggeringTurnId: decision.turnId, triggerType: decision.status as "STALLED" | "BLOCKED", triggerReason: decision.reason,
      specFingerprint: authoritativeFingerprint(run.spec), diagnosisLimit: 1,
      preview: this.preview(runId, { turnId: decision.turnId, turnOrdinal: decision.turnOrdinal, reason: decision.reason,
        failureFingerprint: decision.failureFingerprint, progressStatus: decision.status })
    };
    if (!this.fresh(identity)) return;
    this.ports.db.prepare(`INSERT INTO autopilot_consultations(id,run_id,trigger_event_id,identity_json,status,created_at)
      VALUES(:id,:runId,:trigger,:identity,'RECOMMENDED',:now)`)
      .run({ id: identity.id, runId, trigger: trigger.id, identity: JSON.stringify(identity), now: this.ports.clock.now() });
    this.store.appendEventUnsafe(runId, run.state, { type: "CONSULTATION_RECOMMENDED",
      payload: { requestId: identity.id, primaryProvider: identity.primaryProvider, consultantProvider: identity.consultantProvider, triggerEventId: trigger.id } });
  }
  reconcile(runId: string): void { this.store.transaction(() => this.reconcileUnsafe(runId)); }
  recover(): void {
    const rows = this.ports.db.prepare("SELECT id FROM autopilot_runs").all<{ id: string }>();
    for (const row of rows) this.reconcile(row.id);
  }
  /**
   * Whether a human may ask for a second opinion right now, and why not.
   *
   * Deliberately does not require STALLED or BLOCKED: the point of this path is
   * a run that is working but which the operator wants reviewed. It does
   * require that PRIMARY has actually produced something to review, that no
   * consultation is already in flight, and that PRIMARY is not mid-turn.
   */
  operatorEligibility(runId: string): { eligible: boolean; reason: OperatorConsultationBlocker | null } {
    const deny = (reason: OperatorConsultationBlocker) => ({ eligible: false, reason });
    const run = this.store.requireRun(runId);
    const roles = rolesFor(run.spec);
    if (!roles.consultant || !["claude", "codex"].includes(roles.primary)) return deny("no_consultant_configured");
    if (roles.primary === roles.consultant) return deny("consultant_is_primary");
    if (["COMPLETED", "FAILED", "STOPPED"].includes(run.state)) return deny("run_finished");

    // A consultant reviews work, so there must be work: a sticky PRIMARY session
    // and at least one turn that has settled into durable evidence.
    const session = new WorkerStore(this.ports).session(runId);
    const turns = new LoopStore(this.ports).turns(runId);
    const settled = turns.filter(turn => turn.status !== "PLANNED");
    if (!session || settled.length === 0) return deny("no_primary_evidence");

    // Deterministic rejection rather than a queue: the operator asks again once
    // the turn lands, and nothing has to be held across a process boundary.
    const inFlight = new WorkerStore(this.ports).list(runId)
      .some(send => ["INTENT", "AWAITING_APPROVAL", "DISPATCHING"].includes(send.status));
    if (inFlight || turns.some(turn => turn.status === "PLANNED")) return deny("primary_turn_in_flight");

    if (this.rows(runId).some(row => ["RECOMMENDED", "APPROVED"].includes(row.status))) return deny("consultation_already_active");
    // One unspent opinion at a time: a completed diagnosis PRIMARY has not yet
    // seen would make a second one redundant.
    if (new ConsultantStore(this.ports).pendingForPrimary(runId)) return deny("diagnosis_already_pending");

    return { eligible: true, reason: null };
  }

  /**
   * Records a human's request for a second opinion.
   *
   * This creates request state and nothing else: no consultant process, no
   * approval, no hold change, no PRIMARY turn, no grant consumption. The
   * existing human approval step still gates execution.
   */
  requestOperator(input: { runId: string; consultantProvider: CodingProvider; source: "desktop_ui" }): ConsultationRecord {
    if (input.source !== "desktop_ui") throw new Error("An operator consultation requires an explicit human request.");
    this.reconcile(input.runId);
    return this.store.transaction(() => {
      const { eligible, reason } = this.operatorEligibility(input.runId);
      if (!eligible) throw new Error(`A second opinion cannot be requested now: ${reason}.`);
      const run = this.store.requireRun(input.runId);
      const roles = rolesFor(run.spec);
      if (roles.consultant !== input.consultantProvider) throw new Error("Consultation provider mismatch.");

      const id = this.ports.ids.next("consultation");
      const decision = latestPrimaryProgress(this.ports, input.runId);
      const turn = new LoopStore(this.ports).turns(input.runId).filter(t => t.status !== "PLANNED").at(-1) ?? null;

      // The request event is this consultation's trigger, so freshness and
      // supersession work exactly as they do for an automatic recommendation.
      const trigger = this.store.appendEventUnsafe(input.runId, run.state, {
        type: "CONSULTATION_REQUESTED",
        payload: { requestId: id, primaryProvider: roles.primary, consultantProvider: roles.consultant, source: input.source }
      });

      const identity: ConsultationIdentity = {
        version: 1, id, runId: input.runId, primaryProvider: roles.primary as CodingProvider,
        consultantProvider: roles.consultant, triggerEventId: trigger.id, triggerSeq: trigger.seq,
        triggeringTurnId: turn?.id ?? null, triggerType: "OPERATOR",
        triggerReason: "operator_requested_second_opinion",
        specFingerprint: authoritativeFingerprint(run.spec), diagnosisLimit: 1,
        preview: this.preview(input.runId, {
          turnId: turn?.id ?? null, turnOrdinal: turn?.ordinal ?? null,
          reason: "operator_requested_second_opinion", failureFingerprint: decision?.failureFingerprint ?? null,
          progressStatus: decision?.status ?? null
        })
      };
      this.ports.db.prepare(`INSERT INTO autopilot_consultations(id,run_id,trigger_event_id,identity_json,status,created_at)
        VALUES(:id,:runId,:trigger,:identity,'RECOMMENDED',:now)`)
        .run({ id, runId: input.runId, trigger: trigger.id, identity: JSON.stringify(identity), now: this.ports.clock.now() });
      return this.list(input.runId).find(r => r.id === id)!;
    });
  }

  resolve(input: ConsultationScope & { decision: "APPROVED" | "CANCELLED"; source: "desktop_ui" }): ConsultationRecord {
    // LoopGrant sources and automatic callers never confer consultation authority.
    if (input.source !== "desktop_ui" || !["APPROVED", "CANCELLED"].includes(input.decision)) throw new Error("Consultation requires an explicit human decision.");
    this.reconcile(input.runId);
    return this.store.transaction(() => {
      const row = this.rows(input.runId).find(r => r.id === input.requestId);
      if (!row) throw new Error("Consultation does not belong to this run.");
      const record = this.project(row);
      if (record.consultantProvider !== input.consultantProvider) throw new Error("Consultation provider mismatch.");
      if (row.status === input.decision) return record;
      if (input.decision === "APPROVED" ? !record.canApprove : !record.canCancel) throw new Error("Consultation is no longer actionable.");
      this.ports.db.prepare(`UPDATE autopilot_consultations SET status=:status, resolved_at=:now, resolution_source=:source,
        approval_source=CASE WHEN :status='APPROVED' THEN :source ELSE approval_source END,
        approved_identity_json=CASE WHEN :status='APPROVED' THEN identity_json ELSE approved_identity_json END WHERE id=:id`)
        .run({ id: row.id, status: input.decision, now: this.ports.clock.now(), source: input.source });
      this.event(row, input.decision === "APPROVED" ? "CONSULTATION_APPROVED" : "CONSULTATION_CANCELLED", input.source);
      return this.list(input.runId).find(r => r.id === input.requestId)!;
    });
  }
}
