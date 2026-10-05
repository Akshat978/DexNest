// Projects, hosted in the main process.
//
// Wiring only. The module lives in @dexnest/projects (model, store, read-only
// git engine, inspector, runtime); everything that changes a repository lives
// in @dexnest/git-ops. This file hands them the shared database and event log,
// DexNest's data boundary, the host scheduler, a git runner, the file system,
// launchers, the folder dialog and Developer Intelligence's (read-only) data,
// and exposes the runtime over IPC to the trusted main frame only.
// See docs/modules/projects/PLAN.md.

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import type { BrowserWindow, IpcMain } from "electron";
import { comparablePath, createDataBoundary, type EventLog, type ModuleScheduler, type SqlDatabase } from "@dexnest/foundation";
import {
  createGitReader,
  createLegacyFileSource,
  createNodeGitRunner,
  createNodeIgnoreFile,
  createNodeInspectFs,
  createNodeRepoFs,
  createProjectsModule,
  type ContinuationPort,
  type DiscoveredReposPort,
  type GitOpsPort,
  type LeftOff,
  type ProjectsModule,
  type ProjectsSettings
} from "@dexnest/projects";
import { cloneRepository, createGitOps } from "@dexnest/git-ops";
import { collectFacts, scoreRepository } from "@dexnest/standup";
import type { DevIntelligenceModule } from "@dexnest/dev-intelligence";

import { isTrustedMainFrame } from "./trustedFrame.js";
import { evidenceLine } from "./leftOffEvidence.js";
import { createFolderScan } from "./projectsFolderScan.js";

export interface ProjectsHostOptions {
  database: SqlDatabase;
  events: EventLog;
  /** DexNest's resolved data root. No project may live there. */
  dataRoot: string;
  otherDataRoots: string[];
  scheduler: ModuleScheduler;
  /** settings/ - projects.json is read from here once, backups go to settings/backups. */
  settingsRoot: string;
  readSettings(): unknown;
  writeSettings(settings: ProjectsSettings): void;
  ipcMain: IpcMain;
  getWindow(): BrowserWindow | null;
  pickFolder(title: string): Promise<string | null>;
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  /** Developer Intelligence, when it is running: read methods only. */
  getDevIntelligence(): DevIntelligenceModule | null;
}

export interface ProjectsHost {
  module: ProjectsModule;
  dispose(): void;
}

export function createProjectsHost(options: ProjectsHostOptions): ProjectsHost {
  const boundary = createDataBoundary({ dataRoot: options.dataRoot, extraSensitiveRoots: options.otherDataRoots, realpath: realpathSync.native });
  const isSensitive = (path: string) => boundary.isSensitive(path);
  const runner = createNodeGitRunner();
  const reader = createGitReader({ runner, fs: createNodeRepoFs(), caseInsensitivePaths: process.platform === "win32" });
  const inspectFs = createNodeInspectFs();
  const environmentSetsSsh = Boolean(process.env.GIT_SSH || process.env.GIT_SSH_COMMAND);

  // The store is created by the runtime; git-ops needs the same one.
  let module: ProjectsModule | null = null;
  const lazyStore = () => {
    if (!module) throw new Error("Projects is not started.");
    return module.store;
  };
  const gitOps: GitOpsPort = (() => {
    let ops: ReturnType<typeof createGitOps> | null = null;
    const get = () => (ops ??= createGitOps({ runner, reader, store: lazyStore(), events: options.events, environmentSetsSsh }));
    return {
      preview: (input) => get().preview(input),
      execute: (input) => get().execute(input),
      cancel: (opId) => get().cancel(opId),
      isBusy: (projectId) => get().isBusy(projectId),
      fetchAll: (projects, bulk) => get().fetchAll(projects, bulk),
      pullAll: (projects, bulk) => get().pullAll(projects, bulk),
      recoverInterrupted: () => get().recoverInterrupted(),
      clone: (input) => cloneRepository(input, { runner, fs: inspectFs, isSensitive, store: lazyStore(), events: options.events, environmentSetsSsh })
    };
  })();

  const discovered: DiscoveredReposPort = {
    async list() {
      const di = options.getDevIntelligence();
      if (!di) return [];
      const repos = await di.persistence.repositories.listRepositories();
      return repos.flatMap((repo) => {
        const root = repo.roots[0];
        return root ? [{ id: repo.id, path: root.path, displayName: repo.displayName ?? null, lastSeenAt: repo.lastSeenAt }] : [];
      });
    }
  };

  const folderScan = createFolderScan(isSensitive);

  const continuation: ContinuationPort = {
    async forProject(project): Promise<LeftOff | null> {
      const di = options.getDevIntelligence();
      if (!di) return null;
      const want = project.realPath ?? comparablePath(project.path);
      const repos = await di.persistence.repositories.listRepositories();
      const match = repos.find((repo) => repo.roots.some((root) => comparablePath(root.path) === want));
      if (!match) return null;
      const to = new Date().toISOString();
      const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const facts = await collectFacts(di.persistence, { kind: "custom", from, to }, [match.id]);
      const repo = facts.repositories[0];
      if (!repo || !repo.ok) return null;
      const ranked = scoreRepository(repo, from, to);
      return {
        reason: ranked.reason,
        evidence: ranked.evidence.slice(0, 6).map((ref) => evidenceLine(ref, repo.events)),
        latestActivityAt: ranked.signals.latestActivityAt ?? null
      };
    }
  };

  module = createProjectsModule({
    database: options.database,
    events: options.events,
    reader,
    gitOps,
    inspectFs,
    isSensitive,
    launch: {
      env: () => ({ platform: process.platform, env: process.env, exists: (path) => existsSync(path) }),
      async openPath(path) {
        const error = await options.openPath(path);
        return error ? error : null;
      },
      openExternal: (url) => options.openExternal(url),
      spawnDetached(command) {
        try {
          const child = spawn(command.file, command.args, { cwd: command.cwd, detached: true, stdio: "ignore", shell: false, windowsHide: false });
          child.on("error", () => undefined);
          child.unref();
          return { ok: true };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      }
    },
    ignoreFile: createNodeIgnoreFile(),
    discovered,
    folderScan,
    continuation,
    scheduler: options.scheduler,
    settings: { read: options.readSettings, write: options.writeSettings },
    legacy: createLegacyFileSource({ file: join(options.settingsRoot, "projects.json"), backupDir: join(options.settingsRoot, "backups") })
  });
  const projects = module;

  // --- IPC: the trusted main frame only -------------------------------------
  const channels: string[] = [];
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => {
    channels.push(channel);
    options.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedMainFrame(event, options.getWindow())) throw new Error("Projects requires the trusted desktop main frame.");
      return listener(...args);
    });
  };
  const id = (value: unknown): string => {
    if (typeof value !== "string" || !value) throw new Error("Which project?");
    return value;
  };
  const sendOutput = (projectId: string, line: string) => {
    const window = options.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("dexnest:projects-output", { projectId, line });
  };
  const opt = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

  handle("dexnest:projects-list", (o) => projects.list({ includeArchived: opt(o).includeArchived === true }));
  handle("dexnest:projects-get", (projectId) => projects.get(id(projectId)));
  handle("dexnest:projects-settings", () => projects.getSettings());
  handle("dexnest:projects-update-settings", (next) => projects.updateSettings(next));
  handle("dexnest:projects-groups", () => projects.groups());
  handle("dexnest:projects-save-group", (group) => {
    const g = opt(group);
    return projects.saveGroup({ id: id(g.id), name: String(g.name ?? ""), position: typeof g.position === "number" ? g.position : 0 });
  });
  handle("dexnest:projects-delete-group", (groupId) => projects.deleteGroup(id(groupId)));
  handle("dexnest:projects-repo-state", (projectId, o) =>
    projects.repoState(id(projectId), { allBranches: opt(o).allBranches === true, measureUntracked: opt(o).measureUntracked === true, includeIgnored: opt(o).includeIgnored === true, trackedSecrets: opt(o).trackedSecrets === true })
  );
  handle("dexnest:projects-repo-states", (ids) => projects.repoStates(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : undefined));
  handle("dexnest:projects-history", (projectId, limit) => projects.history(id(projectId), typeof limit === "number" ? limit : 50));
  handle("dexnest:projects-diff-stat", (projectId) => projects.diffStat(id(projectId)));
  handle("dexnest:projects-operations", (projectId) => projects.operations(id(projectId), 50));
  handle("dexnest:projects-left-off", (projectId) => projects.leftOff(id(projectId)));
  handle("dexnest:projects-pick-folder", (title) => options.pickFolder(typeof title === "string" ? title : "Choose a project folder"));
  handle("dexnest:projects-inspect", (path, o) => projects.inspect(String(path ?? ""), { projectId: typeof opt(o).projectId === "string" ? (opt(o).projectId as string) : undefined }));
  handle("dexnest:projects-add", (input, source) => projects.add(opt(input), source === "suggestion" || source === "clone" ? source : "wizard"));
  handle("dexnest:projects-update", (projectId, input) => projects.update(id(projectId), opt(input)));
  handle("dexnest:projects-touch", (projectId) => projects.touch(id(projectId)));
  handle("dexnest:projects-archive", (projectId) => projects.archive(id(projectId)));
  handle("dexnest:projects-restore", (projectId) => projects.restore(id(projectId)));
  handle("dexnest:projects-remove", (projectId) => projects.remove(id(projectId)));
  handle("dexnest:projects-suggestions", () => projects.suggestions());
  handle("dexnest:projects-add-suggestions", (paths) => projects.addSuggestions(Array.isArray(paths) ? paths.filter((x): x is string => typeof x === "string") : []));
  const paths = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").slice(0, 500) : []);
  handle("dexnest:projects-scan-folders", (roots) => projects.scanFolders(paths(roots)));
  handle("dexnest:projects-import-folders", (chosen) => projects.importFolders(paths(chosen)));
  handle("dexnest:projects-check-watched", (o) => projects.checkWatchedFolders({ force: opt(o).force === true }));
  handle("dexnest:projects-clone", (input) => {
    const i = opt(input);
    return projects.clone({ url: String(i.url ?? ""), parentDir: String(i.parentDir ?? ""), folderName: typeof i.folderName === "string" ? i.folderName : undefined, onOutput: (line) => sendOutput("", line) }, "module_ui");
  });
  handle("dexnest:projects-import-legacy", () => projects.importLegacy());
  handle("dexnest:projects-legacy-changed", () => projects.legacyChanged());
  handle("dexnest:projects-preview", (projectId, request) => projects.preview(id(projectId), request));
  handle("dexnest:projects-execute", (projectId, request, o) => {
    const pid = id(projectId);
    const options2 = opt(o);
    const confirmation = opt(options2.confirmation);
    return projects.execute(pid, request, {
      source: "module_ui",
      confirmation: { confirmed: confirmation.confirmed === true, typed: typeof confirmation.typed === "string" ? confirmation.typed : undefined },
      fingerprint: typeof options2.fingerprint === "string" ? options2.fingerprint : undefined,
      onOutput: (line) => sendOutput(pid, line)
    });
  });
  handle("dexnest:projects-cancel", (opId) => projects.cancel(String(opId ?? "")));
  handle("dexnest:projects-fetch-all", () => projects.fetchAll("module_ui"));
  handle("dexnest:projects-pull-all", () => projects.pullAll("module_ui"));
  handle("dexnest:projects-open", (projectId, target, o) => {
    const t = target === "vscode" || target === "terminal" || target === "folder" || target === "github" ? target : "folder";
    const p = opt(o);
    return projects.open(id(projectId), t, { path: typeof p.path === "string" ? p.path : undefined, branch: typeof p.branch === "string" ? p.branch : undefined, base: typeof p.base === "string" ? p.base : undefined }, "module_ui");
  });

  return {
    module: projects,
    dispose() {
      projects.stop();
      for (const channel of channels) options.ipcMain.removeHandler(channel);
    }
  };
}
