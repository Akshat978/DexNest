import { app, BrowserWindow, ipcMain, shell } from "electron";
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createActionRegistry, seededActions } from "@dexnest/action-registry";
import { createLocalDb } from "@dexnest/local-db";
import type { DexNestActionDefinition, DexNestActionTrigger, DexNestEventStatus } from "@dexnest/shared-types";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../..");
const localDataRoot = resolve(repoRoot, "local-data");
const settingsRoot = join(localDataRoot, "settings");
const projectsConfigPath = join(settingsRoot, "projects.json");
const commandResultsPath = join(settingsRoot, "project-command-results.json");
const pinnedActionsPath = join(settingsRoot, "pinned-actions.json");
const actionPort = 43217;

app.setName("DexNest");
app.setPath("userData", join(localDataRoot, "app"));
app.setPath("sessionData", join(localDataRoot, "session"));
app.setPath("logs", join(localDataRoot, "logs"));
app.setPath("crashDumps", join(localDataRoot, "crash-dumps"));

const localDb = createLocalDb({
  dataRoot: localDataRoot
});

const actionRegistry = createActionRegistry();
for (const action of seededActions) {
  actionRegistry.register(action);
}

let mainWindow: BrowserWindow | null = null;
let actionServer: ReturnType<typeof createServer> | null = null;

interface DexNestProject {
  id: string;
  name: string;
  path: string;
  description: string;
  accent: string;
  commands: {
    start: string;
    build: string;
    test: string;
    typecheck: string;
    custom: string;
  };
  urls: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
}

interface ProjectInput {
  id?: string;
  name: string;
  path: string;
  description?: string;
  accent?: string;
  commands?: Partial<DexNestProject["commands"]>;
  urls?: string[];
  notes?: string;
}

interface RunActionInput {
  actionId: string;
  source?: DexNestActionTrigger;
  params?: {
    confirmedDangerous?: boolean;
  };
}

interface ProjectCommandResult {
  actionId: string;
  projectId: string;
  projectName: string;
  commandKey: string;
  command: string;
  status: "idle" | "running" | "success" | "failed";
  stdout: string;
  stderr: string;
  summary: string;
  durationMs: number | null;
  finishedAt: string | null;
  errorMessage?: string | null;
}

function ensureSettingsRoot(): void {
  mkdirSync(settingsRoot, { recursive: true });
}

function slugifyProjectId(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `project-${Date.now()}`;
}

function loadProjects(): DexNestProject[] {
  ensureSettingsRoot();

  if (!existsSync(projectsConfigPath)) {
    writeFileSync(projectsConfigPath, "[]", "utf8");
    return [];
  }

  return JSON.parse(readFileSync(projectsConfigPath, "utf8")) as DexNestProject[];
}

function saveProjects(projects: DexNestProject[]): void {
  ensureSettingsRoot();
  writeFileSync(projectsConfigPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
}

function loadCommandResults(): Record<string, ProjectCommandResult> {
  ensureSettingsRoot();

  if (!existsSync(commandResultsPath)) {
    writeFileSync(commandResultsPath, "{}\n", "utf8");
    return {};
  }

  return JSON.parse(readFileSync(commandResultsPath, "utf8")) as Record<string, ProjectCommandResult>;
}

function saveCommandResult(result: ProjectCommandResult): void {
  const results = loadCommandResults();
  results[result.actionId] = result;
  writeFileSync(commandResultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

function loadPinnedActions(): string[] {
  ensureSettingsRoot();

  if (!existsSync(pinnedActionsPath)) {
    const defaults = ["command.open_home", "dev.open_dashboard", "deck.test_endpoint"];
    writeFileSync(pinnedActionsPath, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    return defaults;
  }

  return JSON.parse(readFileSync(pinnedActionsPath, "utf8")) as string[];
}

function savePinnedActions(actionIds: string[]): string[] {
  ensureSettingsRoot();
  const uniqueActionIds = [...new Set(actionIds.filter(Boolean))];
  writeFileSync(pinnedActionsPath, `${JSON.stringify(uniqueActionIds, null, 2)}\n`, "utf8");
  localDb.appendActionEvent({
    module: "command",
    actionId: "command.pinned_actions_updated",
    eventType: "pinned_actions_updated",
    status: "success",
    source: "module_ui",
    summary: "Updated DexNest pinned actions.",
    metadataJson: { count: uniqueActionIds.length }
  });
  return uniqueActionIds;
}

function deleteCommandResult(actionId: string): void {
  const results = loadCommandResults();
  delete results[actionId];
  writeFileSync(commandResultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

function getProjectActionDefinitions(projects = loadProjects()): DexNestActionDefinition[] {
  return projects.flatMap((project) => {
    const base = `dev.project.${project.id}`;
    const baseAction = {
      moduleId: "dev" as const,
      module: "dev" as const,
      category: "project",
      dangerLevel: "safe" as const,
      requiresConfirmation: false,
      confirmationRule: null,
      reversible: false,
      undoActionId: null,
      allowedTriggers: ["command", "deck", "module_ui"] as DexNestActionTrigger[],
      enabled: true,
      status: "available" as const
    };

    const actions: DexNestActionDefinition[] = [
      {
        ...baseAction,
        id: `${base}.open_folder`,
        title: `Open ${project.name} Folder`,
        description: `Open ${project.name} in File Explorer.`,
        handlerType: "file_operation",
        handlerRef: project.path
      },
      {
        ...baseAction,
        id: `${base}.open_vscode`,
        title: `Open ${project.name} in VS Code`,
        description: `Open ${project.name} in VS Code.`,
        handlerType: "local_command",
        handlerRef: `code "${project.path}"`
      },
      {
        ...baseAction,
        id: `${base}.open_terminal`,
        title: `Open ${project.name} Terminal`,
        description: `Open a PowerShell terminal at ${project.name}.`,
        handlerType: "local_command",
        handlerRef: "powershell"
      },
      {
        ...baseAction,
        id: `${base}.open_url`,
        title: `Open ${project.name} URL`,
        description: `Open the first configured local URL for ${project.name}.`,
        handlerType: "http_endpoint",
        handlerRef: project.urls[0] ?? ""
      }
    ];

    for (const key of ["start", "build", "test", "typecheck", "custom"] as const) {
      if (project.commands[key].trim()) {
        const command = project.commands[key].trim();
        actions.push({
          ...baseAction,
          id: `${base}.run_${key}`,
          title: `Run ${project.name} ${key}`,
          description: `Run the ${key} command for ${project.name}.`,
          dangerLevel: isDangerousCommand(command) ? "danger" : "caution",
          requiresConfirmation: isDangerousCommand(command),
          confirmationRule: isDangerousCommand(command) ? "Command looks destructive." : null,
          handlerType: "local_command",
          handlerRef: command
        });
      }
    }

    return actions;
  });
}

function findAction(actionId: string): DexNestActionDefinition | undefined {
  return actionRegistry.get(actionId) ?? getProjectActionDefinitions().find((action) => action.id === actionId);
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";

    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 1024 * 64) {
        request.destroy();
        rejectBody(new Error("Request body is too large."));
      }
    });

    request.on("end", () => {
      if (!body) {
        resolveBody({});
        return;
      }

      try {
        resolveBody(JSON.parse(body));
      } catch {
        rejectBody(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", rejectBody);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173"
  });
  response.end(JSON.stringify(payload));
}

function projectMetadata(project: DexNestProject): Record<string, unknown> {
  return {
    projectId: project.id,
    projectName: project.name
  };
}

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/.*)?$/i.test(url.trim());
}

function isDangerousCommand(command: string): boolean {
  return /\b(rm\s+-rf|del\s+\/|rmdir\s+\/s|format\b|diskpart\b|Remove-Item\b.*-Recurse|git\s+reset\s+--hard|git\s+clean\s+-fd)\b/i.test(
    command
  );
}

function summarizeOutput(stdout: string, stderr: string): string {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return "No command output.";
  }

  return output.slice(-4000);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function runProjectCommand(
  project: DexNestProject,
  commandKey: keyof DexNestProject["commands"],
  source: DexNestActionTrigger,
  confirmedDangerous = false
) {
  const command = project.commands[commandKey].trim();
  const actionId = `dev.project.${project.id}.run_${commandKey}`;
  const startedAt = Date.now();

  return new Promise<{
    ok: boolean;
    actionId: string;
    summary: string;
    output: string;
    stdout: string;
    stderr: string;
    status: "success" | "failed";
    durationMs: number | null;
  }>((resolveCommand) => {
    if (!command) {
      localDb.appendActionEvent({
        module: "DexNest Dev",
        actionId,
        eventType: "project_command_skipped",
        status: "skipped",
        source,
        summary: `${project.name} has no ${commandKey} command configured.`,
        metadataJson: projectMetadata(project)
      });
      resolveCommand({
        ok: false,
        actionId,
        summary: "Command is not configured.",
        output: "",
        stdout: "",
        stderr: "",
        status: "failed",
        durationMs: null
      });
      return;
    }

    if (isDangerousCommand(command) && !confirmedDangerous) {
      localDb.appendActionEvent({
        module: "DexNest Dev",
        actionId,
        eventType: "project_command_blocked",
        status: "cancelled",
        source,
        summary: `${project.name} ${commandKey} command was blocked pending confirmation.`,
        metadataJson: { ...projectMetadata(project), commandKey }
      });
      resolveCommand({
        ok: false,
        actionId,
        summary: "Command requires confirmation.",
        output: "",
        stdout: "",
        stderr: "",
        status: "failed",
        durationMs: null
      });
      return;
    }

    exec(command, { cwd: project.path, timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const cleanStdout = stripAnsi(stdout);
      const cleanStderr = stripAnsi(stderr);
      const output = summarizeOutput(cleanStdout, cleanStderr);
      const status: DexNestEventStatus = error ? "failed" : "success";
      const durationMs = Date.now() - startedAt;
      const summary = error
        ? `${project.name} ${commandKey} command failed.`
        : `${project.name} ${commandKey} command completed.`;

      saveCommandResult({
        actionId,
        projectId: project.id,
        projectName: project.name,
        commandKey,
        command,
        status,
        stdout: cleanStdout.slice(-4000),
        stderr: cleanStderr.slice(-4000),
        summary,
        durationMs,
        finishedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : null
      });

      localDb.appendActionEvent({
        module: "DexNest Dev",
        actionId,
        eventType: "project_command_run",
        status,
        source,
        summary,
        metadataJson: {
          ...projectMetadata(project),
          commandKey,
          command
        },
        errorMessage: error instanceof Error ? error.message : null,
        durationMs
      });

      resolveCommand({
        ok: !error,
        actionId,
        summary,
        output,
        stdout: cleanStdout,
        stderr: cleanStderr,
        status,
        durationMs
      });
    });
  });
}

function upsertProject(input: ProjectInput): DexNestProject {
  const projects = loadProjects();
  const now = new Date().toISOString();
  const existingIndex = input.id ? projects.findIndex((project) => project.id === input.id) : -1;
  const existingProject = existingIndex >= 0 ? projects[existingIndex] : null;
  const baseId = input.id ?? slugifyProjectId(input.name);
  let id = baseId;
  let suffix = 2;

  while (projects.some((project) => project.id === id && project.id !== input.id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const project: DexNestProject = {
    id,
    name: input.name.trim(),
    path: input.path.trim(),
    description: input.description?.trim() ?? "",
    accent: input.accent?.trim() ?? "dev",
    commands: {
      start: input.commands?.start?.trim() ?? existingProject?.commands.start ?? "",
      build: input.commands?.build?.trim() ?? existingProject?.commands.build ?? "",
      test: input.commands?.test?.trim() ?? existingProject?.commands.test ?? "",
      typecheck: input.commands?.typecheck?.trim() ?? existingProject?.commands.typecheck ?? "",
      custom: input.commands?.custom?.trim() ?? existingProject?.commands.custom ?? ""
    },
    urls: input.urls?.map((url) => url.trim()).filter(Boolean) ?? existingProject?.urls ?? [],
    notes: input.notes?.trim() ?? existingProject?.notes ?? "",
    createdAt: existingProject?.createdAt ?? now,
    updatedAt: now,
    lastOpenedAt: existingProject?.lastOpenedAt ?? null
  };

  if (!project.name || !project.path) {
    throw new Error("Project name and path are required.");
  }

  if (existingIndex >= 0) {
    projects[existingIndex] = project;
  } else {
    projects.push(project);
  }

  saveProjects(projects);
  localDb.appendActionEvent({
    module: "DexNest Dev",
    actionId: existingProject ? "dev.project.updated" : "dev.project.created",
    eventType: existingProject ? "project_updated" : "project_created",
    status: "success",
    source: "module_ui",
    summary: existingProject ? `Updated project ${project.name}.` : `Created project ${project.name}.`,
    metadataJson: projectMetadata(project)
  });

  return project;
}

function deleteProject(projectId: string): void {
  const projects = loadProjects();
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  saveProjects(projects.filter((item) => item.id !== projectId));
  localDb.appendActionEvent({
    module: "DexNest Dev",
    actionId: "dev.project.deleted",
    eventType: "project_deleted",
    status: "success",
    source: "module_ui",
    summary: `Deleted project ${project.name}.`,
    metadataJson: projectMetadata(project)
  });
}

function touchProject(project: DexNestProject): DexNestProject {
  const projects = loadProjects();
  const updatedProject = {
    ...project,
    lastOpenedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  saveProjects(projects.map((item) => (item.id === project.id ? updatedProject : item)));
  return updatedProject;
}

function logActionEvent(
  action: DexNestActionDefinition,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown> = {},
  errorMessage: string | null = null,
  durationMs: number | null = null
): void {
  localDb.appendActionEvent({
    module: action.module,
    actionId: action.id,
    eventType: "action_executed",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs
  });
}

async function runRegisteredAction(actionId: string, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const action = findAction(actionId);

  if (!action) {
    localDb.appendActionEvent({
      module: "system",
      actionId,
      eventType: "action_rejected",
      status: "failed",
      source,
      summary: `Unknown DexNest action: ${actionId}`,
      metadataJson: { payload }
    });

    return {
      ok: false,
      actionId,
      error: `Unknown DexNest action: ${actionId}`
    };
  }

  const projectMatch = actionId.match(/^dev\.project\.([a-z0-9-]+)\.(.+)$/);
  if (projectMatch) {
    return runProjectAction(actionId, projectMatch[1], projectMatch[2], source, payload);
  }

  logActionEvent(
    action,
    "success",
    source,
    `${action.title} completed.`,
    { handlerType: action.handlerType, handlerRef: action.handlerRef, payload },
    null,
    Date.now() - startedAt
  );

  return {
    ok: true,
    actionId,
    module: action.module,
    status: action.status,
    message: action.description
  };
}

function runProjectAction(actionId: string, projectId: string, operation: string, source: DexNestActionTrigger, payload: unknown) {
  const projects = loadProjects();
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    localDb.appendActionEvent({
      module: "DexNest Dev",
      actionId,
      eventType: "project_action_failed",
      status: "failed",
      source,
      summary: `Project not found for action ${actionId}.`,
      metadataJson: { projectId }
    });
    return { ok: false, actionId, error: `Project not found: ${projectId}` };
  }

  if (operation === "open_folder") {
    void shell.openPath(project.path);
    touchProject(project);
    localDb.appendActionEvent({
      module: "DexNest Dev",
      actionId,
      eventType: "project_opened",
      status: "success",
      source,
      summary: `Opened ${project.name} folder.`,
      metadataJson: projectMetadata(project)
    });
    return { ok: true, actionId, message: `Opened ${project.name} folder.` };
  }

  if (operation === "open_vscode") {
    const child = spawn("code", [project.path], { detached: true, stdio: "ignore" });
    child.unref();
    touchProject(project);
    localDb.appendActionEvent({
      module: "DexNest Dev",
      actionId,
      eventType: "project_opened_vscode",
      status: "success",
      source,
      summary: `Opened ${project.name} in VS Code.`,
      metadataJson: projectMetadata(project)
    });
    return { ok: true, actionId, message: `Opened ${project.name} in VS Code.` };
  }

  if (operation === "open_terminal") {
    const command = `Set-Location -LiteralPath '${project.path.replace(/'/g, "''")}'`;
    const child = spawn("powershell.exe", ["-NoExit", "-Command", command], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    touchProject(project);
    localDb.appendActionEvent({
      module: "DexNest Dev",
      actionId,
      eventType: "project_terminal_opened",
      status: "success",
      source,
      summary: `Opened terminal for ${project.name}.`,
      metadataJson: projectMetadata(project)
    });
    return { ok: true, actionId, message: `Opened terminal for ${project.name}.` };
  }

  if (operation === "open_url") {
    const url = project.urls[0];
    if (!url || !isLocalUrl(url)) {
      localDb.appendActionEvent({
        module: "DexNest Dev",
        actionId,
        eventType: "project_url_blocked",
        status: "failed",
        source,
        summary: `${project.name} has no safe localhost URL configured.`,
        metadataJson: projectMetadata(project)
      });
      return { ok: false, actionId, error: "No safe localhost URL configured." };
    }

    void shell.openExternal(url);
    touchProject(project);
    localDb.appendActionEvent({
      module: "DexNest Dev",
      actionId,
      eventType: "project_url_opened",
      status: "success",
      source,
      summary: `Opened ${project.name} URL.`,
      metadataJson: { ...projectMetadata(project), url }
    });
    return { ok: true, actionId, message: `Opened ${project.name} URL.` };
  }

  if (operation.startsWith("run_")) {
    const commandKey = operation.replace("run_", "") as keyof DexNestProject["commands"];
    const params = typeof payload === "object" && payload !== null ? (payload as { confirmedDangerous?: boolean }) : {};
    return runProjectCommand(project, commandKey, source, params.confirmedDangerous);
  }

  return { ok: false, actionId, error: `Unsupported project operation: ${operation}` };
}

function startActionEndpoint(): void {
  actionServer = createServer(async (request, response) => {
    const match = request.url?.match(/^\/actions\/([^/?#]+)$/);

    if (request.method !== "POST" || !match) {
      sendJson(response, 404, { ok: false, error: "DexNest action endpoint not found." });
      return;
    }

    const actionId = decodeURIComponent(match[1]);
    const action = findAction(actionId);

    if (!action) {
      const result = await runRegisteredAction(actionId, "deck");
      sendJson(response, 404, result);
      return;
    }

    try {
      const payload = await readBody(request);
      const result = await runRegisteredAction(actionId, "deck", payload);
      sendJson(response, result.ok ? 200 : 500, result);
    } catch (error) {
      logActionEvent(
        action,
        "failed",
        "deck",
        `${action.title} failed.`,
        {},
        error instanceof Error ? error.message : "Invalid DexNest action request."
      );
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid DexNest action request."
      });
    }
  });

  actionServer.listen(actionPort, "127.0.0.1");
}

function registerIpcHandlers(): void {
  ipcMain.handle("dexnest:get-app-info", () => ({
    appName: "DexNest",
    dataRoot: localDataRoot,
    dbPath: localDb.dbPath,
    actionEndpoint: `http://127.0.0.1:${actionPort}`,
    projectsConfigPath,
    commandResultsPath,
    pinnedActionsPath,
    projectCount: loadProjects().length,
    performanceMode: "Not enabled"
  }));

  ipcMain.handle("dexnest:list-actions", () => [...actionRegistry.list(), ...getProjectActionDefinitions()]);

  ipcMain.handle("dexnest:list-projects", () => loadProjects());

  ipcMain.handle("dexnest:list-command-results", () => loadCommandResults());

  ipcMain.handle("dexnest:clear-command-result", (_event, actionId: string) => {
    deleteCommandResult(actionId);
  });

  ipcMain.handle("dexnest:list-pinned-actions", () => loadPinnedActions());

  ipcMain.handle("dexnest:save-pinned-actions", (_event, actionIds: string[]) => savePinnedActions(actionIds));

  ipcMain.handle("dexnest:save-project", (_event, input: ProjectInput) => upsertProject(input));

  ipcMain.handle("dexnest:delete-project", (_event, projectId: string) => {
    deleteProject(projectId);
  });

  ipcMain.handle("dexnest:list-events", () => localDb.listRecentEvents(25));

  ipcMain.handle(
    "dexnest:run-action",
    (_event, payload: { actionId: string; source?: DexNestActionTrigger; params?: unknown }) =>
      runRegisteredAction(payload.actionId, payload.source ?? "module_ui", payload.params ?? {})
  );

  ipcMain.handle(
    "dexnest:log-action-result",
    (
      _event,
      payload: {
        actionId: string;
        status: DexNestEventStatus;
        source?: DexNestActionTrigger;
        summary: string;
        errorMessage?: string | null;
        metadataJson?: Record<string, unknown>;
      }
    ) => {
      const action = findAction(payload.actionId);
      if (!action) {
        return;
      }

      logActionEvent(
        action,
        payload.status,
        payload.source ?? "module_ui",
        payload.summary,
        payload.metadataJson ?? {},
        payload.errorMessage ?? null
      );
    }
  );

  ipcMain.handle(
    "dexnest:log-ui-event",
    (_event, payload: { view: string; target: string; summary: string }) => {
      localDb.appendActionEvent({
        module: payload.view,
        actionId: payload.target,
        eventType: "ui_clicked",
        status: "success",
        source: "module_ui",
        summary: payload.summary,
        metadataJson: { view: payload.view, target: payload.target }
      });
    }
  );
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "DexNest",
    webPreferences: {
      preload: join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

  if (app.isPackaged) {
    mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
  } else {
    mainWindow.loadURL(devServerUrl);
  }

  mainWindow.webContents.on("console-message", (_event, _level, message) => {
    console.log(`[DexNest renderer] ${message}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[DexNest renderer gone]", details);
  });
}

app.whenReady().then(() => {
  localDb.initialize();
  registerIpcHandlers();
  startActionEndpoint();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  actionServer?.close();
  localDb.close();
});
