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
  getPins: () => ipcRenderer.invoke("dexnest:get-pins"),
  getDemoState: () => ipcRenderer.invoke("dexnest:get-demo-state"),
  togglePin: (pin: unknown) => ipcRenderer.invoke("dexnest:toggle-pin", pin),
  setPin: (payload: { pin: unknown; pinned: boolean }) => ipcRenderer.invoke("dexnest:set-pin", payload),
  unpinById: (id: string) => ipcRenderer.invoke("dexnest:unpin-by-id", id),
  getClipboardState: () => ipcRenderer.invoke("dexnest:get-clipboard-state"),
  getDropState: () => ipcRenderer.invoke("dexnest:get-drop-state"),
  createDropLink: () => ipcRenderer.invoke("dexnest:create-drop-link"),
  getCalendarAccounts: () => ipcRenderer.invoke("dexnest:calendar-accounts"),
  setCalendarApp: (provider: string, clientId: string, clientSecret: string | null) =>
    ipcRenderer.invoke("dexnest:calendar-set-app", provider, clientId, clientSecret),
  connectCalendar: (provider: string) => ipcRenderer.invoke("dexnest:calendar-connect", provider),
  syncCalendars: () => ipcRenderer.invoke("dexnest:calendar-sync"),
  disconnectCalendar: (accountId: string) => ipcRenderer.invoke("dexnest:calendar-disconnect", accountId),
  getToolsState: () => ipcRenderer.invoke("dexnest:get-tools-state"),
  getVaultState: () => ipcRenderer.invoke("dexnest:get-vault-state"),
  getSearchState: () => ipcRenderer.invoke("dexnest:get-search-state"),
  getJournalState: () => ipcRenderer.invoke("dexnest:get-journal-state"),
  getCalendarState: () => ipcRenderer.invoke("dexnest:get-calendar-state"),
  getTimetableState: () => ipcRenderer.invoke("dexnest:get-timetable-state"),
  getUtilitiesState: () => ipcRenderer.invoke("dexnest:get-utilities-state"),
  getWeatherState: () => ipcRenderer.invoke("dexnest:get-weather-state"),
  getProviderLimits: () => ipcRenderer.invoke("dexnest:provider-limits"),
  getNewsState: () => ipcRenderer.invoke("dexnest:get-news-state"),
  getFinderState: () => ipcRenderer.invoke("dexnest:get-finder-state"),
  getFinanceState: () => ipcRenderer.invoke("dexnest:get-finance-state"),
  getCaptureState: () => ipcRenderer.invoke("dexnest:get-capture-state"),
  getHeatmapState: () => ipcRenderer.invoke("dexnest:get-heatmap-state"),
  getRoutinesState: () => ipcRenderer.invoke("dexnest:get-routines-state"),
  getBackupState: () => ipcRenderer.invoke("dexnest:get-backup-state"),
  getExternalDevicesState: () => ipcRenderer.invoke("dexnest:get-external-devices-state"),
  getDataManagementState: () => ipcRenderer.invoke("dexnest:get-data-management-state"),
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
  getSpeechState: () => ipcRenderer.invoke("dexnest:get-speech-state"),
  getVoiceWorkflowSettings: () => ipcRenderer.invoke("dexnest:get-voice-workflow-settings"),
  saveVoiceWorkflowSettings: (payload: Record<string, unknown>) => ipcRenderer.invoke("dexnest:save-voice-workflow-settings", payload),
  saveSpeechSettings: (payload: Record<string, unknown>) => ipcRenderer.invoke("dexnest:save-speech-settings", payload),
  checkSpeechModel: () => ipcRenderer.invoke("dexnest:check-speech-model"),
  installSpeechModel: () => ipcRenderer.invoke("dexnest:install-speech-model"),
  warmSpeechEngine: () => ipcRenderer.invoke("dexnest:warm-speech-engine"),
  getWakeEngineState: () => ipcRenderer.invoke("dexnest:get-wake-engine-state"),
  checkWakeEngine: () => ipcRenderer.invoke("dexnest:check-wake-engine"),
  startWakeEngine: () => ipcRenderer.invoke("dexnest:start-wake-engine"),
  stopWakeEngine: () => ipcRenderer.invoke("dexnest:stop-wake-engine"),
  voiceOverlay: (payload: { type?: string; state?: string; level?: number }) => ipcRenderer.send("dexnest:voice-overlay", payload),
  onVoiceOverlay: (callback: (payload: { type?: string; state?: string; level?: number; animations?: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { type?: string; state?: string; level?: number; animations?: boolean }) => callback(payload);
    ipcRenderer.on("dexnest-overlay:update", listener);
    return () => ipcRenderer.removeListener("dexnest-overlay:update", listener);
  },
  onWakeDetected: (callback: (payload: { source: string; score: number | null }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { source: string; score: number | null }) => callback(payload);
    ipcRenderer.on("dexnest:wake-detected", listener);
    return () => ipcRenderer.removeListener("dexnest:wake-detected", listener);
  },
  onRunAssistantCommand: (callback: (payload: { text: string; source?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { text: string; source?: string }) => callback(payload);
    ipcRenderer.on("dexnest:run-assistant-command", listener);
    return () => ipcRenderer.removeListener("dexnest:run-assistant-command", listener);
  },
  openSpeechModelFolder: () => ipcRenderer.invoke("dexnest:open-speech-model-folder"),
  transcribeSpeech: (payload: { audioBytes?: ArrayBuffer | Uint8Array | number[]; mimeType?: string; source?: string; sourceModule?: string; language?: string; manualOverride?: boolean }) =>
    ipcRenderer.invoke("dexnest:transcribe-speech", payload),
  getAmbientVoiceState: () => ipcRenderer.invoke("dexnest:get-ambient-voice-state"),
  saveAmbientVoiceSettings: (payload: Record<string, unknown>) => ipcRenderer.invoke("dexnest:save-ambient-voice-settings", payload),
  updateAmbientVoiceState: (payload: Record<string, unknown>) => ipcRenderer.invoke("dexnest:update-ambient-voice-state", payload),
  startAmbientListening: (payload?: { source?: string }) => ipcRenderer.invoke("dexnest:start-ambient-listening", payload ?? {}),
  getAssistantSecurityState: () => ipcRenderer.invoke("dexnest:get-assistant-security-state"),
  saveAssistantSecuritySettings: (payload: { trustedSessionEnabled?: boolean; autoRevealWhileUnlocked?: boolean; sessionTimeoutMinutes?: number; speakSensitiveAnswers?: boolean; lockOnAppClose?: boolean }) =>
    ipcRenderer.invoke("dexnest:save-assistant-security-settings", payload),
  unlockTrustedSession: (payload: { masterPassword?: string }) => ipcRenderer.invoke("dexnest:unlock-trusted-session", payload),
  lockTrustedSession: () => ipcRenderer.invoke("dexnest:lock-trusted-session"),
  copyDropIncomingText: (itemId: string) => ipcRenderer.invoke("dexnest:copy-drop-incoming-text", itemId),
  chooseDropReceiveFolder: () => ipcRenderer.invoke("dexnest:choose-drop-receive-folder"),
  pickDropOutgoingFiles: () => ipcRenderer.invoke("dexnest:pick-drop-outgoing-files"),
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
  onOpenView: (callback: (payload: { view: string; focusAssistant?: boolean; startListening?: boolean; source?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { view: string; focusAssistant?: boolean; startListening?: boolean; source?: string }) => callback(payload);
    ipcRenderer.on("dexnest:open-view", listener);
    return () => ipcRenderer.removeListener("dexnest:open-view", listener);
  },

  // --- Autopilot: durable spine and explicitly approved worker turns -------
  // The renderer is a viewer. Run state lives in the main process and SQLite, so
  // closing or reloading this window never disturbs a run.
  autopilotListRuns: () => ipcRenderer.invoke("dexnest:autopilot-list-runs"),
  autopilotDashboard: () => ipcRenderer.invoke("dexnest:autopilot-dashboard"),
  autopilotReadiness: (project: string) => ipcRenderer.invoke("dexnest:autopilot-readiness", project),
  autopilotRerunForm: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-rerun-form", runId),
  autopilotRunChanges: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-run-changes", runId),
  autopilotDraftPlan: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-draft-plan", runId),
  autopilotCreateAutomation: (input: unknown, options?: { start?: boolean }) => ipcRenderer.invoke("dexnest:autopilot-create-automation", input, options),
  autopilotRunPrimary: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-run-primary", runId),
  autopilotApproveConsultation: (scope: { runId: string; requestId: string; consultantProvider: "claude" | "codex" }) => ipcRenderer.invoke("dexnest:autopilot-consultation-approve", scope),
  autopilotCancelConsultation: (scope: { runId: string; requestId: string; consultantProvider: "claude" | "codex" }) => ipcRenderer.invoke("dexnest:autopilot-consultation-cancel", scope),
  autopilotWorkerConfig: () => ipcRenderer.invoke("dexnest:autopilot-worker-config"),
  autopilotWorkerPrepare: (input: { runId: string; prompt: string; retryOf?: string }) => ipcRenderer.invoke("dexnest:autopilot-worker-prepare", input),
  autopilotWorkerSend: (input: { runId: string; sendId: string }) => ipcRenderer.invoke("dexnest:autopilot-worker-send", input),
  autopilotWorkerResolve: (input: { runId: string; sendId: string; decision: "completed" | "not_sent" | "keep_unresolved"; evidence: string }) => ipcRenderer.invoke("dexnest:autopilot-worker-resolve", input),
  autopilotWorkerInterrupt: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-worker-interrupt", runId),
  autopilotGetRun: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-get-run", runId),
  autopilotCreateRun: (input: { goal: string; constraints?: string[]; nonGoals?: string[] }) =>
    ipcRenderer.invoke("dexnest:autopilot-create-run", input),
  autopilotStartRun: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-start-run", runId),
  autopilotPauseRun: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-pause-run", runId),
  autopilotResumeRun: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-resume-run", runId),
  autopilotStopRun: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-stop-run", runId),
  autopilotReport: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-report", runId),
  autopilotReportExport: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-report-export", runId),
  autopilotHandoffPropose: (input: { runId: string; toProvider: "claude" | "codex"; reason?: string }) =>
    ipcRenderer.invoke("dexnest:autopilot-handoff-propose", input),
  autopilotHandoffApprove: (scope: { runId: string; handoffId: string; toProvider: "claude" | "codex" }) =>
    ipcRenderer.invoke("dexnest:autopilot-handoff-approve", scope),
  autopilotHandoffCancel: (scope: { runId: string; handoffId: string; toProvider: "claude" | "codex" }) =>
    ipcRenderer.invoke("dexnest:autopilot-handoff-cancel", scope),
  autopilotHandoffActivate: (input: { runId: string; handoffId: string; toProvider: "claude" | "codex"; maxTurns: number }) =>
    ipcRenderer.invoke("dexnest:autopilot-handoff-activate", input),
  autopilotDirectionSwitch: (input: { runId: string; source: "self" | "chat"; reason: string }) =>
    ipcRenderer.invoke("dexnest:autopilot-direction-switch", input),
  autopilotMorningSummary: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-morning-summary", runId),
  autopilotActivity: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-activity", runId),
  autopilotAddNote: (input: { runId: string; text: string }) => ipcRenderer.invoke("dexnest:autopilot-note-add", input),
  autopilotNotes: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-notes", runId),
  autopilotQueue: () => ipcRenderer.invoke("dexnest:autopilot-queue"),
  autopilotQueueCreate: (input: unknown) => ipcRenderer.invoke("dexnest:autopilot-queue-create", input),
  autopilotQueueClose: (queueId: string) => ipcRenderer.invoke("dexnest:autopilot-queue-close", queueId),
  autopilotQueueSchedules: () => ipcRenderer.invoke("dexnest:autopilot-queue-schedules"),
  autopilotAttention: (runId?: string) => ipcRenderer.invoke("dexnest:autopilot-attention", runId),
  autopilotDevices: () => ipcRenderer.invoke("dexnest:autopilot-devices"),
  autopilotDeviceRegister: (input: unknown) => ipcRenderer.invoke("dexnest:autopilot-device-register", input),
  autopilotDeviceRemove: (id: string) => ipcRenderer.invoke("dexnest:autopilot-device-remove", id),
  autopilotPairingOpen: () => ipcRenderer.invoke("dexnest:autopilot-pairing-open"),
  autopilotPairingCurrent: () => ipcRenderer.invoke("dexnest:autopilot-pairing-current"),
  autopilotDeviceCapabilities: (input: { id: string; control?: boolean; drop?: boolean }) => ipcRenderer.invoke("dexnest:autopilot-device-capabilities", input),
  autopilotDeviceUnpair: (id: string) => ipcRenderer.invoke("dexnest:autopilot-device-unpair", id),
  autopilotPushSettings: () => ipcRenderer.invoke("dexnest:autopilot-push-settings"),
  autopilotPushSettingsSave: (settings: unknown) => ipcRenderer.invoke("dexnest:autopilot-push-settings-save", settings),
  autopilotPushVerify: () => ipcRenderer.invoke("dexnest:autopilot-push-verify"),
  autopilotPushTest: (deviceId: string) => ipcRenderer.invoke("dexnest:autopilot-push-test", deviceId),
  autopilotSessionCandidates: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-session-candidates", runId),
  autopilotAttachedSession: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-session-attached", runId),
  autopilotAttachSession: (input: { runId: string; sessionId: string }) => ipcRenderer.invoke("dexnest:autopilot-session-attach", input),
  autopilotPlanCompleteProposal: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-plan-complete-proposal", runId),
  autopilotAcceptPlanComplete: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-plan-complete-accept", runId),
  autopilotRejectPlanComplete: (input: { runId: string; reason: string }) => ipcRenderer.invoke("dexnest:autopilot-plan-complete-reject", input),
  autopilotConsultationRequest: (input: { runId: string; consultantProvider: "claude" | "codex" }) =>
    ipcRenderer.invoke("dexnest:autopilot-consultation-request", input),
  autopilotConsultationRun: (scope: { runId: string; requestId: string; consultantProvider: "claude" | "codex" }) =>
    ipcRenderer.invoke("dexnest:autopilot-consultation-run", scope),
  autopilotLoopAuthorize: (payload: { runId: string; maxTurns: number }) => ipcRenderer.invoke("dexnest:autopilot-loop-authorize", payload),
  autopilotLoopRevoke: (runId: string) => ipcRenderer.invoke("dexnest:autopilot-loop-revoke", runId),
  autopilotLoopRun: (runId: string, input?: { retryProviderLimit?: boolean }) =>
    ipcRenderer.invoke("dexnest:autopilot-loop-run", runId, input),
  autopilotListApprovals: (runId?: string) => ipcRenderer.invoke("dexnest:autopilot-list-approvals", runId),
  autopilotResolveApproval: (payload: { approvalId: string; decision: "APPROVED" | "REJECTED" }) =>
    ipcRenderer.invoke("dexnest:autopilot-resolve-approval", payload),
  autopilotResolveUncertain: (payload: { runId: string; stepKey: string; resolution: "completed" | "not_performed" }) =>
    ipcRenderer.invoke("dexnest:autopilot-resolve-uncertain", payload),
  onAutopilotChanged: (callback: (payload: { runId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { runId: string }) => callback(payload);
    ipcRenderer.on("dexnest:autopilot-changed", listener);
    return () => ipcRenderer.removeListener("dexnest:autopilot-changed", listener);
  }
});
