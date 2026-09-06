import { evaluatePrimaryProgress, latestPrimaryProgress } from "./progress.ts";
import { ClaudeCodeWorker } from "./claudeCodeWorker.ts";
import { CodexWorker } from "./codexWorker.ts";
import type { DurableWorker } from "./worker.ts";
import { agenticCapabilities, assertAgenticWorkspace } from "./worker.ts";
import type { AutopilotEngine } from "./engine.ts";
import type { RuntimePorts } from "./ports.ts";
import { defaultCapabilityPolicy } from "./policy.ts";
import { WorkerStore, type WorkerResolutionDecision } from "./workerStore.ts";
import { LoopStore } from "./loopStore.ts";
import { ConsultantRunner, ConsultantStore, ConsultantExecutionError, type ConsultantSession } from "./consultant.ts";
import { OwnershipStore, HandoffStore, currentRoles, renderHandoffBriefing } from "./handoff.ts";
import { claudeCodeProtocol } from "./claudeCodeWorker.ts";
import { codexProtocol, codexConfigArgs } from "./codexWorker.ts";
import type { ConsultationScope } from "./consultations.ts";
import { rolesFor, type CodingProvider } from "./roles.ts";
import { AutonomousLoop } from "./loop.ts";
import { ChatDirector } from "./chatDirector.ts";
import { LiveActivity, type ActivityEvent } from "./liveActivity.ts";
import type { CapabilityPolicy } from "./policy.ts";
import { buildRunReport } from "./report.ts";
import { evaluateRecovery } from "./recovery.ts";
import { authoritativeFingerprint } from "./runSpec.ts";

export interface ControlledWorkerOptions {
  ports: RuntimePorts;
  engine: AutopilotEngine;
  executable: string;
  codexExecutable?: string;
  executableFor?: (provider: string) => string;
  newSessionId(): string;
  /** Host revalidates the existing registered worktree before every worker action. */
  validateWorkspace(runId: string): void;
  changed(runId: string): void;
}

/** Explicit desktop commands only. No scheduler, loop, fallback or automatic retry. */
export class ControlledWorkerTurns {
  readonly sessions: WorkerStore;
  private readonly options: ControlledWorkerOptions;
  private readonly workers = new Map<string, DurableWorker>();
  private readonly policies = new Map<string, CapabilityPolicy>();
  private readonly loops = new Map<string, AutonomousLoop>();
  private readonly consultants = new Map<string, ConsultantRunner>();
  private readonly directors = new Map<string, ChatDirector>();
  /**
   * What each run is doing right now, for showing a person.
   *
   * In memory and per run: the conversation is already durable in the
   * agent's own session, so keeping a second copy here would be a worse
   * transcript store. This is a window, not a record.
   */
  private readonly live: LiveActivity;
  /** Which provider each cached worker was built for, so a handoff invalidates it. */
  private readonly workerProviders = new Map<string, string>();
  private readonly active = new Set<string>();

  constructor(options: ControlledWorkerOptions) {
    this.options = options;
    this.sessions = new WorkerStore(options.ports);
    this.live = new LiveActivity(() => options.ports.clock.now(), (runId) => options.changed(runId));
  }

  /** The last few things this run did. Empty once it settles. */
  activity(runId: string): ActivityEvent[] {
    return this.live.recent(runId);
  }

  snapshot(runId: string) {
    return { session: this.sessions.session(runId), sends: this.sessions.list(runId), resolutions: this.sessions.resolutions(runId), busy: this.active.has(runId) };
  }

  /**
   * The autonomous loop for this run, bound to the same sticky worker and the
   * same per-run policy as an explicit single turn. There is no second worker
   * and no second policy: a loop turn is exactly a controlled turn whose
   * approval is resolved by the human's bounded loop grant.
   */
  loopFor(runId: string): AutonomousLoop {
    const worker = this.worker(runId);
    let loop = this.loops.get(runId);
    if (!loop) {
      loop = new AutonomousLoop({
        ports: this.options.ports,
        engine: this.options.engine,
        policy: this.policies.get(runId)!,
        worker,
        director: this.director(runId),
        changed: this.options.changed
      });
      this.loops.set(runId, loop);
    }
    return loop;
  }

  /**
   * The chat that writes assignments, when the Run Spec names one.
   *
   * Read-only by construction. It gets its own launch permission and nothing
   * else: the same policy as the implementation worker, minus any ability to
   * act, because a director proposes work and never does it. Runs with no
   * configured director return null, and a chat-directed run then holds for a
   * human rather than quietly letting the worker decide instead.
   */
  private director(runId: string): ChatDirector | null {
    const { engine, ports } = this.options;
    const cached = this.directors.get(runId);
    if (cached) return cached;

    const run = engine.store.requireRun(runId);
    const provider = run.spec.supervisor?.provider;
    if (provider !== "claude" && provider !== "codex") return null;

    // Building the worker first guarantees the workspace was validated and the
    // per-run policy exists, exactly as an implementation turn would.
    this.worker(runId);
    const policy = this.policies.get(runId)!;
    const executable = this.options.executableFor?.(provider)
      ?? (provider === "codex" ? this.options.codexExecutable : this.options.executable);
    if (!executable) throw new Error(`${provider} native installation was not found.`);
    if (!engine.effects) throw new Error("Worker platform is unavailable.");

    const directorPolicy: CapabilityPolicy = {
      ...policy,
      allowedCommands: [
        ...policy.allowedCommands,
        ...(provider === "codex" ? ["--version", "login", "mcp"] : ["--version", "auth"]).map(subcommand => ({
          executable: provider, subcommand, decision: "ALLOW" as const,
          reason: "Inspect director CLI availability", risk: "low" as const
        })),
        {
          executable: provider, subcommand: provider === "codex" ? "app-server" : "--print",
          decision: "ALLOW" as const,
          reason: "Ask the configured director what this run should do next; it has no tools and writes nothing.",
          risk: "high" as const
        }
      ]
    };

    const director = new ChatDirector({
      ports, effects: engine.effects, policy: directorPolicy, provider,
      protocol: provider === "codex" ? codexProtocol(executable) : claudeCodeProtocol(executable),
      newSessionId: this.options.newSessionId,
      cwd: run.spec.capabilities.workspaceRoot ?? ""
    });
    this.directors.set(runId, director);
    return director;
  }

  loopSnapshot(runId: string) {
    // Read-only: never constructs a worker, so a run with no workspace yet or a
    // finished run can still be inspected.
    const loop = this.loops.get(runId);
    if (loop) return loop.snapshot(runId);
    const store = new (this.loopStoreCtor())(this.options.ports);
    return { grant: store.activeGrant(runId), grants: store.grants(runId), turns: store.turns(runId), verifications: store.verifications(runId), busy: false };
  }

  /** Indirection kept tiny so loopSnapshot has no import cycle at call time. */
  private loopStoreCtor() {
    return LoopStore;
  }

  /** The durable report. Reads SQLite only, so a finished run stays reviewable. */
  report(runId: string) {
    return buildRunReport(this.options.ports, runId, (provider) => this.preflight(provider as CodingProvider));
  }

  /**
   * The single current routing recommendation. Derived, never authoritative:
   * acting on it still goes through the existing human-gated control.
   */
  recovery(runId: string) {
    return evaluateRecovery(this.options.ports, runId, (provider) => this.preflight(provider as CodingProvider));
  }

  /** Writes the report into this run's artifacts directory. */
  exportReport(runId: string) {
    const loop = this.loopFor(runId);
    const directory = this.policies.get(runId)?.scratchRoot;
    if (!directory) throw new Error("This run has no artifacts directory.");
    return loop.exportReport({ runId, directory });
  }

  /**
   * The consultant runner for this run.
   *
   * Deliberately built from the PRIMARY's policy but with the CONSULTANT's own
   * executable and protocol. It shares the effects gateway (so its one process
   * launch passes policy) and nothing else: no LoopStore, no checkpointer, no
   * PRIMARY session, no LoopGrant.
   */
  private consultant(runId: string): ConsultantRunner {
    const { engine, ports } = this.options;
    const run = engine.store.requireRun(runId);
    const roles = currentRoles(ports, runId, run.spec);
    const provider = roles.consultant as CodingProvider | null;
    if (!provider) throw new Error("This run has no configured consultant.");
    if (provider === roles.primary) throw new Error("Primary and consultant must be different providers.");

    let runner = this.consultants.get(runId);
    if (!runner) {
      // Building the PRIMARY worker first guarantees the workspace is validated
      // and the per-run policy exists, exactly as an implementation turn would.
      this.worker(runId);
      const policy = this.policies.get(runId)!;
      const executable = this.options.executableFor?.(provider)
        ?? (provider === "codex" ? this.options.codexExecutable : this.options.executable);
      if (!executable) throw new Error(`${provider} native installation was not found.`);

      // The consultant needs its own launch permission; the PRIMARY's approval
      // rule names the PRIMARY executable only.
      const consultantPolicy = {
        ...policy,
        allowedCommands: [
          ...policy.allowedCommands,
          ...(provider === "codex" ? ["--version", "login", "mcp"] : ["--version", "auth"]).map(subcommand => ({
            executable: provider, subcommand, decision: "ALLOW" as const,
            reason: "Inspect consultant CLI availability", risk: "low" as const
          })),
          {
            executable: provider, subcommand: provider === "codex" ? "app-server" : "--print",
            decision: "ALLOW" as const,
            // The human already approved this exact consultation; eligibility is
            // re-checked deterministically immediately before dispatch.
            reason: "One read-only consultant diagnosis authorized by an approved consultation",
            risk: "high" as const
          }
        ]
      };

      if (!engine.effects) throw new Error("Worker platform is unavailable.");
      runner = new ConsultantRunner({
        ports, effects: engine.effects, policy: consultantPolicy,
        protocol: provider === "codex" ? codexProtocol(executable) : claudeCodeProtocol(executable),
        newSessionId: this.options.newSessionId,
        // Codex refuses to prompt until inherited MCP servers are named and
        // disabled. Names only are kept; transports and tokens are discarded.
        ...(provider === "codex"
          ? {
              configure: async (session: ConsultantSession) => {
                const outcome = await engine.effects!.request({
                  runId, stepKey: `consultant-config:${session.sessionId}`, policy: consultantPolicy,
                  intent: {
                    kind: "RUN_COMMAND", executable, args: ["mcp", "list", "--json", ...codexConfigArgs()],
                    cwd: session.cwd, timeoutMs: 15000,
                    purpose: "Discover MCP names to disable for the consultant"
                  },
                  diagnostics: { provider: "codex", role: "CONSULTANT" as const }
                });
                if (!("result" in outcome) || !outcome.result.ok) {
                  throw new ConsultantExecutionError("consultant.configuration", "Consultant configuration could not be inspected.");
                }
                const servers: unknown = JSON.parse(outcome.result.stdout ?? "");
                if (!Array.isArray(servers) || servers.some(server => !server || typeof server.name !== "string")) {
                  throw new ConsultantExecutionError("consultant.configuration", "Consultant configuration could not be inspected.");
                }
                return servers.map(server => server.name as string);
              }
            }
          : {})
      });
      this.consultants.set(runId, runner);
    }
    return runner;
  }

  consultantSnapshot(runId: string) {
    const store = new ConsultantStore(this.options.ports);
    return { sessions: store.sessions(runId), diagnoses: store.diagnoses(runId) };
  }

  /** Executes the one diagnosis an approved consultation authorizes. */
  async runConsultation(scope: ConsultationScope) {
    if (this.active.has(scope.runId)) throw new Error("A worker action is already in progress.");
    const runner = this.consultant(scope.runId);
    this.active.add(scope.runId);
    try {
      return await runner.diagnose(scope);
    } finally {
      this.active.delete(scope.runId);
      this.options.changed(scope.runId);
    }
  }


  /** Ownership, handoffs and the incoming provider's readiness, for the UI. */
  handoffSnapshot(runId: string) {
    const store = new HandoffStore(this.options.ports);
    const ownership = new OwnershipStore(this.options.ports);
    const run = this.options.engine.store.requireRun(runId);
    const eligibility = store.eligibility(runId);
    const target = eligibility.target ?? (currentRoles(this.options.ports, runId, run.spec).consultant as CodingProvider | null);
    return {
      ownership: ownership.history(runId),
      currentPrimary: ownership.primaryProvider(runId, run.spec),
      handoffs: store.list(runId),
      open: store.open(runId),
      eligibility,
      recommendation: store.recommendation(runId),
      // Local availability only. Whether the provider has usage left is not
      // knowable without spending a call, and is deliberately not claimed here.
      preflight: target ? this.preflight(target) : null
    };
  }

  /**
   * Cheap local readiness for a provider: is it installed where we expect, and
   * is a native executable configured. It reports nothing about quota, because
   * no provider exposes that without a paid call.
   */
  preflight(provider: CodingProvider) {
    const executable = this.options.executableFor?.(provider)
      ?? (provider === "codex" ? this.options.codexExecutable : this.options.executable);
    const exists = Boolean(executable) && (this.options.ports.platform?.fs.exists(executable!) ?? false);
    return {
      provider,
      executableConfigured: Boolean(executable),
      executableFound: exists,
      availableLocally: exists,
      /** Honest: usage/quota is unknown until the provider is actually called. */
      quota: "unknown_until_provider_call" as const
    };
  }

  proposeHandoff(input: { runId: string; toProvider: CodingProvider; source: "OPERATOR" | "SYSTEM_RECOMMENDED"; reason?: string }) {
    if (this.active.has(input.runId)) throw new Error("A handoff cannot be proposed now: primary_turn_in_flight.");
    return new HandoffStore(this.options.ports).propose({ ...input, requestedBy: "desktop_ui" });
  }

  resolveHandoff(input: { runId: string; handoffId: string; toProvider: CodingProvider; decision: "APPROVED" | "CANCELLED" }) {
    return new HandoffStore(this.options.ports).resolve({ ...input, source: "desktop_ui" });
  }

  /**
   * Activates an approved handoff.
   *
   * The ownership swap, the session replacement and the new grant commit in one
   * transaction, so a crash can only leave the run with the old owner or the new
   * one — never with both, and never with an owner that has no authorization.
   *
   * The outgoing session is captured into ownership history rather than deleted:
   * autopilot_worker_sends references autopilot_worker_sessions(run_id), and
   * deleting that row would cascade away the previous owner's send history.
   */
  activateHandoff(input: { runId: string; handoffId: string; toProvider: CodingProvider; maxTurns: number; grantedBy: string }) {
    if (this.active.has(input.runId)) throw new Error("A worker action is already in progress.");
    const { ports, engine } = this.options;
    const handoffs = new HandoffStore(ports);
    const ownership = new OwnershipStore(ports);
    const sessions = new WorkerStore(ports);

    handoffs.reconcile(input.runId);
    const record = handoffs.list(input.runId).find(entry => entry.id === input.handoffId);
    if (!record) throw new Error("Handoff does not belong to this run.");
    if (record.toProvider !== input.toProvider) throw new Error("Handoff target mismatch.");
    if (!record.canActivate) {
      throw new Error(record.fresh ? "Handoff is not approved for activation." : "Handoff evidence is stale; propose a fresh handoff.");
    }

    const run = engine.store.requireRun(input.runId);
    // TOCTOU: what is about to change must be exactly what was approved.
    if (authoritativeFingerprint(run.spec) !== record.specFingerprint) throw new Error("The Run Spec changed after this handoff was approved.");
    if ((run.spec.capabilities.workspaceRoot ?? "") !== record.workspaceRoot) throw new Error("The workspace changed after this handoff was approved.");
    if (ownership.primaryProvider(input.runId, run.spec) !== record.fromProvider) throw new Error("Ownership changed after this handoff was approved.");
    if (sessions.pending(input.runId)) throw new Error("A PRIMARY send is unsettled; resolve it before changing ownership.");

    const outgoing = sessions.session(input.runId);
    const newSessionId = this.options.newSessionId();

    const activated = engine.store.transaction(() => {
      // Journal the intent first, so a crash from here on is reconcilable.
      handoffs.beginActivationUnsafe(input.handoffId);
      engine.store.appendEventUnsafe(input.runId, run.state, {
        type: "HANDOFF_ACTIVATING",
        payload: { handoffId: input.handoffId, fromProvider: record.fromProvider, toProvider: record.toProvider }
      });

      // Close the outgoing ownership period, capturing the session it held.
      ownership.bootstrapUnsafe(input.runId);
      ownership.retireUnsafe(input.runId, outgoing
        ? { sessionId: outgoing.sessionId, providerSessionId: outgoing.providerSessionId ?? null, cwd: outgoing.cwd, established: outgoing.established }
        : null);

      // The incoming owner gets a fresh PRIMARY session identity of its own. A
      // CONSULTANT session is never promoted; that table is untouched.
      sessions.replacePrimaryUnsafe({
        runId: input.runId, provider: record.toProvider, sessionId: newSessionId,
        cwd: run.spec.capabilities.workspaceRoot!
      });
      ownership.openUnsafe({
        runId: input.runId, provider: record.toProvider, handoffId: input.handoffId,
        sessionId: newSessionId, cwd: run.spec.capabilities.workspaceRoot, established: false
      });

      // The outgoing owner's grant dies with its ownership; the incoming owner
      // gets its own bounded authorization.
      const loops = new LoopStore(ports);
      loops.close(input.runId, "ownership_handoff");
      const grant = loops.grant({
        runId: input.runId, provider: record.toProvider, sessionId: newSessionId,
        workspaceRoot: run.spec.capabilities.workspaceRoot!, maxTurns: input.maxTurns, grantedBy: input.grantedBy
      });

      handoffs.completeActivationUnsafe(input.handoffId, newSessionId);
      engine.store.appendEventUnsafe(input.runId, run.state, {
        type: "PRIMARY_OWNERSHIP_CHANGED",
        payload: {
          handoffId: input.handoffId, fromProvider: record.fromProvider, toProvider: record.toProvider,
          fromSessionId: outgoing?.sessionId ?? null, toSessionId: newSessionId, grantId: grant.id
        }
      });
      engine.store.appendEventUnsafe(input.runId, run.state, {
        type: "HANDOFF_ACTIVATED",
        payload: { handoffId: input.handoffId, toProvider: record.toProvider, toSessionId: newSessionId }
      });
      return { grant };
    });

    // The cached worker/policy/loop belonged to the previous owner.
    this.workers.delete(input.runId);
    this.policies.delete(input.runId);
    this.loops.delete(input.runId);
    this.consultants.delete(input.runId);
    this.workerProviders.delete(input.runId);
    this.options.changed(input.runId);

    return { handoff: handoffs.list(input.runId).find(entry => entry.id === input.handoffId)!, grant: activated.grant };
  }

  authorizeLoop(input: {
    runId: string; maxTurns: number; maxIterations?: number;
    stopAt?: string; maxCostUsd?: number; maxIdleTurns?: number;
    grantedBy: string;
  }) {
    if (this.active.has(input.runId)) throw new Error("A worker action is already in progress.");
    return this.loopFor(input.runId).authorize(input);
  }

  revokeLoop(runId: string, reason?: string) {
    return this.loopFor(runId).revoke(runId, reason);
  }

  /** Runs authorized turns until the loop settles. */
  /**
   * retryProviderLimit is the deliberate answer to a run paused for a usage
   * limit or a stale login. Passed straight through: the loop is the thing that
   * knows whether such a hold exists, and only a caller that decided to retry
   * ever sets it.
   */
  async runLoop(runId: string, options: { retryProviderLimit?: boolean } = {}) {
    if (this.active.has(runId)) throw new Error("A worker action is already in progress.");
    const loop = this.loopFor(runId);
    this.active.add(runId);
    try {
      const progress = latestPrimaryProgress(this.options.ports, runId);
      if (progress && progress.status !== "PROGRESSING") return await loop.run(runId, options);
      const available = await this.worker(runId).detect(runId);
      if (!available.installed || !available.authenticated || available.failure) {
        evaluatePrimaryProgress(this.options.ports, runId, available.failure ?? "auth");
        throw new Error(`PRIMARY unavailable: ${available.failure ?? "auth"}`);
      }
      return await loop.run(runId, options);
    } finally {
      this.active.delete(runId);
      this.options.changed(runId);
    }
  }

  private worker(runId: string): DurableWorker {
    const { engine, ports } = this.options;
    const run = engine.store.requireRun(runId);
    // Ownership, not the Run Spec, decides who may implement. The spec stays
    // authoritative and unchanged; a handoff moves ownership beside it.
    const provider = new OwnershipStore(ports).primaryProvider(runId, run.spec);
    const executable = this.options.executableFor?.(provider) ?? (provider === "codex" ? this.options.codexExecutable : this.options.executable);
    if (!executable) throw new Error(`${provider} native installation was not found.`);
    if (!["claude", "codex"].includes(provider) || !run.spec.workers.sticky || run.spec.workers.fallback) throw new Error("Explicit sticky worker selection with no fallback is required.");
    this.options.validateWorkspace(runId);
    // A handoff retires the cached worker, policy and loop for this run so the
    // next turn is built for the incoming owner.
    if (this.workerProviders.get(runId) !== provider) {
      this.workers.delete(runId);
      this.policies.delete(runId);
      this.loops.delete(runId);
      this.consultants.delete(runId);
    }
    let worker = this.workers.get(runId);
    if (!worker) {
      const policy = defaultCapabilityPolicy();
      policy.workspaceRoot = run.spec.capabilities.workspaceRoot;
      // Run artifacts (the exported report) live in a sibling directory, never
      // inside the worktree — an export must not appear as a source change and
      // must not be swept into a checkpoint commit.
      policy.scratchRoot = policy.workspaceRoot ? `${policy.workspaceRoot}-autopilot-artifacts` : null;
      policy.denyRoots.push(...run.spec.capabilities.forbiddenPaths.filter(path => path !== "local-data"));
      for (const command of run.spec.capabilities.forbiddenCommands) {
        const [executable, subcommand] = command.trim().split(/\s+/);
        if (executable) policy.deniedCommands.push({ executable, subcommand, decision: "DENY", reason: "Forbidden by this Run Spec", risk: "high" });
      }
      policy.allowedCommands = (provider === "codex" ? ["--version", "login", "mcp"] : ["--version", "auth"]).map(subcommand => ({ executable: provider, subcommand, decision: "ALLOW" as const, reason: "Inspect subscription CLI availability", risk: "low" as const }));
      for (const command of Object.values(run.spec.verification.structuredCommands ?? {})) {
        policy.allowedCommands.push({ executable: command.executable.replace(/\\/g, "/").split("/").at(-1)!.replace(/\.exe$/i, ""), subcommand: command.args[0] ?? "", decision: "ALLOW", reason: "Human-configured structured verification", risk: "low" });
      }
      // Only Claude has an agentic profile so far; Codex stays mediated until
      // it is a writer at all.
      const agentic = run.spec.workerProfile === "agentic" && provider === "claude";
      if (agentic) {
        // Refuse before the worker exists, not after it has written something.
        assertAgenticWorkspace(run.spec.capabilities.workspaceRoot ?? "");
      }
      policy.approvalCommands.push({
        executable: provider,
        subcommand: provider === "codex" ? "app-server" : "--print",
        decision: "REQUIRE_APPROVAL",
        reason: agentic
          ? `Send this saved prompt to ${provider} using the existing subscription. Tools are ENABLED: it may read, edit and run commands inside the workspace on its own.`
          : `Send this saved prompt to ${provider} using the existing subscription; tools are disabled.`,
        risk: "high"
      });
      if (!engine.effects) throw new Error("Worker platform is unavailable.");
      const Adapter = provider === "codex" ? CodexWorker : ClaudeCodeWorker;
      worker = new Adapter({
        ports, effects: engine.effects, policy, executable, newSessionId: this.options.newSessionId,
        // A fresh window per send, so the panel shows this turn and not the
        // last one. Purely additive; a worker with no channel is unchanged.
        onOutput: (id: string) => this.live.begin(id),
        ...(agentic
          ? {
              capabilities: agenticCapabilities({
                verificationExecutables: Object.values(run.spec.verification.structuredCommands ?? {}).map(command => command.executable),
                ...(run.spec.model ? { model: run.spec.model } : {}),
                ...(run.spec.effort ? { effort: run.spec.effort as "low" | "medium" | "high" | "xhigh" | "max" } : {})
              })
            }
          : {})
      });
      this.workers.set(runId, worker);
      this.policies.set(runId, policy);
      this.workerProviders.set(runId, provider);
    }
    return worker;
  }

  private running(runId: string): void {
    const store = this.options.engine.store;
    const run = store.requireRun(runId);
    if (!["READY", "PAUSED", "AWAITING_APPROVAL"].includes(run.state) || run.stopRequested) throw new Error(`Cannot prepare/send a worker turn from ${run.state}.`);
    store.appendEvent(runId, { type: "RUN_RESUMED", toState: "RUNNING", pauseRequested: false, reconcileReason: null });
    this.options.changed(runId);
  }

  private hold(runId: string): void {
    const store = this.options.engine.store;
    let run = store.requireRun(runId);
    if (run.state === "RUNNING") {
      if (this.sessions.pending(runId)?.status === "AWAITING_APPROVAL") {
        store.appendEvent(runId, { type: "APPROVAL_REQUESTED", toState: "AWAITING_APPROVAL" });
        return;
      }
      store.appendEvent(runId, { type: "PAUSE_REQUESTED", toState: "PAUSE_REQUESTED" });
      run = store.requireRun(runId);
    }
    if (run.state === "PAUSE_REQUESTED") store.appendEvent(runId, { type: "RUN_PAUSED", toState: "PAUSED", pauseRequested: false });
  }

  private async exclusive<T>(runId: string, task: () => Promise<T>): Promise<T> {
    if (this.active.has(runId)) throw new Error("A worker action is already in progress.");
    this.active.add(runId);
    try { return await task(); }
    finally {
      try { this.hold(runId); }
      finally { this.active.delete(runId); this.options.changed(runId); }
    }
  }

  /** Journals the exact prompt and requests approval. Never grants it. */
  prepare(input: { runId: string; prompt: string; retryOf?: string }) {
    return this.exclusive(input.runId, async () => {
      if (this.sessions.pending(input.runId)) throw new Error("Resolve or cancel the existing send first.");
      if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 128_000) throw new Error("A nonempty prompt of at most 128000 characters is required.");
      if (input.retryOf && this.sessions.list(input.runId).some(s => s.retryOf === input.retryOf)) throw new Error("This safe retry has already been used.");
      const worker = this.worker(input.runId);
      this.running(input.runId);
      worker.startSession(input.runId);
      const availability = await worker.detect(input.runId);
      if (!availability.installed || !availability.authenticated || availability.failure) throw new Error(`${worker.id} unavailable: ${availability.failure ?? "auth"}. No prompt sent.`);
      return worker.sendPrompt({ ...input, sendId: this.options.ports.ids.next("worker-send") });
    });
  }

  /** Dispatches only the persisted prompt. A repeat call cannot allocate another send. */
  approveAndSend(input: { runId: string; sendId: string }) {
    return this.exclusive(input.runId, async () => {
      const send = this.sessions.send(input.sendId);
      if (!send || send.runId !== input.runId) throw new Error("Send does not belong to this run.");
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(send.status)) return send;
      if (send.status !== "AWAITING_APPROVAL" || !send.operationId) throw new Error("This send requires reconciliation; it cannot be resent.");
      const worker = this.worker(input.runId);
      const operations = this.options.engine.effects!.operations;
      const operation = operations.require(send.operationId);
      if (operation.dispatchedAt || operation.status === "UNCERTAIN") {
        this.sessions.update(send.id, "UNCERTAIN", operation.id, send.result);
        worker.reconcile(input.runId);
        throw new Error("Dispatch may have occurred. Human resolution is required.");
      }
      const approval = operations.getApprovalForOperation(operation.id);
      if (!approval || !["PENDING", "APPROVED"].includes(approval.status)) throw new Error("This prompt approval is unavailable or rejected. Cancel it to proceed.");
      this.running(input.runId);
      this.options.engine.resolveApproval({ approvalId: approval.id, decision: "APPROVED", source: "desktop_ui" });
      const result = worker.sendPrompt({ runId: input.runId, sendId: send.id, prompt: send.prompt });
      this.options.changed(input.runId);
      return result;
    });
  }

  resolve(input: { runId: string; sendId: string; decision: WorkerResolutionDecision; evidence: string }): void {
    if (this.active.has(input.runId)) throw new Error("Wait for the owned worker to stop before resolving this send.");
    this.sessions.resolve(input);
    this.options.changed(input.runId);
  }

  async interrupt(runId: string): Promise<void> {
    // Cached adapter retains the live owned process identity, even if cwd disappeared.
    const worker = this.workers.get(runId) ?? this.worker(runId);
    await worker.interrupt(runId);
    if (!this.active.has(runId)) {
      const store = this.options.engine.store;
      if (store.requireRun(runId).state === "AWAITING_APPROVAL") store.appendEvent(runId, { type: "RUN_PAUSED", toState: "PAUSED" });
    }
    this.options.changed(runId);
  }
}
