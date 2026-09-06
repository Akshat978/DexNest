// The effects gateway.
//
// This is the object an executor is handed instead of a filesystem or a process
// spawner. It is the complete path from intent to effect:
//
//   Intent -> Policy -> [Approval] -> Journal -> Dispatcher -> Result -> Journal
//
// An executor cannot skip a stage, because an executor never holds the platform
// ports — only this gateway does, and only via the dispatcher.

import type { Intent } from "./intent.ts";
import { describeIntent, fingerprintIntent } from "./intent.ts";
import type { RuntimePorts } from "./ports.ts";
import { evaluateIntent, type CapabilityPolicy, type PolicyDecision } from "./policy.ts";
import { Dispatcher, UnauthorizedDispatchError, type DispatchResult } from "./dispatcher.ts";
import { OperationStore, type ApprovalRecord, type OperationRecord } from "./operations.ts";
import type { AutopilotStore } from "./store.ts";
import {
  WorkerDiagnosticsStore, classifyProviderFailure, secretEnvironmentValues,
  diagnosticActivityLabel, type DiagnosticScope, type DiagnosticCategory
} from "./diagnostics.ts";

/**
 * WorkerFailure values that already name a diagnostic category. A provider
 * failure outside this set is classified from its output instead of trusting
 * a label the category vocabulary does not have.
 */
const PROVIDER_FAILURE_CATEGORIES = new Set<string>([
  "quota", "timeout", "interrupted", "process", "not_installed"
]);

export type EffectOutcome =
  | { status: "COMPLETED"; operation: OperationRecord; result: DispatchResult }
  | { status: "FAILED"; operation: OperationRecord; result: DispatchResult }
  | { status: "DENIED"; operation: OperationRecord; decision: PolicyDecision }
  | { status: "AWAITING_APPROVAL"; operation: OperationRecord; approval: ApprovalRecord }
  | { status: "REJECTED"; operation: OperationRecord; approval: ApprovalRecord };

export interface EffectsGatewayOptions {
  ports: RuntimePorts;
  store: AutopilotStore;
  dispatcher: Dispatcher;
  windows?: boolean;
}

export class EffectsGateway {
  readonly operations: OperationStore;
  readonly diagnostics: WorkerDiagnosticsStore;

  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;
  private readonly dispatcher: Dispatcher;
  private readonly windows: boolean;

  constructor(options: EffectsGatewayOptions) {
    this.ports = options.ports;
    this.store = options.store;
    this.dispatcher = options.dispatcher;
    this.operations = new OperationStore(options.ports);
    this.diagnostics = new WorkerDiagnosticsStore(options.ports);
    this.windows = options.windows ?? true;
  }

  /**
   * Requests an effect.
   *
   * Every path through this method journals before it acts. A denied intent
   * never reaches the dispatcher, and an approval-gated intent is persisted and
   * left pending — the side effect does not happen until a human resolves it.
   */
  async request(input: {
    runId: string;
    stepKey: string | null;
    policy: CapabilityPolicy;
    intent: Intent;
    beforeDispatch?: (operation: OperationRecord) => void;
    onWorkerSession?: (providerSessionId: string) => void;
    /** Stdout as it arrives, for live display. Never authoritative. */
    onOutput?: (chunk: string) => void;
    /**
     * Declares this operation as an Autopilot provider process, which is the
     * only thing that enables durable failure diagnostics. Omitted everywhere
     * else, so no other DexNest process starts persisting its output.
     */
    diagnostics?: DiagnosticScope;
  }): Promise<EffectOutcome> {
    const { runId, stepKey, policy, intent } = input;
    const fingerprint = fingerprintIntent(intent, this.windows);

    // Rejoin an operation already in flight for this exact intent. After a
    // crash, a re-running step lands here instead of creating a duplicate
    // approval request or a second execution.
    const existing = this.operations.findReusable({ runId, stepKey, fingerprint });
    if (existing) {
      if (existing.dispatchedAt || existing.status === "UNCERTAIN") {
        throw new UnauthorizedDispatchError("effects.uncertain-dispatch", "A prior dispatch has no settled outcome; reconciliation is required.");
      }
      if (existing.status === "AWAITING_APPROVAL") {
        const approval = this.operations.getApprovalForOperation(existing.id);
        if (approval && approval.status === "PENDING") {
          return { status: "AWAITING_APPROVAL", operation: existing, approval };
        }
        if (approval && approval.status === "REJECTED") {
          return { status: "REJECTED", operation: existing, approval };
        }
      }
      if (existing.status === "APPROVED") {
        return this.execute({ runId, stepKey, policy, intent, operation: existing, beforeDispatch: input.beforeDispatch, onWorkerSession: input.onWorkerSession, onOutput: input.onOutput, diagnostics: input.diagnostics });
      }
      if (existing.status === "REJECTED") {
        const approval = this.operations.getApprovalForOperation(existing.id);
        if (approval) return { status: "REJECTED", operation: existing, approval };
      }
    }

    const settled = this.operations.findSettled({ runId, stepKey, fingerprint });
    if (settled) {
      throw new UnauthorizedDispatchError(
        "effects.already-settled",
        `Operation for this intent already settled as ${settled.status}; it must not be performed again.`
      );
    }

    const decision = evaluateIntent(policy, intent, {
      ownedPids: this.dispatcher.ownedPids(runId),
      windows: this.windows
    });

    // Journal the intent and the decision together, and COMMIT, before acting.
    const operation = this.store.transaction(() => {
      const record = this.operations.record({
        runId,
        stepKey,
        intent,
        decision,
        status:
          decision.decision === "DENY" ? "DENIED" : decision.decision === "REQUIRE_APPROVAL" ? "AWAITING_APPROVAL" : "PENDING_POLICY"
      });

      const run = this.store.requireRun(runId);
      this.store.appendEventUnsafe(runId, run.state, {
        type: "OPERATION_INTENT_RECORDED",
        stepKey,
        payload: {
          operationId: record.id,
          kind: intent.kind,
          summary: record.summary,
          fingerprint: record.fingerprint
        }
      });
      this.store.appendEventUnsafe(runId, run.state, {
        type: decision.decision === "DENY" ? "OPERATION_DENIED" : "OPERATION_POLICY_DECIDED",
        stepKey,
        payload: {
          operationId: record.id,
          decision: decision.decision,
          rule: decision.rule,
          reason: decision.reason,
          capability: decision.capability,
          risk: decision.risk,
          normalizedTarget: decision.normalizedTarget
        }
      });

      return record;
    });

    if (decision.decision === "DENY") {
      this.ports.logger.log("warn", `Autopilot denied ${describeIntent(intent)}`, { rule: decision.rule, runId });
      return { status: "DENIED", operation, decision };
    }

    if (decision.decision === "REQUIRE_APPROVAL") {
      const approval = this.store.transaction(() => {
        const created = this.operations.createApproval({ operation, decision });
        const run = this.store.requireRun(runId);
        this.store.appendEventUnsafe(runId, run.state, {
          type: "APPROVAL_REQUESTED",
          stepKey,
          payload: {
            operationId: operation.id,
            approvalId: created.id,
            summary: created.summary,
            reason: created.reason,
            risk: created.risk,
            capability: created.capability,
            // Attention metadata: approvals are the first real human-attention
            // objects in the system.
            blocking: true,
            actionRequired: "approve_or_reject"
          }
        });
        return created;
      });

      return { status: "AWAITING_APPROVAL", operation: this.operations.require(operation.id), approval };
    }

    return this.execute({ runId, stepKey, policy, intent, operation, beforeDispatch: input.beforeDispatch, onWorkerSession: input.onWorkerSession, onOutput: input.onOutput, diagnostics: input.diagnostics });
  }

  /**
   * Dispatches an already-authorized operation.
   *
   * Called for ALLOW immediately, and for an approved operation once a human has
   * resolved it. Refuses anything settled, so a restart cannot execute an
   * operation twice.
   */
  async execute(input: {
    runId: string;
    stepKey: string | null;
    policy: CapabilityPolicy;
    intent: Intent;
    operation: OperationRecord;
    beforeDispatch?: (operation: OperationRecord) => void;
    onWorkerSession?: (providerSessionId: string) => void;
    /** Stdout as it arrives, for live display. Never authoritative. */
    onOutput?: (chunk: string) => void;
    /**
     * Declares this operation as an Autopilot provider process, which is the
     * only thing that enables durable failure diagnostics. Omitted everywhere
     * else, so no other DexNest process starts persisting its output.
     */
    diagnostics?: DiagnosticScope;
  }): Promise<EffectOutcome> {
    const { runId, stepKey, policy, intent } = input;
    let operation = this.operations.require(input.operation.id);

    if (operation.settledAt) {
      throw new UnauthorizedDispatchError(
        "effects.already-settled",
        `Operation ${operation.id} already settled as ${operation.status} and must not be dispatched again.`
      );
    }
    if (operation.dispatchedAt) {
      throw new UnauthorizedDispatchError("effects.uncertain-dispatch", "An already dispatched operation requires reconciliation, never replay.");
    }

    // TOCTOU: what is about to run must be exactly what was authorized.
    const actual = fingerprintIntent(intent, this.windows);
    if (actual !== operation.fingerprint) {
      this.store.appendEvent(runId, {
        type: "APPROVAL_MISMATCH_REJECTED",
        stepKey,
        payload: { operationId: operation.id, authorized: operation.fingerprint, received: actual }
      });
      throw new UnauthorizedDispatchError(
        "effects.fingerprint-mismatch",
        `Intent does not match the authorized operation ${operation.id}. An authorization covers one exact operation.`
      );
    }

    operation = this.operations.markDispatched(operation.id);
    this.store.appendEvent(runId, {
      type: "OPERATION_DISPATCHED",
      stepKey,
      payload: { operationId: operation.id, summary: operation.summary }
    });

    // The caller can commit domain send identity before the dispatcher reaches the OS.
    // A failure here deliberately leaves an unsettled dispatch for reconciliation.
    input.beforeDispatch?.(operation);
    try {
      const result = await this.dispatcher.dispatch({ operation, intent, policy, runId, onWorkerSession: input.onWorkerSession, onOutput: input.onOutput });
      const settled = this.operations.updateStatus({
        operationId: operation.id,
        status: result.ok ? "COMPLETED" : "FAILED",
        exitCode: result.exitCode,
        // Audit records what happened, not private content: no stdout here.
        resultSummary: result.summary
      });
      // Failures only. A successful provider turn is model output, not evidence,
      // and storing it here would turn the journal into a transcript.
      if (!result.ok && input.diagnostics) {
        this.captureDiagnostics({ runId, stepKey, policy, operationId: operation.id, scope: input.diagnostics, result });
      }
      this.store.appendEvent(runId, {
        type: result.ok ? "OPERATION_COMPLETED" : "OPERATION_FAILED",
        stepKey,
        payload: { operationId: operation.id, summary: result.summary, exitCode: result.exitCode }
      });
      return result.ok
        ? { status: "COMPLETED", operation: settled, result }
        : { status: "FAILED", operation: settled, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const settled = this.operations.updateStatus({
        operationId: operation.id,
        status: "FAILED",
        resultSummary: message
      });
      // A refusal before the OS is still worth recording for a provider process:
      // it explains an empty result that otherwise looks like a silent failure.
      if (input.diagnostics) {
        this.captureDiagnostics({
          runId, stepKey, policy, operationId: operation.id, scope: input.diagnostics,
          result: { ok: false, summary: message, exitCode: null, stderr: message, detail: { policyRefused: true } }
        });
      }
      this.store.appendEvent(runId, {
        type: "OPERATION_FAILED",
        stepKey,
        payload: { operationId: operation.id, summary: message }
      });
      return { status: "FAILED", operation: settled, result: { ok: false, summary: message, exitCode: null } };
    }
  }

  /**
   * Records evidence for a failure the provider reported inside a process that
   * exited cleanly.
   *
   * Found by the first real operator-consultation trial: Codex speaks its
   * protocol over stdio and exits 0 even when the turn itself failed, so a
   * genuine quota refusal settled as a COMPLETED operation and left no
   * diagnostics at all. Exit status alone is therefore not a sufficient failure
   * signal — the layer that classified the provider's own result has to say so.
   *
   * Idempotent: the store keeps one row per operation, so calling this after a
   * process-level capture is harmless.
   */
  recordProviderFailure(input: {
    runId: string;
    stepKey: string | null;
    policy: CapabilityPolicy;
    operationId: string;
    scope: DiagnosticScope;
    failure: string;
    result: DispatchResult;
  }): void {
    if (this.diagnostics.forOperation(input.operationId)) return;
    const detail = input.result.detail ?? {};
    // Prefer the provider's own classification; fall back to reading its output.
    const category = PROVIDER_FAILURE_CATEGORIES.has(input.failure)
      ? (input.failure as DiagnosticCategory)
      : classifyProviderFailure({
          transportFailure: typeof detail.failure === "string" ? detail.failure : null,
          exitCode: input.result.exitCode,
          stdout: input.result.stdout,
          stderr: input.result.stderr
        });

    const recorded = this.diagnostics.record({
      runId: input.runId,
      operationId: input.operationId,
      scope: input.scope,
      category,
      exitCode: input.result.exitCode,
      signal: typeof detail.signal === "string" ? detail.signal : null,
      stdout: input.result.stdout,
      stderr: input.result.stderr,
      secretValues: secretEnvironmentValues(input.policy, this.ports.platform?.env.snapshot() ?? {})
    });
    if (!recorded) return;
    this.store.appendEvent(input.runId, {
      type: "WORKER_DIAGNOSTICS_RECORDED",
      stepKey: input.stepKey,
      payload: {
        operationId: input.operationId, provider: recorded.provider, role: recorded.role,
        category: recorded.category, exitCode: recorded.exitCode,
        label: diagnosticActivityLabel(recorded.provider, recorded.role, recorded.category)
      }
    });
  }

  /**
   * Records bounded, redacted evidence for one failed provider process.
   *
   * Redaction and bounding happen inside the store, so nothing here can write
   * raw output. The secret values are taken from the same environment
   * classification the dispatcher uses to decide what a child may inherit.
   */
  private captureDiagnostics(input: {
    runId: string;
    stepKey: string | null;
    policy: CapabilityPolicy;
    operationId: string;
    scope: DiagnosticScope;
    result: DispatchResult;
  }): void {
    const { result } = input;
    const detail = result.detail ?? {};
    const category = detail.policyRefused === true
      ? "policy_refused"
      : classifyProviderFailure({
          transportFailure: typeof detail.failure === "string" ? detail.failure : null,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr
        });

    const recorded = this.diagnostics.record({
      runId: input.runId,
      operationId: input.operationId,
      scope: input.scope,
      category,
      exitCode: result.exitCode,
      signal: typeof detail.signal === "string" ? detail.signal : null,
      stdout: result.stdout,
      stderr: result.stderr,
      secretValues: secretEnvironmentValues(input.policy, this.ports.platform?.env.snapshot() ?? {})
    });
    if (!recorded) return;

    // The timeline carries the one-line form only; the evidence itself stays in
    // the diagnostics table and the report.
    this.store.appendEvent(input.runId, {
      type: "WORKER_DIAGNOSTICS_RECORDED",
      stepKey: input.stepKey,
      payload: {
        operationId: input.operationId,
        provider: recorded.provider,
        role: recorded.role,
        category: recorded.category,
        exitCode: recorded.exitCode,
        label: diagnosticActivityLabel(recorded.provider, recorded.role, recorded.category)
      }
    });
  }

  /** Pending approvals, for the UI, the Stream Deck and the attention queue. */
  listPendingApprovals(runId?: string): ApprovalRecord[] {
    return this.operations.listPendingApprovals(runId);
  }

  async interruptOperation(runId: string, operationId: string, policy: CapabilityPolicy): Promise<void> {
    for (const pid of this.dispatcher.ownedPids(runId, operationId)) {
      const outcome = await this.request({ runId, stepKey: `interrupt:${operationId}:${pid}`, policy,
        intent: { kind: "TERMINATE_PROCESS", pid, purpose: "Interrupt owned worker" } });
      if (outcome.status !== "COMPLETED") throw new Error("Owned worker termination was not confirmed.");
    }
  }
}
