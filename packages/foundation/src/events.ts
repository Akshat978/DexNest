// The one event log.
//
// DexNest already had `event_log`: every meaningful action writes to it and the
// Audit view reads it. Modules that observe the world - Developer Intelligence
// first - need more than the audit shape offered: an entity the event is about,
// when the thing happened as opposed to when it was recorded, a schema version,
// and an idempotency key so that re-observing the same fact records nothing.
//
// Rather than each module growing its own events table, those columns are added
// to `event_log` itself. One table, one ordering, one query model; the
// semantics of each event type stay with the module that owns it.
//
// A `stream` separates what people read as activity ("audit") from high-volume
// observations ("dev", and later others). The Audit view keeps showing only the
// audit stream, so a repository scan cannot bury the actions a person took.

import { afterCommit, withTransaction, type SqlDatabase } from "./sql.ts";
import type { ModuleMigration } from "./migrations.ts";
import { runModuleMigrations } from "./migrations.ts";

export const AUDIT_STREAM = "audit";

/** A recorded event. Every module's events share this envelope. */
export interface DexNestEvent<TPayload = unknown> {
  id: string;
  /** Insertion order across the whole log. Stable; use it as a cursor. */
  seq: number;
  /** Namespaced by convention: "dev.commit.observed", "autopilot.run.started". */
  type: string;
  stream: string;
  /** The module that owns this event type. Null only for pre-foundation rows. */
  module: string | null;
  /** The entity it is about (a repository id, a run id). Null when not about one. */
  subject: string | null;
  /** Who produced it: a trigger such as "module_ui", or a module's own source name. */
  source: string;
  /** The producing instance - a scan run, a process. Null when not meaningful. */
  sourceIdentity: string | null;
  /** When the fact happened. Equal to recordedAt when that is all that is known. */
  occurredAt: string;
  /** When it was written here. */
  recordedAt: string;
  schemaVersion: number;
  /** Present for events that must be recorded at most once. */
  idempotencyKey: string | null;
  payload: TPayload;
}

export interface AppendEventInput<TPayload = unknown> {
  /** Generated when absent. Supplying one keeps a module's own event id intact. */
  id?: string;
  type: string;
  stream: string;
  module: string;
  subject?: string | null;
  source: string;
  sourceIdentity?: string | null;
  occurredAt?: string;
  recordedAt?: string;
  schemaVersion?: number;
  /**
   * Makes the append idempotent: a second append with the same key records
   * nothing and returns the event already there. Namespace it by module - the
   * key is unique across the whole log.
   */
  idempotencyKey?: string | null;
  payload: TPayload;
}

export interface AppendResult<TPayload = unknown> {
  /** False when the idempotency key was already recorded. */
  inserted: boolean;
  event: DexNestEvent<TPayload>;
}

export interface EventQuery {
  stream?: string;
  module?: string;
  subject?: string;
  types?: readonly string[];
  /** Inclusive lower bound on occurredAt. */
  occurredSince?: string;
  /** Exclusive upper bound on occurredAt. */
  occurredBefore?: string;
  /**
   * Inclusive lower bound on recordedAt. For consumers that reason about what
   * has been *learned* since a point - Standup's "since the last report" means
   * observed since then, whenever the underlying fact happened.
   */
  recordedSince?: string;
  /** Exclusive upper bound on recordedAt. */
  recordedBefore?: string;
  /** Only events after this seq - the polling cursor. */
  afterSeq?: number;
  limit?: number;
  order?: "asc" | "desc";
  /** Defaults to insertion order (seq). Ties within a timestamp fall back to seq. */
  orderBy?: "seq" | "recorded" | "occurred";
}

export type EventListener = (event: DexNestEvent) => void;

export interface EventLog {
  append<TPayload>(input: AppendEventInput<TPayload>): AppendResult<TPayload>;
  /** All-or-nothing. Idempotent entries already present are skipped, not failed. */
  appendMany(inputs: readonly AppendEventInput[]): AppendResult[];
  get<TPayload = unknown>(id: string): DexNestEvent<TPayload> | undefined;
  findByIdempotencyKey<TPayload = unknown>(key: string): DexNestEvent<TPayload> | undefined;
  query<TPayload = unknown>(filter?: EventQuery): Array<DexNestEvent<TPayload>>;
  count(filter?: EventQuery): number;
  /** Deletes matching events. `stream` or `module` is required - nothing clears the whole log. */
  prune(filter: EventQuery & { occurredBefore: string }): number;
  /**
   * Calls `listener` for each matching event after its write commits.
   * In-process only; returns an unsubscribe function.
   */
  subscribe(filter: Pick<EventQuery, "stream" | "module" | "types">, listener: EventListener): () => void;
}

// --- schema --------------------------------------------------------------------

/**
 * The event log's schema, owned here.
 *
 * Version 1 is the table exactly as @dexnest/local-db has always created it, so
 * it is a no-op on every existing install and a real CREATE in a fresh test
 * database. Version 2 only adds columns and indexes: existing rows are left as
 * they are and read back as audit events with no module.
 */
export const FOUNDATION_MIGRATIONS: readonly ModuleMigration[] = [
  {
    version: 1,
    name: "event_log",
    sql: `
      CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log (created_at);
    `
  },
  {
    version: 2,
    name: "event_log_envelope",
    sql: `
      ALTER TABLE event_log ADD COLUMN stream TEXT NOT NULL DEFAULT 'audit';
      ALTER TABLE event_log ADD COLUMN module TEXT;
      ALTER TABLE event_log ADD COLUMN subject TEXT;
      ALTER TABLE event_log ADD COLUMN source_identity TEXT;
      ALTER TABLE event_log ADD COLUMN occurred_at TEXT;
      ALTER TABLE event_log ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE event_log ADD COLUMN idempotency_key TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_log_idempotency
        ON event_log (idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_event_log_stream_module_subject
        ON event_log (stream, module, subject);
      CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log (type);
      CREATE INDEX IF NOT EXISTS idx_event_log_occurred_at ON event_log (occurred_at);
    `
  }
];

export const FOUNDATION_MODULE = "foundation";

/** Brings the shared schema up to date. Safe on an empty or an existing database. */
export function runFoundationMigrations(db: SqlDatabase, now?: string) {
  return runModuleMigrations(db, FOUNDATION_MODULE, FOUNDATION_MIGRATIONS, now);
}

// --- the log -------------------------------------------------------------------

interface EventRow {
  seq: number;
  id: string;
  type: string;
  stream: string;
  module: string | null;
  subject: string | null;
  source: string;
  source_identity: string | null;
  occurred_at: string | null;
  created_at: string;
  schema_version: number;
  idempotency_key: string | null;
  payload_json: string;
}

const COLUMNS = `rowid AS seq, id, type, stream, module, subject, source, source_identity,
  occurred_at, created_at, schema_version, idempotency_key, payload_json`;

function toEvent<TPayload>(row: EventRow): DexNestEvent<TPayload> {
  return {
    id: row.id,
    seq: Number(row.seq),
    type: row.type,
    stream: row.stream,
    module: row.module,
    subject: row.subject,
    source: row.source,
    sourceIdentity: row.source_identity,
    // Pre-foundation rows only have created_at.
    occurredAt: row.occurred_at ?? row.created_at,
    recordedAt: row.created_at,
    schemaVersion: Number(row.schema_version),
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload_json) as TPayload
  };
}

function where(filter: EventQuery | undefined): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (!filter) return { clause: "", params };
  if (filter.stream !== undefined) { parts.push("stream = ?"); params.push(filter.stream); }
  if (filter.module !== undefined) { parts.push("module = ?"); params.push(filter.module); }
  if (filter.subject !== undefined) { parts.push("subject = ?"); params.push(filter.subject); }
  if (filter.types && filter.types.length > 0) {
    parts.push(`type IN (${filter.types.map(() => "?").join(", ")})`);
    params.push(...filter.types);
  }
  if (filter.occurredSince !== undefined) {
    parts.push("COALESCE(occurred_at, created_at) >= ?");
    params.push(filter.occurredSince);
  }
  if (filter.occurredBefore !== undefined) {
    parts.push("COALESCE(occurred_at, created_at) < ?");
    params.push(filter.occurredBefore);
  }
  if (filter.recordedSince !== undefined) { parts.push("created_at >= ?"); params.push(filter.recordedSince); }
  if (filter.recordedBefore !== undefined) { parts.push("created_at < ?"); params.push(filter.recordedBefore); }
  if (filter.afterSeq !== undefined) { parts.push("rowid > ?"); params.push(filter.afterSeq); }
  return { clause: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}

function matches(event: DexNestEvent, filter: Pick<EventQuery, "stream" | "module" | "types">): boolean {
  if (filter.stream !== undefined && event.stream !== filter.stream) return false;
  if (filter.module !== undefined && event.module !== filter.module) return false;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) return false;
  return true;
}

export interface EventLogOptions {
  now?: () => string;
  newId?: () => string;
}

/**
 * The event log over the shared connection.
 *
 * Assumes the schema is current; call runFoundationMigrations at startup.
 */
export function createEventLog(db: SqlDatabase, options: EventLogOptions = {}): EventLog {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const listeners = new Set<{ filter: Pick<EventQuery, "stream" | "module" | "types">; listener: EventListener }>();

  const selectById = db.prepare(`SELECT ${COLUMNS} FROM event_log WHERE id = ?`);
  const selectByKey = db.prepare(`SELECT ${COLUMNS} FROM event_log WHERE idempotency_key = ?`);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO event_log (
      id, type, source, payload_json, created_at,
      stream, module, subject, source_identity, occurred_at, schema_version, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function notify(event: DexNestEvent): void {
    for (const entry of listeners) {
      if (!matches(event, entry.filter)) continue;
      try {
        entry.listener(event);
      } catch {
        // A subscriber failing is its own problem; the write already happened.
      }
    }
  }

  function appendOne<TPayload>(input: AppendEventInput<TPayload>): AppendResult<TPayload> {
    if (!input.type || !input.stream || !input.module || !input.source) {
      throw new Error("An event needs a type, a stream, a module and a source.");
    }
    const recordedAt = input.recordedAt ?? now();
    const id = input.id ?? newId();
    const key = input.idempotencyKey ?? null;

    const result = insert.run([
      id,
      input.type,
      input.source,
      JSON.stringify(input.payload ?? null),
      recordedAt,
      input.stream,
      input.module,
      input.subject ?? null,
      input.sourceIdentity ?? null,
      input.occurredAt ?? recordedAt,
      input.schemaVersion ?? 1,
      key
    ]);

    if (result.changes === 0) {
      // Either the idempotency key or the id already exists. Only the first is
      // a legitimate replay; a reused id with a different key is a caller bug
      // and must not be reported as a quiet duplicate.
      const existing = key ? selectByKey.get<EventRow>([key]) : undefined;
      if (existing) return { inserted: false, event: toEvent<TPayload>(existing) };
      throw new Error(`Event id ${id} is already recorded with a different idempotency key.`);
    }

    const event = toEvent<TPayload>(selectById.get<EventRow>([id])!);
    afterCommit(db, () => notify(event as DexNestEvent));
    return { inserted: true, event };
  }

  return {
    append: appendOne,

    appendMany(inputs) {
      return withTransaction(db, () => inputs.map((input) => appendOne(input)));
    },

    get<TPayload>(id: string) {
      const row = selectById.get<EventRow>([id]);
      return row ? toEvent<TPayload>(row) : undefined;
    },

    findByIdempotencyKey<TPayload>(key: string) {
      const row = selectByKey.get<EventRow>([key]);
      return row ? toEvent<TPayload>(row) : undefined;
    },

    query<TPayload>(filter?: EventQuery) {
      const { clause, params } = where(filter);
      const order = filter?.order === "desc" ? "DESC" : "ASC";
      const limit = filter?.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : "";
      const key =
        filter?.orderBy === "recorded" ? `created_at ${order}, rowid ${order}`
        : filter?.orderBy === "occurred" ? `COALESCE(occurred_at, created_at) ${order}, rowid ${order}`
        : `rowid ${order}`;
      return db
        .prepare(`SELECT ${COLUMNS} FROM event_log ${clause} ORDER BY ${key} ${limit}`)
        .all<EventRow>(params)
        .map((row) => toEvent<TPayload>(row));
    },

    count(filter?: EventQuery) {
      const { clause, params } = where(filter);
      return Number(db.prepare(`SELECT COUNT(*) AS n FROM event_log ${clause}`).get<{ n: number }>(params)?.n ?? 0);
    },

    prune(filter) {
      if (filter.stream === undefined && filter.module === undefined) {
        throw new Error("Pruning needs a stream or a module; the log is never cleared wholesale from here.");
      }
      const { clause, params } = where(filter);
      return db.prepare(`DELETE FROM event_log ${clause}`).run(params).changes;
    },

    subscribe(filter, listener) {
      const entry = { filter, listener };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    }
  };
}
