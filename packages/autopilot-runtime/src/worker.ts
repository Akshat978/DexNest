import type { RunCommandIntent } from "./intent.ts";
import type { DispatchResult } from "./dispatcher.ts";
import type { EffectsGateway, EffectOutcome } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";
import { evaluatePathAccess, ALWAYS_DENIED_ROOTS } from "./policy.ts";
import type { RuntimePorts } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import { isTerminal } from "./states.ts";
import { canonicalize, contains, samePath } from "./paths.ts";
import { WorkerStore, type WorkerSession, type WorkerSend } from "./workerStore.ts";
import { OwnershipStore } from "./handoff.ts";
import { assertPrimary, type WorkerRole } from "./roles.ts";

/**
 * What the worker is allowed to be.
 *
 * "mediated" is the original model. The worker runs with every tool disabled,
 * so it cannot read or write anything; it emits whole files as text and DexNest
 * writes them through policy. Every single side effect is therefore evaluated
 * by evaluatePathAccess before it happens.
 *
 * "agentic" gives the worker its real tools inside the workspace: it reads,
 * edits and runs the project's own commands itself. That is what makes it
 * useful on a real codebase — no context-request round-trips, no re-emitting a
 * 34 KB file to change one line — and it is a genuine reduction in mediation,
 * stated plainly here rather than buried:
 *
 *   DexNest no longer sees individual file writes. evaluatePathAccess is not
 *   consulted for them, because they never reach the EffectsGateway.
 *
 * What contains an agentic worker instead:
 *   1. cwd. File tools are confined to the working directory and DexNest adds
 *      no others, so the workspace boundary is the process boundary.
 *   2. assertAgenticWorkspace below, which refuses outright when the workspace
 *      contains a root DexNest would otherwise have denied per-write.
 *   3. An explicit tool allow-list; tools not named simply do not exist.
 *   4. The run's branch and its per-iteration checkpoints, for reversibility.
 *
 * Because 1 and 2 are the load-bearing guarantees, neither depends on a deny
 * rule being interpreted the way we hope by another process.
 */
export type WorkerCapabilityProfile = "mediated" | "agentic";

/**
 * The built-in tools an agentic worker gets. An allow-list, not a deny-list:
 * a tool absent here does not exist for the worker, and the set does not grow
 * when the CLI adds new tools. Network tools are deliberately absent — a run
 * works on the code in front of it.
 */
export const DEFAULT_AGENTIC_TOOLS: readonly string[] = ["Bash", "Edit", "Read", "Write", "Glob", "Grep", "TodoWrite"];

/**
 * Refused regardless of the allow-list. These are things whose damage outlives
 * the run's branch, so no checkpoint would undo them.
 */
export const DEFAULT_AGENTIC_DENIED: readonly string[] = [
  "Bash(git push *)",
  "Bash(git reset *)",
  "Bash(git clean *)",
  "Bash(git rebase *)",
  "Bash(rm *)",
  "Bash(rmdir *)",
  "WebFetch",
  "WebSearch"
];

/** Read-only git the worker may run without a human present. */
export const DEFAULT_AGENTIC_ALLOWED: readonly string[] = [
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)"
];

/**
 * Turns WITHIN one send, not turns of the loop grant. An agentic worker spends
 * these reading, editing and running tests before it answers once.
 */
export const DEFAULT_AGENTIC_MAX_TURNS = 30;

/** Effort the provider spends per turn. Cost and quality both scale with it. */
export type WorkerEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgenticCapabilities {
  profile: "agentic";
  tools: readonly string[];
  /** Model alias or full name. Undefined leaves the CLI's own default. */
  model?: string;
  effort?: WorkerEffort;
  /** Pre-approved invocations, so verification can run with nobody watching. */
  allowedTools: readonly string[];
  deniedTools: readonly string[];
  maxTurns: number;
}

export interface MediatedCapabilities {
  profile: "mediated";
}

export type WorkerCapabilities = AgenticCapabilities | MediatedCapabilities;

export const MEDIATED: MediatedCapabilities = { profile: "mediated" };

/**
 * Builds the agentic capability set for a run.
 *
 * Verification commands are pre-approved by name, so the worker may run exactly
 * the commands the run is judged by. Anything else still needs a decision, and
 * with no human present a decision it cannot get is a refusal, which is the
 * safe direction.
 */
export function agenticCapabilities(input: {
  verificationExecutables?: readonly string[];
  maxTurns?: number;
  extraAllowed?: readonly string[];
  model?: string;
  effort?: WorkerEffort;
} = {}): AgenticCapabilities {
  const verification = (input.verificationExecutables ?? [])
    .map((value) => value.replace(/\\/g, "/").split("/").at(-1)!.replace(/\.exe$/i, "").trim())
    .filter((name) => name && /^[A-Za-z0-9_.-]+$/.test(name))
    .map((name) => `Bash(${name} *)`);
  return {
    profile: "agentic",
    tools: [...DEFAULT_AGENTIC_TOOLS],
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    allowedTools: [...new Set([...DEFAULT_AGENTIC_ALLOWED, ...verification, ...(input.extraAllowed ?? [])])],
    deniedTools: [...DEFAULT_AGENTIC_DENIED],
    maxTurns: Math.max(1, Math.min(input.maxTurns ?? DEFAULT_AGENTIC_MAX_TURNS, 200))
  };
}

export class AgenticWorkspaceError extends Error {
  readonly rule: string;
  constructor(rule: string, message: string) {
    super(message);
    this.name = "AgenticWorkspaceError";
    this.rule = rule;
  }
}

/**
 * Refuses an agentic run whose workspace contains a root that would otherwise
 * be denied per-write.
 *
 * With tools enabled DexNest cannot stop a single write, so the only honest
 * place to enforce "never touch local-data" is before the worker starts. A
 * workspace containing such a root is refused rather than run with a deny rule
 * we would be trusting another process to honour.
 */
export function assertAgenticWorkspace(workspaceRoot: string, options: { windows?: boolean } = {}): void {
  const windows = options.windows ?? true;
  const workspace = canonicalize(workspaceRoot, { windows });
  if (!workspace.absolute) {
    throw new AgenticWorkspaceError("agentic.not-absolute", "An agentic workspace must be an absolute path.");
  }
  for (const denied of ALWAYS_DENIED_ROOTS) {
    const root = canonicalize(denied, { windows });
    if (samePath(root, workspace, windows) || contains(root, workspace, windows)) {
      throw new AgenticWorkspaceError("agentic.inside-denied-root", `An agentic worker may not run inside ${denied}.`);
    }
    if (contains(workspace, root, windows)) {
      throw new AgenticWorkspaceError(
        "agentic.contains-denied-root",
        `${workspaceRoot} contains ${denied}. With tools enabled DexNest cannot refuse an individual write, so this run must use the mediated worker instead.`
      );
    }
  }
}

/**
 * How long a provider gets to answer one prompt.
 *
 * Derived, not guessed. Worker tools are disabled, so the only way a worker can
 * change a file is to re-emit that file in full, and DexNest permits up to
 * MAX_OUTPUT_FILE_BYTES (128 KB) per file. A single medium source file is tens
 * of thousands of output tokens, which is minutes of generation.
 *
 * The first real dogfood run proved the old 120s was below what DexNest's own
 * protocol requires: turn 3 had to re-emit a 34 KB file, produced no output
 * inside the window, and was killed — leaving an uncertain send that a human had
 * to resolve by hand. A timeout must bound a hung process, not a working one.
 */
export const WORKER_PROMPT_TIMEOUT_MS = 600_000;

/** Version/auth/config probes are local and must fail fast. */
export const WORKER_PROBE_TIMEOUT_MS = 15_000;

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
  /**
   * What the provider says the turn cost, when it says anything.
   *
   * On a subscription this is an API-equivalent figure rather than a bill.
   * It is the only per-turn usage number available, so a cost budget is
   * expressed in it — and described honestly as a usage proxy.
   */
  costUsd?: number;
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
  /**
   * Opens a live output channel for a run's next send, if the host wants one.
   * Returns the sink that receives stdout as it arrives, or undefined for no
   * live view. Purely additive: a worker with no channel behaves identically.
   */
  onOutput?: (runId: string) => ((chunk: string) => void) | undefined;
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
    // A worktree run must never write to the project itself — that is the whole
    // point of the isolation. A project-branch run works in the project by
    // definition, and buys its reversibility somewhere else: a clean tree
    // before it starts, a dedicated branch, and a checkpoint commit per
    // verified piece of work.
    //
    // Applying the worktree rule to both modes refused project-branch runs
    // outright, which is exactly what it did until the first one was attempted.
    if (
      run.spec.workspaceMode !== "project-branch" &&
      run.spec.projectPath && samePath(cwd, run.spec.projectPath)
    ) {
      throw new Error("Worker may not use the primary checkout.");
    }
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
        // Visibility only, and deliberately outside every guard below: a
        // watcher must never be able to interrupt a dispatch.
        onOutput: this.options.onOutput?.(runId),
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
