import { app, BrowserWindow, ipcMain } from "electron";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createActionRegistry, seededActions } from "@dexnest/action-registry";
import { createLocalDb } from "@dexnest/local-db";
import type { DexNestActionDefinition, DexNestActionTrigger, DexNestEventStatus } from "@dexnest/shared-types";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../..");
const localDataRoot = resolve(repoRoot, "local-data");
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

function runRegisteredAction(actionId: string, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const action = actionRegistry.get(actionId);

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

function startActionEndpoint(): void {
  actionServer = createServer(async (request, response) => {
    const match = request.url?.match(/^\/actions\/([^/?#]+)$/);

    if (request.method !== "POST" || !match) {
      sendJson(response, 404, { ok: false, error: "DexNest action endpoint not found." });
      return;
    }

    const actionId = decodeURIComponent(match[1]);
    const action = actionRegistry.get(actionId);

    if (!action) {
      const result = runRegisteredAction(actionId, "deck");
      sendJson(response, 404, result);
      return;
    }

    try {
      const payload = await readBody(request);
      const result = runRegisteredAction(actionId, "deck", payload);
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
    performanceMode: "Not enabled"
  }));

  ipcMain.handle("dexnest:list-actions", () => actionRegistry.list());

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
      const action = actionRegistry.get(payload.actionId);
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
      preload: join(currentDir, "preload.js"),
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
