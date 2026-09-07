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
import type { WorkerAdapter, WorkerFailure } from "./worker.ts";
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
import { IterationStore } from "./iterations.ts";
import { DirectionStore, DirectionAuthorityStore, directedPrompt, directionProtocolInstructions, parseDirection, type DirectionDecision, type ParsedDirection } from "./direction.ts";
import { ChatDirector, directorPrompt } from "./chatDirector.ts";
import { PlanStore, renderPlanForWorker } from "./plan.ts";
import { renderRunDigest } from "./digest.ts";
import { UnattendedStore, parseAssumptions, unattendedInstructions } from "./unattended.ts";
import { OperatorNoteStore, renderOperatorNote, type OperatorNoteRecord } from "./operatorNote.ts";
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
  | "iteration_limit"
  | "time_limit"
  | "cost_limit"
  | "no_progress"
  | "consecutive_failures"
  | "worker_uncertain"
  | "worker_failed"
  | "provider_limit"
  | "plan_complete_proposed"
  | "direction_needs_human"
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
  /** The chat that writes assignments, when direction is not self-directed. */
  director?: ChatDirector | null;
}

export class AutonomousLoop {
  readonly loops: LoopStore;
  readonly verifier: Verifier;
  readonly checkpoints: Checkpointer;
  readonly contextRequests: ContextRequestStore;
  readonly consultantDiagnoses: ConsultantStore;
  readonly consultations: ConsultationStore;
  readonly handoffs: HandoffBriefings;
  readonly iterations: IterationStore;
  readonly directions: DirectionStore;
  readonly directionAuthority: DirectionAuthorityStore;
  readonly plans: PlanStore;
  readonly unattended: UnattendedStore;
  readonly notes: OperatorNoteStore;

  private readonly ports: RuntimePorts;
  private readonly engine: AutopilotEngine;
  private readonly policy: CapabilityPolicy;
  private readonly worker: WorkerAdapter;
  private readonly changed: (runId: string) => void;
  private readonly contextLimits: typeof DEFAULT_CONTEXT_LIMITS;
  private readonly active = new Set<string>();
  private readonly director: ChatDirector | null;

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
    this.iterations = new IterationStore(options.ports);
    this.directions = new DirectionStore(options.ports);
    this.directionAuthority = new DirectionAuthorityStore(options.ports);
    this.director = options.director ?? null;
    this.plans = new PlanStore(options.ports);
    this.unattended = new UnattendedStore(options.ports);
    this.notes = new OperatorNoteStore(options.ports);
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
      iterations: this.iterations.list(runId),
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
  authorize(input: {
    runId: string; maxTurns: number; maxIterations?: number;
    stopAt?: string; maxCostUsd?: number; maxIdleTurns?: number;
    /** Wait and retry by itself when the provider runs out. Off by default. */
    autoResumeOnLimit?: boolean;
    /** Give each piece of work a fresh conversation. On by default. */
    rotateSession?: boolean;
    grantedBy: string;
  }): LoopGrant {
    assertPrimary(this.worker.role);
    const run = this.engine.store.requireRun(input.runId);
    const session = this.worker.startSession(input.runId);
    const workspaceRoot = run.spec.capabilities.workspaceRoot;
    if (!workspaceRoot) throw new Error("The run has no validated workspace.");
    if (run.spec.workers.primary !== this.worker.id || !run.spec.workers.sticky || run.spec.workers.fallback) {
      throw new Error("The autonomous loop requires one explicit sticky provider with no fallback.");
    }
    return this.loops.grant({
      ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
      ...(input.stopAt !== undefined ? { stopAt: input.stopAt } : {}),
      ...(input.maxCostUsd !== undefined ? { maxCostUsd: input.maxCostUsd } : {}),
      ...(input.maxIdleTurns !== undefined ? { maxIdleTurns: input.maxIdleTurns } : {}),
      ...(input.autoResumeOnLimit !== undefined ? { autoResumeOnLimit: input.autoResumeOnLimit } : {}),
      ...(input.rotateSession !== undefined ? { rotateSession: input.rotateSession } : {}),
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
  /**
   * Drives the loop until it stops.
   *
   * retryProviderLimit is the deliberate answer to a run paused because the
   * provider had no capacity or the login had gone stale. Those holds are not
   * released by simply running again — an obstacle that is still there should
   * not cost a turn to rediscover — but they ARE the one kind of block that
   * time or a human signing in can fix, so something has to be able to say
   * "try again now". This is that signal, and only a caller who decided to
   * retry passes it.
   */
  async run(runId: string, options: { retryProviderLimit?: boolean } = {}): Promise<LoopOutcome> {
    if (this.active.has(runId)) throw new Error("The loop is already running for this run.");
    this.active.add(runId);
    try {
      return await this.drive(runId, options.retryProviderLimit === true);
    } finally {
      this.active.delete(runId);
      this.changed(runId);
    }
  }

  /**
   * The proposed completion waiting for an answer, if there is one.
   *
   * "The last hold said plan_complete_proposed" is not enough on its own: a
   * later turn could have run and stopped for some other reason, and the stale
   * hold would still be the last one of its kind. So the proposal must come
   * from the LATEST turn and still be unanswered. That is what makes accepting
   * safe — it can only ever complete a run that is sitting exactly where the
   * proposal left it.
   */
  planCompleteProposal(runId: string): DirectionDecision | null {
    const run = this.engine.store.requireRun(runId);
    if (isTerminal(run.state) || run.state === "RUNNING") return null;
    const pending = this.directions.pending(runId);
    if (!pending || pending.verb !== "PLAN_COMPLETE") return null;
    return pending.turnId === (this.loops.turns(runId).at(-1)?.id ?? null) ? pending : null;
  }

  private requireProposal(runId: string): DirectionDecision {
    const proposal = this.planCompleteProposal(runId);
    if (!proposal) throw new Error("This run is not waiting on a proposed completion.");
    return proposal;
  }

  /**
   * The human agrees: the plan is done and the run is finished.
   *
   * This is the counterpart to PLAN_COMPLETE being a proposal rather than a
   * completion. An agent that could declare itself finished would be marking
   * its own homework at 3am; a person who has read what it did can mark it,
   * and this is where they do so.
   *
   * PAUSED cannot reach COMPLETED directly — the state machine routes every
   * out-of-band resolution through RECONCILING, which is what this is: a human
   * settling something the loop could not settle itself.
   */
  acceptPlanComplete(runId: string, options: { by?: string } = {}): void {
    const proposal = this.requireProposal(runId);
    const store = this.engine.store;
    const by = String(options.by ?? "").trim() || "operator";

    const grant = this.loops.activeGrant(runId);
    if (grant) {
      this.loops.closeGrant({ grantId: grant.id, status: "COMPLETED", reason: "A human accepted the proposed completion." });
    }
    store.appendEvent(runId, {
      type: "PLAN_COMPLETE_ACCEPTED",
      payload: { directionId: proposal.id, by, reason: proposal.reason }
    });
    if (store.requireRun(runId).state !== "RECONCILING") {
      store.appendEvent(runId, { type: "RECONCILIATION_STARTED", toState: "RECONCILING" });
    }
    store.appendEvent(runId, { type: "RUN_COMPLETED", toState: "COMPLETED" });
    this.changed(runId);
  }

  /**
   * The human disagrees, and says why.
   *
   * The reason is mandatory and is not merely recorded: it becomes the note
   * that opens the next prompt. Rejecting without saying what is missing would
   * hand the agent back the same evidence that made it say it was finished,
   * and it would reach the same conclusion — so the reason IS the answer.
   *
   * The run stays paused. Rejecting decides what happens next; starting it is
   * still a separate, deliberate act.
   */
  rejectPlanComplete(runId: string, input: { reason: string; by?: string }): OperatorNoteRecord {
    const proposal = this.requireProposal(runId);
    const reason = String(input.reason ?? "").trim();
    if (!reason) {
      throw new Error("Say what is still missing: the reason becomes the instruction for the next turn.");
    }
    const by = String(input.by ?? "").trim() || "operator";
    const note = this.notes.add({ runId, text: reason, author: by });
    this.engine.store.appendEvent(runId, {
      type: "PLAN_COMPLETE_REJECTED",
      payload: { directionId: proposal.id, noteId: note.id, by }
    });
    this.changed(runId);
    return note;
  }

  /**
   * Starts the next piece of work in a new conversation.
   *
   * Only ever called between settled pieces of work. The grant follows the new
   * session id: left pointing at the retired one, the journal would record an
   * authorization for a conversation that no longer exists.
   *
   * Never fatal. A run that cannot rotate is a run that costs more than it
   * should, which is not a reason to stop it doing the work.
   */
  private rotateSessionForNextPhase(runId: string, grant: LoopGrant): void {
    if (!grant.rotateSession) return;
    try {
      const session = this.worker.rotateSession(runId);
      this.loops.rebindSession(runId, session.sessionId);
      this.engine.store.appendEvent(runId, {
        type: "WORKER_SESSION_ROTATED",
        payload: { provider: session.provider, sessionId: session.sessionId, afterIteration: this.iterations.list(runId).length }
      });
    } catch (error) {
      this.ports.logger.log("warn", "Autopilot could not rotate the worker session", {
        runId, error: error instanceof Error ? error.message : String(error)
      });
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

  private async drive(runId: string, retryProviderLimit = false): Promise<LoopOutcome> {
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
    // Running out of capacity, or a login going stale, blocks PRIMARY exactly
    // like a stall does — and it should, because a consultant handoff is a real
    // answer to it. But it is the one obstacle that time or a human signing in
    // can clear on its own, so unlike a stall it must be releasable WITHOUT a
    // consultant diagnosis: there would be nothing to diagnose.
    //
    // Releasing it is still a decision, never a side effect of running again.
    // An obstacle that is still there should not cost a turn to rediscover, so
    // a bare re-run keeps holding exactly as it did before; only a caller that
    // deliberately retries clears it.
    const limited = retryProviderLimit &&
      heldProgress?.status !== "PROGRESSING" &&
      ["terminal_obstacle:quota", "terminal_obstacle:auth"].includes(heldProgress?.reason ?? "");
    if (limited && heldProgress) {
      // The hold is sticky: evaluatePrimaryProgress refuses to re-evaluate
      // while the latest decision is non-PROGRESSING, so releasing it must
      // record a PROGRESSING decision or the run could never be blocked again.
      // The evidence itself is preserved in the fingerprints.
      this.engine.store.appendEvent(runId, {
        type: "PRIMARY_PROGRESS_EVALUATED",
        payload: {
          decision: {
            ...heldProgress, status: "PROGRESSING", consecutiveStalled: 0,
            reason: "provider_limit_retry", consultantRecommended: false
          },
          consultant_recommended: false
        }
      });
      // A previous bare re-run will have pushed the run to NEEDS_REVIEW. The
      // retry is the review: the operator, or the wait, has decided the limit
      // may have lifted.
      if (this.engine.store.requireRun(runId).state === "NEEDS_REVIEW") {
        this.engine.store.appendEvent(runId, {
          type: "RUN_RESUMED", toState: "RUNNING", reconcileReason: null,
          payload: { reason: "provider limit retried" }
        });
      }
    }

    if (!limited && heldProgress && heldProgress.status !== "PROGRESSING" && !(advisory && releasesHold)) {
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
        // Bounds an operator could answer honestly at midnight, unlike a count
        // of iterations on work nobody has done yet. All three are checked at
        // the same boundary as the budgets: before a piece of work starts, so a
        // turn already running always finishes.
        const stop = this.exceededStopCondition(runId, grant);
        if (stop) {
          this.loops.closeGrant({ grantId: grant.id, status: "EXHAUSTED", reason: stop.detail });
          this.hold(runId, stop.reason, stop.detail);
          return this.settle(runId, stop.reason, stop.detail, lastReport, turnsRun);
        }

        // Checked BEFORE the turn is planned. Planning first and refusing after
        // leaves a journalled turn that was never sent, which the next run
        // tries to resume against a grant that is no longer active.
        if (
          grant.maxIterations !== null &&
          !this.iterations.active(runId) &&
          grant.iterationsUsed >= grant.maxIterations
        ) {
          this.loops.closeGrant({ grantId: grant.id, status: "EXHAUSTED", reason: `Iteration limit of ${grant.maxIterations} reached.` });
          this.hold(runId, "iteration_limit", `Authorized ${grant.maxIterations} iteration(s); the budget is spent.`);
          return this.settle(runId, "iteration_limit", `Iteration limit of ${grant.maxIterations} reached. Authorize more to continue.`, lastReport, turnsRun);
        }
        // A repair turn requires evidence to repair against. Without a prior
        // report (a resumed run whose verification never recorded), restate the
        // goal rather than fabricating a failure summary.
        const priorTurns = this.loops.turns(runId).length;
        // Only a FAILING report is repair evidence. Before self-direction a
        // passing verification ended the run, so "there is a previous report"
        // and "the previous turn failed" were the same thing. They are not any
        // more: a green turn now continues, and treating its report as evidence
        // sent the agent a repair prompt for work that had just succeeded.
        const evidence = priorTurns === 0 || lastReport?.outcome === "PASSED" ? null : lastReport;
        const kind = evidence ? "REPAIR" : "INITIAL";
        // A mediated worker has no tools, so every prompt carries the current
        // code — but only the files that matter, chosen deterministically.
        // Pending requests come from durable rows, so a restart resumes them.
        //
        // An agentic worker reads the workspace itself. Pasting files into its
        // prompt would be worse than useless: it would spend context on a stale
        // copy of code it can open, and invite it to answer with whole files
        // instead of editing them.
        const agentic = spec.workerProfile === "agentic";
        const pendingRequests = agentic ? [] : this.contextRequests.pending(runId);
        const context = agentic
          ? ""
          : await this.readWorkspaceContext(runId, grant.workspaceRoot, {
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

        // A failing verification is DexNest's finding and stays deterministic:
        // the repair prompt carries the real evidence. Only after a green turn
        // does the agent's own stated next step become the prompt.
        const direction = evidence ? null : this.directions.pending(runId);
        const guidance = direction?.verb === "CONTINUE" ? direction : null;
        const instructions = directionProtocolInstructions(spec.plan.map(item => item.id));
        const body = evidence
          ? repairPrompt(evidence, spec, withBriefing)
          : guidance
            ? directedPrompt(guidance, spec, withBriefing)
            : initialPrompt(spec, withBriefing);
        // Claim the plan item BEFORE the prompt is built, or the plan is
        // rendered with nothing marked as the current work and the worker is
        // told everything is still pending.
        //
        // The agent's own stated choice wins when it named one; otherwise the
        // plan's order does, because the human wrote that order and it is the
        // default rather than a suggestion an agent may quietly skip.
        if (!this.iterations.active(runId)) {
          const claimed = this.directions.pending(runId)?.planItemId ?? null;
          const item = this.plans.active(runId, spec)
            ?? (claimed ? this.plans.view(runId, spec).items.find(entry => entry.id === claimed && entry.status === "PENDING") : null)
            ?? this.plans.next(runId, spec);
          if (item && item.status === "PENDING") {
            try { this.plans.start(runId, spec, item.id); }
            catch { /* another item is already in flight; the plan is unchanged */ }
          }
        }

        const planText = renderPlanForWorker(this.plans.view(runId, spec));
        // What has already been done, restated every turn rather than left to
        // the session to remember. Twenty iterations in, the conversation has
        // been compacted and the boring middle is exactly what compaction
        // drops — which is exactly what stops finished work being redone.
        const digest = renderRunDigest({
          iterations: this.iterations.list(runId),
          assumptions: this.unattended.assumptions(runId)
        });
        // Whatever the person said before letting this carry on, placed
        // directly behind the goal: it outranks the agent's own note about
        // what to do next, and nothing else in the prompt.
        const note = this.notes.pending(runId);
        const prompt = [body, note ? renderOperatorNote(note) : "", digest, planText, unattendedInstructions(), instructions]
          .filter(part => part)
          .join("\n\n");
        turn = this.loops.planTurn({ runId, grantId: grant.id, kind, prompt });
        // Bound to the turn that carried it, so one sentence written at
        // breakfast does not silently become a standing instruction.
        if (note) this.notes.consume(note.id, turn.id);
        // Bound the assignment to the turn it produced, so it is acted on once.
        if (guidance) this.directions.consume(guidance.id, turn.id);
        // Requests were settled while this prompt was built, before the turn
        // existed; link them to it now.
        this.contextRequests.attributeUnconsumed(runId, turn.id);
        // Marking it supplied is what makes "exactly once" true: the row's
        // supplied_to_turn_id can only transition from NULL a single time.
        if (pendingAdvisory) this.consultantDiagnoses.markSupplied(pendingAdvisory.consultationId, turn.id, turn.ordinal);
      }

      // An ITERATION is one piece of work, not one turn. Repairs and context
      // round-trips belong to the assignment that caused them, so a new
      // iteration opens only when none is in flight — which is exactly after
      // the previous one reached an outcome.
      if (!this.iterations.active(runId)) {
        this.iterations.open({ runId, turnId: turn.id, planItemId: this.plans.active(runId, spec)?.id ?? null });
      }

      // Revocation is a button a human may press at any moment, including
      // after this turn was planned. Checked immediately before the send, so
      // withdrawing authorization settles the run rather than throwing out of
      // run() when the turn tries to spend a grant that is no longer there.
      if (this.loops.activeGrant(runId)?.id !== grant.id) {
        this.iterations.settleActive(runId, { status: "ABANDONED", summary: "The loop authorization was withdrawn." });
        return this.settle(runId, "grant_closed", "The loop authorization was revoked.", lastReport, turnsRun);
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

        // Running out of subscription capacity, or a login going stale, is not
        // the same kind of event as a broken turn. Nothing is wrong with the
        // work, the run has simply lost the ability to continue for now — so it
        // is named separately, and the grant stays open so resuming is a resume
        // rather than a fresh authorization.
        //
        // Safe to treat this way only because both failures are classified
        // CERTAIN by the provider adapters: the send is known not to have been
        // delivered, so nothing is half-done.
        if (failure === "quota" || failure === "auth") {
          const detail = failure === "quota"
            ? `${this.worker.id} has no capacity left. The run is paused with its session and authorization intact.`
            : `${this.worker.id} is no longer logged in. Sign in again and resume; the run keeps its session and authorization.`;
          this.iterations.settleActive(runId, { status: "ABANDONED", summary: detail });
          this.hold(runId, "provider_limit", detail);
          // Waiting is a decision, not a default.
          //
          // The limit does lift on its own, so a genuinely unattended night is
          // better off retrying than sitting until morning. But an operator
          // watching their own quota knows better than a backoff table when it
          // is worth trying again, and until this was a choice they had no way
          // to say so: retryProviderLimit was passed only by the timer.
          //
          // Either way the wait buys time, never authorization.
          if (grant.autoResumeOnLimit) this.unattended.scheduleRetry({ runId, reason: detail });
          return this.settle(runId, "provider_limit", detail, lastReport, turnsRun);
        }

        this.iterations.settleActive(runId, { status: "FAILED", summary: `Worker turn failed: ${failure}.` });
        this.hold(runId, "worker_failed", `Turn ${turn.ordinal} failed: ${failure}.`);
        return this.settle(runId, "worker_failed", `The worker turn failed (${failure}). The loop does not retry a terminal worker failure automatically.`, lastReport, turnsRun);
      }

      this.loops.updateTurn({ turnId: turn.id, status: "SENT", sendId: send.id });
      this.changed(runId);

      // What the provider says the turn cost, so a cost budget has something
      // to count. Absent for providers that report nothing, which simply means
      // a cost budget never trips for them.
      if (typeof send.result?.costUsd === "number") {
        this.loops.recordTurnCost(turn.id, send.result.costUsd);
        this.engine.store.appendEvent(runId, {
          type: "LOOP_TURN_COST_RECORDED", stepKey: turn.id,
          payload: { turnId: turn.id, costUsd: send.result.costUsd }
        });
      }

      // Whatever the verification says, the turn may have decided things it
      // could not ask about. Those are recorded before anything else, because a
      // failed turn's assumptions are exactly the ones worth reading.
      this.unattended.recordAssumptions({
        runId, turnId: turn.id,
        iterationId: this.iterations.active(runId)?.id ?? null,
        texts: parseAssumptions(send.result?.text ?? "")
      });

      // A mediated worker returned text, not actions: DexNest writes the files
      // it asked for, through policy, so the workspace stays an enforced
      // boundary. An agentic worker already made its changes with its own
      // tools, so there is nothing to apply and nothing to request — its work
      // is judged by verification and recorded by the checkpoint, exactly as a
      // human's would be.
      const application = this.engine.store.requireRun(runId).spec.workerProfile === "agentic"
        ? { applied: [] as string[], refused: [] as string[], requested: [] as string[], issues: [] as string[] }
        : await this.applyWorkerOutput(runId, turn, send.result?.text ?? "", grant.workspaceRoot);
      for (const path of application.applied) changedByWorker.add(path);
      if (application.refused.length > 0) {
        this.loops.updateTurn({ turnId: turn.id, status: "ABANDONED" });
        this.iterations.settleActive(runId, { status: "ABANDONED", summary: "Worker output was refused by policy." });
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
        // Asking for files is not an iteration of work, but it consumed one.

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

      // The turn landed, so whatever limit was being waited out is over.
      this.unattended.clear(runId);

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
        const checkpoint = await this.checkpointTurn(runId, turn, record.id, report.summary, grant.workspaceRoot);
        this.iterations.settleActive(runId, {
          status: "VERIFIED", verificationId: record.id,
          checkpointId: checkpoint?.id ?? null, summary: report.summary
        });
        await this.captureSnapshot(runId, turn.id, "verification-passed", grant.workspaceRoot);

        // Who decides what happens next is durable state the operator sets,
        // and it is read fresh every iteration so a switch takes effect at the
        // next boundary rather than at the next run.
        //
        // Only asked after a green turn either way: a failing verification is
        // answered with evidence, not with anybody's opinion.
        const source = this.directionAuthority.current(runId);
        let decision: ParsedDirection | null;
        if (source === "chat") {
          const asked = await this.askDirector(runId, spec, turn.id, send.result?.text ?? "", report);
          // The director runs on its own subscription, so it has its own limit.
          // Losing the decider is the same kind of event as losing the worker:
          // the work stands, the run simply cannot choose what is next.
          if (asked.failure === "quota" || asked.failure === "auth") {
            const detail = `The chat directing this run is unavailable (${asked.failure}). The run is paused with its sessions and authorization intact.`;
            this.hold(runId, "provider_limit", detail);
            if (grant.autoResumeOnLimit) this.unattended.scheduleRetry({ runId, reason: detail });
            return this.settle(runId, "provider_limit", detail, report, turnsRun);
          }
          decision = asked.decision;
        } else {
          decision = parseDirection(send.result?.text ?? "", spec.plan.map(item => item.id));
        }
        if (decision) this.directions.record({ runId, turnId: turn.id, decision, source });

        // The item this piece of work was for is done: verification passed and
        // it is checkpointed. Marked here rather than on the agent's say-so,
        // because "it passed the checks" is DexNest's finding and "I think I
        // finished" is not.
        const workedOn = this.plans.active(runId, spec);
        if (workedOn) {
          this.plans.complete(runId, spec, workedOn.id, report.summary.split("\n")[0]?.slice(0, 200));
        }

        if (decision?.verb === "CONTINUE") {
          // Passing verification ended the ITERATION, not the run. The agent
          // has more to do and said what it is; the next turn will do it.
          //
          // And it does it in a fresh conversation. A resumed session carries
          // every previous phase into every model call: measured across one
          // real 22-phase night, context per call grew from 12k tokens to 165k
          // — 11.7M input tokens over 144 calls, climbing almost linearly.
          //
          // Safe here and nowhere else. This is a settled, verified,
          // checkpointed piece of work: the code is on disk and the digest
          // carries what was done and decided, which is exactly what the digest
          // was built for. A REPAIR turn must keep its session, because
          // repairing needs the failure in context — and repairs never reach
          // this branch, which only runs on a green verification.
          this.rotateSessionForNextPhase(runId, grant);
          this.changed(runId);
          continue;
        }

        if (decision) {
          // PLAN_COMPLETE is a proposal, not a completion. An agent that could
          // declare itself finished would be marking its own homework at 3am,
          // so both remaining verbs stop and ask a person.
          const reason = decision.verb === "PLAN_COMPLETE" ? "plan_complete_proposed" : "direction_needs_human";
          const detail = decision.verb === "PLAN_COMPLETE"
            ? `The worker believes the plan is complete: ${decision.reason ?? "no reason given"}. Verification passed; a human decides whether the run is done.`
            : `The worker asked for a human: ${decision.reason ?? "no reason given"}.`;
          this.hold(runId, reason, detail);
          return this.settle(runId, reason, detail, report, turnsRun);
        }

        // No decision block, but a plan with work still in it. The run is not
        // finished; the agent simply did not say what was next.
        //
        // The rule below — a green verification finishes the run — predates
        // plans and self-direction, and was right when a run was one piece of
        // work judged by its acceptance criteria. Against a twenty-two phase
        // plan it is a trap: one forgotten block on phase 1 marks the whole
        // run COMPLETED and ends the night, with twenty-one phases untouched
        // and a report that says it succeeded.
        //
        // The plan's own order is the fallback, exactly as it is when an agent
        // names no item. Nothing here is unbounded: turns, iterations, time,
        // spend and no-progress all still apply.
        if (!this.plans.settled(runId, spec) && this.plans.next(runId, spec)) {
          this.ports.logger.log("info", "Autopilot turn ended without a decision; continuing on plan order", {
            runId, turnId: turn.id
          });
          this.changed(runId);
          continue;
        }

        // No decision block and nothing left in the plan: a green verification
        // means what it has always meant.
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
        this.iterations.settleActive(runId, { status: "INDETERMINATE", verificationId: record.id, summary: report.summary });
        await this.captureSnapshot(runId, turn.id, "verification-indeterminate", grant.workspaceRoot);
        evaluatePrimaryProgress(this.ports, runId);
        // Requirement: never invent success. Hold for a human instead.
        this.needsReview(runId, report.indeterminateReason ?? "Verification was inconclusive.");
        return this.settle(runId, "verification_indeterminate", report.summary, report, turnsRun);
      }

      this.loops.updateTurn({ turnId: turn.id, status: "FAILED_VERIFICATION", verificationId: record.id });
      // No checkpoint: a failing tree is never recorded as known-good. The
      // ITERATION stays open — repairing this assignment is still this piece of
      // work, and charging a fresh iteration for every failed attempt would
      // make the operator's budget mean something they did not choose.
      await this.captureSnapshot(runId, turn.id, "verification-failed", grant.workspaceRoot);
      this.engine.store.appendEvent(runId, {
        type: "VERIFICATION_TIER_FAILED",
        payload: { turnId: turn.id, tier: report.failingTier?.tier ?? null, exitCode: report.failingTier?.exitCode ?? null }
      });

      if (this.evaluateProgressHold(runId)) {
        this.iterations.settleActive(runId, { status: "FAILED", verificationId: record.id, summary: report.summary });
        return this.settle(runId, "consultant_recommended", "PRIMARY stalled without new progress.", report, turnsRun);
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutive) {
        this.iterations.settleActive(runId, { status: "FAILED", verificationId: record.id, summary: report.summary });
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
  /**
   * Asks the chat what to do next.
   *
   * The director sees evidence, never the workspace: the human's goal and plan,
   * the assignment it gave last time, what the agent reported, and what
   * DexNest's own verification found. If no director is wired, this is a
   * request for a human rather than a silent fall back to self-direction —
   * the operator chose who decides, and quietly substituting a different
   * decider would make that choice a suggestion.
   */
  private async askDirector(
    runId: string,
    spec: RunSpec,
    turnId: string,
    workerReport: string,
    verification: VerificationReport | null
  ): Promise<{ decision: ParsedDirection; failure: WorkerFailure | null }> {
    if (!this.director) {
      return {
        decision: {
          verb: "NEEDS_HUMAN", assignment: null, planItemId: null,
          reason: "This run is directed by a chat, but no chat session is configured.",
          issue: "No director is available."
        },
        failure: null
      };
    }
    const grant = this.loops.activeGrant(runId);
    const previous = this.directions.list(runId).filter(entry => entry.verb === "CONTINUE").at(-1) ?? null;
    const prompt = directorPrompt({
      spec,
      plan: this.plans.view(runId, spec),
      iteration: this.iterations.list(runId).length,
      iterationsRemaining: grant?.maxIterations != null ? Math.max(0, grant.maxIterations - grant.iterationsUsed) : null,
      lastAssignment: previous?.assignment ?? null,
      workerReport,
      verification
    });
    return this.director.decide({ runId, prompt });
  }

  /**
   * Whether an answerable bound has been reached.
   *
   * Deliberately evaluated only between pieces of work. A wall-clock stop that
   * killed a turn mid-flight would leave an uncertain send for a human to
   * resolve in the morning, which is the opposite of what "stop at 7am" is
   * for — so the last piece of work always finishes.
   */
  private exceededStopCondition(runId: string, grant: LoopGrant): { reason: LoopStopReason; detail: string } | null {
    // Time and cost wait for the piece of work in flight to finish, so nothing
    // is left half-done. Running out of time mid-assignment and stopping there
    // would hand the operator an unverified, uncommitted mess in the morning.
    const between = !this.iterations.active(runId);

    if (between && grant.stopAt && Date.parse(this.ports.clock.now()) >= Date.parse(grant.stopAt)) {
      return { reason: "time_limit", detail: `Reached the ${grant.stopAt} stop time. Everything already started was finished first.` };
    }
    if (between && grant.maxCostUsd !== null && grant.costUsed >= grant.maxCostUsd) {
      return {
        reason: "cost_limit",
        detail: `Spent ${grant.costUsed.toFixed(2)} of the ${grant.maxCostUsd.toFixed(2)} budget, as the provider reports it.`
      };
    }
    // No-progress deliberately does NOT wait for the piece of work to finish.
    // The work in flight is exactly what is going nowhere, so waiting for it
    // to end would be waiting forever. It still only stops at a TURN boundary,
    // which is the property that actually matters: no send is ever killed.
    if (grant.maxIdleTurns !== null) {
      // Turns burned since anything last passed verification.
      //
      // Counting unverified ITERATIONS instead cannot work: a piece of work
      // that never passes never settles, so the count would never advance and
      // the bound would be unreachable. Turns is also the broader signal — it
      // catches a repair loop, a context-request storm and a run producing
      // nothing at all, where maxConsecutiveFailures only sees failing checks.
      const turns = this.loops.turns(runId);
      let idle = 0;
      for (const turn of [...turns].reverse()) {
        if (turn.status === "VERIFIED") break;
        idle += 1;
      }
      if (idle >= grant.maxIdleTurns) {
        return {
          reason: "no_progress",
          detail: `${idle} turn(s) since anything last passed verification. Stopping rather than continuing to spend on it.`
        };
      }
    }
    return null;
  }

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
