// Autopilot host: the trusted Electron-side bridge for the Autopilot runtime.
//
// This file is deliberately thin. It supplies the runtime's injected ports,
// registers trusted desktop IPC, and relays change notifications. Controlled
// worker-turn orchestration lives in @dexnest/autopilot-runtime.
//
// Phase 1 hosts the runtime inside the Electron main process. Because the
// runtime has zero Electron imports and reaches the outside world only through
// the ports assembled below, moving it into a dedicated child process later is a
// change to this file, not to the runtime.

import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMain } from "electron";

import { createAutopilotPlatformPorts } from "./autopilotPlatform.ts";
import { claudeExecutable, codexExecutable, validateClaudeWorkspace } from "./autopilotWorkerConfig.ts";
import { PushSender } from "./push.ts";
import { openPairing } from "./companionApi.ts";
import {
  AutopilotEngine,
  ControlledWorkerTurns,
  SessionDiscovery,
  RunQueueStore,
  QUEUE_OUTCOME,
  AttentionStore,
  attentionStands,
  DeviceStore,
  AutopilotControlCenter,
  ConsultationStore,
  DirectionAuthorityStore,
  UnattendedStore,
  buildMorningSummary,
  HandoffStore,
  type ConsultationScope,
  type NewRunForm,
  type LoopStopReason,
  type PlatformPorts,
  type WorkerResolutionDecision,
  MemorySideEffectLedger,
  defaultEnforcedCapabilityPolicy,
  runAutopilotMigrations,
  ScriptedExecutor,
  type RunSpecInput,
  type RuntimePorts,
  type SqlDatabase,
  type SqlStatement,
  type ApprovalRecord,
  type EnforcedCapabilityPolicy,
  type UncertainResolution
} from "@dexnest/autopilot-runtime";

/**
 * The slice of better-sqlite3 this host uses. Declared structurally rather than
 * imported so the main process does not depend on that package's type
 * declarations, which live in another workspace package.
 */
export interface BetterSqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(params?: Record<string, unknown>): { changes?: number | bigint };
    get(params?: Record<string, unknown>): unknown;
    all(params?: Record<string, unknown>): unknown[];
  };
}

/**
 * Adapts the app's existing better-sqlite3 connection to the runtime's
 * SqlDatabase port. Autopilot tables live in the same dexnest.sqlite as
 * event_log; there is no second database.
 */
export function createBetterSqliteAdapter(db: BetterSqliteLike): SqlDatabase {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const statement = db.prepare(sql);
      return {
        run(params?: Record<string, unknown>) {
          const result = params ? statement.run(params) : statement.run();
          return { changes: Number(result.changes ?? 0) };
        },
        get<T>(params?: Record<string, unknown>) {
          return (params ? statement.get(params) : statement.get()) as T | undefined;
        },
        all<T>(params?: Record<string, unknown>) {
          return (params ? statement.all(params) : statement.all()) as T[];
        }
      };
    }
  };
}

export interface AutopilotHostOptions {
  /** Trusted host injection, also used by the fake-process integration harness. */
  platform?: PlatformPorts;
  claudeExecutable?: string;
  codexExecutable?: string;
  /** The app's live better-sqlite3 handle. */
  database: BetterSqliteLike;
  ipcMain: IpcMain;
  /** Resolves the window to push change notifications to, if one exists. */
  getWindow: () => BrowserWindow | null;
  /** Writes into the existing DexNest event log for the Audit view. */
  logEvent?: (summary: string, metadata: Record<string, unknown>) => void;
  /** Shows the operator a native notification. Injected, so this file stays testable. */
  notify?: (message: { title: string; body: string }) => void;
  /**
   * Where push settings live, and how to read and write them.
   *
   * Injected rather than resolved here: the path is under the app's data root,
   * which this file deliberately knows nothing about. The settings hold the
   * PATH to a service account, never its contents — the credential is read at
   * the moment of sending and never copied anywhere.
   */
  readPushSettings?: () => PushSettings;
  writePushSettings?: (settings: PushSettings) => void;
}

export interface PushSettings {
  /** Absolute path to the Firebase service account JSON. */
  serviceAccountPath: string;
  /** e.g. "dexnest-f1036". */
  projectId: string;
  /** Local wall-clock, e.g. "23:00". */
  quietStart: string;
  quietEnd: string;
  /** Send notifications to phones at all. Off until a device is registered. */
  enabled: boolean;
  /**
   * The quietest thing worth waking a phone for.
   *
   * Everything the engine decides still reaches the desktop panel and the
   * phone's Today list; this only decides what is *pushed*. INFO means every
   * finished run buzzes; ATTENTION means only things that changed the night.
   */
  minPushPriority?: "INFO" | "ATTENTION" | "ACTION_REQUIRED";
}

const PRIORITY_RANK: Record<string, number> = { INFO: 0, ATTENTION: 1, ACTION_REQUIRED: 2, URGENT: 3 };

export interface AutopilotHost {
  engine: AutopilotEngine;
  workers: ControlledWorkerTurns;
  /** Devices DexNest may speak to, and which of them may speak back. */
  devices: DeviceStore;
  /** What needs a person — the same decision the desktop panel shows. */
  attentionSnapshot: () => { deliver: unknown[]; hold: unknown[]; reason: unknown[]; summary: string };
  /** Puts an attention group off until a time. */
  snoozeAttention: (input: { groupKey: string; question: string; until: string; runId?: string }) => void;
  /** Runs in the shape a phone screen needs, not the desk-sized report. */
  runsForPhone: () => Array<Record<string, unknown>>;
  /** Pending approvals across all runs, for the UI and the Stream Deck. */
  pendingApprovals: () => ApprovalRecord[];
  /** Resolves one approval. The only granter of gated authority. */
  resolveApproval: (input: { approvalId: string; decision: "APPROVED" | "REJECTED"; source: string }) => ApprovalRecord;
  /**
   * The few things a phone may do.
   *
   * A deliberately short list, and it is short because runs are started at the
   * desk. Everything here either answers a question the run already asked or
   * stops it — nothing here begins work, spends money, or changes a plan.
   *
   * Each goes through the same engine call the desktop button uses and
   * journals with "phone" as its origin, so the audit view shows where a
   * decision actually came from rather than attributing it to the desk.
   */
  control: {
    pause: (runId: string) => void;
    resume: (runId: string) => Promise<void>;
    approve: (approvalId: string, decision: "APPROVED" | "REJECTED") => ApprovalRecord;
    acceptPlanComplete: (runId: string) => void;
    rejectPlanComplete: (runId: string, reason: string) => void;
  };
  /** Reconciles any run left mid-flight by a previous crash. */
  recover: () => Promise<void>;
  dispose: () => void;
}

/**
 * Scripted runs retain the deterministic Phase 1 executor. Claude runs use
 * ControlledWorkerTurns and can never enter this executor's loop.
 */
function createPhase1Executor(): ScriptedExecutor {
  return new ScriptedExecutor({
    steps: [
      { key: "prepare-workspace", behaviour: { kind: "succeed", summary: "Workspace prepared (simulated)" } },
      { key: "apply-change", behaviour: { kind: "succeed", summary: "Change applied (simulated)" } },
      { key: "verify-change", behaviour: { kind: "succeed", summary: "Verification passed (simulated)" } },
      { key: "record-evidence", behaviour: { kind: "succeed", summary: "Evidence recorded (simulated)" } }
    ],
    // In-process ledger: Phase 1's simulated steps have no external side effect
    // that could outlive a restart. A real worker adapter supplies durable
    // evidence (git state, session transcript) in a later phase.
    ledger: new MemorySideEffectLedger()
  });
}

export function createAutopilotHost(options: AutopilotHostOptions): AutopilotHost {
  // Scripted runs retain the default denial policy. The controlled worker owns
  // a run-specific policy permitting only probes and individually gated prompts.
  const policy: EnforcedCapabilityPolicy = defaultEnforcedCapabilityPolicy();

  const ports: RuntimePorts = {
    platform: options.platform ?? createAutopilotPlatformPorts(),
    db: createBetterSqliteAdapter(options.database),
    clock: { now: () => new Date().toISOString() },
    ids: { next: (prefix: string) => `${prefix}-${randomUUID()}` },
    logger: {
      log(level, message, context) {
        if (level === "error" || level === "warn") {
          console.warn(`[autopilot] ${message}`, context ?? "");
        }
      }
    }
  };

  runAutopilotMigrations(ports.db, new Date().toISOString());

  const engine = new AutopilotEngine({ ports, executor: createPhase1Executor(), policy });

  // Event-driven only. Autopilot adds no timers and no polling loops, so it is
  // dormant when no run is active (AGENTS.md idle-resource rule).
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let queueTimer: ReturnType<typeof setTimeout> | null = null;

  const changed = (runId: string) => {
    const window = options.getWindow();
    if (window && !window.isDestroyed()) {
      try { window.webContents.send("dexnest:autopilot-changed", { runId }); }
      catch { ports.logger.log("warn", "Autopilot renderer notification unavailable", { runId }); }
    }
  };
  const unsubscribe = engine.onChange(changed);
  const executable = options.claudeExecutable ?? claudeExecutable(ports.platform!);
  const codexNative = options.codexExecutable ?? codexExecutable(ports.platform!);
  const workers = new ControlledWorkerTurns({ engine, ports, executable, codexExecutable: codexNative, newSessionId: randomUUID,
    executableFor: provider => provider === "claude" ? options.claudeExecutable ?? claudeExecutable(ports.platform!) : options.codexExecutable ?? codexExecutable(ports.platform!),
    validateWorkspace: runId => validateClaudeWorkspace(ports.platform!, engine.store.requireRun(runId).spec), changed,
    // Metadata only, and never credentials: the reader is pointed at the
    // transcript store and knows nothing about auth files sitting beside it.
    sessionDiscovery: new SessionDiscovery({ fs: ports.platform!.fs, env: ports.platform!.env, now: () => ports.clock.now() }) });
  let recovered = false;
  const center = new AutopilotControlCenter({ ports, engine, workers, executable: provider => provider === "claude" ? options.claudeExecutable ?? claudeExecutable(ports.platform!) : options.codexExecutable ?? codexExecutable(ports.platform!) });
  const consultations = new ConsultationStore(ports);
  const launchPrimary = (runId: string) => {
    void workers.runLoop(runId).catch(async (error: unknown) => {
      const run = engine.store.requireRun(runId);
      const reason = error instanceof Error && /^PRIMARY unavailable: [a-z_]+$/.test(error.message) ? error.message : "PRIMARY could not start. Check provider readiness and the registered worktree.";
      if (["READY", "PAUSED"].includes(run.state)) engine.store.appendEvent(runId, { type: "RUN_FAILED", toState: "FAILED", failureReason: reason });
      else if (!["FAILED", "STOPPED", "COMPLETED", "NEEDS_REVIEW"].includes(run.state)) await engine.reconcile(runId);
      options.logEvent?.("Autopilot PRIMARY halted; review required", { runId });
      changed(runId);
    });
  };

  const { ipcMain } = options;
  const channels: string[] = [];
  const handle: IpcMain["handle"] = (channel, listener) => {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = options.getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Autopilot requires the trusted desktop main frame.");
      if (!recovered) throw new Error("Autopilot recovery is not complete.");
      return listener(event, ...args);
    });
  };

  handle("dexnest:autopilot-worker-config", () => ({ provider: "claude", executable, executables: { claude: executable, codex: codexNative }, toolsEnabled: false }));
  handle("dexnest:autopilot-dashboard", () => center.dashboard());
  for (const decision of ["APPROVED", "CANCELLED"] as const) {
    const action = decision === "APPROVED" ? "approve" : "cancel";
    handle(`dexnest:autopilot-consultation-${action}`, (_event, scope: ConsultationScope) => {
      const result = consultations.resolve({ runId: scope.runId, requestId: scope.requestId,
        consultantProvider: scope.consultantProvider, decision, source: "desktop_ui" });
      options.logEvent?.(`Autopilot consultation ${decision.toLowerCase()}`, {
        actionId: `autopilot.consultation_${action}`, runId: result.runId, requestId: result.id,
        consultantProvider: result.consultantProvider, diagnosisLimit: 1
      });
      changed(result.runId);
      return result;
    });
  }
  // Ownership handoff. Three explicit human steps: propose, approve, activate.
  handle("dexnest:autopilot-handoff-propose", (_event, input: { runId: string; toProvider: "claude" | "codex"; reason?: string }) => {
    const result = workers.proposeHandoff({ runId: input.runId, toProvider: input.toProvider, source: "OPERATOR", reason: input.reason });
    options.logEvent?.("Autopilot handoff proposed", { actionId: "autopilot.handoff_propose", runId: result.runId,
      handoffId: result.id, fromProvider: result.fromProvider, toProvider: result.toProvider });
    changed(result.runId);
    return result;
  });
  for (const decision of ["APPROVED", "CANCELLED"] as const) {
    const action = decision === "APPROVED" ? "approve" : "cancel";
    handle(`dexnest:autopilot-handoff-${action}`, (_event, scope: { runId: string; handoffId: string; toProvider: "claude" | "codex" }) => {
      const result = workers.resolveHandoff({ ...scope, decision });
      options.logEvent?.(`Autopilot handoff ${decision.toLowerCase()}`, { actionId: `autopilot.handoff_${action}`,
        runId: result.runId, handoffId: result.id, toProvider: result.toProvider });
      changed(result.runId);
      return result;
    });
  }
  handle("dexnest:autopilot-handoff-activate", (_event, input: { runId: string; handoffId: string; toProvider: "claude" | "codex"; maxTurns: number }) => {
    const result = workers.activateHandoff({ ...input, grantedBy: "desktop_ui" });
    options.logEvent?.("Autopilot PRIMARY ownership changed", { actionId: "autopilot.handoff_activate", runId: input.runId,
      handoffId: result.handoff.id, fromProvider: result.handoff.fromProvider, toProvider: result.handoff.toProvider,
      newSessionId: result.handoff.toSessionId, grantId: result.grant.id, maxTurns: result.grant.maxTurns });
    changed(input.runId);
    return result;
  });

  // Moving who decides what happens next. State only: no process, no prompt,
  // no grant consumption. It takes effect at the next iteration boundary, so a
  // turn already in flight finishes under the decider it started with.
  handle("dexnest:autopilot-direction-switch", (_event, input: { runId: string; source: "self" | "chat"; reason: string }) => {
    if (workers.snapshot(input.runId).busy) throw new Error("Direction cannot be switched while a turn is in flight.");
    const record = new DirectionAuthorityStore(ports).switchTo({
      runId: input.runId, source: input.source, reason: input.reason, changedBy: "desktop_ui"
    });
    options.logEvent?.("Autopilot direction source changed", {
      actionId: "autopilot.direction_switch", runId: input.runId, source: input.source
    });
    changed(input.runId);
    return record;
  });

  // A human asking for a second opinion. Creates request state only: no
  // consultant process, no approval, no PRIMARY turn, no grant consumption.
  handle("dexnest:autopilot-consultation-request", (_event, input: { runId: string; consultantProvider: "claude" | "codex" }) => {
    if (workers.snapshot(input.runId).busy) throw new Error("A second opinion cannot be requested now: primary_turn_in_flight.");
    const result = consultations.requestOperator({ runId: input.runId, consultantProvider: input.consultantProvider, source: "desktop_ui" });
    options.logEvent?.("Autopilot operator requested a second opinion", {
      actionId: "autopilot.consultation_request", runId: result.runId, requestId: result.id,
      consultantProvider: result.consultantProvider, trigger: result.triggerType
    });
    changed(result.runId);
    return result;
  });

  // One read-only diagnosis, authorized by the already-approved consultation.
  // Eligibility is re-checked deterministically inside the runner immediately
  // before dispatch; this handler grants nothing on its own.
  handle("dexnest:autopilot-consultation-run", async (_event, scope: ConsultationScope) => {
    const diagnosis = await workers.runConsultation(scope);
    options.logEvent?.(`Autopilot consultant diagnosis ${diagnosis.status.toLowerCase()}`, {
      actionId: "autopilot.consultation_run", runId: scope.runId, requestId: scope.requestId,
      consultantProvider: diagnosis.consultantProvider, status: diagnosis.status,
      failure: diagnosis.failure, refusedFileBlocks: diagnosis.refusedFileBlocks
    });
    changed(scope.runId);
    return diagnosis;
  });

  handle("dexnest:autopilot-readiness", async (_event, project: string) => {
    const result = await center.detect(project);
    options.logEvent?.("Autopilot provider readiness checked", { actionId: "autopilot.readiness" });
    return result;
  });
  /**
    * start:false creates the run without taking the first turn.
    *
    * Needed because the first turn opens a session, and a run that has a
    * session can never adopt one — which made the whole of phase 16 reachable
    * only in tests. Someone who primed a conversation in their editor has to be
    * able to create the run, attach it, and only then start.
    */
  handle("dexnest:autopilot-rerun-form", (_event, runId: string) => center.rerunForm(runId));
  handle("dexnest:autopilot-create-automation", async (_event, form: NewRunForm, input?: { start?: boolean }) => {
    const run = await center.create(form);
    const start = input?.start !== false;
    options.logEvent?.("Autopilot coding automation created", { actionId: "autopilot.create_automation", runId: run.id, started: start });
    if (start) launchPrimary(run.id);
    return run;
  });
  handle("dexnest:autopilot-run-primary", (_event, runId: string) => {
    const state = engine.store.requireRun(runId).state;
    if (!["READY", "PAUSED"].includes(state)) throw new Error("Primary can start or resume only from READY or PAUSED.");
    if (!workers.loopSnapshot(runId).grant) throw new Error("Authorize a bounded PRIMARY grant before resuming.");
    options.logEvent?.("Autopilot PRIMARY resumed", { actionId: "autopilot.loop_run", runId });
    launchPrimary(runId);
  });
  handle("dexnest:autopilot-worker-prepare", async (_event, input: { runId: string; prompt: string; retryOf?: string }) => {
    const send = await workers.prepare(input);
    options.logEvent?.("Autopilot worker prompt prepared for review", { actionId: "autopilot.worker_prepare", runId: input.runId, sendId: send.id });
    return send;
  });
  handle("dexnest:autopilot-worker-send", async (_event, input: { runId: string; sendId: string }) => {
    options.logEvent?.("Autopilot human requested one worker send", { actionId: "autopilot.worker_send", runId: input.runId, sendId: input.sendId });
    const send = await workers.approveAndSend(input);
    options.logEvent?.("Autopilot controlled worker turn settled", { runId: input.runId, sendId: send.id, status: send.status, failure: send.result?.failure ?? null });
    return send;
  });
  handle("dexnest:autopilot-worker-resolve", (_event, input: { runId: string; sendId: string; decision: WorkerResolutionDecision; evidence: string }) => {
    workers.resolve(input);
    options.logEvent?.("Autopilot worker send resolved by human", { actionId: "autopilot.worker_resolve", runId: input.runId, sendId: input.sendId, decision: input.decision });
  });
  handle("dexnest:autopilot-worker-interrupt", async (_event, runId: string) => {
    await workers.interrupt(runId);
    options.logEvent?.("Autopilot owned worker interrupted", { actionId: "autopilot.worker_interrupt", runId });
  });

  // --- autonomous loop -----------------------------------------------------
  // Authorizing is a human act with an explicit turn budget. Running consumes
  // that budget one turn at a time; each turn still creates its own approval.
  handle("dexnest:autopilot-loop-authorize", (_event, input: { runId: string; maxTurns: number }) => {
    const grant = workers.authorizeLoop({ runId: input.runId, maxTurns: input.maxTurns, grantedBy: "desktop_ui" });
    options.logEvent?.(`Autopilot loop authorized for ${grant.maxTurns} turn(s)`, {
      actionId: "autopilot.loop_authorize", runId: input.runId, grantId: grant.id, provider: grant.provider, maxTurns: grant.maxTurns
    });
    return grant;
  });
  handle("dexnest:autopilot-loop-revoke", (_event, runId: string) => {
    const grant = workers.revokeLoop(runId);
    options.logEvent?.("Autopilot loop authorization revoked", { actionId: "autopilot.loop_revoke", runId, grantId: grant?.id ?? null });
    return grant;
  });
  /**
   * Runs the loop and deals with however it stopped.
   *
   * One place, because every caller — the button, the resume timer, a future
   * scheduler — needs the same three things afterwards: the outcome logged, the
   * operator told if they need to act, and the wait rescheduled if the run is
   * waiting on a limit rather than on a person.
   */
  async function runLoopAndReport(runId: string, retryProviderLimit: boolean) {
    const outcome = await workers.runLoop(runId, { retryProviderLimit });
    options.logEvent?.(`Autopilot loop settled: ${outcome.reason}`, {
      actionId: "autopilot.loop_run", runId, reason: outcome.reason, turnsRun: outcome.turnsRun, finalState: outcome.finalState
    });
    // Before telling the operator anything: if this run was one project in a
    // queue, the queue may have another to start, and starting it changes what
    // there is to say.
    await advanceQueue(runId, outcome.reason);
    recordAttention(runId, outcome.reason, outcome.detail);
    notifyIfNeeded(runId, outcome.reason);
    scheduleResumeTimer();
    scheduleQueueTimer();
    return outcome;
  }

  /**
   * Moves a queue on when one of its projects finishes.
   *
   * The engine decides; this only translates. How the loop stopped becomes what
   * happened to the item (QUEUE_OUTCOME), the engine is asked what is next, and
   * a `start` becomes a real run created and launched exactly as the button
   * would have created it.
   *
   * A run that is not part of a queue leaves through the first line, which is
   * every run that exists today.
   */
  async function advanceQueue(runId: string, reason: LoopStopReason): Promise<void> {
    const queues = new RunQueueStore(ports);
    const item = queues.itemForRun(runId);
    if (!item) return;

    const meaning = QUEUE_OUTCOME[reason];
    if (meaning === "hold") {
      // provider_limit already has a scheduled retry, and the rest mean a
      // person intervened. Advancing would override the decision they just
      // made, so the queue waits with this item still in flight.
      ports.logger.log("info", "Autopilot queue holding", { runId, itemId: item.id, reason });
      return;
    }
    queues.settle(item.id, meaning, reason);

    const action = queues.decide(item.queueId);
    if (action.kind !== "start") {
      if (action.kind === "stop") {
        queues.close(item.queueId, action.detail);
        options.logEvent?.(`Autopilot queue finished: ${action.reason}`, {
          actionId: "autopilot.queue_finished", queueId: item.queueId, reason: action.reason
        });
        try {
          options.notify?.({ title: "Autopilot — the queue is finished", body: queues.summary(item.queueId, action.reason) });
        } catch { /* a missing notification is not worth failing on */ }
      }
      return;
    }

    const next = queues.items(item.queueId).find(entry => entry.id === action.itemId);
    if (!next) return;
    const queue = queues.get(item.queueId)!;
    try {
      const run = await center.create(queuedRunForm(queue, next));
      queues.start(next.id, run.id);
      options.logEvent?.("Autopilot queue started the next project", {
        actionId: "autopilot.queue_next", queueId: queue.id, itemId: next.id, runId: run.id, project: next.projectPath
      });
      launchPrimary(run.id);
    } catch (error) {
      // A project that will not even start must not stall the rest of the
      // night. SKIPPED rather than FAILED, and not because the engine refuses
      // PENDING to FAILED — that refusal is right. Nothing was attempted: no
      // run exists, no worker was asked, no verification ran. Calling that a
      // failure would also count it toward the consecutive-failure bound and
      // end a night over three bad project paths.
      const detail = error instanceof Error ? error.message : String(error);
      queues.settle(next.id, "SKIPPED", `Could not start: ${detail}`);
      ports.logger.log("warn", "Autopilot queue could not start a project", { itemId: next.id, error: detail });
      await advanceQueue(runId, reason);
    }
  }

  /**
   * Brings a scheduled queue back on its own.
   *
   * One timer for all of them, re-armed after every settle, so nothing is
   * polled and a closed app simply picks up on next launch. Tonight's run is a
   * NEW queue with the same projects rather than a reset of last night's,
   * because a reset would leave the morning summary describing work nobody can
   * go back and read.
   */
  function scheduleQueueTimer(): void {
    if (queueTimer) { clearTimeout(queueTimer); queueTimer = null; }
    const queues = new RunQueueStore(ports);
    if (!queues.available()) return;
    const soonest = queues.soonestFire(new Date().toISOString());
    if (soonest === null) return;

    // Capped, so a schedule a week out still re-checks rather than trusting a
    // timer to survive that long.
    const delay = Math.max(0, Math.min(Date.parse(soonest) - Date.now(), 30 * 60_000));
    queueTimer = setTimeout(() => {
      queueTimer = null;
      void (async () => {
        const now = new Date().toISOString();
        const due = new RunQueueStore(ports).due(now);
        for (const entry of due) {
          try {
            const tonight = new RunQueueStore(ports).repeat(entry.queue.id);
            options.logEvent?.("Autopilot queue came back on schedule", {
              actionId: "autopilot.queue_scheduled", queueId: tonight.id, repeats: entry.queue.id, schedule: tonight.schedule
            });
            const action = new RunQueueStore(ports).decide(tonight.id);
            if (action.kind === "start") {
              const next = new RunQueueStore(ports).items(tonight.id).find(item => item.id === action.itemId)!;
              const run = await center.create(queuedRunForm(tonight, next));
              new RunQueueStore(ports).start(next.id, run.id);
              launchPrimary(run.id);
            }
          } catch (error) {
            ports.logger.log("warn", "Autopilot could not start a scheduled queue", {
              queueId: entry.queue.id, error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        // Nothing was due yet, or a new night was started: re-arm either way.
        if (due.length === 0) scheduleQueueTimer();
      })();
    }, delay);
    queueTimer.unref?.();
  }

  /** One queue item, as the Run Spec form that creates its run. */
  function queuedRunForm(queue: ReturnType<RunQueueStore["get"]> & object, item: { projectPath: string; goal: string; planText?: string }): NewRunForm {
    return {
      goal: item.goal,
      projectPath: item.projectPath,
      primary: "claude",
      consultant: null,
      maxTurns: queue.template.maxTurns,
      maxIterations: queue.template.maxIterations,
      maxFailures: queue.template.maxFailures,
      maxIdleTurns: queue.template.maxIdleTurns,
      workspaceMode: "project-branch",
      workerProfile: "agentic",
      planText: item.planText ?? "",
      director: null,
      model: queue.template.model ?? "",
      effort: queue.template.effort ?? "",
      // The spend cap stays at queue level: it is a budget, and giving each
      // run its own copy would let three projects spend three times it.
      //
      // The deadline is NOT a budget and does not divide — 7am is 7am for
      // every project — so each run gets it too. Left off, the queue's promise
      // to stop between projects rather than mid-project is far too coarse: a
      // project starting at 06:50 would run for hours past the time the
      // operator asked it to stop. With it, the run also stops at 7am, at its
      // own phase boundary, which is the granularity "stop at 7am" meant.
      ...(queue.budget.deadline ? { stopAt: queue.budget.deadline } : { stopAt: "" }),
      constraints: [],
      nonGoals: [],
      acceptance: [{ text: "Configured tests pass", tier: "test" }],
      verification: [
        { tier: "typecheck", enabled: false, executable: "node", args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
        { tier: "lint", enabled: false, executable: "node", args: ["node_modules/eslint/bin/eslint.js", "."] },
        { tier: "test", enabled: true, executable: "node", args: ["--test"] },
        { tier: "integration", enabled: false, executable: "node", args: ["--test", "test/integration.test.js"] },
        { tier: "build", enabled: false, executable: "node", args: ["node_modules/vite/bin/vite.js", "build"] }
      ]
    };
  }

  /**
   * Decides what this settle deserves telling someone about, and remembers it.
   *
   * The judgement is the engine's; this only asks and records. Deciding and
   * delivering stay separate acts, so a delivery is written after something has
   * actually gone out rather than before — a record for a message that never
   * arrived would silence the retry.
   *
   * Never fatal. A run whose notification could not be worked out is a run that
   * told nobody, which is not a reason to fail the run itself.
   */
  function recordAttention(runId: string, reason: LoopStopReason, detail: string): void {
    try {
      const attention = new AttentionStore(ports);
      if (!attention.available()) return;
      const items = attention.itemsForRun({ runId, reason, detail });
      if (items.length === 0) return;

      const settings = options.readPushSettings?.();
      const decision = attention.decide(
        items,
        settings ? { quietHours: { start: settings.quietStart, end: settings.quietEnd } } : {}
      );

      const floor = PRIORITY_RANK[settings?.minPushPriority ?? "INFO"] ?? 0;
      for (const group of decision.deliver) {
        // Below the operator's floor it is still decided, still on every
        // screen, just not pushed — and not recorded as delivered, or the
        // cooldown would later believe a phone had been told something it had
        // not.
        if ((PRIORITY_RANK[group.priority] ?? 0) < floor) continue;
        // Recorded only after something has actually gone out. A delivery
        // written first would silence the retry for a message that never
        // arrived — the cooldown would believe the operator had been told.
        void pushGroup(group, runId).then(() => {
          attention.recordDelivery({ groupKey: group.groupKey, priority: group.priority, runId });
        });
      }
      if (decision.deliver.length > 0 || decision.hold.length > 0) {
        ports.logger.log("info", "Autopilot attention decided", {
          runId, deliver: decision.deliver.length, hold: decision.hold.length
        });
      }
    } catch (error) {
      ports.logger.log("warn", "Autopilot could not decide attention", {
        runId, error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /** The sender, rebuilt when settings change so a new path takes effect. */
  function sender(): PushSender | null {
    const settings = options.readPushSettings?.();
    if (!settings?.enabled || !settings.serviceAccountPath || !settings.projectId) return null;
    return new PushSender({ serviceAccountPath: settings.serviceAccountPath, projectId: settings.projectId });
  }

  /**
   * Sends one decided group to every active device.
   *
   * Best effort by design. A phone that cannot be reached is not a reason to
   * fail a run, and the desktop has already shown the same thing — push is an
   * extra channel, never the only one. A token FCM rejects permanently
   * disables its device rather than being retried into a loop.
   */
  async function pushGroup(group: { groupKey: string; priority: string; headline: string; latest: string }, runId: string): Promise<void> {
    const push = sender();
    if (!push) return;
    const devices = new DeviceStore(ports).active();
    if (devices.length === 0) return;

    for (const device of devices) {
      const result = await push.send({
        token: device.pushToken,
        title: group.headline,
        body: group.latest || "Open DexNest to see what happened.",
        // Only something that cannot continue without a person earns a phone
        // waking up. Routine news arrives whenever the phone next looks.
        highPriority: group.priority === "ACTION_REQUIRED" || group.priority === "URGENT",
        channelId: group.priority === "URGENT" ? "urgent" : "attention",
        data: { groupKey: group.groupKey, priority: group.priority, runId }
      });
      const store = new DeviceStore(ports);
      if (result.ok) store.markSent(device.id);
      else {
        store.markFailed(device.id, `${result.status ?? "unknown"}: ${result.detail ?? ""}`);
        ports.logger.log("warn", "Autopilot could not push to a device", {
          deviceId: device.id, status: result.status
        });
      }
    }
  }

  // --- devices and push settings ---------------------------------------------
  handle("dexnest:autopilot-devices", () => new DeviceStore(ports).list());
  handle("dexnest:autopilot-pairing-open", () => {
    const pairing = openPairing({ devices: new DeviceStore(ports) } as never);
    options.logEvent?.("Autopilot opened a pairing window", { actionId: "autopilot.pairing_open" });
    return pairing;
  });
  handle("dexnest:autopilot-pairing-current", () => new DeviceStore(ports).openPairingCode());
  handle("dexnest:autopilot-device-capabilities", (_event, input: { id: string; control?: boolean; drop?: boolean }) => {
    // Grants are edited here and nowhere else. A phone can ask to pair; it
    // cannot ask to be trusted further.
    //
    // Each grant is a separate decision, so each is changed only when the
    // caller names it and otherwise carried across as it was. Rebuilding the
    // list from one flag is how toggling control once silently revoked Drop.
    const devices = new DeviceStore(ports);
    const current = devices.get(input.id)?.capabilities ?? [];
    const control = input.control ?? current.includes("control");
    const drop = input.drop ?? current.includes("drop");
    const device = devices.setCapabilities(input.id, [
      ...(control ? ["control" as const] : []),
      ...(drop ? ["drop" as const] : [])
    ]);
    const changed = input.control !== undefined ? "control" : "drop";
    const granted = input.control !== undefined ? input.control : input.drop;
    options.logEvent?.(`Autopilot ${granted ? "granted" : "withdrew"} a device's ${changed}`, {
      actionId: "autopilot.device_capabilities", deviceId: input.id, control, drop
    });
    return device;
  });
  handle("dexnest:autopilot-device-unpair", (_event, id: string) => {
    const device = new DeviceStore(ports).unpair(id);
    options.logEvent?.("Autopilot unpaired a device", { actionId: "autopilot.device_unpair", deviceId: id });
    return device;
  });
  handle("dexnest:autopilot-device-register", (_event, input: { label: string; platform?: "android" | "ios"; pushToken: string }) => {
    const device = new DeviceStore(ports).register(input);
    options.logEvent?.("Autopilot registered a device for notifications", {
      actionId: "autopilot.device_register", deviceId: device.id, label: device.label
    });
    return device;
  });
  handle("dexnest:autopilot-device-remove", (_event, id: string) => {
    new DeviceStore(ports).remove(id);
    options.logEvent?.("Autopilot forgot a device", { actionId: "autopilot.device_remove", deviceId: id });
  });
  handle("dexnest:autopilot-push-settings", () => options.readPushSettings?.() ?? null);
  handle("dexnest:autopilot-push-settings-save", (_event, settings: PushSettings) => {
    options.writePushSettings?.(settings);
    return options.readPushSettings?.() ?? null;
  });
  handle("dexnest:autopilot-push-verify", async () => {
    const settings = options.readPushSettings?.();
    if (!settings?.serviceAccountPath || !settings.projectId) {
      return { ok: false, detail: "Set the service account path and the Firebase project id first." };
    }
    return new PushSender({ serviceAccountPath: settings.serviceAccountPath, projectId: settings.projectId }).verify();
  });
  handle("dexnest:autopilot-push-test", async (_event, deviceId: string) => {
    const push = sender();
    if (!push) return { ok: false, detail: "Push is off, or the settings are incomplete." };
    const device = new DeviceStore(ports).get(deviceId);
    if (!device) return { ok: false, detail: "No such device." };
    const result = await push.send({
      token: device.pushToken,
      title: "DexNest",
      body: "This is a test notification. Nothing needs you.",
      highPriority: false,
      channelId: "attention",
      data: { groupKey: "test", priority: "INFO", runId: "" }
    });
    const store = new DeviceStore(ports);
    if (result.ok) store.markSent(device.id);
    else store.markFailed(device.id, `${result.status ?? "unknown"}: ${result.detail ?? ""}`);
    return { ok: result.ok, detail: result.ok ? "Sent." : `${result.status ?? "failed"}: ${result.detail ?? ""}` };
  });

  // What needs a person, decided by the engine and shown on the desktop first.
  // The desktop is where the mapping gets proved: getting a priority wrong on a
  // screen you are already looking at costs nothing, and getting it wrong on a
  // phone at 3am costs trust in the whole thing.
  handle("dexnest:autopilot-attention", (_event, runId?: string) => {
    const attention = new AttentionStore(ports);
    if (!attention.available()) return { deliver: [], hold: [], reason: [], summary: "" };

    const runs = runId ? [runId] : engine.listRuns(50).map(run => run.id);
    const items = runs.flatMap(id => {
      const held = [...engine.store.listEvents(id)].reverse()
        .find(event => event.type === "LOOP_HELD")?.payload as { reason?: string; detail?: string } | undefined;
      if (!held?.reason) return [];
      return attention.itemsForRun({
        runId: id,
        reason: held.reason as LoopStopReason,
        detail: held.detail ?? ""
      });
    });

    const decision = attention.decide(items);
    return { ...decision, summary: attention.summarise(decision) };
  });

  /** What the phone reads: the same decision the desktop panel shows. */
  function attentionSnapshot() {
    const attention = new AttentionStore(ports);
    if (!attention.available()) return { deliver: [], hold: [], reason: [], summary: "" };
    const settings = options.readPushSettings?.();
    const items = engine.listRuns(50).flatMap(run => {
      // A held question only stands while the run is still holding it. The
      // LOOP_HELD event is never retracted — stopping or resuming writes no
      // second one — so without this check the list goes on asking about runs
      // the operator dealt with days ago, and "needs you" stops meaning it.
      if (!attentionStands(run.state)) return [];
      const held = [...engine.store.listEvents(run.id)].reverse()
        .find(event => event.type === "LOOP_HELD")?.payload as { reason?: string; detail?: string } | undefined;
      if (!held?.reason) return [];
      return attention.itemsForRun({ runId: run.id, reason: held.reason as LoopStopReason, detail: held.detail ?? "" });
    });
    const decision = attention.decide(
      items,
      settings ? { quietHours: { start: settings.quietStart, end: settings.quietEnd } } : {}
    );
    return { ...decision, summary: attention.summarise(decision) };
  }

  /**
   * Runs, in the shape a phone screen needs.
   *
   * Deliberately not the run report. That is built for a desk — verification
   * output, send history, workspace evidence — and shipping it to a phone
   * would be shipping a debugging surface to somewhere nobody can debug.
   */
  function runsForPhone() {
    const queues = new RunQueueStore(ports);
    return engine.listRuns(20).map(run => {
      const report = workers.report(run.id);
      const plan = report.plan;
      const done = plan.items.filter(item => item.status === "DONE").length;
      const active = plan.items.find(item => item.status === "ACTIVE");
      const checkpoint = report.checkpoints.at(-1);
      return {
        id: run.id,
        label: queues.itemForRun(run.id)?.label ?? (run.spec.projectPath ?? "").split(/[\/]/).filter(Boolean).pop() ?? run.id,
        state: run.state,
        phase: done + (active ? 1 : 0),
        phaseTotal: plan.items.length,
        phaseTitle: active?.title ?? "",
        lastCheckpointAt: checkpoint?.createdAt ?? null,
        verification: report.loop.turns.at(-1)?.verification?.outcome ?? "NONE",
        costUsd: report.usage.totalUsd
      };
    });
  }

  /** The summary an operator reads before opening the conversation. */
  function morningSummaryFor(runId: string) {
    const report = workers.report(runId);
    const unattended = new UnattendedStore(ports);
    // How the loop stopped lives in the journal, not on the report: the report
    // is rebuilt from durable evidence and the outcome object is a return
    // value, which a restart does not have.
    const held = [...engine.store.listEvents(runId)].reverse()
      .find(event => event.type === "LOOP_HELD")?.payload as { reason?: string; detail?: string } | undefined;
    const stop = (held?.reason ?? (report.run.state === "COMPLETED" ? "completed" : "paused")) as Parameters<typeof buildMorningSummary>[0]["reason"];
    return buildMorningSummary({
      reason: stop,
      detail: held?.detail ?? report.run.failureReason ?? "",
      iterations: report.iterations,
      checkpoints: report.checkpoints.length,
      assumptions: unattended.assumptions(runId),
      directionSource: report.direction.source,
      resume: unattended.pending(runId),
      provider: report.roles.primary.provider,
      sessionId: report.roles.primary.sessionId,
      cwd: report.spec.capabilities.workspaceRoot
    });
  }

  /**
   * Tells the operator, once, when a run needs them.
   *
   * Silent on the outcomes that need nothing: a run still waiting out a usage
   * limit will pick itself back up, and a notification for that is noise at
   * 3am. Notifications are best-effort — a run must never fail because a toast
   * could not be shown.
   */
  function notifyIfNeeded(runId: string, reason: string): void {
    if (["provider_limit", "paused", "stopped"].includes(reason)) {
      // provider_limit only matters once the waiting has given up.
      const waiting = new UnattendedStore(ports).pending(runId);
      if (reason !== "provider_limit" || (waiting && !waiting.exhausted)) return;
    }
    try {
      const summary = morningSummaryFor(runId);
      if (summary.action === "nothing" || summary.action === "waiting") return;
      options.notify?.({ title: `Autopilot — ${summary.headline}`, body: summary.detail });
    } catch {
      // A missing notification is not worth failing a run over.
    }
  }

  /**
   * Wakes runs whose wait is over.
   *
   * A single timer for all of them, re-armed after every settle, so nothing is
   * polled and a closed app simply resumes on next launch. The retry is
   * deliberate — it passes retryProviderLimit — because waiting IS the decision
   * that the limit may have lifted.
   */
  function scheduleResumeTimer(): void {
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    const unattended = new UnattendedStore(ports);
    const waiting = unattended.due("9999-12-31T23:59:59.999Z").filter(entry => !entry.exhausted);
    const next = waiting.map(entry => Date.parse(entry.notBefore)).sort((left, right) => left - right)[0];
    if (next === undefined) return;

    const delay = Math.max(0, Math.min(next - Date.now(), 30 * 60_000));
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      const due = unattended.due(new Date().toISOString()).filter(entry => !entry.exhausted);
      void (async () => {
        for (const entry of due) {
          ports.logger.log("info", "Autopilot retrying a provider limit", { runId: entry.runId, attempt: entry.attempt });
          engine.store.appendEvent(entry.runId, { type: "RESUME_ATTEMPTED", payload: { attempt: entry.attempt } });
          try { await runLoopAndReport(entry.runId, true); }
          catch (error) {
            ports.logger.log("warn", "Autopilot resume attempt failed", { runId: entry.runId, error: String(error) });
          }
        }
        // Nothing was due yet, or more waiting was scheduled: re-arm either way.
        if (due.length === 0) scheduleResumeTimer();
      })();
    }, delay);
    // A pending timer must never hold the app open.
    resumeTimer.unref?.();
  }

  handle("dexnest:autopilot-loop-run", async (_event, runId: string, input?: { retryProviderLimit?: boolean }) => {
    const outcome = await runLoopAndReport(runId, input?.retryProviderLimit === true);
    return outcome;
  });

  // What the operator reads before opening the conversation.
  handle("dexnest:autopilot-morning-summary", (_event, runId: string) => morningSummaryFor(runId));

  // --- the run queue ---------------------------------------------------------
  // Several projects in one night, on one budget. Creating a queue starts its
  // first project immediately; every later one starts when the previous run
  // settles, in advanceQueue.
  handle("dexnest:autopilot-queue", () => {
    const queues = new RunQueueStore(ports);
    const queue = queues.active();
    if (!queue) return null;
    return {
      queue,
      items: queues.items(queue.id),
      progress: queues.progress(queue.id),
      spentUsd: queues.spentUsd(queue.id),
      summary: queues.summary(queue.id, null)
    };
  });
  handle("dexnest:autopilot-queue-create", async (_event, input: {
    items: Array<{ projectPath: string; goal: string; planText?: string; label?: string }>;
    budget?: { deadline?: string; maxCostUsd?: number; maxItems?: number; maxConsecutiveFailures?: number };
    template?: { model?: string | null; effort?: string | null };
    schedule?: string | null;
  }) => {
    const queues = new RunQueueStore(ports);
    const queue = queues.create(input);
    options.logEvent?.(`Autopilot queue created with ${input.items.length} project(s)`, {
      actionId: "autopilot.queue_create", queueId: queue.id, projects: input.items.length
    });

    const action = queues.decide(queue.id);
    if (action.kind === "start") {
      const next = queues.items(queue.id).find(entry => entry.id === action.itemId)!;
      const run = await center.create(queuedRunForm(queue, next));
      queues.start(next.id, run.id);
      launchPrimary(run.id);
    }
    return queues.active();
  });
  handle("dexnest:autopilot-queue-schedules", () => {
    const queues = new RunQueueStore(ports);
    const soonest = queues.soonestFire(new Date().toISOString());
    return { soonestFire: soonest };
  });
  handle("dexnest:autopilot-queue-close", (_event, queueId: string) => {
    const queues = new RunQueueStore(ports);
    options.logEvent?.("Autopilot queue closed by the operator", { actionId: "autopilot.queue_close", queueId });
    const closed = queues.close(queueId, "Closed by the operator.");
    // Closing a scheduled queue is what makes it due again tonight.
    scheduleQueueTimer();
    return closed;
  });

  // --- continuing a session you primed --------------------------------------
  // Explaining the job is easy in the editor and awkward in a form. This lets
  // the explaining happen there and the carrying-on happen here.
  handle("dexnest:autopilot-session-candidates", (_event, runId: string) => workers.sessionCandidates(runId));
  handle("dexnest:autopilot-session-attached", (_event, runId: string) => workers.attachedSession(runId));
  handle("dexnest:autopilot-session-attach", (_event, input: { runId: string; sessionId: string }) => {
    const record = workers.attachSession(input);
    options.logEvent?.("Autopilot adopted an existing session", {
      actionId: "autopilot.session_attach", runId: input.runId, sessionId: record.sessionId, origin: record.origin
    });
    return record;
  });

  // --- the morning ---------------------------------------------------------
  // A sentence written before letting the run carry on, and the answer to its
  // claim of being finished. Neither starts a turn: running stays separate.
  handle("dexnest:autopilot-note-add", (_event, input: { runId: string; text: string }) => {
    const note = workers.addNote({ runId: input.runId, text: input.text, author: "desktop_ui" });
    options.logEvent?.("Autopilot note recorded", { actionId: "autopilot.note_add", runId: input.runId, noteId: note.id, length: note.text.length });
    return note;
  });
  handle("dexnest:autopilot-notes", (_event, runId: string) => workers.notes(runId));
  handle("dexnest:autopilot-plan-complete-proposal", (_event, runId: string) => workers.planCompleteProposal(runId));
  handle("dexnest:autopilot-plan-complete-accept", (_event, runId: string) => {
    workers.acceptPlanComplete(runId);
    options.logEvent?.("Autopilot plan completion accepted", { actionId: "autopilot.plan_complete_accept", runId });
  });
  handle("dexnest:autopilot-plan-complete-reject", (_event, input: { runId: string; reason: string }) => {
    const note = workers.rejectPlanComplete({ runId: input.runId, reason: input.reason });
    options.logEvent?.("Autopilot plan completion rejected", { actionId: "autopilot.plan_complete_reject", runId: input.runId, noteId: note.id });
    return note;
  });

  // What the run is doing right now. In memory, bounded, and never the
  // authority on anything: the conversation itself lives in the agent session.
  handle("dexnest:autopilot-activity", (_event, runId: string) => workers.activity(runId));

  // --- run report ----------------------------------------------------------
  // Rebuilt from SQLite every time, so it survives restarts and remains
  // available for stopped and failed runs.
  handle("dexnest:autopilot-report", (_event, runId: string) => workers.report(runId));
  handle("dexnest:autopilot-report-export", async (_event, runId: string) => {
    const result = await workers.exportReport(runId);
    options.logEvent?.("Autopilot run report exported", {
      actionId: "autopilot.report_export", runId, written: result.written.length, refused: result.refused.length
    });
    return { written: result.written, refused: result.refused };
  });

  handle("dexnest:autopilot-list-runs", () => engine.listRuns(50));
  handle("dexnest:autopilot-get-run", (_event, runId: string) => ({ ...engine.snapshot(runId), worker: workers.snapshot(runId), loop: workers.loopSnapshot(runId), consultant: workers.consultantSnapshot(runId),
    // Drives the operator action's availability and its reason when unavailable.
    consultationRequest: { ...consultations.operatorEligibility(runId), busy: workers.snapshot(runId).busy },
    handoff: workers.handoffSnapshot(runId),
    recovery: workers.recovery(runId) }));

  handle("dexnest:autopilot-create-run", (_event, input: RunSpecInput) => {
    if (input.workers && ["claude", "codex"].includes(input.workers.primary)) {
      if (!input.workers.sticky || input.workers.fallback) throw new Error("Real workers require a sticky session with no fallback.");
      validateClaudeWorkspace(ports.platform!, input);
    } else if (input.workers?.primary && input.workers.primary !== "scripted") throw new Error("Unsupported worker provider.");
    const run = engine.createRun(input);
    options.logEvent?.("Autopilot run created", { runId: run.id, state: run.state, provider: run.spec.workers.primary, externalAiOptIn: ["claude", "codex"].includes(run.spec.workers.primary) });
    return run;
  });

  // Fire-and-forget: the run continues in the main process whether or not the
  // renderer is open, and progress is observed through the change events above.
  handle("dexnest:autopilot-start-run", (_event, runId: string) => {
    if (["claude", "codex"].includes(engine.store.requireRun(runId).spec.workers.primary)) throw new Error("Prepare and approve one worker prompt instead.");
    void engine.start(runId).catch((error: unknown) => {
      console.warn("[autopilot] run loop ended with an error", error);
    });
    return engine.store.requireRun(runId);
  });

  handle("dexnest:autopilot-list-approvals", (_event, runId?: string) => engine.listPendingApprovals(runId));
  handle(
    "dexnest:autopilot-resolve-approval",
    (_event, input: { approvalId: string; decision: "APPROVED" | "REJECTED" }) => {
      const resolved = engine.resolveApproval({ ...input, source: "desktop_ui" });
      options.logEvent?.(`Autopilot approval ${resolved.status.toLowerCase()}: ${resolved.summary}`, {
        approvalId: resolved.id,
        runId: resolved.runId,
        operationId: resolved.operationId,
        risk: resolved.risk,
        source: "desktop_ui"
      });
      return resolved;
    }
  );

  handle("dexnest:autopilot-pause-run", (_event, runId: string) => engine.requestPause(runId));
  handle("dexnest:autopilot-resume-run", (_event, runId: string) => {
    if (["claude", "codex"].includes(engine.store.requireRun(runId).spec.workers.primary)) throw new Error("Prepare and approve one worker prompt instead.");
    void engine.resume(runId).catch((error: unknown) => {
      console.warn("[autopilot] resume ended with an error", error);
    });
    return engine.store.requireRun(runId);
  });
  handle("dexnest:autopilot-stop-run", async (_event, runId: string) => {
    if (["claude", "codex"].includes(engine.store.requireRun(runId).spec.workers.primary) && workers.sessions.pending(runId)) await workers.interrupt(runId);
    return engine.requestStop(runId);
  });
  handle(
    "dexnest:autopilot-resolve-uncertain",
    (_event, input: { runId: string; stepKey: string; resolution: UncertainResolution }) =>
      engine.resolveUncertainStep(input.runId, input.stepKey, input.resolution)
  );

  return {
    engine,
    workers,
    pendingApprovals: () => engine.listPendingApprovals(),
    resolveApproval(input) {
      const resolved = engine.resolveApproval(input);
      options.logEvent?.(`Autopilot approval ${resolved.status.toLowerCase()}: ${resolved.summary}`, {
        approvalId: resolved.id,
        runId: resolved.runId,
        operationId: resolved.operationId,
        risk: resolved.risk,
        source: input.source
      });
      return resolved;
    },
    devices: new DeviceStore(ports),
    attentionSnapshot,
    snoozeAttention(input) {
      new AttentionStore(ports).snooze(input);
      options.logEvent?.("Autopilot attention snoozed", {
        actionId: "autopilot.attention_snooze", groupKey: input.groupKey, question: input.question, until: input.until, runId: input.runId ?? null
      });
    },
    runsForPhone,
    control: {
      pause(runId: string) {
        engine.requestPause(runId);
        options.logEvent?.("Autopilot paused from a phone", { actionId: "autopilot.pause_run", runId, source: "phone" });
      },
      async resume(runId: string) {
        options.logEvent?.("Autopilot resumed from a phone", { actionId: "autopilot.loop_run", runId, source: "phone" });
        await engine.resume(runId);
      },
      approve(approvalId: string, decision: "APPROVED" | "REJECTED") {
        const resolved = engine.resolveApproval({ approvalId, decision, source: "phone" });
        options.logEvent?.(`Autopilot approval ${resolved.status.toLowerCase()} from a phone: ${resolved.summary}`, {
          approvalId: resolved.id, runId: resolved.runId, risk: resolved.risk, source: "phone"
        });
        return resolved;
      },
      acceptPlanComplete(runId: string) {
        workers.acceptPlanComplete(runId);
        options.logEvent?.("Autopilot plan completion accepted from a phone", {
          actionId: "autopilot.plan_complete_accept", runId, source: "phone"
        });
      },
      rejectPlanComplete(runId: string, reason: string) {
        const note = workers.rejectPlanComplete({ runId, reason });
        options.logEvent?.("Autopilot plan completion rejected from a phone", {
          actionId: "autopilot.plan_complete_reject", runId, noteId: note.id, source: "phone"
        });
      }
    },
    async recover(): Promise<void> {
      // autoResume is deliberately absent: after an unexplained restart the safe
      // default is to hold, not to resume autonomous work unattended.
      const outcomes = await engine.recoverAll();
      workers.sessions.markRestored();
      consultations.recover();
      // An activation interrupted by a crash resolves to exactly one owner.
      for (const run of engine.listRuns(10000)) new HandoffStore(ports).reconcileActivation(run.id);
      recovered = true;
      // Arm both timers now rather than waiting for something to settle. A
      // scheduled queue whose hour passed while the app was closed is due the
      // moment it opens, and a run left waiting on a provider limit likewise.
      scheduleResumeTimer();
      scheduleQueueTimer();
      for (const outcome of outcomes) {
        options.logEvent?.(
          `Autopilot run reconciled after restart: ${outcome.previousState} -> ${outcome.resolvedState}`,
          { runId: outcome.runId, reason: outcome.reason }
        );
      }
    },
    dispose() {
      // A pending timer must never hold the app open, and must never fire
      // into a host whose handlers have already gone.
      if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
      if (queueTimer) { clearTimeout(queueTimer); queueTimer = null; }
      unsubscribe();
      for (const channel of channels) ipcMain.removeHandler(channel);
    }
  };
}
