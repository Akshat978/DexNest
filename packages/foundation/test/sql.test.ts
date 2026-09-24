// The SQLite port, adapters and transactions, against real SQLite.

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";

import { afterCommit, inTransaction, withTransaction } from "../src/sql.ts";
import { assertSafeTestPath, createTestDatabase, type TestDatabase } from "../src/testing.ts";

let handle: TestDatabase | undefined;
afterEach(() => {
  handle?.dispose();
  handle = undefined;
});

function db() {
  handle = createTestDatabase();
  handle.db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, flag INTEGER)");
  return handle.db;
}

test("positional and named parameters both bind", () => {
  const d = db();
  d.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").run(["a", 1]);
  d.prepare("INSERT INTO t (name, flag) VALUES (:name, :flag)").run({ name: "b", flag: 0 });
  assert.deepEqual(d.prepare("SELECT name FROM t ORDER BY id").all<{ name: string }>().map((row) => row.name), ["a", "b"]);
});

test("booleans and undefined are converted rather than rejected", () => {
  // Both native drivers refuse them; code ported from sql.js passes them freely.
  const d = db();
  d.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").run([undefined, true]);
  const row = d.prepare("SELECT name, flag FROM t").get<{ name: string | null; flag: number }>();
  assert.deepEqual(row, { name: null, flag: 1 });
});

test("rows come back as ordinary objects", () => {
  // node:sqlite returns null-prototype rows; deepEqual and spreading must behave.
  const d = db();
  d.prepare("INSERT INTO t (name) VALUES (?)").run(["x"]);
  const row = d.prepare("SELECT name FROM t").get<object>();
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
});

test("run reports changes and the inserted rowid", () => {
  const d = db();
  const result = d.prepare("INSERT INTO t (name) VALUES (?)").run(["x"]);
  assert.equal(result.changes, 1);
  assert.equal(result.lastInsertRowid, 1);
});

test("a failed transaction leaves nothing behind", () => {
  const d = db();
  assert.throws(() =>
    withTransaction(d, () => {
      d.prepare("INSERT INTO t (name) VALUES (?)").run(["kept?"]);
      throw new Error("boom");
    })
  );
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM t").get<{ n: number }>()!.n, 0);
  assert.equal(inTransaction(d), false);
});

test("a failed inner transaction rolls back only itself", () => {
  // A store method that is transactional on its own must stay correct when a
  // caller wraps several store calls in one outer transaction.
  const d = db();
  withTransaction(d, () => {
    d.prepare("INSERT INTO t (name) VALUES (?)").run(["outer"]);
    assert.throws(() =>
      withTransaction(d, () => {
        d.prepare("INSERT INTO t (name) VALUES (?)").run(["inner"]);
        throw new Error("inner fails");
      })
    );
  });
  assert.deepEqual(d.prepare("SELECT name FROM t").all<{ name: string }>().map((row) => row.name), ["outer"]);
});

test("afterCommit runs after commit, and not at all on rollback", () => {
  const d = db();
  const seen: string[] = [];
  withTransaction(d, () => {
    afterCommit(d, () => seen.push("committed"));
    assert.deepEqual(seen, [], "must not run while the transaction is still open");
  });
  assert.deepEqual(seen, ["committed"]);

  assert.throws(() =>
    withTransaction(d, () => {
      afterCommit(d, () => seen.push("rolled back"));
      throw new Error("no");
    })
  );
  assert.deepEqual(seen, ["committed"]);
});

test("afterCommit outside a transaction runs immediately", () => {
  const d = db();
  let ran = false;
  afterCommit(d, () => { ran = true; });
  assert.equal(ran, true);
});

test("a committed write survives closing and reopening the file", () => {
  const d = db();
  withTransaction(d, () => d.prepare("INSERT INTO t (name) VALUES (?)").run(["durable"]));
  handle!.close();
  const again = handle!.reopen();
  try {
    assert.equal(again.db.prepare("SELECT name FROM t").get<{ name: string }>()!.name, "durable");
  } finally {
    again.close();
  }
});

test("tests refuse the real data root", () => {
  assert.throws(() => assertSafeTestPath("D:/DeskNest/local-data/data"), /real DexNest data root/);
  assert.throws(() => assertSafeTestPath("d:\\desknest\\LOCAL-DATA"), /real DexNest data root|looks like/);
  assert.throws(() => assertSafeTestPath("C:/elsewhere/local-data/x"), /looks like a DexNest data root/);
});
