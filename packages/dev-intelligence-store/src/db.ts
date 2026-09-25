/**
 * The narrow SQL surface the Developer Intelligence stores were written against,
 * now over DexNest's shared connection.
 *
 * The stores came from a sql.js implementation whose helper exposed
 * run/get/all/exec with positional parameters, and a persist() that re-exported
 * the entire database to disk after every write. Keeping the same method names
 * let the store SQL move across unchanged; what is gone is persist(). On the
 * shared better-sqlite3 connection every committed statement is already
 * durable through SQLite's WAL journal, so there is nothing to flush and no
 * whole-database rewrite anywhere.
 */

import type { SqlDatabase } from '@dexnest/foundation';

export type SqlValue = string | number | bigint | boolean | null | undefined | Uint8Array;

export class StoreDb {
  readonly sql: SqlDatabase;

  constructor(sql: SqlDatabase) {
    this.sql = sql;
  }

  exec(statement: string): void {
    this.sql.exec(statement);
  }

  /** Returns the number of rows changed. */
  run(statement: string, params: readonly SqlValue[] = []): number {
    return this.sql.prepare(statement).run(params).changes;
  }

  get<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params: readonly SqlValue[] = [],
  ): T | undefined {
    return this.sql.prepare(statement).get<T>(params);
  }

  all<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params: readonly SqlValue[] = [],
  ): T[] {
    return this.sql.prepare(statement).all<T>(params);
  }
}
