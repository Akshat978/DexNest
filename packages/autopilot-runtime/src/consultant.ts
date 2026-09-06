// The CONSULTANT: one bounded, read-only diagnosis turn.
//
// The consultant advises. It never implements. That is enforced structurally
// rather than by instruction:
//
//   - it has its own session table, so it cannot occupy or mutate the PRIMARY
//     session (which is keyed by run_id and CHECK(role='PRIMARY'))
//   - it never calls applyWorkerOutput, so a DEXNEST_FILE envelope in its reply
//     is counted and discarded, never written
//   - it never touches the checkpointer, the LoopStore or a LoopGrant
//   - its authority is one explicit human-approved consultation, and the
//     database allows exactly one diagnosis per consultation
//
// It reuses the existing WorkerProtocol (the same Claude/Codex CLI semantics and
// the same disabled-tools flags) and the same EffectsGateway, so its single
// process launch passes capability policy exactly like any other effect.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { EffectsGateway } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";
import type { WorkerFailure, WorkerProtocol } from "./worker.ts";
import { AutopilotStore } from "./store.ts";
import { ConsultationStore, type ConsultationPreview, type ConsultationScope, type ConsultationTrigger } from "./consultations.ts";
import { parseWorkerOutput } from "./workerOutput.ts";
import type { CodingProvider } from "./roles.ts";

export type DiagnosisStatus = "INTENT" | "COMPLETED" | "FAILED" | "UNCERTAIN";

export interface ConsultantSession {
  id: string;
  runId: string;
  role: "CONSULTANT";
  provider: CodingProvider;
  sessionId: string;
  providerSessionId: string | null;
  cwd: string;
  established: boolean;
  /** Codex MCP servers to disable. Null until configuration is discovered. */
  disabledMcpServers: string[] | null;
  createdAt: string;
}

export interface DiagnosisRecord {
  id: string;
  runId: string;
  consultationId: string;
  consultantProvider: string;
  consultantSessionId: string;
  providerSessionId: string | null;
  status: DiagnosisStatus;
  operationId: string | null;
  promptLength: number;
  diagnosis: string | null;
  outputLength: number | null;
  outputFingerprint: string | null;
  failure: string | null;
  refusedFileBlocks: number;
  suppliedToTurnId: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface SessionRow {
  id: string; run_id: string; role: string; provider: string; session_id: string;
  provider_session_id: string | null; cwd: string; established: number;
  provider_options_json: string | null; created_at: string;
}
interface DiagnosisRow {
  id: string; run_id: string; consultation_id: string; consultant_provider: string;
  consultant_session_id: string; provider_session_id: string | null; status: string;
  operation_id: string | null; prompt_length: number; diagnosis: string | null;
  output_length: number | null; output_fingerprint: string | null; failure: string | null;
  refused_file_blocks: number; supplied_to_turn_id: string | null;
  started_at: string; completed_at: string | null;
}

/** Bounds on what a diagnosis may be, so one reply cannot flood the journal. */
export const MAX_DIAGNOSIS_CHARS = 12_000;

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `diag-${hash.toString(16).padStart(8, "0")}`;
}

function toSession(row: SessionRow): ConsultantSession {
  return {
    id: row.id, runId: row.run_id, role: "CONSULTANT", provider: row.provider as CodingProvider,
    sessionId: row.session_id, providerSessionId: row.provider_session_id, cwd: row.cwd,
    established: row.established === 1,
    disabledMcpServers: row.provider_options_json ? (JSON.parse(row.provider_options_json) as string[]) : null,
    createdAt: row.created_at
  };
}

function toDiagnosis(row: DiagnosisRow): DiagnosisRecord {
  return {
    id: row.id, runId: row.run_id, consultationId: row.consultation_id,
    consultantProvider: row.consultant_provider, consultantSessionId: row.consultant_session_id,
    providerSessionId: row.provider_session_id, status: row.status as DiagnosisStatus,
    operationId: row.operation_id, promptLength: row.prompt_length, diagnosis: row.diagnosis,
    outputLength: row.output_length, outputFingerprint: row.output_fingerprint, failure: row.failure,
    refusedFileBlocks: row.refused_file_blocks, suppliedToTurnId: row.supplied_to_turn_id,
    startedAt: row.started_at, completedAt: row.completed_at
  };
}

/** Durable consultant state. Never touches PRIMARY session or send tables. */
export class ConsultantStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_consultant_diagnoses'").get()
    );
  }

  session(runId: string, provider: CodingProvider): ConsultantSession | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_consultant_sessions WHERE run_id=:runId AND provider=:provider")
      .get<SessionRow>({ runId, provider });
    return row ? toSession(row) : null;
  }

  sessions(runId: string): ConsultantSession[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_consultant_sessions WHERE run_id=:runId ORDER BY rowid")
      .all<SessionRow>({ runId })
      .map(toSession);
  }

  /** Creates the consultant session, or returns the existing one. */
  startSession(input: { runId: string; provider: CodingProvider; sessionId: string; cwd: string }): ConsultantSession {
    return this.store.transaction(() => {
      const existing = this.session(input.runId, input.provider);
      const run = this.store.requireRun(input.runId);
      if (existing) {
        this.store.appendEventUnsafe(input.runId, run.state, {
          type: "CONSULTANT_SESSION_RESUMED",
          payload: { role: "CONSULTANT", provider: input.provider, sessionId: existing.sessionId, established: existing.established }
        });
        return existing;
      }
      this.db
        .prepare(
          `INSERT INTO autopilot_consultant_sessions(id,run_id,provider,session_id,cwd,created_at)
           VALUES(:id,:runId,:provider,:sessionId,:cwd,:now)`
        )
        .run({
          id: this.ports.ids.next("consultant-session"), runId: input.runId, provider: input.provider,
          sessionId: input.sessionId, cwd: input.cwd, now: this.ports.clock.now()
        });
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: "CONSULTANT_SESSION_STARTED",
        payload: { role: "CONSULTANT", provider: input.provider, sessionId: input.sessionId }
      });
      return this.session(input.runId, input.provider)!;
    });
  }

  bindProviderSession(runId: string, provider: CodingProvider, providerSessionId: string): void {
    this.db
      .prepare(
        `UPDATE autopilot_consultant_sessions SET provider_session_id=:providerSessionId, established=1
         WHERE run_id=:runId AND provider=:provider AND provider_session_id IS NULL`
      )
      .run({ runId, provider, providerSessionId });
  }

  /**
   * Persists the provider configuration the adapter needs before its first
   * prompt. Only names are stored: no transport, token or environment value.
   */
  recordDisabledMcpServers(runId: string, provider: CodingProvider, names: string[]): void {
    if (names.some((name) => !/^[A-Za-z0-9_-]+$/.test(name))) {
      throw new ConsultantExecutionError("consultant.configuration", "Unsupported MCP configuration name; no consultant prompt may be sent.");
    }
    this.db
      .prepare("UPDATE autopilot_consultant_sessions SET provider_options_json=:options WHERE run_id=:runId AND provider=:provider")
      .run({ options: JSON.stringify([...new Set(names)].sort()), runId, provider });
  }

  markEstablished(runId: string, provider: CodingProvider): void {
    this.db
      .prepare("UPDATE autopilot_consultant_sessions SET established=1 WHERE run_id=:runId AND provider=:provider")
      .run({ runId, provider });
  }

  diagnosis(consultationId: string): DiagnosisRecord | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_consultant_diagnoses WHERE consultation_id=:id")
      .get<DiagnosisRow>({ id: consultationId });
    return row ? toDiagnosis(row) : null;
  }

  diagnoses(runId: string): DiagnosisRecord[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_consultant_diagnoses WHERE run_id=:runId ORDER BY started_at, rowid")
      .all<DiagnosisRow>({ runId })
      .map(toDiagnosis);
  }

  /**
   * The completed diagnosis waiting to reach PRIMARY, if any.
   *
   * Only COMPLETED counts: a failed or uncertain consultation must not release
   * the hold, and must not be handed to PRIMARY as if it were advice.
   */
  pendingForPrimary(runId: string): DiagnosisRecord | null {
    return this.diagnoses(runId).find((entry) => entry.status === "COMPLETED" && !entry.suppliedToTurnId) ?? null;
  }

  /** Journals the intent and COMMITS before any consultant process starts. */
  recordIntent(input: {
    runId: string; consultationId: string; provider: CodingProvider;
    sessionId: string; promptLength: number;
  }): DiagnosisRecord {
    return this.store.transaction(() => {
      const existing = this.diagnosis(input.consultationId);
      if (existing) return existing;
      this.db
        .prepare(
          `INSERT INTO autopilot_consultant_diagnoses
             (id,run_id,consultation_id,consultant_provider,consultant_session_id,status,prompt_length,started_at)
           VALUES(:id,:runId,:consultationId,:provider,:sessionId,'INTENT',:promptLength,:now)`
        )
        .run({
          id: this.ports.ids.next("diagnosis"), runId: input.runId, consultationId: input.consultationId,
          provider: input.provider, sessionId: input.sessionId, promptLength: input.promptLength,
          now: this.ports.clock.now()
        });
      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: "CONSULTANT_DIAGNOSIS_INTENT",
        payload: { consultationId: input.consultationId, provider: input.provider, promptLength: input.promptLength }
      });
      return this.diagnosis(input.consultationId)!;
    });
  }

  settle(input: {
    consultationId: string; status: Exclude<DiagnosisStatus, "INTENT">;
    diagnosis?: string | null; failure?: WorkerFailure | string | null;
    operationId?: string | null; providerSessionId?: string | null; refusedFileBlocks?: number;
  }): DiagnosisRecord {
    return this.store.transaction(() => {
      const text = input.diagnosis ? input.diagnosis.slice(0, MAX_DIAGNOSIS_CHARS) : null;
      // Bind the provider thread the moment the protocol has exposed it, even
      // when the turn then refuses: a refused diagnosis is still traceable to
      // the conversation it was attempted on. Never invented, only copied.
      const existing = this.diagnosis(input.consultationId);
      const bound = input.providerSessionId
        ?? (existing ? this.session(existing.runId, existing.consultantProvider as CodingProvider)?.providerSessionId ?? null : null);
      this.db
        .prepare(
          `UPDATE autopilot_consultant_diagnoses
           SET status=:status, diagnosis=:diagnosis, output_length=:length, output_fingerprint=:fingerprint,
               failure=:failure, operation_id=COALESCE(:operationId, operation_id),
               provider_session_id=COALESCE(:providerSessionId, provider_session_id),
               refused_file_blocks=:refused, completed_at=:now
           WHERE consultation_id=:consultationId AND status='INTENT'`
        )
        .run({
          consultationId: input.consultationId, status: input.status, diagnosis: text,
          length: text ? text.length : null, fingerprint: text ? fingerprint(text) : null,
          failure: input.failure ?? null, operationId: input.operationId ?? null,
          providerSessionId: bound, refused: input.refusedFileBlocks ?? 0,
          now: this.ports.clock.now()
        });

      const record = this.diagnosis(input.consultationId)!;
      const run = this.store.requireRun(record.runId);
      this.store.appendEventUnsafe(record.runId, run.state, {
        type:
          record.status === "COMPLETED" ? "CONSULTANT_DIAGNOSIS_COMPLETED"
          : record.status === "UNCERTAIN" ? "CONSULTANT_DIAGNOSIS_UNCERTAIN"
          : "CONSULTANT_DIAGNOSIS_FAILED",
        payload: {
          consultationId: record.consultationId, provider: record.consultantProvider,
          status: record.status, failure: record.failure,
          outputLength: record.outputLength, outputFingerprint: record.outputFingerprint,
          refusedFileBlocks: record.refusedFileBlocks
        }
      });
      return record;
    });
  }

  /** Links a completed diagnosis to the PRIMARY turn that consumed it. Once. */
  markSupplied(consultationId: string, turnId: string, turnOrdinal?: number): DiagnosisRecord | null {
    return this.store.transaction(() => {
      this.db
        .prepare(
          `UPDATE autopilot_consultant_diagnoses SET supplied_to_turn_id=:turnId
           WHERE consultation_id=:consultationId AND status='COMPLETED' AND supplied_to_turn_id IS NULL`
        )
        .run({ consultationId, turnId });
      const record = this.diagnosis(consultationId);
      if (record?.suppliedToTurnId === turnId) {
        const run = this.store.requireRun(record.runId);
        this.store.appendEventUnsafe(record.runId, run.state, {
          type: "DIAGNOSIS_SUPPLIED_TO_PRIMARY",
          payload: { consultationId, turnId, turnOrdinal: turnOrdinal ?? null, provider: record.consultantProvider }
        });
      }
      return record;
    });
  }
}

/**
 * The consultant prompt.
 *
 * Deterministic and template-built from durable evidence — no model authors it.
 * The preview it draws on is already redacted and bounded by ConsultationStore,
 * so credentials, raw auth output and restricted paths never reach here.
 */
export function consultantPrompt(input: {
  preview: ConsultationPreview;
  triggerType: ConsultationTrigger;
  triggerReason: string;
  consultantProvider: string;
  sourceContext: string;
}): string {
  const { preview } = input;
  const lines: string[] = [];

  const operator = input.triggerType === "OPERATOR";

  lines.push("You are the CONSULTANT on this run. You are NOT the implementation owner.");
  lines.push("");
  lines.push(
    operator
      ? `You are a read-only consultant. The operator requested a second opinion while ${preview.primaryProvider} ` +
        "remains the owner of this run. Diagnose the current implementation and state, and give concise " +
        "actionable advice. Do not implement changes; nothing you write will be applied."
      : `Another agent (${preview.primaryProvider}) owns the code and is stuck. Your job is to diagnose why, ` +
        "so it can try again. You will not be asked to implement anything, and nothing you write will be applied."
  );
  lines.push("");
  lines.push("RULES");
  lines.push("- Diagnose only. Do not return file contents or edits; they will be discarded.");
  lines.push("- Do not claim you ran, tested, changed or fixed anything. You have no tools here.");
  lines.push("- Reason only from the evidence below. Say so plainly if it is insufficient.");
  lines.push("- Be concise and specific. The other agent has to act on this.");
  lines.push("");

  lines.push("GOAL");
  lines.push(preview.goal);
  if (preview.constraints.length > 0) {
    lines.push("");
    lines.push("CONSTRAINTS");
    for (const constraint of preview.constraints) lines.push(`- ${constraint}`);
  }
  if (preview.acceptanceCriteria.length > 0) {
    lines.push("");
    lines.push("ACCEPTANCE CRITERIA");
    for (const criterion of preview.acceptanceCriteria) lines.push(`- ${criterion}`);
  }

  lines.push("");
  lines.push(operator ? "WHY YOU WERE ASKED" : "WHY THIS WAS ESCALATED");
  lines.push(`- Trigger: ${input.triggerType}`);
  lines.push(`- Reason: ${input.triggerReason}`);
  lines.push(`- Latest turn: ${preview.triggeringTurn ?? "unknown"}`);
  lines.push(`- Progress: ${preview.progressStatus ?? "not evaluated"}`);
  lines.push(`- Latest verification: ${preview.latestVerification ?? "none recorded"}`);
  lines.push(`- Failing check: ${preview.failingTier ?? "none recorded"}`);
  lines.push(`- ${operator ? "Current state" : "Failure"}: ${preview.failureSummary}`);

  lines.push("");
  lines.push("WORKSPACE");
  lines.push(
    preview.changedPaths.length > 0
      ? `Changed paths: ${preview.changedPaths.join(", ")}`
      : "No changed paths were recorded."
  );
  lines.push(
    preview.latestCheckpoint
      ? `Last known-good checkpoint: ${preview.latestCheckpoint.commitSha ?? preview.latestCheckpoint.status}`
      : "No known-good checkpoint exists yet."
  );
  if (preview.workspace) {
    lines.push(`Worktree: ${preview.workspace.changedFiles} changed file(s) at ${preview.workspace.headSha ?? "an unrecorded commit"}.`);
  }
  if (preview.contextRequests.length > 0) {
    lines.push("");
    lines.push("FILES THE OTHER AGENT ASKED TO SEE");
    for (const request of preview.contextRequests) {
      lines.push(`- ${request.path}: ${request.status}${request.reason ? ` (${request.reason})` : ""}`);
    }
  }

  if (input.sourceContext) {
    lines.push("");
    lines.push(input.sourceContext);
  }

  lines.push("");
  lines.push("REPLY IN EXACTLY THESE SECTIONS");
  lines.push("");
  if (operator) {
    // Nothing has necessarily gone wrong, so asking for a root cause would
    // invite one to be invented. Ask for review, not for a post-mortem.
    lines.push("CORRECTNESS ASSESSMENT");
    lines.push("LIKELY HIDDEN ISSUES");
    lines.push("IMPLEMENTATION / ARCHITECTURE RISKS");
    lines.push("ACCEPTANCE CRITERIA GAPS");
    lines.push("SUGGESTED NEXT DIRECTION");
  } else {
    lines.push("ROOT CAUSE");
    lines.push("EVIDENCE");
    lines.push("RECOMMENDED APPROACH");
    lines.push("FILES/AREAS TO RECHECK");
    lines.push("RISKS / THINGS NOT TO CHANGE");
  }

  return lines.join("\n");
}

/** Renders a completed diagnosis for the PRIMARY's next repair prompt. */
export function renderAdvisory(record: DiagnosisRecord): string {
  return [
    "ADVISORY — SECOND OPINION FROM A CONSULTANT",
    "",
    `A different agent (${record.consultantProvider}) reviewed the evidence because you were stuck.`,
    "This is advice, not instruction, and it was produced without running or changing anything.",
    "You own the code and the decision: use what helps, ignore what does not.",
    "",
    record.diagnosis ?? "(no diagnosis text was recorded)",
    "",
    "END ADVISORY"
  ].join("\n");
}

export class ConsultantExecutionError extends Error {
  readonly rule: string;
  constructor(rule: string, message: string) {
    super(message);
    this.name = "ConsultantExecutionError";
    this.rule = rule;
  }
}

export interface ConsultantRunnerOptions {
  ports: RuntimePorts;
  effects: EffectsGateway;
  policy: CapabilityPolicy;
  protocol: WorkerProtocol;
  newSessionId(): string;
  /**
   * Optional provider configuration probe, run once before the first prompt.
   * Codex needs the names of inherited MCP servers so they can be disabled;
   * Claude needs nothing. It returns those names, or throws.
   */
  configure?: (session: ConsultantSession) => Promise<string[]>;
  /** Bounded source context, already gathered through READ_FILE policy. */
  sourceContext?: (runId: string) => Promise<string>;
}

/**
 * Executes exactly one read-only diagnosis for an approved consultation.
 *
 * Every rejection is deterministic and happens before any process starts.
 */
export class ConsultantRunner {
  readonly store: ConsultantStore;

  private readonly ports: RuntimePorts;
  private readonly effects: EffectsGateway;
  private readonly policy: CapabilityPolicy;
  private readonly protocol: WorkerProtocol;
  private readonly options: ConsultantRunnerOptions;
  private readonly consultations: ConsultationStore;
  private readonly runStore: AutopilotStore;
  private readonly active = new Set<string>();

  constructor(options: ConsultantRunnerOptions) {
    this.options = options;
    this.ports = options.ports;
    this.effects = options.effects;
    this.policy = options.policy;
    this.protocol = options.protocol;
    this.store = new ConsultantStore(options.ports);
    this.consultations = new ConsultationStore(options.ports);
    this.runStore = new AutopilotStore(options.ports);
  }

  /**
   * Runs the one diagnosis this consultation authorizes.
   *
   * Preconditions, all checked before anything happens: the consultation is
   * APPROVED, belongs to this run, names this consultant, its evidence has not
   * been superseded, PRIMARY still owns implementation, and no diagnosis has
   * already been recorded for it.
   */
  async diagnose(scope: ConsultationScope): Promise<DiagnosisRecord> {
    if (this.active.has(scope.runId)) {
      throw new ConsultantExecutionError("consultant.busy", "A consultant diagnosis is already running for this run.");
    }

    const record = this.consultations.list(scope.runId).find((entry) => entry.id === scope.requestId);
    if (!record) throw new ConsultantExecutionError("consultant.unknown-request", "Consultation does not belong to this run.");
    if (record.consultantProvider !== scope.consultantProvider) {
      throw new ConsultantExecutionError("consultant.provider-mismatch", "Consultation names a different consultant provider.");
    }
    if (record.consultantProvider !== this.protocol.id) {
      throw new ConsultantExecutionError("consultant.adapter-mismatch", "This runner is not the configured consultant.");
    }
    // Covers APPROVED, human-sourced approval, unchanged identity and
    // un-superseded triggering evidence in one deterministic check.
    if (!this.consultations.executionEligible(scope)) {
      throw new ConsultantExecutionError(
        "consultant.not-eligible",
        "This consultation is not approved, or its evidence has been superseded. It authorizes nothing."
      );
    }

    const run = this.runStore.requireRun(scope.runId);
    if (run.spec.workers.primary === scope.consultantProvider) {
      throw new ConsultantExecutionError("consultant.is-primary", "The consultant may not also be the PRIMARY.");
    }
    const cwd = run.spec.capabilities.workspaceRoot;
    if (!cwd) throw new ConsultantExecutionError("consultant.no-workspace", "The run has no validated workspace.");

    const existing = this.store.diagnosis(scope.requestId);
    if (existing && existing.status !== "INTENT") {
      throw new ConsultantExecutionError(
        "consultant.already-executed",
        `This consultation already produced a ${existing.status} diagnosis; it authorizes exactly one.`
      );
    }
    if (existing?.status === "INTENT") {
      // A previous process journaled the send and did not record an outcome.
      // Delivery is unknown, so it is never blindly resent.
      const settled = this.store.settle({
        consultationId: scope.requestId,
        status: "UNCERTAIN",
        failure: "interrupted",
        diagnosis: null
      });
      throw new ConsultantExecutionError(
        "consultant.uncertain-send",
        "A previous consultant send has no confirmed outcome. It will not be resent; resolve it explicitly."
      );
      void settled;
    }

    this.active.add(scope.runId);
    try {
      const session = this.store.startSession({
        runId: scope.runId,
        provider: scope.consultantProvider,
        sessionId: this.options.newSessionId(),
        cwd
      });

      // Provider configuration is discovered before anything is journaled, so
      // a failure here costs the consultation nothing.
      let configured = session;
      if (this.options.configure && configured.disabledMcpServers === null) {
        this.store.recordDisabledMcpServers(scope.runId, scope.consultantProvider, await this.options.configure(configured));
        configured = this.store.session(scope.runId, scope.consultantProvider)!;
      }

      const sourceContext = this.options.sourceContext ? await this.options.sourceContext(scope.runId) : "";
      const prompt = consultantPrompt({
        preview: record.preview,
        triggerType: record.triggerType,
        triggerReason: record.triggerReason,
        consultantProvider: record.consultantProvider,
        sourceContext
      });

      // COMMIT before the process starts.
      this.store.recordIntent({
        runId: scope.runId,
        consultationId: scope.requestId,
        provider: scope.consultantProvider,
        sessionId: configured.sessionId,
        promptLength: prompt.length
      });

      const intent = this.protocol.prompt(
        {
          runId: scope.runId, provider: configured.provider, sessionId: configured.sessionId, cwd,
          established: configured.established, providerSessionId: configured.providerSessionId ?? undefined,
          ...(configured.disabledMcpServers ? { disabledMcpServers: configured.disabledMcpServers } : {})
        },
        prompt
      );

      const outcome = await this.effects.request({
        runId: scope.runId,
        stepKey: `consultant:${scope.requestId}`,
        policy: this.policy,
        intent,
        diagnostics: { provider: scope.consultantProvider, role: "CONSULTANT" },
        onWorkerSession: (providerSessionId) => {
          this.store.bindProviderSession(scope.runId, scope.consultantProvider, providerSessionId);
        }
      });

      if (!("result" in outcome)) {
        return this.store.settle({
          consultationId: scope.requestId,
          status: "FAILED",
          failure: "policy",
          operationId: outcome.operation.id
        });
      }

      const completion = this.protocol.completion(outcome.result, session.sessionId);
      // The process may have exited cleanly while the provider refused the turn
      // (Codex speaks its protocol over stdio and exits 0 either way), so the
      // classified result is what decides whether evidence is kept.
      if (!completion.ok) {
        this.effects.recordProviderFailure({
          runId: scope.runId, stepKey: `consultant:${scope.requestId}`, policy: this.policy,
          operationId: outcome.operation.id, scope: { provider: scope.consultantProvider, role: "CONSULTANT" },
          failure: completion.failure ?? "process", result: outcome.result
        });
      }
      if (!completion.certain) {
        return this.store.settle({
          consultationId: scope.requestId,
          status: "UNCERTAIN",
          failure: completion.failure ?? "protocol",
          operationId: outcome.operation.id
        });
      }
      if (!completion.ok) {
        return this.store.settle({
          consultationId: scope.requestId,
          status: "FAILED",
          failure: completion.failure ?? "process",
          operationId: outcome.operation.id
        });
      }

      // The consultant is read-only. Any file envelope it returned is counted
      // and thrown away — applyWorkerOutput is never reachable from here.
      const parsed = parseWorkerOutput(completion.text);
      if (parsed.files.length > 0) {
        this.runStore.appendEvent(scope.runId, {
          type: "CONSULTANT_OUTPUT_REFUSED",
          payload: {
            consultationId: scope.requestId,
            provider: scope.consultantProvider,
            refusedFileBlocks: parsed.files.length,
            reason: "The consultant is read-only; implementation output is never applied."
          }
        });
      }

      if (completion.sessionConfirmed) this.store.markEstablished(scope.runId, scope.consultantProvider);

      return this.store.settle({
        consultationId: scope.requestId,
        status: "COMPLETED",
        diagnosis: completion.text,
        operationId: outcome.operation.id,
        providerSessionId: completion.providerSessionId ?? null,
        refusedFileBlocks: parsed.files.length
      });
    } finally {
      this.active.delete(scope.runId);
    }
  }
}
