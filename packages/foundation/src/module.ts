// What a module declares about itself.
//
// DexNest does not load modules dynamically and is not going to start: views
// are compiled into the renderer, actions into the registry, and wiring lives
// in a `<module>Host.ts` in the main process. Autopilot established the shape -
// a runtime package with injected ports, and a host file that supplies them.
//
// The manifest makes that shape checkable. It lists what a module brings, so a
// host file can be written, and reviewed, against a declaration instead of by
// reading the module's source to find out.

import type { ModuleMigration } from "./migrations.ts";

export interface ModuleView {
  /** Matches the renderer's view id and its `desktop.view.<id>` action. */
  id: string;
  title: string;
}

export interface ModuleJobDeclaration {
  id: string;
  defaultIntervalMs: number;
  heavy: boolean;
}

export interface DexNestModuleManifest {
  /** Lowercase with underscores; also the migration and event module name. */
  id: string;
  title: string;
  /** Tables this module owns share this prefix, e.g. "dev_". */
  tablePrefix: string;
  migrations: readonly ModuleMigration[];
  /** Event streams it writes. Audit writes go through the audit stream only. */
  eventStreams: readonly string[];
  /** Every event type it emits, namespaced (e.g. "dev.commit.observed"). */
  eventTypes: readonly string[];
  /** Registered action ids it contributes. Empty is normal for a read-only module. */
  actionIds: readonly string[];
  views: readonly ModuleView[];
  jobs: readonly ModuleJobDeclaration[];
}

/**
 * Checks a manifest for the mistakes that otherwise surface later and further
 * away: a migration outside the module's table prefix, an event type outside
 * its namespace, a duplicate.
 */
export function validateManifest(manifest: DexNestModuleManifest, eventNamespace: string): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(manifest.id)) problems.push(`id "${manifest.id}" must be lowercase with underscores`);
  if (!/^[a-z][a-z0-9]*_$/.test(manifest.tablePrefix)) problems.push(`tablePrefix "${manifest.tablePrefix}" must end with "_"`);

  const tableNames = /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\w+\s+ON)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  for (const migration of manifest.migrations) {
    for (const match of migration.sql.matchAll(tableNames)) {
      const table = match[1]!;
      if (!table.toLowerCase().startsWith(manifest.tablePrefix)) {
        problems.push(`migration ${migration.version} touches "${table}", outside prefix "${manifest.tablePrefix}"`);
      }
    }
  }

  const seen = new Set<string>();
  for (const type of manifest.eventTypes) {
    if (!type.startsWith(`${eventNamespace}.`)) problems.push(`event type "${type}" is outside namespace "${eventNamespace}."`);
    if (seen.has(type)) problems.push(`event type "${type}" is declared twice`);
    seen.add(type);
  }
  return problems;
}
