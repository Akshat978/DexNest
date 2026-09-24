// @dexnest/foundation - what every DexNest module shares.
//
// Deliberately small. It holds only concepts that more than one module
// genuinely needed and that were about to be reinvented per module: the SQLite
// port, per-module migrations, the event log, the data boundary, the host
// capability vocabulary and the module manifest. The action system is not here
// because it already exists, in @dexnest/action-registry.
//
// See docs/DEXNEST_FOUNDATION_ARCHITECTURE.md.

export {
  createBetterSqliteAdapter,
  createStatementAdapter,
  withTransaction,
  inTransaction,
  afterCommit,
  type SqlDatabase,
  type SqlStatement,
  type SqlParams,
  type SqlRunResult,
  type BetterSqliteLike
} from "./sql.ts";

export {
  runModuleMigrations,
  inspectModuleMigrations,
  ModuleMigrationError,
  type ModuleMigration,
  type ModuleMigrationResult
} from "./migrations.ts";

export {
  createEventLog,
  runFoundationMigrations,
  FOUNDATION_MIGRATIONS,
  FOUNDATION_MODULE,
  AUDIT_STREAM,
  type DexNestEvent,
  type AppendEventInput,
  type AppendResult,
  type EventQuery,
  type EventLog,
  type EventListener,
  type EventLogOptions
} from "./events.ts";

export {
  comparablePath,
  isWithin,
  createDataBoundary,
  type DataBoundary,
  type DataBoundaryOptions,
  type Platform
} from "./boundary.ts";

export type {
  ModuleHost,
  ModuleScheduler,
  ScheduledJob,
  JobOccurrence,
  ModuleSettings,
  ModuleLifecycle,
  ModuleActions,
  ActionResult
} from "./host.ts";

export {
  validateManifest,
  type DexNestModuleManifest,
  type ModuleView,
  type ModuleJobDeclaration
} from "./module.ts";
