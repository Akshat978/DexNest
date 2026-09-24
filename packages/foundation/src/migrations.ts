// Per-module schema migrations in the one shared database.
//
// Every module owns a namespace of tables (autopilot_*, dev_*, standup_*) and a
// list of numbered migrations. The applied set is recorded per module in one
// table, so a module's history can be read without knowing how any other module
// names its tables.
//
// Autopilot predates this and keeps its own autopilot_schema_migrations table.
// Moving it would rewrite migration history in a live database for no gain, so
// it stays; new modules use this runner.

import { withTransaction, type SqlDatabase } from "./sql.ts";

export interface ModuleMigration {
  /** Positive, unique within the module, applied in ascending order. */
  version: number;
  name: string;
  sql: string;
}

export interface ModuleMigrationResult {
  applied: number[];
  alreadyApplied: number[];
}

/** A migration that failed. Its version is NOT recorded, so it runs again next start. */
export class ModuleMigrationError extends Error {
  readonly code = "MODULE_MIGRATION_FAILED";
  readonly module: string;
  readonly version: number;
  readonly migrationName: string;

  constructor(module: string, version: number, migrationName: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${module} migration ${version} (${migrationName}) failed and was rolled back: ${reason}`);
    this.name = "ModuleMigrationError";
    this.module = module;
    this.version = version;
    this.migrationName = migrationName;
    if (cause instanceof Error) this.cause = cause;
  }
}

const LEDGER = `
  CREATE TABLE IF NOT EXISTS dexnest_module_migrations (
    module     TEXT NOT NULL,
    version    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (module, version)
  );
`;

const MODULE_ID = /^[a-z][a-z0-9_]*$/;

/**
 * Applies `migrations` for `module` that have not been applied yet.
 *
 * Each migration and its ledger row commit together or not at all: a failed
 * migration leaves no half-built tables and no record claiming it ran. That is
 * what makes a crash during an upgrade safe to simply restart.
 *
 * Migrations must not issue their own BEGIN/COMMIT - the runner owns the
 * transaction, and SQLite cannot nest them.
 */
export function runModuleMigrations(
  db: SqlDatabase,
  module: string,
  migrations: readonly ModuleMigration[],
  now: string = new Date().toISOString()
): ModuleMigrationResult {
  if (!MODULE_ID.test(module)) {
    throw new Error(`Module id "${module}" must be lowercase letters, digits and underscores.`);
  }

  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`${module} migration "${migration.name}" has an invalid version ${migration.version}.`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`${module} declares migration version ${migration.version} twice.`);
    }
    // Transaction statements only. A trigger body is also `BEGIN ... END;`, but
    // its BEGIN is never followed directly by a semicolon, which these are.
    if (/^\s*(BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(\s+TRANSACTION)?|COMMIT(\s+TRANSACTION)?|ROLLBACK(\s+TRANSACTION)?)\s*;/im.test(migration.sql)) {
      throw new Error(`${module} migration ${migration.version} manages its own transaction; the runner owns it.`);
    }
    seen.add(migration.version);
  }

  db.exec(LEDGER);
  const appliedRows = db
    .prepare("SELECT version FROM dexnest_module_migrations WHERE module = ?")
    .all<{ version: number }>([module]);
  const appliedVersions = new Set(appliedRows.map((row) => Number(row.version)));

  const applied: number[] = [];
  const alreadyApplied: number[] = [];

  for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
    if (appliedVersions.has(migration.version)) {
      alreadyApplied.push(migration.version);
      continue;
    }
    try {
      withTransaction(db, () => {
        db.exec(migration.sql);
        db.prepare(
          "INSERT INTO dexnest_module_migrations (module, version, name, applied_at) VALUES (?, ?, ?, ?)"
        ).run([module, migration.version, migration.name, now]);
      });
    } catch (error) {
      throw new ModuleMigrationError(module, migration.version, migration.name, error);
    }
    applied.push(migration.version);
  }

  return { applied, alreadyApplied };
}

/** Which of `migrations` are recorded as applied, without changing anything. */
export function inspectModuleMigrations(
  db: SqlDatabase,
  module: string,
  migrations: readonly ModuleMigration[]
): { applied: number[]; pending: number[] } {
  db.exec(LEDGER);
  const applied = db
    .prepare("SELECT version FROM dexnest_module_migrations WHERE module = ? ORDER BY version")
    .all<{ version: number }>([module])
    .map((row) => Number(row.version));
  const appliedSet = new Set(applied);
  return {
    applied,
    pending: migrations.map((migration) => migration.version).filter((version) => !appliedSet.has(version))
  };
}
