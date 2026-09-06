import type { RuntimePorts } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import type { WorkerResult } from "./worker.ts";
import { OperationStore } from "./operations.ts";
import { assertPrimary, type WorkerRole } from "./roles.ts";

export interface WorkerSession {
  role?: WorkerRole;
  runId: string;
  provider: string;
  sessionId: string;
  cwd: string;
  established: boolean;
  providerSessionId?: string | null;
  disabledMcpServers?: string[];
}
export type WorkerSendStatus = "INTENT" | "AWAITING_APPROVAL" | "DISPATCHING" | "COMPLETED" | "FAILED" | "UNCERTAIN" | "CANCELLED";
export interface WorkerSend {
  id: string;
  runId: string;
  prompt: string;
  status: WorkerSendStatus;
  operationId: string | null;
  result: WorkerResult | null;
  retryOf?: string | null;
}
export type WorkerResolutionDecision = "completed" | "not_sent" | "keep_unresolved";
export interface WorkerResolution {
  id: string; sendId: string; decision: WorkerResolutionDecision; evidence: string; source: string; createdAt: string;
}
interface SessionRow { run_id: string; provider: string; session_id: string; cwd: string; established: number; provider_session_id: string | null; provider_options_json: string | null }
interface SendRow { id: string; run_id: string; prompt_text: string; status: WorkerSendStatus; operation_id: string | null; result_json: string | null; retry_of: string | null }

/** Uses the existing SQLite connection/journal. Transcript content never enters audit events. */
export class WorkerStore {
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;
  constructor(ports: RuntimePorts) { this.ports = ports; this.store = new AutopilotStore(ports); }

  session(runId: string): WorkerSession | null {
    const row = this.ports.db.prepare("SELECT * FROM autopilot_worker_sessions WHERE run_id=:runId").get<SessionRow>({ runId });
    return row ? { runId: row.run_id, provider: row.provider, sessionId: row.session_id, cwd: row.cwd, established: row.established === 1,
      ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
      ...(row.provider_options_json ? { disabledMcpServers: JSON.parse(row.provider_options_json) as string[] } : {}) } : null;
  }

  ownership(runId: string) {
    const row = this.ports.db.prepare("SELECT role,restored FROM autopilot_worker_sessions WHERE run_id=:runId").get<{role: WorkerRole; restored: number}>({ runId });
    return row ? { role: row.role, restored: row.restored === 1 } : null;
  }

  markRestored(): void {
    this.store.transaction(() => {
      const rows = this.ports.db.prepare("SELECT run_id,session_id FROM autopilot_worker_sessions WHERE restored=0").all<{ run_id: string; session_id: string }>();
      this.ports.db.prepare("UPDATE autopilot_worker_sessions SET restored=1 WHERE restored=0").run();
      for (const row of rows) {
        const run = this.store.requireRun(row.run_id);
        this.store.appendEventUnsafe(row.run_id, run.state, { type: "WORKER_SESSION_RESUMED", payload: { role: "PRIMARY", sessionId: row.session_id, restored: true } });
      }
    });
  }

  recordDisabledMcpServers(runId: string, names: string[]): void {
    if (names.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error("Unsupported MCP configuration name; no worker prompt may be sent.");
    this.store.transaction(() => {
      const session = this.session(runId);
      if (session?.provider !== "codex") throw new Error("Codex session required.");
      const serialized = JSON.stringify([...new Set(names)].sort());
      if (serialized === JSON.stringify(session.disabledMcpServers)) return;
      if (this.pending(runId)) throw new Error("Cannot change worker restrictions with a pending send.");
      this.ports.db.prepare("UPDATE autopilot_worker_sessions SET provider_options_json=:options WHERE run_id=:runId").run({ options: serialized, runId });
      const run = this.store.requireRun(runId);
      this.store.appendEventUnsafe(runId, run.state, { type: "WORKER_CONFIGURATION_RECORDED", payload: { provider: "codex", disabledMcpCount: names.length } });
    });
  }

  bindProviderSession(runId: string, providerSessionId: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerSessionId)) throw new Error("Invalid provider session ID.");
    this.store.transaction(() => {
      const session = this.session(runId);
      if (!session || (session.providerSessionId && session.providerSessionId !== providerSessionId)) throw new Error("Provider session identity may never change.");
      if (session.providerSessionId) return;
      this.ports.db.prepare("UPDATE autopilot_worker_sessions SET provider_session_id=:id WHERE run_id=:runId AND provider_session_id IS NULL").run({ id: providerSessionId, runId });
      const run = this.store.requireRun(runId);
      this.store.appendEventUnsafe(runId, run.state, { type: "WORKER_PROVIDER_SESSION_BOUND", payload: { provider: session.provider, sessionId: session.sessionId, providerSessionId } });
    });
  }

  /**
   * Installs a new PRIMARY session for a new owner, in place.
   *
   * The row is updated rather than replaced because autopilot_worker_sends
   * references autopilot_worker_sessions(run_id): deleting it would cascade away
   * the previous owner's send history. The outgoing session identity is captured
   * in the ownership history before this runs.
   *
   * Unsafe: the caller must already hold the activation transaction.
   */
  replacePrimaryUnsafe(input: { runId: string; provider: string; sessionId: string; cwd: string }): void {
    const now = this.ports.clock.now();
    const changes = this.ports.db
      .prepare(`UPDATE autopilot_worker_sessions
                   SET provider=:provider, session_id=:sessionId, provider_session_id=NULL,
                       provider_options_json=NULL, established=0, restored=0, cwd=:cwd, created_at=:now
                 WHERE run_id=:runId`)
      .run({ runId: input.runId, provider: input.provider, sessionId: input.sessionId, cwd: input.cwd, now });
    if (changes.changes !== 1) {
      this.ports.db
        .prepare(`INSERT INTO autopilot_worker_sessions (run_id,provider,session_id,cwd,established,created_at)
                  VALUES(:runId,:provider,:sessionId,:cwd,0,:now)`)
        .run({ runId: input.runId, provider: input.provider, sessionId: input.sessionId, cwd: input.cwd, now });
    }
    const run = this.store.requireRun(input.runId);
    this.store.appendEventUnsafe(input.runId, run.state, {
      type: "WORKER_SESSION_CREATED",
      payload: { role: "PRIMARY", provider: input.provider, sessionId: input.sessionId, ownershipHandoff: true }
    });
  }

  createSession(session: WorkerSession): WorkerSession {
    assertPrimary(session.role);
    return this.store.transaction(() => {
      const existing = this.session(session.runId);
      if (existing) return existing;
      this.ports.db.prepare(`INSERT INTO autopilot_worker_sessions (run_id,provider,session_id,cwd,established,created_at)
        VALUES (:runId,:provider,:sessionId,:cwd,0,:now)`).run({ runId: session.runId, provider: session.provider,
          sessionId: session.sessionId, cwd: session.cwd, now: this.ports.clock.now() });
      const run = this.store.requireRun(session.runId);
      this.store.appendEventUnsafe(run.id, run.state, { type: "WORKER_SESSION_CREATED",
        payload: { provider: session.provider, sessionId: session.sessionId } });
      return this.session(session.runId)!;
    });
  }

  send(id: string): WorkerSend | null {
    const row = this.ports.db.prepare("SELECT * FROM autopilot_worker_sends WHERE id=:id").get<SendRow>({ id });
    return row ? { id: row.id, runId: row.run_id, prompt: row.prompt_text, status: row.status,
      operationId: row.operation_id, retryOf: row.retry_of, result: row.result_json ? JSON.parse(row.result_json) as WorkerResult : null } : null;
  }

  list(runId: string): WorkerSend[] {
    return this.ports.db.prepare("SELECT id FROM autopilot_worker_sends WHERE run_id=:runId ORDER BY created_at,rowid")
      .all<{id: string}>({ runId }).map(row => this.send(row.id)!);
  }

  resolutions(runId: string): WorkerResolution[] {
    return this.ports.db.prepare(`SELECT r.id,r.send_id AS sendId,r.decision,r.evidence,r.source,r.created_at AS createdAt
      FROM autopilot_worker_resolutions r JOIN autopilot_worker_sends s ON s.id=r.send_id
      WHERE s.run_id=:runId ORDER BY r.created_at,r.rowid`).all<WorkerResolution>({ runId });
  }

  /** Human evidence settles only this send. The original operation is never made dispatchable again. */
  resolve(input: { runId: string; sendId: string; decision: WorkerResolutionDecision; evidence: string }): void {
    if (!["completed", "not_sent", "keep_unresolved"].includes(input.decision)) throw new Error("Invalid resolution.");
    if (typeof input.evidence !== "string" || input.evidence.length > 4000 ||
      (input.decision !== "keep_unresolved" && !input.evidence.trim())) throw new Error("Describe the evidence for this resolution (up to 4000 characters).");
    this.store.transaction(() => {
      const send = this.send(input.sendId);
      const run = this.store.requireRun(input.runId);
      if (!send || send.runId !== run.id) throw new Error("Send does not belong to this run.");
      const final = this.resolutions(run.id).find(r => r.sendId === send.id && r.decision !== "keep_unresolved");
      if (final) {
        if (final.decision === input.decision) return;
        throw new Error("This send already has a final human resolution.");
      }
      if (send.status !== "UNCERTAIN") throw new Error("Only an uncertain send can be resolved.");
      this.ports.db.prepare(`INSERT INTO autopilot_worker_resolutions(id,send_id,decision,evidence,source,created_at)
        VALUES(:id,:sendId,:decision,:evidence,'desktop_ui',:now)`).run({ id: this.ports.ids.next("worker-resolution"),
          sendId: send.id, decision: input.decision, evidence: input.evidence.trim(), now: this.ports.clock.now() });
      if (input.decision !== "keep_unresolved") {
        if (send.operationId) {
          const operations = new OperationStore(this.ports);
          const approval = operations.getApprovalForOperation(send.operationId);
          if (approval?.status === "PENDING") operations.resolveApproval({ approvalId: approval.id, status: "CANCELLED", source: "worker_human_resolution" });
          // Retire the old operation; human evidence never rearms its dispatch claim.
          const operation = operations.require(send.operationId);
          if (!operation.settledAt) operations.updateStatus({ operationId: operation.id, status: "FAILED", resultSummary: "Retired by human worker-send resolution" });
        }
        const completed = input.decision === "completed";
        const result: WorkerResult = { ok: completed, text: send.result?.text || (completed ? "Human confirmed completion; provider output is unavailable." : "Human confirmed not sent; an explicit retry may be prepared."),
          failure: null, sessionId: this.session(run.id)!.sessionId, sessionConfirmed: completed, certain: true };
        this.ports.db.prepare(`UPDATE autopilot_worker_sends SET status=:status,result_json=:result,updated_at=:now WHERE id=:id`)
          .run({ id: send.id, status: completed ? "COMPLETED" : "CANCELLED", result: JSON.stringify(result), now: this.ports.clock.now() });
        if (completed) this.ports.db.prepare("UPDATE autopilot_worker_sessions SET established=1 WHERE run_id=:runId").run({ runId: run.id });
      }
      this.store.appendEventUnsafe(run.id, run.state, { type: "WORKER_SEND_RESOLVED_BY_HUMAN",
        ...(run.state === "NEEDS_REVIEW" && input.decision !== "keep_unresolved" ? { toState: "PAUSED" as const, reconcileReason: null, pauseRequested: false } : {}),
        payload: { sendId: send.id, decision: input.decision, source: "desktop_ui" } });
    });
  }

  pending(runId: string): WorkerSend | null {
    const row = this.ports.db.prepare(`SELECT id FROM autopilot_worker_sends WHERE run_id=:runId
      AND status IN ('INTENT','AWAITING_APPROVAL','DISPATCHING','UNCERTAIN')`).get<{ id: string }>({ runId });
    return row ? this.send(row.id) : null;
  }

  recordIntent(runId: string, id: string, prompt: string, retryOf?: string): WorkerSend {
    return this.store.transaction(() => {
      const existing = this.send(id);
      if (existing) {
        if (existing.runId !== runId || existing.prompt !== prompt) throw new Error("Worker send identity cannot be reused for a different prompt or run.");
        return existing;
      }
      if (this.pending(runId)) throw new Error("Worker already has an unresolved send; reconcile it first.");
      if (retryOf) {
        const original = this.send(retryOf);
        if (!original || original.runId !== runId || original.prompt !== prompt ||
          !this.resolutions(runId).some(r => r.sendId === retryOf && r.decision === "not_sent")) throw new Error("Retry requires a human not-sent resolution for this exact prompt.");
      }
      this.ports.db.prepare(`INSERT INTO autopilot_worker_sends (id,run_id,prompt_text,status,created_at,updated_at,retry_of)
        VALUES (:id,:runId,:prompt,'INTENT',:now,:now,:retryOf)`).run({ id, runId, prompt, retryOf: retryOf ?? null, now: this.ports.clock.now() });
      const run = this.store.requireRun(runId);
      this.store.appendEventUnsafe(runId, run.state, { type: "WORKER_SEND_INTENT", payload: { sendId: id } });
      return this.send(id)!;
    });
  }

  update(id: string, status: WorkerSendStatus, operationId: string | null, result: WorkerResult | null = null): WorkerSend {
    return this.store.transaction(() => {
      const send = this.send(id);
      if (!send) throw new Error("Worker send not found.");
      this.ports.db.prepare(`UPDATE autopilot_worker_sends SET status=:status,operation_id=:operationId,
        result_json=:result,updated_at=:now WHERE id=:id`).run({ id, status, operationId,
          result: result ? JSON.stringify(result) : null, now: this.ports.clock.now() });
      if (result?.sessionConfirmed) {
        this.ports.db.prepare("UPDATE autopilot_worker_sessions SET established=1 WHERE run_id=:runId").run({ runId: send.runId });
      }
      const run = this.store.requireRun(send.runId);
      this.store.appendEventUnsafe(run.id, run.state, {
        type: status === "DISPATCHING" ? "WORKER_SEND_DISPATCHING" : status === "UNCERTAIN" ? "WORKER_SEND_UNCERTAIN" : "WORKER_SEND_RESULT",
        payload: { sendId: id, status, operationId, failure: result?.failure ?? null }
      });
      return this.send(id)!;
    });
  }
}
