import type { IpcMain, BrowserWindow } from "electron";
import type { BetterSqliteLike } from "../../../../apps/desktop/src/main/autopilotHost.ts";
import { registerHooks } from "node:module";
import { openWorker } from "./workerHarness.ts";

// Match the desktop's Vite/TypeScript workspace alias in Node's source-test runner.
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "@dexnest/autopilot-runtime"
    ? { url: new URL("../../src/index.ts", import.meta.url).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });

export async function openControlledHost(root: string, hooks?: Parameters<typeof openWorker>[2]) {
  const { createAutopilotHost } = await import("../../../../apps/desktop/src/main/autopilotHost.ts");
  const h = openWorker(root, 1, hooks);
  const handlers = new Map<string, (event: unknown, ...args: any[]) => any>();
  const changes: string[] = [];
  const audit: unknown[] = [];
  const contents = { mainFrame: {}, send: (_channel: string, payload: { runId: string }) => changes.push(payload.runId) };
  const ipc = { handle: (channel: string, fn: (...args: any[]) => any) => handlers.set(channel, fn), removeHandler: (channel: string) => handlers.delete(channel) };
  const host = createAutopilotHost({ database: h.ports.db as unknown as BetterSqliteLike, platform: h.ports.platform,
    claudeExecutable: "claude.exe", codexExecutable: "codex.exe", ipcMain: ipc as unknown as IpcMain,
    getWindow: () => ({ isDestroyed: () => false, webContents: contents }) as unknown as BrowserWindow,
    logEvent: (summary, metadata) => audit.push({ summary, metadata }) });
  await host.recover();
  const invoke = (name: string, input?: unknown) => Promise.resolve().then(() => handlers.get(`dexnest:autopilot-${name}`)!({ sender: contents, senderFrame: contents.mainFrame }, input));
  return { ...h, host, handlers, changes, audit, invoke, close() { host.dispose(); h.close(); } };
}
