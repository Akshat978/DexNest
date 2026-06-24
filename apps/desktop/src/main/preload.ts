import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("dexNest", {
  appName: "DexNest",
  actionEndpoint: "http://127.0.0.1:43217",
  getAppInfo: () => ipcRenderer.invoke("dexnest:get-app-info"),
  listActions: () => ipcRenderer.invoke("dexnest:list-actions"),
  listProjects: () => ipcRenderer.invoke("dexnest:list-projects"),
  listCommandResults: () => ipcRenderer.invoke("dexnest:list-command-results"),
  clearCommandResult: (actionId: string) => ipcRenderer.invoke("dexnest:clear-command-result", actionId),
  listPinnedActions: () => ipcRenderer.invoke("dexnest:list-pinned-actions"),
  savePinnedActions: (actionIds: string[]) => ipcRenderer.invoke("dexnest:save-pinned-actions", actionIds),
  saveProject: (payload: unknown) => ipcRenderer.invoke("dexnest:save-project", payload),
  deleteProject: (projectId: string) => ipcRenderer.invoke("dexnest:delete-project", projectId),
  listEvents: () => ipcRenderer.invoke("dexnest:list-events"),
  runAction: (payload: { actionId: string; source?: string; params?: unknown }) =>
    ipcRenderer.invoke("dexnest:run-action", payload),
  logActionResult: (payload: {
    actionId: string;
    status: string;
    source?: string;
    summary: string;
    errorMessage?: string | null;
    metadataJson?: Record<string, unknown>;
  }) => ipcRenderer.invoke("dexnest:log-action-result", payload),
  logUiEvent: (payload: { view: string; target: string; summary: string }) =>
    ipcRenderer.invoke("dexnest:log-ui-event", payload)
});
