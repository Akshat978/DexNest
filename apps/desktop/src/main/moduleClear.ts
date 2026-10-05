// "Clear data" for GhostOS, ObjectOS and Projects.
//
// These three are cleared through the module's own calls, the same ones their
// screens use, and never by emptying tables: each has things a bare delete
// would get wrong. GhostOS keeps a search index and a record of what a source
// added; ObjectOS has files on disk for each object; Projects records every
// add and remove. Going through the module keeps all of that true, and writes
// the usual lines to the activity log.
//
// Electron-free: main.ts hands in the modules.

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ClearOutcome {
  /** Records removed. */
  records: number;
  /** Files removed from disk. */
  files: number;
  /** What could not be removed, in words. Empty when everything went. */
  problems: string[];
}

// --- GhostOS ---------------------------------------------------------------------

export interface GhostLike {
  status(): { adapters: ReadonlyArray<{ id: string; enabled: boolean }>; counts: { entity: number; relation: number; observation: number } };
  disableAdapter(id: unknown): Parsed<unknown>;
  forget(input: unknown): Parsed<unknown>;
  store: { listEntities(options?: { limit?: number; offset?: number }): ReadonlyArray<{ id: string }> };
}

export function countGhost(module: GhostLike): number {
  const { entity, relation, observation } = module.status().counts;
  return entity + relation + observation;
}

/**
 * Everything GhostOS holds. Sources are turned off first, which takes back
 * what they added and leaves no mark against it, so connecting the
 * repositories again brings those entries back. What is left was entered by
 * hand and is forgotten entry by entry. An entry deleted before this stays
 * deleted.
 */
export function clearGhost(module: GhostLike): ClearOutcome {
  const before = countGhost(module);
  const problems: string[] = [];
  for (const adapter of module.status().adapters) {
    if (!adapter.enabled) continue;
    const off = module.disableAdapter(adapter.id);
    if (!off.ok) problems.push(off.errors.join("; "));
  }
  // Forgetting an entry takes its connections and observations with it, so the list shrinks from the front.
  for (let round = 0; round < 10_000; round += 1) {
    const batch = module.store.listEntities({ limit: 200 });
    if (batch.length === 0) break;
    let removed = 0;
    for (const entity of batch) {
      const gone = module.forget({ kind: "entity", id: entity.id });
      if (gone.ok) removed += 1;
      else problems.push(gone.errors.join("; "));
    }
    // Nothing in a whole batch could be removed: stop rather than loop on it.
    if (removed === 0) break;
  }
  return { records: Math.max(0, before - countGhost(module)), files: 0, problems: problems.slice(0, 5) };
}

// --- ObjectOS --------------------------------------------------------------------

export interface ObjectsLike {
  listObjects(filter?: unknown): Parsed<ReadonlyArray<{ id: string }>>;
  deleteObject(input: unknown): Parsed<{ files: ReadonlyArray<unknown> }>;
  deleteRecord(input: unknown): Parsed<unknown>;
  store: { parts(): ReadonlyArray<{ id: string }> };
}

export function countObjects(module: ObjectsLike): number {
  const listed = module.listObjects();
  return (listed.ok ? listed.value.length : 0) + module.store.parts().length;
}

/** Every object, with its records and its files on disk, and every part. */
export function clearObjects(module: ObjectsLike): ClearOutcome {
  const problems: string[] = [];
  let records = 0;
  let files = 0;
  const listed = module.listObjects();
  if (!listed.ok) return { records: 0, files: 0, problems: listed.errors.slice(0, 5) };
  for (const object of listed.value) {
    const gone = module.deleteObject({ id: object.id });
    if (gone.ok) {
      records += 1;
      files += gone.value.files.length;
    } else problems.push(gone.errors.join("; "));
  }
  for (const part of module.store.parts()) {
    const gone = module.deleteRecord({ kind: "part", id: part.id });
    if (gone.ok) records += 1;
    else problems.push(gone.errors.join("; "));
  }
  return { records, files, problems: problems.slice(0, 5) };
}

// --- Projects --------------------------------------------------------------------

export interface ProjectsLike {
  list(options?: { includeArchived?: boolean }): ReadonlyArray<{ project: { id: string; archivedAt: string | null } }>;
  archive(projectId: string): unknown;
  remove(projectId: string): void;
  updateSettings(next: unknown): unknown;
}

export function countProjects(module: ProjectsLike): number {
  return module.list({ includeArchived: true }).length;
}

/**
 * Every project leaves DexNest's list. The folders and repositories
 * themselves are not touched. Watching is switched off and its "do not add
 * back" list emptied, so the list stays empty until projects are added again
 * and nothing is held against them when they are.
 */
export function clearProjects(module: ProjectsLike): ClearOutcome {
  const problems: string[] = [];
  let records = 0;
  for (const { project } of module.list({ includeArchived: true })) {
    try {
      // A project is removed only once archived: the same two steps the screen asks for.
      if (project.archivedAt === null) module.archive(project.id);
      module.remove(project.id);
      records += 1;
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "A project could not be removed.");
    }
  }
  try {
    module.updateSettings({ watchedRoots: [], watchSkipped: [] });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Watching could not be switched off.");
  }
  return { records, files: 0, problems: problems.slice(0, 5) };
}
