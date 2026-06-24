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
  getClipboardState: () => ipcRenderer.invoke("dexnest:get-clipboard-state"),
  getDropState: () => ipcRenderer.invoke("dexnest:get-drop-state"),
  getToolsState: () => ipcRenderer.invoke("dexnest:get-tools-state"),
  getVaultState: () => ipcRenderer.invoke("dexnest:get-vault-state"),
  getSearchState: () => ipcRenderer.invoke("dexnest:get-search-state"),
  getJournalState: () => ipcRenderer.invoke("dexnest:get-journal-state"),
  getCalendarState: () => ipcRenderer.invoke("dexnest:get-calendar-state"),
  getFinderState: () => ipcRenderer.invoke("dexnest:get-finder-state"),
  getFinanceState: () => ipcRenderer.invoke("dexnest:get-finance-state"),
  getCaptureState: () => ipcRenderer.invoke("dexnest:get-capture-state"),
  getHeatmapState: () => ipcRenderer.invoke("dexnest:get-heatmap-state"),
  getRoutinesState: () => ipcRenderer.invoke("dexnest:get-routines-state"),
  getBackupState: () => ipcRenderer.invoke("dexnest:get-backup-state"),
  getAppHealth: () => ipcRenderer.invoke("dexnest:get-app-health"),
  getCommandStats: () => ipcRenderer.invoke("dexnest:get-command-stats"),
  selectBackupZip: () => ipcRenderer.invoke("dexnest:select-backup-zip"),
  selectToolsFiles: (kind: "pdf" | "image" | "any") => ipcRenderer.invoke("dexnest:select-tools-files", kind),
  selectVaultFiles: () => ipcRenderer.invoke("dexnest:select-vault-files"),
  selectFinanceReceipt: () => ipcRenderer.invoke("dexnest:select-finance-receipt"),
  selectCaptureFile: () => ipcRenderer.invoke("dexnest:select-capture-file"),
  getPdfInfo: (paths: string[]) => ipcRenderer.invoke("dexnest:get-pdf-info", paths),
  chooseToolsOutputFolder: () => ipcRenderer.invoke("dexnest:choose-tools-output-folder"),
  resetToolsOutputFolder: () => ipcRenderer.invoke("dexnest:reset-tools-output-folder"),
  saveToolsSettings: (payload: { ffmpegPath?: string | null; libreOfficePath?: string | null }) =>
    ipcRenderer.invoke("dexnest:save-tools-settings", payload),
  openToolsFile: (filePath: string) => ipcRenderer.invoke("dexnest:open-tools-file", filePath),
  copyDropIncomingText: (itemId: string) => ipcRenderer.invoke("dexnest:copy-drop-incoming-text", itemId),
  chooseDropReceiveFolder: () => ipcRenderer.invoke("dexnest:choose-drop-receive-folder"),
  resetDropReceiveFolder: () => ipcRenderer.invoke("dexnest:reset-drop-receive-folder"),
  logDropAutoRefresh: (enabled: boolean) => ipcRenderer.invoke("dexnest:log-drop-auto-refresh", enabled),
  startWindowsDictation: () => ipcRenderer.invoke("dexnest:start-windows-dictation"),
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
