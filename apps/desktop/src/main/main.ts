import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { exec } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { createActionRegistry, seededActions } from "@dexnest/action-registry";
import { createLocalDb } from "@dexnest/local-db";
import type { MessageBoxSyncOptions, OpenDialogSyncOptions } from "electron";
import type { DexNestActionDefinition, DexNestActionTrigger, DexNestEventStatus } from "@dexnest/shared-types";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../..");
const localDataRoot = resolve(repoRoot, "local-data");
const settingsRoot = join(localDataRoot, "settings");
const dropFilesRoot = join(localDataRoot, "files", "drop");
const dropIncomingRoot = join(dropFilesRoot, "incoming");
const dropOutgoingRoot = join(dropFilesRoot, "outgoing");
const dropTempRoot = join(dropFilesRoot, "temp");
const projectsConfigPath = join(settingsRoot, "projects.json");
const commandResultsPath = join(settingsRoot, "project-command-results.json");
const pinnedActionsPath = join(settingsRoot, "pinned-actions.json");
const clipboardHistoryPath = join(settingsRoot, "clipboard-history.json");
const clipboardSnippetsPath = join(settingsRoot, "clipboard-snippets.json");
const dropShelfPath = join(settingsRoot, "drop-shelf.json");
const dropIncomingPath = join(settingsRoot, "drop-incoming.json");
const dropSettingsPath = join(settingsRoot, "drop-settings.json");
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

interface ClipboardHistoryItem {
  id: string;
  text: string;
  preview: string;
  byteLength: number;
  createdAt: string;
}

interface ClipboardSnippet {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface DropTextItem {
  id: string;
  type: "text";
  text: string;
  preview: string;
  fileName?: string;
  path?: string;
  byteLength: number;
  source: "manual" | "clipboard" | "phone";
  direction: "outgoing" | "incoming";
  createdAt: string;
  expiresAt: string | null;
}

interface DropFileItem {
  id: string;
  type: "file";
  fileName: string;
  originalName: string;
  path: string;
  byteLength: number;
  source: "desktop" | "phone";
  direction: "outgoing" | "incoming";
  createdAt: string;
  expiresAt: string | null;
}

type DropShelfItem = DropTextItem | DropFileItem;

interface DropSettings {
  receiveFolderPath: string | null;
}

function ensureSettingsRoot(): void {
  mkdirSync(settingsRoot, { recursive: true });
}

function ensureDropRoot(): void {
  mkdirSync(dropFilesRoot, { recursive: true });
  mkdirSync(dropIncomingRoot, { recursive: true });
  mkdirSync(dropOutgoingRoot, { recursive: true });
  mkdirSync(dropTempRoot, { recursive: true });
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function previewText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function sanitizeFileName(value: string): string {
  const parsed = basename(value || "drop-file");
  const sanitized = parsed.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  return sanitized || "drop-file";
}

function uniqueFileName(root: string, originalName: string): string {
  const safeName = sanitizeFileName(originalName);
  const extension = extname(safeName);
  const baseName = extension ? safeName.slice(0, -extension.length) : safeName;
  let candidate = safeName;
  let suffix = 2;

  while (existsSync(join(root, candidate))) {
    candidate = `${baseName}-${suffix}${extension}`;
    suffix += 1;
  }

  return candidate;
}

function safeChildPath(root: string, fileName: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, sanitizeFileName(fileName));

  if (!resolvedPath.startsWith(`${resolvedRoot}\\`) && resolvedPath !== resolvedRoot) {
    throw new Error("Invalid Drop file path.");
  }

  return resolvedPath;
}

function getLanIp(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}

function dropLocalUrl(): string {
  return `http://127.0.0.1:${actionPort}/drop`;
}

function dropPhoneUrl(): string {
  const lanIp = getLanIp();
  return `http://${lanIp ?? "127.0.0.1"}:${actionPort}/drop`;
}

function readJsonFile<T>(path: string, fallback: T): T {
  ensureSettingsRoot();

  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    return fallback;
  }

  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJsonFile<T>(path: string, value: T): T {
  ensureSettingsRoot();
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return value;
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
  return readJsonFile<DexNestProject[]>(projectsConfigPath, []);
}

function saveProjects(projects: DexNestProject[]): void {
  writeJsonFile(projectsConfigPath, projects);
}

function loadCommandResults(): Record<string, ProjectCommandResult> {
  return readJsonFile<Record<string, ProjectCommandResult>>(commandResultsPath, {});
}

function saveCommandResult(result: ProjectCommandResult): void {
  const results = loadCommandResults();
  results[result.actionId] = result;
  writeJsonFile(commandResultsPath, results);
}

function loadPinnedActions(): string[] {
  return readJsonFile<string[]>(pinnedActionsPath, ["command.open_home", "dev.open_dashboard", "deck.test_endpoint"]);
}

function savePinnedActions(actionIds: string[]): string[] {
  const uniqueActionIds = [...new Set(actionIds.filter(Boolean))];
  writeJsonFile(pinnedActionsPath, uniqueActionIds);
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
  writeJsonFile(commandResultsPath, results);
}

function loadClipboardHistory(): ClipboardHistoryItem[] {
  return readJsonFile<ClipboardHistoryItem[]>(clipboardHistoryPath, []);
}

function saveClipboardHistory(items: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
  return writeJsonFile(clipboardHistoryPath, items.slice(0, 100));
}

function loadClipboardSnippets(): ClipboardSnippet[] {
  return readJsonFile<ClipboardSnippet[]>(clipboardSnippetsPath, []);
}

function saveClipboardSnippets(items: ClipboardSnippet[]): ClipboardSnippet[] {
  return writeJsonFile(clipboardSnippetsPath, items);
}

function loadDropShelf(): DropShelfItem[] {
  ensureDropRoot();
  return readJsonFile<DropShelfItem[]>(dropShelfPath, []).map((item) => ({
    ...item,
    direction: item.direction ?? "outgoing"
  })) as DropShelfItem[];
}

function saveDropShelf(items: DropShelfItem[]): DropShelfItem[] {
  ensureDropRoot();
  return writeJsonFile(dropShelfPath, items.slice(0, 100));
}

function loadDropIncoming(): DropShelfItem[] {
  ensureDropRoot();
  return readJsonFile<DropShelfItem[]>(dropIncomingPath, []).map((item) => ({
    ...item,
    direction: "incoming"
  })) as DropShelfItem[];
}

function saveDropIncoming(items: DropShelfItem[]): DropShelfItem[] {
  ensureDropRoot();
  return writeJsonFile(dropIncomingPath, items.slice(0, 100));
}

function loadDropSettings(): DropSettings {
  return readJsonFile<DropSettings>(dropSettingsPath, { receiveFolderPath: null });
}

function saveDropSettings(settings: DropSettings): DropSettings {
  return writeJsonFile(dropSettingsPath, settings);
}

function getDropReceiveFolder(): string {
  const configuredPath = loadDropSettings().receiveFolderPath;
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  ensureDropRoot();
  return dropIncomingRoot;
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

function readRawBody(request: IncomingMessage, maxBytes = 1024 * 1024 * 100): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        request.destroy();
        rejectBody(new Error("Request body is too large."));
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => resolveBody(Buffer.concat(chunks)));
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

function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

function sendManifest(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendSvg(response: ServerResponse, statusCode: number, svg: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(svg);
}

function sendPlain(response: ServerResponse, statusCode: number, value: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function splitBuffer(buffer: Buffer, separator: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);

  while (index !== -1) {
    chunks.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }

  chunks.push(buffer.subarray(start));
  return chunks;
}

async function parseMultipart(request: IncomingMessage): Promise<Array<{ name: string; filename?: string; content: Buffer }>> {
  const contentType = request.headers["content-type"] ?? "";
  const boundaryMatch = /boundary=([^;]+)/i.exec(Array.isArray(contentType) ? contentType[0] : contentType);
  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary.");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const rawBody = await readRawBody(request);
  const parts = splitBuffer(rawBody, boundary);
  const parsedParts: Array<{ name: string; filename?: string; content: Buffer }> = [];

  for (const rawPart of parts) {
    let part = rawPart;
    if (part.length === 0 || part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) {
      continue;
    }

    if (part.subarray(0, 2).toString("latin1") === "\r\n") {
      part = part.subarray(2);
    }
    if (part.subarray(part.length - 2).toString("latin1") === "\r\n") {
      part = part.subarray(0, part.length - 2);
    }
    if (part.subarray(part.length - 2).toString("latin1") === "--") {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) {
      continue;
    }

    const headers = part.subarray(0, headerEnd).toString("latin1");
    const content = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    const filenameMatch = /filename="([^"]*)"/i.exec(headers);
    if (!nameMatch) {
      continue;
    }

    parsedParts.push({
      name: nameMatch[1],
      filename: filenameMatch?.[1] ? sanitizeFileName(filenameMatch[1]) : undefined,
      content
    });
  }

  return parsedParts;
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

function clipboardState() {
  return {
    history: loadClipboardHistory(),
    snippets: loadClipboardSnippets(),
    snippetsPath: clipboardSnippetsPath,
    historyPath: clipboardHistoryPath
  };
}

function dropState() {
  const outgoing = loadDropShelf();
  const incoming = loadDropIncoming();
  const dropSettings = loadDropSettings();
  const receiveFolderPath = getDropReceiveFolder();
  return {
    shelf: outgoing,
    outgoing,
    outgoingText: outgoing.filter((item) => item.type === "text"),
    outgoingFiles: outgoing.filter((item) => item.type === "file"),
    incoming,
    shelfPath: dropShelfPath,
    incomingPath: dropIncomingPath,
    receiveFolderPath,
    defaultReceiveFolderPath: dropIncomingRoot,
    customReceiveFolderPath: dropSettings.receiveFolderPath,
    outgoingFolderPath: dropOutgoingRoot,
    tempFolderPath: dropTempRoot,
    localUrl: dropLocalUrl(),
    phoneUrl: dropPhoneUrl(),
    lanIp: getLanIp()
  };
}

function runClipboardAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown) {
  const params = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const now = new Date().toISOString();

  if (action.id === "clipboard.open") {
    logActionEvent(action, "success", source, "Opened DexNest Clipboard.", { view: "clipboard" });
    return { ok: true, actionId: action.id, message: "Opened DexNest Clipboard." };
  }

  if (action.id === "clipboard.save_current") {
    const text = clipboard.readText();
    if (!text.trim()) {
      logActionEvent(action, "skipped", source, "Clipboard save skipped because clipboard text was empty.", { byteLength: 0 });
      return { ok: false, actionId: action.id, error: "Clipboard text is empty." };
    }

    const item: ClipboardHistoryItem = {
      id: createId("clip"),
      text,
      preview: previewText(text),
      byteLength: byteLength(text),
      createdAt: now
    };
    saveClipboardHistory([item, ...loadClipboardHistory()]);
    logActionEvent(action, "success", source, `Saved clipboard text, ${item.byteLength} bytes.`, {
      itemId: item.id,
      byteLength: item.byteLength
    });
    return { ok: true, actionId: action.id, item };
  }

  if (action.id === "clipboard.copy_plain_text") {
    const text = clipboard.readText();
    clipboard.writeText(text);
    logActionEvent(action, "success", source, `Normalized clipboard as plain text, ${byteLength(text)} bytes.`, {
      byteLength: byteLength(text)
    });
    return { ok: true, actionId: action.id, byteLength: byteLength(text) };
  }

  if (action.id === "clipboard.create_snippet") {
    const title = String(params.title ?? "").trim();
    const text = String(params.text ?? "");
    const snippetId = typeof params.id === "string" ? params.id : undefined;
    if (!title || !text.trim()) {
      logActionEvent(action, "failed", source, "Clipboard snippet save failed because title or text was empty.");
      return { ok: false, actionId: action.id, error: "Snippet title and text are required." };
    }

    const snippets = loadClipboardSnippets();
    const existingIndex = snippetId ? snippets.findIndex((snippet) => snippet.id === snippetId) : -1;
    const snippet: ClipboardSnippet = {
      id: existingIndex >= 0 ? snippets[existingIndex].id : createId("snippet"),
      title,
      text,
      createdAt: existingIndex >= 0 ? snippets[existingIndex].createdAt : now,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      snippets[existingIndex] = snippet;
    } else {
      snippets.unshift(snippet);
    }

    saveClipboardSnippets(snippets);
    logActionEvent(action, "success", source, `${existingIndex >= 0 ? "Updated" : "Created"} clipboard snippet ${snippet.title}.`, {
      snippetId: snippet.id,
      title: snippet.title,
      byteLength: byteLength(snippet.text)
    });
    return { ok: true, actionId: action.id, snippet };
  }

  if (action.id === "clipboard.delete_snippet") {
    const snippetId = String(params.id ?? "");
    const snippets = loadClipboardSnippets();
    const snippet = snippets.find((item) => item.id === snippetId);
    if (!snippet) {
      logActionEvent(action, "failed", source, "Clipboard snippet delete failed because snippet was not found.", { snippetId });
      return { ok: false, actionId: action.id, error: "Snippet not found." };
    }

    saveClipboardSnippets(snippets.filter((item) => item.id !== snippetId));
    logActionEvent(action, "success", source, `Deleted clipboard snippet ${snippet.title}.`, {
      snippetId,
      title: snippet.title
    });
    return { ok: true, actionId: action.id };
  }

  return null;
}

function createDropTextItem(text: string, sourceName: DropTextItem["source"], direction: DropTextItem["direction"]): DropTextItem {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return {
    id: createId("drop"),
    type: "text",
    text,
    preview: previewText(text),
    byteLength: byteLength(text),
    source: sourceName,
    direction,
    createdAt: now.toISOString(),
    expiresAt
  };
}

function createDropFileItem(filePath: string, sourceName: DropFileItem["source"], direction: DropFileItem["direction"]): DropFileItem {
  const root = direction === "incoming" ? getDropReceiveFolder() : dropOutgoingRoot;
  mkdirSync(root, { recursive: true });
  const originalName = basename(filePath);
  const fileName = uniqueFileName(root, originalName);
  const targetPath = join(root, fileName);
  copyFileSync(filePath, targetPath);

  return {
    id: createId("drop-file"),
    type: "file",
    fileName,
    originalName: sanitizeFileName(originalName),
    path: targetPath,
    byteLength: statSync(targetPath).size,
    source: sourceName,
    direction,
    createdAt: new Date().toISOString(),
    expiresAt: null
  };
}

function runDropAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown) {
  const params = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};

  if (action.id === "drop.open") {
    logActionEvent(action, "success", source, "Opened DexNest Drop.", { view: "drop" });
    return { ok: true, actionId: action.id, message: "Opened DexNest Drop." };
  }

  if (action.id === "drop.copy_phone_url") {
    clipboard.writeText(dropPhoneUrl());
    logActionEvent(action, "success", source, "Copied DexNest Drop phone URL.", {
      lanIp: getLanIp(),
      url: dropPhoneUrl()
    });
    return { ok: true, actionId: action.id, url: dropPhoneUrl() };
  }

  if (action.id === "drop.create_text_drop") {
    const text = String(params.text ?? "").trim();
    if (!text) {
      logActionEvent(action, "failed", source, "Text Drop creation failed because text was empty.");
      return { ok: false, actionId: action.id, error: "Drop text is required." };
    }

    const item = createDropTextItem(text, "manual", "outgoing");
    saveDropShelf([item, ...loadDropShelf()]);
    logActionEvent(action, "success", source, `Created outgoing text Drop item, ${item.byteLength} bytes.`, {
      dropId: item.id,
      byteLength: item.byteLength,
      expiresAt: item.expiresAt
    });
    return { ok: true, actionId: action.id, item };
  }

  if (action.id === "drop.send_clipboard_to_drop") {
    const text = clipboard.readText();
    if (!text.trim()) {
      logActionEvent(action, "skipped", source, "Clipboard-to-Drop skipped because clipboard text was empty.", { byteLength: 0 });
      return { ok: false, actionId: action.id, error: "Clipboard text is empty." };
    }

    const item = createDropTextItem(text, "clipboard", "outgoing");
    saveDropShelf([item, ...loadDropShelf()]);
    logActionEvent(action, "success", source, `Sent clipboard text to outgoing Drop, ${item.byteLength} bytes.`, {
      dropId: item.id,
      byteLength: item.byteLength,
      expiresAt: item.expiresAt
    });
    return { ok: true, actionId: action.id, item };
  }

  if (action.id === "drop.add_outgoing_file") {
    const explicitPath = typeof params.path === "string" ? params.path : "";
    let selectedPath = explicitPath;

    if (!selectedPath) {
      const options: OpenDialogSyncOptions = {
        title: "Add file to DexNest Drop",
        properties: ["openFile"]
      };
      const result = mainWindow ? dialog.showOpenDialogSync(mainWindow, options) : dialog.showOpenDialogSync(options);
      selectedPath = result?.[0] ?? "";
    }

    if (!selectedPath || !existsSync(selectedPath)) {
      logActionEvent(action, "cancelled", source, "Outgoing Drop file selection cancelled.");
      return { ok: false, actionId: action.id, error: "No file selected." };
    }

    const item = createDropFileItem(selectedPath, "desktop", "outgoing");
    saveDropShelf([item, ...loadDropShelf()]);
    logActionEvent(action, "success", source, `Added outgoing Drop file ${item.originalName}, ${item.byteLength} bytes.`, {
      fileId: item.id,
      fileName: item.fileName,
      byteLength: item.byteLength
    });
    return { ok: true, actionId: action.id, item };
  }

  if (action.id === "drop.remove_outgoing_file") {
    const fileId = String(params.id ?? "");
    const shelf = loadDropShelf();
    const item = shelf.find((entry) => entry.id === fileId && entry.type === "file");
    if (!item || item.type !== "file") {
      logActionEvent(action, "failed", source, "Outgoing Drop file remove failed because file was not found.", { fileId });
      return { ok: false, actionId: action.id, error: "Outgoing file not found." };
    }

    if (existsSync(item.path)) {
      unlinkSync(item.path);
    }
    saveDropShelf(shelf.filter((entry) => entry.id !== fileId));
    logActionEvent(action, "success", source, `Removed outgoing Drop file ${item.originalName}.`, {
      fileId,
      fileName: item.fileName
    });
    return { ok: true, actionId: action.id };
  }

  if (action.id === "drop.clear_outgoing" || action.id === "drop.clear_temp_shelf") {
    const shelf = loadDropShelf();
    const count = shelf.length;
    for (const item of shelf) {
      if (item.type === "file" && existsSync(item.path)) {
        unlinkSync(item.path);
      }
    }
    saveDropShelf([]);
    logActionEvent(action, "success", source, `Cleared ${count} outgoing Drop item${count === 1 ? "" : "s"}.`, { count });
    return { ok: true, actionId: action.id, count };
  }

  if (action.id === "drop.clear_incoming") {
    const count = loadDropIncoming().length;
    saveDropIncoming([]);
    logActionEvent(action, "success", source, `Cleared ${count} incoming Drop metadata item${count === 1 ? "" : "s"}.`, { count });
    return { ok: true, actionId: action.id, count };
  }

  if (action.id === "drop.open_incoming_folder") {
    void shell.openPath(getDropReceiveFolder());
    logActionEvent(action, "success", source, "Opened DexNest Drop incoming folder.", { path: getDropReceiveFolder() });
    return { ok: true, actionId: action.id };
  }

  if (action.id === "drop.open_outgoing_folder") {
    void shell.openPath(dropOutgoingRoot);
    logActionEvent(action, "success", source, "Opened DexNest Drop outgoing folder.", { path: dropOutgoingRoot });
    return { ok: true, actionId: action.id };
  }

  return null;
}

function copyIncomingDropText(itemId: string): { ok: boolean; error?: string } {
  const item = loadDropIncoming().find((entry) => entry.id === itemId && entry.type === "text");
  if (!item || item.type !== "text") {
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: "drop.copy_incoming_text",
      eventType: "drop.pc_copy_incoming_text",
      status: "failed",
      source: "module_ui",
      summary: "Incoming Drop text copy failed because item was not found.",
      metadataJson: { itemId }
    });
    return { ok: false, error: "Incoming text item not found." };
  }

  clipboard.writeText(item.text);
  localDb.appendActionEvent({
    module: "DexNest Drop",
    actionId: "drop.copy_incoming_text",
    eventType: "drop.pc_copy_incoming_text",
    status: "success",
    source: "module_ui",
    summary: `Copied incoming Drop text, ${item.byteLength} bytes.`,
    metadataJson: { itemId, byteLength: item.byteLength }
  });
  return { ok: true };
}

function chooseDropReceiveFolder(): { ok: boolean; path?: string; error?: string } {
  const openOptions: OpenDialogSyncOptions = {
    title: "Choose DexNest Drop receive folder",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? dialog.showOpenDialogSync(mainWindow, openOptions) : dialog.showOpenDialogSync(openOptions);
  const selectedPath = result?.[0];
  if (!selectedPath) {
    return { ok: false, error: "No folder selected." };
  }

  const isOutsideLocalData = !resolve(selectedPath).startsWith(resolve(localDataRoot));
  if (isOutsideLocalData) {
    const messageOptions: MessageBoxSyncOptions = {
      type: "warning",
      buttons: ["Use folder", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "DexNest Drop receive folder",
      message: "This folder is outside local-data.",
      detail: "DexNest can use it, but project rules prefer local-data for user data."
    };
    const response = mainWindow
      ? dialog.showMessageBoxSync(mainWindow, messageOptions)
      : dialog.showMessageBoxSync(messageOptions);
    if (response !== 0) {
      return { ok: false, error: "Folder selection cancelled." };
    }
  }

  mkdirSync(selectedPath, { recursive: true });
  saveDropSettings({ receiveFolderPath: selectedPath });
  localDb.appendActionEvent({
    module: "DexNest Drop",
    actionId: "drop.receive_folder_changed",
    eventType: "drop.receive_folder_changed",
    status: "success",
    source: "module_ui",
    summary: "Changed DexNest Drop receive folder.",
    metadataJson: { path: selectedPath, outsideLocalData: isOutsideLocalData }
  });
  return { ok: true, path: selectedPath };
}

function resetDropReceiveFolder(): { ok: boolean; path: string } {
  saveDropSettings({ receiveFolderPath: null });
  ensureDropRoot();
  localDb.appendActionEvent({
    module: "DexNest Drop",
    actionId: "drop.receive_folder_reset",
    eventType: "drop.receive_folder_reset",
    status: "success",
    source: "module_ui",
    summary: "Reset DexNest Drop receive folder.",
    metadataJson: { path: dropIncomingRoot }
  });
  return { ok: true, path: dropIncomingRoot };
}

function dropPublicState() {
  const outgoing = loadDropShelf();
  return {
    outgoingText: outgoing.filter((item): item is DropTextItem => item.type === "text"),
    outgoingFiles: outgoing.filter((item): item is DropFileItem => item.type === "file"),
    receiveFolderPath: getDropReceiveFolder(),
    localOnly: true
  };
}

function dropManifest() {
  return {
    name: "DexNest Drop",
    short_name: "Drop",
    description: "DexNest local Wi-Fi transfer between phone and PC.",
    start_url: "/drop",
    scope: "/drop",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#22D3EE",
    icons: [
      {
        src: "/drop/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable"
      }
    ]
  };
}

function renderDropIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="DexNest Drop">
  <rect width="512" height="512" rx="96" fill="#000000"/>
  <path d="M256 92 372 160v136L256 420 140 296V160L256 92Z" fill="none" stroke="#22D3EE" stroke-width="28" stroke-linejoin="round"/>
  <path d="M256 92v120m0 0 116-52m-116 52-116-52m116 52v208" fill="none" stroke="#22D3EE" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function renderDropPhonePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#22D3EE" />
  <meta name="color-scheme" content="dark" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="DexNest Drop" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="manifest" href="/drop/manifest.webmanifest" />
  <link rel="icon" type="image/svg+xml" href="/drop/icon.svg" />
  <link rel="apple-touch-icon" href="/drop/icon.svg" />
  <title>DexNest Drop</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #000000;
      --surface: #0A0A0A;
      --surface-2: #111111;
      --surface-hover: #111111;
      --border: #262626;
      --text: #F5F5F5;
      --text-muted: #A3A3A3;
      --accent: #38BDF8;
      --success: #22C55E;
      --error: #EF4444;
      --font-ui: Inter, system-ui, sans-serif;
      --font-tech: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
      --radius: 8px;
      --gap: 12px;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: var(--font-ui); background: var(--bg); color: var(--text); }
    main { display: grid; gap: var(--gap); max-width: 760px; margin: 0 auto; padding: max(16px, env(safe-area-inset-top)) 16px max(96px, env(safe-area-inset-bottom)); }
    header, section { display: grid; gap: var(--gap); padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    header { border-color: var(--accent); }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 1.8rem; }
    h2 { font-size: 1.1rem; }
    p { line-height: 1.45; }
    button, input, textarea, a { width: 100%; min-height: 46px; padding: 12px; font: inherit; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); background: var(--surface-2); }
    button, a { text-align: center; text-decoration: none; }
    button:active, a:active { background: var(--surface-hover); }
    button.primary, a.primary { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
    textarea { min-height: 120px; resize: vertical; text-align: left; }
    label { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; color: var(--text-muted); }
    label input { width: auto; min-height: auto; }
    .header-top { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .status { padding: 6px 9px; color: var(--accent); background: var(--surface-2); border: 1px solid var(--accent); border-radius: var(--radius); font-family: var(--font-tech); font-size: 0.8rem; white-space: nowrap; }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .pills span { padding: 6px 9px; color: var(--text-muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); font-size: 0.82rem; }
    .item { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .item button, .item a { border-color: var(--accent); }
    .mono { font-family: var(--font-tech); overflow-wrap: anywhere; }
    .notice, .meta, .file-count { color: var(--text-muted); }
    .meta, .file-count { font-family: var(--font-tech); font-size: 0.84rem; }
    .empty { padding: 12px; color: var(--text-muted); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .toast-stack { position: fixed; left: 14px; right: 14px; bottom: max(14px, env(safe-area-inset-bottom)); display: grid; gap: 8px; z-index: 10; }
    .toast { padding: 12px; border: 1px solid var(--success); border-radius: var(--radius); background: var(--surface-2); color: var(--text); }
    .toast[data-tone="error"] { border-color: var(--error); }
    @media (display-mode: standalone) {
      header { position: sticky; top: 0; z-index: 2; }
      body { overscroll-behavior-y: contain; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="header-top">
        <div>
          <h1>DexNest Drop</h1>
          <p>Local Wi-Fi transfer</p>
        </div>
        <span class="status">Connected</span>
      </div>
      <div class="pills">
        <span>Local only</span>
        <span>Same Wi-Fi required</span>
        <span>No cloud</span>
      </div>
      <p class="notice">Two-way handoff between this phone browser and the DexNest desktop app.</p>
      <p class="notice">On Android Chrome, tap ⋮ → Add to Home screen.</p>
    </header>
    <section>
      <h2>Refresh</h2>
      <label><input id="autoRefresh" type="checkbox" checked /> Auto-refresh every 3 seconds</label>
      <button id="manualRefresh">Refresh now</button>
    </section>
    <section>
      <h2>From PC: text</h2>
      <div id="texts"></div>
    </section>
    <section>
      <h2>From PC: files</h2>
      <div id="files"></div>
    </section>
    <section>
      <h2>Send to PC: text</h2>
      <textarea id="note" placeholder="Write a note to save on the PC"></textarea>
      <button id="sendText" class="primary">Upload text to PC</button>
      <p id="textStatus" class="notice"></p>
    </section>
    <section>
      <h2>Send to PC: files</h2>
      <input id="uploadFiles" type="file" multiple />
      <p id="selectedCount" class="file-count">No files selected</p>
      <button id="sendFiles" class="primary">Upload files/photos/docs to PC</button>
      <p id="fileStatus" class="notice"></p>
      <p>PC receive folder:</p>
      <p id="receivePath" class="mono"></p>
    </section>
  </main>
  <div id="toastStack" class="toast-stack" aria-live="polite"></div>
  <script>
    let uploadActive = false;
    let refreshTimer = null;
    function toast(message, tone = 'success') {
      const stack = document.getElementById('toastStack');
      const node = document.createElement('div');
      node.className = 'toast';
      node.dataset.tone = tone;
      node.textContent = message;
      stack.append(node);
      setTimeout(() => node.remove(), 3000);
    }
    function formatBytes(value) {
      if (value < 1024) return value + ' B';
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
      return (value / (1024 * 1024)).toFixed(1) + ' MB';
    }
    async function copyText(value, itemId) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(value);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.append(textarea);
          textarea.focus();
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          if (!copied) throw new Error('Fallback copy failed.');
        }
        toast('Copied to phone clipboard');
        await fetch('/drop/api/copy-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, ok: true }) });
      } catch (error) {
        toast('Copy failed: ' + (error && error.message ? error.message : 'unknown error'), 'error');
        await fetch('/drop/api/copy-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, ok: false, error: error && error.message ? error.message : 'unknown error' }) });
      }
    }
    async function loadDrop() {
      if (uploadActive) return;
      const response = await fetch('/drop/api/state');
      const state = await response.json();
      document.getElementById('receivePath').textContent = state.receiveFolderPath;
      const texts = document.getElementById('texts');
      texts.innerHTML = state.outgoingText.length ? '' : '<p class="empty">No outgoing text drops from the PC yet.</p>';
      for (const item of state.outgoingText) {
        const node = document.createElement('div');
        node.className = 'item';
        const text = document.createElement('p');
        text.textContent = item.preview || 'Text drop';
        const meta = document.createElement('p');
        meta.className = 'mono notice';
        meta.textContent = item.id + ' · ' + item.byteLength + ' bytes';
        const button = document.createElement('button');
        meta.className = 'meta';
        meta.textContent = item.id + ' / ' + formatBytes(item.byteLength);
        button.className = 'primary';
        button.textContent = 'Copy text';
        button.onclick = async () => copyText(item.text, item.id);
        node.append(text, meta, button);
        texts.append(node);
      }
      const files = document.getElementById('files');
      files.innerHTML = state.outgoingFiles.length ? '' : '<p class="empty">No outgoing files from the PC yet.</p>';
      for (const item of state.outgoingFiles) {
        const node = document.createElement('div');
        node.className = 'item';
        const title = document.createElement('p');
        title.textContent = item.originalName;
        const meta = document.createElement('p');
        meta.className = 'mono notice';
        meta.textContent = item.id + ' · ' + item.byteLength + ' bytes';
        const link = document.createElement('a');
        meta.className = 'meta';
        meta.textContent = item.id + ' / ' + formatBytes(item.byteLength);
        link.className = 'primary';
        link.href = '/drop/files/' + encodeURIComponent(item.id);
        link.textContent = 'Download file';
        link.download = item.originalName;
        link.onclick = async () => {
          toast('File download started');
          await fetch('/drop/api/download-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: item.id }) });
        };
        node.append(title, meta, link);
        files.append(node);
      }
    }
    document.getElementById('sendText').onclick = async () => {
      const text = document.getElementById('note').value;
      const response = await fetch('/drop/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      document.getElementById('textStatus').textContent = response.ok ? 'Uploaded text to PC.' : 'Text upload failed.';
      if (response.ok) {
        document.getElementById('note').value = '';
        toast('Text sent');
      } else {
        toast('Text send failed', 'error');
      }
      await loadDrop();
    };
    document.getElementById('uploadFiles').onchange = (event) => {
      const count = event.target.files ? event.target.files.length : 0;
      document.getElementById('selectedCount').textContent = count ? count + ' file' + (count === 1 ? '' : 's') + ' selected' : 'No files selected';
    };
    document.getElementById('sendFiles').onclick = async () => {
      const input = document.getElementById('uploadFiles');
      if (!input.files.length) {
        toast('Choose files first', 'error');
        return;
      }
      uploadActive = true;
      const data = new FormData();
      for (const file of input.files) data.append('files', file);
      const response = await fetch('/drop/api/upload', { method: 'POST', body: data });
      const result = await response.json().catch(() => ({}));
      const saved = result.saved || [];
      const failed = result.failed || [];
      const savedText = saved.map(file => 'Saved: ' + file.fileName).join(' | ');
      const failedText = failed.map(file => 'Failed: ' + file.fileName + ' (' + file.error + ')').join(' | ');
      document.getElementById('fileStatus').textContent = [savedText, failedText].filter(Boolean).join(' | ') || 'No files uploaded.';
      if (saved.length) toast('File uploaded: ' + saved.length);
      if (failed.length || !response.ok) toast('Some files failed to upload', 'error');
      if (response.ok || saved.length) {
        input.value = '';
        document.getElementById('selectedCount').textContent = 'No files selected';
      }
      uploadActive = false;
      await loadDrop();
    };
    document.getElementById('manualRefresh').onclick = () => loadDrop();
    document.getElementById('autoRefresh').onchange = (event) => {
      if (refreshTimer) clearInterval(refreshTimer);
      if (event.target.checked) refreshTimer = setInterval(loadDrop, 3000);
    };
    loadDrop();
    refreshTimer = setInterval(loadDrop, 3000);
  </script>
</body>
</html>`;
}

async function handleDropRoutes(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "GET" && url.pathname === "/drop") {
    sendHtml(response, 200, renderDropPhonePage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/drop/manifest.webmanifest") {
    sendManifest(response, 200, dropManifest());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/drop/icon.svg") {
    sendSvg(response, 200, renderDropIcon());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/drop/api/state") {
    sendJson(response, 200, dropPublicState());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/drop/api/text") {
    const body = await readBody(request) as { text?: string };
    const text = String(body.text ?? "").trim();
    if (!text) {
      sendJson(response, 400, { ok: false, error: "Text is required." });
      return true;
    }

    const item = createDropTextItem(text, "phone", "incoming");
    const receiveFolder = getDropReceiveFolder();
    mkdirSync(receiveFolder, { recursive: true });
    const fileName = uniqueFileName(receiveFolder, `${item.id}.txt`);
    const targetPath = safeChildPath(receiveFolder, fileName);
    writeFileSync(targetPath, text, "utf8");
    item.fileName = fileName;
    item.path = targetPath;
    saveDropIncoming([item, ...loadDropIncoming()]);
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: "drop.phone_text_upload",
      eventType: "drop_text_received",
      status: "success",
      source: "phone_pwa",
      summary: `Received phone text Drop item, ${item.byteLength} bytes.`,
      metadataJson: { dropId: item.id, byteLength: item.byteLength }
    });
    sendJson(response, 200, { ok: true, itemId: item.id });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/drop/api/upload") {
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: "drop.phone_upload_started",
      eventType: "drop.phone_upload_started",
      status: "pending",
      source: "phone_pwa",
      summary: "Phone Drop file upload started.",
      metadataJson: {}
    });
    const parts = await parseMultipart(request);
    const savedItems: DropFileItem[] = [];
    const failedFiles: Array<{ fileName: string; error: string }> = [];
    const receiveFolder = getDropReceiveFolder();
    mkdirSync(receiveFolder, { recursive: true });
    for (const part of parts) {
      if (!part.filename || part.content.length === 0) {
        continue;
      }

      try {
        const fileName = uniqueFileName(receiveFolder, part.filename);
        const targetPath = safeChildPath(receiveFolder, fileName);
        writeFileSync(targetPath, part.content);
        savedItems.push({
          id: createId("drop-file"),
          type: "file",
          fileName,
          originalName: sanitizeFileName(part.filename),
          path: targetPath,
          byteLength: part.content.length,
          source: "phone",
          direction: "incoming",
          createdAt: new Date().toISOString(),
          expiresAt: null
        });
      } catch (error) {
        failedFiles.push({
          fileName: sanitizeFileName(part.filename),
          error: error instanceof Error ? error.message : "Upload failed."
        });
      }
    }

    if (savedItems.length === 0) {
      localDb.appendActionEvent({
        module: "DexNest Drop",
        actionId: "drop.phone_upload_completed",
        eventType: "drop.phone_upload_completed",
        status: "failed",
        source: "phone_pwa",
        summary: "Phone Drop file upload failed.",
        metadataJson: { failedCount: failedFiles.length }
      });
      sendJson(response, 400, { ok: false, error: "No files uploaded." });
      return true;
    }

    saveDropIncoming([...savedItems, ...loadDropIncoming()]);
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: "drop.phone_file_upload",
      eventType: "drop_phone_upload",
      status: "success",
      source: "phone_pwa",
      summary: `Received ${savedItems.length} phone Drop file${savedItems.length === 1 ? "" : "s"}.`,
      metadataJson: {
        count: savedItems.length,
        totalBytes: savedItems.reduce((total, item) => total + item.byteLength, 0),
        fileNames: savedItems.map((item) => item.fileName)
      }
    });
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: "drop.phone_upload_completed",
      eventType: "drop.phone_upload_completed",
      status: failedFiles.length > 0 ? "failed" : "success",
      source: "phone_pwa",
      summary: `Phone Drop upload completed: ${savedItems.length} saved, ${failedFiles.length} failed.`,
      metadataJson: {
        savedCount: savedItems.length,
        failedCount: failedFiles.length,
        fileNames: savedItems.map((item) => item.fileName)
      }
    });
    sendJson(response, 200, {
      ok: failedFiles.length === 0,
      count: savedItems.length,
      saved: savedItems.map((item) => ({ id: item.id, fileName: item.fileName, byteLength: item.byteLength })),
      failed: failedFiles
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/drop/api/copy-event") {
    const body = await readBody(request) as { itemId?: string; ok?: boolean; error?: string };
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: body.ok ? "drop.phone_copy_success" : "drop.phone_copy_failed",
      eventType: body.ok ? "drop.phone_copy_success" : "drop.phone_copy_failed",
      status: body.ok ? "success" : "failed",
      source: "phone_pwa",
      summary: body.ok ? "Phone copied outgoing Drop text." : "Phone failed to copy outgoing Drop text.",
      metadataJson: { itemId: body.itemId ?? null },
      errorMessage: body.ok ? null : body.error ?? "Copy failed."
    });
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/drop/api/download-event") {
    const body = await readBody(request) as { fileId?: string };
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: "drop.phone_file_download",
      eventType: "drop.phone_file_download",
      status: "success",
      source: "phone_pwa",
      summary: "Phone started outgoing Drop file download.",
      metadataJson: { fileId: body.fileId ?? null }
    });
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/drop/files/")) {
    const fileId = decodeURIComponent(url.pathname.replace("/drop/files/", ""));
    const item = loadDropShelf().find((entry) => entry.id === fileId && entry.type === "file");
    if (!item || item.type !== "file" || !existsSync(item.path)) {
      sendPlain(response, 404, "Drop file not found.");
      return true;
    }

    const filePath = safeChildPath(dropOutgoingRoot, item.fileName);
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(item.originalName)}"`,
      "Content-Length": statSync(filePath).size,
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
    return true;
  }

  return false;
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

  if (action.module === "clipboard") {
    const result = runClipboardAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "drop") {
    const result = runDropAction(action, source, payload);
    if (result) {
      return result;
    }
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
    try {
      if (await handleDropRoutes(request, response)) {
        return;
      }
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "DexNest Drop request failed."
      });
      return;
    }

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

  actionServer.listen(actionPort, "0.0.0.0");
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
    clipboardHistoryPath,
    clipboardSnippetsPath,
    dropShelfPath,
    dropIncomingPath,
    dropReceiveFolderPath: dropIncomingRoot,
    dropOutgoingFolderPath: dropOutgoingRoot,
    dropTempFolderPath: dropTempRoot,
    dropLocalUrl: dropLocalUrl(),
    dropPhoneUrl: dropPhoneUrl(),
    lanIp: getLanIp(),
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

  ipcMain.handle("dexnest:get-clipboard-state", () => clipboardState());

  ipcMain.handle("dexnest:get-drop-state", () => dropState());

  ipcMain.handle("dexnest:copy-drop-incoming-text", (_event, itemId: string) => copyIncomingDropText(itemId));

  ipcMain.handle("dexnest:choose-drop-receive-folder", () => chooseDropReceiveFolder());

  ipcMain.handle("dexnest:reset-drop-receive-folder", () => resetDropReceiveFolder());

  ipcMain.handle("dexnest:log-drop-auto-refresh", (_event, enabled: boolean) => {
    localDb.appendActionEvent({
      module: "DexNest Drop",
      actionId: "drop.auto_refresh_toggled",
      eventType: "drop.auto_refresh_toggled",
      status: "success",
      source: "module_ui",
      summary: `DexNest Drop auto-refresh ${enabled ? "enabled" : "disabled"}.`,
      metadataJson: { enabled }
    });
  });

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

  mainWindow.webContents.on("console-message", (event) => {
    console.log(`[DexNest renderer] ${event.message}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[DexNest renderer gone]", details);
  });
}

app.whenReady().then(() => {
  localDb.initialize();
  ensureDropRoot();
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
