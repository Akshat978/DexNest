// The Dev dashboard's projects.json, in and out.
//
// In: legacyProjectToProject maps one entry of the old file to a Project, as
// tolerantly as the old loader read it (no schema validation existed), and
// keeps the entry verbatim in `legacy` so no field is ever lost - including
// fields a newer DexNest wrote that this code does not know.
//
// Out: projectToLegacy gives back the old DexNestProject shape, so everything
// that called loadProjects() (Stream Deck catalogue, effect choices, search,
// Heatmap, Worklog, voice, the Deck HTTP endpoints) keeps working unchanged.

import {
  COMMAND_SLOTS,
  emptyGitFacts,
  emptyTooling,
  isAccent,
  isProjectId,
  isProjectType,
  normalisePorts,
  slugifyProjectId,
  type CommandSlot,
  type Project,
  type ProjectCommand,
  type ProjectFolder,
  type ProjectLink
} from "./project.ts";

/** The old shape, as main.ts declares it. Every field optional here: the file was never validated. */
export interface LegacyProject {
  id: string;
  name: string;
  path: string;
  description: string;
  accent: string;
  commands: Record<CommandSlot, string>;
  urls: string[];
  notes: string;
  ports?: number[];
  stopCommand?: string;
  logCommand?: string;
  logPath?: string;
  dockerComposeEnabled?: boolean;
  healthUrl?: string;
  projectType?: string;
  folders?: ProjectFolder[];
  links?: ProjectLink[];
  commandList?: Array<{ id: string; label: string; command: string; requiresConfirmation?: boolean }>;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
  [extra: string]: unknown;
}

export type LegacyEntryResult = { ok: true; project: Project } | { ok: false; index: number; reason: string };

export interface LegacyImportResult {
  projects: Project[];
  skipped: Array<{ index: number; reason: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayOf<T>(value: unknown, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const mapped = map(item);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function deepCopy(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export interface LegacyImportContext {
  now: string;
  newCommandId: () => string;
}

/** Map one projects.json entry. `takenIds` grows as entries are accepted, so duplicate ids get -2, -3. */
export function legacyProjectToProject(
  entry: unknown,
  index: number,
  takenIds: Set<string>,
  ctx: LegacyImportContext
): LegacyEntryResult {
  if (!isRecord(entry)) return { ok: false, index, reason: "not an object" };
  const name = str(entry.name);
  const path = str(entry.path);
  if (!name || !path) return { ok: false, index, reason: "missing name or path" };

  const rawId = str(entry.id);
  let id = rawId && isProjectId(rawId) ? rawId : slugifyProjectId(name);
  if (takenIds.has(id)) {
    let n = 2;
    while (takenIds.has(`${id}-${n}`)) n += 1;
    id = `${id}-${n}`;
  }
  takenIds.add(id);

  const commandsIn = isRecord(entry.commands) ? entry.commands : {};
  const commands = {} as Record<CommandSlot, string>;
  for (const slot of COMMAND_SLOTS) commands[slot] = str(commandsIn[slot]);

  const usedCommandIds = new Set<string>();
  const commandList = arrayOf<ProjectCommand>(entry.commandList, (item) => {
    if (!isRecord(item)) return null;
    const label = str(item.label);
    const command = str(item.command);
    if (!label || !command) return null;
    let commandId = typeof item.id === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(item.id) ? item.id : ctx.newCommandId();
    while (usedCommandIds.has(commandId)) commandId = ctx.newCommandId();
    usedCommandIds.add(commandId);
    return { id: commandId, label, command, requiresConfirmation: item.requiresConfirmation === true };
  });

  const createdAt = str(entry.createdAt) || ctx.now;
  const lastOpenedAt = strOrNull(entry.lastOpenedAt);
  const project: Project = {
    id,
    name,
    path,
    realPath: null,
    description: str(entry.description),
    accent: isAccent(entry.accent) ? entry.accent : "dev",
    projectType: isProjectType(entry.projectType) ? entry.projectType : null,
    groupId: null,
    tags: [],
    favourite: false,
    pinned: false,
    archivedAt: null,
    notes: typeof entry.notes === "string" ? entry.notes : "",
    commands,
    commandList,
    localUrls: arrayOf(entry.urls, (url) => (typeof url === "string" && url.trim() ? url.trim() : null)),
    links: arrayOf(entry.links, (link) =>
      isRecord(link) && str(link.url) ? { label: str(link.label) || str(link.url), url: str(link.url) } : null
    ),
    folders: arrayOf(entry.folders, (folder) =>
      isRecord(folder) && str(folder.path) ? { label: str(folder.label) || str(folder.path), path: str(folder.path) } : null
    ),
    ports: normalisePorts(Array.isArray(entry.ports) ? entry.ports.filter((p): p is number | string => typeof p === "number" || typeof p === "string") : []),
    healthUrl: str(entry.healthUrl),
    stopCommand: str(entry.stopCommand),
    logCommand: str(entry.logCommand),
    logPath: str(entry.logPath),
    dockerCompose: entry.dockerComposeEnabled === true,
    deployedBranch: null,
    git: emptyGitFacts(),
    tooling: emptyTooling(),
    createdAt,
    updatedAt: str(entry.updatedAt) || createdAt,
    lastOpenedAt,
    lastActivityAt: lastOpenedAt,
    legacy: deepCopy(entry)
  };
  return { ok: true, project };
}

/** Map a whole parsed projects.json. Anything that is not an array imports nothing. */
export function importLegacyProjects(parsed: unknown, ctx: LegacyImportContext, existingIds: Iterable<string> = []): LegacyImportResult {
  if (!Array.isArray(parsed)) return { projects: [], skipped: [{ index: -1, reason: "projects.json is not a list" }] };
  const taken = new Set<string>(existingIds);
  const projects: Project[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];
  parsed.forEach((entry, index) => {
    const result = legacyProjectToProject(entry, index, taken, ctx);
    if (result.ok) projects.push(result.project);
    else skipped.push({ index: result.index, reason: result.reason });
  });
  return { projects, skipped };
}

/**
 * The old DexNestProject shape. Starts from the verbatim legacy entry (so
 * fields this code does not know survive), then writes every known field from
 * the current project. Optional fields are omitted when empty, as the old
 * upsert left them.
 */
export function projectToLegacy(project: Project): LegacyProject {
  const out: LegacyProject = {
    ...(project.legacy ?? {}),
    id: project.id,
    name: project.name,
    path: project.path,
    description: project.description,
    accent: project.accent,
    commands: { ...project.commands },
    urls: [...project.localUrls],
    notes: project.notes,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
  const optional: Array<[keyof LegacyProject, unknown, boolean]> = [
    ["lastOpenedAt", project.lastOpenedAt, project.lastOpenedAt !== null],
    ["ports", [...project.ports], project.ports.length > 0],
    ["stopCommand", project.stopCommand, project.stopCommand !== ""],
    ["logCommand", project.logCommand, project.logCommand !== ""],
    ["logPath", project.logPath, project.logPath !== ""],
    ["dockerComposeEnabled", project.dockerCompose, project.dockerCompose],
    ["healthUrl", project.healthUrl, project.healthUrl !== ""],
    ["projectType", project.projectType, project.projectType !== null],
    ["folders", project.folders.map((f) => ({ ...f })), project.folders.length > 0],
    ["links", project.links.map((l) => ({ ...l })), project.links.length > 0],
    [
      "commandList",
      project.commandList.map((c) => (c.requiresConfirmation ? { ...c } : { id: c.id, label: c.label, command: c.command })),
      project.commandList.length > 0
    ]
  ];
  for (const [key, value, present] of optional) {
    if (present) out[key] = value;
    else if (project.legacy && key in project.legacy) out[key] = value;
    else delete out[key];
  }
  return out;
}
