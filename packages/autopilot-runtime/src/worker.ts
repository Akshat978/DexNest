import type { RunCommandIntent } from "./intent.ts";
import type { DispatchResult } from "./dispatcher.ts";
import type { EffectsGateway, EffectOutcome } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";
import { evaluatePathAccess } from "./policy.ts";
import type { RuntimePorts } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import { isTerminal } from "./states.ts";
import { samePath } from "./paths.ts";
import { WorkerStore, type WorkerSession, type WorkerSend } from "./workerStore.ts";
import { OwnershipStore } from "./handoff.ts";
import { assertPrimary, type WorkerRole } from "./roles.ts";

export type WorkerFailure = "not_installed" | "auth" | "quota" | "session" | "timeout" | "interrupted" |
  "permission" | "policy" | "protocol" | "process" | "unsupported";
export interface WorkerResult {
  ok: boolean;
  text: string;
  failure: WorkerFailure | null;
  sessionId: string;
  sessionConfirmed: boolean;
  /** False means execution may have occurred but completion cannot be established. */
  certain: boolean;
  providerSessionId?: string;
}
export interface WorkerAvailability {
  installed: boolean | null;
  authenticated: boolean | null;
  version: string | null;
  failure: WorkerFailure | null;
}

/** Provider-neutral lifecycle. No supervisor, retries, fallback, or coding loop. */
export interface WorkerAdapter {
  readonly role?: WorkerRole;
  readonly id: string;
  detect(runId: string): Promise<WorkerAvailability>;
  startSession(runId: string): WorkerSession;
  resumeSession(runId: string): WorkerSession;
  sessionAvailability(runId: string): "missing" | "reserved" | "last_confirmed" | "needs_reconciliation";
  sendPrompt(input: { runId: string; sendId: string; prompt: string; retryOf?: string }): Promise<WorkerSend>;
  interrupt(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  reconcile(runId: string): WorkerSend | null;
}

/** Pure provider translation. All commands still pass policy and the dispatcher. */
export interface WorkerProtocol {
  id: string;
  installation(cwd: string): RunCommandIntent;
  authentication(cwd: string): RunCommandIntent;
  parseInstallation(result: DispatchResult): Pick<WorkerAvailability, "installed" | "version" | "failure">;
  parseAuthentication(result: DispatchResult): Pick<WorkerAvailability, "authenticated" | "failure">;
  prompt(session: WorkerSession, text: string): RunCommandIntent;
  completion(result: DispatchResult, sessionId: string): WorkerResult;
}
export interface WorkerOptions {
  role?: WorkerRole;
  ports: RuntimePorts;
  effects: EffectsGateway;
  policy: CapabilityPolicy;
  /** Host-generated UUID. The domain never generates randomness itself. */
  newSessionId(): string;
}

export class DurableWorker implements WorkerAdapter {
  get role(): WorkerRole { return this.options.role ?? "PRIMARY"; }
  readonly id: string;
  readonly sessions: WorkerStore;
  private readonly store: AutopilotStore;
  private readonly options: WorkerOptions;
  private readonly protocol: WorkerProtocol;
  private readonly active = new Set<string>();
  private readonly interrupted = new Set<string>();

  constructor(protocol: WorkerProtocol, options: WorkerOptions) {
    this.protocol = protocol; this.id = protocol.id; this.options = options;
    this.sessions = new WorkerStore(options.ports); this.store = new AutopilotStore(options.ports);
  }

  private workspace(runId: string): string {
    assertPrimary(this.options.role);
    const run = this.store.requireRun(runId);
    const cwd = run.spec.capabilities.workspaceRoot;
    if (isTerminal(run.state) || run.stopRequested) throw new Error("Worker run is stopped or terminal.");
    // Ownership decides who may implement; the spec still fixes stickiness.
    if (new OwnershipStore(this.options.ports).primaryProvider(runId, run.spec) !== this.id || !run.spec.workers.sticky) {
      throw new Error("Run must opt in to this sticky primary worker.");
    }
    if (!cwd || !this.options.policy.workspaceRoot || !samePath(cwd, this.options.policy.workspaceRoot)) {
      throw new Error("Worker cwd must match the existing run worktree and enforced policy.");
    }
    if (run.spec.projectPath && samePath(cwd, run.spec.projectPath)) throw new Error("Worker may not use the primary checkout.");
    if (evaluatePathAccess(this.options.policy, { path: cwd, mode: "write" }).decision !== "ALLOW") {
      throw new Error("Worker workspace is denied by policy.");
    }
    return cwd;
  }

  startSession(runId: string): WorkerSession {
    const cwd = this.workspace(runId);
    const existing = this.sessions.session(runId);
    if (existing) return this.resumeSession(runId);
    const sessionId = this.options.newSessionId();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error("Worker session ID must be a UUID.");
    return this.sessions.createSession({ runId, provider: this.id, sessionId, cwd, established: false });
  }

  resumeSession(runId: string): WorkerSession {
    const cwd = this.workspace(runId);
    const session = this.sessions.session(runId);
    if (!session || session.provider !== this.id || !samePath(session.cwd, cwd)) throw new Error("Worker session unavailable or workspace/provider changed.");
    // Resumption is local attachment; actual provider availability is confirmed on the next turn.
    this.store.appendEvent(runId, { type: "WORKER_SESSION_RESUMED", payload: { sessionId: session.sessionId } });
    return session;
  }

  sessionAvailability(runId: string): "missing" | "reserved" | "last_confirmed" | "needs_reconciliation" {
    const session = this.sessions.session(runId);
    if (!session) return "missing";
    const pending = this.sessions.pending(runId);
    if (pending && pending.status !== "AWAITING_APPROVAL") return "needs_reconciliation";
    // Historical evidence, not a claim that provider-side session files still exist.
    return session.established ? "last_confirmed" : "reserved";
  }

  async detect(runId: string): Promise<WorkerAvailability> {
    const cwd = this.workspace(runId);
    const probe = async (intent: RunCommandIntent) => this.options.effects.request({ runId,
      stepKey: this.options.ports.ids.next("worker-probe"), policy: this.options.policy, intent,
      diagnostics: { provider: this.protocol.id, role: "PROBE" } });
    const version = await probe(this.protocol.installation(cwd));
    if (!("result" in version)) return { installed: null, authenticated: null, version: null, failure: "policy" };
    const installed = this.protocol.parseInstallation(version.result);
    if (!installed.installed || installed.failure) return { ...installed, authenticated: null };
    const auth = await probe(this.protocol.authentication(cwd));
    if (!("result" in auth)) return { ...installed, authenticated: null, failure: "policy" };
    return { ...installed, ...this.protocol.parseAuthentication(auth.result) };
  }

  async sendPrompt(input: { runId: string; sendId: string; prompt: string; retryOf?: string }): Promise<WorkerSend> {
    const { runId, sendId, prompt } = input;
    if (!sendId.trim() || !prompt.trim() || prompt.length > 128_000) throw new Error("A bounded nonempty prompt and durable send ID are required.");
    const session = this.startSession(runId);
    const run = this.store.requireRun(runId);
    if (run.state !== "RUNNING" || run.pauseRequested) throw new Error("Worker sends require an explicitly running, unpaused run.");
    if (this.active.has(runId)) throw new Error("Worker is already working on this run.");
    const previous = this.sessions.send(sendId);
    if (previous && (previous.runId !== runId || previous.prompt !== prompt)) throw new Error("Send identity mismatch.");
    if (previous?.result && previous.status !== "UNCERTAIN") return previous;
    if (previous && previous.status !== "AWAITING_APPROVAL") {
      this.reconcile(runId);
      throw new Error("This prompt may already have been sent; reconciliation is required.");
    }
    this.active.add(runId);
    this.interrupted.delete(runId);
    try {
      this.sessions.recordIntent(runId, sendId, prompt, input.retryOf); // COMMIT before any dispatch
      const outcome = await this.options.effects.request({ runId, stepKey: `worker:${sendId}`,
        policy: this.options.policy, intent: this.protocol.prompt(session, prompt),
        diagnostics: { provider: this.protocol.id, role: "PRIMARY" },
        onWorkerSession: (providerSessionId) => {
          const current = this.store.requireRun(runId);
          if (current.state !== "RUNNING" || current.stopRequested || current.pauseRequested || this.interrupted.has(runId)) throw new Error("Worker dispatch interrupted.");
          this.sessions.bindProviderSession(runId, providerSessionId);
        },
        beforeDispatch: (operation) => {
          const current = this.store.requireRun(runId);
          if (current.state !== "RUNNING" || current.stopRequested || current.pauseRequested || this.interrupted.has(runId)) throw new Error("Worker dispatch interrupted.");
          this.sessions.update(sendId, "DISPATCHING", operation.id);
        } });
      return this.recordOutcome(runId, sendId, session, outcome);
    } catch (error) {
      const pending = this.sessions.pending(runId);
      if (pending) this.reconcile(runId);
      throw error;
    } finally { this.active.delete(runId); }
  }

  private recordOutcome(runId: string, sendId: string, session: WorkerSession, outcome: EffectOutcome): WorkerSend {
    if (outcome.status === "AWAITING_APPROVAL") {
      return this.sessions.update(sendId, "AWAITING_APPROVAL", outcome.operation.id);
    }
    let result: WorkerResult = "result" in outcome ? this.protocol.completion(outcome.result, session.sessionId) :
      { ok: false, text: "Worker command was not authorized.", failure: "policy", sessionId: session.sessionId, sessionConfirmed: false, certain: true };
    if (this.interrupted.has(runId)) result = { ...result, ok: false, failure: "interrupted", certain: false };
    // A provider can refuse a turn inside a process that exits cleanly, so the
    // classified result — not the exit status — decides whether to keep evidence.
    if (!result.ok && "result" in outcome) {
      this.options.effects.recordProviderFailure({
        runId, stepKey: `worker:${sendId}`, policy: this.options.policy,
        operationId: outcome.operation.id, scope: { provider: this.protocol.id, role: "PRIMARY" },
        failure: result.failure ?? "process", result: outcome.result
      });
    }
    const send = this.sessions.update(sendId, result.certain ? (result.ok ? "COMPLETED" : "FAILED") : "UNCERTAIN", outcome.operation.id, result);
    if (!result.certain) this.reconcile(runId);
    return this.sessions.send(send.id)!;
  }

  async interrupt(runId: string): Promise<void> {
    const send = this.sessions.pending(runId);
    if (!send) return;
    this.interrupted.add(runId);
    this.store.appendEvent(runId, { type: "WORKER_INTERRUPT_REQUESTED", payload: { sendId: send.id } });
    if (send.status === "AWAITING_APPROVAL" && send.operationId) {
      const operation = this.options.effects.operations.require(send.operationId);
      if (!operation.dispatchedAt) {
        this.store.transaction(() => {
          const approval = this.options.effects.operations.getApprovalForOperation(operation.id);
          if (approval?.status === "PENDING") this.options.effects.operations.resolveApproval({ approvalId: approval.id, status: "CANCELLED", source: "worker_interrupt" });
          this.options.effects.operations.updateStatus({ operationId: operation.id, status: "REJECTED", resultSummary: "Cancelled before worker dispatch" });
        });
        const session = this.sessions.session(runId)!;
        this.sessions.update(send.id, "CANCELLED", operation.id, { ok: false, text: "Cancelled before dispatch", failure: "interrupted",
          sessionId: session.sessionId, sessionConfirmed: false, certain: true });
        return;
      }
    }
    if (send.operationId) await this.options.effects.interruptOperation(runId, send.operationId, this.options.policy);
    // Killing does not undo a partially executed prompt. Hold it for review.
    this.reconcile(runId);
  }
  cancel(runId: string): Promise<void> { return this.interrupt(runId); }

  reconcile(runId: string): WorkerSend | null {
    const pending = this.sessions.pending(runId);
    if (!pending) return null;
    if (pending.status === "AWAITING_APPROVAL" && (!pending.operationId ||
      !this.options.effects.operations.require(pending.operationId).dispatchedAt)) return pending;
    this.sessions.update(pending.id, "UNCERTAIN", pending.operationId, pending.result);
    const run = this.store.requireRun(runId);
    if (!isTerminal(run.state) && run.state !== "STOP_REQUESTED" && run.state !== "NEEDS_REVIEW") {
      if (run.state !== "RECONCILING") this.store.appendEvent(runId, { type: "RECONCILIATION_STARTED", toState: "RECONCILING" });
      this.store.appendEvent(runId, { type: "RUN_NEEDS_REVIEW", toState: "NEEDS_REVIEW",
        reconcileReason: `Worker send ${pending.id} has no confirmed outcome.` });
    }
    return this.sessions.send(pending.id);
  }
}
