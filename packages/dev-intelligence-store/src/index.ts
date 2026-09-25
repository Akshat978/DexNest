/**
 * Developer Intelligence and Standup persistence on DexNest's shared foundation.
 *
 * Replaces the standalone build's sql.js store. The domain APIs are unchanged -
 * PersistencePorts and StandupStore from the contracts package - so the scan
 * orchestrator and the Standup engine run on this without modification. What
 * changed is underneath: one shared better-sqlite3 connection in production,
 * namespaced tables, the shared migration ledger, the shared event log, and
 * transactions instead of a whole-database rewrite after every write.
 */

import {
  runModuleMigrations,
  validateManifest,
  type DexNestModuleManifest,
  type EventLog,
  type ModuleMigrationResult,
  type SqlDatabase,
} from '@dexnest/foundation';
import type { PersistencePorts, StandupStore } from '@dexnest/dev-intelligence-contracts';
import { StoreDb } from './db.ts';
import {
  DEV_INTELLIGENCE_MIGRATIONS,
  DEV_INTELLIGENCE_MODULE,
  STANDUP_MIGRATIONS,
  STANDUP_MODULE,
} from './migrations.ts';
import { createEventStore, DEV_STREAM } from './stores/event-store.ts';
import { createRepositoryStore } from './stores/repository-store.ts';
import { createScanRunStore } from './stores/scan-run-store.ts';
import { createTodoStore } from './stores/todo-store.ts';
import { createHealthStore } from './stores/health-store.ts';
import { createTechnologyStore } from './stores/technology-store.ts';
import { createRetentionStore } from './stores/retention-store.ts';
import { createStandupStore } from './stores/standup-store.ts';

export {
  DEV_INTELLIGENCE_MIGRATIONS,
  DEV_INTELLIGENCE_MODULE,
  STANDUP_MIGRATIONS,
  STANDUP_MODULE,
  DEV_STREAM,
};

/** Every event type Developer Intelligence emits. */
export const DEV_EVENT_TYPES = [
  'dev.repo.discovered',
  'dev.repo.snapshot',
  'dev.commit.observed',
  'dev.branch.changed',
  'dev.working_tree.changed',
  'dev.conflict.observed',
  'dev.git_operation.started',
  'dev.git_operation.resolved',
  'dev.todo.observed',
  'dev.todo.resolved',
  'dev.health.completed',
  'dev.technology.observed',
  'dev.technology.removed',
] as const;

export const DEV_INTELLIGENCE_MANIFEST: DexNestModuleManifest = {
  id: DEV_INTELLIGENCE_MODULE,
  title: 'Developer Intelligence',
  tablePrefix: 'dev_',
  migrations: DEV_INTELLIGENCE_MIGRATIONS,
  eventStreams: [DEV_STREAM],
  eventTypes: DEV_EVENT_TYPES,
  // Read-only: it observes repositories and registers no actions.
  actionIds: [],
  views: [],
  jobs: [{ id: 'scan', defaultIntervalMs: 15 * 60 * 1000, heavy: true }],
};

export const STANDUP_MANIFEST: DexNestModuleManifest = {
  id: STANDUP_MODULE,
  title: 'Standup for One',
  tablePrefix: 'standup_',
  migrations: STANDUP_MIGRATIONS,
  // Reports are stored in standup_* tables; Standup writes no events of its own.
  eventStreams: [],
  eventTypes: [],
  actionIds: [],
  views: [],
  jobs: [{ id: 'morning', defaultIntervalMs: 60 * 60 * 1000, heavy: false }],
};

/** Runs both modules' migrations. Call once at startup, after the foundation's. */
export function runDevIntelligenceMigrations(
  database: SqlDatabase,
  now?: string,
): { developerIntelligence: ModuleMigrationResult; standup: ModuleMigrationResult } {
  return {
    developerIntelligence: runModuleMigrations(database, DEV_INTELLIGENCE_MODULE, DEV_INTELLIGENCE_MIGRATIONS, now),
    standup: runModuleMigrations(database, STANDUP_MODULE, STANDUP_MIGRATIONS, now),
  };
}

/** Problems with the two manifests; empty when both are sound. */
export function manifestProblems(): string[] {
  return [...validateManifest(DEV_INTELLIGENCE_MANIFEST, 'dev'), ...validateManifest(STANDUP_MANIFEST, 'standup')];
}

export interface DevIntelligencePersistence extends PersistencePorts {
  readonly standup: StandupStore;
}

/**
 * The stores, over the shared connection and event log.
 * Requires the foundation's and these modules' migrations to have run.
 */
export function createDevIntelligencePersistence(options: {
  database: SqlDatabase;
  events: EventLog;
}): DevIntelligencePersistence {
  const db = new StoreDb(options.database);
  return {
    repositories: createRepositoryStore(db),
    events: createEventStore(db, options.events),
    scanRuns: createScanRunStore(db),
    todos: createTodoStore(db),
    health: createHealthStore(db),
    technologies: createTechnologyStore(db),
    retention: createRetentionStore(db),
    standup: createStandupStore(db),
  };
}
