// The one SQLite surface every module talks to.
//
// Hoisted from @dexnest/autopilot-runtime, where it was proven first: modules
// never import a driver. Production hands them an adapter over the app's single
// better-sqlite3 connection (rebuilt for Electron's ABI); tests hand them an
// adapter over Node's built-in node:sqlite. Both are real SQLite running the
// same SQL, so schemas, constraints and transactions are exercised for real in
// tests even though the native Electron binding cannot load under plain Node.
//
// Autopilot's own SqlDatabase port is structurally a subset of this one, so an
// adapter made here can be passed straight to it.

/** Named (`:name`) or positional (`?`) parameters. Both drivers accept both. */
export type SqlParams = Record<string, unknown> | readonly unknown[];

export interface SqlRunResult {
  changes: number;
  /** rowid of the inserted row, when the statement inserted one. */
  lastInsertRowid: number;
}

export interface SqlStatement {
  run(params?: SqlParams): SqlRunResult;
  get<T>(params?: SqlParams): T | undefined;
  all<T>(params?: SqlParams): T[];
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

/**
 * Converts values neither native driver will bind.
 *
 * better-sqlite3 and node:sqlite both refuse JS booleans and `undefined`, where
 * sql.js quietly accepted them. Code ported from sql.js would otherwise fail at
 * the first `enabled: true`, so the conversion lives here once rather than in
 * every store.
 */
function bindable(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function normalizeParams(params: SqlParams): SqlParams {
  if (Array.isArray(params)) return params.map(bindable);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) out[key] = bindable(value);
  return out;
}

interface NativeStatement {
  run(...params: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** Calls a native statement method with named or positional parameters. */
function call<R>(fn: (...args: unknown[]) => R, params?: SqlParams): R {
  if (params === undefined) return fn();
  const normalized = normalizeParams(params);
  return Array.isArray(normalized) ? fn(...normalized) : fn(normalized);
}

/** Copies a row into an ordinary object (node:sqlite returns null-prototype rows). */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

function wrapStatement(statement: NativeStatement): SqlStatement {
  return {
    run(params) {
      const result = call(statement.run.bind(statement), params);
      return {
        changes: Number(result.changes ?? 0),
        lastInsertRowid: Number(result.lastInsertRowid ?? 0)
      };
    },
    get<T>(params?: SqlParams) {
      const row = call(statement.get.bind(statement), params);
      return row === undefined || row === null ? undefined : plain<T>(row);
    },
    all<T>(params?: SqlParams) {
      return call(statement.all.bind(statement), params).map((row) => plain<T>(row));
    }
  };
}

/**
 * The shape of a better-sqlite3 connection this package relies on.
 *
 * Declared structurally so the foundation never imports the native module: it
 * is loaded once, by @dexnest/local-db, against Electron's ABI.
 */
export interface BetterSqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): NativeStatement;
}

/** Adapts the app's live better-sqlite3 connection. There is no second database. */
export function createBetterSqliteAdapter(db: BetterSqliteLike): SqlDatabase {
  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      return wrapStatement(db.prepare(sql));
    }
  };
}

/** Adapts anything with a node:sqlite-shaped `DatabaseSync` surface. */
export function createStatementAdapter(db: { exec(sql: string): void; prepare(sql: string): unknown }): SqlDatabase {
  return {
    exec(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      return wrapStatement(db.prepare(sql) as NativeStatement);
    }
  };
}

// --- transactions --------------------------------------------------------------

interface TransactionState {
  depth: number;
  afterCommit: Array<() => void>;
}

const transactions = new WeakMap<SqlDatabase, TransactionState>();

/** True while `db` has a transaction open through `withTransaction`. */
export function inTransaction(db: SqlDatabase): boolean {
  return (transactions.get(db)?.depth ?? 0) > 0;
}

/**
 * Runs `work` in a transaction, nesting through savepoints.
 *
 * The outermost call takes `BEGIN IMMEDIATE`, which acquires the write lock up
 * front: a deferred transaction that later tries to write can fail with BUSY
 * after it has already read, which is a worse moment to find out. Inner calls
 * use savepoints, so a store method that is transactional on its own stays
 * correct when a caller wraps several of them together.
 *
 * `work` is synchronous on purpose. SQLite work here is synchronous anyway, and
 * an `await` inside an open transaction would let unrelated writes from another
 * caller land in the middle of it.
 */
export function withTransaction<T>(db: SqlDatabase, work: () => T): T {
  let state = transactions.get(db);
  if (!state) {
    state = { depth: 0, afterCommit: [] };
    transactions.set(db, state);
  }

  const outermost = state.depth === 0;
  const savepoint = `dexnest_sp_${state.depth}`;
  db.exec(outermost ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  state.depth += 1;

  let result: T;
  try {
    result = work();
  } catch (error) {
    state.depth -= 1;
    if (outermost) {
      db.exec("ROLLBACK");
      state.afterCommit = [];
    } else {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw error;
  }

  state.depth -= 1;
  if (!outermost) {
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  }

  db.exec("COMMIT");
  const callbacks = state.afterCommit;
  state.afterCommit = [];
  for (const callback of callbacks) {
    try {
      callback();
    } catch {
      // A listener failing must not undo, or appear to undo, a committed write.
    }
  }
  return result;
}

/**
 * Runs `callback` once the current transaction commits, or now if none is open.
 *
 * Used for anything that announces a write - telling subscribers about an event
 * that is then rolled back would be announcing something that never happened.
 */
export function afterCommit(db: SqlDatabase, callback: () => void): void {
  const state = transactions.get(db);
  if (state && state.depth > 0) {
    state.afterCommit.push(callback);
    return;
  }
  try {
    callback();
  } catch {
    // Same reasoning as above: a listener cannot fail a write that already happened.
  }
}
