/**
 * Test support: the stores on a real SQLite file, never the user's data.
 *
 * `createSqlitePersistence` keeps the name and options the standalone test
 * suites were written against, so those suites run unchanged against the
 * foundation-backed stores. Underneath it is real SQLite (node:sqlite) running
 * the same migrations, the same event log and the same SQL as production; only
 * the driver binding differs, because Electron's better-sqlite3 cannot load
 * under plain Node.
 */

import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import {
  createEventLog,
  createStatementAdapter,
  runFoundationMigrations,
  type EventLog,
  type SqlDatabase,
} from '@dexnest/foundation';
import { assertSafeTestPath } from '@dexnest/foundation/testing';
import { StoreDb } from './db.ts';
import {
  createDevIntelligencePersistence,
  runDevIntelligenceMigrations,
  type DevIntelligencePersistence,
} from './index.ts';

export interface TestPersistence extends DevIntelligencePersistence {
  readonly database: SqlDatabase;
  /** Raw row access, for tests that assert on what landed in the tables. */
  readonly db: StoreDb;
  readonly eventLog: EventLog;
  readonly dbPath: string;
  close(): void;
}

export interface CreateSqlitePersistenceOptions {
  dbPath: string;
  /** Accepted for compatibility with the standalone suites; migrations are embedded now. */
  migrationsDir?: string;
}

export async function createSqlitePersistence(options: CreateSqlitePersistenceOptions): Promise<TestPersistence> {
  const dbPath = assertSafeTestPath(options.dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  const native = new DatabaseSync(dbPath);
  native.exec('PRAGMA journal_mode = WAL');
  native.exec('PRAGMA foreign_keys = ON');
  const database = createStatementAdapter(native);

  runFoundationMigrations(database);
  runDevIntelligenceMigrations(database);
  const eventLog = createEventLog(database);

  let open = true;
  return {
    ...createDevIntelligencePersistence({ database, events: eventLog }),
    database,
    db: new StoreDb(database),
    eventLog,
    dbPath,
    close() {
      if (open) native.close();
      open = false;
    },
  };
}

/** A fresh file path inside `directory`, for tests that manage their own temp dir. */
export function testDbPath(directory: string, name = 'di.sqlite'): string {
  return join(directory, name);
}
