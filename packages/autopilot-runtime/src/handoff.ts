// Controlled PRIMARY ownership handoff.
//
// A run always has exactly one implementation owner. This module is how that
// owner changes: never automatically, never by mutating a CONSULTANT into a
// writer, and never leaving two providers able to write at once.
//
// The Run Spec stays authoritative and untouched. Ownership is separate durable
// state, so a handoff does not rewrite the spec, does not change its
// fingerprint, and does not invalidate anything bound to it.
//
// The shape of the thing:
//
//   propose -> PROPOSED -> approve -> APPROVED -> activate -> ACTIVE
//                   \-> CANCELLED / SUPERSEDED        \-> FAILED
//
// Every arrow except supersession is a human action. Activation is one
// transaction: either the new provider owns the run and holds a fresh grant, or
// nothing changed.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import { LoopStore } from "./loopStore.ts";
import { WorkerStore } from "./workerStore.ts";
import { CheckpointStore } from "./checkpoints.ts";
import { ContextRequestStore } from "./contextRequests.ts";
import { ConsultantStore } from "./consultant.ts";
import { latestPrimaryProgress, type PrimaryProgress } from "./progress.ts";
import { authoritativeFingerprint } from "./runSpec.ts";
import { rolesFor, type CodingProvider } from "./roles.ts";
import type { RunSpec } from "./runSpec.ts";

export type HandoffStatus = "PROPOSED" | "APPROVED" | "ACTIVATING" | "ACTIVE" | "CANCELLED" | "SUPERSEDED" | "FAILED";
export type HandoffSource = "OPERATOR" | "SYSTEM_RECOMMENDED";

/** Why a handoff cannot be proposed right now. */
export type HandoffBlocker =
  | "run_finished"
  | "no_alternate_provider"
  | "target_is_current_primary"
  | "target_not_configured"
  | "no_primary_evidence"
  | "primary_turn_in_flight"
  | "handoff_already_open"
  | "workspace_missing";

/**
 * The frozen briefing handed to the incoming PRIMARY.
 *
 * Bounded structured evidence only: no conversation history, no secrets, no
 * environment, no repository dump. What a competent engineer would want on
 * taking over someone else's half-finished branch.
 */
export interface HandoffPackage {
  version: 1;
  goal: string;
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: Array<{ text: string; status: string }>;
  fromProvider: string;
  toProvider: string;
  fromSessionId: string | null;
  runState: string;
  progress: { status: string; reason: string } | null;
  latestVerification: { outcome: string; summary: string; failingTier: string | null; exitCode: number | null } | null;
  attempts: Array<{ ordinal: number; status: string; verification: string | null }>;
  changedPaths: string[];
  workspace: { root: string; headSha: string | null; status: string; changedFiles: number };
  latestCheckpoint: { commitSha: string | null; status: string } | null;
  consultantDiagnosis: { provider: string; suppliedToTurnId: string | null; text: string } | null;
  openContextRequests: Array<{ path: string; status: string }>;
  doNotChange: string[];
  specFingerprint: string;
}

export interface HandoffRecord {
  id: string;
  runId: string;
  source: HandoffSource;
  fromProvider: CodingProvider;
  toProvider: CodingProvider;
  reason: string;
  status: HandoffStatus;
  package: HandoffPackage;
  packageFingerprint: string;
  specFingerprint: string;
  workspaceRoot: string;
  fromSessionId: string | null;
  toSessionId: string | null;
  approvalSource: string | null;
  proposedAt: string;
  approvedAt: string | null;
  activatingAt: string | null;
  activatedAt: string | null;
  resolvedAt: string | null;
  resolutionSource: string | null;
  failure: string | null;
  /** Recomputed: the frozen evidence still matches the run. */
  fresh: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canActivate: boolean;
}

export interface OwnershipRecord {
  id: string;
  runId: string;
  ordinal: number;
  provider: CodingProvider;
  role: "PRIMARY";
  sessionId: string | null;
  providerSessionId: string | null;
  cwd: string | null;
  established: boolean;
  status: "ACTIVE" | "HISTORICAL";
  handoffId: string | null;
  startedAt: string;
  retiredAt: string | null;
}

const MAX_DIAGNOSIS_IN_PACKAGE = 4000;

function fingerprint(value: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let index = 0; index < value.length; index += 1) {
    a = Math.imul(a ^ value.charCodeAt(index), 16777619) >>> 0;
    b = (Math.imul(b, 33) ^ value.charCodeAt(index)) >>> 0;
  }
  return `hp-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** Bounded, control-character-free prose. Mirrors the consultation preview. */
function prose(value: string, limit = 1000): string {
  return value
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/g, "[redacted private key]")
    .replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|AKIA[A-Z0-9]{16})\b/g, "[redacted credential]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[redacted authorization]")
    .replace(/\b[\w.-]*(?:api[_-]?key|token|secret|password|credential)[\w.-]*\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted credential]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, limit);
}

function safePath(path: string): string {
  return /^(?:[a-z]:|[\\/])|(?:^|[\\/])(?:\.\.|local-data|vault|finance|\.env(?:\.[^/]*)?)(?:[\\/]|$)/i.test(path)
    ? "[restricted path]"
    : prose(path, 240);
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

interface OwnershipRow {
  id: string; run_id: string; ordinal: number; provider: string; role: string;
  session_id: string | null; provider_session_id: string | null; cwd: string | null;
  established: number; status: string; handoff_id: string | null;
  started_at: string; retired_at: string | null;
}

function toOwnership(row: OwnershipRow): OwnershipRecord {
  return {
    id: row.id, runId: row.run_id, ordinal: row.ordinal, provider: row.provider as CodingProvider,
    role: "PRIMARY", sessionId: row.session_id, providerSessionId: row.provider_session_id,
    cwd: row.cwd, established: row.established === 1, status: row.status as "ACTIVE" | "HISTORICAL",
    handoffId: row.handoff_id, startedAt: row.started_at, retiredAt: row.retired_at
  };
}

/**
 * Durable record of who has owned implementation, and when.
 *
 * A run with no rows here has never been handed off; its owner is whatever the
 * Run Spec names. That keeps every historical run valid without backfilling.
 */
export class OwnershipStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private available(): boolean {
    return Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_primary_ownership'").get());
  }

  history(runId: string): OwnershipRecord[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_primary_ownership WHERE run_id=:runId ORDER BY ordinal")
      .all<OwnershipRow>({ runId })
      .map(toOwnership);
  }

  active(runId: string): OwnershipRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_primary_ownership WHERE run_id=:runId AND status='ACTIVE'")
      .get<OwnershipRow>({ runId });
    return row ? toOwnership(row) : null;
  }

  /** The provider that owns implementation right now. */
  primaryProvider(runId: string, spec: Pick<RunSpec, "workers">): string {
    return this.active(runId)?.provider ?? rolesFor(spec).primary;
  }

  /**
   * Opens an ownership period. Used to record the original owner the first time
   * a run is handed off, and to record the incoming owner on activation.
   */
  openUnsafe(input: {
    runId: string; provider: CodingProvider; handoffId: string | null;
    sessionId?: string | null; providerSessionId?: string | null; cwd?: string | null; established?: boolean;
    startedAt?: string;
  }): OwnershipRecord {
    const ordinal = (this.history(input.runId).at(-1)?.ordinal ?? 0) + 1;
    this.db
      .prepare(
        `INSERT INTO autopilot_primary_ownership
           (id,run_id,ordinal,provider,session_id,provider_session_id,cwd,established,status,handoff_id,started_at)
         VALUES(:id,:runId,:ordinal,:provider,:sessionId,:providerSessionId,:cwd,:established,'ACTIVE',:handoffId,:startedAt)`
      )
      .run({
        id: this.ports.ids.next("ownership"), runId: input.runId, ordinal, provider: input.provider,
        sessionId: input.sessionId ?? null, providerSessionId: input.providerSessionId ?? null,
        cwd: input.cwd ?? null, established: input.established ? 1 : 0,
        handoffId: input.handoffId, startedAt: input.startedAt ?? this.ports.clock.now()
      });
    return this.active(input.runId)!;
  }

  /** Closes the current ownership period, capturing the session it held. */
  retireUnsafe(runId: string, session: { sessionId: string; providerSessionId?: string | null; cwd: string; established: boolean } | null): void {
    const current = this.active(runId);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE autopilot_primary_ownership
            SET status='HISTORICAL', retired_at=:now,
                session_id=COALESCE(:sessionId, session_id),
                provider_session_id=COALESCE(:providerSessionId, provider_session_id),
                cwd=COALESCE(:cwd, cwd),
                established=:established
          WHERE id=:id`
      )
      .run({
        id: current.id, now: this.ports.clock.now(),
        sessionId: session?.sessionId ?? null, providerSessionId: session?.providerSessionId ?? null,
        cwd: session?.cwd ?? null, established: session?.established ? 1 : current.established ? 1 : 0
      });
  }

  /**
   * Ensures the run's original owner is on record before the first handoff, so
   * history is complete rather than starting at the second owner.
   */
  bootstrapUnsafe(runId: string): OwnershipRecord {
    const existing = this.active(runId);
    if (existing) return existing;
    const run = this.store.requireRun(runId);
    const session = new WorkerStore(this.ports).session(runId);
    return this.openUnsafe({
      runId, provider: rolesFor(run.spec).primary as CodingProvider, handoffId: null,
      sessionId: session?.sessionId ?? null, providerSessionId: session?.providerSessionId ?? null,
      cwd: session?.cwd ?? null, established: session?.established ?? false,
      startedAt: run.createdAt
    });
  }
}

/**
 * The roles in force right now, accounting for any completed handoff.
 *
 * The consultant is simply the configured pair member that is not the current
 * owner, so a handoff swaps the two roles rather than losing one.
 */
export function currentRoles(ports: RuntimePorts, runId: string, spec: Pick<RunSpec, "workers">): { primary: string; consultant: string | null } {
  const configured = rolesFor(spec);
  const owner = new OwnershipStore(ports).primaryProvider(runId, spec);
  if (owner === configured.primary) return configured;
  const consultant = [configured.primary, configured.consultant].find((entry) => entry && entry !== owner) ?? null;
  return { primary: owner, consultant: consultant as string | null };
}

// ---------------------------------------------------------------------------
// The handoff package
// ---------------------------------------------------------------------------

/** Freezes the bounded evidence the incoming PRIMARY needs. */
export function buildHandoffPackage(ports: RuntimePorts, runId: string, toProvider: CodingProvider): HandoffPackage {
  const store = new AutopilotStore(ports);
  const run = store.requireRun(runId);
  const loops = new LoopStore(ports);
  const roles = currentRoles(ports, runId, run.spec);
  const session = new WorkerStore(ports).session(runId);
  const turns = loops.turns(runId);
  const verifications = loops.verifications(runId);
  const latest = verifications.at(-1);
  const progress = latestPrimaryProgress(ports, runId);
  const checkpoint = new CheckpointStore(ports).list(runId).filter((c) => ["COMMITTED", "NO_CHANGES"].includes(c.status)).at(-1);
  const snapshot = new CheckpointStore(ports).latestSnapshot(runId);

  const applied = store.listEvents(runId)
    .filter((event) => event.type === "WORKER_OUTPUT_APPLIED")
    .flatMap((event) => (Array.isArray(event.payload.paths) ? event.payload.paths.filter((p): p is string => typeof p === "string") : []));

  // A diagnosis the outgoing PRIMARY already saw is part of the story; one it
  // never consumed is still the most recent independent read of the problem.
  const diagnosis = new ConsultantStore(ports).diagnoses(runId).filter((entry) => entry.status === "COMPLETED").at(-1);

  const tier = latest?.report.failingTier;
  return {
    version: 1,
    goal: prose(run.spec.goal, 16000),
    constraints: run.spec.constraints.slice(0, 30).map((entry) => prose(entry)),
    nonGoals: run.spec.nonGoals.slice(0, 30).map((entry) => prose(entry)),
    acceptanceCriteria: run.spec.acceptanceCriteria.slice(0, 30).map((criterion) => ({
      text: prose(criterion.text), status: criterion.kind === "automated" ? "checked by verification" : "human judgement"
    })),
    fromProvider: roles.primary,
    toProvider,
    fromSessionId: session?.sessionId ?? null,
    runState: run.state,
    progress: progress ? { status: progress.status, reason: prose(progress.reason, 300) } : null,
    latestVerification: latest
      ? {
          outcome: latest.report.outcome,
          summary: prose(latest.report.summary, 2000),
          failingTier: tier ? prose(tier.tier, 80) : null,
          exitCode: tier?.exitCode ?? null
        }
      : null,
    attempts: turns.slice(-10).map((turn) => ({
      ordinal: turn.ordinal, status: turn.status,
      verification: verifications.find((entry) => entry.turnId === turn.id)?.report.outcome ?? null
    })),
    changedPaths: [...new Set(applied.map(safePath))].slice(0, 40),
    workspace: {
      root: run.spec.capabilities.workspaceRoot ?? "",
      headSha: snapshot?.headSha ?? null,
      status: prose(snapshot?.statusText ?? "", 2000),
      changedFiles: snapshot?.changedFiles ?? 0
    },
    latestCheckpoint: checkpoint ? { commitSha: checkpoint.commitSha, status: checkpoint.status } : null,
    consultantDiagnosis: diagnosis?.diagnosis
      ? { provider: diagnosis.consultantProvider, suppliedToTurnId: diagnosis.suppliedToTurnId, text: prose(diagnosis.diagnosis, MAX_DIAGNOSIS_IN_PACKAGE) }
      : null,
    openContextRequests: new ContextRequestStore(ports).list(runId)
      .filter((request) => request.status === "PENDING")
      .slice(-20)
      .map((request) => ({ path: safePath(request.path), status: request.status })),
    doNotChange: [
      "The acceptance criteria and the verification commands.",
      "The Run Spec itself.",
      ...run.spec.constraints.slice(0, 10).map((entry) => prose(entry))
    ],
    specFingerprint: authoritativeFingerprint(run.spec)
  };
}

export function packageFingerprint(value: HandoffPackage): string {
  return fingerprint(JSON.stringify(value));
}

/** The briefing text prepended to the incoming PRIMARY's first prompt. */
export function renderHandoffBriefing(record: HandoffRecord): string {
  const p = record.package;
  const lines: string[] = [];
  lines.push("OWNERSHIP HANDOFF — YOU ARE NOW THE PRIMARY IMPLEMENTATION OWNER");
  lines.push("");
  lines.push(
    `This run was previously owned by ${p.fromProvider}. A human approved a handoff to you. ` +
      "Continue from the existing worktree. Do not restart the project and do not redo work that is already done."
  );
  lines.push("Review the summary below and the current evidence, then make the minimum changes needed to satisfy the Run Spec.");
  lines.push("");
  lines.push(`Reason for the handoff: ${record.reason}`);
  lines.push("");

  lines.push("WHAT THE PREVIOUS OWNER LEFT");
  lines.push(`- Run state: ${p.runState}${p.progress ? `; progress ${p.progress.status} (${p.progress.reason})` : ""}`);
  lines.push(`- Attempts so far: ${p.attempts.map((a) => `#${a.ordinal} ${a.status}${a.verification ? `/${a.verification}` : ""}`).join(", ") || "none"}`);
  lines.push(`- Changed files in the worktree: ${p.changedPaths.join(", ") || "none recorded"}`);
  lines.push(`- Worktree: ${p.workspace.changedFiles} changed file(s) at ${p.workspace.headSha ?? "an unrecorded commit"}`);
  lines.push(`- Last known-good checkpoint: ${p.latestCheckpoint ? p.latestCheckpoint.commitSha ?? p.latestCheckpoint.status : "none"}`);

  if (p.latestVerification) {
    lines.push("");
    lines.push("CURRENT VERIFICATION EVIDENCE");
    lines.push(`- Outcome: ${p.latestVerification.outcome}`);
    lines.push(`- Failing check: ${p.latestVerification.failingTier ?? "none recorded"}; exit ${p.latestVerification.exitCode ?? "unavailable"}`);
    lines.push(p.latestVerification.summary);
  }

  if (p.consultantDiagnosis) {
    lines.push("");
    lines.push(`SECOND OPINION ALREADY OBTAINED (from ${p.consultantDiagnosis.provider})`);
    lines.push(
      p.consultantDiagnosis.suppliedToTurnId
        ? "The previous owner was given this advice and still did not finish."
        : "This advice was never delivered to the previous owner."
    );
    lines.push(p.consultantDiagnosis.text);
  }

  if (p.openContextRequests.length > 0) {
    lines.push("");
    lines.push("FILES THE PREVIOUS OWNER ASKED TO SEE");
    for (const request of p.openContextRequests) lines.push(`- ${request.path}: ${request.status}`);
  }

  lines.push("");
  lines.push("THINGS NOT TO CHANGE");
  for (const entry of p.doNotChange) lines.push(`- ${entry}`);
  lines.push("");
  lines.push("END HANDOFF SUMMARY");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The handoff itself
// ---------------------------------------------------------------------------

interface HandoffRow {
  id: string; run_id: string; source: string; from_provider: string; to_provider: string;
  reason: string; status: string; package_json: string; package_fingerprint: string;
  spec_fingerprint: string; workspace_root: string; trigger_event_id: string; trigger_seq: number;
  from_session_id: string | null; to_session_id: string | null; approval_source: string | null;
  proposed_at: string; approved_at: string | null; activating_at: string | null; activated_at: string | null;
  resolved_at: string | null; resolution_source: string | null; failure: string | null;
}

const OPEN_STATUSES = ["PROPOSED", "APPROVED", "ACTIVATING"];

export interface HandoffScope { runId: string; handoffId: string; toProvider: CodingProvider }

export class HandoffStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;
  private readonly ownership: OwnershipStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
    this.ownership = new OwnershipStore(ports);
  }

  private available(): boolean {
    return Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_handoffs'").get());
  }

  private rows(runId: string): HandoffRow[] {
    if (!this.available()) return [];
    return this.db.prepare("SELECT * FROM autopilot_handoffs WHERE run_id=:runId ORDER BY rowid").all<HandoffRow>({ runId });
  }

  /**
   * Whether the frozen package still describes the run.
   *
   * A settled handoff is history and stays fresh; an open one goes stale the
   * moment the spec, the workspace, the owner or the evidence moves under it.
   */
  private fresh(row: HandoffRow): boolean {
    if (!OPEN_STATUSES.includes(row.status)) return true;
    const run = this.store.requireRun(row.run_id);
    if (authoritativeFingerprint(run.spec) !== row.spec_fingerprint) return false;
    if ((run.spec.capabilities.workspaceRoot ?? "") !== row.workspace_root) return false;
    if (this.ownership.primaryProvider(row.run_id, run.spec) !== row.from_provider) return false;
    const roles = currentRoles(this.ports, row.run_id, run.spec);
    if (roles.consultant !== row.to_provider) return false;
    // The package is only trustworthy while no newer PRIMARY evidence exists.
    return packageFingerprint(buildHandoffPackage(this.ports, row.run_id, row.to_provider as CodingProvider)) === row.package_fingerprint;
  }

  private project(row: HandoffRow): HandoffRecord {
    const fresh = this.fresh(row);
    return {
      id: row.id, runId: row.run_id, source: row.source as HandoffSource,
      fromProvider: row.from_provider as CodingProvider, toProvider: row.to_provider as CodingProvider,
      reason: row.reason, status: row.status as HandoffStatus,
      package: JSON.parse(row.package_json) as HandoffPackage,
      packageFingerprint: row.package_fingerprint, specFingerprint: row.spec_fingerprint,
      workspaceRoot: row.workspace_root, fromSessionId: row.from_session_id, toSessionId: row.to_session_id,
      approvalSource: row.approval_source, proposedAt: row.proposed_at, approvedAt: row.approved_at,
      activatingAt: row.activating_at, activatedAt: row.activated_at, resolvedAt: row.resolved_at,
      resolutionSource: row.resolution_source, failure: row.failure, fresh,
      canApprove: fresh && row.status === "PROPOSED",
      canCancel: ["PROPOSED", "APPROVED"].includes(row.status),
      canActivate: fresh && row.status === "APPROVED" && row.approval_source === "desktop_ui"
    };
  }

  list(runId: string): HandoffRecord[] {
    return this.rows(runId).map((row) => this.project(row));
  }

  open(runId: string): HandoffRecord | null {
    return this.list(runId).find((entry) => OPEN_STATUSES.includes(entry.status)) ?? null;
  }

  /** Marks an open handoff whose frozen evidence no longer matches the run. */
  reconcile(runId: string): void {
    if (!this.available()) return;
    this.store.transaction(() => {
      for (const row of this.rows(runId)) {
        // ACTIVATING is a crash window, not staleness; reconcileActivation owns it.
        if (row.status !== "PROPOSED" && row.status !== "APPROVED") continue;
        if (this.fresh(row)) continue;
        this.db.prepare("UPDATE autopilot_handoffs SET status='SUPERSEDED', resolved_at=:now, resolution_source='new_or_changed_primary_evidence' WHERE id=:id")
          .run({ id: row.id, now: this.ports.clock.now() });
        const run = this.store.requireRun(runId);
        this.store.appendEventUnsafe(runId, run.state, {
          type: "HANDOFF_SUPERSEDED",
          payload: { handoffId: row.id, toProvider: row.to_provider, reason: "new_or_changed_primary_evidence" }
        });
      }
    });
  }

  /** Whether a handoff may be proposed right now, and why not. */
  eligibility(runId: string, toProvider?: CodingProvider): { eligible: boolean; reason: HandoffBlocker | null; target: CodingProvider | null } {
    const deny = (reason: HandoffBlocker) => ({ eligible: false, reason, target: null });
    const run = this.store.requireRun(runId);
    if (["COMPLETED", "FAILED", "STOPPED"].includes(run.state)) return deny("run_finished");

    const roles = currentRoles(this.ports, runId, run.spec);
    const target = toProvider ?? (roles.consultant as CodingProvider | null);
    if (!target) return deny("no_alternate_provider");
    if (target === roles.primary) return deny("target_is_current_primary");
    if (target !== roles.consultant) return deny("target_not_configured");
    if (!run.spec.capabilities.workspaceRoot) return deny("workspace_missing");

    // A handoff hands over work, so there must be work to hand over.
    const session = new WorkerStore(this.ports).session(runId);
    const turns = new LoopStore(this.ports).turns(runId);
    if (!session || turns.filter((turn) => turn.status !== "PLANNED").length === 0) return deny("no_primary_evidence");

    const inFlight = new WorkerStore(this.ports).list(runId)
      .some((send) => ["INTENT", "AWAITING_APPROVAL", "DISPATCHING"].includes(send.status));
    if (inFlight || turns.some((turn) => turn.status === "PLANNED")) return deny("primary_turn_in_flight");
    if (this.open(runId)) return deny("handoff_already_open");

    return { eligible: true, reason: null, target };
  }

  /**
   * Whether the runtime would recommend a handoff.
   *
   * Deliberately conservative: PRIMARY is stuck and a second opinion has already
   * been spent on it, or PRIMARY is terminally blocked. Recommending is not
   * proposing, and proposing is not activating.
   */
  recommendation(runId: string): { recommended: boolean; reason: string | null } {
    if (!this.eligibility(runId).eligible) return { recommended: false, reason: null };
    const progress = latestPrimaryProgress(this.ports, runId);
    if (!progress || progress.status === "PROGRESSING") return { recommended: false, reason: null };
    if (progress.status === "BLOCKED") return { recommended: true, reason: `PRIMARY is blocked: ${progress.reason}` };
    const consumed = new ConsultantStore(this.ports).diagnoses(runId)
      .some((entry) => entry.status === "COMPLETED" && entry.suppliedToTurnId);
    return consumed
      ? { recommended: true, reason: "PRIMARY remains stalled after a consultant diagnosis was supplied and retried." }
      : { recommended: false, reason: null };
  }

  /** Creates a PROPOSED handoff. Changes nothing else about the run. */
  propose(input: { runId: string; toProvider: CodingProvider; source: HandoffSource; reason?: string; requestedBy: "desktop_ui" }): HandoffRecord {
    if (input.requestedBy !== "desktop_ui") throw new Error("A handoff proposal requires an explicit human request.");
    this.reconcile(input.runId);
    const recommended = this.recommendation(input.runId).reason;
    return this.store.transaction(() => {
      const { eligible, reason } = this.eligibility(input.runId, input.toProvider);
      if (!eligible) throw new Error(`A handoff cannot be proposed now: ${reason}.`);
      const run = this.store.requireRun(input.runId);
      const roles = currentRoles(this.ports, input.runId, run.spec);
      const session = new WorkerStore(this.ports).session(input.runId);

      const id = this.ports.ids.next("handoff");
      const frozen = buildHandoffPackage(this.ports, input.runId, input.toProvider);
      const trigger = this.store.appendEventUnsafe(input.runId, run.state, {
        type: "HANDOFF_PROPOSED",
        payload: { handoffId: id, source: input.source, fromProvider: roles.primary, toProvider: input.toProvider }
      });

      this.db
        .prepare(
          `INSERT INTO autopilot_handoffs
             (id,run_id,source,from_provider,to_provider,reason,status,package_json,package_fingerprint,
              spec_fingerprint,workspace_root,trigger_event_id,trigger_seq,from_session_id,proposed_at)
           VALUES(:id,:runId,:source,:from,:to,:reason,'PROPOSED',:pkg,:fp,:specFp,:workspace,:trigger,:seq,:fromSession,:now)`
        )
        .run({
          id, runId: input.runId, source: input.source, from: roles.primary, to: input.toProvider,
          reason: prose(input.reason ?? (input.source === "OPERATOR" ? "operator_requested_handoff" : recommended ?? "system_recommended_handoff"), 500),
          pkg: JSON.stringify(frozen), fp: packageFingerprint(frozen),
          specFp: authoritativeFingerprint(run.spec), workspace: run.spec.capabilities.workspaceRoot ?? "",
          trigger: trigger.id, seq: trigger.seq, fromSession: session?.sessionId ?? null, now: this.ports.clock.now()
        });
      return this.list(input.runId).find((entry) => entry.id === id)!;
    });
  }

  /** Human approval. Authorizes activation and nothing else. */
  resolve(input: HandoffScope & { decision: "APPROVED" | "CANCELLED"; source: "desktop_ui" }): HandoffRecord {
    if (input.source !== "desktop_ui") throw new Error("A handoff requires an explicit human decision.");
    this.reconcile(input.runId);
    return this.store.transaction(() => {
      const row = this.rows(input.runId).find((entry) => entry.id === input.handoffId);
      if (!row) throw new Error("Handoff does not belong to this run.");
      const record = this.project(row);
      if (record.toProvider !== input.toProvider) throw new Error("Handoff target mismatch.");
      if (row.status === input.decision) return record;
      if (input.decision === "APPROVED" ? !record.canApprove : !record.canCancel) {
        throw new Error("Handoff is no longer actionable.");
      }
      this.db
        .prepare(
          `UPDATE autopilot_handoffs
              SET status=:status, resolved_at=:now, resolution_source=:source,
                  approval_source=CASE WHEN :status='APPROVED' THEN :source ELSE approval_source END,
                  approved_at=CASE WHEN :status='APPROVED' THEN :now ELSE approved_at END
            WHERE id=:id`
        )
        .run({ id: row.id, status: input.decision, now: this.ports.clock.now(), source: input.source });
      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: input.decision === "APPROVED" ? "HANDOFF_APPROVED" : "HANDOFF_CANCELLED",
        payload: { handoffId: row.id, toProvider: row.to_provider, source: input.source }
      });
      return this.list(input.runId).find((entry) => entry.id === row.id)!;
    });
  }

  /** Journals the intent to activate, before anything else changes. */
  beginActivationUnsafe(handoffId: string): void {
    this.db.prepare("UPDATE autopilot_handoffs SET status='ACTIVATING', activating_at=:now WHERE id=:id AND status='APPROVED'")
      .run({ id: handoffId, now: this.ports.clock.now() });
  }

  failActivationUnsafe(handoffId: string, failure: string): void {
    this.db.prepare("UPDATE autopilot_handoffs SET status='FAILED', failure=:failure, resolved_at=:now WHERE id=:id AND status='ACTIVATING'")
      .run({ id: handoffId, failure: prose(failure, 500), now: this.ports.clock.now() });
  }

  completeActivationUnsafe(handoffId: string, toSessionId: string): void {
    this.db.prepare("UPDATE autopilot_handoffs SET status='ACTIVE', activated_at=:now, to_session_id=:session WHERE id=:id AND status='ACTIVATING'")
      .run({ id: handoffId, session: toSessionId, now: this.ports.clock.now() });
  }

  /**
   * Resolves an activation interrupted by a crash.
   *
   * Ownership is the single source of truth: if the incoming provider already
   * owns the run then activation committed and only the handoff row lagged;
   * otherwise nothing took effect and the handoff is FAILED so a human proposes
   * again. Neither outcome can produce two owners.
   */
  reconcileActivation(runId: string): void {
    if (!this.available()) return;
    this.store.transaction(() => {
      for (const row of this.rows(runId)) {
        if (row.status !== "ACTIVATING") continue;
        const owner = this.ownership.active(runId);
        const run = this.store.requireRun(runId);
        if (owner?.provider === row.to_provider) {
          this.db.prepare("UPDATE autopilot_handoffs SET status='ACTIVE', activated_at=COALESCE(activated_at,:now), to_session_id=COALESCE(to_session_id,:session) WHERE id=:id")
            .run({ id: row.id, now: this.ports.clock.now(), session: owner.sessionId });
          this.store.appendEventUnsafe(runId, run.state, {
            type: "HANDOFF_ACTIVATED",
            payload: { handoffId: row.id, toProvider: row.to_provider, reconciled: true }
          });
          continue;
        }
        this.db.prepare("UPDATE autopilot_handoffs SET status='FAILED', failure='activation_interrupted', resolved_at=:now WHERE id=:id")
          .run({ id: row.id, now: this.ports.clock.now() });
        this.store.appendEventUnsafe(runId, run.state, {
          type: "HANDOFF_FAILED",
          payload: { handoffId: row.id, toProvider: row.to_provider, failure: "activation_interrupted" }
        });
      }
    });
  }
}

/**
 * Delivers the frozen handoff briefing to the incoming owner's first turn.
 *
 * "First turn" is decided from durable state: the briefing appears while the
 * active ownership period has no settled turn of its own, so a restart between
 * activation and that turn still delivers it, and later turns do not repeat it.
 */
export class HandoffBriefings {
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.store = new AutopilotStore(ports);
  }

  briefingFor(runId: string): string | null {
    const ownership = new OwnershipStore(this.ports).active(runId);
    if (!ownership?.handoffId) return null;
    const handoff = new HandoffStore(this.ports).list(runId).find((entry) => entry.id === ownership.handoffId);
    if (!handoff || handoff.status !== "ACTIVE") return null;
    // Only until this owner has produced a settled turn of its own.
    const settled = new LoopStore(this.ports)
      .turns(runId)
      .some((turn) => turn.status !== "PLANNED" && turn.createdAt >= ownership.startedAt);
    return settled ? null : renderHandoffBriefing(handoff);
  }
}
