// A project: everything the Dev dashboard's DexNestProject held, plus what
// Projects adds (group, tags, favourite, pinned, archive, git facts, tooling).
//
// normaliseProjectInput keeps the old upsertProject rules (main.ts) exactly:
// name and path required, ids from a slug with -2/-3 on collision, ports
// 1-65535, omitted fields keep the stored value, commandList ids kept when
// valid. Stream Deck cards address commands by those ids, so they never move.

import { checkBranchName } from "./names.ts";

export const COMMAND_SLOTS = ["start", "build", "test", "typecheck", "custom"] as const;
export type CommandSlot = (typeof COMMAND_SLOTS)[number];

export const PROJECT_TYPES = ["local_app", "live_website", "mobile_app", "external_server"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Accent names map to `--accent-<name>` tokens; never a colour value. */
export const ACCENTS = [
  "dev", "command", "deck", "clipboard", "drop", "tools", "vault", "search", "capture",
  "journal", "calendar", "timetable", "utilities", "weather", "news", "finder", "finance",
  "heatmap", "loop", "voice"
] as const;
export type Accent = (typeof ACCENTS)[number];

export interface ProjectCommand {
  id: string;
  label: string;
  command: string;
  requiresConfirmation: boolean;
}

export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectFolder {
  label: string;
  path: string;
}

export interface HostingRef {
  kind: "github";
  owner: string;
  repo: string;
}

export interface ProjectGitFacts {
  /** null until inspected. */
  isRepo: boolean | null;
  remoteName: string | null;
  /** Always credential-free. */
  remoteUrl: string | null;
  hosting: HostingRef | null;
  defaultBranch: string | null;
}

export interface ProjectTooling {
  packageManager: string | null;
  framework: string | null;
  workspaceFile: string | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  /** The path with junctions and symlinks resolved, set by the host; used for duplicate checks. */
  realPath: string | null;
  description: string;
  accent: Accent;
  projectType: ProjectType | null;
  groupId: string | null;
  tags: string[];
  favourite: boolean;
  pinned: boolean;
  archivedAt: string | null;
  notes: string;
  commands: Record<CommandSlot, string>;
  commandList: ProjectCommand[];
  localUrls: string[];
  links: ProjectLink[];
  folders: ProjectFolder[];
  ports: number[];
  healthUrl: string;
  stopCommand: string;
  logCommand: string;
  logPath: string;
  dockerCompose: boolean;
  /**
   * The branch the owner says is deployed, for a project that is deployed at
   * all; null otherwise. Only a name they chose: DexNest cannot see a server,
   * so it does not know whether a given commit has gone live.
   */
  deployedBranch: string | null;
  git: ProjectGitFacts;
  tooling: ProjectTooling;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  /** Latest of: last commit, last operation, last open. Drives "sort by activity". */
  lastActivityAt: string | null;
  /** The original projects.json entry, verbatim, or null for projects added later. */
  legacy: Record<string, unknown> | null;
}

/** What a form, the wizard or the old save-project bridge sends. Every field but name and path is optional. */
export interface ProjectInput {
  id?: string;
  name?: string;
  path?: string;
  description?: string;
  accent?: string;
  projectType?: string | null;
  groupId?: string | null;
  tags?: string[];
  favourite?: boolean;
  pinned?: boolean;
  notes?: string;
  commands?: Partial<Record<CommandSlot, string>>;
  commandList?: Array<Partial<ProjectCommand>>;
  localUrls?: string[];
  links?: Array<Partial<ProjectLink>>;
  folders?: Array<Partial<ProjectFolder>>;
  ports?: Array<number | string>;
  healthUrl?: string;
  stopCommand?: string;
  logCommand?: string;
  logPath?: string;
  dockerCompose?: boolean;
  /** A branch name, or null / "" to say the project has no deployed branch. */
  deployedBranch?: string | null;
  git?: Partial<ProjectGitFacts>;
  tooling?: Partial<ProjectTooling>;
}

export type NormaliseResult = { ok: true; project: Project; created: boolean } | { ok: false; error: string };

export function slugifyProjectId(name: string, now: () => number = Date.now): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || `project-${now()}`;
}

const COMMAND_ID = /^[a-z0-9][a-z0-9_-]*$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;

export function isProjectId(value: string): boolean {
  return PROJECT_ID.test(value) && value.length <= 120;
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function normalisePorts(ports: ReadonlyArray<number | string> | undefined): number[] {
  if (!ports) return [];
  const out: number[] = [];
  for (const raw of ports) {
    const port = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && !out.includes(port)) out.push(port);
  }
  return out;
}

export function normaliseTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw).trim().replace(/\s+/g, " ").slice(0, 40);
    if (tag && !out.some((existing) => existing.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

export function isAccent(value: unknown): value is Accent {
  return typeof value === "string" && (ACCENTS as readonly string[]).includes(value);
}

export function isProjectType(value: unknown): value is ProjectType {
  return typeof value === "string" && (PROJECT_TYPES as readonly string[]).includes(value);
}

function normaliseCommandList(list: Array<Partial<ProjectCommand>>, newId: () => string): ProjectCommand[] {
  const out: ProjectCommand[] = [];
  const used = new Set<string>();
  for (const entry of list) {
    const label = String(entry.label ?? "").trim();
    const command = String(entry.command ?? "").trim();
    if (!label || !command) continue;
    let id = typeof entry.id === "string" && COMMAND_ID.test(entry.id) ? entry.id : newId();
    while (used.has(id)) id = newId();
    used.add(id);
    out.push({ id, label, command, requiresConfirmation: entry.requiresConfirmation === true });
  }
  return out;
}

function trimmed(value: string | undefined, fallback: string): string {
  return value === undefined ? fallback : String(value).trim();
}

export interface NormaliseContext {
  /** The stored project being edited, or null for a new one. */
  existing: Project | null;
  /** Ids already in use (including archived projects). */
  takenIds: ReadonlySet<string>;
  now: string;
  /** Fresh command id, `cmd_<random>` lowercase. */
  newCommandId: () => string;
  nowMs?: () => number;
}

export function emptyGitFacts(): ProjectGitFacts {
  return { isRepo: null, remoteName: null, remoteUrl: null, hosting: null, defaultBranch: null };
}

export function emptyTooling(): ProjectTooling {
  return { packageManager: null, framework: null, workspaceFile: null };
}

export function normaliseProjectInput(input: ProjectInput, ctx: NormaliseContext): NormaliseResult {
  const prev = ctx.existing;
  const name = trimmed(input.name, prev?.name ?? "");
  const path = trimmed(input.path, prev?.path ?? "");
  if (!name || !path) return { ok: false, error: "Project name and path are required." };

  let id: string;
  if (prev) {
    id = prev.id;
  } else if (input.id !== undefined) {
    const requested = String(input.id).trim();
    if (!isProjectId(requested)) return { ok: false, error: "That project id is not valid." };
    if (ctx.takenIds.has(requested)) return { ok: false, error: `A project with id ${requested} already exists.` };
    id = requested;
  } else {
    id = uniqueId(slugifyProjectId(name, ctx.nowMs), ctx.takenIds);
  }

  const commands = {} as Record<CommandSlot, string>;
  for (const slot of COMMAND_SLOTS) commands[slot] = trimmed(input.commands?.[slot], prev?.commands[slot] ?? "");

  const accent = input.accent === undefined ? prev?.accent ?? "dev" : isAccent(input.accent) ? input.accent : "dev";
  const projectType =
    input.projectType === undefined ? prev?.projectType ?? null : isProjectType(input.projectType) ? input.projectType : null;

  let deployedBranch = prev?.deployedBranch ?? null;
  if (input.deployedBranch !== undefined) {
    const name = input.deployedBranch === null ? "" : String(input.deployedBranch).trim();
    if (name === "") deployedBranch = null;
    else {
      const check = checkBranchName(name);
      if (!check.ok) return { ok: false, error: `Deployed branch: ${check.reason}` };
      deployedBranch = name;
    }
  }

  const links = input.links === undefined
    ? prev?.links ?? []
    : input.links
        .map((link) => ({ label: String(link.label ?? "").trim(), url: String(link.url ?? "").trim() }))
        .filter((link) => link.url)
        .map((link) => ({ label: link.label || link.url, url: link.url }));
  const folders = input.folders === undefined
    ? prev?.folders ?? []
    : input.folders
        .map((folder) => ({ label: String(folder.label ?? "").trim(), path: String(folder.path ?? "").trim() }))
        .filter((folder) => folder.path)
        .map((folder) => ({ label: folder.label || folder.path, path: folder.path }));

  const project: Project = {
    id,
    name,
    path,
    realPath: prev && prev.path === path ? prev.realPath : null,
    description: trimmed(input.description, prev?.description ?? ""),
    accent,
    projectType,
    groupId: input.groupId === undefined ? prev?.groupId ?? null : input.groupId,
    tags: input.tags === undefined ? prev?.tags ?? [] : normaliseTags(input.tags),
    favourite: input.favourite ?? prev?.favourite ?? false,
    pinned: input.pinned ?? prev?.pinned ?? false,
    archivedAt: prev?.archivedAt ?? null,
    notes: trimmed(input.notes, prev?.notes ?? ""),
    commands,
    commandList: input.commandList === undefined ? prev?.commandList ?? [] : normaliseCommandList(input.commandList, ctx.newCommandId),
    localUrls: input.localUrls === undefined ? prev?.localUrls ?? [] : input.localUrls.map((url) => String(url).trim()).filter(Boolean),
    links,
    folders,
    ports: input.ports === undefined ? prev?.ports ?? [] : normalisePorts(input.ports),
    healthUrl: trimmed(input.healthUrl, prev?.healthUrl ?? ""),
    stopCommand: trimmed(input.stopCommand, prev?.stopCommand ?? ""),
    logCommand: trimmed(input.logCommand, prev?.logCommand ?? ""),
    logPath: trimmed(input.logPath, prev?.logPath ?? ""),
    dockerCompose: input.dockerCompose ?? prev?.dockerCompose ?? false,
    deployedBranch,
    git: { ...(prev?.git ?? emptyGitFacts()), ...(input.git ?? {}) },
    tooling: { ...(prev?.tooling ?? emptyTooling()), ...(input.tooling ?? {}) },
    createdAt: prev?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
    lastOpenedAt: prev?.lastOpenedAt ?? null,
    lastActivityAt: prev?.lastActivityAt ?? null,
    legacy: prev?.legacy ?? null
  };
  return { ok: true, project, created: prev === null };
}
