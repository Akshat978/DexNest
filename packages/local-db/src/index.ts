import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DexNestEventLogEntry, DexNestEventSource, DexNestEventStatus } from "@dexnest/shared-types";

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

  function getDb(): Database.Database {
    if (!db) {
      mkdirSync(dbDir, { recursive: true });
      db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
    }

    return db;
  }

  function initialize(): void {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_created_at
        ON event_log (created_at);
    `);
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

  function close(): void {
    db?.close();
    db = null;
  }

  return {
    dbPath,
    initialize,
    appendEvent,
    appendActionEvent,
    listRecentEvents,
    close
  };
}
