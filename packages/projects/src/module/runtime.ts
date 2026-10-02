// The Projects runtime: every entry point the host, IPC and registered
// actions use. Electron-free; the host injects git-ops, the read engine, the
// file system, launchers, Developer Intelligence and the scheduler.
//
// Rules it enforces itself, whatever the caller:
// - an action may only come from the triggers its contract lists (the
//   shell's dispatcher declares allowedTriggers but does not check them);
// - anything not started from the Projects view is non-interactive: it never
//   asks, so whatever would need a confirmation or a choice is refused;
// - a path to open must be the project's own folder or one of its folders,
//   and never inside DexNest's data root;
// - fetch on a schedule only when the owner turned it on; never at startup.

import { comparablePath, type EventLog, type JobOccurrence, type ModuleScheduler, type Platform, type SqlDatabase } from "@dexnest/foundation";

import { projectsAction, triggerAllowed } from "../domain/actions.ts";
import {
  fetchScheduledPayload,
  legacyImportedPayload,
  projectEventPayload,
  PROJECTS_EVENT_STREAM,
  PROJECTS_MODULE_ID,
  type EventPayload,
  type ProjectSource
} from "../domain/events.ts";
import type { CloneRequest, CloneResult, ExecuteResult, GitOpsPort, PreviewResult } from "../domain/gitOpsPort.ts";
import { legacyProjectToProject, projectToLegacy, type LegacyProject } from "../domain/legacy.ts";
import { normaliseProjectInput, type Project, type ProjectInput } from "../domain/project.ts";
import { githubLinks } from "../domain/remote.ts";
import type { RepoState } from "../domain/repoState.ts";
import type { Confirmation } from "../domain/safety.ts";
import { normaliseProjectsSettings, type ProjectsSettings } from "../domain/settings.ts";
import { GitReadError, type DiffStat, type GitReader, type HistoryEntry } from "../git/reader.ts";
import {
  addSuggestions,
  inspectFolder,
  listSuggestions,
  saveInspectedProject,
  type AddManyResult,
  type DiscoveredReposPort,
  type InspectFsPort,
  type InspectResult,
  type SaveResult,
  type Suggestion
} from "../inspect/inspect.ts";
import { findVsCode, terminalCommand, vsCodeCommand, type LaunchCommand, type LaunchEnv } from "../node/launch.ts";
import {
  legacyChangedSinceImport,
  migrateLegacyProjects,
  reimportLegacyProjects,
  type LegacyMigrationResult,
  type LegacyReimportResult,
  type LegacySource
} from "../store/legacyMigration.ts";
import { createProjectsStore, runProjectsMigrations, type FetchState, type OperationRecord, type ProjectGroup, type ProjectsStore } from "../store/store.ts";
import { SCHEDULED_FETCH_JOB_ID } from "./manifest.ts";

export interface LaunchPort {
  env(): LaunchEnv;
  /** Opens a folder in the file manager. Resolves to an error message, or null. */
  openPath(path: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  /** Spawns detached, argv only, never a shell. */
  spawnDetached(command: LaunchCommand): { ok: true } | { ok: false; error: string };
}

/** Standup's "where you left off" for one repository, from Developer Intelligence's data. */
export interface LeftOff {
  reason: string;
  evidence: string[];
  latestActivityAt: string | null;
}

export interface ContinuationPort {
  forProject(project: Project): Promise<LeftOff | null>;
}

export interface ProjectsModuleOptions {
  database: SqlDatabase;
  events: EventLog;
  reader: GitReader;
  gitOps: GitOpsPort;
  inspectFs: InspectFsPort;
  /** createDataBoundary(...).isSensitive */
  isSensitive(path: string): boolean;
  launch: LaunchPort;
  discovered?: DiscoveredReposPort;
  continuation?: ContinuationPort;
  scheduler: ModuleScheduler;
  settings: { read(): unknown; write(value: ProjectsSettings): void };
  legacy: LegacySource;
  now?: () => string;
  newCommandId?: () => string;
  platform?: Platform;
}

export interface ProjectSummary {
  project: Project;
  fetch: FetchState | null;
}

export interface ActionOutcome {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface ExecuteOptions {
  source: string;
  confirmation?: Confirmation;
  fingerprint?: string;
  onOutput?: (line: string) => void;
}

export type OpenTarget = "vscode" | "terminal" | "folder" | "github";

export interface StartResult {
  legacy: LegacyMigrationResult | { kind: "error"; reason: string };
  interrupted: Array<{ opId: string; projectId: string; verb: string }>;
}

export interface ProjectsModule {
  readonly store: ProjectsStore;
  start(): StartResult;
  stop(): void;
  getSettings(): ProjectsSettings;
  updateSettings(next: unknown): ProjectsSettings;

  list(options?: { includeArchived?: boolean }): ProjectSummary[];
  get(projectId: string): Project | null;
  groups(): ProjectGroup[];
  saveGroup(group: ProjectGroup): ProjectGroup[];
  deleteGroup(id: string): ProjectGroup[];
  repoState(projectId: string, options?: { allBranches?: boolean }): Promise<RepoState>;
  repoStates(projectIds?: readonly string[]): Promise<Record<string, RepoState | { error: string }>>;
  history(projectId: string, limit?: number): Promise<HistoryEntry[]>;
  diffStat(projectId: string): Promise<DiffStat>;
  operations(projectId: string, limit?: number): OperationRecord[];
  leftOff(projectId: string): Promise<LeftOff | null>;

  inspect(path: string, options?: { projectId?: string }): Promise<InspectResult>;
  add(input: ProjectInput, source: ProjectSource): Promise<SaveResult>;
  update(projectId: string, input: ProjectInput): Promise<SaveResult>;
  archive(projectId: string): Project;
  restore(projectId: string): Project;
  remove(projectId: string): void;
  touch(projectId: string): void;
  suggestions(): Promise<Suggestion[]>;
  addSuggestions(paths: readonly string[]): Promise<AddManyResult>;
  clone(input: Omit<CloneRequest, "source">, source: string): Promise<CloneResult & { inspection?: InspectResult }>;
  importLegacy(): LegacyReimportResult;
  legacyChanged(): boolean;

  preview(projectId: string, request: unknown): Promise<PreviewResult>;
  execute(projectId: string, request: unknown, options: ExecuteOptions): Promise<ExecuteResult>;
  cancel(opId: string): boolean;
  fetchAll(source: string): Promise<ActionOutcome>;
  pullAll(source: string): Promise<ActionOutcome>;
  open(projectId: string, target: OpenTarget, options: { path?: string; branch?: string; base?: string }, source: string): Promise<ActionOutcome>;

  runAction(actionId: string, source: string, params: unknown): Promise<ActionOutcome>;

  // The Dev dashboard's shape, for everything in the shell that read projects.json.
  legacyProjects(): LegacyProject[];
  saveLegacy(input: Record<string, unknown>): LegacyProject;
  archiveLegacy(projectId: string): void;
  syncLegacy(items: readonly LegacyProject[]): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

let commandCounter = 0;
function defaultCommandId(): string {
  commandCounter += 1;
  return `cmd_${Date.now().toString(36)}${commandCounter.toString(36)}`;
}

/** The old form's field names -> ProjectInput. */
function fromLegacyInput(input: Record<string, unknown>): ProjectInput {
  const out: ProjectInput = {};
  for (const key of ["id", "name", "path", "description", "accent", "notes", "healthUrl", "stopCommand", "logCommand", "logPath"] as const) {
    const value = str(input[key]);
    if (value !== undefined) out[key] = value;
  }
  if (isRecord(input.commands)) {
    out.commands = {};
    for (const slot of ["start", "build", "test", "typecheck", "custom"] as const) {
      const value = str(input.commands[slot]);
      if (value !== undefined) out.commands[slot] = value;
    }
  }
  if (Array.isArray(input.urls)) out.localUrls = input.urls.filter((u): u is string => typeof u === "string");
  if (Array.isArray(input.ports)) out.ports = input.ports.filter((p): p is number | string => typeof p === "number" || typeof p === "string");
  if (typeof input.dockerComposeEnabled === "boolean") out.dockerCompose = input.dockerComposeEnabled;
  if (input.projectType !== undefined) out.projectType = str(input.projectType) ?? null;
  if (Array.isArray(input.folders)) out.folders = input.folders.filter(isRecord).map((f) => ({ label: str(f.label), path: str(f.path) }));
  if (Array.isArray(input.links)) out.links = input.links.filter(isRecord).map((l) => ({ label: str(l.label), url: str(l.url) }));
  if (Array.isArray(input.commandList)) {
    out.commandList = input.commandList.filter(isRecord).map((c) => ({
      id: str(c.id),
      label: str(c.label),
      command: str(c.command),
      requiresConfirmation: c.requiresConfirmation === true
    }));
  }
  return out;
}

export function createProjectsModule(options: ProjectsModuleOptions): ProjectsModule {
  const now = options.now ?? (() => new Date().toISOString());
  const newCommandId = options.newCommandId ?? defaultCommandId;
  const platform = options.platform ?? process.platform;
  runProjectsMigrations(options.database, now());
  const store = createProjectsStore(options.database);
  let unschedule: (() => void) | null = null;
  let scheduledFetchRunning = false;

  const inspectDeps = () => ({ fs: options.inspectFs, reader: options.reader, isSensitive: options.isSensitive, store, platform });

  function emit(type: string, subject: string | null, source: string, payload: EventPayload, idempotencyKey?: string): void {
    options.events.append({ type, stream: PROJECTS_EVENT_STREAM, module: PROJECTS_MODULE_ID, subject, source, payload, idempotencyKey: idempotencyKey ?? null });
  }

  function mustGet(projectId: string): Project {
    const project = store.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  }

  function settings(): ProjectsSettings {
    return normaliseProjectsSettings(options.settings.read());
  }

  function bulkTargets(): Array<{ projectId: string; path: string }> {
    return store.list().filter((p) => p.git.isRepo !== false && !options.isSensitive(p.path)).map((p) => ({ projectId: p.id, path: p.path }));
  }

  async function scheduledFetch(occurrence: JobOccurrence): Promise<void> {
    if (scheduledFetchRunning) return;
    scheduledFetchRunning = true;
    try {
      const results = await options.gitOps.fetchAll(bulkTargets(), { source: "routine", concurrency: settings().fetchConcurrency });
      const failed = results.filter((r) => r.result.status !== "done" || r.result.outcome !== "succeeded").length;
      // One record per scheduled slot, however many times the host delivers it.
      emit("projects.fetch.scheduled", null, "routine", fetchScheduledPayload(results.length, failed), `projects.fetch.scheduled:${occurrence.occurrenceId}`);
    } finally {
      scheduledFetchRunning = false;
    }
  }

  function reschedule(): void {
    unschedule?.();
    unschedule = null;
    const s = settings();
    if (!s.scheduledFetch.enabled) return;
    unschedule = options.scheduler.schedule({
      id: SCHEDULED_FETCH_JOB_ID,
      intervalMs: s.scheduledFetch.intervalMinutes * 60_000,
      runAtStartup: false,
      heavy: true,
      run: scheduledFetch
    });
  }

  async function repoState(projectId: string, readOptions: { allBranches?: boolean } = {}): Promise<RepoState> {
    const project = mustGet(projectId);
    if (options.isSensitive(project.path)) return { isRepo: false, reason: "This folder is inside DexNest's own data folder.", readAt: now() };
    const state = await options.reader.readRepoState(project.path, readOptions);
    // Facts the home screen sorts and filters by, kept current as a side effect of looking.
    if (state.isRepo) {
      const recorded = store.fetchState(projectId)?.lastFetchAt ?? null;
      if (recorded && (!state.lastFetchAt || recorded > state.lastFetchAt)) state.lastFetchAt = recorded;
      if (state.lastCommit?.committedAt) store.noteActivity(projectId, new Date(state.lastCommit.committedAt).toISOString());
    }
    const isRepo = state.isRepo;
    const defaultBranch = state.isRepo ? state.defaultBranch : null;
    if (project.git.isRepo !== isRepo || (isRepo && defaultBranch && project.git.defaultBranch !== defaultBranch)) {
      const fresh = mustGet(projectId);
      store.save({ ...fresh, git: { ...fresh.git, isRepo, defaultBranch: defaultBranch ?? fresh.git.defaultBranch } });
    }
    return state;
  }

  function nonInteractive(source: string): boolean {
    return source !== "module_ui";
  }

  async function execute(projectId: string, request: unknown, exec: ExecuteOptions): Promise<ExecuteResult> {
    const project = mustGet(projectId);
    if (options.isSensitive(project.path)) {
      return { status: "refused", opId: "", refusal: { refused: true, kind: "unknown", code: "invalid_request", reason: "This folder is inside DexNest's own data folder.", offers: [] } };
    }
    const result = await options.gitOps.execute({
      projectId,
      path: project.path,
      request,
      confirmation: exec.confirmation,
      expectedFingerprint: exec.fingerprint,
      source: exec.source,
      nonInteractive: nonInteractive(exec.source),
      onOutput: exec.onOutput
    });
    if (result.status === "done" && result.outcome === "succeeded") store.noteActivity(projectId, now());
    return result;
  }

  function describe(result: ExecuteResult): ActionOutcome {
    switch (result.status) {
      case "done":
        return { ok: result.outcome === "succeeded", message: result.message, data: result };
      case "refused":
        return { ok: false, message: result.refusal.reason, data: result };
      case "busy":
        return { ok: false, message: `Busy: ${result.runningVerb} is running in this project.`, data: result };
      case "needs_confirmation":
        return { ok: false, message: `${result.plan.summary} Confirm in DexNest.`, data: result };
      case "stale":
        return { ok: false, message: "The project changed since the preview. Check the new preview.", data: result };
    }
  }

  function allowedPath(project: Project, requested: string | undefined): string | null {
    if (requested === undefined || requested.trim() === "") return project.path;
    const want = comparablePath(requested.trim(), platform);
    const allowed = [project.path, ...project.folders.map((f) => f.path)];
    return allowed.find((p) => comparablePath(p, platform) === want) ?? null;
  }

  async function open(projectId: string, target: OpenTarget, opts: { path?: string; branch?: string; base?: string }): Promise<ActionOutcome> {
    const project = mustGet(projectId);
    if (target === "github") {
      const links = githubLinks(project.git.remoteUrl);
      if (!links) return { ok: false, message: `${project.name} isn't on GitHub (no github.com remote).` };
      const url = opts.branch && opts.base ? links.compare(opts.base, opts.branch) : opts.branch ? links.branch(opts.branch) : links.repo;
      await options.launch.openExternal(url);
      store.touch(projectId, now());
      return { ok: true, message: `Opened ${project.name} on GitHub.`, data: { url } };
    }
    const path = allowedPath(project, opts.path);
    if (!path) return { ok: false, message: "That folder isn't one of this project's folders." };
    if (options.isSensitive(path)) return { ok: false, message: "That folder is inside DexNest's own data folder." };
    if (options.inspectFs.kind(path) !== "dir") return { ok: false, message: `The folder ${path} doesn't exist any more.` };
    if (target === "folder") {
      const error = await options.launch.openPath(path);
      if (error) return { ok: false, message: error };
    } else if (target === "vscode") {
      const exe = findVsCode(options.launch.env(), settings().vscodePath);
      if (!exe) return { ok: false, message: "VS Code wasn't found. Choose its location in Projects settings." };
      const spawned = options.launch.spawnDetached(vsCodeCommand(exe, path, path === project.path ? project.tooling.workspaceFile : null));
      if (!spawned.ok) return { ok: false, message: `VS Code didn't start: ${spawned.error}` };
    } else {
      const command = terminalCommand(options.launch.env(), settings().terminal, path);
      if (!command) return { ok: false, message: "No terminal was found. Choose one in Projects settings." };
      const spawned = options.launch.spawnDetached(command);
      if (!spawned.ok) return { ok: false, message: `The terminal didn't start: ${spawned.error}` };
    }
    store.touch(projectId, now());
    const words = { folder: "folder", vscode: "in VS Code", terminal: "terminal" } as const;
    return { ok: true, message: target === "folder" ? `Opened ${project.name} folder.` : target === "vscode" ? `Opened ${project.name} ${words.vscode}.` : `Opened a terminal for ${project.name}.` };
  }

  function mostRecentlyOpened(): Project | null {
    const list = store.list().filter((p) => p.lastOpenedAt);
    list.sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
    return list[0] ?? null;
  }

  const GIT_ACTION_KIND: Record<string, string> = {
    "projects.git.fetch": "fetch",
    "projects.git.pull": "pull",
    "projects.git.push": "push",
    "projects.git.commit": "commit",
    "projects.git.stash": "stash",
    "projects.git.stash_pop": "stash_pop",
    "projects.git.switch": "switch",
    "projects.git.create_branch": "create_branch",
    "projects.git.delete_branch": "delete_branch",
    "projects.git.delete_remote_branch": "delete_remote_branch",
    "projects.git.discard": "discard",
    "projects.git.undo": "undo"
  };

  const module: ProjectsModule = {
    store,

    start() {
      let legacy: StartResult["legacy"];
      try {
        legacy = migrateLegacyProjects(options.database, store, options.legacy, { now: now(), newCommandId });
        if (legacy.kind === "imported") emit("projects.legacy.imported", null, "system", legacyImportedPayload(legacy.count, legacy.skipped.length, legacy.sha256));
      } catch (error) {
        legacy = { kind: "error", reason: (error as Error).message };
      }
      const interrupted = options.gitOps.recoverInterrupted();
      reschedule();
      return { legacy, interrupted };
    },
    stop() {
      unschedule?.();
      unschedule = null;
    },
    getSettings: settings,
    updateSettings(next) {
      const merged = normaliseProjectsSettings({ ...settings(), ...(isRecord(next) ? next : {}) });
      options.settings.write(merged);
      reschedule();
      return merged;
    },

    list(listOptions = {}) {
      const fetches = store.allFetchStates();
      return store.list(listOptions).map((project) => ({ project, fetch: fetches.get(project.id) ?? null }));
    },
    get: (projectId) => store.get(projectId),
    groups: () => store.listGroups(),
    saveGroup(group) {
      store.saveGroup(group);
      return store.listGroups();
    },
    deleteGroup(id) {
      store.deleteGroup(id);
      return store.listGroups();
    },
    repoState,
    async repoStates(projectIds) {
      const ids = projectIds ? [...projectIds] : store.list().map((p) => p.id);
      const out: Record<string, RepoState | { error: string }> = {};
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (next < ids.length) {
            const id = ids[next];
            next += 1;
            try {
              out[id] = await repoState(id);
            } catch (error) {
              out[id] = { error: error instanceof GitReadError ? error.message : (error as Error).message };
            }
          }
        })
      );
      return out;
    },
    history: async (projectId, limit) => options.reader.history(mustGet(projectId).path, { limit }),
    diffStat: async (projectId) => options.reader.diffStat(mustGet(projectId).path),
    operations: (projectId, limit) => store.listOperations(projectId, limit),
    async leftOff(projectId) {
      const project = mustGet(projectId);
      return options.continuation ? options.continuation.forProject(project) : null;
    },

    inspect: (path, inspectOptions = {}) => inspectFolder(path, inspectDeps(), { ignoreProjectId: inspectOptions.projectId }),
    async add(input, source) {
      const result = await saveInspectedProject(input, inspectDeps(), { now: now(), newCommandId, takenIds: store.ids() });
      if (result.ok) emit("projects.project.added", result.project.id, "module_ui", projectEventPayload(result.project.id, source));
      return result;
    },
    async update(projectId, input) {
      const existing = mustGet(projectId);
      let realPath = existing.realPath;
      const newPath = input.path?.trim();
      if (newPath && comparablePath(newPath, platform) !== comparablePath(existing.path, platform)) {
        const inspected = await inspectFolder(newPath, inspectDeps(), { ignoreProjectId: projectId });
        if (inspected.kind === "refused") return { ok: false, reason: inspected.reason };
        if (inspected.kind === "duplicate") return { ok: false, reason: inspected.reason, duplicateOf: { id: inspected.existing.id, name: inspected.existing.name } };
        realPath = inspected.realPath;
      }
      const result = normaliseProjectInput({ ...input, id: undefined }, { existing, takenIds: store.ids(), now: now(), newCommandId });
      if (!result.ok) return { ok: false, reason: result.error };
      const project = { ...result.project, realPath };
      store.save(project);
      emit("projects.project.updated", projectId, "module_ui", projectEventPayload(projectId, "edit"));
      return { ok: true, project };
    },
    archive(projectId) {
      const project = store.archive(projectId, now());
      emit("projects.project.archived", projectId, "module_ui", projectEventPayload(projectId, "edit"));
      return project;
    },
    restore(projectId) {
      const project = store.restore(projectId, now());
      emit("projects.project.restored", projectId, "module_ui", projectEventPayload(projectId, "edit"));
      return project;
    },
    remove(projectId) {
      store.remove(projectId);
      emit("projects.project.removed", projectId, "module_ui", projectEventPayload(projectId, "edit"));
    },
    touch(projectId) {
      store.touch(projectId, now());
    },
    async suggestions() {
      if (!options.discovered) return [];
      return listSuggestions(options.discovered, { fs: options.inspectFs, isSensitive: options.isSensitive, projects: store.list({ includeArchived: true }), platform });
    },
    async addSuggestions(paths) {
      const result = await addSuggestions(paths, inspectDeps(), { now: now(), newCommandId });
      for (const project of result.added) emit("projects.project.added", project.id, "module_ui", projectEventPayload(project.id, "suggestion"));
      return result;
    },
    async clone(input, source) {
      const result = await options.gitOps.clone({ ...input, source });
      if (result.status === "done" && result.outcome === "succeeded") return { ...result, inspection: await inspectFolder(result.path, inspectDeps()) };
      return result;
    },
    importLegacy() {
      const result = reimportLegacyProjects(options.database, store, options.legacy, { now: now(), newCommandId });
      if (result.kind === "imported") for (const id of result.added) emit("projects.project.added", id, "module_ui", projectEventPayload(id, "import"));
      return result;
    },
    legacyChanged: () => legacyChangedSinceImport(store, options.legacy),

    preview(projectId, request) {
      const project = mustGet(projectId);
      return options.gitOps.preview({ projectId, path: project.path, request });
    },
    execute,
    cancel: (opId) => options.gitOps.cancel(opId),
    async fetchAll(source) {
      const results = await options.gitOps.fetchAll(bulkTargets(), { source, concurrency: settings().fetchConcurrency });
      const ok = results.filter((r) => r.result.status === "done" && r.result.outcome === "succeeded").length;
      const failed = results.length - ok;
      return { ok: failed === 0, message: failed === 0 ? `Fetched ${ok} project${ok === 1 ? "" : "s"}.` : `Fetched ${ok}; ${failed} didn't fetch.`, data: results };
    },
    async pullAll(source) {
      const { pulled, skipped } = await options.gitOps.pullAll(bulkTargets(), { source });
      const ok = pulled.filter((r) => r.result.status === "done" && r.result.outcome === "succeeded").length;
      return { ok: ok === pulled.length, message: `Pulled ${ok} project${ok === 1 ? "" : "s"}; ${skipped.length} skipped.`, data: { pulled, skipped } };
    },
    open: (projectId, target, opts) => open(projectId, target, opts),

    async runAction(actionId, source, params) {
      const contract = projectsAction(actionId);
      if (!contract) return { ok: false, message: `Unknown Projects action: ${actionId}` };
      if (!triggerAllowed(actionId, source)) return { ok: false, message: `${contract.title} can't be started from ${source}. Open Projects to do it.` };
      const p = isRecord(params) ? params : {};
      const projectId = str(p.projectId);
      const need = (): string => {
        if (!projectId) throw new Error("Which project?");
        return projectId;
      };
      try {
        switch (actionId) {
          case "projects.add": {
            const r = await module.add(isRecord(p.input) ? (p.input as ProjectInput) : {}, "wizard");
            return r.ok ? { ok: true, message: `Added ${r.project.name}.`, data: r.project } : { ok: false, message: r.reason, data: r };
          }
          case "projects.update": {
            const r = await module.update(need(), isRecord(p.input) ? (p.input as ProjectInput) : {});
            return r.ok ? { ok: true, message: `Saved ${r.project.name}.`, data: r.project } : { ok: false, message: r.reason, data: r };
          }
          case "projects.archive":
            return { ok: true, message: `Archived ${module.archive(need()).name}.` };
          case "projects.restore":
            return { ok: true, message: `Restored ${module.restore(need()).name}.` };
          case "projects.remove":
            module.remove(need());
            return { ok: true, message: "Removed from DexNest. The folder wasn't touched." };
          case "projects.import_legacy": {
            const r = module.importLegacy();
            return r.kind === "imported" ? { ok: true, message: `Imported ${r.added.length} project(s) from projects.json.`, data: r } : { ok: false, message: r.kind === "absent" ? "There is no projects.json." : r.reason };
          }
          case "projects.clone": {
            const r = await module.clone({ url: str(p.url) ?? "", parentDir: str(p.parentDir) ?? "", folderName: str(p.folderName) }, source);
            return r.status === "refused" ? { ok: false, message: r.reason, data: r } : { ok: r.outcome === "succeeded", message: r.message, data: r };
          }
          case "projects.suggestions.add": {
            const paths = Array.isArray(p.paths) ? p.paths.filter((x): x is string => typeof x === "string") : [];
            const r = await module.addSuggestions(paths);
            return { ok: r.skipped.length === 0, message: `Added ${r.added.length}; ${r.skipped.length} skipped.`, data: r };
          }
          case "projects.open_vscode":
            return open(need(), "vscode", { path: str(p.path) });
          case "projects.open_terminal":
            return open(need(), "terminal", { path: str(p.path) });
          case "projects.open_folder":
            return open(need(), "folder", { path: str(p.path) });
          case "projects.open_github":
            return open(need(), "github", { branch: str(p.branch), base: str(p.base) });
          case "projects.git.refresh":
            return { ok: true, message: "Refreshed.", data: await module.repoStates(projectId ? [projectId] : undefined) };
          case "projects.git.fetch_all":
            return module.fetchAll(source);
          case "projects.git.pull_all":
            return module.pullAll(source);
          case "projects.git.push_current": {
            const project = mostRecentlyOpened();
            if (!project) return { ok: false, message: "No project has been opened yet." };
            // Never asks: always non-interactive, and push itself never needs a confirmation.
            return describe(await execute(project.id, { kind: "push" }, { source }));
          }
          case "projects.git.cancel": {
            const opId = str(p.opId);
            return opId && module.cancel(opId) ? { ok: true, message: "Cancelling." } : { ok: false, message: "Nothing to cancel." };
          }
          default: {
            const kind = GIT_ACTION_KIND[actionId];
            if (!kind) return { ok: false, message: `Unknown Projects action: ${actionId}` };
            const request = isRecord(p.request) ? p.request : { kind };
            if (request.kind !== kind) return { ok: false, message: `${contract.title} can only ${kind}.` };
            const confirmation = isRecord(p.confirmation) ? { confirmed: p.confirmation.confirmed === true, typed: str(p.confirmation.typed) } : undefined;
            return describe(await execute(need(), request, { source, confirmation, fingerprint: str(p.fingerprint) }));
          }
        }
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
    },

    legacyProjects() {
      return store.list().map(projectToLegacy);
    },
    saveLegacy(input) {
      const mapped = fromLegacyInput(input);
      const id = mapped.id?.trim();
      const existing = id ? store.get(id) : null;
      // The old form always sent both; the old save refused without them.
      if (!mapped.name?.trim() || !mapped.path?.trim()) throw new Error("Project name and path are required.");
      const path = mapped.path.trim();
      if (options.isSensitive(path)) throw new Error("This folder is inside DexNest's own data folder. Projects never go there.");
      const result = normaliseProjectInput(existing ? { ...mapped, id: undefined } : mapped, { existing, takenIds: store.ids(), now: now(), newCommandId });
      if (!result.ok) throw new Error(result.error);
      let realPath = result.project.realPath;
      if (!realPath || (existing && existing.path !== result.project.path)) {
        try {
          realPath = comparablePath(options.inspectFs.realpath(result.project.path), platform);
        } catch {
          realPath = null;
        }
      }
      const project = { ...result.project, realPath };
      store.save(project);
      emit(existing ? "projects.project.updated" : "projects.project.added", project.id, "module_ui", projectEventPayload(project.id, "legacy_form"));
      return projectToLegacy(project);
    },
    archiveLegacy(projectId) {
      mustGet(projectId);
      module.archive(projectId);
    },
    syncLegacy(items) {
      const keep = new Set<string>();
      const taken = store.ids();
      for (const item of items) {
        const existing = store.get(item.id);
        if (existing) {
          const result = normaliseProjectInput(fromLegacyInput(item), { existing, takenIds: taken, now: now(), newCommandId });
          if (result.ok) store.save({ ...result.project, legacy: { ...(existing.legacy ?? {}), ...item } });
          keep.add(item.id);
        } else {
          const result = legacyProjectToProject(item, 0, taken, { now: now(), newCommandId });
          if (result.ok) {
            store.save(result.project);
            keep.add(result.project.id);
          }
        }
      }
      for (const project of store.list()) {
        if (!keep.has(project.id)) {
          store.archive(project.id, now());
          store.remove(project.id);
        }
      }
    }
  };
  return module;
}
