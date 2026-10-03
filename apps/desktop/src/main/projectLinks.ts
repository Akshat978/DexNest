// Projects is the one list of projects. These are the two ways the rest of
// the main process leans on it: the repository scan follows it, and anything
// that shows a project by folder calls it what Projects calls it.
//
// No imports: pure functions over the shape Projects' list already has.

interface ListedProject {
  project: { name: string; path: string; git?: { isRepo: boolean | null } };
}

/** Projects that are Git repositories, as the scan takes them. Archived ones are not listed, so not scanned. */
export function linkedProjectRepositories(projects: ReadonlyArray<ListedProject>): Array<{ path: string; domain: "windows"; displayName: string }> {
  return projects
    .filter(({ project }) => project.git?.isRepo !== false && project.path.trim().length > 0)
    .map(({ project }) => ({ path: project.path, domain: "windows" as const, displayName: project.name }));
}

/** What Projects calls the project at a folder, whatever the slashes or case; null when it is not a project. */
export function projectNameForPath(projects: ReadonlyArray<ListedProject>, folder: string): string | null {
  const key = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const wanted = key(folder);
  return projects.find(({ project }) => key(project.path) === wanted)?.project.name ?? null;
}
