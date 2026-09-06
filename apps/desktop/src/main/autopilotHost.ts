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
import {
  AutopilotEngine,
  ControlledWorkerTurns,
  AutopilotControlCenter,
  ConsultationStore,
  DirectionAuthorityStore,
  UnattendedStore,
  buildMorningSummary,
  HandoffStore,
  type ConsultationScope,
  type NewRunForm,
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
}

export interface AutopilotHost {
  engine: AutopilotEngine;
  workers: ControlledWorkerTurns;
  /** Pending approvals across all runs, for the UI and the Stream Deck. */
  pendingApprovals: () => ApprovalRecord[];
  /** Resolves one approval. The only granter of gated authority. */
  resolveApproval: (input: { approvalId: string; decision: "APPROVED" | "REJECTED"; source: string }) => ApprovalRecord;
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
    validateWorkspace: runId => validateClaudeWorkspace(ports.platform!, engine.store.requireRun(runId).spec), changed });
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
  handle("dexnest:autopilot-create-automation", async (_event, form: NewRunForm) => {
    const run = await center.create(form);
    options.logEvent?.("Autopilot coding automation created", { actionId: "autopilot.create_automation", runId: run.id });
    launchPrimary(run.id);
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
    notifyIfNeeded(runId, outcome.reason);
    scheduleResumeTimer();
    return outcome;
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
    async recover(): Promise<void> {
      // autoResume is deliberately absent: after an unexplained restart the safe
      // default is to hold, not to resume autonomous work unattended.
      const outcomes = await engine.recoverAll();
      workers.sessions.markRestored();
      consultations.recover();
      // An activation interrupted by a crash resolves to exactly one owner.
      for (const run of engine.listRuns(10000)) new HandoffStore(ports).reconcileActivation(run.id);
      recovered = true;
      for (const outcome of outcomes) {
        options.logEvent?.(
          `Autopilot run reconciled after restart: ${outcome.previousState} -> ${outcome.resolvedState}`,
          { runId: outcome.runId, reason: outcome.reason }
        );
      }
    },
    dispose() { unsubscribe(); for (const channel of channels) ipcMain.removeHandler(channel); }
  };
}
