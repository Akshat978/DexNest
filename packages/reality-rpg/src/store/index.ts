import { runModuleMigrations, type ModuleMigrationResult, type SqlDatabase } from '@dexnest/foundation';
import { RPG_MODULE_ID } from '../domain/events.ts';
import { REALITY_RPG_MIGRATIONS } from './migrations.ts';

export { REALITY_RPG_MIGRATIONS } from './migrations.ts';
export * from './store.ts';

/** Runs Reality RPG's migrations. Call once at startup, after the foundation's. */
export function runRealityRpgMigrations(database: SqlDatabase, now?: string): ModuleMigrationResult {
  return runModuleMigrations(database, RPG_MODULE_ID, REALITY_RPG_MIGRATIONS, now);
}
