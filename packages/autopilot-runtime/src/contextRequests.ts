// Durable record of the files a worker asked to see.
//
// The worker has no tools, so when DexNest's deterministic selection misses a
// file the worker's only route is to ask. A request is persisted the moment it
// is parsed, so a crash between the asking turn and the next one cannot lose it:
// the next turn looks for PENDING rows rather than for anything in memory.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";

export type ContextRequestStatus = "PENDING" | "FULFILLED" | "DENIED";
const runtimeIds = new WeakMap<RuntimePorts, string>();

export interface ContextRequest {
  id: string;
  runId: string;
  requestedTurnId: string;
  consumedTurnId: string | null;
  path: string;
  status: ContextRequestStatus;
  denialReason: string | null;
  bytesSupplied: number;
  createdAt: string;
  resolvedAt: string | null;
  requestedRuntimeId: string | null;
  resolvedRuntimeId: string | null;
  bytesUnit: "utf8_bytes" | "legacy_utf16_units";
}

interface RequestRow {
  id: string; run_id: string; requested_turn_id: string; consumed_turn_id: string | null;
  path: string; status: string; denial_reason: string | null; bytes_supplied: number;
  created_at: string; resolved_at: string | null;
  requested_runtime_id: string | null; resolved_runtime_id: string | null;
  bytes_unit: ContextRequest["bytesUnit"];
}

function toRequest(row: RequestRow): ContextRequest {
  return {
    id: row.id, runId: row.run_id, requestedTurnId: row.requested_turn_id,
    consumedTurnId: row.consumed_turn_id, path: row.path, status: row.status as ContextRequestStatus,
    denialReason: row.denial_reason, bytesSupplied: row.bytes_supplied,
    createdAt: row.created_at, resolvedAt: row.resolved_at,
    requestedRuntimeId: row.requested_runtime_id, resolvedRuntimeId: row.resolved_runtime_id, bytesUnit: row.bytes_unit
  };
}

export class ContextRequestStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private runtimeId(): string {
    let id = runtimeIds.get(this.ports);
    if (!id) { id = this.ports.ids.next("context-runtime"); runtimeIds.set(this.ports, id); }
    return id;
  }

  /**
   * Records the paths one turn asked for.
   *
   * The UNIQUE (requested_turn_id, path) index makes a repeated envelope in the
   * same response a no-op rather than a duplicate row.
   */
  record(input: { runId: string; turnId: string; paths: string[] }): ContextRequest[] {
    if (input.paths.length === 0) return [];
    return this.store.transaction(() => {
      const now = this.ports.clock.now();
      for (const path of input.paths) {
        if (this.forTurnAndPath(input.turnId, path)) continue;
        this.db
          .prepare(
            `INSERT INTO autopilot_context_requests
               (id, run_id, requested_turn_id, consumed_turn_id, path, status, denial_reason, bytes_supplied, created_at, requested_runtime_id, bytes_unit)
             VALUES (:id, :runId, :turnId, NULL, :path, 'PENDING', NULL, 0, :now, :runtimeId, 'utf8_bytes')`
          )
          .run({ id: this.ports.ids.next("ctx-req"), runId: input.runId, turnId: input.turnId, path, now, runtimeId: this.runtimeId() });
      }
      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: "CONTEXT_REQUESTED",
        stepKey: input.turnId,
        payload: { turnId: input.turnId, paths: input.paths }
      });
      return this.forTurn(input.turnId);
    });
  }

  private forTurnAndPath(turnId: string, path: string): ContextRequest | null {
    const row = this.db
      .prepare("SELECT * FROM autopilot_context_requests WHERE requested_turn_id = :turnId AND path = :path")
      .get<RequestRow>({ turnId, path });
    return row ? toRequest(row) : null;
  }

  forTurn(turnId: string): ContextRequest[] {
    return this.db
      .prepare("SELECT * FROM autopilot_context_requests WHERE requested_turn_id = :turnId ORDER BY created_at, rowid")
      .all<RequestRow>({ turnId })
      .map(toRequest);
  }

  /** Requests still waiting to be supplied. This is what a restart resumes from. */
  pending(runId: string): ContextRequest[] {
    return this.db
      .prepare("SELECT * FROM autopilot_context_requests WHERE run_id = :runId AND status = 'PENDING' ORDER BY created_at, rowid")
      .all<RequestRow>({ runId })
      .map(toRequest);
  }

  /**
   * Attributes every already-resolved request that has no consuming turn yet.
   *
   * Requests are settled while the next prompt is being built, which is before
   * that turn exists, so the link is completed once it does.
   */
  attributeUnconsumed(runId: string, turnId: string): void {
    this.db
      .prepare(
        `UPDATE autopilot_context_requests
         SET consumed_turn_id = :turnId
         WHERE run_id = :runId AND status != 'PENDING' AND consumed_turn_id IS NULL`
      )
      .run({ runId, turnId });
  }

  list(runId: string): ContextRequest[] {
    return this.db
      .prepare("SELECT * FROM autopilot_context_requests WHERE run_id = :runId ORDER BY created_at, rowid")
      .all<RequestRow>({ runId })
      .map(toRequest);
  }

  resolve(input: {
    requestId: string;
    status: Exclude<ContextRequestStatus, "PENDING">;
    consumedTurnId: string | null;
    bytesSupplied?: number;
    denialReason?: string | null;
  }): ContextRequest {
    return this.store.transaction(() => {
      const now = this.ports.clock.now();
      this.db
        .prepare(
          `UPDATE autopilot_context_requests
           SET status = :status, consumed_turn_id = :consumedTurnId, bytes_supplied = :bytes,
               denial_reason = :reason, resolved_at = :now, resolved_runtime_id = :runtimeId, bytes_unit = 'utf8_bytes'
           WHERE id = :id AND status = 'PENDING'`
        )
        .run({
          id: input.requestId,
          status: input.status,
          consumedTurnId: input.consumedTurnId,
          bytes: input.bytesSupplied ?? 0,
          reason: input.denialReason ?? null,
          now,
          runtimeId: this.runtimeId()
        });

      const row = this.db.prepare("SELECT * FROM autopilot_context_requests WHERE id = :id").get<RequestRow>({ id: input.requestId })!;
      const record = toRequest(row);
      const run = this.store.requireRun(record.runId);
      this.store.appendEventUnsafe(record.runId, run.state, {
        type: record.status === "FULFILLED" ? "CONTEXT_REQUEST_FULFILLED" : "CONTEXT_REQUEST_DENIED",
        payload: {
          requestId: record.id,
          path: record.path,
          bytes: record.bytesSupplied,
          reason: record.denialReason,
          requestedTurnId: record.requestedTurnId,
          consumedTurnId: record.consumedTurnId
        }
      });
      return record;
    });
  }
}
