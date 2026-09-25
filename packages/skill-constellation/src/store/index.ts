import { runModuleMigrations, type ModuleMigrationResult, type SqlDatabase } from '@dexnest/foundation';
import { SKILL_MODULE_ID } from '../domain/events.ts';
import { SKILL_CONSTELLATION_MIGRATIONS } from './migrations.ts';

export { SKILL_CONSTELLATION_MIGRATIONS } from './migrations.ts';
export {
  createSkillStore,
  type SkillStore,
  type BuildRecord,
  type BuildStatus,
  type BuildTrigger,
  type BeginBuildResult,
  type CommitBuildInput,
} from './store.ts';

/** Runs Skill Constellation's migrations. Call once at startup, after the foundation's. */
export function runSkillConstellationMigrations(database: SqlDatabase, now?: string): ModuleMigrationResult {
  return runModuleMigrations(database, SKILL_MODULE_ID, SKILL_CONSTELLATION_MIGRATIONS, now);
}
