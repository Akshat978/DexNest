// The Autopilot run engine.
//
// Invariants this file exists to hold:
//
//   1. Intent is journaled and COMMITTED before any side effect happens.
//   2. A restart never blindly repeats a side effect whose outcome is unknown.
//   3. A logical step executes at most once, enforced by a UNIQUE index rather
//      than by in-memory bookkeeping that a crash would lose.
//   4. Every state change is accompanied by a journal event in one transaction.
//   5. Nothing polls. The engine is idle when no run is active.

import type { RunSpecInput } from "./runSpec.ts";
import { createRunSpec } from "./runSpec.ts";
import type { RuntimePorts, StepExecutor, StepProbeResult } from "./ports.ts";
import type { RunEventRecord, RunRecord, StepRecord } from "./store.ts";
import { AutopilotStore } from "./store.ts";
import { isSettled, isTerminal, type RunState } from "./states.ts";
import type { CapabilityPolicy } from "./policy.ts";
import { defaultCapabilityPolicy } from "./policy.ts";
import { EffectsGateway } from "./effects.ts";
import { Dispatcher } from "./dispatcher.ts";
import type { ApprovalRecord, OperationRecord } from "./operations.ts";
import { WorkerStore } from "./workerStore.ts";

export interface EngineOptions {
  ports: RuntimePorts;
  executor: StepExecutor;
  /**
   * Capability policy for runs this engine drives. Phase 2 carries one policy
   * per engine; a later phase derives it per run from the Run Spec revision.
   */
  policy?: CapabilityPolicy;
  windows?: boolean;
}

export interface RunSnapshot {
  run: RunRecord;
  steps: StepRecord[];
  events: RunEventRecord[];
  operations: OperationRecord[];
  pendingApprovals: ApprovalRecord[];
}

export type UncertainResolution = "completed" | "not_performed";

export interface RecoverOptions {
  /**
   * Resume runs that reconciliation proved safe to continue.
   *
   * Defaults to false: after an unexplained crash the safe default is to hold at
   * PAUSED and let a human decide, rather than to restart autonomous work
   * unattended.
   */
  autoResume?: boolean;
}

export interface RecoveryOutcome {
  runId: string;
  previousState: RunState;
  resolvedState: RunState;
  reason: string;
}

type Listener = (runId: string) => void;

export class AutopilotEngine {
  readonly store: AutopilotStore;

  /** Present only when platform ports were supplied. */
  readonly effects: EffectsGateway | null;

  readonly policy: CapabilityPolicy;

  private readonly ports: RuntimePorts;
  private readonly executor: StepExecutor;
  private readonly active = new Map<string, Promise<void>>();
  private readonly listeners = new Set<Listener>();

  constructor(options: EngineOptions) {
    this.ports = options.ports;
    this.executor = options.executor;
    this.store = new AutopilotStore(options.ports);
    this.policy = options.policy ?? defaultCapabilityPolicy();
    this.effects = options.ports.platform
      ? new EffectsGateway({
          ports: options.ports,
          store: this.store,
          dispatcher: new Dispatcher({ platform: options.ports.platform, windows: options.windows }),
          windows: options.windows
        })
      : null;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(runId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(runId);
      } catch (error) {
        this.ports.logger.log("warn", "Autopilot change listener threw", {
          runId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // --- lifecycle -----------------------------------------------------------

  createRun(input: RunSpecInput): RunRecord {
    const spec = createRunSpec(input, {
      id: input.id ?? this.ports.ids.next("ap-run"),
      now: this.ports.clock.now()
    });

    const run = this.store.createRun({ spec, executorId: this.executor.id });
    this.store.appendEvent(run.id, { type: "RUN_READY", toState: "READY" });
    this.notify(run.id);
    return this.store.requireRun(run.id);
  }

  snapshot(runId: string): RunSnapshot {
    return {
      run: this.store.requireRun(runId),
      steps: this.store.listSteps(runId),
      events: this.store.listEvents(runId),
      operations: this.effects ? this.effects.operations.listForRun(runId) : [],
      pendingApprovals: this.effects ? this.effects.listPendingApprovals(runId) : []
    };
  }

  /** Pending approvals across all runs, for the UI and the Stream Deck. */
  listPendingApprovals(runId?: string): ApprovalRecord[] {
    return this.effects ? this.effects.listPendingApprovals(runId) : [];
  }

  listRuns(limit?: number): RunRecord[] {
    return this.store.listRuns(limit);
  }

  /** Starts or resumes a run. Resolves when the run reaches a resting state. */
  async start(runId: string): Promise<RunRecord> {
    const existing = this.active.get(runId);
    if (existing) {
      await existing;
      return this.store.requireRun(runId);
    }

    const run = this.store.requireRun(runId);

    if (["claude", "codex"].includes(run.spec.workers.primary)) throw new Error("Real worker runs require an explicitly approved controlled worker turn.");
    const workerSend = new WorkerStore(this.ports).pending(runId);
    if (workerSend && workerSend.status !== "AWAITING_APPROVAL") {
      throw new Error("Worker send is unresolved; reconcile before starting the run.");
    }
    if (run.state === "READY") {
      this.store.appendEvent(runId, { type: "RUN_STARTED", toState: "RUNNING" });
    } else if (run.state === "PAUSED") {
      this.store.appendEvent(runId, {
        type: "RUN_RESUMED",
        toState: "RUNNING",
        pauseRequested: false
      });
    } else if (run.state === "AWAITING_APPROVAL") {
      // Only reachable once every blocking approval has been resolved; see
      // resolveApproval, which is the sole granter of authority.
      const stillPending = this.listPendingApprovals(runId);
      if (stillPending.length > 0) {
        throw new Error(`Autopilot run ${runId} is waiting for approval and cannot start.`);
      }
      this.store.appendEvent(runId, { type: "RUN_RESUMED", toState: "RUNNING" });
    } else if (run.state !== "RUNNING") {
      throw new Error(`Autopilot run ${runId} cannot start from state ${run.state}.`);
    }

    this.notify(runId);

    const loop = this.drive(runId).finally(() => {
      this.active.delete(runId);
    });
    this.active.set(runId, loop);
    await loop;
    return this.store.requireRun(runId);
  }

  /** Alias for start() on a paused run, for call-site clarity. */
  async resume(runId: string): Promise<RunRecord> {
    return this.start(runId);
  }

  /**
   * Requests a pause. Durable immediately; the run reaches PAUSED at the next
   * safe boundary, which is a step boundary. In-flight work is never abandoned.
   */
  requestPause(runId: string): RunRecord {
    const run = this.store.requireRun(runId);
    if (run.state === "RUNNING") {
      this.store.appendEvent(runId, {
        type: "PAUSE_REQUESTED",
        toState: "PAUSE_REQUESTED",
        pauseRequested: true
      });
    } else if (run.state === "PAUSE_REQUESTED" || run.state === "PAUSED") {
      return run;
    } else {
      throw new Error(`Autopilot run ${runId} cannot pause from state ${run.state}.`);
    }
    this.notify(runId);
    return this.store.requireRun(runId);
  }

  /** Waits for a pending pause or stop to settle. */
  async settle(runId: string): Promise<RunRecord> {
    const loop = this.active.get(runId);
    if (loop) await loop;
    return this.store.requireRun(runId);
  }

  /**
   * Requests a stop. Stronger than pause: the stop intent is durable first, new
   * work is prevented, in-flight work is cancelled where safe, and the run never
   * auto-resumes after a restart.
   */
  async requestStop(runId: string): Promise<RunRecord> {
    const run = this.store.requireRun(runId);

    if (isTerminal(run.state)) {
      return run;
    }

    if (run.state !== "STOP_REQUESTED") {
      this.store.appendEvent(runId, {
        type: "STOP_REQUESTED",
        toState: "STOP_REQUESTED",
        stopRequested: true
      });
      this.notify(runId);
    }

    await this.executor.cancel(runId);

    const workerSend = new WorkerStore(this.ports).pending(runId);
    if (workerSend?.operationId && this.effects) {
      await this.effects.interruptOperation(runId, workerSend.operationId, this.policy);
    }

    const loop = this.active.get(runId);
    if (loop) {
      await loop;
    }

    // Finalize here when no loop was running (READY, PAUSED, NEEDS_REVIEW), and
    // as a safety net when a loop returned via a halt path without reaching its
    // boundary check. A stop request must always end in STOPPED.
    const current = this.store.requireRun(runId);
    if (current.state === "STOP_REQUESTED") {
      this.store.appendEvent(runId, { type: "RUN_STOPPED", toState: "STOPPED" });
      this.notify(runId);
    }

    return this.store.requireRun(runId);
  }

  /**
   * Human resolution of a step whose outcome reconciliation could not determine.
   * This is the only exit from NEEDS_REVIEW, and it is deliberately explicit:
   * the operator states what actually happened.
   */
  resolveUncertainStep(runId: string, stepKey: string, resolution: UncertainResolution): RunRecord {
    const run = this.store.requireRun(runId);
    if (run.state !== "NEEDS_REVIEW") {
      throw new Error(`Autopilot run ${runId} is not awaiting review (state ${run.state}).`);
    }

    const step = this.store.getStep(runId, stepKey);
    if (!step) {
      throw new Error(`Step ${stepKey} was not found for run ${runId}.`);
    }
    if (step.status !== "UNCERTAIN") {
      throw new Error(`Step ${stepKey} is not uncertain (status ${step.status}).`);
    }

    this.store.updateStep({
      runId,
      stepKey,
      status: resolution === "completed" ? "COMPLETED" : "INTENT",
      summary: resolution === "completed" ? "Resolved by human: side effect had already happened" : "Resolved by human: side effect never happened",
      settled: resolution === "completed",
      event: {
        type: "STEP_RESOLVED_BY_HUMAN",
        payload: { resolution }
      }
    });

    // Resolution returns the run to a held state; continuing is a separate,
    // deliberate act.
    this.store.appendEvent(runId, { type: "RUN_PAUSED", toState: "PAUSED", reconcileReason: null });
    this.notify(runId);
    return this.store.requireRun(runId);
  }

  /**
   * Resolves one pending approval.
   *
   * The single point where gated authority is granted. Scoped to exactly one
   * operation: approving here never confers standing permission, and there is
   * deliberately no "approve everything for this session".
   *
   * Approving does not itself execute anything — it authorizes the operation.
   * The run then continues, re-issues the same intent, matches the approved
   * operation by fingerprint, and dispatches it exactly once.
   */
  resolveApproval(input: {
    approvalId: string;
    decision: "APPROVED" | "REJECTED";
    source: string;
  }): ApprovalRecord {
    if (!this.effects) {
      throw new Error("Autopilot approvals require platform ports.");
    }

    const before = this.effects.operations.requireApproval(input.approvalId);
    if (before.status !== "PENDING") {
      return before;
    }

    const resolved = this.effects.operations.resolveApproval({
      approvalId: input.approvalId,
      status: input.decision,
      source: input.source
    });

    this.store.appendEvent(resolved.runId, {
      type: input.decision === "APPROVED" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      payload: {
        approvalId: resolved.id,
        operationId: resolved.operationId,
        source: input.source,
        summary: resolved.summary,
        risk: resolved.risk
      }
    });

    if (input.decision === "REJECTED") {
      // A rejected operation never executes. The run holds rather than failing,
      // so the operator can stop it or adjust and continue deliberately.
      const run = this.store.requireRun(resolved.runId);
      if (run.state === "AWAITING_APPROVAL") {
        this.store.appendEvent(resolved.runId, {
          type: "RUN_PAUSED",
          toState: "PAUSED",
          payload: { reason: "approval rejected" }
        });
      }
    }

    this.notify(resolved.runId);
    return resolved;
  }

  // --- recovery ------------------------------------------------------------

  /**
   * Reconciles every run left mid-flight by a crash. Called once at startup,
   * before any run is allowed to continue.
   */
  async recoverAll(options: RecoverOptions = {}): Promise<RecoveryOutcome[]> {
    const outcomes: RecoveryOutcome[] = [];
    for (const run of this.store.listUnfinishedRuns()) {
      outcomes.push(await this.reconcile(run.id, options));
    }
    return outcomes;
  }

  /**
   * Reconciliation algorithm.
   *
   * 1. Enter RECONCILING and journal why.
   * 2. A pending stop wins outright — a stopped run never auto-resumes.
   * 3. Find the first step with journaled intent and no recorded outcome. That
   *    is the crash window. Ask the executor for evidence:
   *      completed   -> record the outcome that was lost, continue.
   *      not_started -> the world is unchanged, so executing is not a duplicate.
   *      unknown     -> refuse to guess. Mark UNCERTAIN, go to NEEDS_REVIEW.
   * 4. Otherwise resolve to a held state, or resume when explicitly allowed.
   */
  async reconcile(runId: string, options: RecoverOptions = {}): Promise<RecoveryOutcome> {
    const run = this.store.requireRun(runId);
    const previousState = run.state;

    if (isTerminal(previousState)) {
      return { runId, previousState, resolvedState: previousState, reason: "already terminal" };
    }

    this.store.appendEvent(runId, {
      type: "RECONCILIATION_STARTED",
      toState: "RECONCILING",
      payload: { previousState, pauseRequested: run.pauseRequested, stopRequested: run.stopRequested },
      reconcileReason: `restart from ${previousState}`
    });
    this.notify(runId);

    // A stop that was requested but never finished must complete as a stop.
    if (run.stopRequested || previousState === "STOP_REQUESTED") {
      this.store.appendEvent(runId, {
        type: "RECONCILIATION_RESOLVED",
        payload: { resolution: "stop_completed" }
      });
      this.store.appendEvent(runId, { type: "RUN_STOPPED", toState: "STOPPED", reconcileReason: null });
      this.notify(runId);
      return { runId, previousState, resolvedState: "STOPPED", reason: "stop was pending at crash" };
    }

    // A real worker send can outlive its CLI process and is never replayable merely
    // because no generic step outcome exists. Preserve this across repeated restarts.
    const workers = new WorkerStore(this.ports);
    const send = workers.pending(runId);
    if (send && (send.status !== "AWAITING_APPROVAL" ||
      (send.operationId && this.effects?.operations.require(send.operationId).dispatchedAt))) {
      workers.update(send.id, "UNCERTAIN", send.operationId, send.result);
      this.store.appendEvent(runId, { type: "RUN_NEEDS_REVIEW", toState: "NEEDS_REVIEW",
        reconcileReason: `Worker send ${send.id} has no confirmed outcome.` });
      this.notify(runId);
      return { runId, previousState, resolvedState: "NEEDS_REVIEW", reason: "worker send outcome unknown" };
    }

    // A pending approval outlives any restart. The run resumes waiting rather
    // than re-asking, and above all without executing the gated operation.
    const pending = this.listPendingApprovals(runId);
    if (pending.length > 0) {
      this.store.appendEvent(runId, {
        type: "RECONCILIATION_RESOLVED",
        payload: { resolution: "approval_still_pending", approvalId: pending[0]!.id }
      });
      this.store.appendEvent(runId, {
        type: "APPROVAL_REQUESTED",
        toState: "AWAITING_APPROVAL",
        payload: { approvalId: pending[0]!.id, summary: pending[0]!.summary, blocking: true, recovered: true }
      });
      this.notify(runId);
      return {
        runId,
        previousState,
        resolvedState: "AWAITING_APPROVAL",
        reason: `approval ${pending[0]!.id} still pending`
      };
    }

    const steps = this.store.listSteps(runId);

    // An unresolved uncertainty survives any number of restarts. Without this,
    // a second reconciliation would find no INTENT/RUNNING step (the first pass
    // already marked it UNCERTAIN) and silently fall through to a held state,
    // discarding the very ambiguity that requires a human.
    const stillUncertain = steps.find((step) => step.status === "UNCERTAIN");
    if (stillUncertain) {
      this.store.appendEvent(runId, {
        type: "RECONCILIATION_RESOLVED",
        stepKey: stillUncertain.stepKey,
        payload: { resolution: "uncertain_unchanged" }
      });
      this.store.appendEvent(runId, {
        type: "RUN_NEEDS_REVIEW",
        toState: "NEEDS_REVIEW",
        stepKey: stillUncertain.stepKey,
        reconcileReason: `step ${stillUncertain.stepKey} outcome still unresolved`
      });
      this.notify(runId);
      return {
        runId,
        previousState,
        resolvedState: "NEEDS_REVIEW",
        reason: `step ${stillUncertain.stepKey} outcome unknown and unresolved`
      };
    }

    // The crash window: intent journaled, outcome never recorded.
    const unsettled = steps.find((step) => step.status === "INTENT" || step.status === "RUNNING");

    if (unsettled) {
      const evidence = await this.executor.probe({
        runId,
        stepKey: unsettled.stepKey,
        idempotencyKey: unsettled.idempotencyKey
      });

      if (evidence === "completed") {
        this.store.updateStep({
          runId,
          stepKey: unsettled.stepKey,
          status: "COMPLETED",
          summary: "Recovered by reconciliation: side effect confirmed",
          settled: true,
          event: { type: "STEP_COMPLETED", payload: { recovered: true, evidence } }
        });
      } else if (evidence === "unknown") {
        this.store.updateStep({
          runId,
          stepKey: unsettled.stepKey,
          status: "UNCERTAIN",
          summary: "Outcome could not be determined after restart",
          event: { type: "STEP_UNCERTAIN", payload: { evidence } }
        });
        this.store.appendEvent(runId, {
          type: "RECONCILIATION_RESOLVED",
          stepKey: unsettled.stepKey,
          payload: { resolution: "uncertain", evidence }
        });
        this.store.appendEvent(runId, {
          type: "RUN_NEEDS_REVIEW",
          toState: "NEEDS_REVIEW",
          stepKey: unsettled.stepKey,
          reconcileReason: `step ${unsettled.stepKey} outcome unknown after restart`
        });
        this.notify(runId);
        return {
          runId,
          previousState,
          resolvedState: "NEEDS_REVIEW",
          reason: `step ${unsettled.stepKey} outcome unknown`
        };
      } else {
        // not_started: the side effect provably did not happen, so allowing the
        // step to execute is not a duplicate execution.
        this.store.appendEvent(runId, {
          type: "RECONCILIATION_RESOLVED",
          stepKey: unsettled.stepKey,
          payload: { resolution: "safe_to_execute", evidence }
        });
      }
    }

    const resume = options.autoResume === true && !run.pauseRequested;
    const resolvedState: RunState = resume ? "RUNNING" : "PAUSED";
    const reason = unsettled
      ? `reconciled step ${unsettled.stepKey}`
      : `no in-flight step; held after ${previousState}`;

    this.store.appendEvent(runId, {
      type: "RECONCILIATION_RESOLVED",
      payload: { resolution: resume ? "resumed" : "held", previousState }
    });

    if (resume) {
      this.store.appendEvent(runId, { type: "RUN_STARTED", toState: "RUNNING", reconcileReason: null });
      this.notify(runId);
      const loop = this.drive(runId).finally(() => this.active.delete(runId));
      this.active.set(runId, loop);
      await loop;
    } else {
      this.store.appendEvent(runId, {
        type: "RUN_PAUSED",
        toState: "PAUSED",
        pauseRequested: false,
        reconcileReason: null
      });
      this.notify(runId);
    }

    return { runId, previousState, resolvedState, reason };
  }

  // --- the loop ------------------------------------------------------------

  private async drive(runId: string): Promise<void> {
    const plan = this.executor.plan(runId);

    for (let ordinal = 0; ordinal < plan.length; ordinal += 1) {
      const stepKey = plan[ordinal]!;
      const run = this.store.requireRun(runId);

      // Safe boundary: stop wins over pause.
      if (run.stopRequested || run.state === "STOP_REQUESTED") {
        this.store.appendEvent(runId, { type: "RUN_STOPPED", toState: "STOPPED" });
        this.notify(runId);
        return;
      }
      if (run.pauseRequested || run.state === "PAUSE_REQUESTED") {
        this.store.appendEvent(runId, { type: "RUN_PAUSED", toState: "PAUSED" });
        this.notify(runId);
        return;
      }
      if (run.state !== "RUNNING") {
        return;
      }

      const existing = this.store.getStep(runId, stepKey);

      if (existing && isSettled(existing.status)) {
        if (existing.status === "FAILED") {
          this.failRun(runId, `step ${stepKey} failed: ${existing.summary ?? "unknown reason"}`);
          return;
        }
        continue;
      }

      if (existing && existing.status === "UNCERTAIN") {
        this.store.appendEvent(runId, {
          type: "RUN_NEEDS_REVIEW",
          toState: "NEEDS_REVIEW",
          stepKey,
          reconcileReason: `step ${stepKey} outcome unknown`
        });
        this.notify(runId);
        return;
      }

      let step = existing;

      if (!step) {
        // Journal intent and COMMIT before touching the outside world.
        step = this.store.recordStepIntent({
          runId,
          stepKey,
          ordinal,
          idempotencyKey: this.ports.ids.next(`ap-op-${ordinal}`)
        });

        if (!step) {
          // Another writer inserted the same logical step: never execute twice.
          this.ports.logger.log("warn", "Autopilot step intent already present; skipping execution", { runId, stepKey });
          continue;
        }
      } else {
        // Reconciliation established that this INTENT step never ran.
        this.ports.logger.log("info", "Autopilot re-executing step proven not to have run", { runId, stepKey });
      }

      const outcome = await this.executeStep(runId, step);
      if (outcome === "halt") {
        return;
      }
      // "continue" falls through to the boundary check at the top of the loop,
      // which is what turns a cancelled step into a STOPPED run.
    }

    const run = this.store.requireRun(runId);
    if (run.state === "RUNNING") {
      this.store.appendEvent(runId, { type: "RUN_COMPLETED", toState: "COMPLETED" });
      this.notify(runId);
    }
  }

  /**
   * "continue" — proceed to the next boundary check (including after a
   * cancellation, which the boundary turns into STOPPED).
   * "halt" — the run has already left RUNNING; the loop must return.
   */
  private async executeStep(runId: string, step: StepRecord): Promise<"continue" | "halt"> {
    this.store.updateStep({
      runId,
      stepKey: step.stepKey,
      status: "RUNNING",
      incrementAttempts: true,
      event: { type: "STEP_STARTED", payload: { attempt: step.attempts + 1, idempotencyKey: step.idempotencyKey } }
    });
    this.notify(runId);

    try {
      const result = await this.executor.execute({
        runId,
        stepKey: step.stepKey,
        idempotencyKey: step.idempotencyKey,
        effects: this.effects ?? undefined,
        shouldYield: () => {
          const current = this.store.requireRun(runId);
          return current.pauseRequested || current.stopRequested;
        }
      });

      // An effect is blocked on a human decision. The step is NOT settled: it
      // keeps its intent record so that resuming after approval continues the
      // same logical step rather than starting a new one.
      if (result.awaitingApproval) {
        this.store.updateStep({
          runId,
          stepKey: step.stepKey,
          status: "INTENT",
          summary: result.summary,
          event: {
            type: "APPROVAL_REQUESTED",
            payload: {
              operationId: result.awaitingApproval.operationId,
              approvalId: result.awaitingApproval.approvalId,
              blocking: true
            }
          }
        });
        this.store.appendEvent(runId, {
          type: "OPERATION_POLICY_DECIDED",
          toState: "AWAITING_APPROVAL",
          stepKey: step.stepKey,
          payload: { operationId: result.awaitingApproval.operationId, decision: "REQUIRE_APPROVAL" }
        });
        this.notify(runId);
        return "halt";
      }

      // Cancellation is not failure. A step abandoned because the operator
      // pressed stop must not push the run into FAILED.
      if (result.cancelled) {
        this.store.updateStep({
          runId,
          stepKey: step.stepKey,
          status: "SKIPPED",
          summary: result.summary,
          detail: result.detail ?? null,
          settled: true,
          event: { type: "STEP_CANCELLED", payload: { summary: result.summary } }
        });
        this.notify(runId);
        return "continue";
      }

      this.store.updateStep({
        runId,
        stepKey: step.stepKey,
        status: result.ok ? "COMPLETED" : "FAILED",
        summary: result.summary,
        detail: result.detail ?? null,
        settled: true,
        event: {
          type: result.ok ? "STEP_COMPLETED" : "STEP_FAILED",
          payload: { summary: result.summary, ...(result.detail ?? {}) }
        }
      });
      this.notify(runId);

      if (!result.ok) {
        this.failRun(runId, `step ${step.stepKey} failed: ${result.summary}`);
        return "halt";
      }

      return "continue";
    } catch (error) {
      // An in-process throw. The outcome of the side effect is not known here
      // any more than it would be after a crash, so the honest record is
      // UNCERTAIN and the resolution is reconciliation, not a retry.
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateStep({
        runId,
        stepKey: step.stepKey,
        status: "UNCERTAIN",
        summary: `Executor threw: ${message}`,
        event: { type: "STEP_UNCERTAIN", payload: { error: message } }
      });
      this.store.appendEvent(runId, {
        type: "RUN_NEEDS_REVIEW",
        toState: "NEEDS_REVIEW",
        stepKey: step.stepKey,
        reconcileReason: `executor threw during ${step.stepKey}`
      });
      this.notify(runId);
      return "halt";
    }
  }

  private failRun(runId: string, reason: string): void {
    this.store.appendEvent(runId, {
      type: "RUN_FAILED",
      toState: "FAILED",
      failureReason: reason
    });
    this.notify(runId);
  }
}
