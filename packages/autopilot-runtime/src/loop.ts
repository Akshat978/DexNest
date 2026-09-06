import { evaluatePrimaryProgress, latestPrimaryProgress, evidenceFingerprint } from "./progress.ts";
// The autonomous loop.
//
//   goal / Run Spec
//     -> send turn to the chosen sticky worker
//     -> receive result
//     -> run mechanical verification
//     -> if failed, send the verification evidence back to the SAME session
//     -> repeat within limits
//     -> COMPLETED, or held for a human
//
// It is deliberately not a planner. There is no model deciding what to do next:
// the next prompt is a deterministic template filled with verification output.
//
// AUTHORITY NOTE — read this before changing anything here.
// Phase 2 forbids "approve everything for this session". That still holds. What
// makes this loop possible is a bounded LoopGrant: a human authorizes at most N
// turns for one run, one provider, one session and one workspace. Policy is
// unchanged — every prompt still evaluates to REQUIRE_APPROVAL and still creates
// its own approval row — and the grant is what resolves each of those approvals,
// one per turn, recorded per turn, revocable at any moment. The human authorizes
// the loop; they do not blanket-authorize the worker.

import type { RuntimePorts } from "./ports.ts";
import type { AutopilotEngine } from "./engine.ts";
import type { CapabilityPolicy } from "./policy.ts";
import type { RunSpec } from "./runSpec.ts";
import type { WorkerAdapter } from "./worker.ts";
import type { WorkerSend } from "./workerStore.ts";
import { LoopStore, type LoopGrant, type TurnRecord } from "./loopStore.ts";
import { Verifier, initialPrompt, repairPrompt, type VerificationReport } from "./verification.ts";
import { isTerminal } from "./states.ts";
import { Checkpointer, type CheckpointRecord } from "./checkpoints.ts";
import { buildRunReport, renderRunReportMarkdown, type RunReport } from "./report.ts";
import { DEFAULT_CONTEXT_LIMITS, selectContextFiles, type ContextCandidate } from "./contextSelection.ts";
import { assertPrimary } from "./roles.ts";
import { ConsultantStore, renderAdvisory, type DiagnosisRecord } from "./consultant.ts";
import { ConsultationStore } from "./consultations.ts";
import { HandoffBriefings, OwnershipStore } from "./handoff.ts";
import { recordRecoveryDecision } from "./recovery.ts";
import { ContextRequestStore, type ContextRequest } from "./contextRequests.ts";
import {
  MAX_REQUESTED_BYTES,
  renderRequestOutcomes,
  MAX_OUTPUT_FILE_BYTES,
  outputProtocolInstructions,
  parseWorkerOutput,
  renderWorkspaceContext,
  type ParsedFile
} from "./workerOutput.ts";

/** Bounds on the workspace view embedded in a prompt. Configurable per engine. */
export type { ContextLimits } from "./contextSelection.ts";

export type LoopStopReason =
  | "consultant_recommended"
  | "primary_blocked"
  | "completed"
  | "verification_indeterminate"
  | "turn_limit"
  | "consecutive_failures"
  | "worker_uncertain"
  | "worker_failed"
  | "paused"
  | "stopped"
  | "grant_closed";

export interface LoopOutcome {
  runId: string;
  reason: LoopStopReason;
  turnsRun: number;
  finalState: string;
  lastVerification: VerificationReport | null;
  detail: string;
}

export interface AutonomousLoopOptions {
  ports: RuntimePorts;
  engine: AutopilotEngine;
  policy: CapabilityPolicy;
  /** The already-constructed sticky worker for this run's chosen provider. */
  worker: WorkerAdapter;
  /** Called when a turn is dispatched or settled, so the host can push updates. */
  changed?: (runId: string) => void;
  /** Bounds on the workspace view embedded in each prompt. */
  contextLimits?: typeof DEFAULT_CONTEXT_LIMITS;
}

export class AutonomousLoop {
  readonly loops: LoopStore;
  readonly verifier: Verifier;
  readonly checkpoints: Checkpointer;
  readonly contextRequests: ContextRequestStore;
  readonly consultantDiagnoses: ConsultantStore;
  readonly consultations: ConsultationStore;
  readonly handoffs: HandoffBriefings;

  private readonly ports: RuntimePorts;
  private readonly engine: AutopilotEngine;
  private readonly policy: CapabilityPolicy;
  private readonly worker: WorkerAdapter;
  private readonly changed: (runId: string) => void;
  private readonly contextLimits: typeof DEFAULT_CONTEXT_LIMITS;
  private readonly active = new Set<string>();

  constructor(options: AutonomousLoopOptions) {
    this.ports = options.ports;
    this.engine = options.engine;
    this.policy = options.policy;
    this.worker = options.worker;
    this.changed = options.changed ?? (() => {});
    this.contextLimits = options.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
    this.loops = new LoopStore(options.ports);
    if (!options.engine.effects) throw new Error("The autonomous loop requires platform ports.");
    this.verifier = new Verifier({ ports: options.ports, effects: options.engine.effects, policy: options.policy });
    this.checkpoints = new Checkpointer({ ports: options.ports, effects: options.engine.effects, policy: options.policy });
    this.contextRequests = new ContextRequestStore(options.ports);
    this.consultantDiagnoses = new ConsultantStore(options.ports);
    this.consultations = new ConsultationStore(options.ports);
    this.handoffs = new HandoffBriefings(options.ports);
  }

  /** The durable run report. Reads SQLite only; runs no git. */
  report(runId: string): RunReport {
    return buildRunReport(this.ports, runId);
  }

  /**
   * Writes the report as JSON and Markdown.
   *
   * The paths go through ordinary WRITE_FILE intents, so the capability policy
   * decides where a report may land exactly as it does for any other write.
   */
  async exportReport(input: { runId: string; directory: string }): Promise<{ report: RunReport; written: string[]; refused: string[] }> {
    const report = this.report(input.runId);
    const effects = this.engine.effects!;
    const base = `autopilot-report-${input.runId}`;
    const written: string[] = [];
    const refused: string[] = [];

    const artifacts: Array<{ path: string; contents: string }> = [
      { path: `${input.directory}/${base}.json`, contents: JSON.stringify(report, null, 2) },
      { path: `${input.directory}/${base}.md`, contents: renderRunReportMarkdown(report) }
    ];

    for (const artifact of artifacts) {
      const outcome = await effects.request({
        runId: input.runId,
        stepKey: this.ports.ids.next("report-export"),
        policy: this.policy,
        intent: { kind: "WRITE_FILE", path: artifact.path, contents: artifact.contents, purpose: "export the run report" }
      });
      if (outcome.status === "COMPLETED") written.push(artifact.path);
      else refused.push(artifact.path);
    }

    this.engine.store.appendEvent(input.runId, {
      type: "REPORT_EXPORTED",
      payload: { written: written.length, refused: refused.length, directory: input.directory }
    });
    return { report, written, refused };
  }

  snapshot(runId: string) {
    return {
      grant: this.loops.activeGrant(runId),
      grants: this.loops.grants(runId),
      turns: this.loops.turns(runId),
      verifications: this.loops.verifications(runId),
      checkpoints: this.checkpoints.store.list(runId),
      contextRequests: this.contextRequests.list(runId),
      consultantSessions: this.consultantDiagnoses.sessions(runId),
      diagnoses: this.consultantDiagnoses.diagnoses(runId),
      busy: this.active.has(runId)
    };
  }

  /**
   * The human authorization. Binds the grant to the provider, session and
   * workspace that exist right now, so a later change to any of them invalidates
   * it rather than silently carrying over.
   */
  authorize(input: { runId: string; maxTurns: number; grantedBy: string }): LoopGrant {
    assertPrimary(this.worker.role);
    const run = this.engine.store.requireRun(input.runId);
    const session = this.worker.startSession(input.runId);
    const workspaceRoot = run.spec.capabilities.workspaceRoot;
    if (!workspaceRoot) throw new Error("The run has no validated workspace.");
    if (run.spec.workers.primary !== this.worker.id || !run.spec.workers.sticky || run.spec.workers.fallback) {
      throw new Error("The autonomous loop requires one explicit sticky provider with no fallback.");
    }
    return this.loops.grant({
      runId: input.runId,
      provider: this.worker.id,
      sessionId: session.sessionId,
      workspaceRoot,
      maxTurns: input.maxTurns,
      grantedBy: input.grantedBy
    });
  }

  revoke(runId: string, reason = "revoked by human"): LoopGrant | null {
    const grant = this.loops.activeGrant(runId);
    if (!grant) return null;
    const closed = this.loops.closeGrant({ grantId: grant.id, status: "REVOKED", reason });
    this.changed(runId);
    return closed;
  }

  /** Re-checks that the grant still describes reality. */
  private validateGrant(runId: string, grant: LoopGrant): void {
    assertPrimary(this.worker.role);
    assertPrimary(grant.role);
    const run = this.engine.store.requireRun(runId);
    if (new OwnershipStore(this.ports).primaryProvider(runId, run.spec) !== grant.provider) {
      throw new Error("The run's provider changed after the loop was authorized.");
    }
    if (run.spec.capabilities.workspaceRoot !== grant.workspaceRoot) {
      throw new Error("The run's workspace changed after the loop was authorized.");
    }
    const session = this.worker.sessionAvailability(runId);
    if (session === "missing") throw new Error("The worker session is missing; the loop cannot continue.");
  }

  /**
   * Runs turns until the loop settles.
   *
   * Safe to call again after a restart: it resumes from durable turn state, and
   * never re-sends a prompt whose send already completed.
   */
  async run(runId: string): Promise<LoopOutcome> {
    if (this.active.has(runId)) throw new Error("The loop is already running for this run.");
    this.active.add(runId);
    try {
      return await this.drive(runId);
    } finally {
      this.active.delete(runId);
      this.changed(runId);
    }
  }

  private hold(runId: string, reason: LoopStopReason, detail: string): void {
    const store = this.engine.store;
    const run = store.requireRun(runId);
    if (isTerminal(run.state)) return;

    store.appendEvent(runId, { type: "LOOP_HELD", payload: { reason, detail } });

    if (run.state === "RUNNING") {
      store.appendEvent(runId, { type: "PAUSE_REQUESTED", toState: "PAUSE_REQUESTED", pauseRequested: true });
      store.appendEvent(runId, { type: "RUN_PAUSED", toState: "PAUSED", pauseRequested: false });
    } else if (run.state === "PAUSE_REQUESTED") {
      store.appendEvent(runId, { type: "RUN_PAUSED", toState: "PAUSED", pauseRequested: false });
    }
  }

  private needsReview(runId: string, detail: string): void {
    const store = this.engine.store;
    const run = store.requireRun(runId);
    if (isTerminal(run.state) || run.state === "NEEDS_REVIEW") return;
    if (run.state !== "RECONCILING") {
      store.appendEvent(runId, { type: "RECONCILIATION_STARTED", toState: "RECONCILING" });
    }
    store.appendEvent(runId, { type: "RUN_NEEDS_REVIEW", toState: "NEEDS_REVIEW", reconcileReason: detail });
  }

  private ensureRunning(runId: string): void {
    const store = this.engine.store;
    const run = store.requireRun(runId);
    if (run.state === "RUNNING") return;
    if (!["READY", "PAUSED", "AWAITING_APPROVAL"].includes(run.state)) {
      throw new Error(`The loop cannot start a turn from ${run.state}.`);
    }
    store.appendEvent(runId, { type: "RUN_RESUMED", toState: "RUNNING", pauseRequested: false, reconcileReason: null });
  }

  /** True when the operator asked to pause or stop. */
  private interrupted(runId: string): "stopped" | "paused" | null {
    const run = this.engine.store.requireRun(runId);
    if (run.stopRequested || run.state === "STOP_REQUESTED" || isTerminal(run.state)) return "stopped";
    if (run.pauseRequested || run.state === "PAUSE_REQUESTED") return "paused";
    return null;
  }

  private async drive(runId: string): Promise<LoopOutcome> {
    const latestTurn = this.loops.turns(runId).at(-1);
    if (latestTurn && ["FAILED_VERIFICATION", "REQUESTED_CONTEXT", "ABANDONED"].includes(latestTurn.status)) evaluatePrimaryProgress(this.ports, runId);
    const heldProgress = latestPrimaryProgress(this.ports, runId);
    // A completed consultant diagnosis buys exactly one PRIMARY retry. Approval
    // alone does not, and a failed or uncertain consultation does not: only a
    // COMPLETED diagnosis that has not yet reached PRIMARY appears here. The
    // STALLED evidence itself is never erased.
    const advisory = this.consultantDiagnoses.pendingForPrimary(runId);
    // Only the automatic triggers buy a retry. An operator asked for a second
    // opinion on a run that was already moving, so its diagnosis must not
    // quietly resume a run the runtime is holding: it waits for the next turn a
    // human starts, and is injected there.
    const releasesHold = advisory
      ? this.consultations.list(runId).find(entry => entry.id === advisory.consultationId)?.triggerType !== "OPERATOR"
      : false;
    if (heldProgress && heldProgress.status !== "PROGRESSING" && !(advisory && releasesHold)) {
      this.needsReview(runId, heldProgress.reason);
      return this.settle(runId, heldProgress.consultantRecommended ? "consultant_recommended" : "primary_blocked", heldProgress.reason, null, 0);
    }
    if (heldProgress && heldProgress.status !== "PROGRESSING" && advisory && releasesHold) {
      const run = this.engine.store.requireRun(runId);
      this.engine.store.appendEvent(runId, {
        type: "CONSULTATION_HOLD_RELEASED",
        payload: {
          consultationId: advisory.consultationId,
          consultantProvider: advisory.consultantProvider,
          heldStatus: heldProgress.status,
          heldReason: heldProgress.reason
        }
      });
      // The hold is sticky: evaluatePrimaryProgress refuses to re-evaluate while
      // the latest decision is non-PROGRESSING. Releasing it must therefore
      // record a PROGRESSING decision, or the run could never stall again and so
      // could never earn a second consultation. The stalled evidence itself is
      // preserved in the fingerprints, so a genuinely repeated failure still
      // counts from the same baseline.
      this.engine.store.appendEvent(runId, {
        type: "PRIMARY_PROGRESS_EVALUATED",
        payload: {
          decision: {
            ...heldProgress,
            status: "PROGRESSING",
            consecutiveStalled: 0,
            reason: "consultant_diagnosis_supplied",
            consultantRecommended: false
          },
          consultant_recommended: false
        }
      });
      if (run.state === "NEEDS_REVIEW") {
        this.engine.store.appendEvent(runId, {
          type: "RUN_RESUMED",
          toState: "RUNNING",
          reconcileReason: null,
          payload: { reason: "approved consultation completed" }
        });
      }
      this.changed(runId);
    }
    const spec = this.engine.store.requireRun(runId).spec;
    let grant = this.loops.activeGrant(runId);
    if (!grant) {
      return this.settle(runId, "grant_closed", "No active loop authorization. A human must authorize the loop.", null, 0);
    }
    this.validateGrant(runId, grant);

    let turnsRun = 0;
    const maxConsecutive = Math.max(1, spec.failurePolicy.maxConsecutiveFailures);

    // Files the worker has already rewritten. Rebuilt from the durable journal
    // so the priority survives a restart exactly as it was.
    const changedByWorker = new Set<string>(this.appliedPathsFromJournal(runId));

    // Resume from durable state, not from memory. A repair prompt quotes the
    // last verification, so after a restart or a pause that report must be
    // reloaded — otherwise the next turn would have nothing to repair against.
    const priorVerifications = this.loops.verifications(runId);
    let lastReport: VerificationReport | null = priorVerifications.at(-1)?.report ?? null;

    // Consecutive failures are likewise a durable property of the run, so a
    // pause cannot be used to reset the limit.
    let consecutiveFailures = 0;
    for (const record of [...priorVerifications].reverse()) {
      if (record.outcome !== "FAILED") break;
      consecutiveFailures += 1;
    }

    // Resume: an unfinished turn from a previous process continues rather than
    // being re-planned, so its prompt is never duplicated.
    let pending = this.loops.openTurn(runId);

    for (;;) {
      const interruption = this.interrupted(runId);
      if (interruption) {
        this.hold(runId, interruption, `Loop stopped between turns: ${interruption}.`);
        return this.settle(runId, interruption, `Loop ${interruption} between turns.`, lastReport, turnsRun);
      }

      grant = this.loops.activeGrant(runId);
      if (!grant) {
        return this.settle(runId, "grant_closed", "The loop authorization was revoked.", lastReport, turnsRun);
      }

      let turn = pending;
      pending = null;

      if (!turn) {
        if (grant.turnsUsed >= grant.maxTurns) {
          this.loops.closeGrant({ grantId: grant.id, status: "EXHAUSTED", reason: `Turn limit of ${grant.maxTurns} reached.` });
          this.hold(runId, "turn_limit", `Authorized ${grant.maxTurns} turn(s); the budget is spent.`);
          return this.settle(runId, "turn_limit", `Turn limit of ${grant.maxTurns} reached. Authorize more turns to continue.`, lastReport, turnsRun);
        }
        // A repair turn requires evidence to repair against. Without a prior
        // report (a resumed run whose verification never recorded), restate the
        // goal rather than fabricating a failure summary.
        const priorTurns = this.loops.turns(runId).length;
        const evidence = priorTurns === 0 ? null : lastReport;
        const kind = evidence ? "REPAIR" : "INITIAL";
        // The worker has no tools, so every prompt carries the current code —
        // but only the files that matter, chosen deterministically.
        // Pending requests come from durable rows, so a restart resumes them.
        const pendingRequests = this.contextRequests.pending(runId);
        const context = await this.readWorkspaceContext(runId, grant.workspaceRoot, {
          spec,
          lastReport: evidence,
          changed: [...changedByWorker],
          pendingRequests
        });
        // A completed diagnosis rides along as clearly-labelled ADVISORY text on
        // the SAME sticky PRIMARY session. PRIMARY still owns the decision, the
        // worktree and the Run Spec; the consultant only offered an opinion.
        const pendingAdvisory = this.consultantDiagnoses.pendingForPrimary(runId);
        const withAdvisory = pendingAdvisory
          ? `${context}\n\n${renderAdvisory(pendingAdvisory)}`
          : context;

        // The first turn after a handoff opens with the frozen package, so the
        // incoming owner continues the existing work instead of restarting it.
        const briefing = this.handoffs.briefingFor(runId);
        const withBriefing = briefing ? `${briefing}\n\n${withAdvisory}` : withAdvisory;

        const prompt = evidence ? repairPrompt(evidence, spec, withBriefing) : initialPrompt(spec, withBriefing);
        turn = this.loops.planTurn({ runId, grantId: grant.id, kind, prompt });
        // Requests were settled while this prompt was built, before the turn
        // existed; link them to it now.
        this.contextRequests.attributeUnconsumed(runId, turn.id);
        // Marking it supplied is what makes "exactly once" true: the row's
        // supplied_to_turn_id can only transition from NULL a single time.
        if (pendingAdvisory) this.consultantDiagnoses.markSupplied(pendingAdvisory.consultationId, turn.id, turn.ordinal);
      }

      this.ensureRunning(runId);
      this.changed(runId);

      const send = await this.sendTurn(runId, turn);
      turnsRun += 1;

      if (send.status === "UNCERTAIN") {
        this.loops.updateTurn({ turnId: turn.id, status: "UNCERTAIN", sendId: send.id });
        // The worker already routed this to NEEDS_REVIEW. Never guess, never resend.
        this.needsReview(runId, `Turn ${turn.ordinal} has no confirmed outcome.`);
        return this.settle(runId, "worker_uncertain", `Turn ${turn.ordinal} outcome is unknown; a human must resolve it.`, lastReport, turnsRun);
      }

      if (send.status !== "COMPLETED" || !send.result?.ok) {
        this.loops.updateTurn({ turnId: turn.id, status: "ABANDONED", sendId: send.id });
        const failure = send.result?.failure ?? "unknown";
        evaluatePrimaryProgress(this.ports, runId);
        this.hold(runId, "worker_failed", `Turn ${turn.ordinal} failed: ${failure}.`);
        return this.settle(runId, "worker_failed", `The worker turn failed (${failure}). The loop does not retry a terminal worker failure automatically.`, lastReport, turnsRun);
      }

      this.loops.updateTurn({ turnId: turn.id, status: "SENT", sendId: send.id });
      this.changed(runId);

      // The worker returned text, not actions. DexNest writes the files it asked
      // for, through policy, so the worktree stays an enforced boundary.
      const outputText = send.result?.text ?? "";
      const application = await this.applyWorkerOutput(runId, turn, outputText, grant.workspaceRoot);
      for (const path of application.applied) changedByWorker.add(path);
      if (application.refused.length > 0) {
        this.loops.updateTurn({ turnId: turn.id, status: "ABANDONED" });
        evaluatePrimaryProgress(this.ports, runId, "policy");
        this.needsReview(runId, "Required worker output was refused by policy.");
        return this.settle(runId, "primary_blocked", "Required worker output was refused by policy.", lastReport, turnsRun);
      }

      // Asking for context is not doing the work. With nothing written there is
      // nothing new to verify, so the turn ends here and the next one supplies
      // the files — still costing a turn of the grant, so this cannot loop
      // invisibly.
      if (application.requested.length > 0 && application.applied.length === 0) {
        this.loops.updateTurn({ turnId: turn.id, status: "REQUESTED_CONTEXT", sendId: send.id });
        this.engine.store.appendEvent(runId, {
          type: "LOOP_TURN_SETTLED",
          stepKey: turn.id,
          payload: { turnId: turn.id, outcome: "context_requested", requested: application.requested.length }
        });
        await this.captureSnapshot(runId, turn.id, "context-requested", grant.workspaceRoot);
        if (this.evaluateProgressHold(runId)) return this.settle(runId, "consultant_recommended", "PRIMARY stalled on repeated context requests.", lastReport, turnsRun);
        this.changed(runId);
        continue;
      }
      if (application.applied.length === 0) {
        this.ports.logger.log("warn", "Autopilot worker turn produced no applicable file changes", {
          runId,
          turnId: turn.id,
          issues: application.issues.length
        });
      }

      // Verification may itself be interrupted by a stop request.
      const beforeVerify = this.interrupted(runId);
      if (beforeVerify === "stopped") {
        this.hold(runId, "stopped", "Stopped before verification.");
        return this.settle(runId, "stopped", "Stopped before verification.", lastReport, turnsRun);
      }

      this.engine.store.appendEvent(runId, { type: "VERIFICATION_STARTED", payload: { turnId: turn.id, ordinal: turn.ordinal } });
      const report = await this.verifier.verify({
        runId,
        spec,
        workspaceRoot: grant.workspaceRoot,
        // Repeat detection needs the durable history, not just this process.
        history: this.loops.verifications(runId).map((record) => record.report)
      });
      const record = this.loops.recordVerification({ runId, turnId: turn.id, report });
      lastReport = report;
      this.changed(runId);

      if (report.outcome === "PASSED") {
        evaluatePrimaryProgress(this.ports, runId);
        this.loops.updateTurn({ turnId: turn.id, status: "VERIFIED", verificationId: record.id });
        // Only a fully green verification earns a checkpoint.
        await this.checkpointTurn(runId, turn, record.id, report.summary, grant.workspaceRoot);
        await this.captureSnapshot(runId, turn.id, "verification-passed", grant.workspaceRoot);
        this.loops.closeGrant({ grantId: grant.id, status: "COMPLETED", reason: "Acceptance criteria satisfied." });
        const run = this.engine.store.requireRun(runId);
        if (run.state === "RUNNING") {
          this.engine.store.appendEvent(runId, { type: "RUN_COMPLETED", toState: "COMPLETED" });
        }
        return this.settle(runId, "completed", report.summary, report, turnsRun);
      }

      if (report.outcome === "INDETERMINATE") {
        this.loops.updateTurn({ turnId: turn.id, status: "VERIFIED", verificationId: record.id });
        // No checkpoint: an inconclusive result is not a known-good state.
        await this.captureSnapshot(runId, turn.id, "verification-indeterminate", grant.workspaceRoot);
        evaluatePrimaryProgress(this.ports, runId);
        // Requirement: never invent success. Hold for a human instead.
        this.needsReview(runId, report.indeterminateReason ?? "Verification was inconclusive.");
        return this.settle(runId, "verification_indeterminate", report.summary, report, turnsRun);
      }

      this.loops.updateTurn({ turnId: turn.id, status: "FAILED_VERIFICATION", verificationId: record.id });
      // No checkpoint: a failing tree is never recorded as known-good.
      await this.captureSnapshot(runId, turn.id, "verification-failed", grant.workspaceRoot);
      this.engine.store.appendEvent(runId, {
        type: "VERIFICATION_TIER_FAILED",
        payload: { turnId: turn.id, tier: report.failingTier?.tier ?? null, exitCode: report.failingTier?.exitCode ?? null }
      });

      if (this.evaluateProgressHold(runId)) return this.settle(runId, "consultant_recommended", "PRIMARY stalled without new progress.", report, turnsRun);
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutive) {
        this.hold(runId, "consecutive_failures", `${consecutiveFailures} consecutive verification failures.`);
        return this.settle(
          runId,
          "consecutive_failures",
          `Verification failed ${consecutiveFailures} time(s) in a row (limit ${maxConsecutive}).`,
          report,
          turnsRun
        );
      }
      // Otherwise: loop, and the next prompt carries the failure evidence.
    }
  }

  /**
   * Sends one turn's prompt on the sticky session.
   *
   * Two-phase, matching the existing controlled path exactly: the first call
   * journals the intent and leaves the operation awaiting approval; the grant
   * then resolves that approval and the second call dispatches it. Nothing here
   * bypasses policy, and each turn produces its own approval record.
   */
  private evaluateProgressHold(runId: string): boolean {
    const decision = evaluatePrimaryProgress(this.ports, runId);
    if (!decision || decision.status === "PROGRESSING") return false;
    this.needsReview(runId, decision.reason + (decision.consultantRecommended ? ": consultant_recommended" : ""));
    return true;
  }

  private async sendTurn(runId: string, turn: TurnRecord): Promise<WorkerSend> {
    const sendId = turn.sendId ?? this.ports.ids.next("worker-send");
    if (!turn.sendId) this.loops.updateTurn({ turnId: turn.id, status: "PLANNED", sendId });

    const first = await this.worker.sendPrompt({ runId, sendId, prompt: turn.prompt });
    if (first.status !== "AWAITING_APPROVAL") {
      // Already completed (restart rejoining a finished send) or already settled.
      return first;
    }

    const effects = this.engine.effects!;
    const operationId = first.operationId;
    if (!operationId) throw new Error("A pending worker send has no operation to authorize.");
    const approval = effects.operations.getApprovalForOperation(operationId);
    if (!approval || approval.status !== "PENDING") {
      throw new Error("The worker send has no pending approval to authorize.");
    }

    // Spend the budget first, attributed to this turn. Idempotent, so a crash
    // here cannot double-spend; over-counting by one is the safe direction.
    this.loops.consumeGrantForTurn(turn.id);

    this.engine.resolveApproval({
      approvalId: approval.id,
      decision: "APPROVED",
      // The audit trail names the grant, not a person, so a reader can see which
      // turns were covered by which authorization.
      source: `loop_grant:${turn.grantId}`
    });

    return this.worker.sendPrompt({ runId, sendId, prompt: turn.prompt });
  }

  /**
   * Reads the workspace so the worker can see the code.
   *
   * The worker has no tools, so this is its only view. Files come from
   * `git ls-files` (tracked files only, so build output and node_modules are
   * excluded for free) and every read is a READ_FILE intent through policy.
   */
  /** Workspace-relative paths recorded as applied on earlier turns. */
  private appliedPathsFromJournal(runId: string): string[] {
    const paths: string[] = [];
    for (const event of this.engine.store.listEvents(runId)) {
      if (event.type !== "WORKER_OUTPUT_APPLIED") continue;
      const applied = event.payload.paths;
      if (Array.isArray(applied)) {
        for (const path of applied) if (typeof path === "string") paths.push(path);
      }
    }
    return [...new Set(paths)];
  }

  private async readWorkspaceContext(
    runId: string,
    workspaceRoot: string,
    selection: {
      spec: RunSpec;
      lastReport: VerificationReport | null;
      changed: string[];
      pendingRequests?: ContextRequest[];
    }
  ): Promise<string> {
    const effects = this.engine.effects!;
    const listed = await effects.request({
      runId,
      stepKey: this.ports.ids.next("context-ls"),
      policy: this.policy,
      intent: { kind: "GIT_OPERATION", operation: "ls-files", args: [], cwd: workspaceRoot, purpose: "context: list tracked files" }
    });
    if (!("result" in listed) || !listed.result.ok) {
      return renderWorkspaceContext([], "(The project file list could not be read.)");
    }

    const tracked = (listed.result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // Deterministic, evidence-driven choice — not the whole repository.
    const specText = [
      selection.spec.goal,
      ...selection.spec.constraints,
      ...selection.spec.nonGoals,
      ...selection.spec.acceptanceCriteria.map((criterion) => `${criterion.text} ${criterion.check ?? ""}`)
    ].join("\n");

    const failureOutput = selection.lastReport
      ? selection.lastReport.tiers
          .filter((tier) => tier.gating && !tier.ok)
          .map((tier) => `${tier.command}\n${tier.detail}`)
          .join("\n")
      : "";

    // A requested path is only honoured if it is actually a tracked workspace
    // file; anything else is denied here with a reason the worker will read.
    const pending = selection.pendingRequests ?? [];
    const trackedSet = new Set(tracked);
    const honoured: string[] = [];
    const outcomes: Array<{ path: string; allowed: boolean; reason: string | null }> = [];
    let requestBudget = MAX_REQUESTED_BYTES;

    for (const request of pending) {
      if (!trackedSet.has(request.path)) {
        this.contextRequests.resolve({
          requestId: request.id,
          status: "DENIED",
          consumedTurnId: null,
          denialReason: "not a tracked file in this workspace"
        });
        outcomes.push({ path: request.path, allowed: false, reason: "not a tracked file in this workspace" });
        continue;
      }
      honoured.push(request.path);
    }

    const chosen = selectContextFiles({
      tracked,
      specText,
      failureOutput,
      changed: selection.changed,
      requested: honoured,
      limits: this.contextLimits
    });

    const files: ParsedFile[] = [];
    const included: ContextCandidate[] = [];
    let budget = this.contextLimits.maxBytes;
    let skipped = 0;

    for (const candidate of chosen.files) {
      if (budget <= 0) {
        skipped += 1;
        continue;
      }
      const read = await effects.request({
        runId,
        stepKey: this.ports.ids.next("context-read"),
        policy: this.policy,
        intent: { kind: "READ_FILE", path: `${workspaceRoot}/${candidate.path}`, purpose: "context: read a project file" }
      });
      if (!("result" in read) || !read.result.ok) {
        skipped += 1;
        continue;
      }
      const contents = read.result.stdout ?? "";
      if (contents.length > MAX_OUTPUT_FILE_BYTES || contents.length > budget) {
        skipped += 1;
        continue;
      }
      budget -= contents.length;
      files.push({ path: candidate.path, contents });
      included.push(candidate);
    }

    // Settle every pending request against what actually made it into the prompt.
    const includedPaths = new Set(files.map((file) => file.path));
    for (const request of pending) {
      if (!honoured.includes(request.path)) continue;
      const supplied = files.find((file) => file.path === request.path);
      if (supplied && requestBudget - supplied.contents.length >= 0) {
        requestBudget -= supplied.contents.length;
        this.contextRequests.resolve({
          requestId: request.id,
          status: "FULFILLED",
          consumedTurnId: null,
          bytesSupplied: new TextEncoder().encode(supplied.contents).byteLength
        });
        outcomes.push({ path: request.path, allowed: true, reason: null });
      } else {
        const reason = includedPaths.has(request.path)
          ? `exceeds the ${MAX_REQUESTED_BYTES}-byte per-turn request budget`
          : "could not be read within this turn's context limits";
        this.contextRequests.resolve({
          requestId: request.id,
          status: "DENIED",
          consumedTurnId: null,
          denialReason: reason
        });
        outcomes.push({ path: request.path, allowed: false, reason });
      }
    }

    this.engine.store.appendEvent(runId, {
      type: "WORKSPACE_CONTEXT_READ",
      payload: {
        files: files.length,
        skipped,
        tracked: tracked.length,
        bytes: this.contextLimits.maxBytes - budget,
        // Why each file was chosen, so a report reader can audit the selection.
        selected: included.map((candidate) => ({ path: candidate.path, reason: candidate.reason }))
      }
    });

    const omitted = tracked.length - files.length;
    const note = omitted > 0
      ? `(${omitted} other project file(s) were not included. Ask for a file by name if you need it.)`
      : null;
    return [renderRequestOutcomes(outcomes), renderWorkspaceContext(files, note), "", outputProtocolInstructions()]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Writes the files the worker returned.
   *
   * Each file is an ordinary WRITE_FILE intent, so the capability policy decides
   * whether it may land — the worker never touches the disk itself. A refusal is
   * evidence, not an error: it goes back to the worker in the next repair prompt.
   */
  private async applyWorkerOutput(
    runId: string,
    turn: TurnRecord,
    text: string,
    workspaceRoot: string
  ): Promise<{ applied: string[]; refused: string[]; issues: string[]; requested: string[] }> {
    const parsed = parseWorkerOutput(text);
    const applied: string[] = [];
    const contentFingerprints: Record<string, string> = {};
    const refused: string[] = [];
    const issues = [...parsed.issues];

    for (const file of parsed.files) {
      const outcome = await this.engine.effects!.request({
        runId,
        stepKey: this.ports.ids.next("apply-output"),
        policy: this.policy,
        intent: {
          kind: "WRITE_FILE",
          path: `${workspaceRoot}/${file.path}`,
          contents: file.contents,
          purpose: "apply the worker's returned file"
        }
      });
      if (outcome.status === "COMPLETED") {
        applied.push(file.path);
        contentFingerprints[file.path] = evidenceFingerprint(file.contents);
      } else {
        refused.push(file.path);
        issues.push(
          `"${file.path}" was refused by policy: ${outcome.status === "DENIED" ? outcome.decision.reason : outcome.status}.`
        );
      }
    }

    this.engine.store.appendEvent(runId, {
      type: applied.length > 0 ? "WORKER_OUTPUT_APPLIED" : "WORKER_OUTPUT_REJECTED",
      stepKey: turn.id,
      payload: {
        turnId: turn.id,
        applied: applied.length,
        refused: refused.length,
        issues: issues.length,
        // Durable, so context priority survives a restart.
        contentFingerprints,
        paths: applied
      }
    });

    // Requests are persisted immediately, so a crash before the next turn
    // cannot lose them; the next turn resumes from the PENDING rows.
    if (parsed.requests.length > 0) {
      this.contextRequests.record({ runId, turnId: turn.id, paths: parsed.requests });
    }

    return { applied, refused, issues, requested: parsed.requests };
  }

  /**
   * Creates the turn's checkpoint. Never throws into the loop: a checkpoint is
   * evidence, and failing to record one must not discard verified work.
   */
  private async checkpointTurn(
    runId: string,
    turn: TurnRecord,
    verificationId: string | null,
    summary: string,
    workspaceRoot: string
  ): Promise<CheckpointRecord | null> {
    try {
      return await this.checkpoints.checkpoint({
        runId,
        turnId: turn.id,
        ordinal: turn.ordinal,
        verificationId,
        summary,
        workspaceRoot
      });
    } catch (error) {
      this.ports.logger.log("warn", "Autopilot checkpoint failed", {
        runId,
        turnId: turn.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async captureSnapshot(runId: string, turnId: string | null, reason: string, workspaceRoot: string): Promise<void> {
    try {
      await this.checkpoints.snapshot({ runId, turnId, reason, workspaceRoot });
    } catch (error) {
      this.ports.logger.log("warn", "Autopilot workspace snapshot failed", {
        runId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private settle(
    runId: string,
    reason: LoopStopReason,
    detail: string,
    lastVerification: VerificationReport | null,
    turnsRun: number
  ): LoopOutcome {
    // Record how routing changed, so the timeline shows the recommendation the
    // operator will see. Derived state only; this grants nothing.
    try { recordRecoveryDecision(this.ports, runId); } catch { /* never block a settle on bookkeeping */ }
    return {
      runId,
      reason,
      turnsRun,
      finalState: this.engine.store.requireRun(runId).state,
      lastVerification,
      detail
    };
  }
}
