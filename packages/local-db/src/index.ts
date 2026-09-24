import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DexNestEventLogEntry, DexNestEventSource, DexNestEventStatus } from "@dexnest/shared-types";
import {
  AUDIT_STREAM,
  createBetterSqliteAdapter,
  createEventLog,
  runFoundationMigrations,
  type EventLog,
  type SqlDatabase
} from "@dexnest/foundation";

interface CreateLocalDbOptions {
  dataRoot: string;
}

interface AppendEventInput {
  type: string;
  source: string;
  payload: unknown;
}

interface AppendActionEventInput {
  module: string;
  actionId?: string;
  eventType: string;
  status: DexNestEventStatus;
  source: DexNestEventSource;
  summary: string;
  metadataJson?: Record<string, unknown>;
  errorMessage?: string | null;
  durationMs?: number | null;
}

export function createLocalDb(options: CreateLocalDbOptions) {
  const dbDir = join(options.dataRoot, "data");
  const dbPath = join(dbDir, "dexnest.sqlite");
  let db: Database.Database | null = null;
  // One adapter and one event log for the life of the connection. Transaction
  // nesting is tracked per adapter, so every module must be handed this same
  // instance rather than wrapping the connection again.
  let sqlDatabase: SqlDatabase | null = null;
  let eventLog: EventLog | null = null;

  function getDb(): Database.Database {
    if (!db) {
      mkdirSync(dbDir, { recursive: true });
      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
    }

    return db;
  }

  function getSqlDatabase(): SqlDatabase {
    if (!sqlDatabase) sqlDatabase = createBetterSqliteAdapter(getDb() as never);
    return sqlDatabase;
  }

  // The event_log schema is owned by @dexnest/foundation now, so it is defined
  // once. Its first migration is this table exactly as it was always created
  // here, which makes it a no-op on every existing install; the second only
  // adds columns, so existing rows read back unchanged as audit events.
  function initialize(): void {
    runFoundationMigrations(getSqlDatabase());
  }

  /** The shared event log. Requires initialize() to have run. */
  function getEventLog(): EventLog {
    if (!eventLog) eventLog = createEventLog(getSqlDatabase());
    return eventLog;
  }

  function appendEvent(input: AppendEventInput): string {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    getDb()
      .prepare(
        `
          INSERT INTO event_log (id, type, source, payload_json, created_at)
          VALUES (@id, @type, @source, @payloadJson, @createdAt)
        `
      )
      .run({
        id,
        type: input.type,
        source: input.source,
        payloadJson: JSON.stringify(input.payload ?? null),
        createdAt
      });

    return id;
  }

  function appendActionEvent(input: AppendActionEventInput): string {
    return appendEvent({
      type: input.eventType,
      source: input.source,
      payload: {
        module: input.module,
        actionId: input.actionId,
        eventType: input.eventType,
        status: input.status,
        source: input.source,
        summary: input.summary,
        metadataJson: input.metadataJson ?? {},
        errorMessage: input.errorMessage ?? null,
        durationMs: input.durationMs ?? null
      }
    });
  }

  function listRecentEvents(limit = 25): DexNestEventLogEntry[] {
    const rows = getDb()
      .prepare(
        `
          SELECT id, type, source, payload_json AS payloadJson, created_at AS createdAt
          FROM event_log
          WHERE stream = '${AUDIT_STREAM}'
          ORDER BY created_at DESC
          LIMIT @limit
        `
      )
      .all({ limit }) as Array<{
      id: string;
      type: string;
      source: string;
      payloadJson: string;
      createdAt: string;
    }>;

    return rows.map((row) => {
      const payload = JSON.parse(row.payloadJson) as Partial<DexNestEventLogEntry> & Record<string, unknown>;

      return {
        id: row.id,
        type: row.type,
        source: String(payload.source ?? row.source),
        payload,
        createdAt: row.createdAt,
        timestamp: row.createdAt,
        module: String(payload.module ?? "system"),
        actionId: typeof payload.actionId === "string" ? payload.actionId : undefined,
        eventType: String(payload.eventType ?? row.type),
        status: (payload.status ?? "success") as DexNestEventStatus,
        summary: String(payload.summary ?? row.type)
      };
    });
  }

  function countEvents(): number {
    const row = getDb().prepare(`SELECT COUNT(*) AS count FROM event_log WHERE stream = '${AUDIT_STREAM}'`).get() as { count: number };
    return row.count;
  }

  // Clears the audit history while preserving the table/index structure.
  // Used by Settings → Data Management when the Audit history category is
  // deleted. Scoped to the audit stream: a module's observations (repository
  // history, for one) are that module's data and have their own retention, and
  // "delete my activity history" should not silently reset them.
  function clearEvents(): number {
    const before = countEvents();
    getDb().prepare(`DELETE FROM event_log WHERE stream = '${AUDIT_STREAM}'`).run();
    return before;
  }

  // Deletes only event rows whose payload contains the given marker substring.
  // Used to clear demo-seeded audit events (tagged with the demo seedId) without
  // touching real activity. Returns the number of rows removed.
  function deleteEventsWherePayloadContains(needle: string): number {
    const result = getDb().prepare("DELETE FROM event_log WHERE payload_json LIKE ?").run(`%${needle}%`);
    return Number(result.changes ?? 0);
  }

  function close(): void {
    db?.close();
    db = null;
    sqlDatabase = null;
    eventLog = null;
  }

  // Exposes the live connection so other packages (Autopilot) can add their own
  // tables to the SAME database rather than opening a second one. Callers must
  // treat existing tables as read-only and confine themselves to their own
  // namespace; event_log belongs to this module.
  function getDatabase(): Database.Database {
    return getDb();
  }

  return {
    dbPath,
    initialize,
    getDatabase,
    getSqlDatabase,
    getEventLog,
    appendEvent,
    appendActionEvent,
    listRecentEvents,
    countEvents,
    clearEvents,
    deleteEventsWherePayloadContains,
    close
  };
}
