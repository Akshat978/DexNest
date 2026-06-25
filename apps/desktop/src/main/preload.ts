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
  getExternalDevicesState: () => ipcRenderer.invoke("dexnest:get-external-devices-state"),
  getAppHealth: () => ipcRenderer.invoke("dexnest:get-app-health"),
  getCommandStats: () => ipcRenderer.invoke("dexnest:get-command-stats"),
  getPerformanceModeState: () => ipcRenderer.invoke("dexnest:get-performance-mode-state"),
  getPerformanceModeSettings: () => ipcRenderer.invoke("dexnest:get-performance-mode-settings"),
  savePerformanceModeSettings: (payload: Record<string, boolean>) => ipcRenderer.invoke("dexnest:save-performance-mode-settings", payload),
  setPerformanceModeEnabled: (payload: { enabled: boolean; reason?: string }) => ipcRenderer.invoke("dexnest:set-performance-mode-enabled", payload),
  selectBackupZip: () => ipcRenderer.invoke("dexnest:select-backup-zip"),
  selectToolsFiles: (kind: "pdf" | "image" | "any") => ipcRenderer.invoke("dexnest:select-tools-files", kind),
  selectVaultFiles: () => ipcRenderer.invoke("dexnest:select-vault-files"),
  selectFinanceReceipt: () => ipcRenderer.invoke("dexnest:select-finance-receipt"),
  selectCaptureFile: () => ipcRenderer.invoke("dexnest:select-capture-file"),
  getPdfInfo: (paths: string[]) => ipcRenderer.invoke("dexnest:get-pdf-info", paths),
  chooseToolsOutputFolder: () => ipcRenderer.invoke("dexnest:choose-tools-output-folder"),
  resetToolsOutputFolder: () => ipcRenderer.invoke("dexnest:reset-tools-output-folder"),
  saveToolsSettings: (payload: { ffmpegPath?: string | null; libreOfficePath?: string | null; tesseractPath?: string | null; pythonPath?: string | null; ocrEngine?: string; ocrDevice?: string; ocrLanguage?: string }) =>
    ipcRenderer.invoke("dexnest:save-tools-settings", payload),
  openToolsFile: (filePath: string) => ipcRenderer.invoke("dexnest:open-tools-file", filePath),
  getAssistantState: () => ipcRenderer.invoke("dexnest:get-assistant-state"),
  saveAssistantSettings: (payload: { localIntentEngineEnabled?: boolean; ollamaUrl?: string; ollamaModel?: string; fallbackToRules?: boolean }) =>
    ipcRenderer.invoke("dexnest:save-assistant-settings", payload),
  testOllama: (payload: { ollamaUrl?: string; ollamaModel?: string }) => ipcRenderer.invoke("dexnest:test-ollama", payload),
  assistantLlmIntent: (payload: { query: string }) => ipcRenderer.invoke("dexnest:assistant-llm-intent", payload),
  getAssistantSecurityState: () => ipcRenderer.invoke("dexnest:get-assistant-security-state"),
  saveAssistantSecuritySettings: (payload: { trustedSessionEnabled?: boolean; autoRevealWhileUnlocked?: boolean; sessionTimeoutMinutes?: number; speakSensitiveAnswers?: boolean; lockOnAppClose?: boolean }) =>
    ipcRenderer.invoke("dexnest:save-assistant-security-settings", payload),
  unlockTrustedSession: (payload: { masterPassword?: string }) => ipcRenderer.invoke("dexnest:unlock-trusted-session", payload),
  lockTrustedSession: () => ipcRenderer.invoke("dexnest:lock-trusted-session"),
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
    ipcRenderer.invoke("dexnest:log-ui-event", payload),
  rendererReady: () => ipcRenderer.send("dexnest:renderer-ready"),
  onClipboardHotkeyResult: (callback: (payload: { message: string; tone: "success" | "error" }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { message: string; tone: "success" | "error" }) => callback(payload);
    ipcRenderer.on("dexnest:clipboard-hotkey-result", listener);
    return () => ipcRenderer.removeListener("dexnest:clipboard-hotkey-result", listener);
  },
  onOpenView: (callback: (payload: { view: string; focusAssistant?: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { view: string; focusAssistant?: boolean }) => callback(payload);
    ipcRenderer.on("dexnest:open-view", listener);
    return () => ipcRenderer.removeListener("dexnest:open-view", listener);
  }
});
