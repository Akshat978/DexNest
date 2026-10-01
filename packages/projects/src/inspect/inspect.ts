// "Add project": look at a folder and pre-fill everything, refuse what must
// be refused, and spot duplicates - before anything is saved.
//
// Refused: a missing path, a file, a drive root, and anything whose written
// or resolved path (junctions, symlinks) is inside DexNest's data root.
// Duplicate: same resolved path as a project, or the same remote repository.
// Only a handful of small top-level files are read (package.json, lockfile
// names, vite config, .env.example, *.code-workspace names) - never `.env`,
// never anything below the top level.

import { basename, dirname, join } from "node:path";

import { comparablePath, type Platform } from "@dexnest/foundation";

import type { Project, ProjectInput, ProjectType } from "../domain/project.ts";
import { normaliseProjectInput } from "../domain/project.ts";
import { parseRemote, stripUrlCredentials } from "../domain/remote.ts";
import { GitReadError, type GitReader } from "../git/reader.ts";
import {
  detectFramework,
  detectPackageManager,
  detectPorts,
  displayNameFromPackage,
  parsePackageJson,
  suggestCommands,
  type PackageJson
} from "./detect.ts";

export interface InspectFsPort {
  /** The path with junctions and symlinks resolved. Throws when it doesn't exist. */
  realpath(path: string): string;
  kind(path: string): "dir" | "file" | "missing";
  /** Entry names directly inside a folder, at most `limit`. */
  list(path: string, limit: number): string[];
  /** A file's text if it exists and is at most `maxBytes`, else null. */
  readText(path: string, maxBytes: number): string | null;
}

export interface DuplicateLookup {
  findByRealPath(realPath: string): Project | null;
  findByRemote(remoteUrl: string): Project | null;
}

export interface InspectDeps {
  fs: InspectFsPort;
  reader: GitReader;
  /** createDataBoundary(...).isSensitive - true inside DexNest's data root, by path or through a link. */
  isSensitive(path: string): boolean;
  store: DuplicateLookup;
  platform?: Platform;
}

export interface InspectFacts {
  isRepo: boolean | null;
  remoteName: string | null;
  remoteUrl: string | null;
  hosting: { kind: "github"; owner: string; repo: string } | null;
  defaultBranch: string | null;
  packageManager: string | null;
  framework: string | null;
  workspaceFile: string | null;
  ports: number[];
  scripts: number;
}

export type InspectRefusalCode = "missing" | "not_a_folder" | "data_root" | "drive_root";

export type InspectResult =
  | { kind: "refused"; code: InspectRefusalCode; reason: string }
  | { kind: "duplicate"; by: "path" | "remote"; existing: { id: string; name: string; archived: boolean }; reason: string }
  | { kind: "ok"; path: string; realPath: string; draft: ProjectInput; facts: InspectFacts; warnings: string[] };

const SMALL = 512 * 1024;

function isDriveRoot(path: string): boolean {
  return dirname(path) === path || /^[A-Za-z]:[\\/]?$/.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path);
}

export interface InspectOptions {
  /** When editing: the project being edited doesn't count as its own duplicate. */
  ignoreProjectId?: string;
}

export async function inspectFolder(rawPath: string, deps: InspectDeps, options: InspectOptions = {}): Promise<InspectResult> {
  const path = rawPath.trim().replace(/^"(.*)"$/, "$1");
  const platform = deps.platform ?? process.platform;
  if (!path) return { kind: "refused", code: "missing", reason: "Choose or paste a folder." };
  // The boundary is checked before anything about the folder is looked at.
  if (deps.isSensitive(path)) return { kind: "refused", code: "data_root", reason: "This folder is inside DexNest's own data folder. Projects never go there." };
  const kind = deps.fs.kind(path);
  if (kind === "missing") return { kind: "refused", code: "missing", reason: "That folder doesn't exist." };
  if (kind === "file") return { kind: "refused", code: "not_a_folder", reason: "That's a file. Choose the project's folder." };
  let real: string;
  try {
    real = deps.fs.realpath(path);
  } catch {
    return { kind: "refused", code: "missing", reason: "That folder can't be opened." };
  }
  if (deps.isSensitive(real)) return { kind: "refused", code: "data_root", reason: "This folder leads into DexNest's own data folder (through a link). Projects never go there." };
  if (isDriveRoot(real)) return { kind: "refused", code: "drive_root", reason: "That's a whole drive. Choose the project's own folder." };
  const realPath = comparablePath(real, platform);

  const sameFolder = deps.store.findByRealPath(realPath);
  if (sameFolder && sameFolder.id !== options.ignoreProjectId) {
    return { kind: "duplicate", by: "path", existing: { id: sameFolder.id, name: sameFolder.name, archived: sameFolder.archivedAt !== null }, reason: `This folder is already a project: ${sameFolder.name}.` };
  }

  const warnings: string[] = [];
  const files = new Set(deps.fs.list(real, 500));
  const pkgParsed = files.has("package.json") ? parsePackageJson(deps.fs.readText(join(real, "package.json"), SMALL)) : null;
  let pkg: PackageJson | null = null;
  if (pkgParsed && !pkgParsed.ok) warnings.push(`${pkgParsed.reason}; scripts weren't read.`);
  else if (files.has("package.json") && pkgParsed === null) warnings.push("package.json is too large to read; scripts weren't read.");
  else if (pkgParsed?.ok) pkg = pkgParsed.value;

  const packageManager = detectPackageManager(pkg, files);
  const { framework, defaultPort } = detectFramework(pkg, files);
  const viteName = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts"].find((f) => files.has(f));
  const ports = detectPorts({
    scripts: pkg?.scripts,
    viteConfig: viteName ? deps.fs.readText(join(real, viteName), SMALL) : null,
    envExample: files.has(".env.example") ? deps.fs.readText(join(real, ".env.example"), 64 * 1024) : null,
    defaultPort
  });
  const workspaceFile = [...files].filter((f) => f.endsWith(".code-workspace")).sort()[0] ?? null;
  const suggested = suggestCommands(pkg, packageManager);

  let isRepo: boolean | null = null;
  let remoteName: string | null = null;
  let remoteUrl: string | null = null;
  let defaultBranch: string | null = null;
  try {
    const state = await deps.reader.readRepoState(real);
    isRepo = state.isRepo;
    if (state.isRepo) {
      const remote = state.remotes.find((r) => r.name === "origin") ?? state.remotes[0] ?? null;
      remoteName = remote?.name ?? null;
      remoteUrl = remote ? stripUrlCredentials(remote.url) : null;
      defaultBranch = state.defaultBranch ?? state.head.branch;
    }
  } catch (error) {
    warnings.push(error instanceof GitReadError ? `Git couldn't read this folder: ${error.message}` : "Git couldn't read this folder.");
  }
  const parsedRemote = remoteUrl ? parseRemote(remoteUrl) : null;
  const hosting = parsedRemote?.hosting === "github" && parsedRemote.owner && parsedRemote.repo ? { kind: "github" as const, owner: parsedRemote.owner, repo: parsedRemote.repo } : null;

  if (remoteUrl) {
    const sameRemote = deps.store.findByRemote(remoteUrl);
    if (sameRemote && sameRemote.id !== options.ignoreProjectId) {
      return {
        kind: "duplicate",
        by: "remote",
        existing: { id: sameRemote.id, name: sameRemote.name, archived: sameRemote.archivedAt !== null },
        reason: `${sameRemote.name} is already a project for the same repository (${parsedRemote ? `${parsedRemote.host}/${parsedRemote.path}` : "same remote"}).`
      };
    }
  }

  const name = displayNameFromPackage(pkg?.name) ?? hosting?.repo ?? basename(real);
  const projectType: ProjectType = framework === "Expo" || framework === "React Native" || framework === "Flutter" ? "mobile_app" : "local_app";
  const draft: ProjectInput = {
    name,
    path,
    description: typeof pkg?.description === "string" ? pkg.description.trim().slice(0, 500) : "",
    accent: "dev",
    projectType,
    commands: suggested.commands,
    commandList: suggested.commandList,
    ports,
    localUrls: ports.map((port) => `http://localhost:${port}`),
    git: { isRepo, remoteName, remoteUrl, hosting, defaultBranch },
    tooling: { packageManager, framework, workspaceFile }
  };
  return {
    kind: "ok",
    path,
    realPath,
    draft,
    facts: { isRepo, remoteName, remoteUrl, hosting, defaultBranch, packageManager, framework, workspaceFile, ports, scripts: Object.keys(typeof pkg?.scripts === "object" && pkg.scripts ? pkg.scripts : {}).length },
    warnings
  };
}

export interface SaveContext {
  now: string;
  newCommandId: () => string;
  takenIds: ReadonlySet<string>;
}

export interface ProjectSaver extends DuplicateLookup {
  save(project: Project): void;
}

export type SaveResult =
  | { ok: true; project: Project }
  | { ok: false; reason: string; duplicateOf?: { id: string; name: string } };

/**
 * Save what the owner reviewed. The folder is inspected again first, so a
 * duplicate or a boundary problem that appeared since the form opened is
 * still refused; the owner's edits to the draft win over the inspection.
 */
export async function saveInspectedProject(input: ProjectInput, deps: InspectDeps & { store: ProjectSaver }, ctx: SaveContext): Promise<SaveResult> {
  const inspected = await inspectFolder(String(input.path ?? ""), deps);
  if (inspected.kind === "refused") return { ok: false, reason: inspected.reason };
  if (inspected.kind === "duplicate") return { ok: false, reason: inspected.reason, duplicateOf: { id: inspected.existing.id, name: inspected.existing.name } };
  const merged: ProjectInput = { ...inspected.draft, ...input, git: { ...inspected.draft.git, ...(input.git ?? {}) }, tooling: { ...inspected.draft.tooling, ...(input.tooling ?? {}) } };
  const result = normaliseProjectInput(merged, { existing: null, takenIds: ctx.takenIds, now: ctx.now, newCommandId: ctx.newCommandId });
  if (!result.ok) return { ok: false, reason: result.error };
  const project: Project = { ...result.project, realPath: inspected.realPath, lastActivityAt: ctx.now };
  deps.store.save(project);
  return { ok: true, project };
}

// --- Developer Intelligence suggestions ------------------------------------------

/** What the host reads from Developer Intelligence's store (read methods only). */
export interface DiscoveredRepository {
  id: string;
  path: string;
  displayName: string | null;
  lastSeenAt: string;
}

export interface DiscoveredReposPort {
  list(): Promise<DiscoveredRepository[]>;
}

export interface Suggestion {
  discoveredId: string;
  path: string;
  name: string;
  lastSeenAt: string;
}

/** Repositories Developer Intelligence found that aren't projects yet (archived ones count as projects). */
export async function listSuggestions(
  port: DiscoveredReposPort,
  deps: { fs: Pick<InspectFsPort, "realpath" | "kind">; isSensitive(path: string): boolean; projects: readonly Project[]; platform?: Platform }
): Promise<Suggestion[]> {
  const platform = deps.platform ?? process.platform;
  const known = new Set<string>();
  for (const p of deps.projects) {
    if (p.realPath) known.add(p.realPath);
    known.add(comparablePath(p.path, platform));
  }
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const repo of await port.list()) {
    if (deps.isSensitive(repo.path) || deps.fs.kind(repo.path) !== "dir") continue;
    let real: string;
    try {
      real = deps.fs.realpath(repo.path);
    } catch {
      continue;
    }
    if (deps.isSensitive(real)) continue;
    const key = comparablePath(real, platform);
    if (known.has(key) || known.has(comparablePath(repo.path, platform)) || seen.has(key)) continue;
    seen.add(key);
    out.push({ discoveredId: repo.id, path: repo.path, name: repo.displayName ?? basename(real), lastSeenAt: repo.lastSeenAt });
  }
  return out.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.name.localeCompare(b.name));
}

export interface AddManyResult {
  added: Project[];
  skipped: Array<{ path: string; reason: string }>;
}

/** "Add selected": each one inspected and saved as-is; refusals and duplicates are reported, not fatal. */
export async function addSuggestions(paths: readonly string[], deps: InspectDeps & { store: ProjectSaver & { ids(): Set<string> } }, ctx: Omit<SaveContext, "takenIds">): Promise<AddManyResult> {
  const out: AddManyResult = { added: [], skipped: [] };
  for (const path of paths) {
    const result = await saveInspectedProject({ path }, deps, { ...ctx, takenIds: deps.store.ids() });
    if (result.ok) out.added.push(result.project);
    else out.skipped.push({ path, reason: result.reason });
  }
  return out;
}
