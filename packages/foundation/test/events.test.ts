// The shared event log.

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";

import { AUDIT_STREAM, createEventLog, runFoundationMigrations, type DexNestEvent } from "../src/events.ts";
import { withTransaction } from "../src/sql.ts";
import { createTestDatabase, type TestDatabase } from "../src/testing.ts";

let handle: TestDatabase | undefined;
afterEach(() => {
  handle?.dispose();
  handle = undefined;
});

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 8, 24, 12, 0, tick++)).toISOString();

function fresh() {
  handle = createTestDatabase();
  runFoundationMigrations(handle.db);
  return createEventLog(handle.db, { now: clock });
}

const dev = (over: Record<string, unknown> = {}) => ({
  type: "dev.commit.observed",
  stream: "dev",
  module: "developer_intelligence",
  subject: "repo_1",
  source: "scan",
  payload: { sha: "abc" },
  ...over
});

test("upgrades an existing event_log without touching its rows", () => {
  // The real case: every install already has event_log, shaped exactly as
  // @dexnest/local-db has always created it, full of audit rows.
  handle = createTestDatabase();
  const d = handle.db;
  d.exec(`
    CREATE TABLE event_log (id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  d.prepare("INSERT INTO event_log VALUES (?, ?, ?, ?, ?)").run([
    "old-1", "clipboard_saved", "module_ui", JSON.stringify({ summary: "saved" }), "2026-01-01T00:00:00.000Z"
  ]);

  runFoundationMigrations(d);
  const log = createEventLog(d);
  const old = log.get("old-1")!;
  assert.equal(old.stream, AUDIT_STREAM);
  assert.equal(old.module, null);
  assert.equal(old.occurredAt, "2026-01-01T00:00:00.000Z", "falls back to created_at");
  assert.deepEqual(old.payload, { summary: "saved" });
});

test("the old audit insert still works after the upgrade", () => {
  // @dexnest/local-db keeps inserting with its original five columns.
  const log = fresh();
  handle!.db.prepare("INSERT INTO event_log (id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(["a1", "x", "system", "{}", "2026-01-01T00:00:00.000Z"]);
  assert.equal(log.get("a1")!.stream, AUDIT_STREAM);
});

test("an append records the whole envelope", () => {
  const log = fresh();
  const { inserted, event } = log.append(dev({
    id: "evt-1",
    occurredAt: "2026-09-01T10:00:00.000Z",
    sourceIdentity: "scan_7",
    schemaVersion: 1,
    idempotencyKey: "developer_intelligence:fp1"
  }));
  assert.equal(inserted, true);
  assert.equal(event.id, "evt-1");
  assert.equal(event.module, "developer_intelligence");
  assert.equal(event.subject, "repo_1");
  assert.equal(event.occurredAt, "2026-09-01T10:00:00.000Z");
  assert.notEqual(event.recordedAt, event.occurredAt);
  assert.equal(event.sourceIdentity, "scan_7");
  assert.ok(event.seq > 0);
});

test("the same idempotency key records once and returns the original", () => {
  // Re-observing a fact on the next scan must record nothing new.
  const log = fresh();
  const first = log.append(dev({ idempotencyKey: "k1", payload: { n: 1 } }));
  const again = log.append(dev({ idempotencyKey: "k1", payload: { n: 2 } }));
  assert.equal(again.inserted, false);
  assert.equal(again.event.id, first.event.id);
  assert.deepEqual(again.event.payload, { n: 1 });
  assert.equal(log.count({ stream: "dev" }), 1);
});

test("events without a key are never deduplicated", () => {
  const log = fresh();
  log.append(dev());
  log.append(dev());
  assert.equal(log.count({ stream: "dev" }), 2);
});

test("reusing an id under a different key is an error, not a silent duplicate", () => {
  const log = fresh();
  log.append(dev({ id: "same", idempotencyKey: "a" }));
  assert.throws(() => log.append(dev({ id: "same", idempotencyKey: "b" })), /already recorded/);
});

test("appendMany is all or nothing", () => {
  const log = fresh();
  assert.throws(() => log.appendMany([dev({ id: "m1" }), dev({ id: "m1", idempotencyKey: "different" })]));
  assert.equal(log.count({ stream: "dev" }), 0);
});

test("queries filter by stream, module, subject, type and time", () => {
  const log = fresh();
  log.append(dev({ subject: "r1", occurredAt: "2026-09-01T00:00:00.000Z" }));
  log.append(dev({ subject: "r2", occurredAt: "2026-09-02T00:00:00.000Z" }));
  log.append(dev({ subject: "r1", type: "dev.todo.observed", occurredAt: "2026-09-03T00:00:00.000Z" }));
  log.append({ type: "clip", stream: AUDIT_STREAM, module: "clipboard", source: "module_ui", payload: {} });

  assert.equal(log.count({ stream: "dev" }), 3);
  assert.equal(log.count({ stream: "dev", subject: "r1" }), 2);
  assert.equal(log.count({ types: ["dev.todo.observed"] }), 1);
  assert.equal(log.count({ stream: "dev", occurredSince: "2026-09-02T00:00:00.000Z" }), 2);
  assert.equal(log.count({ stream: "dev", occurredBefore: "2026-09-02T00:00:00.000Z" }), 1);
  assert.equal(log.count({ stream: AUDIT_STREAM }), 1);
});

test("seq is a cursor: afterSeq returns only what came later, in order", () => {
  const log = fresh();
  const a = log.append(dev()).event;
  const b = log.append(dev()).event;
  const c = log.append(dev()).event;
  assert.deepEqual(log.query({ afterSeq: a.seq }).map((event) => event.id), [b.id, c.id]);
  assert.deepEqual(log.query({ order: "desc", limit: 1 }).map((event) => event.id), [c.id]);
});

test("prune needs a stream or module and never clears the whole log", () => {
  const log = fresh();
  log.append(dev({ occurredAt: "2026-01-01T00:00:00.000Z" }));
  log.append(dev({ occurredAt: "2026-09-01T00:00:00.000Z" }));
  log.append({ type: "keep", stream: AUDIT_STREAM, module: "system", source: "system", payload: {}, occurredAt: "2025-01-01T00:00:00.000Z" });

  assert.throws(() => log.prune({ occurredBefore: "2027-01-01T00:00:00.000Z" } as never), /stream or a module/);
  assert.equal(log.prune({ stream: "dev", occurredBefore: "2026-06-01T00:00:00.000Z" }), 1);
  assert.equal(log.count(), 2);
});

test("subscribers hear committed events only, and only the ones they asked for", () => {
  const log = fresh();
  const heard: DexNestEvent[] = [];
  const stop = log.subscribe({ stream: "dev", types: ["dev.commit.observed"] }, (event) => heard.push(event));

  log.append(dev());
  log.append(dev({ type: "dev.todo.observed" }));
  assert.throws(() =>
    withTransaction(handle!.db, () => {
      log.append(dev());
      throw new Error("rolled back");
    })
  );
  withTransaction(handle!.db, () => {
    log.append(dev());
    assert.equal(heard.length, 1, "not announced before commit");
  });
  assert.equal(heard.length, 2);

  stop();
  log.append(dev());
  assert.equal(heard.length, 2);
});

test("a replayed idempotent append is not announced again", () => {
  const log = fresh();
  let heard = 0;
  log.subscribe({ stream: "dev" }, () => { heard += 1; });
  log.append(dev({ idempotencyKey: "once" }));
  log.append(dev({ idempotencyKey: "once" }));
  assert.equal(heard, 1);
});

test("events survive a restart", () => {
  const log = fresh();
  log.append(dev({ id: "persisted", idempotencyKey: "p" }));
  handle!.close();
  const again = handle!.reopen();
  try {
    runFoundationMigrations(again.db);
    const reopened = createEventLog(again.db);
    assert.equal(reopened.get("persisted")!.idempotencyKey, "p");
    assert.equal(reopened.append(dev({ idempotencyKey: "p" })).inserted, false);
  } finally {
    again.close();
  }
});

test("recorded-time filters and ordering are independent of occurred time", () => {
  // A fact that happened long ago but was only learned now is "new since the
  // last report" by recorded time, and old by occurred time.
  const log = fresh();
  log.append(dev({ id: "late", occurredAt: "2020-01-01T00:00:00.000Z", recordedAt: "2026-09-10T00:00:00.000Z" }));
  log.append(dev({ id: "early", occurredAt: "2026-09-05T00:00:00.000Z", recordedAt: "2026-09-06T00:00:00.000Z" }));

  assert.deepEqual(log.query({ stream: "dev", recordedSince: "2026-09-08T00:00:00.000Z" }).map((e) => e.id), ["late"]);
  assert.deepEqual(log.query({ stream: "dev", occurredSince: "2026-09-01T00:00:00.000Z" }).map((e) => e.id), ["early"]);
  assert.deepEqual(log.query({ stream: "dev", recordedBefore: "2026-09-08T00:00:00.000Z" }).map((e) => e.id), ["early"]);

  assert.deepEqual(log.query({ stream: "dev", orderBy: "recorded", order: "desc" }).map((e) => e.id), ["late", "early"]);
  assert.deepEqual(log.query({ stream: "dev", orderBy: "occurred", order: "desc" }).map((e) => e.id), ["early", "late"]);
  assert.deepEqual(log.query({ stream: "dev" }).map((e) => e.id), ["late", "early"], "default is insertion order");
});
