import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, shell, Tray } from "electron";
import { exec, execFile, execFileSync } from "node:child_process";
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, get as httpGet, type IncomingMessage, type ServerResponse } from "node:http";
import { get as httpsGet } from "node:https";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import AdmZip from "adm-zip";
import { startSlotHook, stopSlotHook, isSlotHookRunning } from "./clipboardSlotHook.js";
import { PDFDocument } from "pdf-lib";
import { Jimp } from "jimp";
import { createActionRegistry, seededActions } from "@dexnest/action-registry";
import { createLocalDb } from "@dexnest/local-db";
import type { MessageBoxOptions, MessageBoxSyncOptions, OpenDialogOptions, OpenDialogSyncOptions } from "electron";
import type { DexNestActionDefinition, DexNestActionTrigger, DexNestEventStatus } from "@dexnest/shared-types";
import { formatLocalDateTime, getLocalTodayDateString, parseLocalDateInput, resolveRelativeLocalDate, toLocalDateInputValue } from "@dexnest/shared-types";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../..");
const localDataRoot = resolve(repoRoot, "local-data");
const settingsRoot = join(localDataRoot, "settings");
const dropFilesRoot = join(localDataRoot, "files", "drop");
const dropIncomingRoot = join(dropFilesRoot, "incoming");
const dropOutgoingRoot = join(dropFilesRoot, "outgoing");
const dropTempRoot = join(dropFilesRoot, "temp");
const toolsFilesRoot = join(localDataRoot, "files", "tools");
const toolsInputRoot = join(toolsFilesRoot, "input");
const toolsOutputRoot = join(toolsFilesRoot, "output");
const toolsTempRoot = join(toolsFilesRoot, "temp");
const vaultFilesRoot = join(localDataRoot, "files", "vault");
const vaultDocumentsRoot = join(vaultFilesRoot, "documents");
const vaultImportsRoot = join(vaultFilesRoot, "imports");
const vaultVersionsRoot = join(vaultFilesRoot, "versions");
const vaultTempRoot = join(vaultFilesRoot, "temp");
const vaultSecureRoot = join(vaultFilesRoot, "secure");
const vaultOcrRoot = join(vaultFilesRoot, "ocr");
const speechModelsRoot = join(localDataRoot, "models", "speech");
const speechTempRoot = join(localDataRoot, "files", "speech", "temp");
const speechDebugAudioRoot = join(localDataRoot, "debug", "audio");
const speechSidecarPythonPath = join(repoRoot, "sidecars", "speech", ".venv", "Scripts", "python.exe");
const receiptsRoot = join(localDataRoot, "files", "receipts");
const capturesRoot = join(localDataRoot, "files", "captures");
const projectsConfigPath = join(settingsRoot, "projects.json");
const commandSettingsPath = join(settingsRoot, "command-settings.json");
const keyboardShortcutsPath = join(settingsRoot, "keyboard-shortcuts.json");
const streamDeckSettingsPath = join(settingsRoot, "stream-deck-settings.json");
const commandResultsPath = join(settingsRoot, "project-command-results.json");
const pinnedActionsPath = join(settingsRoot, "pinned-actions.json");
const clipboardHistoryPath = join(settingsRoot, "clipboard-history.json");
const clipboardSnippetsPath = join(settingsRoot, "clipboard-snippets.json");
const clipboardSettingsPath = join(settingsRoot, "clipboard-settings.json");
const clipboardMultiGroupsPath = join(settingsRoot, "clipboard-multi-groups.json");
const clipboardActiveMultiCopyPath = join(settingsRoot, "clipboard-active-multicopy.json");
const clipboardSlotsPath = join(settingsRoot, "clipboard-slots.json");
const dropShelfPath = join(settingsRoot, "drop-shelf.json");
const dropIncomingPath = join(settingsRoot, "drop-incoming.json");
const dropSettingsPath = join(settingsRoot, "drop-settings.json");
const toolsOutputsPath = join(settingsRoot, "tools-outputs.json");
const toolsSettingsPath = join(settingsRoot, "tools-settings.json");
const vaultDocumentsPath = join(settingsRoot, "vault-documents.json");
const vaultOcrJobsPath = join(settingsRoot, "vault-ocr-jobs.json");
const vaultOcrSettingsPath = join(settingsRoot, "vault-ocr-settings.json");
const secureVaultPath = join(vaultSecureRoot, "secure-vault.json");
const searchIndexRoot = join(localDataRoot, "index");
const searchIndexPath = join(searchIndexRoot, "search-index.json");
const savedSearchesPath = join(settingsRoot, "saved-searches.json");
const journalEntriesPath = join(settingsRoot, "journal-entries.json");
const calendarEventsPath = join(settingsRoot, "calendar-events.json");
const nudgesPath = join(settingsRoot, "nudges.json");
const nudgeSettingsPath = join(settingsRoot, "nudge-settings.json");
const finderItemsPath = join(settingsRoot, "finder-items.json");
const financeTransactionsPath = join(settingsRoot, "finance-transactions.json");
const financeRecurringPath = join(settingsRoot, "finance-recurring.json");
const financeSettingsPath = join(settingsRoot, "finance-settings.json");
const financeProfilesPath = join(settingsRoot, "finance-profiles.json");
const captureItemsPath = join(settingsRoot, "capture-items.json");
const routinesPath = join(settingsRoot, "routines.json");
const heatmapEventsPath = join(settingsRoot, "heatmap-events.json");
const heatmapSettingsPath = join(settingsRoot, "heatmap-settings.json");
const heatmapGoalsPath = join(settingsRoot, "heatmap-goals.json");
const assistantSettingsPath = join(settingsRoot, "assistant-settings.json");
const assistantSecuritySettingsPath = join(settingsRoot, "assistant-security-settings.json");
const speechSettingsPath = join(settingsRoot, "speech-settings.json");
const voiceWorkflowSettingsPath = join(settingsRoot, "voice-workflow-settings.json");
const ambientVoiceSettingsPath = join(settingsRoot, "ambient-voice-settings.json");
const externalDevicesSettingsPath = join(settingsRoot, "external-devices-settings.json");
const externalDevicesCachePath = join(settingsRoot, "external-devices-cache.json");
const externalDevicesGroupsPath = join(settingsRoot, "external-devices-groups.json");
const goveeLocalApiKeyPath = join(settingsRoot, "govee-api-key.local.json");
const integrationKeychainPath = join(settingsRoot, "integration-keychain.json");
const performanceModeSettingsPath = join(settingsRoot, "performance-mode-settings.json");
const appLifecycleSettingsPath = join(settingsRoot, "app-lifecycle-settings.json");
const searchIndexStatusPath = join(settingsRoot, "search-index-status.json");
const dataManagementStatusPath = join(settingsRoot, "data-management-status.json");
const backupsRoot = join(localDataRoot, "backups");
const restoreStagingRoot = join(backupsRoot, "restore-staging");
const actionPort = 43217;
const dropEventClients = new Set<ServerResponse>();
let heatmapSampleTimer: ReturnType<typeof setInterval> | null = null;

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
let rendererReady = false;
let pendingOpenView: { view: string; focusAssistant?: boolean; startListening?: boolean; source?: DexNestActionTrigger } | null = null;
let tray: Tray | null = null;
let actionServer: ReturnType<typeof createServer> | null = null;
let secureVaultKey: Buffer | null = null;
// Trusted sensitive-access session for the Assistant. In-memory only — never
// persisted — so it is always locked again on app close. Established by reusing
// the Secure Vault master password (no separate password system).
let trustedSessionExpiresAt: number | null = null;
let secureVaultAutoLockTimer: NodeJS.Timeout | null = null;
let secureVaultClipboardTimer: NodeJS.Timeout | null = null;
let secureVaultProtectedClipboardValue: string | null = null;
let clipboardListenerTimer: ReturnType<typeof setInterval> | null = null;
let clipboardMultiCopyTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let clipboardPasteFallbackTimer: ReturnType<typeof setInterval> | null = null;
let lastClipboardListenerText = "";
let clipboardHotkeyRegistered = false;
let registeredClipboardHotkey = "";
let clipboardHotkeyBusy = false;
let clipboardPasteHotkeyRegistered = false;
let clipboardPasteReplayBusy = false;
let clipboardArmedPasteText = "";
let commandShortcutRegistered = false;
let registeredCommandShortcut = "";
let ambientVoiceShortcutRegistered = false;
let registeredAmbientVoiceShortcut = "";
let registeredKeyboardShortcuts: string[] = [];
let vaultOcrQueueRunning = false;
let vaultOcrQueuePaused = false;
let isQuittingDexNest = false;
let closePromptOpen = false;
let trayCloseNoticeShownThisSession = false;
let trayModeActive = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

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
  // Lifecycle config (optional) — used by stop/restart/kill-ports/docker/logs/health.
  ports?: number[];
  stopCommand?: string;
  logCommand?: string;
  logPath?: string;
  dockerComposeEnabled?: boolean;
  healthUrl?: string;
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
  ports?: number[];
  stopCommand?: string;
  logCommand?: string;
  logPath?: string;
  dockerComposeEnabled?: boolean;
  healthUrl?: string;
}

interface RunActionInput {
  actionId: string;
  source?: DexNestActionTrigger;
  params?: {
    confirmedDangerous?: boolean;
  };
}

interface CommandSettings {
  globalShortcutEnabled: boolean;
  globalShortcut: string;
  globalShortcutStatus: "active" | "disabled" | "failed";
  globalShortcutLastError: string | null;
  trayEnabled: boolean;
  trayStatus: "active" | "failed";
}

interface KeyboardShortcutMapping {
  id: string;
  label: string;
  shortcut: string;
  targetType: "action" | "routine";
  actionId?: string;
  routineId?: string;
  enabled: boolean;
  allowDangerous: boolean;
  status: "active" | "disabled" | "failed" | "conflict" | "blocked";
  lastError: string | null;
}

interface KeyboardShortcutSettings {
  enabled: boolean;
  mappings: KeyboardShortcutMapping[];
  updatedAt: string;
}

type AmbientVoiceStatus = "idle" | "listening" | "processing" | "speaking" | "paused";

interface AmbientVoiceSettings {
  ambientVoiceEnabled: boolean;
  wakeWordEnabled: boolean;
  wakeWord: string;
  // Phase 23.8 wake-word MVP settings.
  wakeWordEngine?: "placeholder" | "openwakeword" | "porcupine_optional" | "custom";
  wakeWordSensitivity?: number;
  listenAfterWakeMs?: number;
  wakeCooldownMs?: number;
  pauseWakeWordInPerformanceMode?: boolean;
  playWakeSound?: boolean;
  requireVisibleIndicator?: boolean;
  allowWakeWordWhileLocked?: boolean;
  allowWakeWordDeviceControl?: boolean;
  allowWakeWordSensitiveLookup?: boolean;
  selectedWakeMicDeviceId?: string | null;
  wakePhraseMode?: "custom_nest" | "hey_jarvis" | "alexa" | "custom_path";
  wakeCustomModelPath?: string | null;
  pushToTalkEnabled: boolean;
  pushToTalkShortcut: string;
  pushToTalkShortcutStatus: "active" | "disabled" | "failed" | "paused";
  pushToTalkShortcutLastError: string | null;
  visibleListeningIndicator: boolean;
  playStartSound: boolean;
  playStopSound: boolean;
  autoSendAfterSpeech: boolean;
  stopListeningAfterCommand: boolean;
  pauseInPerformanceMode: boolean;
  allowDeviceControl: boolean;
  allowClipboardActions: boolean;
  allowDevActions: boolean;
  allowSensitiveLookups: boolean;
  speakResponses: boolean;
  speakSensitiveAnswers: boolean;
  speakErrors?: boolean;
  speakConfirmations?: boolean;
  speakWorkflowStatus?: boolean;
  voiceName?: string | null;
  voiceRate: number;
  voiceVolume: number;
  shortResponsesOnly: boolean;
  muteInPerformanceMode: boolean;
  maxListeningSeconds: number;
  commandCooldownMs: number;
  wakeChimeEnabled?: boolean;
  wakeChimeVolume?: number;
  voiceOverlayEnabled?: boolean;
  voiceOverlayScreen?: string;
  voiceOverlayPosition?: string;
  voiceOverlaySize?: "compact" | "normal";
  voiceOverlayAnimations?: boolean;
  updatedAt: string;
}

interface AmbientVoiceState {
  settingsPath: string;
  settings: AmbientVoiceSettings;
  currentState: AmbientVoiceStatus;
  lastRecognizedCommand: string;
  lastActionResult: string;
  lastSource: DexNestActionTrigger | "system";
  lastChangedAt: string;
  pausedByPerformanceMode: boolean;
  wakeWordStatus: "placeholder" | "disabled";
}

interface StreamDeckSettings {
  localOnly: boolean;
  lanEnabled: boolean;
  tokenEnabled: boolean;
  token: string;
  updatedAt: string;
}

type PerformanceModeReason = "manual" | "fullscreen" | "game-detected" | "scheduled" | "unknown";

type AppCloseBehavior = "minimize_to_tray" | "ask" | "exit";

interface AppLifecycleSettings {
  closeBehavior: AppCloseBehavior;
  showTrayCloseNotice: boolean;
  minimizeToTrayOnStartup: boolean;
  startDexNestWithWindows: boolean;
  startMinimizedToTray: boolean;
  loginItemStatus: "enabled" | "disabled" | "failed";
  loginItemLastError: string | null;
  updatedAt: string;
}

interface PerformanceModeSettings {
  performanceModeEnabled: boolean;
  pauseHeatmap: boolean;
  pauseOcrJobs: boolean;
  pauseSearchAutoIndex: boolean;
  pauseBackups: boolean;
  suppressNonUrgentNudges: boolean;
  allowDropWhenOpen: boolean;
  allowUserTriggeredAssistant: boolean;
  autoEnableWhenFullscreen: boolean;
  autoEnableWhenGameDetected: boolean;
  showTrayStatus: boolean;
}

interface PerformanceModeState {
  enabled: boolean;
  reason: PerformanceModeReason;
  enabledAt: string | null;
  pausedWorkers: string[];
  lastChangedAt: string;
}

interface SearchIndexStatus {
  staleDueToPerformanceMode: boolean;
  staleReason: string | null;
  staleSince: string | null;
  lastSkippedAutoIndexAt: string | null;
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
  source?: "manual" | "listener" | "multi_copy" | "slot" | "snippet";
}

interface ClipboardSnippet {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface ClipboardSettings {
  listenerEnabled: boolean;
  listenerIntervalMs: number;
  historyRetentionDays: 1 | 3 | 7 | 30 | "never";
  lastHistoryCleanupAt: string | null;
  multiCopyHotkeyEnabled: boolean;
  multiCopyHotkey: string;
  multiCopyHotkeyStatus: "active" | "disabled" | "failed";
  multiCopyHotkeyLastError: string | null;
  multiCopyAutoClearMinutes: number;
  multiCopyLastHotkeyAt: string | null;
  multiCopyLastHotkeyStatus: "idle" | "success" | "failed" | "skipped";
  multiCopyLastHotkeyMessage: string;
  lastCaptureAt: string | null;
  lastCapturedPreview: string;
  lastReadAt: string | null;
  lastReadPreview: string;
  lastReadError: string | null;
  combinedSeparator: string;
  activeMultiCopySession: {
    id: string;
    startedAt: string;
    items: ClipboardHistoryItem[];
  } | null;
  appExclusionRules: string[];
  secretProtectionEnabled: boolean;
  // Natural slot shortcut sequences: hold Ctrl, tap 1/2/3, then C (save) or V (paste).
  // Implemented via a low-level keyboard hook that only suppresses Ctrl+digit when
  // it is completed by C/V (otherwise the digit is re-injected, so browser tab
  // switching and normal Ctrl+C / Ctrl+V keep working). Off by default.
  slotSequenceEnabled: boolean;
  slotSequenceStatus: "active" | "disabled" | "failed";
  slotSequenceLastError: string | null;
  slotSequenceWindowMs: number;
}

interface ClipboardActiveMultiCopySession {
  id: string;
  startedAt: string;
  updatedAt: string;
  armedForPasteAt?: string | null;
  completedAt?: string | null;
  items: ClipboardHistoryItem[];
}

interface ClipboardMultiGroup {
  id: string;
  name: string;
  items: ClipboardHistoryItem[];
  createdAt: string;
  updatedAt: string;
}

interface ClipboardSlot {
  slot: number;
  slotId?: number;
  type?: "text";
  value?: string;
  text: string;
  preview: string;
  byteLength: number;
  createdAt?: string;
  updatedAt: string;
  source?: "keyboard_shortcut" | "clipboard_ui" | "command" | "module_ui";
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

interface ToolsOutputItem {
  id: string;
  fileName: string;
  path: string;
  byteLength: number;
  operation: string;
  createdAt: string;
}

interface ToolsSettings {
  outputFolderPath: string | null;
  ffmpegPath?: string | null;
  libreOfficePath?: string | null;
  tesseractPath?: string | null;
  pythonPath?: string | null;
  ocrEngine?: "tesseract" | "paddleocr" | "easyocr_placeholder";
  ocrDevice?: "gpu" | "cpu";
  ocrLanguage?: string;
}

interface ToolsSelectedFile {
  path: string;
  name: string;
  byteLength: number;
  extension: string;
}

interface ToolsRunResult {
  ok: boolean;
  actionId: string;
  outputs?: ToolsOutputItem[];
  output?: ToolsOutputItem;
  info?: Array<{ fileName: string; byteLength: number; pageCount: number | null }>;
  ocrPreview?: string;
  ocrMetadata?: { engine: string; averageConfidence: number | null };
  error?: string;
}

type SpeechEngine = "faster_whisper" | "whisper_cpp" | "windows_fallback";
type SpeechDevice = "auto" | "cuda" | "cpu";
type SpeechComputeType = "auto" | "int8" | "float16";
type SpeechStatus = "success" | "failed" | "cancelled";

interface SpeechSettings {
  speechEngine: SpeechEngine;
  fallbackToWindows: boolean;
  keepSpeechModelWarm?: boolean;
  modelName: string;
  modelSizeOptions: string[];
  device: SpeechDevice;
  computeType: SpeechComputeType;
  maxRecordingSeconds: number;
  silenceStopEnabled: boolean;
  vadEnabled: boolean;
  // Phase 23A.1 VAD/silence knobs.
  initialSilenceTimeoutMs?: number;
  endSilenceTimeoutMs?: number;
  minSpeechMs?: number;
  silenceThreshold?: number | "auto";
  autoStopOnSilence?: boolean;
  micPrewarmEnabled?: boolean;
  // Voice Audio Focus / noise hardening.
  selectedInputDeviceId?: string | null;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  vadMode?: "auto" | "manual";
  noiseFloor?: number;
  speechThresholdMargin?: number;
  micSensitivity?: number;
  maxPostSpeechListenMs?: number;
  requireSpeechStart?: boolean;
  adaptiveSilenceThreshold?: boolean;
  mainSpeakerMode?: boolean;
  speakerVerificationEnabled?: boolean;
  keepAudioForDebug: boolean;
  pauseInPerformanceMode: boolean;
  autoSendAfterSpeech: boolean;
  showTranscriptBeforeSend: boolean;
  useSharedSpeechEverywhere: boolean;
  pythonPath?: string | null;
  updatedAt: string | null;
}

interface VoiceWorkflowSettings {
  continueCaptureMode: boolean;
  autoSaveCaptureVoiceNotes: boolean;
  confirmBeforeSavingCapture: boolean;
  confirmSensitiveCapture: boolean;
  autoCreateHighConfidenceCalendarVoiceEvents: boolean;
  defaultMeetingDurationMinutes: number;
  defaultReminderTime: string;
  askBeforeRecurringEvents: boolean;
  updatedAt: string;
}

interface SpeechModelStatus {
  ok: boolean;
  installed: boolean;
  message: string;
  engine: SpeechEngine;
  model: string;
  modelPath: string;
  pythonPath: string | null;
  deviceDetected: "cuda" | "cpu" | "unknown";
  fasterWhisperAvailable: boolean;
  lastLatencyMs?: number | null;
  lastError?: string | null;
}

interface SpeechServiceState {
  settingsPath: string;
  modelRoot: string;
  debugAudioRoot: string;
  settings: SpeechSettings;
  modelStatus: SpeechModelStatus;
  windowsFallbackAvailable: boolean;
  performancePaused: boolean;
  engineState?: SpeechEngineState;
  warmDiagnostics?: SpeechWorkerDiagnostics;
}

interface SpeechTranscriptionResult {
  transcript: string;
  engine: SpeechEngine;
  model: string;
  language: string;
  durationMs: number;
  confidence?: number;
  status: SpeechStatus;
  error?: string;
}

interface VaultDocumentRecord {
  id: string;
  title: string;
  originalFileName: string;
  storedFileName: string;
  filePath: string;
  fileType: string;
  sizeBytes: number;
  category: string;
  tags: string[];
  notes: string;
  sourceModule: string;
  expiryDate?: string | null;
  createdAt: string;
  updatedAt: string;
  versionGroupId?: string | null;
  versionNumber?: number | null;
  ocrStatus?: "not_ocred" | "queued" | "running" | "completed" | "failed" | "skipped" | "unsupported";
  ocrTextPath?: string | null;
  ocrMetadataPath?: string | null;
  ocrError?: string | null;
  ocrUpdatedAt?: string | null;
}

interface VaultOcrJob {
  id: string;
  documentId: string;
  filePath: string;
  fileType: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  engine: "paddleocr";
  device: "gpu";
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  outputTextPath?: string | null;
  outputMetadataPath?: string | null;
}

interface VaultOcrSettings {
  autoOcrOnImport: boolean;
  engine: "paddleocr";
  device: "gpu";
  pythonPath?: string | null;
}

interface VaultImportInput {
  paths?: string[];
  category?: string;
  tags?: string[] | string;
  notes?: string;
  expiryDate?: string | null;
  sourceModule?: string;
  title?: string;
  versionOfId?: string;
}

interface VaultState {
  documents: VaultDocumentRecord[];
  categories: string[];
  documentsPath: string;
  importsPath: string;
  versionsPath: string;
  tempPath: string;
  metadataPath: string;
  documentCount: number;
  totalSizeBytes: number;
  ocrJobs: VaultOcrJob[];
  ocrSettings: VaultOcrSettings;
  ocrOutputPath: string;
  ocrJobsPath: string;
  ocrQueueRunning: boolean;
  ocrQueuePaused: boolean;
  paddleGpuStatus: {
    ok: boolean;
    message: string;
    pythonPath: string | null;
    paddleVersion?: string | null;
    deviceCount?: number;
  };
  secure: SecureVaultState;
}

type SecureVaultItemType = "password" | "api_key" | "token" | "recovery_code" | "private_note" | "server" | "other";

interface SecureEncryptedBlob {
  iv: string;
  ciphertext: string;
  authTag: string;
}

interface SecureVaultStoredItem {
  id: string;
  title: string;
  type: SecureVaultItemType;
  username?: string;
  url?: string;
  tags: string[];
  secret: SecureEncryptedBlob;
  notes: SecureEncryptedBlob;
  createdAt: string;
  updatedAt: string;
  lastCopiedAt?: string | null;
  favorite?: boolean;
}

interface SecureVaultFile {
  version: 1;
  kdf: {
    name: "scrypt";
    salt: string;
    keyLength: number;
    N: number;
    r: number;
    p: number;
  };
  verifier: SecureEncryptedBlob;
  settings: {
    autoLockMinutes: number;
    // "on_app_exit" (default): stays unlocked for the whole app session, locks only
    // on manual lock or full quit. "timer": legacy inactivity auto-lock.
    lockMode?: "on_app_exit" | "timer";
  };
  items: SecureVaultStoredItem[];
}

interface SecureVaultUnlockedItem {
  id: string;
  title: string;
  type: SecureVaultItemType;
  username?: string;
  url?: string;
  tags: string[];
  secret: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastCopiedAt?: string | null;
  favorite?: boolean;
}

interface SecureVaultState {
  isSetup: boolean;
  isUnlocked: boolean;
  filePath: string;
  autoLockMinutes: number;
  lockMode: "on_app_exit" | "timer";
  itemTypes: SecureVaultItemType[];
  items: SecureVaultUnlockedItem[];
}

interface ExternalDevicesSettings {
  goveeEnabled: boolean;
  goveeApiKeySecretId: string | null;
  goveeApiKeyCredentialId?: string | null;
  defaultDeviceAlias: string | null;
  allowVoiceControl: boolean;
  allowStreamDeckControl: boolean;
  allowKeyboardShortcutControl: boolean;
  requireConfirmationForPowerOff: boolean;
  requireConfirmationForBrightnessBelow10: boolean;
  requireConfirmationForScenes: boolean;
  updatedAt: string | null;
}

interface ExternalDeviceCacheItem {
  provider: "govee";
  deviceId: string;
  deviceName: string;
  model: string;
  controllable: boolean;
  retrievable: boolean;
  roomAlias: string;
  userAlias: string;
  lastSeen: string;
  lastKnownPowerState?: "on" | "off" | "unknown";
  lastKnownBrightness?: number | null;
}

interface ExternalDeviceGroup {
  id: string;
  name: string;
  aliases: string[];
  provider: "govee";
  deviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ExternalDevicesState {
  settingsPath: string;
  cachePath: string;
  groupsPath: string;
  settings: ExternalDevicesSettings;
  secureVaultSetup: boolean;
  secureVaultUnlocked: boolean;
  apiKeyStored: boolean;
  apiKeyInKeychain: boolean;
  keychainStorageMethod: IntegrationStorageMethod | null;
  keychainAvailable: boolean;
  hasLegacyVaultKey: boolean;
  providerStatus: "disabled" | "ready" | "needs_secure_vault" | "locked" | "missing_api_key";
  providerMessage: string;
  devices: ExternalDeviceCacheItem[];
  groups: ExternalDeviceGroup[];
}

interface SearchIndexRecord {
  id: string;
  sourceModule: string;
  entityType: string;
  entityId: string;
  title: string;
  filePath?: string | null;
  fileType?: string | null;
  sizeBytes?: number | null;
  textPreview?: string;
  searchableText?: string;
  tags?: string[];
  category?: string | null;
  profileId?: string | null;
  profileName?: string | null;
  createdAt: string;
  updatedAt: string;
  indexedAt: string;
}

interface SearchQueryInput {
  query?: string;
  question?: string;
  sourceModule?: string;
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  title?: string;
  savedSearchId?: string;
  resultId?: string;
  indexFolder?: boolean;
  masterPassword?: string;
  includeSecretValues?: boolean;
  answerValue?: string;
  fieldType?: string;
  sourceId?: string;
  confirmedDangerous?: boolean;
}

interface SearchResult extends SearchIndexRecord {
  score: number;
  matchReason: string;
}

interface SecureSearchResult {
  id: string;
  itemId: string;
  title: string;
  type: SecureVaultItemType;
  username?: string;
  url?: string;
  matchedFields: string[];
  masked: true;
  score: number;
}

interface SmartLookupResult {
  id: string;
  fieldType: string;
  answer: string;
  maskedAnswer: string;
  sensitive: boolean;
  confidence: "high" | "medium" | "low";
  sourceRecordId: string;
  sourceModule: string;
  sourceType: string;
  sourceDocumentTitle: string;
  sourceFilePath?: string | null;
  ocrTextPath?: string | null;
  preview: string;
  score: number;
  // True when a sensitive answer may be shown automatically because a trusted
  // session is active and auto-reveal is enabled. Non-sensitive answers are
  // always true. The renderer must keep sensitive answers masked when false.
  autoRevealed: boolean;
}

interface SavedSearch {
  id: string;
  title: string;
  query: string;
  sourceModule: string;
  fileType: string;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
  updatedAt: string;
}

interface ExtractedCalendarCandidate {
  id: string;
  title: string;
  date: string;
  type: "birthday" | "meeting" | "appointment" | "call" | "reminder";
  allDay: boolean;
  sourceSentence: string;
  recurrence?: string | null;
}

interface JournalEntry {
  id: string;
  date: string;
  title?: string;
  rawText: string;
  cleanedText?: string;
  mood?: string;
  productivity?: string;
  tags: string[];
  peopleTags: string[];
  createdAt: string;
  updatedAt: string;
  extractedItems: ExtractedCalendarCandidate[];
}

interface JournalEntryInput {
  id?: string;
  date?: string;
  title?: string;
  rawText?: string;
  mood?: string;
  productivity?: string;
  tags?: string[] | string;
  peopleTags?: string[] | string;
}

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
  sourceModule: string;
  sourceId?: string | null;
  recurrence?: string | null;
  reminderLevel: "soft" | "normal" | "urgent";
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CalendarEventInput {
  id?: string;
  title?: string;
  date?: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  sourceModule?: string;
  sourceId?: string | null;
  recurrence?: string | null;
  reminderLevel?: "soft" | "normal" | "urgent";
  notes?: string | null;
}

type NudgePriority = "soft" | "normal" | "urgent";
type NudgeStatus = "active" | "dismissed" | "snoozed" | "completed";

interface Nudge {
  id: string;
  title: string;
  message: string;
  sourceModule: string;
  sourceId?: string | null;
  sourceProfileId?: string | null;
  sourceProfileName?: string | null;
  date: string;
  time?: string | null;
  priority: NudgePriority;
  status: NudgeStatus;
  snoozeUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NudgeSettings {
  enabled: boolean;
  vaultExpiryReminderDays: number[];
  returnReminderDays: number[];
  dailyJournalReminderEnabled: boolean;
  backupReminderAfterDays: number;
}

type FinderItemStatus = "at_home" | "lent_out" | "missing" | "archived";
type FinderItemConfidence = "sure" | "maybe" | "old";

interface FinderItem {
  id: string;
  itemName: string;
  location: string;
  room?: string;
  container?: string;
  notes?: string;
  tags: string[];
  status: FinderItemStatus;
  lentTo?: string | null;
  photoPath?: string | null;
  confidence?: FinderItemConfidence;
  createdAt: string;
  updatedAt: string;
}

interface FinderItemInput {
  id?: string;
  itemName?: string;
  location?: string;
  room?: string;
  container?: string;
  notes?: string;
  tags?: string[] | string;
  status?: FinderItemStatus;
  lentTo?: string | null;
  photoPath?: string | null;
  confidence?: FinderItemConfidence;
  query?: string;
  itemId?: string;
}

type FinancePaymentType = "cash" | "debit" | "credit" | "e_transfer" | "other";
type FinanceRecurringFrequency = "monthly" | "yearly" | "weekly" | "custom";

interface FinanceProfile {
  id: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
}

interface FinanceProfilesFile {
  profiles: FinanceProfile[];
  activeProfileId: string;
}

interface FinanceTransaction {
  id: string;
  profileId: string;
  date: string;
  store: string;
  amount: number;
  currency: string;
  category: string;
  paymentType: FinancePaymentType;
  cardName?: string | null;
  notes?: string;
  receiptFilePath?: string | null;
  receiptOriginalName?: string | null;
  returnDeadline?: string | null;
  warrantyUntil?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface FinanceTransactionInput {
  id?: string;
  transactionId?: string;
  profileId?: string;
  date?: string;
  store?: string;
  amount?: number | string;
  currency?: string;
  category?: string;
  paymentType?: FinancePaymentType;
  cardName?: string | null;
  notes?: string;
  receiptPath?: string | null;
  receiptFilePath?: string | null;
  returnDeadline?: string | null;
  warrantyUntil?: string | null;
  tags?: string[] | string;
}

interface FinanceRecurringExpense {
  id: string;
  profileId: string;
  name: string;
  amount: number;
  currency: string;
  frequency: FinanceRecurringFrequency;
  nextDueDate: string;
  category: string;
  paymentType: FinancePaymentType;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FinanceRecurringInput {
  id?: string;
  recurringId?: string;
  profileId?: string;
  name?: string;
  amount?: number | string;
  currency?: string;
  frequency?: FinanceRecurringFrequency;
  nextDueDate?: string;
  category?: string;
  paymentType?: FinancePaymentType;
  notes?: string;
  active?: boolean;
}

interface FinanceSettings {
  defaultCurrency: string;
  receiptsPath: string;
}

type CaptureItemType = "note" | "link" | "task" | "expense" | "file" | "image" | "audio_placeholder" | "document" | "other";
type CaptureItemStatus = "inbox" | "routed" | "archived" | "deleted";
type CaptureItemSource = "manual" | "clipboard" | "drop" | "tools" | "finance" | "journal" | "command";

interface CaptureItem {
  id: string;
  type: CaptureItemType;
  title: string;
  text: string;
  source: CaptureItemSource;
  filePath?: string | null;
  originalFileName?: string | null;
  url?: string | null;
  tags: string[];
  status: CaptureItemStatus;
  routedTo?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CaptureItemInput {
  id?: string;
  captureId?: string;
  type?: CaptureItemType;
  title?: string;
  text?: string;
  source?: CaptureItemSource;
  filePath?: string | null;
  url?: string | null;
  tags?: string[] | string;
  status?: CaptureItemStatus;
  routedTo?: string | null;
}

interface RoutineStep {
  id: string;
  actionId: string;
  params?: Record<string, unknown>;
}

interface DexNestRoutine {
  id: string;
  name: string;
  description: string;
  steps: RoutineStep[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunSummary?: string | null;
}

interface RoutineInput {
  id?: string;
  routineId?: string;
  name?: string;
  description?: string;
  steps?: Array<Partial<RoutineStep> & { actionId?: string; params?: Record<string, unknown> }>;
  enabled?: boolean;
}

interface HeatmapSettings {
  enabled: boolean;
  paused: boolean;
  sampleIntervalSeconds: number;
  aggregationIntervalHours: number;
  pauseDuringFullscreen: boolean;
  privateApps: string[];
  privateTitleKeywords: string[];
  lastAggregatedAt?: string | null;
}

interface HeatmapEvent {
  id: string;
  timestamp: string;
  appName: string;
  windowTitle: string;
  projectId?: string | null;
  active: boolean;
  idleSeconds?: number | null;
  durationSeconds: number;
  createdAt: string;
}

interface HeatmapGoal {
  id: string;
  name: string;
  targetHoursPerWeek: number;
  keyword: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface HeatmapGoalInput {
  id?: string;
  goalId?: string;
  name?: string;
  targetHoursPerWeek?: number | string;
  keyword?: string;
  active?: boolean;
}

interface ActiveWindowSnapshot {
  appName: string;
  windowTitle: string;
  idleSeconds: number | null;
  active: boolean;
  isFullscreen: boolean;
  detectionStatus: "ok" | "unavailable" | "failed";
  error?: string;
}

interface BackupOptions {
  includeSettings: boolean;
  includeFiles: boolean;
  includeVaultDocuments: boolean;
  includeSecureVault: boolean;
  includeReceipts: boolean;
  includeDropFiles: boolean;
  includeIndex: boolean;
}

interface BackupFileSummary {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

interface BackupPreview {
  ok: boolean;
  path: string;
  sizeBytes: number;
  entries: string[];
  topLevel: string[];
  error?: string;
}

type HealthStatus = "pass" | "warn" | "fail";

interface HealthCheckResult {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  suggestion?: string;
}

interface HealthGroup {
  id: string;
  title: string;
  checks: HealthCheckResult[];
}

interface AppHealthState {
  overallStatus: HealthStatus;
  checkedAt: string;
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  groups: HealthGroup[];
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

function ensureToolsRoot(): void {
  mkdirSync(toolsFilesRoot, { recursive: true });
  mkdirSync(toolsInputRoot, { recursive: true });
  mkdirSync(toolsOutputRoot, { recursive: true });
  mkdirSync(toolsTempRoot, { recursive: true });
}

function ensureVaultRoot(): void {
  mkdirSync(vaultFilesRoot, { recursive: true });
  mkdirSync(vaultDocumentsRoot, { recursive: true });
  mkdirSync(vaultImportsRoot, { recursive: true });
  mkdirSync(vaultVersionsRoot, { recursive: true });
  mkdirSync(vaultTempRoot, { recursive: true });
  mkdirSync(vaultSecureRoot, { recursive: true });
  mkdirSync(vaultOcrRoot, { recursive: true });
}

function ensureFinanceRoot(): void {
  mkdirSync(receiptsRoot, { recursive: true });
}

function ensureCaptureRoot(): void {
  mkdirSync(capturesRoot, { recursive: true });
}

function ensureSearchRoot(): void {
  mkdirSync(searchIndexRoot, { recursive: true });
}

function ensureSpeechRoot(): void {
  mkdirSync(speechModelsRoot, { recursive: true });
  mkdirSync(speechTempRoot, { recursive: true });
  mkdirSync(speechDebugAudioRoot, { recursive: true });
}

function ensureBackupRoot(): void {
  mkdirSync(backupsRoot, { recursive: true });
  mkdirSync(restoreStagingRoot, { recursive: true });
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

function endpointPreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function looksSensitiveClipboardText(value: string): boolean {
  const text = value.toLowerCase();
  return [
    /\b\d{3}[- ]?\d{3}[- ]?\d{3}\b/, // SIN-like values
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // card-like values
    /\b(password|passwd|passcode|token|api[_ -]?key|secret|recovery code|sin|passport|permit number|health card|uci)\b/,
    /\b(bearer|sk-|ghp_|github_pat_|xoxb-|xoxp-)[a-z0-9_\-]{8,}\b/i
  ].some((pattern) => pattern.test(text));
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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

  if (!isPathInside(resolvedRoot, resolvedPath)) {
    throw new Error("Invalid Drop file path.");
  }

  return resolvedPath;
}

function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const normalizedRoot = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const normalizedCandidate = process.platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${process.platform === "win32" ? "\\" : "/"}`);
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

  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    // A truncated/corrupt file (e.g. power loss during a non-atomic write) must not
    // crash the app forever. Preserve the bad file for recovery and fall back to defaults.
    try {
      const backupPath = `${path}.corrupt-${Date.now()}`;
      renameSync(path, backupPath);
      console.error(`DexNest: could not parse ${path}; backed up to ${backupPath} and reset to defaults.`, error);
    } catch (backupError) {
      console.error(`DexNest: could not parse or back up ${path}; resetting to defaults.`, backupError);
    }
    writeFileSync(path, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    return fallback;
  }
}

function writeJsonFile<T>(path: string, value: T): T {
  ensureSettingsRoot();
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return value;
}

function defaultBackupOptions(): BackupOptions {
  return {
    includeSettings: true,
    includeFiles: true,
    includeVaultDocuments: true,
    includeSecureVault: true,
    includeReceipts: true,
    includeDropFiles: true,
    includeIndex: false
  };
}

function localBackupTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}_${value("hour")}-${value("minute")}`;
}

function listBackups(): BackupFileSummary[] {
  ensureBackupRoot();
  return readdirSync(backupsRoot)
    .filter((fileName) => fileName.toLowerCase().endsWith(".zip"))
    .map((fileName) => {
      const path = join(backupsRoot, fileName);
      const stats = statSync(path);
      return {
        fileName,
        path,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString()
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function backupState() {
  ensureBackupRoot();
  return {
    backupFolderPath: backupsRoot,
    restoreStagingPath: restoreStagingRoot,
    defaultOptions: defaultBackupOptions(),
    backups: listBackups()
  };
}

function currentGitBranch(): string {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function trackedGitFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitignoreHasLocalData(): boolean {
  try {
    const value = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    return value.split(/\r?\n/).some((line) => line.trim() === "local-data/" || line.trim() === "local-data");
  } catch {
    return false;
  }
}

function check(id: string, label: string, status: HealthStatus, detail: string, suggestion?: string): HealthCheckResult {
  return { id, label, status, detail, suggestion };
}

function appHealthState(source: DexNestActionTrigger = "module_ui", writeAudit = false): AppHealthState {
  const startedAt = Date.now();
  const actions = [...actionRegistry.list(), ...getProjectActionDefinitions()];
  const actionIds = actions.map((action) => action.id);
  const duplicateActionIds = [...new Set(actionIds.filter((id, index) => actionIds.indexOf(id) !== index))];
  const missingDangerLevel = actions.filter((action) => !action.dangerLevel);
  const unsafeWithoutConfirmation = actions.filter((action) =>
    (action.dangerLevel === "danger" || action.dangerLevel === "critical") && !action.requiresConfirmation
  );
  const disabledActionCount = actions.filter((action) => !action.enabled).length;
  const trackedFiles = trackedGitFiles();
  const trackedLocalData = trackedFiles.filter((file) => file === "local-data" || file.startsWith("local-data/"));
  const trackedEnv = trackedFiles.filter((file) => file === ".env" || file.startsWith(".env.") || file.endsWith("/.env"));
  const trackedBuildOutputs = trackedFiles.filter((file) => /(^|\/)(dist|out|build|release)\//.test(file));
  const branch = currentGitBranch();
  const recentEvents = localDb.listRecentEvents(500);
  const today = getLocalTodayDateString();
  const failedToday = recentEvents.filter((event) => event.status === "failed" && event.timestamp.slice(0, 10) === today);
  const secureState = vaultState().secure;
  const tools = toolsState();
  const search = searchState();
  const heatmap = heatmapState();
  const clipboardSettings = loadClipboardSettings();
  const commandSettings = loadCommandSettings();
  const keyboardSettings = loadKeyboardShortcutSettings();
  const streamDeckSettings = loadStreamDeckSettings();
  const lifecycle = appLifecycleState();
  const latestBackup = listBackups()[0] ?? null;
  const performance = performanceModeState();
  const performanceSettings = loadPerformanceModeSettings();
  const searchIndexStatus = loadSearchIndexStatus();
  const externalDevices = externalDevicesState();
  const ambient = ambientVoiceState();
  const speech = speechServiceState();
  const ocrQueuedCount = loadVaultOcrJobs().filter((job) => job.status === "queued").length;
  const localDataExists = existsSync(localDataRoot);
  const sqliteUnderLocalData = isPathInside(localDataRoot, localDb.dbPath);
  const vaultUnderLocalData = isPathInside(localDataRoot, vaultDocumentsRoot);

  const groups: HealthGroup[] = [
    {
      id: "data-safety",
      title: "Data Safety",
      checks: [
        check("local-data-exists", "local-data folder exists", localDataExists ? "pass" : "fail", localDataExists ? localDataRoot : "Missing local-data folder.", "Run DexNest once to create local-data."),
        check("local-data-gitignored", "local-data is gitignored", gitignoreHasLocalData() ? "pass" : "fail", gitignoreHasLocalData() ? ".gitignore protects local-data/." : ".gitignore does not include local-data/.", "Add local-data/ to .gitignore."),
        check("sqlite-under-local-data", "SQLite path is under local-data", sqliteUnderLocalData ? "pass" : "fail", localDb.dbPath, "Move database storage under ./local-data."),
        check("vault-under-local-data", "Vault files path is under local-data", vaultUnderLocalData ? "pass" : "fail", vaultDocumentsRoot, "Keep Vault documents under ./local-data/files/vault."),
        check("drop-folders-exist", "Drop incoming/outgoing folders exist", existsSync(dropIncomingRoot) && existsSync(dropOutgoingRoot) ? "pass" : "fail", `${dropIncomingRoot} / ${dropOutgoingRoot}`, "Open Drop or restart DexNest to recreate Drop folders."),
        check("tools-output-exists", "Tools output folder exists", existsSync(getToolsOutputFolder()) ? "pass" : "fail", getToolsOutputFolder(), "Open Tools or reset output folder."),
        check("backup-folder-exists", "Backup folder exists", existsSync(backupsRoot) ? "pass" : "fail", backupsRoot, "Open Settings Backup or create a backup."),
        (() => {
          const lastDeletion = loadDataManagementStatus();
          if (!lastDeletion.lastDeletionAt) {
            return check("data-management-last-deletion", "Data Management last deletion", "pass", "No Data Management deletion has been run.");
          }
          const detail = `${formatLocalDateTime(lastDeletion.lastDeletionAt)} — ${lastDeletion.status ?? "unknown"} — cleared: ${lastDeletion.categoriesCleared.join(", ") || "none"} — backup: ${lastDeletion.backupCreated ? lastDeletion.backupFileName ?? "yes" : "none"}`;
          return check("data-management-last-deletion", "Data Management last deletion", lastDeletion.status === "failed" ? "fail" : lastDeletion.status === "partial" ? "warn" : "pass", detail);
        })()
      ]
    },
    {
      id: "git-safety",
      title: "Git Safety",
      checks: [
        check("current-branch", "Current branch", branch === "main" ? "warn" : "pass", branch, branch === "main" ? "Use dev for active DexNest work." : undefined),
        check("local-data-tracked", "local-data is not tracked", trackedLocalData.length === 0 ? "pass" : "fail", trackedLocalData.length === 0 ? "No tracked local-data files." : `${trackedLocalData.length} local-data file(s) tracked.`, "Remove local-data from Git tracking."),
        check("env-tracked", ".env files are not tracked", trackedEnv.length === 0 ? "pass" : "warn", trackedEnv.length === 0 ? "No tracked .env files." : `${trackedEnv.length} env file(s) tracked.`, "Remove env files from Git tracking."),
        check("build-output-tracked", "Build outputs are not tracked", trackedBuildOutputs.length === 0 ? "pass" : "warn", trackedBuildOutputs.length === 0 ? "No tracked build output folders." : `${trackedBuildOutputs.length} build output file(s) tracked.`, "Keep dist/out/build/release ignored.")
      ]
    },
    {
      id: "action-registry",
      title: "Action Registry",
      checks: [
        check("action-count", "Total action count", "pass", `${actions.length} registered actions.`),
        check("duplicate-actions", "No duplicate action IDs", duplicateActionIds.length === 0 ? "pass" : "fail", duplicateActionIds.length === 0 ? "No duplicates found." : duplicateActionIds.join(", "), "Action IDs must be stable and unique."),
        check("danger-levels", "All actions define danger level", missingDangerLevel.length === 0 ? "pass" : "fail", missingDangerLevel.length === 0 ? "All actions have dangerLevel." : `${missingDangerLevel.length} missing dangerLevel.`, "Set safe/caution/danger/critical."),
        check("danger-confirmation", "Danger actions require confirmation", unsafeWithoutConfirmation.length === 0 ? "pass" : "fail", unsafeWithoutConfirmation.length === 0 ? "Danger/critical actions require confirmation." : `${unsafeWithoutConfirmation.length} unsafe action(s) lack confirmation.`, "Set requiresConfirmation for danger/critical actions."),
        check("disabled-actions", "Disabled actions count", disabledActionCount === 0 ? "pass" : "warn", `${disabledActionCount} disabled action(s).`)
      ]
    },
    {
      id: "event-log",
      title: "Event Log",
      checks: [
        check("recent-events", "Recent event count", "pass", `${recentEvents.length} recent event(s) loaded.`),
        check("failed-today", "Failed events today", failedToday.length === 0 ? "pass" : "warn", `${failedToday.length} failed event(s) today.`, failedToday.length ? "Review Audit for failed actions." : undefined),
        check("audit-private-content", "Audit private-content safety", "pass", "Audit should store summaries and metadata only, not full secrets, clipboard text, or document contents."),
        check("event-log-path", "Event log database path", existsSync(localDb.dbPath) ? "pass" : "warn", localDb.dbPath, "Database is created after DexNest initializes.")
      ]
    },
    {
      id: "security",
      title: "Security",
      checks: [
        check("secure-vault-setup", "Secure Vault setup", secureState.isSetup ? "pass" : "warn", secureState.isSetup ? "Secure Vault is set up." : "Secure Vault is not set up yet."),
        check("secure-vault-lock", "Secure Vault lock state", secureState.isSetup && !secureState.isUnlocked ? "pass" : secureState.isSetup ? "warn" : "warn", secureState.isSetup ? `${secureState.isUnlocked ? "Unlocked" : "Locked"} · lock mode: ${secureState.lockMode === "timer" ? `timer (${secureState.autoLockMinutes} min)` : "stays unlocked until app exit"}.` : "Not configured.", secureState.isUnlocked && secureState.lockMode === "timer" ? "Timer mode auto-locks after inactivity." : undefined),
        check("secure-vault-file", "Secure Vault encrypted file", !secureState.isSetup || existsSync(secureVaultPath) ? "pass" : "fail", secureVaultPath, "Secure Vault setup should create this encrypted file."),
        check("clipboard-secret-protection", "Clipboard secret protection", "warn", "Secret exclusion from Clipboard history is currently policy/placeholder based.", "Do not save secrets into normal Clipboard history."),
        check("clipboard-multicopy-hotkey", "Clipboard multi-copy hotkey", !clipboardSettings.multiCopyHotkeyEnabled ? "warn" : clipboardSettings.multiCopyHotkeyStatus === "active" ? "pass" : "warn", `${clipboardSettings.multiCopyHotkey} / ${clipboardSettings.multiCopyHotkeyStatus}${clipboardSettings.multiCopyHotkeyLastError ? ` / ${clipboardSettings.multiCopyHotkeyLastError}` : ""}`, clipboardSettings.multiCopyHotkeyStatus === "failed" ? "Switch Clipboard fallback hotkey to Ctrl+Alt+C or Ctrl+Shift+X." : undefined),
        check("drop-pin-placeholder", "Drop PIN", "warn", "Drop PIN is a placeholder and is not enforced yet.", "Use Drop only on trusted local Wi-Fi.")
      ]
    },
    {
      id: "performance",
      title: "Performance",
      checks: [
        check("performance-mode", "Performance mode", performance.enabled ? "warn" : "pass", performance.enabled ? `Active: ${performance.reason}.` : "Inactive."),
        check("paused-workers", "Paused workers", performance.pausedWorkers.length ? "warn" : "pass", performance.pausedWorkers.length ? performance.pausedWorkers.join(", ") : "No workers paused by Performance Mode."),
        check("command-shortcut", "Command global shortcut", !commandSettings.globalShortcutEnabled ? "warn" : commandSettings.globalShortcutStatus === "active" ? "pass" : "warn", `${commandSettings.globalShortcut} / ${commandSettings.globalShortcutStatus}${commandSettings.globalShortcutLastError ? ` / ${commandSettings.globalShortcutLastError}` : ""}`, commandSettings.globalShortcutStatus === "failed" ? "Switch DexNest Command shortcut to Ctrl+Alt+Space or Ctrl+Shift+Space." : undefined),
        check("keyboard-shortcuts", "Keyboard shortcuts", !keyboardSettings.enabled ? "warn" : keyboardSettings.mappings.some((mapping) => mapping.status === "active") ? "pass" : "warn", `${keyboardSettings.mappings.filter((mapping) => mapping.status === "active").length} active shortcut(s).`, shortcutConflictDetails(keyboardSettings).join(" ") || undefined),
        check("tray-status", "Tray status", tray && commandSettings.trayStatus === "active" ? "pass" : "warn", tray && commandSettings.trayStatus === "active" ? "DexNest tray is active." : "DexNest tray is not active.", "Restart DexNest if the tray icon is missing."),
        check("ambient-voice", "Ambient Voice", ambient.settings.ambientVoiceEnabled ? "warn" : "pass", `${ambient.currentState}; push-to-talk ${ambient.settings.pushToTalkShortcutStatus}; wake word ${ambient.wakeWordStatus}.`, ambient.pausedByPerformanceMode ? "Ambient Voice is paused by Performance Mode." : "Ambient Voice is off by default; wake word is placeholder-only."),
        check("speech-service", "Speech service", speech.performancePaused ? "warn" : "pass", `${speech.settings.speechEngine} / ${speech.settings.modelName} / ${speech.modelStatus.message}`, speech.performancePaused ? "Speech capture is paused by Performance Mode." : "Run Check local model in Settings when changing speech engine."),
        check("heatmap-state", "Heatmap status", performanceModePauses("heatmap") ? "warn" : heatmap.settings.enabled && !heatmap.settings.paused ? "warn" : "pass", heatmap.trackingStatus, performanceModePauses("heatmap") ? "Heatmap sampling is paused until Performance Mode turns off." : heatmap.settings.enabled && !heatmap.settings.paused ? "Heatmap samples only at configured interval." : undefined),
        check("ocr-queue-paused", "OCR queue", performanceModePauses("ocr") && ocrQueuedCount > 0 ? "warn" : "pass", performanceModePauses("ocr") ? `${ocrQueuedCount} queued OCR job(s); queue paused by Performance Mode.` : `${ocrQueuedCount} queued OCR job(s).`),
        check("search-index-stale", "Search index stale", searchIndexStatus.staleDueToPerformanceMode ? "warn" : "pass", searchIndexStatus.staleDueToPerformanceMode ? `Stale since ${searchIndexStatus.staleSince ?? "unknown"}: ${searchIndexStatus.staleReason ?? "performance mode"}` : "Search index is not marked stale by Performance Mode.", "Run manual Search rebuild when Performance Mode is off."),
        check("backups-skipped", "Scheduled backups", performance.enabled && performanceSettings.pauseBackups ? "warn" : "pass", performance.enabled && performanceSettings.pauseBackups ? "Scheduled backups are paused. Manual backup remains available." : "Scheduled backups not paused."),
        check("polling-sources", "Active polling sources", "pass", "No global polling. Drop auto-refresh runs only while Drop page is open."),
        check("heavy-workers", "No OCR/Search/AI workers", "pass", "No background OCR, Search indexing, AI, embeddings, or local LLM workers are running.")
      ]
    },
    {
      id: "lifecycle",
      title: "Tray and Startup",
      checks: [
        check("tray-available", "Tray available", lifecycle.trayAvailable ? "pass" : "warn", lifecycle.trayAvailable ? "DexNest tray is available." : "Tray icon is not active.", "Restart DexNest if the tray icon is missing."),
        check("close-behavior", "Close button behavior", lifecycle.closeBehavior === "exit" ? "warn" : "pass", lifecycle.closeBehavior.replaceAll("_", " "), lifecycle.closeBehavior === "exit" ? "DexNest will exit when X is clicked." : undefined),
        check("auto-start", "Windows auto-start", lifecycle.startDexNestWithWindows ? lifecycle.loginItemStatus === "enabled" ? "pass" : "warn" : "pass", `${lifecycle.startDexNestWithWindows ? "enabled" : "disabled"} / ${lifecycle.loginItemStatus}${lifecycle.loginItemLastError ? ` / ${lifecycle.loginItemLastError}` : ""}`, lifecycle.loginItemStatus === "failed" ? "Toggle auto-start off and on again from Settings." : undefined),
        check("start-minimized", "Start minimized to tray", lifecycle.startMinimizedToTray ? "pass" : "warn", lifecycle.startMinimizedToTray ? "Auto-start opens DexNest in the tray." : "Auto-start opens the window normally."),
        check("tray-mode-active", "Current window mode", lifecycle.trayModeActive ? "warn" : "pass", lifecycle.trayModeActive ? "DexNest is currently hidden in tray mode." : "DexNest window mode is normal.")
      ]
    },
    {
      id: "integrations",
      title: "Integrations",
      checks: [
        check("drop-server", "Drop server status", actionServer ? "pass" : "fail", actionServer ? "Local action/Drop server is running." : "Local server is not running."),
        check("stream-deck-security", "Stream Deck endpoint security", streamDeckSettings.lanEnabled ? "warn" : "pass", streamDeckSettings.lanEnabled ? "LAN control exposure is enabled." : `Localhost-only. PIN/token ${streamDeckSettings.tokenEnabled ? "enabled" : "disabled"}.`, streamDeckSettings.lanEnabled ? "Keep LAN exposure off unless you trust the network." : undefined),
        check("drop-lan-url", "Drop LAN URL", getLanIp() ? "pass" : "warn", dropPhoneUrl(), "LAN IP may be unavailable when offline or blocked by adapter settings."),
        check("ffmpeg", "ffmpeg", tools.detectedFfmpegPath || tools.ffmpegPath ? "pass" : "warn", tools.ffmpegPath || tools.detectedFfmpegPath || "Missing.", "Install ffmpeg or set the path in Tools settings for media conversions."),
        check("libreoffice", "LibreOffice", tools.detectedLibreOfficePath || tools.libreOfficePath ? "pass" : "warn", tools.libreOfficePath || tools.detectedLibreOfficePath || "Missing.", "Install LibreOffice or set soffice.exe path for Office conversions."),
        check("tesseract", "Tesseract OCR", tools.detectedTesseractPath || tools.tesseractPath ? "pass" : "warn", tools.tesseractPath || tools.detectedTesseractPath || "Missing.", "Install Tesseract OCR or set tesseract.exe path in Tools settings for OCR."),
        check("python-paddleocr", "Python/PaddleOCR", tools.detectedPythonPath || tools.pythonPath ? "pass" : "warn", tools.pythonPath || tools.detectedPythonPath || "Python missing.", "Use Python 3.12 for PaddleOCR, then run: py -3.12 -m pip install paddleocr paddlepaddle, or switch OCR engine to Tesseract."),
        check("speech-model-root", "Speech model root", existsSync(speechModelsRoot) ? "pass" : "warn", speechModelsRoot, "Open Settings > Speech / Voice Engine to create/check the model folder."),
        check("external-devices-settings", "External Devices settings", existsSync(externalDevicesSettingsPath) || !externalDevices.settings.goveeEnabled ? "pass" : "warn", externalDevices.settingsPath, "Save External Devices settings from Settings."),
        check("govee-provider", "Govee provider", externalDevices.providerStatus === "ready" || externalDevices.providerStatus === "disabled" ? "pass" : "warn", externalDevices.providerMessage, "Unlock Secure Vault and save a Govee API key to enable device control."),
        check("govee-cache", "Govee device cache", externalDevices.devices.length > 0 ? "pass" : "warn", `${externalDevices.devices.length} cached Govee device(s).`, "Refresh devices after saving a Govee API key."),
        check("search-index", "Search index", search.index.length > 0 ? "pass" : "warn", `${search.index.length} indexed record(s).`, "Run Search rebuild when you want local metadata search."),
        check("latest-backup", "Latest backup", latestBackup ? "pass" : "warn", latestBackup ? `${latestBackup.fileName} / ${formatLocalDateTime(latestBackup.createdAt)}` : "No backup found.", "Create a local backup from Settings.")
      ]
    }
  ];

  const flatChecks = groups.flatMap((group) => group.checks);
  const summary = {
    pass: flatChecks.filter((item) => item.status === "pass").length,
    warn: flatChecks.filter((item) => item.status === "warn").length,
    fail: flatChecks.filter((item) => item.status === "fail").length
  };
  const overallStatus: HealthStatus = summary.fail > 0 ? "fail" : summary.warn > 0 ? "warn" : "pass";
  const state: AppHealthState = {
    overallStatus,
    checkedAt: new Date().toISOString(),
    summary,
    groups
  };

  if (writeAudit) {
    localDb.appendActionEvent({
      module: "system",
      actionId: "system.health.run_checks",
      eventType: "system_health_checked",
      status: "success",
      source,
      summary: `DexNest App Health checked: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail.`,
      metadataJson: { overallStatus, ...summary },
      durationMs: Date.now() - startedAt
    });
  }

  lastAppHealthState = state;
  return state;
}

// App Health checks are ON-DEMAND only (README rule). We cache the last run so
// opening the App Health view shows the previous result instantly without
// re-running the (heavy, git-spawning) checks or writing an Audit event.
let lastAppHealthState: AppHealthState | null = null;

function cachedAppHealthState(): AppHealthState {
  return lastAppHealthState ?? {
    overallStatus: "warn",
    checkedAt: "",
    summary: { pass: 0, warn: 0, fail: 0 },
    groups: []
  };
}

function addPathToZip(zip: AdmZip, sourcePath: string, archivePath: string, excludePath?: (path: string) => boolean): void {
  if (!existsSync(sourcePath) || excludePath?.(sourcePath)) {
    return;
  }

  const stats = statSync(sourcePath);
  const normalizedArchivePath = archivePath.replace(/\\/g, "/");
  if (stats.isDirectory()) {
    zip.addFile(`${normalizedArchivePath}/`, Buffer.alloc(0));
    for (const child of readdirSync(sourcePath)) {
      addPathToZip(zip, join(sourcePath, child), `${normalizedArchivePath}/${child}`, excludePath);
    }
    return;
  }

  zip.addFile(normalizedArchivePath, readFileSync(sourcePath));
}

function createBackup(optionsInput: Partial<BackupOptions> = {}, source: DexNestActionTrigger = "module_ui") {
  ensureBackupRoot();
  const startedAt = Date.now();
  const options = { ...defaultBackupOptions(), ...optionsInput };
  const fileName = `DexNest_Backup_${localBackupTimestamp()}.zip`;
  const outputPath = join(backupsRoot, fileName);

  try {
    const zip = new AdmZip();
    zip.addFile(
      "backup-manifest.json",
      Buffer.from(
        `${JSON.stringify(
          {
            app: "DexNest",
            version: app.getVersion(),
            createdAt: new Date().toISOString(),
            options,
            dataRoot: localDataRoot
          },
          null,
          2
        )}\n`,
        "utf8"
      )
    );

    if (options.includeSettings) {
      addPathToZip(zip, settingsRoot, "settings");
    }

    const dataRoot = join(localDataRoot, "data");
    if (existsSync(dataRoot)) {
      addPathToZip(zip, dataRoot, "data");
    }

    const filesRoot = join(localDataRoot, "files");
    const excludeSelectedFilePaths = (candidate: string): boolean => {
      const resolvedCandidate = resolve(candidate);
      if (!options.includeVaultDocuments && isPathInside(vaultDocumentsRoot, resolvedCandidate)) {
        return true;
      }
      if (!options.includeSecureVault && isPathInside(vaultSecureRoot, resolvedCandidate)) {
        return true;
      }
      if (!options.includeReceipts && isPathInside(receiptsRoot, resolvedCandidate)) {
        return true;
      }
      if (!options.includeDropFiles && isPathInside(dropFilesRoot, resolvedCandidate)) {
        return true;
      }
      return false;
    };

    if (options.includeFiles) {
      addPathToZip(zip, filesRoot, "files", excludeSelectedFilePaths);
    } else {
      if (options.includeVaultDocuments) {
        addPathToZip(zip, vaultDocumentsRoot, "files/vault/documents");
      }
      if (options.includeSecureVault) {
        addPathToZip(zip, vaultSecureRoot, "files/vault/secure");
      }
      if (options.includeReceipts) {
        addPathToZip(zip, receiptsRoot, "files/receipts");
      }
      if (options.includeDropFiles) {
        addPathToZip(zip, dropFilesRoot, "files/drop");
      }
    }

    if (options.includeIndex) {
      addPathToZip(zip, searchIndexRoot, "index");
    }

    zip.writeZip(outputPath);
    const sizeBytes = statSync(outputPath).size;
    localDb.appendActionEvent({
      module: "backup",
      actionId: "backup.create",
      eventType: "backup_created",
      status: "success",
      source,
      summary: "Created local DexNest backup.",
      metadataJson: { fileName, sizeBytes, includeIndex: options.includeIndex },
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId: "backup.create", path: outputPath, fileName, sizeBytes, backupState: backupState() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest backup failed.";
    localDb.appendActionEvent({
      module: "backup",
      actionId: "backup.create",
      eventType: "backup_failed",
      status: "failed",
      source,
      summary: message,
      metadataJson: {},
      errorMessage: message,
      durationMs: Date.now() - startedAt
    });
    return { ok: false, actionId: "backup.create", error: message, backupState: backupState() };
  }
}

// ---------------------------------------------------------------------------
// Settings → Data Management
//
// A safe, explicit way to permanently delete selected DexNest-managed data with
// an optional backup-first. The engine only ever touches DexNest-managed record
// JSON files and managed file roots under ./local-data (every delete is guarded
// by isPathInside(localDataRoot, …)). It NEVER deletes app code, schemas, the
// SQLite database structure, sidecars, node_modules, package files, or arbitrary
// external files. Deleting a record JSON file lets readJsonFile recreate empty
// defaults on next load, and managed directories are recreated empty, so the app
// stays usable immediately after deletion. Previews and audit events expose
// counts and managed folder paths only — never private content.
// ---------------------------------------------------------------------------

interface DataManagementCategory {
  id: string;
  label: string;
  description: string;
  // Sensitive categories (Secure Vault, backups, integration credentials, and any
  // category that deletes actual managed files) require extra explicit selection
  // in the UI — they are never part of a single "select all" click without intent.
  sensitive: boolean;
  recordFiles: string[];
  fileRoots: string[];
  special?: "audit" | "appHealth" | "secureVault" | "credentials";
}

function dataManagementCatalog(): DataManagementCategory[] {
  return [
    { id: "clipboard", label: "Clipboard", description: "Clipboard history, snippets, multi-copy groups, and quick slots. Keeps Clipboard settings.", sensitive: false, recordFiles: [clipboardHistoryPath, clipboardSnippetsPath, clipboardMultiGroupsPath, clipboardActiveMultiCopyPath, clipboardSlotsPath], fileRoots: [] },
    { id: "drop", label: "Drop", description: "Drop shelf items, received items, and managed Drop files (incoming/outgoing/temp). Keeps Drop settings.", sensitive: true, recordFiles: [dropShelfPath, dropIncomingPath], fileRoots: [dropIncomingRoot, dropOutgoingRoot, dropTempRoot] },
    { id: "tools", label: "Tools jobs/outputs", description: "Tools job records and managed input/output/temp files. Keeps Tools settings.", sensitive: true, recordFiles: [toolsOutputsPath], fileRoots: [toolsInputRoot, toolsOutputRoot, toolsTempRoot] },
    { id: "vault", label: "Vault documents/OCR jobs", description: "Vault document records, OCR job records, and managed Vault files. Does NOT touch Secure Vault. Keeps OCR settings.", sensitive: true, recordFiles: [vaultDocumentsPath, vaultOcrJobsPath], fileRoots: [vaultDocumentsRoot, vaultImportsRoot, vaultVersionsRoot, vaultOcrRoot, vaultTempRoot] },
    { id: "journal", label: "Journal", description: "All journal entries.", sensitive: false, recordFiles: [journalEntriesPath], fileRoots: [] },
    { id: "calendar", label: "Calendar", description: "Calendar events and reminders/nudges. Keeps reminder settings.", sensitive: false, recordFiles: [calendarEventsPath, nudgesPath], fileRoots: [] },
    { id: "capture", label: "Capture", description: "Capture items and managed capture files.", sensitive: true, recordFiles: [captureItemsPath], fileRoots: [capturesRoot] },
    { id: "finance", label: "Finance", description: "Transactions, recurring items, profiles, and managed receipt files. Keeps Finance settings.", sensitive: true, recordFiles: [financeTransactionsPath, financeRecurringPath, financeProfilesPath], fileRoots: [receiptsRoot] },
    { id: "finder", label: "Finder", description: "Saved Finder items.", sensitive: false, recordFiles: [finderItemsPath], fileRoots: [] },
    { id: "dev", label: "Dev projects/history/profiles", description: "Dev projects, command run history, and pinned actions.", sensitive: false, recordFiles: [projectsConfigPath, commandResultsPath, pinnedActionsPath], fileRoots: [] },
    { id: "deck", label: "Deck routines/export status", description: "Deck routines and export status records.", sensitive: false, recordFiles: [routinesPath], fileRoots: [] },
    { id: "heatmap", label: "Heatmap", description: "Heatmap activity events and goals. Keeps Heatmap settings.", sensitive: false, recordFiles: [heatmapEventsPath, heatmapGoalsPath], fileRoots: [] },
    { id: "search", label: "Search index", description: "Local search index, index status, and saved searches.", sensitive: false, recordFiles: [savedSearchesPath, searchIndexStatusPath], fileRoots: [searchIndexRoot] },
    { id: "external", label: "External Devices cached devices/groups", description: "Cached external devices and device groups. Keeps External Devices settings and credentials.", sensitive: false, recordFiles: [externalDevicesCachePath, externalDevicesGroupsPath], fileRoots: [] },
    { id: "appHealth", label: "App Health cached checks", description: "Last cached App Health check result (in-memory only).", sensitive: false, recordFiles: [], fileRoots: [], special: "appHealth" },
    { id: "audit", label: "Audit history", description: "All metadata-only audit events. A final deletion summary is written after clearing.", sensitive: false, recordFiles: [], fileRoots: [], special: "audit" },
    { id: "backups", label: "Backup records/files", description: "All local backup archives and restore staging.", sensitive: true, recordFiles: [], fileRoots: [backupsRoot] },
    { id: "secureVault", label: "Secure Vault", description: "Encrypted Secure Vault store and managed secure files. Locks the vault.", sensitive: true, recordFiles: [], fileRoots: [vaultSecureRoot], special: "secureVault" },
    { id: "credentials", label: "Integration credentials/Govee key", description: "Integration keychain and Govee API key, including the saved Govee credential reference.", sensitive: true, recordFiles: [goveeLocalApiKeyPath, integrationKeychainPath], fileRoots: [], special: "credentials" }
  ];
}

function countRecordEntries(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed as Record<string, unknown>).length;
    }
    return parsed ? 1 : 0;
  } catch {
    return 0;
  }
}

function countDirFiles(root: string): number {
  if (!existsSync(root)) {
    return 0;
  }
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const childPath = join(root, entry.name);
    if (entry.isDirectory()) {
      count += countDirFiles(childPath);
    } else {
      count += 1;
    }
  }
  return count;
}

// Deletes everything inside a managed directory but keeps the (recreated) root so
// the owning module stays usable. Guarded so it can only ever empty a path under
// ./local-data. Returns the number of files removed.
function emptyManagedDir(root: string): number {
  if (!isPathInside(localDataRoot, root)) {
    return 0;
  }
  const removed = countDirFiles(root);
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      rmSync(join(root, entry), { recursive: true, force: true });
    }
  }
  mkdirSync(root, { recursive: true });
  return removed;
}

function deleteManagedRecordFile(path: string): boolean {
  if (!isPathInside(localDataRoot, path) || !existsSync(path)) {
    return false;
  }
  unlinkSync(path);
  return true;
}

interface DataManagementStatus {
  lastDeletionAt: string | null;
  status: "success" | "partial" | "failed" | null;
  categoriesCleared: string[];
  backupCreated: boolean;
  backupFileName: string | null;
}

function loadDataManagementStatus(): DataManagementStatus {
  return readJsonFile<DataManagementStatus>(dataManagementStatusPath, {
    lastDeletionAt: null,
    status: null,
    categoriesCleared: [],
    backupCreated: false,
    backupFileName: null
  });
}

function dataManagementState() {
  return {
    categories: dataManagementCatalog().map((category) => {
      const records = category.special === "audit" ? localDb.countEvents() : category.recordFiles.reduce((sum, file) => sum + countRecordEntries(file), 0);
      const files = category.fileRoots.reduce((sum, root) => sum + countDirFiles(root), 0);
      return {
        id: category.id,
        label: category.label,
        description: category.description,
        sensitive: category.sensitive,
        records,
        files,
        folders: category.fileRoots
      };
    }),
    lastDeletion: loadDataManagementStatus()
  };
}

function previewDataDeletion(categoryIds: string[]) {
  const catalog = dataManagementCatalog();
  const selected = catalog.filter((category) => categoryIds.includes(category.id));
  const items = selected.map((category) => {
    const records = category.special === "audit" ? localDb.countEvents() : category.recordFiles.reduce((sum, file) => sum + countRecordEntries(file), 0);
    const files = category.fileRoots.reduce((sum, root) => sum + countDirFiles(root), 0);
    return {
      id: category.id,
      label: category.label,
      sensitive: category.sensitive,
      records,
      files,
      // Managed folders only — never private content or file names.
      folders: category.fileRoots.filter((root) => existsSync(root))
    };
  });
  return {
    items,
    totalRecords: items.reduce((sum, item) => sum + item.records, 0),
    totalFiles: items.reduce((sum, item) => sum + item.files, 0),
    sensitiveSelected: selected.filter((category) => category.sensitive).map((category) => category.id)
  };
}

function executeDataDeletion(categoryIds: string[], source: DexNestActionTrigger, createBackupFirst: boolean) {
  const startedAt = Date.now();
  const catalog = dataManagementCatalog();
  const selected = catalog.filter((category) => categoryIds.includes(category.id));
  const auditSelected = selected.some((category) => category.special === "audit");

  let backupCreated = false;
  let backupFileName: string | null = null;
  let backupError: string | null = null;
  if (createBackupFirst) {
    const result = createBackup({ includeIndex: true }, source);
    if (result.ok) {
      backupCreated = true;
      backupFileName = result.fileName ?? null;
    } else {
      backupError = result.error ?? "Backup failed.";
    }
  }

  const results: Array<{ id: string; label: string; recordsCleared: number; filesDeleted: number; ok: boolean; error?: string }> = [];

  for (const category of selected) {
    try {
      let recordsCleared = 0;
      let filesDeleted = 0;

      if (category.special === "audit") {
        recordsCleared = localDb.clearEvents();
      } else if (category.special === "appHealth") {
        lastAppHealthState = null;
        recordsCleared = 1;
      } else {
        for (const file of category.recordFiles) {
          recordsCleared += countRecordEntries(file);
          deleteManagedRecordFile(file);
        }
        for (const root of category.fileRoots) {
          filesDeleted += emptyManagedDir(root);
        }
      }

      if (category.special === "secureVault") {
        lockSecureVault();
        deleteManagedRecordFile(secureVaultPath);
      }

      if (category.special === "credentials") {
        // Drop the saved Govee credential reference too, without deleting the
        // External Devices settings file (preserve required default settings).
        const settings = loadExternalDevicesSettings();
        if (settings.goveeApiKeyCredentialId) {
          saveExternalDevicesSettings({ goveeApiKeyCredentialId: null });
        }
      }

      results.push({ id: category.id, label: category.label, recordsCleared, filesDeleted, ok: true });
    } catch (error) {
      results.push({ id: category.id, label: category.label, recordsCleared: 0, filesDeleted: 0, ok: false, error: error instanceof Error ? error.message : "Deletion failed." });
    }
  }

  const failed = results.filter((result) => !result.ok);
  const status: DataManagementStatus["status"] = failed.length === 0 ? "success" : failed.length === results.length ? "failed" : "partial";

  const statusRecord: DataManagementStatus = {
    lastDeletionAt: new Date().toISOString(),
    status,
    categoriesCleared: results.filter((result) => result.ok).map((result) => result.label),
    backupCreated,
    backupFileName
  };
  writeJsonFile(dataManagementStatusPath, statusRecord);

  // Audit metadata only — no private content. If the Audit history was cleared,
  // this final summary event is written AFTER the clear so it survives as the
  // record of what happened.
  const auditSummary = {
    module: "system",
    actionId: "system.data.execute_delete",
    eventType: "data_management_deleted" as const,
    status: (status === "failed" ? "failed" : "success") as DexNestEventStatus,
    source,
    summary: `Data Management deleted ${results.filter((r) => r.ok).length}/${results.length} categories (${statusRecord.categoriesCleared.join(", ") || "none"}).`,
    metadataJson: {
      status,
      backupCreated,
      categoriesCleared: statusRecord.categoriesCleared,
      totalRecordsCleared: results.reduce((sum, r) => sum + r.recordsCleared, 0),
      totalFilesDeleted: results.reduce((sum, r) => sum + r.filesDeleted, 0),
      failedCategories: failed.map((r) => r.label)
    },
    durationMs: Date.now() - startedAt
  };
  // Written unconditionally; when Audit was cleared above this becomes the final
  // surviving record of the deletion.
  void auditSelected;
  localDb.appendActionEvent(auditSummary);

  return {
    ok: status !== "failed",
    status,
    results,
    backupCreated,
    backupFileName,
    backupError,
    lastDeletion: statusRecord,
    dataManagementState: dataManagementState()
  };
}

function isUnsafeZipEntry(entryName: string): boolean {
  const normalized = entryName.replace(/\\/g, "/");
  return normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || /^[a-zA-Z]:/.test(normalized);
}

function previewBackupZip(path: string, source: DexNestActionTrigger = "module_ui"): BackupPreview {
  const startedAt = Date.now();
  try {
    const resolvedPath = resolve(path);
    if (!existsSync(resolvedPath)) {
      throw new Error("Backup zip was not found.");
    }
    if (!resolvedPath.toLowerCase().endsWith(".zip")) {
      throw new Error("Select a DexNest .zip backup.");
    }

    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries().map((entry) => entry.entryName).filter(Boolean);
    const unsafeEntry = entries.find(isUnsafeZipEntry);
    if (unsafeEntry) {
      throw new Error(`Backup contains an unsafe path: ${unsafeEntry}`);
    }
    const topLevel = [...new Set(entries.map((entry) => entry.replace(/\\/g, "/").split("/")[0]).filter(Boolean))].sort();
    const preview = {
      ok: true,
      path: resolvedPath,
      sizeBytes: statSync(resolvedPath).size,
      entries: entries.slice(0, 200),
      topLevel
    };
    localDb.appendActionEvent({
      module: "backup",
      actionId: "backup.preview_restore",
      eventType: "restore_previewed",
      status: "success",
      source,
      summary: "Previewed local DexNest backup restore.",
      metadataJson: { entryCount: entries.length, topLevel },
      durationMs: Date.now() - startedAt
    });
    return preview;
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest restore preview failed.";
    localDb.appendActionEvent({
      module: "backup",
      actionId: "backup.preview_restore",
      eventType: "restore_preview_failed",
      status: "failed",
      source,
      summary: message,
      metadataJson: {},
      errorMessage: message,
      durationMs: Date.now() - startedAt
    });
    return { ok: false, path, sizeBytes: 0, entries: [], topLevel: [], error: message };
  }
}

function extractBackupToStaging(path: string): void {
  ensureBackupRoot();
  rmSync(restoreStagingRoot, { recursive: true, force: true });
  mkdirSync(restoreStagingRoot, { recursive: true });

  const zip = new AdmZip(path);
  for (const entry of zip.getEntries()) {
    if (isUnsafeZipEntry(entry.entryName)) {
      throw new Error(`Backup contains an unsafe path: ${entry.entryName}`);
    }
    const targetPath = resolve(restoreStagingRoot, entry.entryName);
    if (!isPathInside(restoreStagingRoot, targetPath)) {
      throw new Error(`Backup entry escaped restore staging: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      mkdirSync(targetPath, { recursive: true });
    } else {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, entry.getData());
    }
  }
}

function restoreBackupConfirmed(path: string, source: DexNestActionTrigger = "module_ui") {
  const startedAt = Date.now();
  try {
    const preview = previewBackupZip(path, source);
    if (!preview.ok) {
      throw new Error(preview.error ?? "Restore preview failed.");
    }

    const safetyBackup = createBackup({ ...defaultBackupOptions(), includeIndex: true }, source);
    if (!safetyBackup.ok) {
      throw new Error("Safety backup failed. Restore cancelled.");
    }

    extractBackupToStaging(preview.path);
    const restorableRoots = ["settings", "files", "data", "index"];
    const restored: string[] = [];
    for (const rootName of restorableRoots) {
      const stagedPath = join(restoreStagingRoot, rootName);
      if (!existsSync(stagedPath)) {
        continue;
      }
      const targetPath = join(localDataRoot, rootName);
      if (!isPathInside(localDataRoot, targetPath)) {
        throw new Error(`Invalid restore target: ${rootName}`);
      }
      rmSync(targetPath, { recursive: true, force: true });
      cpSync(stagedPath, targetPath, { recursive: true });
      restored.push(rootName);
    }

    localDb.appendActionEvent({
      module: "backup",
      actionId: "backup.restore_confirmed",
      eventType: "restore_completed",
      status: "success",
      source,
      summary: "Restored DexNest local data from backup.",
      metadataJson: { restored, safetyBackupPath: safetyBackup.path },
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId: "backup.restore_confirmed", restored, safetyBackupPath: safetyBackup.path, backupState: backupState() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest restore failed.";
    localDb.appendActionEvent({
      module: "backup",
      actionId: "backup.restore_confirmed",
      eventType: "restore_failed",
      status: "failed",
      source,
      summary: message,
      metadataJson: {},
      errorMessage: message,
      durationMs: Date.now() - startedAt
    });
    return { ok: false, actionId: "backup.restore_confirmed", error: message, backupState: backupState() };
  }
}

function selectBackupZip(): string | null {
  const result = dialog.showOpenDialogSync({
    title: "Select DexNest backup",
    properties: ["openFile"],
    filters: [{ name: "DexNest backup zip", extensions: ["zip"] }]
  });
  return result?.[0] ?? null;
}

function runBackupAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const input = typeof payload === "object" && payload !== null ? (payload as Partial<BackupOptions> & { path?: string; confirmedDangerous?: boolean }) : {};
  const startedAt = Date.now();

  if (action.id === "backup.open") {
    localDb.appendActionEvent({
      module: "backup",
      actionId: action.id,
      eventType: "backup_opened",
      status: "success",
      source,
      summary: "Opened DexNest backup settings.",
      metadataJson: {},
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId: action.id, backupState: backupState() };
  }

  if (action.id === "backup.create") {
    return createBackup(input, source);
  }

  if (action.id === "backup.open_folder") {
    ensureBackupRoot();
    void shell.openPath(backupsRoot);
    localDb.appendActionEvent({
      module: "backup",
      actionId: action.id,
      eventType: "backup_folder_opened",
      status: "success",
      source,
      summary: "Opened DexNest backup folder.",
      metadataJson: { backupFolderPath: backupsRoot },
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId: action.id, backupState: backupState() };
  }

  if (action.id === "backup.preview_restore") {
    if (!input.path) {
      return { ok: false, actionId: action.id, error: "Select a backup zip first.", backupState: backupState() };
    }
    return { ok: true, actionId: action.id, preview: previewBackupZip(input.path, source), backupState: backupState() };
  }

  if (action.id === "backup.restore_confirmed") {
    if (input.confirmedDangerous !== true) {
      return { ok: false, actionId: action.id, error: "Restore confirmation is required.", backupState: backupState() };
    }
    if (!input.path) {
      return { ok: false, actionId: action.id, error: "Select a backup zip first.", backupState: backupState() };
    }
    return restoreBackupConfirmed(input.path, source);
  }

  return null;
}

const vaultCategories = [
  "Immigration",
  "University",
  "Jobs",
  "Startup",
  "Tax",
  "Finance",
  "Medical",
  "Research",
  "Receipts",
  "Personal",
  "Other"
];

const secureVaultItemTypes: SecureVaultItemType[] = ["password", "api_key", "token", "recovery_code", "private_note", "server", "other"];
const secureVaultVerifierText = "DexNest Secure Vault verifier";
const secureVaultDefaultAutoLockMinutes = 5;

function normalizeTags(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => tag.trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function loadVaultDocuments(): VaultDocumentRecord[] {
  ensureVaultRoot();
  return readJsonFile<VaultDocumentRecord[]>(vaultDocumentsPath, []);
}

function saveVaultDocuments(documents: VaultDocumentRecord[]): VaultDocumentRecord[] {
  ensureVaultRoot();
  return writeJsonFile(vaultDocumentsPath, documents);
}

function defaultVaultOcrSettings(): VaultOcrSettings {
  return {
    autoOcrOnImport: true,
    engine: "paddleocr",
    device: "gpu",
    pythonPath: null
  };
}

function loadVaultOcrSettings(): VaultOcrSettings {
  return { ...defaultVaultOcrSettings(), ...readJsonFile<Partial<VaultOcrSettings>>(vaultOcrSettingsPath, {}) };
}

function saveVaultOcrSettings(settings: Partial<VaultOcrSettings>): VaultOcrSettings {
  const next: VaultOcrSettings = {
    ...loadVaultOcrSettings(),
    ...settings,
    engine: "paddleocr",
    device: "gpu"
  };
  return writeJsonFile(vaultOcrSettingsPath, next);
}

function loadVaultOcrJobs(): VaultOcrJob[] {
  ensureVaultRoot();
  return readJsonFile<VaultOcrJob[]>(vaultOcrJobsPath, []);
}

function saveVaultOcrJobs(jobs: VaultOcrJob[]): VaultOcrJob[] {
  ensureVaultRoot();
  return writeJsonFile(vaultOcrJobsPath, jobs);
}

function isVaultOcrSupported(fileType: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(fileType.toLowerCase());
}

function updateVaultDocumentOcr(documentId: string, patch: Partial<VaultDocumentRecord>): void {
  const documents = loadVaultDocuments();
  saveVaultDocuments(documents.map((document) => (
    document.id === documentId ? { ...document, ...patch, updatedAt: new Date().toISOString() } : document
  )));
}

function queueVaultOcrJob(document: VaultDocumentRecord, force = false): VaultOcrJob | null {
  if (!isVaultOcrSupported(document.fileType)) {
    updateVaultDocumentOcr(document.id, { ocrStatus: "unsupported", ocrError: "Unsupported OCR file type.", ocrUpdatedAt: new Date().toISOString() });
    return null;
  }

  const jobs = loadVaultOcrJobs();
  const existing = jobs.find((job) => job.documentId === document.id && ["queued", "running"].includes(job.status));
  if (existing && !force) {
    return existing;
  }

  const now = new Date().toISOString();
  const job: VaultOcrJob = {
    id: createId("vault-ocr-job"),
    documentId: document.id,
    filePath: document.filePath,
    fileType: document.fileType,
    status: "queued",
    engine: "paddleocr",
    device: "gpu",
    createdAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    outputTextPath: null,
    outputMetadataPath: null
  };
  saveVaultOcrJobs([job, ...jobs]);
  updateVaultDocumentOcr(document.id, { ocrStatus: "queued", ocrError: null, ocrUpdatedAt: now });
  localDb.appendActionEvent({
    module: "DexNest Vault",
    actionId: "vault.ocr.queue_document",
    eventType: "vault_ocr_queued",
    status: "success",
    source: "system",
    summary: "Queued Vault document for GPU OCR.",
    metadataJson: { documentId: document.id, fileType: document.fileType, engine: "paddleocr", device: "gpu" }
  });
  return job;
}

function saveVaultOcrOutput(document: VaultDocumentRecord, text: string, metadata: Record<string, unknown>): { textPath: string; metadataPath: string } {
  ensureVaultRoot();
  const baseName = sanitizeFileName(`${document.id}-${basename(document.storedFileName, extname(document.storedFileName))}`);
  const textPath = safeOutputPath(vaultOcrRoot, uniqueFileName(vaultOcrRoot, `${baseName}-paddleocr-gpu.txt`));
  const metadataPath = safeOutputPath(vaultOcrRoot, uniqueFileName(vaultOcrRoot, `${baseName}-paddleocr-gpu-metadata.json`));
  writeFileSync(textPath, text, "utf8");
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  return { textPath, metadataPath };
}

function setVaultOcrJob(jobId: string, patch: Partial<VaultOcrJob>): VaultOcrJob | null {
  const jobs = loadVaultOcrJobs();
  const existing = jobs.find((job) => job.id === jobId);
  if (!existing) {
    return null;
  }
  const updated: VaultOcrJob = { ...existing, ...patch };
  saveVaultOcrJobs(jobs.map((job) => job.id === jobId ? updated : job));
  return updated;
}

function defaultSecureVaultFile(masterPassword: string, autoLockMinutes = secureVaultDefaultAutoLockMinutes): SecureVaultFile {
  const salt = randomBytes(16);
  const kdf: SecureVaultFile["kdf"] = {
    name: "scrypt",
    salt: salt.toString("base64"),
    keyLength: 32,
    N: 16384,
    r: 8,
    p: 1
  };
  const key = deriveSecureVaultKey(masterPassword, kdf);
  secureVaultKey = key;
  return {
    version: 1,
    kdf,
    verifier: encryptSecureValue(secureVaultVerifierText, key),
    settings: {
      autoLockMinutes: Math.min(60, Math.max(1, Math.floor(autoLockMinutes))),
      // Default: stay unlocked for the whole app session (no inactivity timer).
      lockMode: "on_app_exit"
    },
    items: []
  };
}

function loadSecureVaultFile(): SecureVaultFile | null {
  ensureVaultRoot();
  if (!existsSync(secureVaultPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(secureVaultPath, "utf8")) as SecureVaultFile;
  } catch (error) {
    // Never treat a corrupt vault as "not set up" — that would let a later save
    // overwrite the user's encrypted data. Surface a clear, actionable error instead.
    console.error("DexNest: secure vault file is corrupt.", error);
    throw new Error(`DexNest Secure Vault file is corrupt and could not be read (${secureVaultPath}). Restore it from a backup before continuing.`);
  }
}

function saveSecureVaultFile(file: SecureVaultFile): SecureVaultFile {
  ensureVaultRoot();
  writeFileSync(secureVaultPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return file;
}

function deriveSecureVaultKey(masterPassword: string, kdf: SecureVaultFile["kdf"]): Buffer {
  if (!masterPassword) {
    throw new Error("Master password is required.");
  }
  return scryptSync(masterPassword, Buffer.from(kdf.salt, "base64"), kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 64 * 1024 * 1024
  });
}

function encryptSecureValue(value: string, key: Buffer): SecureEncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64")
  };
}

function decryptSecureValue(blob: SecureEncryptedBlob, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function verifySecureVaultKey(file: SecureVaultFile, key: Buffer): void {
  const verifier = Buffer.from(decryptSecureValue(file.verifier, key), "utf8");
  const expected = Buffer.from(secureVaultVerifierText, "utf8");
  if (verifier.length !== expected.length || !timingSafeEqual(verifier, expected)) {
    throw new Error("Invalid master password.");
  }
}

function requireSecureVaultKey(): Buffer {
  if (!secureVaultKey) {
    throw new Error("Secure Vault is locked.");
  }
  return secureVaultKey;
}

function secureVaultUnlockedItems(): SecureVaultUnlockedItem[] {
  const file = loadSecureVaultFile();
  if (!file || !secureVaultKey) {
    return [];
  }
  return file.items.map((item) => ({
    id: item.id,
    title: item.title,
    type: item.type,
    username: item.username,
    url: item.url,
    tags: item.tags,
    secret: decryptSecureValue(item.secret, secureVaultKey as Buffer),
    notes: decryptSecureValue(item.notes, secureVaultKey as Buffer),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastCopiedAt: item.lastCopiedAt,
    favorite: item.favorite
  }));
}

function secureVaultLockMode(): "on_app_exit" | "timer" {
  return loadSecureVaultFile()?.settings.lockMode === "timer" ? "timer" : "on_app_exit";
}

function scheduleSecureVaultAutoLock(minutes: number): void {
  if (secureVaultAutoLockTimer) {
    clearTimeout(secureVaultAutoLockTimer);
    secureVaultAutoLockTimer = null;
  }
  // Default lock mode keeps the vault unlocked for the whole app session — no
  // inactivity timer. Only the optional "timer" mode arms an auto-lock.
  if (secureVaultLockMode() !== "timer") {
    return;
  }
  secureVaultAutoLockTimer = setTimeout(() => {
    secureVaultKey = null;
    localDb.appendActionEvent({
      module: "DexNest Vault",
      actionId: "vault.secure.lock",
      eventType: "vault_secure_auto_locked",
      status: "success",
      source: "system",
      summary: "DexNest Secure Vault auto-locked after inactivity.",
      metadataJson: { autoLockMinutes: minutes }
    });
  }, Math.max(1, minutes) * 60 * 1000);
}

function touchSecureVaultActivity(): void {
  const file = loadSecureVaultFile();
  if (file && secureVaultKey) {
    scheduleSecureVaultAutoLock(file.settings.autoLockMinutes || secureVaultDefaultAutoLockMinutes);
  }
}

function lockSecureVault(): void {
  secureVaultKey = null;
  if (secureVaultAutoLockTimer) {
    clearTimeout(secureVaultAutoLockTimer);
    secureVaultAutoLockTimer = null;
  }
}

function secureVaultState(): SecureVaultState {
  const file = loadSecureVaultFile();
  return {
    isSetup: Boolean(file),
    isUnlocked: Boolean(file && secureVaultKey),
    filePath: secureVaultPath,
    autoLockMinutes: file?.settings.autoLockMinutes ?? secureVaultDefaultAutoLockMinutes,
    lockMode: file?.settings.lockMode === "timer" ? "timer" : "on_app_exit",
    itemTypes: secureVaultItemTypes,
    items: file && secureVaultKey ? secureVaultUnlockedItems() : []
  };
}

function defaultExternalDevicesSettings(): ExternalDevicesSettings {
  return {
    goveeEnabled: false,
    goveeApiKeySecretId: null,
    goveeApiKeyCredentialId: null,
    defaultDeviceAlias: null,
    allowVoiceControl: true,
    allowStreamDeckControl: true,
    allowKeyboardShortcutControl: true,
    requireConfirmationForPowerOff: false,
    requireConfirmationForBrightnessBelow10: false,
    requireConfirmationForScenes: false,
    updatedAt: null
  };
}

function loadExternalDevicesSettings(): ExternalDevicesSettings {
  return {
    ...defaultExternalDevicesSettings(),
    ...readJsonFile<Partial<ExternalDevicesSettings>>(externalDevicesSettingsPath, defaultExternalDevicesSettings())
  };
}

function saveExternalDevicesSettings(input: Partial<ExternalDevicesSettings>): ExternalDevicesSettings {
  const current = loadExternalDevicesSettings();
  const next: ExternalDevicesSettings = {
    ...current,
    ...input,
    goveeApiKeySecretId: input.goveeApiKeySecretId === undefined ? current.goveeApiKeySecretId : input.goveeApiKeySecretId,
    goveeApiKeyCredentialId: input.goveeApiKeyCredentialId === undefined ? current.goveeApiKeyCredentialId : input.goveeApiKeyCredentialId,
    defaultDeviceAlias: input.defaultDeviceAlias === undefined ? current.defaultDeviceAlias : input.defaultDeviceAlias,
    updatedAt: new Date().toISOString()
  };
  return writeJsonFile(externalDevicesSettingsPath, next);
}

function loadExternalDevicesCache(): ExternalDeviceCacheItem[] {
  return readJsonFile<ExternalDeviceCacheItem[]>(externalDevicesCachePath, []);
}

function saveExternalDevicesCache(devices: ExternalDeviceCacheItem[]): ExternalDeviceCacheItem[] {
  return writeJsonFile(externalDevicesCachePath, devices);
}

function loadExternalDeviceGroups(): ExternalDeviceGroup[] {
  return readJsonFile<ExternalDeviceGroup[]>(externalDevicesGroupsPath, []);
}

function saveExternalDeviceGroups(groups: ExternalDeviceGroup[]): ExternalDeviceGroup[] {
  return writeJsonFile(externalDevicesGroupsPath, groups);
}

function externalDevicesState(): ExternalDevicesState {
  const settings = loadExternalDevicesSettings();
  const secureSetup = Boolean(loadSecureVaultFile());
  const secureUnlocked = Boolean(secureVaultKey);
  const keychainCredential = findIntegrationCredential("govee", settings.goveeApiKeyCredentialId);
  const apiKeyInKeychain = Boolean(keychainCredential);
  const hasLegacyVaultKey = Boolean(settings.goveeApiKeySecretId) && !apiKeyInKeychain;
  const apiKeyStored = apiKeyInKeychain || Boolean(settings.goveeApiKeySecretId) || Boolean(readLocalGoveeApiKey());
  const keychainAvailable = integrationKeychainAvailableMethod() !== null;
  let providerStatus: ExternalDevicesState["providerStatus"] = "ready";
  let providerMessage = "Govee is ready (key in Integration Keychain, no Vault unlock needed).";
  if (!settings.goveeEnabled) {
    providerStatus = "disabled";
    providerMessage = "Govee provider is disabled.";
  } else if (apiKeyInKeychain) {
    providerStatus = "ready";
    providerMessage = "Govee key is stored in the Integration Keychain — works without unlocking the Vault.";
  } else if (!apiKeyStored) {
    providerStatus = "missing_api_key";
    providerMessage = "Save your Govee API key to the Integration Keychain to enable device control.";
  } else if (hasLegacyVaultKey && !secureUnlocked) {
    providerStatus = "locked";
    providerMessage = "Your Govee key is still in Secure Vault. Move it to the Integration Keychain so lights work without unlocking the Vault.";
  }
  return {
    settingsPath: externalDevicesSettingsPath,
    cachePath: externalDevicesCachePath,
    groupsPath: externalDevicesGroupsPath,
    settings,
    secureVaultSetup: secureSetup,
    secureVaultUnlocked: secureUnlocked,
    apiKeyStored,
    apiKeyInKeychain,
    keychainStorageMethod: keychainCredential?.storageMethod ?? null,
    keychainAvailable,
    hasLegacyVaultKey,
    providerStatus,
    providerMessage,
    devices: loadExternalDevicesCache(),
    groups: loadExternalDeviceGroups()
  };
}

// --- Integration Keychain (app/service credentials, not personal secrets) ---
// Stores integration API keys (e.g. Govee) encrypted with the OS user-bound
// Electron safeStorage (DPAPI on Windows) so DexNest can read them at startup
// without unlocking the Secure Vault. The Secure Vault stays reserved for
// personal secrets (passwords, passport, SIN, …). The plaintext key is never
// persisted, logged, or returned to the renderer.
type IntegrationStorageMethod = "electron_safeStorage" | "windows_dpapi" | "dev_insecure";

interface IntegrationCredential {
  id: string;
  provider: string;
  label: string;
  encryptedValue: string;
  createdAt: string;
  updatedAt: string;
  storageMethod: IntegrationStorageMethod;
}

function integrationInsecureAllowed(): boolean {
  return process.env.DEXNEST_ALLOW_INSECURE_KEYCHAIN === "1";
}

function loadIntegrationKeychain(): IntegrationCredential[] {
  return readJsonFile<IntegrationCredential[]>(integrationKeychainPath, []);
}

function saveIntegrationKeychain(items: IntegrationCredential[]): IntegrationCredential[] {
  return writeJsonFile(integrationKeychainPath, items);
}

function integrationKeychainAvailableMethod(): IntegrationStorageMethod | null {
  if (safeStorage.isEncryptionAvailable()) {
    return "electron_safeStorage";
  }
  return integrationInsecureAllowed() ? "dev_insecure" : null;
}

function encryptIntegrationValue(value: string): { encryptedValue: string; storageMethod: IntegrationStorageMethod } {
  if (safeStorage.isEncryptionAvailable()) {
    return { encryptedValue: safeStorage.encryptString(value).toString("base64"), storageMethod: "electron_safeStorage" };
  }
  if (integrationInsecureAllowed()) {
    // Explicit dev/testing fallback only. Never the default.
    return { encryptedValue: Buffer.from(value, "utf8").toString("base64"), storageMethod: "dev_insecure" };
  }
  throw new Error("Secure local encryption (safeStorage) is not available on this system.");
}

function decryptIntegrationCredential(credential: IntegrationCredential): string {
  if (credential.storageMethod === "dev_insecure") {
    return Buffer.from(credential.encryptedValue, "base64").toString("utf8");
  }
  // electron_safeStorage / windows_dpapi
  return safeStorage.decryptString(Buffer.from(credential.encryptedValue, "base64"));
}

function findIntegrationCredential(provider: string, id?: string | null): IntegrationCredential | undefined {
  const items = loadIntegrationKeychain();
  if (id) {
    const byId = items.find((item) => item.id === id);
    if (byId) {
      return byId;
    }
  }
  return items.find((item) => item.provider === provider);
}

// Upsert one credential per provider. Returns the credential id.
function setIntegrationCredential(provider: string, label: string, value: string): { id: string; storageMethod: IntegrationStorageMethod } {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("A credential value is required.");
  }
  const { encryptedValue, storageMethod } = encryptIntegrationValue(trimmed);
  const items = loadIntegrationKeychain();
  const existing = items.find((item) => item.provider === provider);
  const now = new Date().toISOString();
  const credential: IntegrationCredential = {
    id: existing?.id ?? createId("integration-cred"),
    provider,
    label,
    encryptedValue,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    storageMethod
  };
  saveIntegrationKeychain(existing ? items.map((item) => (item.id === existing.id ? credential : item)) : [credential, ...items]);
  return { id: credential.id, storageMethod };
}

function getIntegrationCredentialValue(provider: string, id?: string | null): string | null {
  const credential = findIntegrationCredential(provider, id);
  if (!credential) {
    return null;
  }
  try {
    return decryptIntegrationCredential(credential);
  } catch {
    return null;
  }
}

function removeIntegrationCredential(provider: string): boolean {
  const items = loadIntegrationKeychain();
  const next = items.filter((item) => item.provider !== provider);
  if (next.length === items.length) {
    return false;
  }
  saveIntegrationKeychain(next);
  return true;
}

function upsertGoveeApiKeySecret(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("Govee API key is required.");
  }
  const file = loadSecureVaultFile();
  if (!file) {
    throw new Error("Set up DexNest Secure Vault before saving a Govee API key.");
  }
  const key = requireSecureVaultKey();
  const settings = loadExternalDevicesSettings();
  const now = new Date().toISOString();
  const existing = settings.goveeApiKeySecretId ? file.items.find((item) => item.id === settings.goveeApiKeySecretId) : undefined;
  const item: SecureVaultStoredItem = {
    id: existing?.id ?? createId("secure-item"),
    title: "Govee API Key",
    type: "api_key",
    username: "govee",
    url: "https://developer.govee.com",
    tags: ["external_devices", "govee"],
    secret: encryptSecureValue(trimmed, key),
    notes: encryptSecureValue("DexNest External Devices provider key.", key),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastCopiedAt: existing?.lastCopiedAt ?? null,
    favorite: existing?.favorite ?? false
  };
  saveSecureVaultFile({
    ...file,
    items: existing
      ? file.items.map((current) => current.id === existing.id ? item : current)
      : [item, ...file.items]
  });
  touchSecureVaultActivity();
  return item.id;
}

type ExternalDeviceFailureStatus =
  | "locked"
  | "disabled"
  | "missing_requirement"
  | "not_configured"
  | "not_found"
  | "conflict"
  | "invalid_params"
  | "rate_limited"
  | "auth_failed"
  | "provider_error"
  | "failed";

class ExternalDeviceActionError extends Error {
  status: ExternalDeviceFailureStatus;
  errorCode: string;
  missingRequirement?: string;
  details?: Record<string, unknown>;

  constructor(status: ExternalDeviceFailureStatus, errorCode: string, message: string, options: { missingRequirement?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "ExternalDeviceActionError";
    this.status = status;
    this.errorCode = errorCode;
    this.missingRequirement = options.missingRequirement;
    this.details = options.details;
  }
}

function safeGoveeDeviceSummary(device: ExternalDeviceCacheItem) {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    userAlias: device.userAlias,
    roomAlias: device.roomAlias,
    model: device.model,
    controllable: device.controllable
  };
}

function safeGoveeGroupSummary(group: ExternalDeviceGroup) {
  return {
    id: group.id,
    name: group.name,
    aliases: group.aliases,
    deviceCount: group.deviceIds.length
  };
}

function readLocalGoveeApiKey(): string | null {
  const saved = readJsonFile<{ apiKey?: string }>(goveeLocalApiKeyPath, {});
  const apiKey = typeof saved.apiKey === "string" ? saved.apiKey.trim() : "";
  return apiKey || null;
}

function readGoveeApiKey(): string {
  const settings = loadExternalDevicesSettings();
  if (!settings.goveeEnabled) {
    throw new ExternalDeviceActionError("disabled", "provider_disabled", "Govee is disabled in External Devices settings.");
  }
  // 1) Integration Keychain (preferred) — readable at startup without the Vault.
  const credential = findIntegrationCredential("govee", settings.goveeApiKeyCredentialId);
  if (credential) {
    try {
      const value = decryptIntegrationCredential(credential);
      if (value) {
        return value;
      }
    } catch {
      throw new ExternalDeviceActionError("auth_failed", "govee_credential_unavailable", "Govee credential is unavailable. Reconnect Govee.", { missingRequirement: "govee_api_key" });
    }
  }
  // 2) Legacy local file (dev) — kept only for backward compatibility.
  const localApiKey = readLocalGoveeApiKey();
  if (localApiKey) {
    return localApiKey;
  }
  // 3) Legacy Secure Vault secret (un-migrated) — requires unlock; offer migration.
  if (!settings.goveeApiKeySecretId) {
    throw new ExternalDeviceActionError("missing_requirement", "missing_api_key", "Govee API key is not configured.", { missingRequirement: "govee_api_key" });
  }
  const file = loadSecureVaultFile();
  if (!file) {
    throw new ExternalDeviceActionError("not_configured", "secure_vault_not_setup", "Set up Secure Vault in DexNest before saving a Govee API key.", { missingRequirement: "secure_vault" });
  }
  let key: Buffer;
  try {
    key = requireSecureVaultKey();
  } catch {
    throw new ExternalDeviceActionError("locked", "secure_vault_locked", "Move the Govee key to the Integration Keychain (External Devices settings) so lights work without unlocking the Vault.", { missingRequirement: "secure_vault_unlock" });
  }
  const item = file.items.find((candidate) => candidate.id === settings.goveeApiKeySecretId);
  if (!item) {
    throw new ExternalDeviceActionError("missing_requirement", "govee_api_key_missing", "Stored Govee API key reference was not found in Secure Vault.", { missingRequirement: "govee_api_key" });
  }
  touchSecureVaultActivity();
  return decryptSecureValue(item.secret, key);
}

function safeGoveeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Govee action failed.";
  return message.replace(/Govee-API-Key[^\s,}]*/gi, "Govee-API-Key [redacted]");
}

function externalDeviceFailure(error: unknown, params: Record<string, unknown> = {}) {
  const message = safeGoveeError(error);
  if (error instanceof ExternalDeviceActionError) {
    return {
      status: error.status,
      errorCode: error.errorCode,
      message,
      missingRequirement: error.missingRequirement,
      details: error.details ?? {}
    };
  }
  if (/secure vault is locked/i.test(message)) {
    return { status: "locked" as const, errorCode: "secure_vault_locked", message: "Unlock Secure Vault in DexNest to use Govee actions.", missingRequirement: "secure_vault_unlock", details: {} };
  }
  if (/disabled/i.test(message)) {
    return { status: "disabled" as const, errorCode: "provider_disabled", message, missingRequirement: undefined, details: {} };
  }
  if (/rate limit/i.test(message)) {
    return { status: "rate_limited" as const, errorCode: "govee_rate_limited", message, missingRequirement: undefined, details: {} };
  }
  if (/rejected the api key/i.test(message)) {
    return { status: "auth_failed" as const, errorCode: "govee_auth_failed", message, missingRequirement: "govee_api_key", details: {} };
  }
  if (/not found|no govee device/i.test(message)) {
    return {
      status: "not_found" as const,
      errorCode: "govee_device_not_found",
      message,
      missingRequirement: undefined,
      details: {
        requestedAlias: typeof params.alias === "string" ? params.alias : undefined,
        availableDevices: loadExternalDevicesCache().map(safeGoveeDeviceSummary)
      }
    };
  }
  return { status: "provider_error" as const, errorCode: "govee_provider_error", message, missingRequirement: undefined, details: {} };
}

function externalDeviceMetadata(input: Record<string, unknown> = {}): Record<string, unknown> {
  return { provider: "govee", ...input };
}

function logExternalDeviceEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadata: Record<string, unknown> = {},
  startedAt = Date.now(),
  errorMessage?: string | null
): void {
  localDb.appendActionEvent({
    module: "DexNest External Devices",
    actionId,
    eventType: actionId.replaceAll(".", "_"),
    status,
    source,
    summary,
    metadataJson: externalDeviceMetadata(metadata),
    errorMessage: errorMessage ?? null,
    durationMs: Date.now() - startedAt
  });
}

function normalizeAlias(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\b(my|the)\b/g, " ")
    .replace(/\blights\b/g, "light")
    .replace(/\blamps\b/g, "lamp")
    .replace(/\s+/g, " ")
    .trim();
}

function deviceAliases(device: ExternalDeviceCacheItem): string[] {
  return [device.userAlias, device.roomAlias, device.deviceName, device.deviceId]
    .map(normalizeAlias)
    .filter(Boolean);
}

function groupAliases(group: ExternalDeviceGroup): string[] {
  return [group.name, group.id, ...group.aliases]
    .map(normalizeAlias)
    .filter(Boolean);
}

function uniqueDevicesById(devices: ExternalDeviceCacheItem[]): ExternalDeviceCacheItem[] {
  return [...new Map(devices.map((device) => [device.deviceId, device])).values()];
}

type ExternalDeviceTarget =
  | { type: "device"; alias: string; devices: ExternalDeviceCacheItem[]; device: ExternalDeviceCacheItem }
  | { type: "group"; alias: string; devices: ExternalDeviceCacheItem[]; group: ExternalDeviceGroup };

function findExternalDeviceTarget(params: Record<string, unknown>): ExternalDeviceTarget {
  const devices = loadExternalDevicesCache();
  const deviceId = String(params.deviceId ?? "").trim();
  if (deviceId) {
    const device = devices.find((item) => item.deviceId === deviceId);
    if (!device) {
      throw new ExternalDeviceActionError("not_found", "govee_device_not_found", "Govee device ID was not found in the local cache. Refresh devices first.", {
        details: { availableDevices: devices.map(safeGoveeDeviceSummary) }
      });
    }
    return { type: "device", alias: device.userAlias || device.roomAlias || device.deviceName, device, devices: [device] };
  }
  const alias = normalizeAlias(params.alias ?? loadExternalDevicesSettings().defaultDeviceAlias ?? "");
  if (!alias) {
    throw new ExternalDeviceActionError("invalid_params", "missing_device_alias", "Provide a deviceId or alias for the Govee action.", {
      missingRequirement: "device_alias",
      details: { availableDevices: devices.map(safeGoveeDeviceSummary), availableGroups: loadExternalDeviceGroups().map(safeGoveeGroupSummary) }
    });
  }
  const groups = loadExternalDeviceGroups();
  const exactUserAliasMatches = devices.filter((device) => normalizeAlias(device.userAlias) === alias);
  if (exactUserAliasMatches.length === 1) {
    return { type: "device", alias, device: exactUserAliasMatches[0], devices: exactUserAliasMatches };
  }
  if (exactUserAliasMatches.length > 1) {
    throw new ExternalDeviceActionError("conflict", "govee_alias_conflict", `Multiple Govee devices match alias ${alias}. Use a more specific alias.`, {
      details: { requestedAlias: alias, matches: exactUserAliasMatches.map(safeGoveeDeviceSummary) }
    });
  }

  const exactGroupMatches = groups.filter((group) => groupAliases(group).includes(alias));
  if (exactGroupMatches.length === 1) {
    const group = exactGroupMatches[0];
    const groupDevices = devices.filter((device) => group.deviceIds.includes(device.deviceId));
    if (groupDevices.length === 0) {
      throw new ExternalDeviceActionError("not_found", "govee_group_empty", `Govee group ${group.name} has no cached devices.`, {
        details: { requestedAlias: alias, group: safeGoveeGroupSummary(group), availableDevices: devices.map(safeGoveeDeviceSummary) }
      });
    }
    return { type: "group", alias: group.name, group, devices: groupDevices };
  }
  if (exactGroupMatches.length > 1) {
    throw new ExternalDeviceActionError("conflict", "govee_group_alias_conflict", `Multiple Govee groups match alias ${alias}.`, {
      details: { requestedAlias: alias, matches: exactGroupMatches.map(safeGoveeGroupSummary) }
    });
  }

  const exactDeviceNameMatches = devices.filter((device) => normalizeAlias(device.deviceName) === alias);
  if (exactDeviceNameMatches.length === 1) {
    return { type: "device", alias, device: exactDeviceNameMatches[0], devices: exactDeviceNameMatches };
  }
  if (exactDeviceNameMatches.length > 1) {
    throw new ExternalDeviceActionError("conflict", "govee_alias_conflict", `Multiple Govee devices match alias ${alias}. Use a more specific alias.`, {
      details: { requestedAlias: alias, matches: exactDeviceNameMatches.map(safeGoveeDeviceSummary) }
    });
  }

  const exactRoomAliasMatches = devices.filter((device) => normalizeAlias(device.roomAlias) === alias);
  if (exactRoomAliasMatches.length === 1) {
    return { type: "device", alias, device: exactRoomAliasMatches[0], devices: exactRoomAliasMatches };
  }
  if (exactRoomAliasMatches.length > 1) {
    throw new ExternalDeviceActionError("conflict", "govee_alias_conflict", `Multiple Govee devices match alias ${alias}. Use a more specific alias or create a group.`, {
      details: { requestedAlias: alias, matches: exactRoomAliasMatches.map(safeGoveeDeviceSummary), suggestedGroupName: "Room lights" }
    });
  }

  const fuzzyGroupMatches = groups.filter((group) => groupAliases(group).some((candidate) => candidate.includes(alias) || alias.includes(candidate)));
  if (fuzzyGroupMatches.length === 1) {
    const group = fuzzyGroupMatches[0];
    const groupDevices = devices.filter((device) => group.deviceIds.includes(device.deviceId));
    if (groupDevices.length) {
      return { type: "group", alias: group.name, group, devices: groupDevices };
    }
  }

  const fuzzyDeviceMatches = uniqueDevicesById(devices.filter((device) => deviceAliases(device).some((candidate) => candidate.includes(alias) || alias.includes(candidate))));
  if (fuzzyDeviceMatches.length === 1) {
    return { type: "device", alias, device: fuzzyDeviceMatches[0], devices: fuzzyDeviceMatches };
  }
  if (fuzzyDeviceMatches.length > 1) {
    throw new ExternalDeviceActionError("conflict", "govee_alias_conflict", `Multiple Govee devices match alias ${alias}. Use a more specific alias.`, {
      details: { requestedAlias: alias, matches: fuzzyDeviceMatches.map(safeGoveeDeviceSummary), suggestedGroupName: /\blight|lamp\b/.test(alias) ? "Room lights" : undefined }
    });
  }
  throw new ExternalDeviceActionError("not_found", "govee_device_not_found", `No Govee device matched alias ${alias}.`, {
    details: { requestedAlias: alias, availableDevices: devices.map(safeGoveeDeviceSummary), availableGroups: groups.map(safeGoveeGroupSummary) }
  });
}

type GoveeCommandName = "turn" | "brightness" | "color" | "colorTem";

async function goveeRequest<T>(path: string, method: "GET" | "PUT", apiKey: string, body?: unknown): Promise<T> {
  const response = await fetchWithTimeout(`https://developer-api.govee.com/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Govee-API-Key": apiKey
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, 8000);
  if (response.status === 401 || response.status === 403) {
    throw new ExternalDeviceActionError("auth_failed", "govee_auth_failed", "Govee rejected the API key. Verify the key in Settings.", { missingRequirement: "govee_api_key" });
  }
  if (response.status === 429) {
    throw new ExternalDeviceActionError("rate_limited", "govee_rate_limited", "Govee rate limit reached. Wait and try again.");
  }
  if (!response.ok) {
    throw new ExternalDeviceActionError("provider_error", "govee_http_error", `Govee responded with HTTP ${response.status}.`);
  }
  return await response.json() as T;
}

async function goveeListDevices(apiKey: string): Promise<ExternalDeviceCacheItem[]> {
  const data = await goveeRequest<{ data?: { devices?: Array<{ device?: string; deviceName?: string; model?: string; controllable?: boolean; retrievable?: boolean }> } }>("/devices", "GET", apiKey);
  const existing = loadExternalDevicesCache();
  const existingById = new Map(existing.map((device) => [device.deviceId, device]));
  const now = new Date().toISOString();
  return (data.data?.devices ?? [])
    .filter((device) => Boolean(device.device && device.model))
    .map((device) => {
      const previous = existingById.get(String(device.device));
      return {
        provider: "govee" as const,
        deviceId: String(device.device),
        deviceName: String(device.deviceName ?? "Govee device"),
        model: String(device.model),
        controllable: Boolean(device.controllable),
        retrievable: Boolean(device.retrievable),
        roomAlias: previous?.roomAlias ?? "",
        userAlias: previous?.userAlias ?? "",
        lastSeen: now,
        lastKnownPowerState: previous?.lastKnownPowerState ?? "unknown",
        lastKnownBrightness: previous?.lastKnownBrightness ?? null
      };
    });
}

async function goveeControl(device: ExternalDeviceCacheItem, command: GoveeCommandName, value: unknown): Promise<void> {
  const apiKey = readGoveeApiKey();
  await goveeRequest("/devices/control", "PUT", apiKey, {
    device: device.deviceId,
    model: device.model,
    cmd: {
      name: command,
      value
    }
  });
}

function updateCachedGoveeDevice(deviceId: string, patch: Partial<ExternalDeviceCacheItem>): ExternalDeviceCacheItem[] {
  const devices = loadExternalDevicesCache();
  return saveExternalDevicesCache(devices.map((device) => device.deviceId === deviceId ? { ...device, ...patch, lastSeen: new Date().toISOString() } : device));
}

function colorValue(input: unknown): { r: number; g: number; b: number } {
  const raw = String(input ?? "").toLowerCase().trim();
  const named: Record<string, { r: number; g: number; b: number }> = {
    blue: { r: 0, g: 80, b: 255 },
    red: { r: 255, g: 0, b: 0 },
    green: { r: 0, g: 255, b: 80 },
    white: { r: 255, g: 255, b: 255 },
    warm: { r: 255, g: 180, b: 90 },
    purple: { r: 160, g: 60, b: 255 },
    pink: { r: 255, g: 80, b: 180 },
    yellow: { r: 255, g: 220, b: 0 },
    orange: { r: 255, g: 120, b: 0 }
  };
  if (named[raw]) {
    return named[raw];
  }
  const hex = raw.match(/^#?([a-f0-9]{6})$/i);
  if (hex) {
    const value = hex[1];
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16)
    };
  }
  throw new Error("Use a supported color name or #RRGGBB value.");
}

function brightnessValue(input: unknown): number {
  const value = Math.round(Number(input));
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new Error("Brightness must be between 1 and 100.");
  }
  return value;
}

function kelvinValue(input: unknown): number {
  const value = Math.round(Number(input));
  if (!Number.isFinite(value) || value < 2000 || value > 9000) {
    throw new Error("Color temperature must be between 2000K and 9000K.");
  }
  return value;
}

function findVaultDocument(documentId: string): VaultDocumentRecord | null {
  return loadVaultDocuments().find((document) => document.id === documentId) ?? null;
}

function verifiedVaultDocument(documentId: string): VaultDocumentRecord {
  const document = findVaultDocument(documentId);
  if (!document || !existsSync(document.filePath)) {
    throw new Error("Vault document file not found.");
  }
  if (!isPathInside(vaultDocumentsRoot, document.filePath) && !isPathInside(vaultVersionsRoot, document.filePath)) {
    throw new Error("Vault document path is outside DexNest Vault storage.");
  }
  return document;
}

function vaultState(): VaultState {
  const documents = loadVaultDocuments();
  const settings = loadVaultOcrSettings();
  const pythonPath = settings.pythonPath && existsSync(settings.pythonPath) ? settings.pythonPath : resolvePythonPath();
  const runtime = pythonPath ? getPaddleRuntimeInfo(pythonPath) : null;
  return {
    documents,
    categories: vaultCategories,
    documentsPath: vaultDocumentsRoot,
    importsPath: vaultImportsRoot,
    versionsPath: vaultVersionsRoot,
    tempPath: vaultTempRoot,
    metadataPath: vaultDocumentsPath,
    documentCount: documents.length,
    totalSizeBytes: documents.reduce((total, document) => total + document.sizeBytes, 0),
    ocrJobs: loadVaultOcrJobs(),
    ocrSettings: settings,
    ocrOutputPath: vaultOcrRoot,
    ocrJobsPath: vaultOcrJobsPath,
    ocrQueueRunning: vaultOcrQueueRunning,
    ocrQueuePaused: vaultOcrQueuePaused,
    paddleGpuStatus: {
      ok: Boolean(runtime?.ok && runtime.cudaCompiled && runtime.deviceCount > 0),
      message: !pythonPath
        ? "Python path not found."
        : runtime?.ok && runtime.cudaCompiled && runtime.deviceCount > 0
          ? `PaddleOCR GPU ready with ${runtime.deviceCount} GPU${runtime.deviceCount === 1 ? "" : "s"}.`
          : runtime?.error ?? "PaddlePaddle GPU runtime is not available.",
      pythonPath,
      paddleVersion: runtime?.paddleVersion ?? null,
      deviceCount: runtime?.deviceCount ?? 0
    },
    secure: secureVaultState()
  };
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

const allowedCommandShortcuts = new Set(["CommandOrControl+Space", "CommandOrControl+Alt+Space", "CommandOrControl+Shift+Space"]);
const allowedAmbientPushToTalkShortcuts = new Set(["CommandOrControl+Alt+N", "CommandOrControl+Shift+N", "CommandOrControl+Alt+M"]);

function defaultCommandSettings(): CommandSettings {
  return {
    globalShortcutEnabled: true,
    globalShortcut: "CommandOrControl+Space",
    globalShortcutStatus: "disabled",
    globalShortcutLastError: null,
    trayEnabled: true,
    trayStatus: "failed"
  };
}

function normalizeCommandShortcut(value: unknown): string {
  const shortcut = typeof value === "string" ? value : "";
  return allowedCommandShortcuts.has(shortcut) ? shortcut : "CommandOrControl+Space";
}

function loadCommandSettings(): CommandSettings {
  const saved = readJsonFile<Partial<CommandSettings>>(commandSettingsPath, defaultCommandSettings());
  return {
    ...defaultCommandSettings(),
    ...saved,
    globalShortcut: normalizeCommandShortcut(saved.globalShortcut)
  };
}

function saveCommandSettings(settings: CommandSettings): CommandSettings {
  return writeJsonFile(commandSettingsPath, settings);
}

function defaultAmbientVoiceSettings(): AmbientVoiceSettings {
  return {
    ambientVoiceEnabled: false,
    wakeWordEnabled: false,
    wakeWord: "Nest",
    wakeWordEngine: "placeholder",
    wakeWordSensitivity: 0.5,
    listenAfterWakeMs: 8000,
    wakeCooldownMs: 1500,
    // Wake word stays ON even in Performance Mode — it is the always-available entry point.
    pauseWakeWordInPerformanceMode: false,
    playWakeSound: true,
    requireVisibleIndicator: true,
    allowWakeWordWhileLocked: false,
    allowWakeWordDeviceControl: true,
    allowWakeWordSensitiveLookup: false,
    selectedWakeMicDeviceId: null,
    wakePhraseMode: "hey_jarvis",
    wakeCustomModelPath: null,
    pushToTalkEnabled: true,
    pushToTalkShortcut: "CommandOrControl+Alt+N",
    pushToTalkShortcutStatus: "disabled",
    pushToTalkShortcutLastError: null,
    visibleListeningIndicator: true,
    playStartSound: true,
    playStopSound: true,
    autoSendAfterSpeech: true,
    stopListeningAfterCommand: true,
    pauseInPerformanceMode: true,
    allowDeviceControl: true,
    allowClipboardActions: true,
    allowDevActions: true,
    allowSensitiveLookups: true,
    speakResponses: true,
    speakSensitiveAnswers: false,
    speakErrors: true,
    speakConfirmations: true,
    speakWorkflowStatus: true,
    voiceName: null,
    voiceRate: 1,
    voiceVolume: 1,
    shortResponsesOnly: true,
    muteInPerformanceMode: true,
    maxListeningSeconds: 8,
    commandCooldownMs: 1200,
    wakeChimeEnabled: true,
    wakeChimeVolume: 0.35,
    voiceOverlayEnabled: true,
    voiceOverlayScreen: "primary",
    voiceOverlayPosition: "bottom_center",
    voiceOverlaySize: "compact",
    voiceOverlayAnimations: true,
    updatedAt: new Date().toISOString()
  };
}

function normalizeAmbientShortcut(value: unknown): string {
  const shortcut = typeof value === "string" ? value : "";
  return allowedAmbientPushToTalkShortcuts.has(shortcut) ? shortcut : defaultAmbientVoiceSettings().pushToTalkShortcut;
}

let ambientVoiceRuntime: Omit<AmbientVoiceState, "settings" | "settingsPath" | "pausedByPerformanceMode" | "wakeWordStatus"> = {
  currentState: "idle",
  lastRecognizedCommand: "",
  lastActionResult: "",
  lastSource: "system",
  lastChangedAt: new Date().toISOString()
};

function loadAmbientVoiceSettings(): AmbientVoiceSettings {
  const defaults = defaultAmbientVoiceSettings();
  const saved = readJsonFile<Partial<AmbientVoiceSettings>>(ambientVoiceSettingsPath, defaults);
  return {
    ...defaults,
    ...saved,
    wakeWord: typeof saved.wakeWord === "string" && saved.wakeWord.trim() ? saved.wakeWord.trim() : defaults.wakeWord,
    pushToTalkShortcut: normalizeAmbientShortcut(saved.pushToTalkShortcut),
    maxListeningSeconds: Math.min(30, Math.max(3, Number(saved.maxListeningSeconds) || defaults.maxListeningSeconds)),
    commandCooldownMs: Math.min(10000, Math.max(500, Number(saved.commandCooldownMs) || defaults.commandCooldownMs))
  };
}

function ambientPausedByPerformanceMode(settings = loadAmbientVoiceSettings()): boolean {
  return settings.pauseInPerformanceMode && loadPerformanceModeSettings().performanceModeEnabled;
}

function ambientVoiceState(): AmbientVoiceState {
  const settings = loadAmbientVoiceSettings();
  const pausedByPerformanceMode = ambientPausedByPerformanceMode(settings);
  return {
    settingsPath: ambientVoiceSettingsPath,
    settings,
    ...ambientVoiceRuntime,
    currentState: pausedByPerformanceMode ? "paused" : ambientVoiceRuntime.currentState,
    pausedByPerformanceMode,
    wakeWordStatus: settings.wakeWordEnabled ? "placeholder" : "disabled"
  };
}

function saveAmbientVoiceSettings(input: Partial<AmbientVoiceSettings>, source: DexNestActionTrigger | "system" = "module_ui"): AmbientVoiceSettings {
  const current = loadAmbientVoiceSettings();
  const next: AmbientVoiceSettings = {
    ...current,
    ambientVoiceEnabled: typeof input.ambientVoiceEnabled === "boolean" ? input.ambientVoiceEnabled : current.ambientVoiceEnabled,
    wakeWordEnabled: typeof input.wakeWordEnabled === "boolean" ? input.wakeWordEnabled : current.wakeWordEnabled,
    wakeWord: typeof input.wakeWord === "string" && input.wakeWord.trim() ? input.wakeWord.trim() : current.wakeWord,
    wakeWordEngine: input.wakeWordEngine ?? current.wakeWordEngine ?? "placeholder",
    wakeWordSensitivity: Math.min(1, Math.max(0, Number(input.wakeWordSensitivity ?? current.wakeWordSensitivity ?? 0.5))),
    listenAfterWakeMs: Math.min(20000, Math.max(2000, Number(input.listenAfterWakeMs ?? current.listenAfterWakeMs ?? 8000))),
    wakeCooldownMs: Math.min(10000, Math.max(0, Number(input.wakeCooldownMs ?? current.wakeCooldownMs ?? 1500))),
    pauseWakeWordInPerformanceMode: typeof input.pauseWakeWordInPerformanceMode === "boolean" ? input.pauseWakeWordInPerformanceMode : (current.pauseWakeWordInPerformanceMode ?? true),
    playWakeSound: typeof input.playWakeSound === "boolean" ? input.playWakeSound : (current.playWakeSound ?? true),
    requireVisibleIndicator: typeof input.requireVisibleIndicator === "boolean" ? input.requireVisibleIndicator : (current.requireVisibleIndicator ?? true),
    allowWakeWordWhileLocked: typeof input.allowWakeWordWhileLocked === "boolean" ? input.allowWakeWordWhileLocked : (current.allowWakeWordWhileLocked ?? false),
    allowWakeWordDeviceControl: typeof input.allowWakeWordDeviceControl === "boolean" ? input.allowWakeWordDeviceControl : (current.allowWakeWordDeviceControl ?? true),
    allowWakeWordSensitiveLookup: typeof input.allowWakeWordSensitiveLookup === "boolean" ? input.allowWakeWordSensitiveLookup : (current.allowWakeWordSensitiveLookup ?? false),
    selectedWakeMicDeviceId: input.selectedWakeMicDeviceId === undefined ? (current.selectedWakeMicDeviceId ?? null) : (input.selectedWakeMicDeviceId || null),
    wakePhraseMode: input.wakePhraseMode === "custom_nest" || input.wakePhraseMode === "hey_jarvis" || input.wakePhraseMode === "alexa" || input.wakePhraseMode === "custom_path" ? input.wakePhraseMode : (current.wakePhraseMode ?? "hey_jarvis"),
    wakeCustomModelPath: input.wakeCustomModelPath === undefined ? (current.wakeCustomModelPath ?? null) : (input.wakeCustomModelPath || null),
    pushToTalkEnabled: typeof input.pushToTalkEnabled === "boolean" ? input.pushToTalkEnabled : current.pushToTalkEnabled,
    pushToTalkShortcut: normalizeAmbientShortcut(input.pushToTalkShortcut ?? current.pushToTalkShortcut),
    visibleListeningIndicator: typeof input.visibleListeningIndicator === "boolean" ? input.visibleListeningIndicator : current.visibleListeningIndicator,
    playStartSound: typeof input.playStartSound === "boolean" ? input.playStartSound : current.playStartSound,
    playStopSound: typeof input.playStopSound === "boolean" ? input.playStopSound : current.playStopSound,
    autoSendAfterSpeech: typeof input.autoSendAfterSpeech === "boolean" ? input.autoSendAfterSpeech : current.autoSendAfterSpeech,
    stopListeningAfterCommand: typeof input.stopListeningAfterCommand === "boolean" ? input.stopListeningAfterCommand : current.stopListeningAfterCommand,
    pauseInPerformanceMode: typeof input.pauseInPerformanceMode === "boolean" ? input.pauseInPerformanceMode : current.pauseInPerformanceMode,
    allowDeviceControl: typeof input.allowDeviceControl === "boolean" ? input.allowDeviceControl : current.allowDeviceControl,
    allowClipboardActions: typeof input.allowClipboardActions === "boolean" ? input.allowClipboardActions : current.allowClipboardActions,
    allowDevActions: typeof input.allowDevActions === "boolean" ? input.allowDevActions : current.allowDevActions,
    allowSensitiveLookups: typeof input.allowSensitiveLookups === "boolean" ? input.allowSensitiveLookups : current.allowSensitiveLookups,
    speakResponses: typeof input.speakResponses === "boolean" ? input.speakResponses : current.speakResponses,
    speakErrors: typeof input.speakErrors === "boolean" ? input.speakErrors : (current.speakErrors ?? true),
    speakConfirmations: typeof input.speakConfirmations === "boolean" ? input.speakConfirmations : (current.speakConfirmations ?? true),
    speakWorkflowStatus: typeof input.speakWorkflowStatus === "boolean" ? input.speakWorkflowStatus : (current.speakWorkflowStatus ?? true),
    speakSensitiveAnswers: typeof input.speakSensitiveAnswers === "boolean" ? input.speakSensitiveAnswers : current.speakSensitiveAnswers,
    voiceName: typeof input.voiceName === "string" && input.voiceName.trim() ? input.voiceName.trim() : null,
    voiceRate: Math.min(2, Math.max(0.5, Number.isFinite(Number(input.voiceRate ?? current.voiceRate)) ? Number(input.voiceRate ?? current.voiceRate) : (current.voiceRate || 1))),
    voiceVolume: Math.min(1, Math.max(0, Number.isFinite(Number(input.voiceVolume ?? current.voiceVolume)) ? Number(input.voiceVolume ?? current.voiceVolume) : (current.voiceVolume ?? 1))),
    shortResponsesOnly: typeof input.shortResponsesOnly === "boolean" ? input.shortResponsesOnly : current.shortResponsesOnly,
    muteInPerformanceMode: typeof input.muteInPerformanceMode === "boolean" ? input.muteInPerformanceMode : current.muteInPerformanceMode,
    maxListeningSeconds: Math.min(30, Math.max(3, Number(input.maxListeningSeconds ?? current.maxListeningSeconds) || current.maxListeningSeconds)),
    commandCooldownMs: Math.min(10000, Math.max(500, Number(input.commandCooldownMs ?? current.commandCooldownMs) || current.commandCooldownMs)),
    wakeChimeEnabled: typeof input.wakeChimeEnabled === "boolean" ? input.wakeChimeEnabled : (current.wakeChimeEnabled ?? true),
    wakeChimeVolume: Math.min(1, Math.max(0, Number(input.wakeChimeVolume ?? current.wakeChimeVolume ?? 0.35))),
    voiceOverlayEnabled: typeof input.voiceOverlayEnabled === "boolean" ? input.voiceOverlayEnabled : (current.voiceOverlayEnabled ?? true),
    voiceOverlayScreen: typeof input.voiceOverlayScreen === "string" ? input.voiceOverlayScreen : (current.voiceOverlayScreen ?? "primary"),
    voiceOverlayPosition: typeof input.voiceOverlayPosition === "string" ? input.voiceOverlayPosition : (current.voiceOverlayPosition ?? "bottom_center"),
    voiceOverlaySize: input.voiceOverlaySize === "normal" || input.voiceOverlaySize === "compact" ? input.voiceOverlaySize : (current.voiceOverlaySize ?? "compact"),
    voiceOverlayAnimations: typeof input.voiceOverlayAnimations === "boolean" ? input.voiceOverlayAnimations : (current.voiceOverlayAnimations ?? true),
    pushToTalkShortcutStatus: current.pushToTalkShortcutStatus,
    pushToTalkShortcutLastError: current.pushToTalkShortcutLastError,
    updatedAt: new Date().toISOString()
  };
  const saved = writeJsonFile(ambientVoiceSettingsPath, next);
  registerAmbientVoiceShortcut();
  createDexNestTray();
  // Hide the desktop overlay immediately if it was turned off.
  if (!(saved.voiceOverlayEnabled ?? true)) { hideVoiceOverlay(); }
  // Restart the wake engine on enable/sensitivity/mic changes (or stop it).
  reconcileWakeEngine();
  localDb.appendActionEvent({
    module: "DexNest Voice",
    actionId: "voice.ambient.update_settings",
    eventType: "ambient_voice_settings_updated",
    status: "success",
    source,
    summary: "Updated DexNest Ambient Voice settings.",
    metadataJson: {
      ambientVoiceEnabled: saved.ambientVoiceEnabled,
      wakeWordEnabled: saved.wakeWordEnabled,
      pushToTalkEnabled: saved.pushToTalkEnabled,
      pushToTalkShortcut: saved.pushToTalkShortcut,
      speakResponses: saved.speakResponses,
      speakSensitiveAnswers: saved.speakSensitiveAnswers,
      shortResponsesOnly: saved.shortResponsesOnly,
      muteInPerformanceMode: saved.muteInPerformanceMode
    }
  });
  return saved;
}

function updateAmbientVoiceRuntime(input: Partial<Pick<AmbientVoiceState, "currentState" | "lastRecognizedCommand" | "lastActionResult" | "lastSource">>, source: DexNestActionTrigger | "system" = "system"): AmbientVoiceState {
  const settings = loadAmbientVoiceSettings();
  const command = typeof input.lastRecognizedCommand === "string" ? input.lastRecognizedCommand.trim() : ambientVoiceRuntime.lastRecognizedCommand;
  const isSensitive = /\b(sin|social insurance|passport|health card|work permit|permit number|document number|uci|api[_ -]?key|token|secret)\b/i.test(command);
  ambientVoiceRuntime = {
    currentState: input.currentState ?? ambientVoiceRuntime.currentState,
    lastRecognizedCommand: isSensitive ? "[sensitive command hidden]" : command,
    lastActionResult: typeof input.lastActionResult === "string" ? input.lastActionResult.slice(0, 180) : ambientVoiceRuntime.lastActionResult,
    lastSource: input.lastSource ?? source,
    lastChangedAt: new Date().toISOString()
  };
  return {
    settingsPath: ambientVoiceSettingsPath,
    settings,
    ...ambientVoiceRuntime,
    pausedByPerformanceMode: ambientPausedByPerformanceMode(settings),
    wakeWordStatus: settings.wakeWordEnabled ? "placeholder" : "disabled"
  };
}

function defaultKeyboardShortcutSettings(): KeyboardShortcutSettings {
  return {
    enabled: true,
    updatedAt: new Date().toISOString(),
    mappings: [
      {
        id: "shortcut-open-command",
        label: "Open Command",
        shortcut: "CommandOrControl+Space",
        targetType: "action",
        actionId: "command.open_palette",
        enabled: false,
        allowDangerous: false,
        status: "disabled",
        lastError: "DexNest Command uses the dedicated Global Command shortcut setting."
      },
      {
        id: "shortcut-ask-dexnest",
        label: "Ask DexNest",
        shortcut: "CommandOrControl+Alt+A",
        targetType: "action",
        actionId: "search.open",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-performance-toggle",
        label: "Toggle Performance Mode",
        shortcut: "CommandOrControl+Alt+P",
        targetType: "action",
        actionId: "system.performance.toggle",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-send-clipboard-phone",
        label: "Send clipboard to phone",
        shortcut: "CommandOrControl+Alt+S",
        targetType: "action",
        actionId: "drop.send_clipboard_to_drop",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-lock-sensitive",
        label: "Lock sensitive session",
        shortcut: "CommandOrControl+Alt+L",
        targetType: "action",
        actionId: "system.lifecycle.lock_sensitive_session",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-paste-plain",
        label: "Paste as plain text",
        shortcut: "CommandOrControl+Alt+V",
        targetType: "action",
        actionId: "clipboard.copy_plain_text",
        enabled: false,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-save-clipboard-slot-1",
        label: "Save Clipboard Slot 1",
        shortcut: "CommandOrControl+Shift+1",
        targetType: "action",
        actionId: "clipboard.slot1.save_current",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-save-clipboard-slot-2",
        label: "Save Clipboard Slot 2",
        shortcut: "CommandOrControl+Shift+2",
        targetType: "action",
        actionId: "clipboard.slot2.save_current",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-save-clipboard-slot-3",
        label: "Save Clipboard Slot 3",
        shortcut: "CommandOrControl+Shift+3",
        targetType: "action",
        actionId: "clipboard.slot3.save_current",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-paste-clipboard-slot-1",
        label: "Paste Clipboard Slot 1",
        shortcut: "CommandOrControl+Alt+1",
        targetType: "action",
        actionId: "clipboard.slot1.paste",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-paste-clipboard-slot-2",
        label: "Paste Clipboard Slot 2",
        shortcut: "CommandOrControl+Alt+2",
        targetType: "action",
        actionId: "clipboard.slot2.paste",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      },
      {
        id: "shortcut-paste-clipboard-slot-3",
        label: "Paste Clipboard Slot 3",
        shortcut: "CommandOrControl+Alt+3",
        targetType: "action",
        actionId: "clipboard.slot3.paste",
        enabled: true,
        allowDangerous: false,
        status: "disabled",
        lastError: null
      }
    ]
  };
}

function defaultStreamDeckSettings(): StreamDeckSettings {
  return {
    localOnly: true,
    lanEnabled: false,
    tokenEnabled: false,
    token: "",
    updatedAt: new Date().toISOString()
  };
}

function loadKeyboardShortcutSettings(): KeyboardShortcutSettings {
  const saved = readJsonFile<Partial<KeyboardShortcutSettings>>(keyboardShortcutsPath, defaultKeyboardShortcutSettings());
  const defaults = defaultKeyboardShortcutSettings();
  const savedMappings = Array.isArray(saved.mappings) ? saved.mappings : [];
  const mappingById = new Map(savedMappings.map((mapping) => [mapping.id, mapping]));
  const defaultIds = new Set(defaults.mappings.map((mapping) => mapping.id));
  const mappings = [
    ...defaults.mappings.map((mapping) => ({ ...mapping, ...(mappingById.get(mapping.id) ?? {}) })),
    ...savedMappings.filter((mapping) => !defaultIds.has(mapping.id))
  ].map((mapping) => ({
    ...mapping,
    shortcut: String(mapping.shortcut ?? ""),
    targetType: mapping.targetType === "routine" ? "routine" as const : "action" as const,
    enabled: Boolean(mapping.enabled),
    allowDangerous: Boolean(mapping.allowDangerous),
    status: mapping.status ?? "disabled",
    lastError: mapping.lastError ?? null
  }));
  return {
    enabled: typeof saved.enabled === "boolean" ? saved.enabled : defaults.enabled,
    mappings,
    updatedAt: saved.updatedAt ?? defaults.updatedAt
  };
}

function saveKeyboardShortcutSettings(settings: KeyboardShortcutSettings): KeyboardShortcutSettings {
  const saved = writeJsonFile(keyboardShortcutsPath, { ...settings, updatedAt: new Date().toISOString() });
  registerKeyboardShortcuts();
  return saved;
}

function loadStreamDeckSettings(): StreamDeckSettings {
  return {
    ...defaultStreamDeckSettings(),
    ...readJsonFile<Partial<StreamDeckSettings>>(streamDeckSettingsPath, defaultStreamDeckSettings())
  };
}

function saveStreamDeckSettings(input: Partial<StreamDeckSettings>): StreamDeckSettings {
  const current = loadStreamDeckSettings();
  const next: StreamDeckSettings = {
    localOnly: true,
    lanEnabled: typeof input.lanEnabled === "boolean" ? input.lanEnabled : current.lanEnabled,
    tokenEnabled: typeof input.tokenEnabled === "boolean" ? input.tokenEnabled : current.tokenEnabled,
    token: typeof input.token === "string" && input.token.trim() !== "set" ? input.token.trim() : current.token,
    updatedAt: new Date().toISOString()
  };
  return writeJsonFile(streamDeckSettingsPath, next);
}

function shortcutConflictDetails(settings = loadKeyboardShortcutSettings()): string[] {
  const conflicts: string[] = [];
  const seen = new Map<string, string>();
  for (const mapping of settings.mappings.filter((item) => item.enabled && item.shortcut.trim())) {
    const normalized = mapping.shortcut.trim();
    if (normalizeCommandShortcut(normalized) === normalized && loadCommandSettings().globalShortcutEnabled && loadCommandSettings().globalShortcut === normalized) {
      conflicts.push(`${mapping.label} conflicts with DexNest Command shortcut.`);
    }
    if (loadClipboardSettings().multiCopyHotkeyEnabled && loadClipboardSettings().multiCopyHotkey === normalized) {
      conflicts.push(`${mapping.label} conflicts with Clipboard multi-copy hotkey.`);
    }
    if (loadAmbientVoiceSettings().pushToTalkEnabled && loadAmbientVoiceSettings().pushToTalkShortcut === normalized) {
      conflicts.push(`${mapping.label} conflicts with Ambient Voice push-to-talk.`);
    }
    const existing = seen.get(normalized);
    if (existing) {
      conflicts.push(`${mapping.label} conflicts with ${existing}.`);
    }
    seen.set(normalized, mapping.label);
  }
  return conflicts;
}

function defaultAppLifecycleSettings(): AppLifecycleSettings {
  return {
    closeBehavior: "ask",
    showTrayCloseNotice: true,
    minimizeToTrayOnStartup: false,
    startDexNestWithWindows: false,
    startMinimizedToTray: true,
    loginItemStatus: "disabled",
    loginItemLastError: null,
    updatedAt: new Date().toISOString()
  };
}

function normalizeCloseBehavior(value: unknown): AppCloseBehavior {
  return value === "minimize_to_tray" || value === "exit" || value === "ask" ? value : "ask";
}

function loadAppLifecycleSettings(): AppLifecycleSettings {
  const saved = readJsonFile<Partial<AppLifecycleSettings>>(appLifecycleSettingsPath, defaultAppLifecycleSettings());
  return {
    ...defaultAppLifecycleSettings(),
    ...saved,
    closeBehavior: normalizeCloseBehavior(saved.closeBehavior)
  };
}

function currentLoginItemStatus(): Pick<AppLifecycleSettings, "loginItemStatus" | "loginItemLastError"> {
  try {
    const status = app.getLoginItemSettings();
    return {
      loginItemStatus: status.openAtLogin ? "enabled" : "disabled",
      loginItemLastError: null
    };
  } catch (error) {
    return {
      loginItemStatus: "failed",
      loginItemLastError: error instanceof Error ? error.message : "Could not read Windows startup registration."
    };
  }
}

function applyLoginItemSettings(settings: AppLifecycleSettings): AppLifecycleSettings {
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.startDexNestWithWindows,
      openAsHidden: settings.startDexNestWithWindows && settings.startMinimizedToTray,
      args: settings.startDexNestWithWindows && settings.startMinimizedToTray ? ["--hidden"] : []
    });
    const status = currentLoginItemStatus();
    return {
      ...settings,
      ...status,
      loginItemStatus: settings.startDexNestWithWindows && status.loginItemStatus !== "enabled" ? "failed" : status.loginItemStatus,
      loginItemLastError: settings.startDexNestWithWindows && status.loginItemStatus !== "enabled" ? "Windows did not report DexNest as registered for startup." : status.loginItemLastError
    };
  } catch (error) {
    return {
      ...settings,
      loginItemStatus: "failed",
      loginItemLastError: error instanceof Error ? error.message : "Could not update Windows startup registration."
    };
  }
}

function saveAppLifecycleSettings(input: Partial<AppLifecycleSettings>, source: DexNestActionTrigger | "system" = "module_ui"): AppLifecycleSettings {
  const current = loadAppLifecycleSettings();
  const next: AppLifecycleSettings = {
    ...current,
    closeBehavior: normalizeCloseBehavior(input.closeBehavior ?? current.closeBehavior),
    showTrayCloseNotice: typeof input.showTrayCloseNotice === "boolean" ? input.showTrayCloseNotice : current.showTrayCloseNotice,
    minimizeToTrayOnStartup: typeof input.minimizeToTrayOnStartup === "boolean" ? input.minimizeToTrayOnStartup : current.minimizeToTrayOnStartup,
    startDexNestWithWindows: typeof input.startDexNestWithWindows === "boolean" ? input.startDexNestWithWindows : current.startDexNestWithWindows,
    startMinimizedToTray: typeof input.startMinimizedToTray === "boolean" ? input.startMinimizedToTray : current.startMinimizedToTray,
    updatedAt: new Date().toISOString()
  };
  const withLoginStatus = applyLoginItemSettings(next);
  const saved = writeJsonFile(appLifecycleSettingsPath, withLoginStatus);
  localDb.appendActionEvent({
    module: "DexNest System",
    actionId: "system.lifecycle.update_settings",
    eventType: "app_lifecycle_settings_updated",
    status: saved.loginItemStatus === "failed" ? "failed" : "success",
    source,
    summary: "Updated DexNest startup and tray lifecycle settings.",
    metadataJson: {
      closeBehavior: saved.closeBehavior,
      startDexNestWithWindows: saved.startDexNestWithWindows,
      startMinimizedToTray: saved.startMinimizedToTray,
      loginItemStatus: saved.loginItemStatus
    },
    errorMessage: saved.loginItemLastError
  });
  return saved;
}

function appLifecycleState(): AppLifecycleSettings & { trayAvailable: boolean; trayModeActive: boolean } {
  const settings = loadAppLifecycleSettings();
  const loginStatus = currentLoginItemStatus();
  const normalizedLoginStatus = settings.startDexNestWithWindows && loginStatus.loginItemStatus !== "enabled"
    ? { loginItemStatus: "failed" as const, loginItemLastError: loginStatus.loginItemLastError ?? "Windows did not report DexNest as registered for startup." }
    : loginStatus;
  return {
    ...settings,
    ...normalizedLoginStatus,
    trayAvailable: Boolean(tray),
    trayModeActive
  };
}

function defaultPerformanceModeSettings(): PerformanceModeSettings {
  return {
    performanceModeEnabled: false,
    pauseHeatmap: true,
    pauseOcrJobs: true,
    pauseSearchAutoIndex: true,
    pauseBackups: true,
    suppressNonUrgentNudges: true,
    allowDropWhenOpen: true,
    allowUserTriggeredAssistant: true,
    autoEnableWhenFullscreen: false,
    autoEnableWhenGameDetected: false,
    showTrayStatus: true
  };
}

let performanceModeRuntime: PerformanceModeState = {
  enabled: false,
  reason: "unknown",
  enabledAt: null,
  pausedWorkers: [],
  lastChangedAt: new Date().toISOString()
};

function loadPerformanceModeSettings(): PerformanceModeSettings {
  return {
    ...defaultPerformanceModeSettings(),
    ...readJsonFile<Partial<PerformanceModeSettings>>(performanceModeSettingsPath, defaultPerformanceModeSettings())
  };
}

function pausedWorkersForPerformance(settings = loadPerformanceModeSettings()): string[] {
  if (!settings.performanceModeEnabled) {
    return [];
  }
  return [
    settings.pauseHeatmap ? "heatmap" : null,
    settings.pauseOcrJobs ? "vault_ocr" : null,
    settings.pauseSearchAutoIndex ? "search_auto_index" : null,
    settings.pauseBackups ? "scheduled_backups" : null,
    settings.suppressNonUrgentNudges ? "non_urgent_nudges" : null,
    settings.allowUserTriggeredAssistant ? null : "assistant_ollama"
  ].filter((item): item is string => Boolean(item));
}

function performanceModeState(): PerformanceModeState {
  const settings = loadPerformanceModeSettings();
  performanceModeRuntime = {
    ...performanceModeRuntime,
    enabled: settings.performanceModeEnabled,
    pausedWorkers: pausedWorkersForPerformance(settings)
  };
  if (!settings.performanceModeEnabled) {
    performanceModeRuntime.enabledAt = null;
  } else if (!performanceModeRuntime.enabledAt) {
    performanceModeRuntime.enabledAt = new Date().toISOString();
  }
  return performanceModeRuntime;
}

function savePerformanceModeSettings(input: Partial<PerformanceModeSettings>): PerformanceModeSettings {
  const current = loadPerformanceModeSettings();
  const nextInput: PerformanceModeSettings = { ...current };
  for (const key of Object.keys(defaultPerformanceModeSettings()) as Array<keyof PerformanceModeSettings>) {
    if (typeof input[key] === "boolean") {
      nextInput[key] = input[key] as boolean;
    }
  }
  const next = writeJsonFile<PerformanceModeSettings>(performanceModeSettingsPath, nextInput);
  performanceModeRuntime = {
    enabled: next.performanceModeEnabled,
    reason: performanceModeRuntime.reason,
    enabledAt: next.performanceModeEnabled ? performanceModeRuntime.enabledAt ?? new Date().toISOString() : null,
    pausedWorkers: pausedWorkersForPerformance(next),
    lastChangedAt: new Date().toISOString()
  };
  return next;
}

function setPerformanceModeEnabled(enabled: boolean, reason: PerformanceModeReason = "manual", source: DexNestActionTrigger | "system" = "module_ui"): { settings: PerformanceModeSettings; state: PerformanceModeState } {
  const startedAt = Date.now();
  const settings = savePerformanceModeSettings({ performanceModeEnabled: enabled });
  performanceModeRuntime = {
    enabled,
    reason,
    enabledAt: enabled ? new Date().toISOString() : null,
    pausedWorkers: pausedWorkersForPerformance(settings),
    lastChangedAt: new Date().toISOString()
  };
  if (settings.pauseHeatmap) {
    startHeatmapTimer();
  }
  if (!enabled) {
    vaultOcrQueuePaused = false;
    void processVaultOcrQueue("system");
  }
  registerAmbientVoiceShortcut();
  createDexNestTray();
  localDb.appendActionEvent({
    module: "DexNest System",
    actionId: "system.performance.set_enabled",
    eventType: enabled ? "performance_mode_enabled" : "performance_mode_disabled",
    status: "success",
    source: source === "system" ? "system" : source,
    summary: `Performance Mode ${enabled ? "enabled" : "disabled"}.`,
    metadataJson: { enabled, reason, pausedWorkers: performanceModeRuntime.pausedWorkers },
    durationMs: Date.now() - startedAt
  });
  return { settings, state: performanceModeState() };
}

function performanceModePauses(worker: "heatmap" | "ocr" | "search_auto_index" | "backups" | "assistant" | "nudges"): boolean {
  const settings = loadPerformanceModeSettings();
  if (!settings.performanceModeEnabled) {
    return false;
  }
  if (worker === "heatmap") {
    return settings.pauseHeatmap;
  }
  if (worker === "ocr") {
    return settings.pauseOcrJobs;
  }
  if (worker === "search_auto_index") {
    return settings.pauseSearchAutoIndex;
  }
  if (worker === "backups") {
    return settings.pauseBackups;
  }
  if (worker === "assistant") {
    return !settings.allowUserTriggeredAssistant;
  }
  return settings.suppressNonUrgentNudges;
}

function defaultSearchIndexStatus(): SearchIndexStatus {
  return {
    staleDueToPerformanceMode: false,
    staleReason: null,
    staleSince: null,
    lastSkippedAutoIndexAt: null
  };
}

function loadSearchIndexStatus(): SearchIndexStatus {
  return {
    ...defaultSearchIndexStatus(),
    ...readJsonFile<Partial<SearchIndexStatus>>(searchIndexStatusPath, defaultSearchIndexStatus())
  };
}

function saveSearchIndexStatus(status: SearchIndexStatus): SearchIndexStatus {
  return writeJsonFile<SearchIndexStatus>(searchIndexStatusPath, status);
}

function markSearchIndexStale(reason: string): void {
  const now = new Date().toISOString();
  const current = loadSearchIndexStatus();
  saveSearchIndexStatus({
    staleDueToPerformanceMode: true,
    staleReason: reason,
    staleSince: current.staleSince ?? now,
    lastSkippedAutoIndexAt: now
  });
  localDb.appendActionEvent({
    module: "DexNest Search",
    actionId: "search.auto_index.skipped",
    eventType: "search_auto_index_skipped",
    status: "skipped",
    source: "system",
    summary: "Skipped automatic Search index rebuild because Performance Mode is active.",
    metadataJson: { reason }
  });
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

function defaultClipboardSettings(): ClipboardSettings {
  return {
    listenerEnabled: false,
    listenerIntervalMs: 2000,
    historyRetentionDays: 1,
    lastHistoryCleanupAt: null,
    multiCopyHotkeyEnabled: true,
    multiCopyHotkey: "CommandOrControl+Shift+C",
    multiCopyHotkeyStatus: "disabled",
    multiCopyHotkeyLastError: null,
    multiCopyAutoClearMinutes: 15,
    multiCopyLastHotkeyAt: null,
    multiCopyLastHotkeyStatus: "idle",
    multiCopyLastHotkeyMessage: "",
    lastCaptureAt: null,
    lastCapturedPreview: "",
    lastReadAt: null,
    lastReadPreview: "",
    lastReadError: null,
    combinedSeparator: "\n\n",
    activeMultiCopySession: null,
    appExclusionRules: [],
    secretProtectionEnabled: true,
    slotSequenceEnabled: false,
    slotSequenceStatus: "disabled",
    slotSequenceLastError: null,
    slotSequenceWindowMs: 700
  };
}

function loadClipboardSettings(): ClipboardSettings {
  return {
    ...defaultClipboardSettings(),
    ...readJsonFile<Partial<ClipboardSettings>>(clipboardSettingsPath, defaultClipboardSettings())
  };
}

function saveClipboardSettings(settings: ClipboardSettings): ClipboardSettings {
  return writeJsonFile(clipboardSettingsPath, settings);
}

function loadClipboardActiveMultiCopySession(): ClipboardActiveMultiCopySession | null {
  const activeSession = readJsonFile<ClipboardActiveMultiCopySession | null>(clipboardActiveMultiCopyPath, null);
  if (activeSession?.id && Array.isArray(activeSession.items)) {
    return {
      ...activeSession,
      updatedAt: activeSession.updatedAt ?? activeSession.startedAt
    };
  }

  const legacySession = loadClipboardSettings().activeMultiCopySession;
  if (legacySession?.id && Array.isArray(legacySession.items)) {
    const migratedSession: ClipboardActiveMultiCopySession = {
      ...legacySession,
      updatedAt: legacySession.startedAt
    };
    saveClipboardActiveMultiCopySession(migratedSession);
    saveClipboardSettings({ ...loadClipboardSettings(), activeMultiCopySession: null });
    return migratedSession;
  }

  return null;
}

function saveClipboardActiveMultiCopySession(session: ClipboardActiveMultiCopySession | null): ClipboardActiveMultiCopySession | null {
  writeJsonFile(clipboardActiveMultiCopyPath, session);
  scheduleActiveMultiCopyAutoClear();
  return session;
}

function loadClipboardMultiGroups(): ClipboardMultiGroup[] {
  return readJsonFile<ClipboardMultiGroup[]>(clipboardMultiGroupsPath, []);
}

function saveClipboardMultiGroups(groups: ClipboardMultiGroup[]): ClipboardMultiGroup[] {
  return writeJsonFile(clipboardMultiGroupsPath, groups.slice(0, 50));
}

function defaultClipboardSlots(): ClipboardSlot[] {
  return Array.from({ length: 5 }, (_item, index) => ({
    slot: index + 1,
    slotId: index + 1,
    type: "text",
    value: "",
    text: "",
    preview: "",
    byteLength: 0,
    createdAt: "",
    updatedAt: "",
    source: "clipboard_ui"
  }));
}

function loadClipboardSlots(): ClipboardSlot[] {
  const savedSlots = readJsonFile<ClipboardSlot[]>(clipboardSlotsPath, defaultClipboardSlots());
  const savedSlotByNumber = new Map(savedSlots.map((slot) => [slot.slot, slot]));
  return defaultClipboardSlots().map((slot) => {
    const saved = savedSlotByNumber.get(slot.slot);
    if (!saved) {
      return slot;
    }
    const text = typeof saved.value === "string" ? saved.value : saved.text;
    return {
      ...slot,
      ...saved,
      slot: slot.slot,
      slotId: slot.slot,
      type: "text",
      value: text,
      text,
      preview: saved.preview || previewText(text),
      byteLength: saved.byteLength || byteLength(text),
      createdAt: saved.createdAt ?? saved.updatedAt ?? "",
      updatedAt: saved.updatedAt ?? "",
      source: saved.source ?? "clipboard_ui"
    };
  });
}

function saveClipboardSlots(slots: ClipboardSlot[]): ClipboardSlot[] {
  const normalized = defaultClipboardSlots().map((slot) => {
    const saved = slots.find((item) => item.slot === slot.slot) ?? slot;
    const text = typeof saved.value === "string" ? saved.value : saved.text;
    return {
      ...slot,
      ...saved,
      slot: slot.slot,
      slotId: slot.slot,
      type: "text" as const,
      value: text,
      text,
      preview: saved.preview || previewText(text),
      byteLength: saved.byteLength || byteLength(text),
      createdAt: saved.createdAt ?? saved.updatedAt ?? "",
      updatedAt: saved.updatedAt ?? "",
      source: saved.source ?? "clipboard_ui"
    };
  });
  return writeJsonFile(clipboardSlotsPath, normalized);
}

function slotSourceFor(source: DexNestActionTrigger): ClipboardSlot["source"] {
  if (source === "keyboard_shortcut") {
    return "keyboard_shortcut";
  }
  if (source === "command" || source === "deck" || source === "routine" || source === "stream_deck_http") {
    return "command";
  }
  return "clipboard_ui";
}

function slotNumberFromAction(actionId: string, params: Record<string, unknown>): number {
  const directSlot = Number(params.slot);
  if (Number.isInteger(directSlot)) {
    return directSlot;
  }
  const match = /^clipboard\.slot([1-3])\./.exec(actionId);
  return match ? Number(match[1]) : Number.NaN;
}

function isProtectedClipboardText(text: string): boolean {
  return Boolean(secureVaultProtectedClipboardValue && text === secureVaultProtectedClipboardValue);
}

function makeClipboardHistoryItem(text: string, sourceName: ClipboardHistoryItem["source"] = "manual"): ClipboardHistoryItem {
  return {
    id: createId("clip"),
    text,
    preview: previewText(text),
    byteLength: byteLength(text),
    createdAt: new Date().toISOString(),
    source: sourceName
  };
}

function saveClipboardText(text: string, sourceName: ClipboardHistoryItem["source"]): { ok: boolean; item?: ClipboardHistoryItem; reason?: string } {
  if (!text.trim()) {
    return { ok: false, reason: "empty" };
  }

  if (isProtectedClipboardText(text)) {
    return { ok: false, reason: "secure_vault" };
  }

  const history = loadClipboardHistory();
  if (history[0]?.text === text) {
    return { ok: false, reason: "duplicate" };
  }

  const item = makeClipboardHistoryItem(text, sourceName);
  saveClipboardHistory([item, ...history.filter((historyItem) => historyItem.text !== text)]);

  const settings = loadClipboardSettings();
  saveClipboardSettings({
    ...settings,
    lastCaptureAt: item.createdAt,
    lastCapturedPreview: item.preview,
    lastReadError: null
  });

  return { ok: true, item };
}

function cleanupClipboardHistory(force = false, source: DexNestActionTrigger | "system" = "system"): { removedCount: number; skipped: boolean } {
  const settings = loadClipboardSettings();
  const today = getLocalTodayDateString();
  const lastCleanupDay = settings.lastHistoryCleanupAt ? toLocalDateInputValue(new Date(settings.lastHistoryCleanupAt)) : "";
  if (!force && lastCleanupDay === today) {
    return { removedCount: 0, skipped: true };
  }

  if (settings.historyRetentionDays === "never") {
    saveClipboardSettings({ ...settings, lastHistoryCleanupAt: new Date().toISOString() });
    localDb.appendActionEvent({
      module: "clipboard",
      actionId: "clipboard.cleanup_history",
      eventType: "clipboard_history_cleanup",
      status: "skipped",
      source,
      summary: "Clipboard history cleanup skipped because retention is set to never.",
      metadataJson: { retentionDays: "never", removedCount: 0 }
    });
    return { removedCount: 0, skipped: true };
  }

  const retentionMs = Number(settings.historyRetentionDays) * 24 * 60 * 60 * 1000;
  const cutoffMs = Date.now() - retentionMs;
  const history = loadClipboardHistory();
  const retained = history.filter((item) => new Date(item.createdAt).getTime() >= cutoffMs);
  const removedCount = history.length - retained.length;
  if (removedCount > 0) {
    saveClipboardHistory(retained);
  }
  saveClipboardSettings({ ...loadClipboardSettings(), lastHistoryCleanupAt: new Date().toISOString() });
  localDb.appendActionEvent({
    module: "clipboard",
    actionId: "clipboard.cleanup_history",
    eventType: "clipboard_history_cleanup",
    status: "success",
    source,
    summary: `Clipboard history cleanup removed ${removedCount} item${removedCount === 1 ? "" : "s"}.`,
    metadataJson: { retentionDays: settings.historyRetentionDays, removedCount }
  });
  return { removedCount, skipped: false };
}

function clipboardProtectedError(): string {
  return "Protected secret skipped.";
}

function combinedClipboardText(items: ClipboardHistoryItem[], separator: string): string {
  return items.map((item) => item.text).filter((text) => text.trim()).join(separator);
}

function notifyClipboardHotkey(message: string, tone: "success" | "error" = "success"): void {
  mainWindow?.webContents.send("dexnest:clipboard-hotkey-result", { message, tone });
}

function updateClipboardHotkeyStatus(status: ClipboardSettings["multiCopyLastHotkeyStatus"], message: string): void {
  saveClipboardSettings({
    ...loadClipboardSettings(),
    multiCopyLastHotkeyAt: new Date().toISOString(),
    multiCopyLastHotkeyStatus: status,
    multiCopyLastHotkeyMessage: message
  });
}

function flushPendingOpenView(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || !rendererReady || !pendingOpenView) {
    return;
  }
  const payload = pendingOpenView;
  pendingOpenView = null;
  mainWindow.webContents.send("dexnest:open-view", payload);
}

function dispatchOpenView(payload: { view: string; focusAssistant?: boolean; startListening?: boolean; source?: DexNestActionTrigger }): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenView = payload;
    createWindow();
    return;
  }

  pendingOpenView = payload;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(flushPendingOpenView, 50);
    });
    return;
  }
  setTimeout(flushPendingOpenView, 0);
}

function focusDexNestWindow(
  view: string = "command",
  source: DexNestActionTrigger | "tray" | "system" = "system",
  options: {
    actionId?: string;
    eventType?: string;
    summary?: string;
    focusAssistant?: boolean;
    writeAudit?: boolean;
  } = {}
): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  trayModeActive = false;
  mainWindow.focus();
  dispatchOpenView({ view, focusAssistant: options.focusAssistant });

  if (options.writeAudit === false) {
    return;
  }

  localDb.appendActionEvent({
    module: "DexNest Command",
    actionId: options.actionId ?? (view === "command" ? "command.open_palette" : `tray.open_${view}`),
    eventType: options.eventType ?? (source === "tray" ? "tray_action_used" : "command_shortcut_opened"),
    status: "success",
    source,
    summary: options.summary ?? (source === "tray" ? `Opened DexNest ${view} from tray.` : "Opened DexNest Command from global shortcut."),
    metadataJson: { view, focusAssistant: Boolean(options.focusAssistant) }
  });
}

function askDexNestFromTray(): void {
  focusDexNestWindow("search", "tray");
  setTimeout(() => {
    dispatchOpenView({ view: "search", focusAssistant: true });
  }, 100);
}

function showTrayCloseNotice(): void {
  const settings = loadAppLifecycleSettings();
  if (!settings.showTrayCloseNotice || trayCloseNoticeShownThisSession || !tray) {
    return;
  }
  trayCloseNoticeShownThisSession = true;
  try {
    if (process.platform === "win32") {
      tray.displayBalloon({
        title: "DexNest",
        content: "DexNest is still running in the tray."
      });
    }
  } catch {
    // Tray notices are best-effort only.
  }
}

function hideDexNestToTray(source: DexNestActionTrigger | "system" = "system"): void {
  createDexNestTray();
  mainWindow?.hide();
  trayModeActive = true;
  showTrayCloseNotice();
  localDb.appendActionEvent({
    module: "DexNest System",
    actionId: "system.lifecycle.minimize_to_tray",
    eventType: "app_minimized_to_tray",
    status: "success",
    source,
    summary: "DexNest was minimized to the tray.",
    metadataJson: { closeBehavior: loadAppLifecycleSettings().closeBehavior }
  });
}

function quitDexNestFully(source: DexNestActionTrigger | "system" = "system"): void {
  isQuittingDexNest = true;
  localDb.appendActionEvent({
    module: "DexNest System",
    actionId: "system.lifecycle.quit_full",
    eventType: "app_exit_requested",
    status: "success",
    source,
    summary: "DexNest full quit was requested.",
    metadataJson: { trayModeActive }
  });
  app.quit();
}

async function handleWindowCloseRequest(): Promise<void> {
  if (!mainWindow || closePromptOpen) {
    return;
  }

  const settings = loadAppLifecycleSettings();
  if (settings.closeBehavior === "exit") {
    quitDexNestFully("system");
    return;
  }

  if (settings.closeBehavior === "minimize_to_tray") {
    hideDexNestToTray("system");
    return;
  }

  closePromptOpen = true;
  try {
    const response = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Close DexNest?",
      message: "Close DexNest?",
      detail: "Choose whether DexNest should keep running in the tray or exit fully.",
      buttons: ["Minimize to tray", "Exit DexNest", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: "Remember my choice",
      checkboxChecked: false,
      noLink: true
    });

    if (response.response === 2) {
      localDb.appendActionEvent({
        module: "DexNest System",
        actionId: "system.lifecycle.close_cancelled",
        eventType: "app_close_cancelled",
        status: "cancelled",
        source: "system",
        summary: "DexNest close was cancelled.",
        metadataJson: {}
      });
      return;
    }

    if (response.checkboxChecked) {
      saveAppLifecycleSettings({
        closeBehavior: response.response === 0 ? "minimize_to_tray" : "exit"
      }, "system");
    }

    if (response.response === 0) {
      hideDexNestToTray("system");
      return;
    }

    quitDexNestFully("system");
  } finally {
    closePromptOpen = false;
  }
}

function unregisterCommandShortcut(): void {
  if (commandShortcutRegistered && registeredCommandShortcut) {
    globalShortcut.unregister(registeredCommandShortcut);
  }
  commandShortcutRegistered = false;
  registeredCommandShortcut = "";
}

function registerCommandShortcut(): void {
  unregisterCommandShortcut();
  const settings = loadCommandSettings();
  if (!settings.globalShortcutEnabled) {
    saveCommandSettings({ ...settings, globalShortcutStatus: "disabled", globalShortcutLastError: null });
    return;
  }

  const shortcut = normalizeCommandShortcut(settings.globalShortcut);
  commandShortcutRegistered = globalShortcut.register(shortcut, () => {
    focusDexNestWindow("command", "command");
  });
  registeredCommandShortcut = commandShortcutRegistered ? shortcut : "";
  saveCommandSettings({
    ...settings,
    globalShortcut: shortcut,
    globalShortcutStatus: commandShortcutRegistered ? "active" : "failed",
    globalShortcutLastError: commandShortcutRegistered ? null : `Electron could not register ${shortcut}. Another app may already reserve it.`
  });
  localDb.appendActionEvent({
    module: "DexNest Command",
    actionId: "command.shortcut.register",
    eventType: "command_shortcut_registration",
    status: commandShortcutRegistered ? "success" : "failed",
    source: "system",
    summary: commandShortcutRegistered ? "Registered DexNest Command global shortcut." : "DexNest Command global shortcut registration failed.",
    metadataJson: { shortcut, enabled: settings.globalShortcutEnabled },
    errorMessage: commandShortcutRegistered ? null : `Could not register ${shortcut}.`
  });
}

function unregisterAmbientVoiceShortcut(): void {
  if (ambientVoiceShortcutRegistered && registeredAmbientVoiceShortcut) {
    globalShortcut.unregister(registeredAmbientVoiceShortcut);
  }
  ambientVoiceShortcutRegistered = false;
  registeredAmbientVoiceShortcut = "";
}

function requestAmbientListening(source: DexNestActionTrigger = "push_to_talk"): void {
  const settings = loadAmbientVoiceSettings();
  const startedAt = Date.now();
  if (ambientPausedByPerformanceMode(settings)) {
    updateAmbientVoiceRuntime({ currentState: "paused", lastActionResult: "Paused by Performance Mode.", lastSource: source }, source);
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId: "voice.ambient.start_listening",
      eventType: "ambient_voice_start_skipped",
      status: "skipped",
      source,
      summary: "Ambient Voice start skipped because Performance Mode is active.",
      metadataJson: { pauseInPerformanceMode: settings.pauseInPerformanceMode },
      durationMs: Date.now() - startedAt
    });
    createDexNestTray();
    return;
  }

  updateAmbientVoiceRuntime({ currentState: "listening", lastActionResult: "Listening requested.", lastSource: source }, source);
  localDb.appendActionEvent({
    module: "DexNest Voice",
    actionId: "voice.ambient.start_listening",
    eventType: "ambient_voice_listening_requested",
    status: "success",
    source,
    summary: "DexNest Ambient Voice listening was requested.",
    metadataJson: {
      pushToTalkEnabled: settings.pushToTalkEnabled,
      wakeWordEnabled: settings.wakeWordEnabled,
      source
    },
    durationMs: Date.now() - startedAt
  });
  focusDexNestWindow("search", source, {
    actionId: "voice.ambient.start_listening",
    eventType: "ambient_voice_opened_assistant",
    summary: "Opened Ask DexNest for Ambient Voice listening.",
    focusAssistant: true,
    writeAudit: false
  });
  setTimeout(() => {
    dispatchOpenView({ view: "search", focusAssistant: true, startListening: true, source });
  }, 120);
  createDexNestTray();
}

function registerAmbientVoiceShortcut(): void {
  unregisterAmbientVoiceShortcut();
  const settings = loadAmbientVoiceSettings();
  if (!settings.pushToTalkEnabled) {
    writeJsonFile(ambientVoiceSettingsPath, { ...settings, pushToTalkShortcutStatus: "disabled", pushToTalkShortcutLastError: null, updatedAt: new Date().toISOString() });
    return;
  }

  const shortcut = normalizeAmbientShortcut(settings.pushToTalkShortcut);
  if (ambientPausedByPerformanceMode(settings)) {
    writeJsonFile(ambientVoiceSettingsPath, { ...settings, pushToTalkShortcut: shortcut, pushToTalkShortcutStatus: "paused", pushToTalkShortcutLastError: "Paused by Performance Mode.", updatedAt: new Date().toISOString() });
    return;
  }

  const conflictsWithCommand = loadCommandSettings().globalShortcutEnabled && loadCommandSettings().globalShortcut === shortcut;
  const conflictsWithClipboard = loadClipboardSettings().multiCopyHotkeyEnabled && loadClipboardSettings().multiCopyHotkey === shortcut;
  if (conflictsWithCommand || conflictsWithClipboard) {
    writeJsonFile(ambientVoiceSettingsPath, {
      ...settings,
      pushToTalkShortcut: shortcut,
      pushToTalkShortcutStatus: "failed",
      pushToTalkShortcutLastError: conflictsWithCommand ? "Shortcut conflicts with DexNest Command." : "Shortcut conflicts with Clipboard multi-copy.",
      updatedAt: new Date().toISOString()
    });
    return;
  }

  ambientVoiceShortcutRegistered = globalShortcut.register(shortcut, () => {
    requestAmbientListening("push_to_talk");
  });
  registeredAmbientVoiceShortcut = ambientVoiceShortcutRegistered ? shortcut : "";
  writeJsonFile(ambientVoiceSettingsPath, {
    ...settings,
    pushToTalkShortcut: shortcut,
    pushToTalkShortcutStatus: ambientVoiceShortcutRegistered ? "active" : "failed",
    pushToTalkShortcutLastError: ambientVoiceShortcutRegistered ? null : `Electron could not register ${shortcut}. Another app may already reserve it.`,
    updatedAt: new Date().toISOString()
  });
  localDb.appendActionEvent({
    module: "DexNest Voice",
    actionId: "voice.ambient.update_settings",
    eventType: "ambient_push_to_talk_registration",
    status: ambientVoiceShortcutRegistered ? "success" : "failed",
    source: "system",
    summary: ambientVoiceShortcutRegistered ? "Registered DexNest Ambient Voice push-to-talk shortcut." : "DexNest Ambient Voice push-to-talk shortcut registration failed.",
    metadataJson: { shortcut, enabled: settings.pushToTalkEnabled },
    errorMessage: ambientVoiceShortcutRegistered ? null : `Could not register ${shortcut}.`
  });
}

function unregisterKeyboardShortcuts(): void {
  for (const shortcut of registeredKeyboardShortcuts) {
    globalShortcut.unregister(shortcut);
  }
  registeredKeyboardShortcuts = [];
}

function routineHasDangerousSteps(routineId: string): boolean {
  const routine = loadRoutines().find((item) => item.id === routineId);
  if (!routine) {
    return false;
  }
  return routine.steps.some((step) => {
    const stepAction = findAction(step.actionId);
    return stepAction?.dangerLevel === "danger" || stepAction?.dangerLevel === "critical" || stepAction?.requiresConfirmation;
  });
}

function validateKeyboardShortcutMapping(mapping: KeyboardShortcutMapping, settings: KeyboardShortcutSettings): { ok: boolean; status: KeyboardShortcutMapping["status"]; error: string | null } {
  if (!settings.enabled || !mapping.enabled) {
    return { ok: false, status: "disabled", error: null };
  }
  if (!mapping.shortcut.trim()) {
    return { ok: false, status: "failed", error: "Shortcut is required." };
  }
  if (mapping.targetType === "action") {
    const action = mapping.actionId ? findAction(mapping.actionId) : undefined;
    if (!action) {
      return { ok: false, status: "failed", error: "Action was not found." };
    }
    if (action.dangerLevel === "critical") {
      return { ok: false, status: "blocked", error: "Critical actions cannot be global shortcuts." };
    }
    if ((action.dangerLevel === "danger" || action.requiresConfirmation) && !mapping.allowDangerous) {
      return { ok: false, status: "blocked", error: "Dangerous actions require explicit warning before shortcut assignment." };
    }
  }
  if (mapping.targetType === "routine") {
    if (!mapping.routineId || !loadRoutines().some((routine) => routine.id === mapping.routineId)) {
      return { ok: false, status: "failed", error: "Routine was not found." };
    }
    if (routineHasDangerousSteps(mapping.routineId) && !mapping.allowDangerous) {
      return { ok: false, status: "blocked", error: "Routine includes an action that requires confirmation." };
    }
  }
  const duplicateCount = settings.mappings.filter((item) => item.enabled && item.shortcut === mapping.shortcut).length;
  if (duplicateCount > 1) {
    return { ok: false, status: "conflict", error: "Shortcut is assigned more than once." };
  }
  if (loadCommandSettings().globalShortcutEnabled && loadCommandSettings().globalShortcut === mapping.shortcut) {
    return { ok: false, status: "conflict", error: "Shortcut conflicts with DexNest Command shortcut." };
  }
  if (loadClipboardSettings().multiCopyHotkeyEnabled && loadClipboardSettings().multiCopyHotkey === mapping.shortcut) {
    return { ok: false, status: "conflict", error: "Shortcut conflicts with Clipboard multi-copy hotkey." };
  }
  if (loadAmbientVoiceSettings().pushToTalkEnabled && loadAmbientVoiceSettings().pushToTalkShortcut === mapping.shortcut) {
    return { ok: false, status: "conflict", error: "Shortcut conflicts with Ambient Voice push-to-talk." };
  }
  return { ok: true, status: "active", error: null };
}

async function runKeyboardShortcutMapping(mapping: KeyboardShortcutMapping): Promise<void> {
  const startedAt = Date.now();
  localDb.appendActionEvent({
    module: "DexNest System",
    actionId: "system.keyboard_shortcut.triggered",
    eventType: "keyboard_shortcut_triggered",
    status: "success",
    source: "keyboard_shortcut",
    summary: "DexNest keyboard shortcut triggered.",
    metadataJson: {
      mappingId: mapping.id,
      targetType: mapping.targetType,
      actionId: mapping.actionId ?? null,
      routineId: mapping.routineId ?? null
    }
  });
  if (mapping.actionId === "system.performance.toggle") {
    const current = performanceModeState();
    setPerformanceModeEnabled(!current.enabled, "manual", "keyboard_shortcut");
    return;
  }
  if (mapping.actionId === "search.open") {
    focusDexNestWindow("search", "keyboard_shortcut");
    setTimeout(() => {
      dispatchOpenView({ view: "search", focusAssistant: true });
    }, 100);
    return;
  }
  const result = mapping.targetType === "routine"
    ? await runRegisteredAction("deck.routine.run", "keyboard_shortcut", { routineId: mapping.routineId })
    : await runRegisteredAction(mapping.actionId ?? "", "keyboard_shortcut", {});
  if (!result.ok) {
    const errorMessage = "error" in result && typeof result.error === "string" ? result.error : "Shortcut action failed.";
    localDb.appendActionEvent({
      module: "DexNest System",
      actionId: "system.keyboard_shortcut.failed",
      eventType: "keyboard_shortcut_action_failed",
      status: "failed",
      source: "keyboard_shortcut",
      summary: "DexNest keyboard shortcut action failed.",
      metadataJson: { mappingId: mapping.id, targetType: mapping.targetType },
      errorMessage,
      durationMs: Date.now() - startedAt
    });
  }
}

function registerKeyboardShortcuts(): void {
  unregisterKeyboardShortcuts();
  const settings = loadKeyboardShortcutSettings();
  const nextMappings = settings.mappings.map((mapping) => {
    const validation = validateKeyboardShortcutMapping(mapping, settings);
    if (!validation.ok) {
      return { ...mapping, status: validation.status, lastError: validation.error };
    }
    const registered = globalShortcut.register(mapping.shortcut, () => {
      void runKeyboardShortcutMapping(mapping);
    });
    if (registered) {
      registeredKeyboardShortcuts.push(mapping.shortcut);
    }
    return {
      ...mapping,
      status: registered ? "active" as const : "failed" as const,
      lastError: registered ? null : `Electron could not register ${mapping.shortcut}. Another app may reserve it.`
    };
  });
  writeJsonFile(keyboardShortcutsPath, { ...settings, mappings: nextMappings, updatedAt: new Date().toISOString() });
}

function createTrayIcon(): Electron.NativeImage {
  const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#000000"/><circle cx="16" cy="16" r="9" fill="none" stroke="#22D3EE" stroke-width="3"/><circle cx="16" cy="16" r="3" fill="#22D3EE"/></svg>`);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function togglePerformanceModeFromTray(): void {
  const state = performanceModeState();
  setPerformanceModeEnabled(!state.enabled, "manual", "system");
}

function lockSensitiveSessionFromTray(): void {
  lockSecureVault();
  lockTrustedSession();
  localDb.appendActionEvent({
    module: "DexNest System",
    actionId: "system.lifecycle.lock_sensitive_session",
    eventType: "sensitive_session_locked",
    status: "success",
    source: "system",
    summary: "Locked DexNest sensitive sessions from the tray.",
    metadataJson: {}
  });
}

function createDexNestTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    tray = new Tray(createTrayIcon());
    const performance = performanceModeState();
    const performanceSettings = loadPerformanceModeSettings();
    const ambient = ambientVoiceState();
    tray.setToolTip(performanceSettings.showTrayStatus && performance.enabled ? "DexNest - Performance Mode ON" : "DexNest");
    const nudgeCount = currentNudges().length;
    const menu = Menu.buildFromTemplate([
      { label: mainWindow?.isVisible() ? "Hide DexNest" : "Show DexNest", click: () => mainWindow?.isVisible() ? hideDexNestToTray("tray") : focusDexNestWindow("command", "tray") },
      { type: "separator" },
      { label: `${nudgeCount} active nudge${nudgeCount === 1 ? "" : "s"}`, enabled: false },
      ...(performanceSettings.showTrayStatus ? [{ label: `Performance Mode: ${performance.enabled ? "ON" : "OFF"}`, enabled: false } as Electron.MenuItemConstructorOptions] : []),
      { type: "separator" },
      { label: "Show DexNest", click: () => focusDexNestWindow("command", "tray") },
      { label: "Ask DexNest", click: () => askDexNestFromTray() },
      { label: "Start Listening", enabled: !ambient.pausedByPerformanceMode, click: () => requestAmbientListening("tray") },
      { label: "Open Search", click: () => focusDexNestWindow("search", "tray") },
      { label: "Open Drop", click: () => focusDexNestWindow("drop", "tray") },
      { label: "Open Clipboard", click: () => focusDexNestWindow("clipboard", "tray") },
      { type: "separator" },
      { label: "Open Command", click: () => focusDexNestWindow("command", "tray") },
      { label: "Open Dev", click: () => focusDexNestWindow("dev", "tray") },
      { label: "Open Journal", click: () => focusDexNestWindow("journal", "tray") },
      { label: "Open Settings", click: () => focusDexNestWindow("settings", "tray") },
      { type: "separator" },
      { label: `Ambient Voice: ${ambient.settings.ambientVoiceEnabled ? "ON" : "OFF"} / ${ambient.currentState}`, enabled: false },
      { label: ambient.settings.ambientVoiceEnabled ? "Disable Ambient Voice" : "Enable Ambient Voice", click: () => saveAmbientVoiceSettings({ ambientVoiceEnabled: !ambient.settings.ambientVoiceEnabled }, "tray") },
      { label: `${performance.enabled ? "Disable" : "Enable"} Performance Mode`, click: () => togglePerformanceModeFromTray() },
      { label: "Lock sensitive session", click: () => lockSensitiveSessionFromTray() },
      { type: "separator" },
      { label: "Quit DexNest", click: () => quitDexNestFully("system") }
    ]);
    tray.setContextMenu(menu);
    tray.on("click", () => focusDexNestWindow("command", "tray"));
    tray.on("double-click", () => focusDexNestWindow("command", "tray"));
    saveCommandSettings({ ...loadCommandSettings(), trayStatus: "active" });
  } catch {
    saveCommandSettings({ ...loadCommandSettings(), trayStatus: "failed" });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function sendWindowsCopyShortcut(): Promise<void> {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Ctrl+Shift+C multi-copy capture is currently implemented for Windows."));
  }

  const script = [
    "$signature = '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';",
    "Add-Type -MemberDefinition $signature -Name Keyboard -Namespace DexNestInput;",
    "$keyup = 0x0002;",
    "$ctrl = 0x11;",
    "$shift = 0x10;",
    "$alt = 0x12;",
    "$c = 0x43;",
    "[DexNestInput.Keyboard]::keybd_event($c, 0, $keyup, [UIntPtr]::Zero);",
    "[DexNestInput.Keyboard]::keybd_event($shift, 0, $keyup, [UIntPtr]::Zero);",
    "[DexNestInput.Keyboard]::keybd_event($alt, 0, $keyup, [UIntPtr]::Zero);",
    "[DexNestInput.Keyboard]::keybd_event($ctrl, 0, $keyup, [UIntPtr]::Zero);",
    "Start-Sleep -Milliseconds 180;",
    "[DexNestInput.Keyboard]::keybd_event($ctrl, 0, 0, [UIntPtr]::Zero);",
    "Start-Sleep -Milliseconds 25;",
    "[DexNestInput.Keyboard]::keybd_event($c, 0, 0, [UIntPtr]::Zero);",
    "Start-Sleep -Milliseconds 70;",
    "[DexNestInput.Keyboard]::keybd_event($c, 0, $keyup, [UIntPtr]::Zero);",
    "[DexNestInput.Keyboard]::keybd_event($ctrl, 0, $keyup, [UIntPtr]::Zero);"
  ].join(" ");

  return new Promise((resolveCopy, rejectCopy) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script
      ],
      { windowsHide: true, timeout: 2500 },
      (error) => {
        if (error) {
          rejectCopy(error);
          return;
        }
        resolveCopy();
      }
    );
  });
}

function sendWindowsPasteShortcut(): Promise<void> {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Ctrl+V paste replay is currently implemented for Windows."));
  }

  return new Promise((resolvePaste, rejectPaste) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
      ],
      { windowsHide: true, timeout: 2500 },
      (error) => {
        if (error) {
          rejectPaste(error);
          return;
        }
        resolvePaste();
      }
    );
  });
}

function currentActiveCombinedText(session: ClipboardActiveMultiCopySession | null = loadClipboardActiveMultiCopySession()): string {
  return combinedClipboardText(session?.items ?? [], loadClipboardSettings().combinedSeparator || "\n\n");
}

const allowedClipboardHotkeys = new Set(["CommandOrControl+Shift+C", "CommandOrControl+Alt+C", "CommandOrControl+Shift+X"]);

function normalizeClipboardHotkey(value: unknown): string {
  const hotkey = typeof value === "string" ? value : "";
  return allowedClipboardHotkeys.has(hotkey) ? hotkey : "CommandOrControl+Shift+C";
}

function stopArmedMultiCopyPasteDetection(): void {
  if (clipboardPasteHotkeyRegistered) {
    globalShortcut.unregister("CommandOrControl+V");
  }
  clipboardPasteHotkeyRegistered = false;
  if (clipboardPasteFallbackTimer) {
    clearInterval(clipboardPasteFallbackTimer);
    clipboardPasteFallbackTimer = null;
  }
  clipboardArmedPasteText = "";
}

function clearActiveMultiCopyAfterPaste(reason: "pasted" | "clipboard_changed" | "manual" | "auto_clear", source: DexNestActionTrigger | "system" = "system"): void {
  const session = loadClipboardActiveMultiCopySession();
  if (!session?.items.length) {
    stopArmedMultiCopyPasteDetection();
    return;
  }

  const itemCount = session.items.length;
  const combinedText = currentActiveCombinedText(session);
  if (combinedText && clipboard.readText() === combinedText) {
    clipboard.clear();
    lastClipboardListenerText = "";
  }
  writeJsonFile(clipboardActiveMultiCopyPath, {
    ...session,
    items: [],
    completedAt: new Date().toISOString(),
    armedForPasteAt: null
  });
  writeJsonFile(clipboardActiveMultiCopyPath, null);
  stopArmedMultiCopyPasteDetection();
  updateClipboardHotkeyStatus("success", reason === "pasted" ? "Multi-copy pasted and cleared." : "Multi-copy group cleared.");
  notifyClipboardHotkey(reason === "pasted" ? "Multi-copy pasted and cleared" : "Multi-copy group cleared", "success");
  localDb.appendActionEvent({
    module: "clipboard",
    actionId: "clipboard.clear_multi_copy_session",
    eventType: reason === "pasted" ? "clipboard_multi_copy_pasted_cleared" : "clipboard_multi_copy_cleared",
    status: "success",
    source,
    summary: reason === "pasted" ? "Multi-copy group pasted once and cleared." : "Multi-copy group cleared.",
    metadataJson: { sessionId: session.id, itemCount, reason }
  });
}

function startArmedPasteFallbackMonitor(armedText: string): void {
  if (clipboardPasteFallbackTimer) {
    clearInterval(clipboardPasteFallbackTimer);
  }
  clipboardPasteFallbackTimer = setInterval(() => {
    const session = loadClipboardActiveMultiCopySession();
    if (!session?.items.length || !session.armedForPasteAt) {
      stopArmedMultiCopyPasteDetection();
      return;
    }
    const currentText = clipboard.readText();
    if (armedText && currentText && currentText !== armedText) {
      clearActiveMultiCopyAfterPaste("clipboard_changed");
    }
  }, 1000);
}

function armActiveMultiCopyForPaste(session: ClipboardActiveMultiCopySession, combinedText: string): void {
  stopArmedMultiCopyPasteDetection();
  clipboardArmedPasteText = combinedText;
  const armedAt = new Date().toISOString();
  saveClipboardActiveMultiCopySession({
    ...session,
    armedForPasteAt: armedAt,
    updatedAt: session.updatedAt || armedAt
  });

  clipboardPasteHotkeyRegistered = globalShortcut.register("CommandOrControl+V", () => {
    if (clipboardPasteReplayBusy) {
      return;
    }
    clipboardPasteReplayBusy = true;
    if (clipboardPasteHotkeyRegistered) {
      globalShortcut.unregister("CommandOrControl+V");
      clipboardPasteHotkeyRegistered = false;
    }
    void sendWindowsPasteShortcut()
      .then(() => delay(180))
      .then(() => {
        clearActiveMultiCopyAfterPaste("pasted");
      })
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : "Multi-copy paste replay failed.";
        updateClipboardHotkeyStatus("failed", errorMessage);
        notifyClipboardHotkey(errorMessage, "error");
        startArmedPasteFallbackMonitor(clipboardArmedPasteText);
      })
      .finally(() => {
        clipboardPasteReplayBusy = false;
      });
  });

  if (!clipboardPasteHotkeyRegistered) {
    startArmedPasteFallbackMonitor(combinedText);
  }

  localDb.appendActionEvent({
    module: "clipboard",
    actionId: "clipboard.copy_combined_group",
    eventType: "clipboard_multi_copy_armed",
    status: "success",
    source: "system",
    summary: "Multi-copy combined group armed for one paste.",
    metadataJson: { sessionId: session.id, itemCount: session.items.length, pasteHotkeyRegistered: clipboardPasteHotkeyRegistered }
  });
}

function scheduleActiveMultiCopyAutoClear(): void {
  if (clipboardMultiCopyTimeoutTimer) {
    clearTimeout(clipboardMultiCopyTimeoutTimer);
    clipboardMultiCopyTimeoutTimer = null;
  }

  const session = readJsonFile<ClipboardActiveMultiCopySession | null>(clipboardActiveMultiCopyPath, null);
  if (!session?.items?.length) {
    return;
  }

  const settings = loadClipboardSettings();
  const autoClearMinutes = Math.max(1, Number(settings.multiCopyAutoClearMinutes) || 15);
  const updatedAtMs = new Date(session.updatedAt ?? session.startedAt).getTime();
  const clearAtMs = updatedAtMs + autoClearMinutes * 60 * 1000;
  const delayMs = Math.max(1000, clearAtMs - Date.now());

  clipboardMultiCopyTimeoutTimer = setTimeout(() => {
    const currentSession = loadClipboardActiveMultiCopySession();
    if (!currentSession?.items.length) {
      return;
    }

    const currentUpdatedAtMs = new Date(currentSession.updatedAt ?? currentSession.startedAt).getTime();
    if (Date.now() - currentUpdatedAtMs < autoClearMinutes * 60 * 1000) {
      scheduleActiveMultiCopyAutoClear();
      return;
    }

    const combinedText = currentActiveCombinedText(currentSession);
    if (combinedText && clipboard.readText() === combinedText) {
      clipboard.clear();
      lastClipboardListenerText = "";
    }
    writeJsonFile(clipboardActiveMultiCopyPath, null);
    stopArmedMultiCopyPasteDetection();
    updateClipboardHotkeyStatus("skipped", "Multi-copy group auto-cleared after inactivity.");
    notifyClipboardHotkey("Multi-copy group auto-cleared after inactivity.", "success");
    localDb.appendActionEvent({
      module: "clipboard",
      actionId: "clipboard.clear_multi_copy_session",
      eventType: "clipboard_multi_copy_auto_clear",
      status: "success",
      source: "system",
      summary: `Auto-cleared active multi-copy group after ${autoClearMinutes} minutes.`,
      metadataJson: { itemCount: currentSession.items.length, autoClearMinutes }
    });
  }, delayMs);
}

// Start/stop the low-level keyboard hook for natural slot sequences to match the
// current setting. The hook only suppresses Ctrl+digit when completed by C/V, so
// normal Ctrl+C / Ctrl+V and browser tab switching are preserved.
function reconcileSlotHook(): void {
  const settings = loadClipboardSettings();
  const persistStatus = (status: ClipboardSettings["slotSequenceStatus"], error: string | null): void => {
    const current = loadClipboardSettings();
    if (current.slotSequenceStatus === status && current.slotSequenceLastError === error) { return; }
    saveClipboardSettings({ ...current, slotSequenceStatus: status, slotSequenceLastError: error });
  };
  if (!settings.slotSequenceEnabled) {
    stopSlotHook();
    persistStatus("disabled", null);
    return;
  }
  if (process.platform !== "win32") {
    persistStatus("failed", "Clipboard slot sequences are currently Windows-only.");
    return;
  }
  if (isSlotHookRunning()) { return; }
  const result = startSlotHook({
    windowMs: settings.slotSequenceWindowMs,
    onSequence: (slot, op) => {
      if (op === "SAVE") {
        // The C key is passed through (normal Ctrl+C), so the user's current
        // selection is copied first. Wait briefly for the OS clipboard to update,
        // then save the fresh clipboard into the slot.
        setTimeout(() => {
          void runRegisteredAction(`clipboard.slot${slot}.save_current`, "keyboard_shortcut", {}).catch(() => undefined);
        }, 160);
        return;
      }
      void runRegisteredAction(`clipboard.slot${slot}.paste`, "keyboard_shortcut", {}).catch(() => undefined);
    },
    onReady: () => persistStatus("active", null),
    onExit: (error) => {
      if (loadClipboardSettings().slotSequenceEnabled) {
        persistStatus("failed", error ?? "Keyboard hook stopped unexpectedly.");
      }
    }
  });
  if (!result.ok) {
    persistStatus("failed", result.error ?? "Could not start keyboard hook.");
  }
}

function registerClipboardHotkey(): void {
  unregisterClipboardHotkey();
  const settings = loadClipboardSettings();
  if (!settings.multiCopyHotkeyEnabled) {
    saveClipboardSettings({
      ...settings,
      multiCopyHotkeyStatus: "disabled",
      multiCopyHotkeyLastError: null
    });
    return;
  }

  const hotkey = normalizeClipboardHotkey(settings.multiCopyHotkey);
  clipboardHotkeyRegistered = globalShortcut.register(hotkey, () => {
    void captureSelectionToMultiCopyGroup();
  });

  registeredClipboardHotkey = clipboardHotkeyRegistered ? hotkey : "";
  saveClipboardSettings({
    ...settings,
    multiCopyHotkey: hotkey,
    multiCopyHotkeyStatus: clipboardHotkeyRegistered ? "active" : "failed",
    multiCopyHotkeyLastError: clipboardHotkeyRegistered ? null : `Electron could not register ${hotkey}. Another app may already reserve it.`
  });

  localDb.appendActionEvent({
    module: "clipboard",
    actionId: "clipboard.update_settings",
    eventType: "clipboard_multi_copy_hotkey_registration",
    status: clipboardHotkeyRegistered ? "success" : "failed",
    source: "system",
    summary: clipboardHotkeyRegistered ? "Registered DexNest multi-copy hotkey." : "DexNest multi-copy hotkey registration failed.",
    metadataJson: { hotkey, enabled: settings.multiCopyHotkeyEnabled },
    errorMessage: clipboardHotkeyRegistered ? null : `Could not register ${hotkey}.`
  });

  if (!clipboardHotkeyRegistered) {
    updateClipboardHotkeyStatus("failed", `${hotkey} multi-copy hotkey could not be registered.`);
  }
}

function unregisterClipboardHotkey(): void {
  if (clipboardHotkeyRegistered && registeredClipboardHotkey) {
    globalShortcut.unregister(registeredClipboardHotkey);
  }
  clipboardHotkeyRegistered = false;
  registeredClipboardHotkey = "";
}

async function captureSelectionToMultiCopyGroup(): Promise<void> {
  if (clipboardHotkeyBusy) {
    return;
  }

  clipboardHotkeyBusy = true;
  const startedAt = Date.now();
  localDb.appendActionEvent({
    module: "clipboard",
    actionId: "clipboard.copy_combined_group",
    eventType: "clipboard_multi_copy_hotkey_pressed",
    status: "pending",
    source: "system",
    summary: "DexNest multi-copy hotkey pressed.",
    metadataJson: { hotkey: loadClipboardSettings().multiCopyHotkey }
  });

  const previousClipboardText = clipboard.readText();
  const captureMarker = `__DEXNEST_MULTI_COPY_CAPTURE_${Date.now()}_${randomBytes(6).toString("hex")}__`;

  try {
    clipboard.writeText(captureMarker);
    lastClipboardListenerText = captureMarker;
    await sendWindowsCopyShortcut();
    let selectedText = clipboard.readText();
    for (let attempt = 0; attempt < 12 && selectedText === captureMarker; attempt += 1) {
      await delay(100);
      selectedText = clipboard.readText();
    }

    if (!selectedText.trim() || selectedText === captureMarker) {
      clipboard.writeText(previousClipboardText);
      lastClipboardListenerText = previousClipboardText;
      updateClipboardHotkeyStatus("skipped", "No selected text captured. Try the fallback hotkey or verify the target app allows copy.");
      notifyClipboardHotkey("No selected text captured. Try Ctrl+Alt+C fallback.", "error");
      localDb.appendActionEvent({
        module: "clipboard",
        actionId: "clipboard.copy_combined_group",
        eventType: "clipboard_multi_copy_item_skipped",
        status: "skipped",
        source: "system",
        summary: "Multi-copy hotkey skipped because no selected text was copied by the target app.",
        metadataJson: { byteLength: 0 },
        durationMs: Date.now() - startedAt
      });
      return;
    }

    if (isProtectedClipboardText(selectedText)) {
      clipboard.writeText(previousClipboardText);
      lastClipboardListenerText = previousClipboardText;
      updateClipboardHotkeyStatus("skipped", clipboardProtectedError());
      notifyClipboardHotkey(clipboardProtectedError(), "error");
      localDb.appendActionEvent({
        module: "clipboard",
        actionId: "clipboard.copy_combined_group",
        eventType: "clipboard_multi_copy_protected_skipped",
        status: "skipped",
        source: "system",
        summary: "Multi-copy hotkey skipped a Secure Vault protected value.",
        metadataJson: { protectedSource: "secure_vault" },
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const now = new Date().toISOString();
    const existingSession = loadClipboardActiveMultiCopySession();
    const createdNewSession = !existingSession;
    const session: ClipboardActiveMultiCopySession = existingSession ?? {
      id: createId("multi-copy"),
      startedAt: now,
      updatedAt: now,
      items: []
    };

    if (session.items.at(-1)?.text === selectedText) {
      const combinedText = combinedClipboardText(session.items, loadClipboardSettings().combinedSeparator || "\n\n");
      if (combinedText) {
        clipboard.writeText(combinedText);
        lastClipboardListenerText = combinedText;
        armActiveMultiCopyForPaste(session, combinedText);
      }
      updateClipboardHotkeyStatus("skipped", "Duplicate multi-copy item skipped.");
      notifyClipboardHotkey(`Duplicate skipped. Multi-copy group: ${session.items.length} items.`, "success");
      localDb.appendActionEvent({
        module: "clipboard",
        actionId: "clipboard.copy_combined_group",
        eventType: "clipboard_multi_copy_duplicate_skipped",
        status: "skipped",
        source: "system",
        summary: "Multi-copy hotkey skipped duplicate selected text.",
        metadataJson: { itemCount: session.items.length, byteLength: byteLength(selectedText) },
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const item = makeClipboardHistoryItem(selectedText, "multi_copy");
    const updatedSession = saveClipboardActiveMultiCopySession({
      ...session,
      updatedAt: now,
      armedForPasteAt: null,
      items: [...session.items, item]
    }) as ClipboardActiveMultiCopySession;
    const combinedText = combinedClipboardText(updatedSession.items, loadClipboardSettings().combinedSeparator || "\n\n");
    clipboard.writeText(combinedText);
    lastClipboardListenerText = combinedText;
    armActiveMultiCopyForPaste(updatedSession, combinedText);
    saveClipboardSettings({
      ...loadClipboardSettings(),
      lastCaptureAt: item.createdAt,
      lastCapturedPreview: item.preview,
      lastReadError: null
    });

    const message = `Added to multi-copy group: ${updatedSession.items.length} items`;
    updateClipboardHotkeyStatus("success", message);
    notifyClipboardHotkey(message, "success");
    if (createdNewSession) {
      localDb.appendActionEvent({
        module: "clipboard",
        actionId: "clipboard.start_multi_copy",
        eventType: "clipboard_multi_copy_started",
        status: "success",
        source: "system",
        summary: "Started DexNest multi-copy group from hotkey.",
        metadataJson: { sessionId: updatedSession.id }
      });
    }
    localDb.appendActionEvent({
      module: "clipboard",
      actionId: "clipboard.copy_combined_group",
      eventType: "clipboard_multi_copy_item_added",
      status: "success",
      source: "system",
      summary: `Added selected text to multi-copy group, ${item.byteLength} bytes.`,
      metadataJson: { sessionId: updatedSession.id, itemCount: updatedSession.items.length, byteLength: item.byteLength },
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Multi-copy hotkey capture failed.";
    updateClipboardHotkeyStatus("failed", errorMessage);
    notifyClipboardHotkey(errorMessage, "error");
    localDb.appendActionEvent({
      module: "clipboard",
      actionId: "clipboard.copy_combined_group",
      eventType: "clipboard_multi_copy_hotkey_failed",
      status: "failed",
      source: "system",
      summary: "Multi-copy hotkey capture failed.",
      metadataJson: { hotkey: loadClipboardSettings().multiCopyHotkey },
      errorMessage,
      durationMs: Date.now() - startedAt
    });
  } finally {
    clipboardHotkeyBusy = false;
  }
}

function startClipboardListener(): void {
  stopClipboardListener();
  const settings = loadClipboardSettings();
  if (!settings.listenerEnabled) {
    return;
  }

  lastClipboardListenerText = clipboard.readText();
  clipboardListenerTimer = setInterval(() => {
    let text = "";
    try {
      text = clipboard.readText();
    } catch (error) {
      const settings = loadClipboardSettings();
      saveClipboardSettings({
        ...settings,
        lastReadAt: new Date().toISOString(),
        lastReadError: error instanceof Error ? error.message : "Clipboard read failed."
      });
      return;
    }
    // Fast path: nothing changed → no disk read/write on this tick (avoids
    // continuous JSON writes that stalled the main process every interval).
    if (!text || text === lastClipboardListenerText) {
      return;
    }
    // Record the read only when the clipboard actually changed.
    const settings = loadClipboardSettings();
    saveClipboardSettings({
      ...settings,
      lastReadAt: new Date().toISOString(),
      lastReadPreview: previewText(text),
      lastReadError: null
    });

    if (clipboardHotkeyBusy) {
      lastClipboardListenerText = text;
      return;
    }

    lastClipboardListenerText = text;
    const result = saveClipboardText(text, "listener");
    if (result.ok && result.item) {
      localDb.appendActionEvent({
        module: "clipboard",
        actionId: "clipboard.listener_capture",
        eventType: "clipboard_listener_capture",
        status: "success",
        source: "system",
        summary: `Clipboard listener saved text, ${result.item.byteLength} bytes.`,
        metadataJson: { itemId: result.item.id, byteLength: result.item.byteLength }
      });
    } else if (result.reason === "secure_vault") {
      localDb.appendActionEvent({
        module: "clipboard",
        actionId: "clipboard.listener_capture",
        eventType: "clipboard_listener_skipped",
        status: "skipped",
        source: "system",
        summary: "Clipboard listener skipped a Secure Vault protected value.",
        metadataJson: { protectedSource: "secure_vault" }
      });
      const settings = loadClipboardSettings();
      saveClipboardSettings({
        ...settings,
        lastReadError: clipboardProtectedError()
      });
    }
  }, Math.max(1000, settings.listenerIntervalMs));
}

function stopClipboardListener(): void {
  if (clipboardListenerTimer) {
    clearInterval(clipboardListenerTimer);
    clipboardListenerTimer = null;
  }
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

function loadToolsOutputs(): ToolsOutputItem[] {
  ensureToolsRoot();
  return readJsonFile<ToolsOutputItem[]>(toolsOutputsPath, []);
}

function saveToolsOutputs(items: ToolsOutputItem[]): ToolsOutputItem[] {
  ensureToolsRoot();
  return writeJsonFile(toolsOutputsPath, items.slice(0, 100));
}

function loadSearchIndex(): SearchIndexRecord[] {
  ensureSearchRoot();

  if (!existsSync(searchIndexPath)) {
    writeFileSync(searchIndexPath, `${JSON.stringify([], null, 2)}\n`, "utf8");
    return [];
  }

  try {
    return JSON.parse(readFileSync(searchIndexPath, "utf8")) as SearchIndexRecord[];
  } catch (error) {
    // The search index is fully rebuildable, so a corrupt file can be safely reset.
    console.error("DexNest: search index was corrupt and has been reset.", error);
    writeFileSync(searchIndexPath, `${JSON.stringify([], null, 2)}\n`, "utf8");
    return [];
  }
}

function saveSearchIndex(items: SearchIndexRecord[]): SearchIndexRecord[] {
  ensureSearchRoot();
  writeFileSync(searchIndexPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  return items;
}

function loadSavedSearches(): SavedSearch[] {
  return readJsonFile<SavedSearch[]>(savedSearchesPath, []);
}

function saveSavedSearches(items: SavedSearch[]): SavedSearch[] {
  return writeJsonFile(savedSearchesPath, items);
}

function loadJournalEntries(): JournalEntry[] {
  return readJsonFile<JournalEntry[]>(journalEntriesPath, []);
}

function saveJournalEntries(items: JournalEntry[]): JournalEntry[] {
  return writeJsonFile(journalEntriesPath, items);
}

function loadCalendarEvents(): CalendarEvent[] {
  return readJsonFile<CalendarEvent[]>(calendarEventsPath, []);
}

function saveCalendarEvents(items: CalendarEvent[]): CalendarEvent[] {
  return writeJsonFile(calendarEventsPath, items);
}

function defaultNudgeSettings(): NudgeSettings {
  return {
    enabled: true,
    vaultExpiryReminderDays: [90, 30, 7],
    returnReminderDays: [7, 3, 1],
    dailyJournalReminderEnabled: true,
    backupReminderAfterDays: 7
  };
}

function loadNudgeSettings(): NudgeSettings {
  return { ...defaultNudgeSettings(), ...readJsonFile<Partial<NudgeSettings>>(nudgeSettingsPath, {}) };
}

function saveNudgeSettings(settings: NudgeSettings): NudgeSettings {
  return writeJsonFile(nudgeSettingsPath, settings);
}

function loadNudges(): Nudge[] {
  return readJsonFile<Nudge[]>(nudgesPath, []);
}

function saveNudges(items: Nudge[]): Nudge[] {
  return writeJsonFile(nudgesPath, items);
}

function loadFinderItems(): FinderItem[] {
  return readJsonFile<FinderItem[]>(finderItemsPath, []);
}

function saveFinderItems(items: FinderItem[]): FinderItem[] {
  return writeJsonFile(finderItemsPath, items);
}

// --- Finance profiles (Finance-module-only; not global app profiles) ----------

function loadFinanceProfilesFile(): FinanceProfilesFile {
  ensureFinanceRoot();
  const now = new Date().toISOString();
  const stored = readJsonFile<Partial<FinanceProfilesFile>>(financeProfilesPath, {});
  let profiles = Array.isArray(stored.profiles) ? stored.profiles.filter((p): p is FinanceProfile => Boolean(p && p.id && p.name)) : [];
  if (profiles.length === 0) {
    // First run / migration: create the default Personal Finance profile. Existing
    // records (no profileId) are treated as belonging to this default profile.
    profiles = [{ id: "personal", name: "Personal Finance", status: "active", isDefault: true, createdAt: now, updatedAt: now }];
  }
  if (!profiles.some((p) => p.isDefault && p.status === "active")) {
    const firstActive = profiles.find((p) => p.status === "active") ?? profiles[0];
    profiles = profiles.map((p) => ({ ...p, isDefault: p.id === firstActive.id }));
  }
  const defaultId = (profiles.find((p) => p.isDefault) ?? profiles[0]).id;
  let activeProfileId = typeof stored.activeProfileId === "string" ? stored.activeProfileId : defaultId;
  // Never leave the active profile pointing at a missing or archived profile.
  if (!profiles.some((p) => p.id === activeProfileId && p.status === "active")) {
    activeProfileId = defaultId;
  }
  return { profiles, activeProfileId };
}

function saveFinanceProfilesFile(file: FinanceProfilesFile): FinanceProfilesFile {
  ensureFinanceRoot();
  return writeJsonFile(financeProfilesPath, file);
}

function defaultFinanceProfileId(): string {
  const { profiles } = loadFinanceProfilesFile();
  return (profiles.find((p) => p.isDefault) ?? profiles[0]).id;
}

function activeFinanceProfileId(): string {
  return loadFinanceProfilesFile().activeProfileId;
}

function financeProfileName(profileId: string | null | undefined): string {
  if (!profileId) { return "Personal Finance"; }
  return loadFinanceProfilesFile().profiles.find((p) => p.id === profileId)?.name ?? "Personal Finance";
}

function loadFinanceTransactions(): FinanceTransaction[] {
  ensureFinanceRoot();
  const fallbackProfileId = defaultFinanceProfileId();
  // Migrate-on-load: records without a profileId belong to the default profile.
  return readJsonFile<FinanceTransaction[]>(financeTransactionsPath, []).map((item) => (item.profileId ? item : { ...item, profileId: fallbackProfileId }));
}

function saveFinanceTransactions(items: FinanceTransaction[]): FinanceTransaction[] {
  ensureFinanceRoot();
  return writeJsonFile(financeTransactionsPath, items);
}

function loadFinanceRecurring(): FinanceRecurringExpense[] {
  ensureFinanceRoot();
  const fallbackProfileId = defaultFinanceProfileId();
  return readJsonFile<FinanceRecurringExpense[]>(financeRecurringPath, []).map((item) => (item.profileId ? item : { ...item, profileId: fallbackProfileId }));
}

function saveFinanceRecurring(items: FinanceRecurringExpense[]): FinanceRecurringExpense[] {
  ensureFinanceRoot();
  return writeJsonFile(financeRecurringPath, items);
}

function loadFinanceSettings(): FinanceSettings {
  ensureFinanceRoot();
  return {
    defaultCurrency: "CAD",
    receiptsPath: receiptsRoot,
    ...readJsonFile<Partial<FinanceSettings>>(financeSettingsPath, {})
  };
}

function saveFinanceSettings(settings: FinanceSettings): FinanceSettings {
  ensureFinanceRoot();
  return writeJsonFile(financeSettingsPath, settings);
}

function loadCaptureItems(): CaptureItem[] {
  ensureCaptureRoot();
  return readJsonFile<CaptureItem[]>(captureItemsPath, []);
}

function saveCaptureItems(items: CaptureItem[]): CaptureItem[] {
  ensureCaptureRoot();
  return writeJsonFile(captureItemsPath, items);
}

function seedRoutines(): DexNestRoutine[] {
  const now = new Date().toISOString();
  return [
    {
      id: "routine-morning-review",
      name: "Morning Review",
      description: "Open Command, Calendar, and Capture inbox.",
      steps: [
        { id: createId("routine-step"), actionId: "command.open_home", params: {} },
        { id: createId("routine-step"), actionId: "calendar.show_today", params: {} },
        { id: createId("routine-step"), actionId: "capture.open", params: {} }
      ],
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunSummary: null
    },
    {
      id: "routine-dev-start",
      name: "Dev Start",
      description: "Open Dev and Deck for local project work.",
      steps: [
        { id: createId("routine-step"), actionId: "dev.open_dashboard", params: {} },
        { id: createId("routine-step"), actionId: "deck.test_endpoint", params: {} }
      ],
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunSummary: null
    },
    {
      id: "routine-end-of-day",
      name: "End of Day",
      description: "Open Journal, Calendar, and Audit.",
      steps: [
        { id: createId("routine-step"), actionId: "journal.open_today", params: {} },
        { id: createId("routine-step"), actionId: "calendar.show_today", params: {} },
        { id: createId("routine-step"), actionId: "audit.open_history", params: {} }
      ],
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunSummary: null
    }
  ];
}

function loadRoutines(): DexNestRoutine[] {
  const existing = readJsonFile<DexNestRoutine[] | null>(routinesPath, null);
  if (existing && Array.isArray(existing)) {
    return existing;
  }
  return writeJsonFile(routinesPath, seedRoutines());
}

function saveRoutines(routines: DexNestRoutine[]): DexNestRoutine[] {
  return writeJsonFile(routinesPath, routines);
}

function defaultHeatmapSettings(): HeatmapSettings {
  return {
    enabled: false,
    paused: true,
    sampleIntervalSeconds: 60,
    aggregationIntervalHours: 3,
    pauseDuringFullscreen: true,
    privateApps: [],
    privateTitleKeywords: [],
    lastAggregatedAt: null
  };
}

function loadHeatmapSettings(): HeatmapSettings {
  return {
    ...defaultHeatmapSettings(),
    ...readJsonFile<Partial<HeatmapSettings>>(heatmapSettingsPath, defaultHeatmapSettings())
  };
}

function saveHeatmapSettings(settings: HeatmapSettings): HeatmapSettings {
  return writeJsonFile(heatmapSettingsPath, settings);
}

function loadHeatmapEvents(): HeatmapEvent[] {
  return readJsonFile<HeatmapEvent[]>(heatmapEventsPath, []);
}

function saveHeatmapEvents(events: HeatmapEvent[]): HeatmapEvent[] {
  return writeJsonFile(heatmapEventsPath, events.slice(0, 10000));
}

function loadHeatmapGoals(): HeatmapGoal[] {
  return readJsonFile<HeatmapGoal[]>(heatmapGoalsPath, []);
}

function saveHeatmapGoals(goals: HeatmapGoal[]): HeatmapGoal[] {
  return writeJsonFile(heatmapGoalsPath, goals);
}

function sanitizeHeatmapText(value: string, maxLength = 80): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function privacyFilterHeatmapSnapshot(snapshot: ActiveWindowSnapshot, settings: HeatmapSettings): ActiveWindowSnapshot {
  const appName = sanitizeHeatmapText(snapshot.appName || "Unknown app", 48);
  const windowTitle = sanitizeHeatmapText(snapshot.windowTitle || "Untitled window", 80);
  const appMatch = settings.privateApps.some((item) => item.trim() && appName.toLowerCase().includes(item.trim().toLowerCase()));
  const titleMatch = settings.privateTitleKeywords.some((item) => item.trim() && windowTitle.toLowerCase().includes(item.trim().toLowerCase()));

  if (appMatch || titleMatch) {
    return {
      ...snapshot,
      appName: "Private app",
      windowTitle: "Private window"
    };
  }

  return {
    ...snapshot,
    appName,
    windowTitle
  };
}

function runPowerShellJson(script: string): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr.trim() || error.message));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout.trim()));
      } catch {
        rejectPromise(new Error("DexNest could not parse active window metadata."));
      }
    });
  });
}

async function detectActiveWindow(): Promise<ActiveWindowSnapshot> {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DexNestWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
}
"@
$handle = [DexNestWin32]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][DexNestWin32]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
$pidValue = 0
[void][DexNestWin32]::GetWindowThreadProcessId($handle, [ref]$pidValue)
$processName = "Unknown app"
if ($pidValue -gt 0) {
  try { $processName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName } catch {}
}
$lastInput = New-Object DexNestWin32+LASTINPUTINFO
$lastInput.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lastInput)
$idleSeconds = $null
if ([DexNestWin32]::GetLastInputInfo([ref]$lastInput)) {
  $idleSeconds = [math]::Max(0, [int](([Environment]::TickCount - $lastInput.dwTime) / 1000))
}
$rect = New-Object DexNestWin32+RECT
$isFullscreen = $false
if ([DexNestWin32]::GetWindowRect($handle, [ref]$rect)) {
  $screenWidth = [DexNestWin32]::GetSystemMetrics(0)
  $screenHeight = [DexNestWin32]::GetSystemMetrics(1)
  $windowWidth = $rect.Right - $rect.Left
  $windowHeight = $rect.Bottom - $rect.Top
  $isFullscreen = ($rect.Left -le 0 -and $rect.Top -le 0 -and $windowWidth -ge $screenWidth -and $windowHeight -ge $screenHeight)
}
[pscustomobject]@{
  appName = $processName
  windowTitle = $titleBuilder.ToString()
  idleSeconds = $idleSeconds
  isFullscreen = $isFullscreen
} | ConvertTo-Json -Compress
`;

  try {
    const result = await runPowerShellJson(script);
    const record = result as { appName?: string; windowTitle?: string; idleSeconds?: number | null; isFullscreen?: boolean };
    const idleSeconds = typeof record.idleSeconds === "number" ? record.idleSeconds : null;
    return {
      appName: record.appName || "Unknown app",
      windowTitle: record.windowTitle || "Untitled window",
      idleSeconds,
      active: idleSeconds === null ? true : idleSeconds < 300,
      isFullscreen: record.isFullscreen === true,
      detectionStatus: "ok"
    };
  } catch (error) {
    return {
      appName: "Manual sample",
      windowTitle: "Active window detection unavailable",
      idleSeconds: null,
      active: true,
      isFullscreen: false,
      detectionStatus: "failed",
      error: error instanceof Error ? error.message : "Unknown active window detection failure."
    };
  }
}

function mapHeatmapProject(appName: string, windowTitle: string): string | null {
  const haystack = `${appName} ${windowTitle}`.toLowerCase();
  return loadProjects().find((project) => haystack.includes(project.name.toLowerCase()) || haystack.includes(project.path.toLowerCase()))?.id ?? null;
}

function maybeAggregateHeatmapOnInterval(settings: HeatmapSettings, startedAt = Date.now()): void {
  const lastAggregatedAt = settings.lastAggregatedAt ? Date.parse(settings.lastAggregatedAt) : 0;
  const intervalMs = Math.max(3, settings.aggregationIntervalHours) * 60 * 60 * 1000;
  if (Number.isFinite(lastAggregatedAt) && Date.now() - lastAggregatedAt < intervalMs) {
    return;
  }

  const updatedSettings = saveHeatmapSettings({ ...settings, lastAggregatedAt: new Date().toISOString() });
  const state = heatmapState();
  localDb.appendActionEvent({
    module: "DexNest Heatmap",
    actionId: "heatmap.aggregate_now",
    eventType: "heatmap_aggregation_completed",
    status: "success",
    source: "system",
    summary: "Aggregated Heatmap summaries on interval.",
    metadataJson: {
      aggregationIntervalHours: updatedSettings.aggregationIntervalHours,
      topAppToday: state.summary.topAppToday,
      eventCount: state.events.length
    },
    errorMessage: null,
    durationMs: Date.now() - startedAt
  });
}

async function logHeatmapSample(source: DexNestActionTrigger | "system" = "module_ui"): Promise<{ ok: boolean; event?: HeatmapEvent; snapshot: ActiveWindowSnapshot; heatmapState: ReturnType<typeof heatmapState> }> {
  const startedAt = Date.now();
  const settings = loadHeatmapSettings();
  if (performanceModePauses("heatmap")) {
    const snapshot: ActiveWindowSnapshot = { appName: "Performance Mode", windowTitle: "Heatmap paused", active: false, idleSeconds: 0, isFullscreen: false, detectionStatus: "ok" };
    localDb.appendActionEvent({
      module: "DexNest Heatmap",
      actionId: "heatmap.log_current_app",
      eventType: "heatmap_sample_skipped",
      status: "skipped",
      source,
      summary: "Skipped Heatmap sample because Performance Mode is active.",
      metadataJson: { reason: "performance_mode" },
      errorMessage: null,
      durationMs: Date.now() - startedAt
    });
    return { ok: true, snapshot, heatmapState: heatmapState() };
  }
  const rawSnapshot = await detectActiveWindow();
  if (settings.pauseDuringFullscreen && rawSnapshot.isFullscreen) {
    localDb.appendActionEvent({
      module: "DexNest Heatmap",
      actionId: "heatmap.log_current_app",
      eventType: "heatmap_sample_skipped",
      status: "skipped",
      source,
      summary: "Skipped Heatmap sample while fullscreen pause is enabled.",
      metadataJson: { reason: "fullscreen" },
      errorMessage: null,
      durationMs: Date.now() - startedAt
    });
    return { ok: true, snapshot: rawSnapshot, heatmapState: heatmapState() };
  }
  const snapshot = privacyFilterHeatmapSnapshot(rawSnapshot, settings);
  const event: HeatmapEvent = {
    id: `heatmap-event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    appName: snapshot.appName,
    windowTitle: snapshot.windowTitle,
    projectId: mapHeatmapProject(snapshot.appName, snapshot.windowTitle),
    active: snapshot.active,
    idleSeconds: snapshot.idleSeconds,
    durationSeconds: Math.max(1, Math.min(3600, settings.sampleIntervalSeconds)),
    createdAt: new Date().toISOString()
  };

  saveHeatmapEvents([event, ...loadHeatmapEvents()]);
  if (settings.enabled && !settings.paused) {
    maybeAggregateHeatmapOnInterval(settings, startedAt);
  }
  localDb.appendActionEvent({
    module: "DexNest Heatmap",
    actionId: "heatmap.log_current_app",
    eventType: "heatmap_sample_logged",
    status: snapshot.detectionStatus === "ok" ? "success" : "failed",
    source,
    summary: snapshot.detectionStatus === "ok" ? "Logged active app metadata." : "Logged Heatmap placeholder sample because active window detection failed.",
    metadataJson: { appName: event.appName, active: event.active, detectionStatus: snapshot.detectionStatus },
    errorMessage: snapshot.error ?? null,
    durationMs: Date.now() - startedAt
  });

  return { ok: snapshot.detectionStatus === "ok", event, snapshot, heatmapState: heatmapState() };
}

function stopHeatmapTimer(): void {
  if (heatmapSampleTimer) {
    clearInterval(heatmapSampleTimer);
    heatmapSampleTimer = null;
  }
}

function startHeatmapTimer(): void {
  stopHeatmapTimer();
  const settings = loadHeatmapSettings();
  if (!settings.enabled || settings.paused || performanceModePauses("heatmap")) {
    return;
  }

  heatmapSampleTimer = setInterval(() => {
    void logHeatmapSample("system");
  }, Math.max(60, settings.sampleIntervalSeconds) * 1000);
}

// --- DexNest Assistant local intent engine (Phase 18.5) ---------------------
// The local LLM (Ollama) is a cold, on-demand worker. It is only ever asked to
// return a structured JSON intent. It never executes actions, reads files, runs
// shell commands, or reveals secrets. DexNest validates the JSON in the renderer
// and only runs already-registered actions.
interface AssistantSettings {
  localIntentEngineEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  fallbackToRules: boolean;
}

const assistantAllowedIntents = [
  "smart_lookup",
  "search_query",
  "finder_search",
  "calendar_create_candidate",
  "calendar_show_today",
  "calendar_show_upcoming",
  "drop_send_clipboard",
  "open_module",
  "dev_run_command",
  "journal_open_today",
  "capture_note",
  "external_device_control",
  "unknown"
] as const;

function defaultAssistantSettings(): AssistantSettings {
  return {
    localIntentEngineEnabled: false,
    ollamaUrl: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5:3b",
    fallbackToRules: true
  };
}

function normalizeOllamaUrl(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return fallback;
  }
  return raw.replace(/\/+$/, "");
}

function loadAssistantSettings(): AssistantSettings {
  return {
    ...defaultAssistantSettings(),
    ...readJsonFile<Partial<AssistantSettings>>(assistantSettingsPath, defaultAssistantSettings())
  };
}

function saveAssistantSettings(settings: AssistantSettings): AssistantSettings {
  return writeJsonFile(assistantSettingsPath, settings);
}

function updateAssistantSettings(input: Partial<AssistantSettings>): AssistantSettings {
  const current = loadAssistantSettings();
  const next: AssistantSettings = {
    localIntentEngineEnabled: typeof input.localIntentEngineEnabled === "boolean" ? input.localIntentEngineEnabled : current.localIntentEngineEnabled,
    ollamaUrl: normalizeOllamaUrl(input.ollamaUrl ?? current.ollamaUrl, defaultAssistantSettings().ollamaUrl),
    ollamaModel: typeof input.ollamaModel === "string" && input.ollamaModel.trim() ? input.ollamaModel.trim() : current.ollamaModel,
    fallbackToRules: typeof input.fallbackToRules === "boolean" ? input.fallbackToRules : current.fallbackToRules
  };
  return saveAssistantSettings(next);
}

function assistantState(): { settings: AssistantSettings } {
  return { settings: loadAssistantSettings() };
}

// --- DexNest shared local Speech Service (Phase 23A) -----------------------
let speechLastLatencyMs: number | null = null;
let speechLastError: string | null = null;

function defaultSpeechSettings(): SpeechSettings {
  return {
    speechEngine: "faster_whisper",
    fallbackToWindows: false,
    keepSpeechModelWarm: true,
    modelName: "base.en",
    modelSizeOptions: ["tiny.en", "base.en", "small.en"],
    device: "cpu",
    computeType: "int8",
    maxRecordingSeconds: 15,
    silenceStopEnabled: true,
    vadEnabled: true,
    initialSilenceTimeoutMs: 4000,
    endSilenceTimeoutMs: 900,
    minSpeechMs: 300,
    silenceThreshold: "auto",
    autoStopOnSilence: true,
    micPrewarmEnabled: true,
    selectedInputDeviceId: null,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    vadMode: "auto",
    noiseFloor: 0,
    speechThresholdMargin: 0.018,
    micSensitivity: 0.6,
    maxPostSpeechListenMs: 1500,
    requireSpeechStart: true,
    adaptiveSilenceThreshold: true,
    mainSpeakerMode: false,
    speakerVerificationEnabled: false,
    keepAudioForDebug: false,
    pauseInPerformanceMode: true,
    autoSendAfterSpeech: true,
    showTranscriptBeforeSend: false,
    useSharedSpeechEverywhere: true,
    pythonPath: null,
    updatedAt: null
  };
}

function safeSpeechEngine(value: unknown, fallback: SpeechEngine): SpeechEngine {
  return value === "faster_whisper" || value === "whisper_cpp" || value === "windows_fallback" ? value : fallback;
}

function safeSpeechDevice(value: unknown, fallback: SpeechDevice): SpeechDevice {
  return value === "auto" || value === "cuda" || value === "cpu" ? value : fallback;
}

function safeSpeechComputeType(value: unknown, fallback: SpeechComputeType): SpeechComputeType {
  return value === "auto" || value === "int8" || value === "float16" ? value : fallback;
}

function safeSpeechModelName(value: unknown, fallback: string): string {
  const candidate = String(value ?? "").trim();
  return ["tiny.en", "base.en", "small.en"].includes(candidate) ? candidate : fallback;
}

function loadSpeechSettings(): SpeechSettings {
  return {
    ...defaultSpeechSettings(),
    ...readJsonFile<Partial<SpeechSettings>>(speechSettingsPath, defaultSpeechSettings())
  };
}

function saveSpeechSettings(input: Partial<SpeechSettings>): SpeechSettings {
  const current = loadSpeechSettings();
  const next: SpeechSettings = {
    ...current,
    speechEngine: safeSpeechEngine(input.speechEngine, current.speechEngine),
    fallbackToWindows: typeof input.fallbackToWindows === "boolean" ? input.fallbackToWindows : current.fallbackToWindows,
    keepSpeechModelWarm: typeof input.keepSpeechModelWarm === "boolean" ? input.keepSpeechModelWarm : (current.keepSpeechModelWarm ?? true),
    modelName: safeSpeechModelName(input.modelName, current.modelName),
    modelSizeOptions: defaultSpeechSettings().modelSizeOptions,
    device: safeSpeechDevice(input.device, current.device),
    computeType: safeSpeechComputeType(input.computeType, current.computeType),
    maxRecordingSeconds: Math.max(3, Math.min(30, Number(input.maxRecordingSeconds) || current.maxRecordingSeconds)),
    silenceStopEnabled: typeof input.silenceStopEnabled === "boolean" ? input.silenceStopEnabled : current.silenceStopEnabled,
    vadEnabled: typeof input.vadEnabled === "boolean" ? input.vadEnabled : current.vadEnabled,
    initialSilenceTimeoutMs: Math.max(1000, Math.min(15000, Number(input.initialSilenceTimeoutMs) || (current.initialSilenceTimeoutMs ?? 4000))),
    endSilenceTimeoutMs: Math.max(300, Math.min(4000, Number(input.endSilenceTimeoutMs) || (current.endSilenceTimeoutMs ?? 900))),
    minSpeechMs: Math.max(100, Math.min(2000, Number(input.minSpeechMs) || (current.minSpeechMs ?? 300))),
    silenceThreshold: input.silenceThreshold === "auto" || typeof input.silenceThreshold === "number" ? input.silenceThreshold : (current.silenceThreshold ?? "auto"),
    autoStopOnSilence: typeof input.autoStopOnSilence === "boolean" ? input.autoStopOnSilence : (current.autoStopOnSilence ?? true),
    micPrewarmEnabled: typeof input.micPrewarmEnabled === "boolean" ? input.micPrewarmEnabled : (current.micPrewarmEnabled ?? true),
    selectedInputDeviceId: input.selectedInputDeviceId === undefined ? (current.selectedInputDeviceId ?? null) : (input.selectedInputDeviceId || null),
    noiseSuppression: typeof input.noiseSuppression === "boolean" ? input.noiseSuppression : (current.noiseSuppression ?? true),
    echoCancellation: typeof input.echoCancellation === "boolean" ? input.echoCancellation : (current.echoCancellation ?? true),
    autoGainControl: typeof input.autoGainControl === "boolean" ? input.autoGainControl : (current.autoGainControl ?? true),
    vadMode: input.vadMode === "manual" || input.vadMode === "auto" ? input.vadMode : (current.vadMode ?? "auto"),
    noiseFloor: Math.min(1, Math.max(0, Number(input.noiseFloor ?? current.noiseFloor ?? 0))),
    speechThresholdMargin: Math.min(0.2, Math.max(0.002, Number(input.speechThresholdMargin ?? current.speechThresholdMargin ?? 0.018))),
    micSensitivity: Math.min(1, Math.max(0, Number(input.micSensitivity ?? current.micSensitivity ?? 0.6))),
    maxPostSpeechListenMs: Math.min(8000, Math.max(800, Number(input.maxPostSpeechListenMs ?? current.maxPostSpeechListenMs ?? 2500))),
    requireSpeechStart: typeof input.requireSpeechStart === "boolean" ? input.requireSpeechStart : (current.requireSpeechStart ?? true),
    adaptiveSilenceThreshold: typeof input.adaptiveSilenceThreshold === "boolean" ? input.adaptiveSilenceThreshold : (current.adaptiveSilenceThreshold ?? true),
    mainSpeakerMode: typeof input.mainSpeakerMode === "boolean" ? input.mainSpeakerMode : (current.mainSpeakerMode ?? false),
    speakerVerificationEnabled: typeof input.speakerVerificationEnabled === "boolean" ? input.speakerVerificationEnabled : (current.speakerVerificationEnabled ?? false),
    keepAudioForDebug: typeof input.keepAudioForDebug === "boolean" ? input.keepAudioForDebug : current.keepAudioForDebug,
    pauseInPerformanceMode: typeof input.pauseInPerformanceMode === "boolean" ? input.pauseInPerformanceMode : current.pauseInPerformanceMode,
    autoSendAfterSpeech: typeof input.autoSendAfterSpeech === "boolean" ? input.autoSendAfterSpeech : current.autoSendAfterSpeech,
    showTranscriptBeforeSend: typeof input.showTranscriptBeforeSend === "boolean" ? input.showTranscriptBeforeSend : current.showTranscriptBeforeSend,
    useSharedSpeechEverywhere: typeof input.useSharedSpeechEverywhere === "boolean" ? input.useSharedSpeechEverywhere : current.useSharedSpeechEverywhere,
    pythonPath: typeof input.pythonPath === "string" && input.pythonPath.trim() ? input.pythonPath.trim() : null,
    updatedAt: new Date().toISOString()
  };
  ensureSpeechRoot();
  const saved = writeJsonFile(speechSettingsPath, next);
  localDb.appendActionEvent({
    module: "DexNest Voice",
    actionId: "speech.update_settings",
    eventType: "speech_settings_updated",
    status: "success",
    source: "module_ui",
    summary: "Updated DexNest shared speech service settings.",
    metadataJson: {
      engine: saved.speechEngine,
      model: saved.modelName,
      device: saved.device,
      computeType: saved.computeType,
      fallbackToWindows: saved.fallbackToWindows,
      keepAudioForDebug: saved.keepAudioForDebug
    }
  });
  return saved;
}

function defaultVoiceWorkflowSettings(): VoiceWorkflowSettings {
  return {
    continueCaptureMode: false,
    autoSaveCaptureVoiceNotes: true,
    confirmBeforeSavingCapture: false,
    confirmSensitiveCapture: true,
    autoCreateHighConfidenceCalendarVoiceEvents: false,
    defaultMeetingDurationMinutes: 30,
    defaultReminderTime: "09:00",
    askBeforeRecurringEvents: true,
    updatedAt: new Date().toISOString()
  };
}

function loadVoiceWorkflowSettings(): VoiceWorkflowSettings {
  return {
    ...defaultVoiceWorkflowSettings(),
    ...readJsonFile<Partial<VoiceWorkflowSettings>>(voiceWorkflowSettingsPath, defaultVoiceWorkflowSettings())
  };
}

function saveVoiceWorkflowSettings(input: Partial<VoiceWorkflowSettings>): VoiceWorkflowSettings {
  const current = loadVoiceWorkflowSettings();
  const next: VoiceWorkflowSettings = {
    continueCaptureMode: typeof input.continueCaptureMode === "boolean" ? input.continueCaptureMode : current.continueCaptureMode,
    autoSaveCaptureVoiceNotes: typeof input.autoSaveCaptureVoiceNotes === "boolean" ? input.autoSaveCaptureVoiceNotes : current.autoSaveCaptureVoiceNotes,
    confirmBeforeSavingCapture: typeof input.confirmBeforeSavingCapture === "boolean" ? input.confirmBeforeSavingCapture : current.confirmBeforeSavingCapture,
    confirmSensitiveCapture: typeof input.confirmSensitiveCapture === "boolean" ? input.confirmSensitiveCapture : current.confirmSensitiveCapture,
    autoCreateHighConfidenceCalendarVoiceEvents: typeof input.autoCreateHighConfidenceCalendarVoiceEvents === "boolean" ? input.autoCreateHighConfidenceCalendarVoiceEvents : current.autoCreateHighConfidenceCalendarVoiceEvents,
    defaultMeetingDurationMinutes: typeof input.defaultMeetingDurationMinutes === "number" ? Math.max(5, Math.min(480, input.defaultMeetingDurationMinutes)) : current.defaultMeetingDurationMinutes,
    defaultReminderTime: typeof input.defaultReminderTime === "string" ? input.defaultReminderTime : current.defaultReminderTime,
    askBeforeRecurringEvents: typeof input.askBeforeRecurringEvents === "boolean" ? input.askBeforeRecurringEvents : current.askBeforeRecurringEvents,
    updatedAt: new Date().toISOString()
  };
  const saved = writeJsonFile(voiceWorkflowSettingsPath, next);
  localDb.appendActionEvent({
    module: "DexNest Voice",
    actionId: "voice.workflow.update_settings",
    eventType: "voice_workflow_settings_updated",
    status: "success",
    source: "module_ui",
    summary: "Updated DexNest Voice workflow settings.",
    metadataJson: {
      continueCaptureMode: saved.continueCaptureMode,
      autoSaveCaptureVoiceNotes: saved.autoSaveCaptureVoiceNotes,
      confirmBeforeSavingCapture: saved.confirmBeforeSavingCapture,
      confirmSensitiveCapture: saved.confirmSensitiveCapture,
      autoCreateHighConfidenceCalendarVoiceEvents: saved.autoCreateHighConfidenceCalendarVoiceEvents,
      defaultMeetingDurationMinutes: saved.defaultMeetingDurationMinutes,
      askBeforeRecurringEvents: saved.askBeforeRecurringEvents
    }
  });
  return saved;
}

function speechPythonPath(settings = loadSpeechSettings()): string | null {
  const configured = settings.pythonPath?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  if (existsSync(speechSidecarPythonPath)) {
    return speechSidecarPythonPath;
  }
  return resolvePythonPath();
}

function speechSidecarScript(): string {
  return [
    "import argparse, json, os, sys, time",
    "",
    "def finish(payload, code=0):",
    "    print(json.dumps(payload, ensure_ascii=False))",
    "    sys.exit(code)",
    "",
    "parser = argparse.ArgumentParser()",
    "parser.add_argument('--audio')",
    "parser.add_argument('--model', required=True)",
    "parser.add_argument('--model-root', required=True)",
    "parser.add_argument('--device', default='auto')",
    "parser.add_argument('--compute-type', default='auto')",
    "parser.add_argument('--language', default='en')",
    "parser.add_argument('--vad', default='1')",
    "parser.add_argument('--local-only', default='1')",
    "parser.add_argument('--check-only', action='store_true')",
    "args = parser.parse_args()",
    "started = time.time()",
    "try:",
    "    from faster_whisper import WhisperModel",
    "except Exception as exc:",
    "    finish({'ok': False, 'error': 'faster-whisper is not installed. Install with: python -m pip install faster-whisper', 'engine': 'faster_whisper'}, 0)",
    "",
    "def cuda_count():",
    "    try:",
    "        import ctranslate2",
    "        return int(ctranslate2.get_cuda_device_count())",
    "    except Exception:",
    "        return 0",
    "",
    "requested_device = args.device",
    "detected_cuda = cuda_count()",
    "device = 'cuda' if (requested_device == 'cuda' and detected_cuda > 0) else 'cpu'",
    "compute_type = args.compute_type",
    "if compute_type == 'auto':",
    "    compute_type = 'int8'",
    "try:",
    "    model_kwargs = {'device': device, 'compute_type': compute_type, 'local_files_only': (args.local_only == '1')}",
    "    model_root_has_files = bool(args.model_root and os.path.isdir(args.model_root) and any(os.scandir(args.model_root)))",
    "    if model_root_has_files or args.local_only != '1':",
    "        model_kwargs['download_root'] = args.model_root",
    "    model = WhisperModel(args.model, **model_kwargs)",
    "    if args.check_only:",
    "        finish({'ok': True, 'engine': 'faster_whisper', 'model': args.model, 'device': device, 'computeType': compute_type, 'installed': True, 'durationMs': int((time.time() - started) * 1000)})",
    "    if not args.audio or not os.path.exists(args.audio):",
    "        finish({'ok': False, 'error': 'Audio file was not provided.', 'engine': 'faster_whisper'}, 0)",
    "    segments, info = model.transcribe(args.audio, language=args.language or 'en', vad_filter=(args.vad == '1'))",
    "    text = ' '.join([segment.text.strip() for segment in segments]).strip()",
    "    finish({'ok': True, 'engine': 'faster_whisper', 'model': args.model, 'device': device, 'computeType': compute_type, 'language': getattr(info, 'language', args.language or 'en'), 'confidence': getattr(info, 'language_probability', None), 'transcript': text, 'durationMs': int((time.time() - started) * 1000)})",
    "except Exception as exc:",
    "    finish({'ok': False, 'error': str(exc), 'engine': 'faster_whisper', 'model': args.model, 'device': device, 'computeType': compute_type, 'durationMs': int((time.time() - started) * 1000)}, 0)"
  ].join("\n");
}

function speechSidecarPath(): string {
  ensureSpeechRoot();
  const scriptPath = join(speechTempRoot, "dexnest-faster-whisper-sidecar.py");
  writeFileSync(scriptPath, speechSidecarScript(), "utf8");
  return scriptPath;
}

function speechModelPath(modelName: string): string {
  return join(speechModelsRoot, modelName);
}

async function runSpeechSidecar(args: string[]): Promise<Record<string, unknown>> {
  const pythonPath = speechPythonPath();
  if (!pythonPath) {
    return { ok: false, error: "Python is required for faster-whisper. Install Python 3.12 and faster-whisper, or enable Windows fallback." };
  }
  const scriptPath = speechSidecarPath();
  const { stdout } = await execFileAsync(pythonPath, [scriptPath, ...args], speechTempRoot);
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Speech sidecar returned invalid JSON." };
  }
}

// --- Warm persistent faster-whisper worker (Phase 23A/B) -------------------
// A long-lived Python process loads the Whisper model once and stays warm, so
// mic clicks do not pay the ~1s model-load cost every time. Requests are simple
// newline-delimited JSON over stdin/stdout.
type SpeechEngineState =
  | "unavailable"
  | "starting"
  | "warming"
  | "ready"
  | "recording"
  | "transcribing"
  | "failed"
  | "paused_by_performance_mode";

interface SpeechWorkerDiagnostics {
  engine: SpeechEngine;
  model: string;
  device: string;
  computeType: string;
  loadLatencyMs: number | null;
  lastTranscriptionMs: number | null;
  lastError: string | null;
}

let speechWorker: ReturnType<typeof spawn> | null = null;
let speechWorkerReady = false;
let speechWorkerConfigKey = "";
let speechWorkerStdout = "";
let speechWorkerStarting: Promise<{ ok: boolean; error?: string }> | null = null;
let speechEngineStateValue: SpeechEngineState = "unavailable";
const speechWorkerPending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const speechWorkerDiag: SpeechWorkerDiagnostics = {
  engine: "faster_whisper",
  model: "base.en",
  device: "cpu",
  computeType: "int8",
  loadLatencyMs: null,
  lastTranscriptionMs: null,
  lastError: null
};

function speechEngineState(): SpeechEngineState {
  return speechEngineStateValue;
}

function speechWorkerScript(): string {
  return [
    "import json, os, sys, time",
    "def send(o):",
    "    sys.stdout.write(json.dumps(o, ensure_ascii=False) + '\\n'); sys.stdout.flush()",
    "cfg = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}",
    "started = time.time()",
    "try:",
    "    from faster_whisper import WhisperModel",
    "except Exception as exc:",
    "    send({'type': 'fatal', 'ok': False, 'error': 'faster-whisper is not installed. Install with: python -m pip install faster-whisper'}); sys.exit(0)",
    "def cuda_count():",
    "    try:",
    "        import ctranslate2; return int(ctranslate2.get_cuda_device_count())",
    "    except Exception: return 0",
    "req_device = cfg.get('device', 'cpu')",
    "device = 'cuda' if (req_device == 'cuda' and cuda_count() > 0) else 'cpu'",
    "compute = cfg.get('computeType', 'int8')",
    "if compute == 'auto': compute = 'int8'",
    "try:",
    "    kwargs = {'device': device, 'compute_type': compute, 'local_files_only': bool(cfg.get('localOnly', True))}",
    "    root = cfg.get('modelRoot')",
    "    if root and os.path.isdir(root) and any(os.scandir(root)): kwargs['download_root'] = root",
    "    elif not cfg.get('localOnly', True) and root: kwargs['download_root'] = root",
    "    model = WhisperModel(cfg.get('model', 'base.en'), **kwargs)",
    "except Exception as exc:",
    "    send({'type': 'fatal', 'ok': False, 'error': str(exc), 'device': device, 'computeType': compute}); sys.exit(0)",
    "send({'type': 'ready', 'ok': True, 'model': cfg.get('model', 'base.en'), 'device': device, 'computeType': compute, 'loadMs': int((time.time() - started) * 1000)})",
    "for line in sys.stdin:",
    "    line = line.strip()",
    "    if not line: continue",
    "    try: req = json.loads(line)",
    "    except Exception: continue",
    "    rid = req.get('id'); t = req.get('type')",
    "    if t == 'shutdown': break",
    "    if t == 'ping': send({'type': 'pong', 'id': rid, 'ok': True}); continue",
    "    if t == 'transcribe':",
    "        audio = req.get('audio'); st = time.time()",
    "        if not audio or not os.path.exists(audio):",
    "            send({'type': 'result', 'id': rid, 'ok': False, 'error': 'Audio file was not provided.'}); continue",
    "        try:",
    "            segments, info = model.transcribe(audio, language=req.get('language') or 'en', vad_filter=bool(req.get('vad', True)))",
    "            text = ' '.join(s.text.strip() for s in segments).strip()",
    "            send({'type': 'result', 'id': rid, 'ok': True, 'transcript': text, 'language': getattr(info, 'language', req.get('language') or 'en'), 'confidence': getattr(info, 'language_probability', None), 'transcriptionMs': int((time.time() - st) * 1000)})",
    "        except Exception as exc:",
    "            send({'type': 'result', 'id': rid, 'ok': False, 'error': str(exc), 'transcriptionMs': int((time.time() - st) * 1000)})"
  ].join("\n");
}

function speechWorkerScriptPath(): string {
  ensureSpeechRoot();
  const scriptPath = join(speechTempRoot, "dexnest-faster-whisper-worker.py");
  writeFileSync(scriptPath, speechWorkerScript(), "utf8");
  return scriptPath;
}

function handleSpeechWorkerMessage(message: Record<string, unknown>, onReady: (result: { ok: boolean; error?: string }) => void): void {
  const type = String(message.type ?? "");
  if (type === "ready") {
    speechWorkerReady = true;
    speechEngineStateValue = "ready";
    speechWorkerDiag.model = String(message.model ?? speechWorkerDiag.model);
    speechWorkerDiag.device = String(message.device ?? speechWorkerDiag.device);
    speechWorkerDiag.computeType = String(message.computeType ?? speechWorkerDiag.computeType);
    speechWorkerDiag.loadLatencyMs = typeof message.loadMs === "number" ? message.loadMs : speechWorkerDiag.loadLatencyMs;
    speechWorkerDiag.lastError = null;
    onReady({ ok: true });
    return;
  }
  if (type === "fatal") {
    speechWorkerReady = false;
    speechEngineStateValue = "failed";
    speechWorkerDiag.lastError = String(message.error ?? "faster-whisper worker failed to start.");
    onReady({ ok: false, error: speechWorkerDiag.lastError });
    stopSpeechWorker();
    return;
  }
  const id = typeof message.id === "string" ? message.id : null;
  if (id && speechWorkerPending.has(id)) {
    const pending = speechWorkerPending.get(id)!;
    clearTimeout(pending.timer);
    speechWorkerPending.delete(id);
    pending.resolve(message);
  }
}

function stopSpeechWorker(): void {
  if (speechWorker) {
    try { speechWorker.stdin?.write(`${JSON.stringify({ type: "shutdown" })}\n`); } catch { /* ignore */ }
    try { speechWorker.kill(); } catch { /* ignore */ }
  }
  speechWorker = null;
  speechWorkerReady = false;
  speechWorkerStarting = null;
  speechWorkerStdout = "";
  for (const pending of speechWorkerPending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Speech worker stopped."));
  }
  speechWorkerPending.clear();
  if (speechEngineStateValue !== "failed") {
    speechEngineStateValue = "unavailable";
  }
}

function startSpeechWorker(settings = loadSpeechSettings()): Promise<{ ok: boolean; error?: string }> {
  const configKey = `${settings.modelName}|${settings.device}|${settings.computeType}`;
  if (speechWorker && speechWorkerReady && speechWorkerConfigKey === configKey) {
    return Promise.resolve({ ok: true });
  }
  if (speechWorkerStarting && speechWorkerConfigKey === configKey) {
    return speechWorkerStarting;
  }
  // Settings changed or no worker — restart cleanly.
  stopSpeechWorker();
  const pythonPath = speechPythonPath(settings);
  if (!pythonPath) {
    speechEngineStateValue = "failed";
    speechWorkerDiag.lastError = "Python with faster-whisper was not found.";
    return Promise.resolve({ ok: false, error: speechWorkerDiag.lastError });
  }

  speechWorkerConfigKey = configKey;
  speechWorkerDiag.engine = "faster_whisper";
  speechEngineStateValue = "starting";
  const config = {
    model: settings.modelName,
    modelRoot: speechModelsRoot,
    device: settings.device,
    computeType: settings.computeType,
    localOnly: true
  };
  const scriptPath = speechWorkerScriptPath();

  speechWorkerStarting = new Promise<{ ok: boolean; error?: string }>((resolvePromise) => {
    let settled = false;
    const resolveOnce = (result: { ok: boolean; error?: string }) => {
      if (!settled) {
        settled = true;
        resolvePromise(result);
      }
    };
    try {
      const child = spawn(pythonPath, [scriptPath, JSON.stringify(config)], { cwd: speechTempRoot, windowsHide: true });
      speechWorker = child;
      speechEngineStateValue = "warming";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        speechWorkerStdout += chunk;
        let newlineIndex = speechWorkerStdout.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = speechWorkerStdout.slice(0, newlineIndex).trim();
          speechWorkerStdout = speechWorkerStdout.slice(newlineIndex + 1);
          if (line) {
            try {
              handleSpeechWorkerMessage(JSON.parse(line) as Record<string, unknown>, resolveOnce);
            } catch { /* ignore malformed line */ }
          }
          newlineIndex = speechWorkerStdout.indexOf("\n");
        }
      });
      child.on("error", (error: Error) => {
        speechWorkerDiag.lastError = error.message;
        speechEngineStateValue = "failed";
        resolveOnce({ ok: false, error: error.message });
        stopSpeechWorker();
      });
      child.on("exit", () => {
        if (speechWorker === child) {
          const wasReady = speechWorkerReady;
          stopSpeechWorker();
          if (!wasReady) {
            resolveOnce({ ok: false, error: speechWorkerDiag.lastError ?? "Speech worker exited before becoming ready." });
          }
        }
      });
      // Safety: if no "ready" within 60s, treat as failed.
      setTimeout(() => resolveOnce({ ok: false, error: "Speech worker did not warm up in time." }), 60000);
    } catch (error) {
      speechEngineStateValue = "failed";
      const message = error instanceof Error ? error.message : "Failed to start speech worker.";
      speechWorkerDiag.lastError = message;
      resolveOnce({ ok: false, error: message });
    }
  });
  return speechWorkerStarting;
}

async function warmSpeechEngine(): Promise<{ ok: boolean; error?: string; engineState: SpeechEngineState; diagnostics: SpeechWorkerDiagnostics }> {
  const settings = loadSpeechSettings();
  // Part K: never warm/record while paused by Performance Mode — UNLESS wake word is
  // enabled, in which case speech must stay available so wake commands can transcribe.
  if (performanceModeState().enabled && settings.pauseInPerformanceMode && !loadAmbientVoiceSettings().wakeWordEnabled) {
    speechEngineStateValue = "paused_by_performance_mode";
    return { ok: false, error: "Speech is paused by Performance Mode.", engineState: speechEngineStateValue, diagnostics: speechWorkerDiag };
  }
  if (settings.speechEngine !== "faster_whisper") {
    return { ok: false, error: "Warm engine only applies to faster-whisper.", engineState: speechEngineStateValue, diagnostics: speechWorkerDiag };
  }
  const result = await startSpeechWorker(settings);
  return { ok: result.ok, error: result.error, engineState: speechEngineStateValue, diagnostics: speechWorkerDiag };
}

// Transcribe via the warm worker, starting/warming it on demand. Retries once.
async function transcribeWithWarmWorker(audioPath: string, language: string, vad: boolean, settings = loadSpeechSettings()): Promise<Record<string, unknown>> {
  const attempt = async (): Promise<Record<string, unknown>> => {
    const started = await startSpeechWorker(settings);
    if (!started.ok || !speechWorker || !speechWorkerReady) {
      return { ok: false, error: started.error ?? "Speech worker is not ready." };
    }
    speechEngineStateValue = "transcribing";
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<Record<string, unknown>>((resolvePromise) => {
      const timer = setTimeout(() => {
        speechWorkerPending.delete(id);
        resolvePromise({ ok: false, error: "Speech transcription timed out." });
      }, 120000);
      speechWorkerPending.set(id, { resolve: resolvePromise, reject: (error) => resolvePromise({ ok: false, error: error.message }), timer });
      try {
        speechWorker!.stdin?.write(`${JSON.stringify({ type: "transcribe", id, audio: audioPath, language, vad })}\n`);
      } catch (error) {
        clearTimeout(timer);
        speechWorkerPending.delete(id);
        resolvePromise({ ok: false, error: error instanceof Error ? error.message : "Failed to send transcription request." });
      }
    });
  };

  let result = await attempt();
  if (result.ok !== true) {
    // Retry once before giving up (Part A.8) — restart the worker first.
    speechWorkerDiag.lastError = String(result.error ?? "Speech transcription failed.");
    stopSpeechWorker();
    result = await attempt();
  }
  if (result.ok === true) {
    speechEngineStateValue = "ready";
    speechWorkerDiag.lastTranscriptionMs = typeof result.transcriptionMs === "number" ? result.transcriptionMs : speechWorkerDiag.lastTranscriptionMs;
    speechWorkerDiag.lastError = null;
  } else {
    speechWorkerDiag.lastError = String(result.error ?? "Speech transcription failed.");
  }
  return result;
}

// --- Real local wake-word engine ("Nest") — Phase 23.9 --------------------
// Spawns the openWakeWord sidecar (sidecars/wake-word). When dependencies or a
// local "Nest" model are missing it reports an honest engine_missing status with
// the exact blocker; it never fakes detection with continuous Whisper.
const wakeWordSidecarScriptPath = join(repoRoot, "sidecars", "wake-word", "wake_word_sidecar.py");
const wakeWordModelsDir = join(repoRoot, "sidecars", "wake-word", "models");

type WakeEngineRuntimeStatus =
  | "disabled"
  | "starting"
  | "listening_for_nest"
  | "wake_detected"
  | "recording_command"
  | "paused_by_performance_mode"
  | "engine_missing"
  | "error";

interface WakeEngineState {
  status: WakeEngineRuntimeStatus;
  installStatus: "unknown" | "ready" | "missing_dependencies" | "missing_model";
  lastError: string;
  detectionsCount: number;
  lastDetectedAt: number | null;
  scriptPath: string;
}

let wakeWorker: ReturnType<typeof spawn> | null = null;
let wakeWorkerStdout = "";
let wakeEngineRuntime: WakeEngineState = {
  status: "disabled",
  installStatus: "unknown",
  lastError: "",
  detectionsCount: 0,
  lastDetectedAt: null,
  scriptPath: wakeWordSidecarScriptPath
};

function wakeEngineState(): WakeEngineState {
  const settings = loadAmbientVoiceSettings();
  let status = wakeEngineRuntime.status;
  if (!settings.wakeWordEnabled) {
    status = "disabled";
  }
  // Wake word is intentionally NOT paused by Performance Mode.
  return { ...wakeEngineRuntime, status };
}

function logWakeEngineMeta(eventType: string, status: DexNestEventStatus, summary: string, metadata: Record<string, unknown> = {}, errorMessage: string | null = null): void {
  localDb.appendActionEvent({
    module: "DexNest Voice",
    actionId: "voice.wake_word",
    eventType,
    status,
    source: "ambient_wake_word",
    summary,
    metadataJson: { provider: "openwakeword", ...metadata },
    errorMessage
  });
}

async function checkWakeEngine(): Promise<{ ok: boolean; report: Record<string, unknown>; error?: string }> {
  const pythonPath = speechPythonPath();
  if (!pythonPath) {
    wakeEngineRuntime.installStatus = "missing_dependencies";
    wakeEngineRuntime.lastError = "Python with the wake sidecar is not available.";
    return { ok: false, report: {}, error: wakeEngineRuntime.lastError };
  }
  if (!existsSync(wakeWordSidecarScriptPath)) {
    wakeEngineRuntime.installStatus = "missing_dependencies";
    wakeEngineRuntime.lastError = "Wake-word sidecar script is missing.";
    return { ok: false, report: {}, error: wakeEngineRuntime.lastError };
  }
  try {
    const settings = loadAmbientVoiceSettings();
    const { stdout } = await execFileAsync(pythonPath, [
      wakeWordSidecarScriptPath,
      "--check",
      "--phrase", settings.wakePhraseMode ?? "hey_jarvis",
      "--model-path", settings.wakeCustomModelPath ?? "",
      "--models-dir", wakeWordModelsDir
    ], repoRoot, 20000);
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
    const report = JSON.parse(line) as Record<string, unknown>;
    const ok = report.ok === true;
    const deps = (report.deps ?? {}) as Record<string, boolean>;
    wakeEngineRuntime.installStatus = ok ? "ready" : (!deps.openwakeword || !deps.sounddevice ? "missing_dependencies" : "missing_model");
    wakeEngineRuntime.lastError = ok ? "" : String(report.error ?? "Wake engine is not available.");
    return { ok, report, error: ok ? undefined : wakeEngineRuntime.lastError };
  } catch (error) {
    wakeEngineRuntime.installStatus = "missing_dependencies";
    wakeEngineRuntime.lastError = error instanceof Error ? error.message : "Wake engine check failed.";
    return { ok: false, report: {}, error: wakeEngineRuntime.lastError };
  }
}

function handleWakeWorkerLine(line: string): void {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = String(message.type ?? "");
  if (type === "ready") {
    wakeEngineRuntime.status = "listening_for_nest";
    wakeEngineRuntime.installStatus = "ready";
    wakeEngineRuntime.lastError = "";
    logWakeEngineMeta("wake_engine_started", "success", "Wake engine is listening for the wake word.", { model: message.model ?? null });
    return;
  }
  if (type === "fatal") {
    wakeEngineRuntime.status = "engine_missing";
    wakeEngineRuntime.lastError = String(message.error ?? "Wake engine failed to start.");
    logWakeEngineMeta("wake_engine_failed", "failed", "Wake engine could not start.", {}, wakeEngineRuntime.lastError);
    stopWakeEngine();
    return;
  }
  if (type === "wake") {
    wakeEngineRuntime.status = "wake_detected";
    wakeEngineRuntime.detectionsCount += 1;
    wakeEngineRuntime.lastDetectedAt = Date.now();
    // Metadata only — no audio, no transcript.
    logWakeEngineMeta("wake_detected", "success", "Wake word detected.", { score: typeof message.score === "number" ? message.score : null, detectionsCount: wakeEngineRuntime.detectionsCount });
    // Tell the renderer to run the shared Speech Service + routing.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dexnest:wake-detected", { source: "ambient_wake_word", score: typeof message.score === "number" ? message.score : null });
    }
  }
}

function startWakeEngine(): { ok: boolean; status: WakeEngineRuntimeStatus; error?: string } {
  const settings = loadAmbientVoiceSettings();
  if (!settings.wakeWordEnabled) {
    wakeEngineRuntime.status = "disabled";
    return { ok: false, status: "disabled", error: "Wake word is disabled." };
  }
  if (wakeWorker) {
    return { ok: true, status: wakeEngineRuntime.status };
  }
  const pythonPath = speechPythonPath();
  if (!pythonPath || !existsSync(wakeWordSidecarScriptPath)) {
    wakeEngineRuntime.status = "engine_missing";
    wakeEngineRuntime.installStatus = "missing_dependencies";
    wakeEngineRuntime.lastError = "Wake engine sidecar/python is unavailable.";
    return { ok: false, status: "engine_missing", error: wakeEngineRuntime.lastError };
  }
  wakeEngineRuntime.status = "starting";
  wakeWorkerStdout = "";
  const deviceId = settings.selectedWakeMicDeviceId ?? "";
  const child = spawn(pythonPath, [
    wakeWordSidecarScriptPath,
    "--phrase", settings.wakePhraseMode ?? "hey_jarvis",
    "--model-path", settings.wakeCustomModelPath ?? "",
    "--sensitivity", String(settings.wakeWordSensitivity ?? 0.5),
    "--models-dir", wakeWordModelsDir,
    "--cooldown-ms", String(settings.wakeCooldownMs ?? 1500),
    ...(deviceId ? ["--device", deviceId] : [])
  ], { cwd: repoRoot, windowsHide: true });
  wakeWorker = child;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    wakeWorkerStdout += chunk;
    let index = wakeWorkerStdout.indexOf("\n");
    while (index >= 0) {
      const line = wakeWorkerStdout.slice(0, index).trim();
      wakeWorkerStdout = wakeWorkerStdout.slice(index + 1);
      if (line) {
        handleWakeWorkerLine(line);
      }
      index = wakeWorkerStdout.indexOf("\n");
    }
  });
  child.on("error", (error: Error) => {
    wakeEngineRuntime.status = "engine_missing";
    wakeEngineRuntime.lastError = error.message;
    stopWakeEngine();
  });
  child.on("exit", () => {
    if (wakeWorker === child) {
      wakeWorker = null;
      if (wakeEngineRuntime.status !== "disabled" && wakeEngineRuntime.status !== "engine_missing") {
        wakeEngineRuntime.status = loadAmbientVoiceSettings().wakeWordEnabled ? "error" : "disabled";
      }
    }
  });
  return { ok: true, status: "starting" };
}

function stopWakeEngine(): void {
  if (wakeWorker) {
    try { wakeWorker.stdin?.write(`${JSON.stringify({ type: "shutdown" })}\n`); } catch { /* ignore */ }
    try { wakeWorker.kill(); } catch { /* ignore */ }
  }
  wakeWorker = null;
  wakeWorkerStdout = "";
  if (wakeEngineRuntime.status !== "engine_missing") {
    wakeEngineRuntime.status = "disabled";
  }
  logWakeEngineMeta("wake_engine_stopped", "success", "Wake engine stopped.");
}

// Pause/restart the wake engine to match enabled + Performance Mode.
function reconcileWakeEngine(): void {
  const settings = loadAmbientVoiceSettings();
  if (settings.wakeWordEnabled) {
    startWakeEngine();
  } else {
    stopWakeEngine();
  }
}

async function checkSpeechModel(install = false): Promise<SpeechModelStatus> {
  ensureSpeechRoot();
  const settings = loadSpeechSettings();
  const pythonPath = speechPythonPath(settings);
  if (settings.speechEngine === "windows_fallback") {
    return {
      ok: true,
      installed: true,
      message: "Windows fallback is selected.",
      engine: "windows_fallback",
      model: settings.modelName,
      modelPath: speechModelsRoot,
      pythonPath,
      deviceDetected: "unknown",
      fasterWhisperAvailable: false,
      lastLatencyMs: speechLastLatencyMs,
      lastError: speechLastError
    };
  }
  if (settings.speechEngine === "whisper_cpp") {
    return {
      ok: false,
      installed: false,
      message: "whisper.cpp is a placeholder backend in this build. Use faster-whisper or Windows fallback.",
      engine: "whisper_cpp",
      model: settings.modelName,
      modelPath: speechModelsRoot,
      pythonPath,
      deviceDetected: "unknown",
      fasterWhisperAvailable: false,
      lastLatencyMs: speechLastLatencyMs,
      lastError: "whisper.cpp backend is not configured."
    };
  }
  if (!pythonPath) {
    return {
      ok: false,
      installed: false,
      message: "Python was not found. Install Python and faster-whisper, or enable Windows fallback.",
      engine: "faster_whisper",
      model: settings.modelName,
      modelPath: speechModelsRoot,
      pythonPath: null,
      deviceDetected: "unknown",
      fasterWhisperAvailable: false,
      lastLatencyMs: speechLastLatencyMs,
      lastError: "Python not found."
    };
  }
  const result = await runSpeechSidecar([
    "--model", settings.modelName,
    "--model-root", speechModelsRoot,
    "--device", settings.device,
    "--compute-type", settings.computeType,
    "--language", "en",
    "--local-only", install ? "0" : "1",
    "--check-only"
  ]);
  const ok = result.ok === true;
  const device = String(result.device ?? "unknown");
  const message = ok
    ? `${settings.modelName} is ready on ${device}.`
    : String(result.error ?? (install ? "Model install failed." : "Model is missing or faster-whisper is not installed."));
  return {
    ok,
    installed: ok,
    message,
    engine: "faster_whisper",
    model: settings.modelName,
    modelPath: speechModelsRoot,
    pythonPath,
    deviceDetected: device === "cuda" ? "cuda" : device === "cpu" ? "cpu" : "unknown",
    fasterWhisperAvailable: ok || !/not installed/i.test(message),
    lastLatencyMs: typeof result.durationMs === "number" ? result.durationMs : speechLastLatencyMs,
    lastError: ok ? null : message
  };
}

function speechServiceState(status?: SpeechModelStatus): SpeechServiceState {
  const settings = loadSpeechSettings();
  return {
    settingsPath: speechSettingsPath,
    modelRoot: speechModelsRoot,
    debugAudioRoot: speechDebugAudioRoot,
    settings,
    modelStatus: status ?? {
      ok: false,
      installed: existsSync(speechModelsRoot) && readdirSync(speechModelsRoot).length > 0,
      message: "Run Check local model for current status.",
      engine: settings.speechEngine,
      model: settings.modelName,
      modelPath: speechModelPath(settings.modelName),
      pythonPath: speechPythonPath(settings),
      deviceDetected: "unknown",
      fasterWhisperAvailable: false,
      lastLatencyMs: speechLastLatencyMs,
      lastError: speechLastError
    },
    windowsFallbackAvailable: process.platform === "win32",
    performancePaused: performanceModeState().enabled && settings.pauseInPerformanceMode && !loadAmbientVoiceSettings().wakeWordEnabled,
    engineState: speechEngineState(),
    warmDiagnostics: { ...speechWorkerDiag }
  };
}

function sensitiveTranscriptCategory(transcript: string): "sensitive" | "personal" | "none" {
  return /\b(sin|social insurance|passport|health card|work permit|permit number|document number|uci)\b/i.test(transcript)
    ? "sensitive"
    : transcript.trim() ? "personal" : "none";
}

async function transcribeSpeechAudio(input: {
  audioBytes?: ArrayBuffer | Uint8Array | number[];
  mimeType?: string;
  source?: DexNestActionTrigger;
  sourceModule?: string;
  language?: string;
  manualOverride?: boolean;
}): Promise<SpeechTranscriptionResult & { speechState: SpeechServiceState }> {
  const startedAt = Date.now();
  ensureSpeechRoot();
  const settings = loadSpeechSettings();
  const source = input.source ?? "module_ui";
  if (performanceModeState().enabled && settings.pauseInPerformanceMode && input.manualOverride !== true) {
    const result: SpeechTranscriptionResult = {
      transcript: "",
      engine: settings.speechEngine,
      model: settings.modelName,
      language: input.language ?? "en",
      durationMs: Date.now() - startedAt,
      status: "failed",
      error: "Speech is paused by Performance Mode."
    };
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId: "speech.transcribe",
      eventType: "speech_transcription_skipped",
      status: "skipped",
      source,
      summary: result.error ?? "Speech is paused by Performance Mode.",
      metadataJson: { engine: result.engine, model: result.model, sourceModule: input.sourceModule ?? null, reason: "performance_mode" },
      durationMs: result.durationMs
    });
    return { ...result, speechState: speechServiceState() };
  }
  const raw = input.audioBytes instanceof Uint8Array
    ? Buffer.from(input.audioBytes)
    : Array.isArray(input.audioBytes)
      ? Buffer.from(input.audioBytes)
      : input.audioBytes
        ? Buffer.from(input.audioBytes)
        : Buffer.alloc(0);
  if (raw.byteLength === 0) {
    const result: SpeechTranscriptionResult = {
      transcript: "",
      engine: settings.speechEngine,
      model: settings.modelName,
      language: input.language ?? "en",
      durationMs: Date.now() - startedAt,
      status: "failed",
      error: "No microphone audio was captured."
    };
    return { ...result, speechState: speechServiceState() };
  }
  const extension = /wav/i.test(input.mimeType ?? "") ? "wav" : /mp4|m4a/i.test(input.mimeType ?? "") ? "m4a" : "webm";
  const audioPath = join(settings.keepAudioForDebug ? speechDebugAudioRoot : speechTempRoot, `speech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
  writeFileSync(audioPath, raw);
  let result: SpeechTranscriptionResult;
  try {
    if (settings.speechEngine === "windows_fallback") {
      result = {
        transcript: "",
        engine: "windows_fallback",
        model: "windows",
        language: input.language ?? "en",
        durationMs: Date.now() - startedAt,
        status: "failed",
        error: "Windows fallback requires the DexNest Windows dictation bridge."
      };
    } else if (settings.speechEngine === "whisper_cpp") {
      result = {
        transcript: "",
        engine: "whisper_cpp",
        model: settings.modelName,
        language: input.language ?? "en",
        durationMs: Date.now() - startedAt,
        status: "failed",
        error: "whisper.cpp is not configured yet. Use faster-whisper or Windows fallback."
      };
    } else {
      // Phase 23A/B: transcribe via the warm persistent worker (loads the model
      // once, retries once on failure). Fallback to Windows only happens when
      // the user explicitly enabled it — never silently/randomly.
      const sidecar = await transcribeWithWarmWorker(audioPath, input.language ?? "en", settings.vadEnabled, settings);
      const ok = sidecar.ok === true;
      if (ok) {
        result = {
          transcript: String(sidecar.transcript ?? "").trim(),
          engine: "faster_whisper",
          model: settings.modelName,
          language: String(sidecar.language ?? input.language ?? "en"),
          durationMs: typeof sidecar.transcriptionMs === "number" ? sidecar.transcriptionMs : Date.now() - startedAt,
          confidence: typeof sidecar.confidence === "number" ? sidecar.confidence : undefined,
          status: "success",
          error: undefined
        };
      } else if (settings.fallbackToWindows) {
        result = {
          transcript: "",
          engine: "windows_fallback",
          model: "windows",
          language: input.language ?? "en",
          durationMs: Date.now() - startedAt,
          status: "failed",
          error: `faster-whisper failed, Windows fallback is enabled but the Windows dictation bridge is not wired for transcription. faster-whisper error: ${String(sidecar.error ?? "unknown")}`
        };
      } else {
        result = {
          transcript: "",
          engine: "faster_whisper",
          model: settings.modelName,
          language: input.language ?? "en",
          durationMs: Date.now() - startedAt,
          status: "failed",
          error: String(sidecar.error ?? "faster-whisper transcription failed.")
        };
      }
    }
  } finally {
    if (!settings.keepAudioForDebug && existsSync(audioPath)) {
      unlinkSync(audioPath);
    }
  }
  speechLastLatencyMs = result.durationMs;
  speechLastError = result.error ?? null;
  localDb.appendActionEvent({
    module: "DexNest Voice",
    actionId: "speech.transcribe",
    eventType: result.status === "success" ? "speech_transcribed" : "speech_transcription_failed",
    status: result.status,
    source,
    summary: result.status === "success" ? "Transcribed local microphone audio." : "Speech transcription failed.",
    metadataJson: {
      engine: result.engine,
      model: result.model,
      language: result.language,
      sourceModule: input.sourceModule ?? null,
      transcriptLength: result.transcript.length,
      sensitivity: sensitiveTranscriptCategory(result.transcript),
      debugAudioKept: settings.keepAudioForDebug,
      fallbackAvailable: settings.fallbackToWindows
    },
    errorMessage: result.error ?? null,
    durationMs: Date.now() - startedAt
  });
  return { ...result, speechState: speechServiceState() };
}

// --- Trusted sensitive-access session (Phase 18.6) --------------------------
interface AssistantSecuritySettings {
  trustedSessionEnabled: boolean;
  autoRevealWhileUnlocked: boolean;
  sessionTimeoutMinutes: number;
  speakSensitiveAnswers: boolean;
  lockOnAppClose: boolean;
}

const allowedSessionTimeouts = [5, 10, 15, 30];

function defaultAssistantSecuritySettings(): AssistantSecuritySettings {
  return {
    trustedSessionEnabled: true,
    autoRevealWhileUnlocked: true,
    sessionTimeoutMinutes: 10,
    speakSensitiveAnswers: false,
    lockOnAppClose: true
  };
}

function loadAssistantSecuritySettings(): AssistantSecuritySettings {
  return {
    ...defaultAssistantSecuritySettings(),
    ...readJsonFile<Partial<AssistantSecuritySettings>>(assistantSecuritySettingsPath, defaultAssistantSecuritySettings())
  };
}

function updateAssistantSecuritySettings(input: Partial<AssistantSecuritySettings>): AssistantSecuritySettings {
  const current = loadAssistantSecuritySettings();
  const timeout = Number(input.sessionTimeoutMinutes);
  const next: AssistantSecuritySettings = {
    trustedSessionEnabled: typeof input.trustedSessionEnabled === "boolean" ? input.trustedSessionEnabled : current.trustedSessionEnabled,
    autoRevealWhileUnlocked: typeof input.autoRevealWhileUnlocked === "boolean" ? input.autoRevealWhileUnlocked : current.autoRevealWhileUnlocked,
    sessionTimeoutMinutes: allowedSessionTimeouts.includes(timeout) ? timeout : current.sessionTimeoutMinutes,
    speakSensitiveAnswers: typeof input.speakSensitiveAnswers === "boolean" ? input.speakSensitiveAnswers : current.speakSensitiveAnswers,
    lockOnAppClose: typeof input.lockOnAppClose === "boolean" ? input.lockOnAppClose : current.lockOnAppClose
  };
  // If the trusted session is disabled, lock immediately.
  if (!next.trustedSessionEnabled) {
    trustedSessionExpiresAt = null;
  }
  return writeJsonFile(assistantSecuritySettingsPath, next);
}

// A trusted session is active only when enabled, established (timer set), and
// not yet expired. The Secure Vault being unlocked makes establishing one a
// one-click action but does not by itself bypass the timeout.
function isTrustedSessionActive(): boolean {
  const settings = loadAssistantSecuritySettings();
  if (!settings.trustedSessionEnabled) {
    return false;
  }
  return trustedSessionExpiresAt !== null && Date.now() < trustedSessionExpiresAt;
}

function assistantSecurityState(): {
  settings: AssistantSecuritySettings;
  sessionUnlocked: boolean;
  sessionExpiresAt: number | null;
  secureVaultUnlocked: boolean;
  secureVaultSetup: boolean;
} {
  const active = isTrustedSessionActive();
  return {
    settings: loadAssistantSecuritySettings(),
    sessionUnlocked: active,
    // A non-finite expiry (on_app_exit mode) is reported as null = "no countdown,
    // unlocked for this app session".
    sessionExpiresAt: active && Number.isFinite(trustedSessionExpiresAt) ? trustedSessionExpiresAt : null,
    secureVaultUnlocked: secureVaultKey !== null,
    secureVaultSetup: existsSync(secureVaultPath)
  };
}

// Establish a trusted session by reusing Secure Vault auth. If the Vault is
// already unlocked, no password is required; otherwise the master password is
// validated through the existing Secure Vault mechanism. The password is never
// stored or logged.
function unlockTrustedSession(masterPassword?: string): { ok: boolean; error?: string } {
  const settings = loadAssistantSecuritySettings();
  if (!settings.trustedSessionEnabled) {
    return { ok: false, error: "Trusted sensitive session is disabled in settings." };
  }
  if (secureVaultKey === null) {
    const file = loadSecureVaultFile();
    if (!file) {
      return { ok: false, error: "Set up the DexNest Secure Vault first to use a trusted session." };
    }
    if (!masterPassword) {
      return { ok: false, error: "Enter your Secure Vault master password to unlock." };
    }
    try {
      const key = deriveSecureVaultKey(masterPassword, file.kdf);
      verifySecureVaultKey(file, key);
      // Unlock the actual Secure Vault too. The trusted session uses the same
      // master password, and Vault-stored secrets (e.g. the Govee API key) plus
      // sensitive answers both require the live vault key. The vault keeps its
      // own auto-lock timer.
      secureVaultKey = key;
      scheduleSecureVaultAutoLock(file.settings.autoLockMinutes);
    } catch {
      return { ok: false, error: "Invalid master password." };
    }
  }
  // In the default "on_app_exit" lock mode the sensitive session also stays open
  // for the whole app session (no timed expiry) until manual lock or full quit.
  trustedSessionExpiresAt = secureVaultLockMode() === "timer"
    ? Date.now() + settings.sessionTimeoutMinutes * 60 * 1000
    : Number.POSITIVE_INFINITY;
  return { ok: true };
}

function lockTrustedSession(): void {
  trustedSessionExpiresAt = null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testOllamaConnection(input: { ollamaUrl?: string; ollamaModel?: string }): Promise<{ ok: boolean; models?: string[]; modelAvailable?: boolean; error?: string }> {
  const settings = loadAssistantSettings();
  const url = normalizeOllamaUrl(input.ollamaUrl ?? settings.ollamaUrl, settings.ollamaUrl);
  const model = (typeof input.ollamaModel === "string" && input.ollamaModel.trim() ? input.ollamaModel.trim() : settings.ollamaModel);
  try {
    const response = await fetchWithTimeout(`${url}/api/tags`, { method: "GET" }, 4000);
    if (!response.ok) {
      return { ok: false, error: `Ollama responded with HTTP ${response.status}.` };
    }
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = Array.isArray(data.models) ? data.models.map((item) => item.name ?? "").filter(Boolean) : [];
    const modelAvailable = models.some((name) => name === model || name.startsWith(`${model.split(":")[0]}:`) || name === `${model}:latest`);
    return { ok: true, models, modelAvailable };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "AbortError" ? "Ollama did not respond in time." : error.message) : "Ollama connection failed.";
    return { ok: false, error: message };
  }
}

function assistantIntentPrompt(query: string): string {
  // Force strict JSON only. The model only classifies; DexNest derives the
  // actionId and params deterministically and validates everything.
  return [
    "You are DexNest Assistant's local intent classifier. You run fully offline.",
    "Classify the user's request into exactly one intent and return STRICT JSON only.",
    "Do not add explanations outside JSON. Do not execute anything. Do not invent secrets.",
    "",
    "Allowed intents:",
    "- smart_lookup: asking for a specific value from their own documents (passport NUMBER, work permit number, SIN, UCI, health card number, expiry date).",
    "- finder_search: asking WHERE a physical item is (where is/where did I put my passport, charger, what is in the black drawer).",
    "- search_query: find/open a document or file (find my passport document, search work permit, find the PDF about taxes, open my latest resume).",
    "- calendar_create_candidate: add/schedule/remind about an event (add meeting with Tim tomorrow at 3, remind me to call Tim next Friday, birthday in 3 days).",
    "- calendar_show_today: ask what is on today's calendar or show today's events.",
    "- calendar_show_upcoming: ask for upcoming calendar events, tomorrow, or next event.",
    "- drop_send_clipboard: send clipboard or current file to phone.",
    "- open_module: open a DexNest module/screen.",
    "- dev_run_command: run a dev command (typecheck, build, test, start).",
    "- journal_open_today: open today's journal.",
    "- capture_note: save/remember a note, add to inbox.",
    "- external_device_control: control configured local external devices like Govee lights or lamps (turn on room lights, set room lights to 40 percent, make lights blue).",
    "- unknown: anything else.",
    "",
    "Distinctions:",
    "- 'Where is my passport' = finder_search. 'What is my passport number' = smart_lookup. 'Find my passport document' = search_query.",
    "",
    "targetModule must be one of: Search, Finder, Calendar, Drop, Dev, Journal, Capture, External Devices, Command, Unknown.",
    "sensitivity: 'sensitive' for passport/SIN/UCI/work permit/health card numbers or expiry; 'personal' for personal but non-secret; otherwise 'none'.",
    "requiresConfirmation: true for calendar/drop/dev/capture or any sensitive lookup.",
    "",
    "Return ONLY this JSON shape:",
    '{"intent":"","targetModule":"","actionId":"","params":{},"confidence":"high|medium|low","sensitivity":"none|personal|sensitive","requiresConfirmation":true,"explanation":"short safe explanation"}',
    "",
    `User request: ${JSON.stringify(query)}`
  ].join("\n");
}

async function runOllamaIntent(input: { query?: unknown }): Promise<{ ok: boolean; intent?: Record<string, unknown>; error?: string }> {
  if (performanceModePauses("assistant")) {
    localDb.appendActionEvent({
      module: "DexNest Assistant",
      actionId: "assistant.llm_intent",
      eventType: "assistant_ollama_skipped",
      status: "skipped",
      source: "module_ui",
      summary: "Assistant local LLM request skipped because Performance Mode is active.",
      metadataJson: { reason: "performance_mode" }
    });
    return { ok: false, error: "Assistant local LLM paused by Performance Mode." };
  }
  const settings = loadAssistantSettings();
  if (!settings.localIntentEngineEnabled) {
    return { ok: false, error: "Local intent engine is disabled." };
  }
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return { ok: false, error: "Empty assistant query." };
  }

  try {
    const response = await fetchWithTimeout(
      `${settings.ollamaUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.ollamaModel,
          prompt: assistantIntentPrompt(query),
          format: "json",
          stream: false,
          options: { temperature: 0 }
        })
      },
      20000
    );
    if (!response.ok) {
      return { ok: false, error: `Ollama responded with HTTP ${response.status}.` };
    }
    const data = (await response.json()) as { response?: string };
    const rawJson = typeof data.response === "string" ? data.response.trim() : "";
    if (!rawJson) {
      return { ok: false, error: "Ollama returned an empty response." };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      // Best-effort: extract the first {...} block.
      const start = rawJson.indexOf("{");
      const end = rawJson.lastIndexOf("}");
      if (start < 0 || end <= start) {
        return { ok: false, error: "Ollama did not return valid JSON." };
      }
      try {
        parsed = JSON.parse(rawJson.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "Ollama did not return valid JSON." };
      }
    }
    // Light shape guard here; the renderer does full validation against the
    // real action registry before anything can run.
    const intentValue = typeof parsed.intent === "string" ? parsed.intent : "unknown";
    if (!(assistantAllowedIntents as readonly string[]).includes(intentValue)) {
      parsed.intent = "unknown";
    }
    return { ok: true, intent: parsed };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "AbortError" ? "Ollama did not respond in time." : error.message) : "Ollama request failed.";
    return { ok: false, error: message };
  }
}

function defaultToolsSettings(): ToolsSettings {
  return {
    outputFolderPath: null,
    ffmpegPath: null,
    libreOfficePath: null,
    tesseractPath: null,
    pythonPath: null,
    ocrEngine: "paddleocr",
    ocrDevice: "gpu",
    ocrLanguage: "eng"
  };
}

function loadToolsSettings(): ToolsSettings {
  return { ...defaultToolsSettings(), ...readJsonFile<ToolsSettings>(toolsSettingsPath, defaultToolsSettings()) };
}

function saveToolsSettings(settings: ToolsSettings): ToolsSettings {
  return writeJsonFile(toolsSettingsPath, { ...defaultToolsSettings(), ...settings });
}

function getToolsOutputFolder(): string {
  const configuredPath = loadToolsSettings().outputFolderPath;
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  ensureToolsRoot();
  return toolsOutputRoot;
}

function findOnPath(command: string): string | null {
  const pathValue = process.env.PATH ?? "";
  const pathExts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  const commandHasExtension = Boolean(extname(command));

  for (const folder of pathValue.split(process.platform === "win32" ? ";" : ":").filter(Boolean)) {
    const candidates = commandHasExtension ? [command] : [command, ...pathExts.map((extension) => `${command}${extension.toLowerCase()}`), ...pathExts.map((extension) => `${command}${extension}`)];
    for (const candidate of candidates) {
      const resolvedPath = join(folder, candidate);
      if (existsSync(resolvedPath)) {
        return resolvedPath;
      }
    }
  }

  return null;
}

function detectFfmpegPath(): string | null {
  return findOnPath("ffmpeg") ?? findOnPath("ffmpeg.exe");
}

function detectLibreOfficePath(): string | null {
  const candidates = [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    findOnPath("soffice"),
    findOnPath("soffice.exe")
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function detectTesseractPath(): string | null {
  const candidates = [
    "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
    "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe",
    findOnPath("tesseract"),
    findOnPath("tesseract.exe")
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function detectPythonPath(): string | null {
  const launcherCandidates = (() => {
    try {
      const output = execFileSync("py", ["-0p"], { encoding: "utf8", windowsHide: true });
      return output
        .split(/\r?\n/)
        .map((line) => line.match(/-V:3\.(?:12|11)\s+\*?\s*(.+python\.exe)/i)?.[1]?.trim())
        .filter(Boolean) as string[];
    } catch {
      return [];
    }
  })();

  const candidates = [
    ...launcherCandidates,
    "C:\\Users\\aksha\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
    "C:\\Program Files\\Python312\\python.exe",
    "C:\\Python312\\python.exe",
    "C:\\Python311\\python.exe",
    findOnPath("python"),
    findOnPath("python.exe")
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getPythonVersion(pythonPath: string): { major: number; minor: number; raw: string } | null {
  try {
    const output = execFileSync(pythonPath, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], { encoding: "utf8", windowsHide: true, timeout: 5000 }).trim();
    const [major, minor] = output.split(".").map((part) => Number(part));
    return Number.isFinite(major) && Number.isFinite(minor) ? { major, minor, raw: output } : null;
  } catch {
    return null;
  }
}

function getPaddleRuntimeInfo(pythonPath: string): { ok: boolean; cudaCompiled: boolean; deviceCount: number; paddleVersion: string | null; error?: string } {
  const script = [
    "import json, warnings",
    "warnings.filterwarnings('ignore')",
    "try:",
    "    import paddle",
    "    cuda = bool(paddle.device.is_compiled_with_cuda())",
    "    count = int(paddle.device.cuda.device_count()) if cuda else 0",
    "    print(json.dumps({'ok': True, 'cudaCompiled': cuda, 'deviceCount': count, 'paddleVersion': getattr(paddle, '__version__', None)}))",
    "except Exception as exc:",
    "    print(json.dumps({'ok': False, 'cudaCompiled': False, 'deviceCount': 0, 'paddleVersion': None, 'error': str(exc)}))"
  ].join("\n");

  try {
    const output = execFileSync(pythonPath, ["-W", "ignore", "-c", script], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    const jsonStart = output.lastIndexOf("{");
    return JSON.parse(jsonStart >= 0 ? output.slice(jsonStart) : output);
  } catch (error) {
    return {
      ok: false,
      cudaCompiled: false,
      deviceCount: 0,
      paddleVersion: null,
      error: error instanceof Error ? error.message : "Unknown Paddle runtime check failure."
    };
  }
}

function resolveFfmpegPath(): string {
  const configuredPath = loadToolsSettings().ffmpegPath?.trim();
  const detectedPath = configuredPath && existsSync(configuredPath) ? configuredPath : detectFfmpegPath();
  if (!detectedPath) {
    throw new Error("ffmpeg is required for media conversions. Install it and set the path in Settings.");
  }
  return detectedPath;
}

function resolveLibreOfficePath(): string {
  const configuredPath = loadToolsSettings().libreOfficePath?.trim();
  const detectedPath = configuredPath && existsSync(configuredPath) ? configuredPath : detectLibreOfficePath();
  if (!detectedPath) {
    throw new Error("LibreOffice is required for Office conversions. Install it and set the path in Settings.");
  }
  return detectedPath;
}

function resolveTesseractPath(): string {
  const configuredPath = loadToolsSettings().tesseractPath?.trim();
  const detectedPath = configuredPath && existsSync(configuredPath) ? configuredPath : detectTesseractPath();
  if (!detectedPath) {
    throw new Error("Tesseract OCR is required. Install it and set path in Tools Settings.");
  }
  return detectedPath;
}

function resolvePythonPath(): string {
  const configuredPath = loadToolsSettings().pythonPath?.trim();
  const detectedPath = configuredPath && existsSync(configuredPath) ? configuredPath : detectPythonPath();
  if (!detectedPath) {
    throw new Error("Python with PaddleOCR is required for PaddleOCR. Install Python, install paddleocr, or switch OCR engine to Tesseract.");
  }
  const version = getPythonVersion(detectedPath);
  if (!version || version.major !== 3 || version.minor < 9 || version.minor >= 13) {
    throw new Error(`PaddleOCR requires a compatible local Python 3.9-3.12 runtime. DexNest found ${version?.raw ?? "an unknown Python version"} at ${detectedPath}. Install PaddleOCR under Python 3.12 and set that python.exe path in Tools Settings.`);
  }
  return detectedPath;
}

function resolveCommandPath(command: string, setupMessage: string): string {
  const resolvedPath = findOnPath(command) ?? findOnPath(`${command}.exe`);
  if (!resolvedPath) {
    throw new Error(setupMessage);
  }
  return resolvedPath;
}

function execFileAsync(file: string, args: string[], cwd?: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(file, args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 10, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr.trim() || stdout.trim() || error.message));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function createToolsTempFolder(operation: string): string {
  const tempFolder = join(toolsTempRoot, `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tempFolder, { recursive: true });
  return tempFolder;
}

function safeOutputPath(root: string, fileName: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, sanitizeFileName(fileName));

  if (!isPathInside(resolvedRoot, resolvedPath)) {
    throw new Error("Invalid DexNest Tools output path.");
  }

  return resolvedPath;
}

function createToolsOutput(fileName: string, operation: string): { fileName: string; path: string } {
  const outputFolder = getToolsOutputFolder();
  mkdirSync(outputFolder, { recursive: true });
  const uniqueName = uniqueFileName(outputFolder, fileName);
  return {
    fileName: uniqueName,
    path: safeOutputPath(outputFolder, uniqueName)
  };
}

function recordToolsOutput(filePath: string, operation: string): ToolsOutputItem {
  const item: ToolsOutputItem = {
    id: createId("tools-output"),
    fileName: basename(filePath),
    path: filePath,
    byteLength: statSync(filePath).size,
    operation,
    createdAt: new Date().toISOString()
  };
  saveToolsOutputs([item, ...loadToolsOutputs()]);
  return item;
}

function findRecordedToolsOutput(filePath: string): ToolsOutputItem | null {
  if (!filePath) {
    return null;
  }

  const resolvedPath = resolve(filePath);
  return loadToolsOutputs().find((output) => resolve(output.path) === resolvedPath) ?? null;
}

function getVerifiedToolsOutputPath(filePath: string): string {
  const output = findRecordedToolsOutput(filePath);
  if (!output || !existsSync(output.path)) {
    throw new Error("Tools output file is not registered.");
  }
  return output.path;
}

function selectedFileMetadata(path: string): ToolsSelectedFile {
  return {
    path,
    name: basename(path),
    byteLength: statSync(path).size,
    extension: extname(path).toLowerCase()
  };
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
      },
      {
        ...baseAction,
        id: `${base}.stop`,
        title: `Stop ${project.name}`,
        description: `Run the stop routine for ${project.name} (stop command, Docker, configured ports).`,
        dangerLevel: "danger",
        requiresConfirmation: true,
        confirmationRule: "Stops processes for this project.",
        handlerType: "internal_function",
        handlerRef: `${base}.stop`
      },
      {
        ...baseAction,
        id: `${base}.restart`,
        title: `Restart ${project.name}`,
        description: `Stop then start ${project.name}.`,
        dangerLevel: "danger",
        requiresConfirmation: true,
        confirmationRule: "Restarts processes for this project.",
        handlerType: "internal_function",
        handlerRef: `${base}.restart`
      },
      {
        ...baseAction,
        id: `${base}.check_health`,
        title: `Check ${project.name} Health`,
        description: `Check configured ports, health URL and local URLs for ${project.name}.`,
        handlerType: "internal_function",
        handlerRef: `${base}.check_health`
      },
      {
        ...baseAction,
        id: `${base}.open_urls`,
        title: `Open ${project.name} URLs`,
        description: `Open all configured local URLs for ${project.name}.`,
        handlerType: "http_endpoint",
        handlerRef: (project.urls ?? []).join(", ")
      }
    ];

    if ((project.ports ?? []).length > 0) {
      actions.push({
        ...baseAction,
        id: `${base}.kill_ports`,
        title: `Kill ${project.name} Ports`,
        description: `Kill processes listening on the configured ports for ${project.name}.`,
        dangerLevel: "danger",
        requiresConfirmation: true,
        confirmationRule: "Kills processes on configured ports.",
        handlerType: "internal_function",
        handlerRef: `${base}.kill_ports`
      });
      actions.push({
        ...baseAction,
        id: `${base}.show_processes`,
        title: `Show ${project.name} Processes`,
        description: `Show processes listening on configured ports for ${project.name}.`,
        handlerType: "internal_function",
        handlerRef: `${base}.show_processes`
      });
    }

    if (project.dockerComposeEnabled) {
      actions.push({
        ...baseAction,
        id: `${base}.docker_down`,
        title: `Stop ${project.name} Docker`,
        description: `Run docker compose down for ${project.name}.`,
        dangerLevel: "danger",
        requiresConfirmation: true,
        confirmationRule: "Stops Docker Compose containers.",
        handlerType: "internal_function",
        handlerRef: `${base}.docker_down`
      });
    }

    if ((project.logPath && project.logPath.trim()) || (project.logCommand && project.logCommand.trim())) {
      actions.push({
        ...baseAction,
        id: `${base}.open_logs`,
        title: `Open ${project.name} Logs`,
        description: `Open the configured logs for ${project.name}.`,
        handlerType: "internal_function",
        handlerRef: `${base}.open_logs`
      });
    }

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

function sendDropEvent(response: ServerResponse, payload: Record<string, unknown>): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1" || address === "localhost";
}

function tokenFromRequest(request: IncomingMessage, url: URL): string {
  const headerToken = request.headers["x-dexnest-token"];
  return Array.isArray(headerToken) ? headerToken[0] ?? "" : String(headerToken ?? url.searchParams.get("token") ?? "");
}

function authorizeControlEndpoint(request: IncomingMessage, url: URL): { ok: boolean; statusCode: number; error?: string } {
  const settings = loadStreamDeckSettings();
  if (!settings.lanEnabled && !isLocalRequest(request)) {
    return { ok: false, statusCode: 403, error: "DexNest Stream Deck control endpoints are localhost-only. Enable LAN exposure in Settings to allow remote control." };
  }
  if (settings.tokenEnabled && settings.token && tokenFromRequest(request, url) !== settings.token) {
    return { ok: false, statusCode: 401, error: "DexNest Stream Deck token is required." };
  }
  return { ok: true, statusCode: 200 };
}

function deckActionSummary(action: DexNestActionDefinition) {
  return {
    actionId: action.id,
    id: action.id,
    title: action.title,
    module: action.module,
    moduleId: action.moduleId,
    dangerLevel: action.dangerLevel,
    requiresConfirmation: action.requiresConfirmation,
    reversible: action.reversible,
    enabled: action.enabled,
    category: action.category,
    accent: `accent-${action.moduleId}`
  };
}

function safeEndpointResponse(
  result: {
    ok?: boolean;
    actionId?: string;
    error?: string;
    message?: string;
    status?: string;
    preview?: unknown;
    provider?: string;
    errorCode?: string;
    missingRequirement?: string;
    source?: DexNestActionTrigger;
    details?: Record<string, unknown>;
  },
  startedAt: number,
  action?: DexNestActionDefinition
) {
  const sensitiveAction = action?.module === "vault" || action?.id.includes("secure") || action?.id.includes("smart_lookup") || action?.id.includes("clipboard");
  const provider = result.provider ?? (action?.module === "external_devices" ? "govee" : undefined);
  return {
    ok: Boolean(result.ok),
    status: result.status ?? (result.ok ? "success" : "failed"),
    actionId: result.actionId ?? action?.id ?? null,
    message: result.ok && provider === "govee"
      ? "Govee action completed."
      : result.ok
      ? sensitiveAction ? "Action completed. Open DexNest to view result." : result.message ?? "Action completed."
      : result.message ?? result.error ?? "Action failed.",
    durationMs: Date.now() - startedAt,
    ...(provider ? { provider } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.missingRequirement ? { missingRequirement: result.missingRequirement } : {}),
    ...(result.source ? { source: result.source } : {}),
    ...(result.details ? result.details : {}),
    ...(result.preview ? { preview: result.preview } : {})
  };
}

function endpointStatusCode(result: { ok?: boolean; status?: string }): number {
  if (result.ok) {
    return 200;
  }
  if (result.status === "confirmation_required") {
    return 409;
  }
  if (result.status === "locked") {
    return 423;
  }
  if (result.status === "not_found") {
    return 404;
  }
  if (result.status === "invalid_params") {
    return 400;
  }
  if (result.status === "auth_failed") {
    return 401;
  }
  if (result.status === "rate_limited") {
    return 429;
  }
  if (result.status === "disabled" || result.status === "missing_requirement" || result.status === "not_configured" || result.status === "conflict") {
    return 409;
  }
  if (result.status === "provider_error") {
    return 502;
  }
  return 500;
}

function pinnedActionDetails() {
  const actions = [...actionRegistry.list(), ...getProjectActionDefinitions()];
  const actionMap = new Map(actions.map((action) => [action.id, action]));
  return loadPinnedActions()
    .map((actionId) => actionMap.get(actionId))
    .filter((action): action is DexNestActionDefinition => Boolean(action))
    .map(deckActionSummary);
}

function broadcastDropUpdate(message: string, eventType = "drop_updated"): void {
  const payload = {
    eventType,
    message,
    timestamp: new Date().toISOString()
  };

  for (const client of dropEventClients) {
    sendDropEvent(client, payload);
  }
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
    ports: (input.ports ?? existingProject?.ports ?? []).map((port) => Number(port)).filter((port) => Number.isInteger(port) && port > 0 && port < 65536),
    stopCommand: input.stopCommand?.trim() ?? existingProject?.stopCommand ?? "",
    logCommand: input.logCommand?.trim() ?? existingProject?.logCommand ?? "",
    logPath: input.logPath?.trim() ?? existingProject?.logPath ?? "",
    dockerComposeEnabled: typeof input.dockerComposeEnabled === "boolean" ? input.dockerComposeEnabled : (existingProject?.dockerComposeEnabled ?? false),
    healthUrl: input.healthUrl?.trim() ?? existingProject?.healthUrl ?? "",
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

function payloadMetadata(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    return {
      payloadKeys: Object.keys(payload as Record<string, unknown>)
    };
  }

  return {
    payloadType: typeof payload
  };
}

function clipboardState() {
  const settings = loadClipboardSettings();
  const activeSession = loadClipboardActiveMultiCopySession();
  return {
    history: loadClipboardHistory(),
    snippets: loadClipboardSnippets(),
    settings: {
      ...settings,
      listenerEnabled: settings.listenerEnabled && Boolean(clipboardListenerTimer),
      activeMultiCopySession: activeSession,
      multiCopyHotkeyRegistered: clipboardHotkeyRegistered
    },
    multiGroups: loadClipboardMultiGroups(),
    slots: loadClipboardSlots(),
    snippetsPath: clipboardSnippetsPath,
    historyPath: clipboardHistoryPath,
    settingsPath: clipboardSettingsPath,
    multiGroupsPath: clipboardMultiGroupsPath,
    activeMultiCopyPath: clipboardActiveMultiCopyPath,
    slotsPath: clipboardSlotsPath
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

function toolsState() {
  const settings = loadToolsSettings();
  return {
    selectedFiles: [] as ToolsSelectedFile[],
    outputs: loadToolsOutputs(),
    inputFolderPath: toolsInputRoot,
    outputFolderPath: getToolsOutputFolder(),
    defaultOutputFolderPath: toolsOutputRoot,
    customOutputFolderPath: settings.outputFolderPath,
    ffmpegPath: settings.ffmpegPath ?? null,
    detectedFfmpegPath: detectFfmpegPath(),
    libreOfficePath: settings.libreOfficePath ?? null,
    detectedLibreOfficePath: detectLibreOfficePath(),
    tesseractPath: settings.tesseractPath ?? null,
    detectedTesseractPath: detectTesseractPath(),
    pythonPath: settings.pythonPath ?? null,
    detectedPythonPath: detectPythonPath(),
    ocrEngine: settings.ocrEngine ?? "paddleocr",
    ocrDevice: settings.ocrDevice ?? "gpu",
    ocrLanguage: settings.ocrLanguage ?? "eng",
    tempFolderPath: toolsTempRoot,
    outputsPath: toolsOutputsPath
  };
}

function searchState(query: SearchQueryInput = {}) {
  const index = loadSearchIndex();
  const savedSearches = loadSavedSearches();
  const ocrTextFileCount = index.filter((item) => item.entityType === "tools_ocr_text" || item.entityType === "vault_document_ocr").length;
  return {
    index,
    savedSearches,
    indexPath: searchIndexPath,
    indexFolderPath: searchIndexRoot,
    indexStatusPath: searchIndexStatusPath,
    indexStatus: loadSearchIndexStatus(),
    savedSearchesPath,
    resultCount: runSearchQuery(query, index).length,
    ocrTextFileCount,
    sources: [...new Set(index.map((item) => item.sourceModule))].sort(),
    fileTypes: [...new Set(index.map((item) => item.fileType).filter(Boolean) as string[])].sort()
  };
}

function logSearchEvent(
  actionId: string,
  eventType: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Search",
    actionId,
    eventType,
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function textBucket(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function readTextFileForSearch(filePath: string, maxBytes = 1024 * 1024): string {
  if (!existsSync(filePath)) {
    return "";
  }
  const stats = statSync(filePath);
  if (stats.size > maxBytes) {
    return readFileSync(filePath, "utf8").slice(0, maxBytes);
  }
  return readFileSync(filePath, "utf8");
}

function readOcrMetadataForSearch(metadataPath: string): Record<string, unknown> | null {
  if ((!metadataPath.endsWith("-ocr-metadata.json") && !metadataPath.endsWith("-paddleocr-gpu-metadata.json")) || !existsSync(metadataPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fileTypeForPath(filePath?: string | null): string | null {
  if (!filePath) {
    return null;
  }

  return extname(filePath).toLowerCase() || null;
}

function buildSearchIndexRecords(): SearchIndexRecord[] {
  const indexedAt = new Date().toISOString();
  const records: SearchIndexRecord[] = [];

  for (const document of loadVaultDocuments()) {
    const ocrText = document.ocrTextPath && existsSync(document.ocrTextPath) && isPathInside(vaultOcrRoot, document.ocrTextPath)
      ? readTextFileForSearch(document.ocrTextPath)
      : "";
    const ocrMetadata = document.ocrMetadataPath && existsSync(document.ocrMetadataPath) && isPathInside(vaultOcrRoot, document.ocrMetadataPath)
      ? readOcrMetadataForSearch(document.ocrMetadataPath)
      : null;
    // Always contribute Vault metadata to the index even when OCR has not run or
    // failed. The structured expiry date is injected as an "expiry date:" phrase
    // so both Search and Smart Lookup can use it like notes text.
    const expiryPhrase = document.expiryDate ? `expiry date: ${document.expiryDate}` : "";
    const documentTypePhrase = document.fileType ? `document type ${document.fileType}` : "";
    const vaultMetadataText = textBucket(
      document.title,
      document.originalFileName,
      document.category,
      document.tags.join(" "),
      document.notes,
      expiryPhrase,
      documentTypePhrase
    );
    records.push({
      id: `vault-${document.id}`,
      sourceModule: "vault",
      entityType: ocrText ? "vault_document_ocr" : "vault_document",
      entityId: document.id,
      title: document.title || document.originalFileName,
      filePath: document.filePath,
      fileType: document.fileType || fileTypeForPath(document.filePath),
      sizeBytes: document.sizeBytes,
      textPreview: previewText(textBucket(document.originalFileName, document.notes, expiryPhrase, ocrText)),
      searchableText: normalizeSearchText(textBucket(vaultMetadataText, ocrText, String(ocrMetadata?.engine ?? ""), String(ocrMetadata?.device ?? ""))),
      tags: [...document.tags, document.ocrStatus ?? "", String(ocrMetadata?.engine ?? ""), String(ocrMetadata?.device ?? "")].filter(Boolean),
      category: document.category,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      indexedAt
    });
  }

  for (const output of loadToolsOutputs()) {
    const outputFileType = fileTypeForPath(output.path);
    const isOcrTextOutput = outputFileType === ".txt" && /ocr/i.test(output.operation || output.fileName);
    const textContent = outputFileType === ".txt" && existsSync(output.path)
      ? readTextFileForSearch(output.path)
      : "";
    const sidecarPath = isOcrTextOutput
      ? output.path.replace(/(?:-\d+)?\.txt$/i, (suffix) => suffix.replace(".txt", "-metadata.json"))
      : "";
    const sameNameSidecar = isOcrTextOutput && existsSync(sidecarPath) ? readOcrMetadataForSearch(sidecarPath) : null;
    const siblingSidecar = isOcrTextOutput && !sameNameSidecar
      ? loadToolsOutputs()
        .map((item) => item.path)
        .find((candidate) => candidate.endsWith("-ocr-metadata.json") && basename(candidate).startsWith(basename(output.path, ".txt").replace(/-\d+$/i, "")))
      : null;
    const ocrMetadata = sameNameSidecar ?? (siblingSidecar ? readOcrMetadataForSearch(siblingSidecar) : null);
    const ocrSourceFileName = typeof ocrMetadata?.originalFileName === "string" ? ocrMetadata.originalFileName : "";
    const metadataText = ocrMetadata
      ? textBucket(
        String(ocrMetadata.engine ?? ""),
        String(ocrMetadata.device ?? ""),
        String(ocrMetadata.originalFileName ?? ""),
        String(ocrMetadata.textOutputPath ?? ""),
        typeof ocrMetadata.averageConfidence === "number" ? `confidence ${ocrMetadata.averageConfidence}` : ""
      )
      : "";
    const textPreview = textContent
      ? previewText(textContent)
      : previewText(textBucket(output.operation, metadataText));
    const sourceModule = isOcrTextOutput || output.operation.includes("ocr") ? "tools_ocr" : "tools";
    records.push({
      id: `tools-${output.id}`,
      sourceModule,
      entityType: isOcrTextOutput ? "tools_ocr_text" : "tools_output",
      entityId: output.id,
      title: ocrSourceFileName ? `${output.fileName} (${ocrSourceFileName})` : output.fileName,
      filePath: output.path,
      fileType: outputFileType,
      sizeBytes: output.byteLength,
      textPreview,
      searchableText: normalizeSearchText(textBucket(output.fileName, output.operation, textContent, metadataText)),
      tags: [output.operation, String(ocrMetadata?.engine ?? ""), String(ocrMetadata?.device ?? ""), ocrSourceFileName].filter(Boolean),
      category: output.operation,
      createdAt: output.createdAt,
      updatedAt: output.createdAt,
      indexedAt
    });
  }

  for (const item of [...loadDropShelf(), ...loadDropIncoming()]) {
    const title = item.type === "file" ? item.originalName : item.preview || "Drop text";
    records.push({
      id: `drop-${item.direction}-${item.id}`,
      sourceModule: "drop",
      entityType: item.type === "file" ? "drop_file" : "drop_text",
      entityId: item.id,
      title,
      filePath: item.type === "file" ? item.path : null,
      fileType: item.type === "file" ? fileTypeForPath(item.path) : "text",
      sizeBytes: item.byteLength,
      textPreview: item.type === "text" ? previewText(item.preview ?? "") : previewText(item.fileName ?? item.originalName),
      tags: [item.direction, item.source],
      category: item.direction,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      indexedAt
    });
  }

  for (const item of loadClipboardHistory()) {
    records.push({
      id: `clipboard-history-${item.id}`,
      sourceModule: "clipboard",
      entityType: "clipboard_history",
      entityId: item.id,
      title: item.preview || "Clipboard history item",
      filePath: null,
      fileType: "text",
      sizeBytes: item.byteLength,
      textPreview: previewText(item.preview),
      tags: ["clipboard"],
      category: "history",
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      indexedAt
    });
  }

  for (const snippet of loadClipboardSnippets()) {
    records.push({
      id: `clipboard-snippet-${snippet.id}`,
      sourceModule: "clipboard",
      entityType: "clipboard_snippet",
      entityId: snippet.id,
      title: snippet.title,
      filePath: null,
      fileType: "text",
      sizeBytes: null,
      textPreview: "Snippet body is not indexed.",
      tags: ["snippet"],
      category: "snippet",
      createdAt: snippet.createdAt,
      updatedAt: snippet.updatedAt,
      indexedAt
    });
  }

  for (const project of loadProjects()) {
    records.push({
      id: `dev-project-${project.id}`,
      sourceModule: "dev",
      entityType: "dev_project",
      entityId: project.id,
      title: project.name,
      filePath: project.path,
      fileType: "folder",
      sizeBytes: null,
      textPreview: previewText(textBucket(project.description, project.notes, project.urls.join(" "))),
      tags: ["project", ...project.urls],
      category: "project",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      indexedAt
    });
  }

  for (const item of loadFinderItems()) {
    records.push({
      id: `finder-item-${item.id}`,
      sourceModule: "finder",
      entityType: "finder_item",
      entityId: item.id,
      title: item.itemName,
      filePath: null,
      fileType: "metadata",
      sizeBytes: null,
      textPreview: previewText(textBucket(item.location, item.room, item.container, item.notes)),
      tags: [...item.tags, item.status, item.confidence ?? "sure"].filter(Boolean),
      category: item.room || item.container || item.location,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      indexedAt
    });
  }

  for (const transaction of loadFinanceTransactions()) {
    records.push({
      id: `finance-transaction-${transaction.id}`,
      sourceModule: "finance",
      entityType: "finance_transaction",
      entityId: transaction.id,
      title: transaction.store,
      filePath: transaction.receiptFilePath ?? null,
      fileType: transaction.receiptFilePath ? fileTypeForPath(transaction.receiptFilePath) : "metadata",
      sizeBytes: transaction.receiptFilePath && existsSync(transaction.receiptFilePath) ? statSync(transaction.receiptFilePath).size : null,
      textPreview: previewText(textBucket(transaction.store, transaction.category, transaction.tags.join(" "), transaction.notes)),
      tags: transaction.tags,
      category: transaction.category,
      profileId: transaction.profileId,
      profileName: financeProfileName(transaction.profileId),
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      indexedAt
    });
  }

  for (const recurring of loadFinanceRecurring()) {
    records.push({
      id: `finance-recurring-${recurring.id}`,
      sourceModule: "finance",
      entityType: "finance_recurring",
      entityId: recurring.id,
      title: recurring.name,
      filePath: null,
      fileType: "metadata",
      sizeBytes: null,
      textPreview: previewText(textBucket(recurring.category, recurring.frequency, recurring.notes)),
      tags: [recurring.frequency, recurring.paymentType, recurring.active ? "active" : "inactive"],
      category: recurring.category,
      profileId: recurring.profileId,
      profileName: financeProfileName(recurring.profileId),
      createdAt: recurring.createdAt,
      updatedAt: recurring.updatedAt,
      indexedAt
    });
  }

  for (const item of loadCaptureItems().filter((capture) => capture.status !== "deleted")) {
    records.push({
      id: `capture-${item.id}`,
      sourceModule: "capture",
      entityType: "capture_item",
      entityId: item.id,
      title: item.title,
      filePath: item.filePath ?? null,
      fileType: item.filePath ? fileTypeForPath(item.filePath) : item.type,
      sizeBytes: item.filePath && existsSync(item.filePath) ? statSync(item.filePath).size : null,
      textPreview: previewText(textBucket(item.type, item.title, item.tags.join(" "), item.originalFileName ?? "", item.text)),
      tags: item.tags,
      category: item.type,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      indexedAt
    });
  }

  return records;
}

// Rebuild the local Search index. The index is rebuildable and not a source of
// truth, so it is safe to refresh on demand after Vault metadata changes.
function reindexSearchIndex(reason = "auto"): SearchIndexRecord[] {
  if (reason !== "manual" && performanceModePauses("search_auto_index")) {
    markSearchIndexStale(reason);
    return loadSearchIndex();
  }
  try {
    const records = saveSearchIndex(buildSearchIndexRecords());
    saveSearchIndexStatus(defaultSearchIndexStatus());
    return records;
  } catch (error) {
    console.error("DexNest: search reindex after Vault change failed.", error);
    return loadSearchIndex();
  }
}

function searchMatchScore(record: SearchIndexRecord, query: string): { score: number; reason: string } {
  if (!query) {
    return { score: 1, reason: "filter match" };
  }

  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(record.title);
  const tagsAndCategory = normalizeSearchText([...(record.tags ?? []), record.category ?? ""].join(" "));
  const preview = normalizeSearchText(record.textPreview ?? "");
  const searchableText = normalizeSearchText(record.searchableText ?? "");

  if (title.includes(normalizedQuery)) {
    return { score: 100, reason: "title" };
  }

  if (tagsAndCategory.includes(normalizedQuery)) {
    return { score: 60, reason: "tag/category" };
  }

  if (preview.includes(normalizedQuery)) {
    return { score: 30, reason: "preview" };
  }

  if (searchableText.includes(normalizedQuery)) {
    return { score: 25, reason: record.entityType === "tools_ocr_text" ? "ocr text" : "content" };
  }

  return { score: 0, reason: "" };
}

function runSearchQuery(queryInput: SearchQueryInput = {}, records = loadSearchIndex()): SearchResult[] {
  const query = (queryInput.query ?? "").trim();
  const sourceModule = queryInput.sourceModule && queryInput.sourceModule !== "all" ? queryInput.sourceModule : "";
  const fileType = queryInput.fileType && queryInput.fileType !== "all" ? queryInput.fileType.toLowerCase() : "";
  const dateFrom = queryInput.dateFrom ? parseLocalDateInput(queryInput.dateFrom).getTime() : Number.NaN;
  const dateToDate = queryInput.dateTo ? parseLocalDateInput(queryInput.dateTo) : null;
  if (dateToDate) {
    dateToDate.setHours(23, 59, 59, 999);
  }
  const dateTo = dateToDate ? dateToDate.getTime() : Number.NaN;

  return records
    .map((record) => {
      const match = searchMatchScore(record, query);
      return { ...record, score: match.score, matchReason: match.reason };
    })
    .filter((record) => {
      if (record.score <= 0) {
        return false;
      }
      const sourceMatches = sourceModule === "tools"
        ? record.sourceModule === "tools" || record.sourceModule === "tools_ocr"
        : record.sourceModule === sourceModule;
      if (sourceModule && !sourceMatches) {
        return false;
      }
      if (fileType && (record.fileType ?? "").toLowerCase() !== fileType) {
        return false;
      }
      const createdAt = Date.parse(record.createdAt);
      if (!Number.isNaN(dateFrom) && createdAt < dateFrom) {
        return false;
      }
      if (!Number.isNaN(dateTo) && createdAt > dateTo) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function runSecureVaultSearch(input: SearchQueryInput): SecureSearchResult[] {
  const file = loadSecureVaultFile();
  if (!file) {
    throw new Error("Secure Vault is not set up.");
  }
  const query = normalizeSearchText(input.query ?? "");
  if (!query) {
    return [];
  }
  const key = deriveSecureVaultKey(String(input.masterPassword ?? ""), file.kdf);
  verifySecureVaultKey(file, key);
  const includeSecrets = Boolean(input.includeSecretValues);

  return file.items
    .map((item): SecureSearchResult | null => {
      const notes = decryptSecureValue(item.notes, key);
      const secret = includeSecrets ? decryptSecureValue(item.secret, key) : "";
      const fields: Array<[string, string]> = [
        ["title", item.title],
        ["type", item.type],
        ["username", item.username ?? ""],
        ["url", item.url ?? ""],
        ["tags", item.tags.join(" ")],
        ["notes", notes],
        ["secret", secret]
      ];
      const matchedFields = fields
        .filter(([, value]) => normalizeSearchText(value).includes(query))
        .map(([field]) => field);
      if (matchedFields.length === 0) {
        return null;
      }
      return {
        id: `secure-${item.id}`,
        itemId: item.id,
        title: item.title,
        type: item.type,
        username: item.username,
        url: item.url,
        matchedFields,
        masked: true,
        score: matchedFields.includes("title") ? 100 : matchedFields.includes("username") || matchedFields.includes("url") ? 70 : 40
      };
    })
    .filter((item): item is SecureSearchResult => Boolean(item))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

const sensitiveSmartFields = new Set(["sin", "passport_number", "permit_number", "health_card", "api_key", "token", "recovery_code"]);

function maskSmartAnswer(value: string, fieldType: string): string {
  if (!sensitiveSmartFields.has(fieldType)) {
    return value;
  }
  const compact = value.trim();
  if (compact.length <= 4) {
    return "*".repeat(compact.length);
  }
  return `${"*".repeat(Math.max(4, compact.length - 4))}${compact.slice(-4)}`;
}

function requestedSmartFields(question: string): string[] {
  const text = normalizeSearchText(question);
  const fields: string[] = [];
  if (/\bsin\b|social insurance/.test(text)) fields.push("sin");
  if (/passport/.test(text)) fields.push("passport_number");
  if (/work permit|permit|document number|document no/.test(text)) fields.push("permit_number");
  if (/\buci\b|client id|unique client/.test(text)) fields.push("uci");
  if (/health card|health number|ohip|phn/.test(text)) fields.push("health_card");
  if (/expir|valid until|valid to|valid thru/.test(text)) fields.push("expiry_date");
  if (/issue|issued|date of issue/.test(text)) fields.push("issue_date");
  if (/email/.test(text)) fields.push("email");
  if (/phone|mobile|telephone/.test(text)) fields.push("phone");
  if (/address/.test(text)) fields.push("address");
  return fields.length ? [...new Set(fields)] : ["permit_number", "passport_number", "uci", "expiry_date", "sin", "health_card"];
}

function smartLookupTextForRecord(record: SearchIndexRecord): { text: string; ocrTextPath: string | null; sourceType: string } {
  if (record.sourceModule === "vault") {
    const document = findVaultDocument(record.entityId);
    let ocrText = "";
    let ocrTextPath: string | null = null;
    if (document?.ocrTextPath && existsSync(document.ocrTextPath) && isPathInside(vaultOcrRoot, document.ocrTextPath)) {
      ocrText = readTextFileForSearch(document.ocrTextPath, 5 * 1024 * 1024);
      ocrTextPath = document.ocrTextPath;
    }
    // Always scan Vault metadata/notes (via searchableText) in addition to any
    // OCR text, so values written in notes are found even without OCR.
    const text = textBucket(ocrText, record.searchableText, record.title);
    return { text, ocrTextPath, sourceType: ocrText ? "Vault metadata + OCR" : "Vault notes" };
  }
  if ((record.entityType === "tools_ocr_text" || record.fileType === ".txt") && record.filePath && existsSync(record.filePath)) {
    return { text: readTextFileForSearch(record.filePath, 5 * 1024 * 1024), ocrTextPath: record.filePath, sourceType: "Tools OCR" };
  }
  return { text: textBucket(record.title, record.textPreview, record.searchableText), ocrTextPath: null, sourceType: "Index" };
}

function contextAround(text: string, start: number, end: number, radius = 90): string {
  return previewText(text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius)).replace(/\s+/g, " "));
}

function confidenceForContext(fieldType: string, context: string, question: string): "high" | "medium" | "low" {
  const normalized = normalizeSearchText(`${context} ${question}`);
  const strongHints: Record<string, RegExp> = {
    sin: /\bsin\b|social insurance/,
    passport_number: /passport/,
    permit_number: /work permit|permit|document number|document no/,
    uci: /\buci\b|client id|unique client/,
    expiry_date: /expir|valid until|valid to|valid thru/,
    issue_date: /issue|issued|date of issue/,
    health_card: /health card|ohip|phn/
  };
  if (strongHints[fieldType]?.test(normalized)) {
    return "high";
  }
  return normalized.includes(fieldType.replace("_", " ")) ? "medium" : "low";
}

// Connector between a field label and its value. Tolerates plain notes phrasing
// like "work permit number is 272829", "permit number: 272829", "UCI - 1234-5678".
const smartFieldConnector = "(?:\\s*(?:is|are|was|=|:|#|->|of)\\s*|[\\s:#=._-]+)*";
const smartDatePattern = "([A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{2,4}|\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4})";

function smartFieldRegex(label: string, value: string): RegExp {
  return new RegExp(`\\b(?:${label})${smartFieldConnector}(${value})\\b`, "gi");
}

function smartPatternsForField(fieldType: string): RegExp[] {
  switch (fieldType) {
    case "sin":
      return [smartFieldRegex("sin|social insurance(?:\\s+number)?", "\\d{3}[-\\s]?\\d{3}[-\\s]?\\d{3}")];
    case "passport_number":
      return [smartFieldRegex("passport(?:\\s*(?:no\\.?|number|num|#))?", "[A-Z]{1,2}\\d{6,8}|[A-Z0-9]{6,9}")];
    case "permit_number":
      // Plain numeric permit/document/application numbers (e.g. "272829") and
      // alphanumeric variants, after a label like "work permit number".
      return [smartFieldRegex(
        "work permit(?:\\s*(?:no\\.?|number|num|#))?|permit(?:\\s*(?:no\\.?|number|num|#))?|document(?:\\s*(?:no\\.?|number|num|#))?|application(?:\\s*(?:no\\.?|number|num|#))?",
        "[A-Z]{0,4}\\d{5,12}|[A-Z]{1,4}[-\\s]?\\d{4,10}|[A-Z0-9]{2,5}-\\d{3,8}"
      )];
    case "uci":
      return [smartFieldRegex("uci|client id|unique client(?:\\s+identifier)?", "\\d{4}[-\\s]?\\d{4}|\\d{8,10}")];
    case "expiry_date":
      return [smartFieldRegex("expiry(?:\\s+date)?|expires(?:\\s+on)?|expiration(?:\\s+date)?|valid until|valid to|valid thru", smartDatePattern)];
    case "issue_date":
      return [smartFieldRegex("issue(?:\\s+date)?|issued(?:\\s+on)?|date of issue", smartDatePattern)];
    case "health_card":
      return [smartFieldRegex("health card(?:\\s+(?:no\\.?|number))?|health number|ohip|phn", "[A-Z0-9][A-Z0-9 -]{7,15}")];
    case "email":
      return [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi];
    case "phone":
      return [/\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g];
    case "address":
      return [/\b(\d{1,6}\s+[A-Z][A-Za-z0-9 .'-]{3,80}\s+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|blvd|boulevard))\b/gi];
    default:
      return [];
  }
}

function runSmartLookup(input: SearchQueryInput): SmartLookupResult[] {
  const question = String(input.question ?? input.query ?? "").trim();
  if (!question) {
    throw new Error("Ask a Smart Lookup question first.");
  }

  const fields = requestedSmartFields(question);
  // A sensitive answer may be auto-revealed only when a trusted session is
  // active AND the auto-reveal setting is on. Computed once per lookup.
  const securitySettings = loadAssistantSecuritySettings();
  const trustedActive = isTrustedSessionActive();
  const allowAutoReveal = trustedActive && securitySettings.autoRevealWhileUnlocked;
  const records = loadSearchIndex().filter((record) => (
    record.sourceModule === "vault"
    || record.sourceModule === "tools_ocr"
    || record.entityType === "vault_document_ocr"
    || record.entityType === "tools_ocr_text"
  ));
  const results: SmartLookupResult[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const { text, ocrTextPath, sourceType } = smartLookupTextForRecord(record);
    if (!text.trim()) {
      continue;
    }
    for (const fieldType of fields) {
      for (const pattern of smartPatternsForField(fieldType)) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          const answer = String(match[1] ?? match[0]).trim().replace(/\s+/g, " ");
          if (!answer || answer.length < 3) {
            continue;
          }
          const key = `${fieldType}:${record.id}:${answer.toLowerCase()}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const preview = contextAround(text, match.index, match.index + match[0].length);
          const confidence = confidenceForContext(fieldType, preview, question);
          const score = (confidence === "high" ? 100 : confidence === "medium" ? 70 : 40) + (record.sourceModule === "vault" ? 10 : 0);
          results.push({
            id: createId("smart-lookup"),
            fieldType,
            answer,
            maskedAnswer: maskSmartAnswer(answer, fieldType),
            sensitive: sensitiveSmartFields.has(fieldType),
            confidence,
            sourceRecordId: record.id,
            sourceModule: record.sourceModule,
            sourceType,
            sourceDocumentTitle: record.title,
            sourceFilePath: record.filePath ?? null,
            ocrTextPath,
            preview,
            score,
            autoRevealed: sensitiveSmartFields.has(fieldType) ? allowAutoReveal : true
          });
        }
      }
    }
  }

  return results.sort((left, right) => right.score - left.score).slice(0, 12);
}

function todayDateString(): string {
  return getLocalTodayDateString();
}

function localDateStringFromTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cleanJournalText(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function parseTagList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveSimpleDatePhrase(sentence: string, baseDate: Date): string | null {
  return resolveRelativeLocalDate(sentence, baseDate);
}

function extractCalendarCandidatesFromText(text: string, baseDateString = todayDateString()): ExtractedCalendarCandidate[] {
  const baseDate = parseLocalDateInput(baseDateString);
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap((sentence) => {
      const normalized = sentence.toLowerCase();
      const hasSignal = /\b(birthday|meeting|appointment|call|remind me)\b/.test(normalized);
      if (!hasSignal) {
        return [];
      }

      const date = resolveSimpleDatePhrase(sentence, baseDate);
      if (!date) {
        return [];
      }

      const type: ExtractedCalendarCandidate["type"] = normalized.includes("birthday")
        ? "birthday"
        : normalized.includes("meeting")
          ? "meeting"
          : normalized.includes("appointment")
            ? "appointment"
            : normalized.includes("call")
              ? "call"
              : "reminder";
      const title = previewText(sentence.replace(/\b(remind me to|remind me|is|on|in \d+ days?|today|tomorrow|next \w+)\b/gi, " ").trim()) || type;
      return [{
        id: createId("calendar-candidate"),
        title: type === "birthday" && !title.toLowerCase().includes("birthday") ? `${title} birthday` : title,
        date,
        type,
        allDay: type === "birthday",
        sourceSentence: sentence,
        recurrence: type === "birthday" ? "yearly-placeholder" : null
      }];
    });
}

function journalState() {
  const entries = loadJournalEntries().sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const today = todayDateString();
  return {
    entries,
    todayEntry: entries.find((entry) => entry.date === today) ?? null,
    entriesPath: journalEntriesPath,
    today
  };
}

function calendarState() {
  refreshNudges("system", false);
  const events = loadCalendarEvents().sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const today = todayDateString();
  const nudges = currentNudges();
  return {
    events,
    today,
    todayEvents: events.filter((event) => event.date === today),
    upcomingEvents: events.filter((event) => event.date >= today).slice(0, 20),
    eventsPath: calendarEventsPath,
    nudges,
    todayNudges: nudges.filter((nudge) => nudge.date === today),
    upcomingNudges: nudges.filter((nudge) => nudge.date >= today).slice(0, 30),
    urgentNudges: nudges.filter((nudge) => nudge.priority === "urgent"),
    nudgesPath,
    nudgeSettingsPath,
    nudgeSettings: loadNudgeSettings()
  };
}

function addLocalDays(dateString: string, days: number): string {
  const date = parseLocalDateInput(dateString);
  date.setDate(date.getDate() + days);
  return toLocalDateInputValue(date);
}

function localDayDiff(fromDateString: string, toDateString: string): number {
  const from = parseLocalDateInput(fromDateString);
  const to = parseLocalDateInput(toDateString);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function nudgePriorityForDays(daysUntil: number): NudgePriority {
  if (daysUntil <= 1) {
    return "urgent";
  }
  if (daysUntil <= 7) {
    return "normal";
  }
  return "soft";
}

function currentNudges(): Nudge[] {
  const now = Date.now();
  return loadNudges()
    .filter((nudge) => {
      if (nudge.status === "dismissed" || nudge.status === "completed") {
        return false;
      }
      if (nudge.status === "snoozed" && nudge.snoozeUntil && Date.parse(nudge.snoozeUntil) > now) {
        return false;
      }
      if (performanceModePauses("nudges") && nudge.priority !== "urgent") {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const priorityOrder: Record<NudgePriority, number> = { urgent: 0, normal: 1, soft: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority] || a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "");
    });
}

function upsertGeneratedNudge(candidates: Nudge[], existingById: Map<string, Nudge>, candidate: Omit<Nudge, "status" | "createdAt" | "updatedAt">): void {
  const now = new Date().toISOString();
  const existing = existingById.get(candidate.id);
  candidates.push({
    ...candidate,
    status: existing?.status ?? "active",
    snoozeUntil: existing?.snoozeUntil ?? candidate.snoozeUntil ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
}

function generatedNudgeCandidates(settings: NudgeSettings): Nudge[] {
  if (!settings.enabled) {
    return [];
  }

  const today = todayDateString();
  const tomorrow = addLocalDays(today, 1);
  const existingById = new Map(loadNudges().map((nudge) => [nudge.id, nudge]));
  const candidates: Nudge[] = [];

  for (const event of loadCalendarEvents()) {
    if (event.date !== today && event.date !== tomorrow) {
      continue;
    }
    upsertGeneratedNudge(candidates, existingById, {
      id: `calendar-event-${event.id}-${event.date}`,
      title: event.date === today ? "Calendar event today" : "Calendar event tomorrow",
      message: `${event.title}${event.allDay ? "" : event.startTime ? ` at ${event.startTime}` : ""}`,
      sourceModule: "calendar",
      sourceId: event.id,
      date: event.date,
      time: event.startTime ?? null,
      priority: event.reminderLevel,
      snoozeUntil: null
    });
  }

  for (const document of loadVaultDocuments()) {
    if (!document.expiryDate) {
      continue;
    }
    const daysUntil = localDayDiff(today, document.expiryDate);
    if (daysUntil < 0 || !settings.vaultExpiryReminderDays.some((days) => daysUntil <= days)) {
      continue;
    }
    upsertGeneratedNudge(candidates, existingById, {
      id: `vault-expiry-${document.id}-${document.expiryDate}`,
      title: "Vault document expiry",
      message: `${document.title || document.originalFileName} expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
      sourceModule: "vault",
      sourceId: document.id,
      date: today,
      time: null,
      priority: nudgePriorityForDays(daysUntil),
      snoozeUntil: null
    });
  }

  for (const transaction of loadFinanceTransactions()) {
    for (const [kind, dateValue] of [["return", transaction.returnDeadline], ["warranty", transaction.warrantyUntil]] as const) {
      if (!dateValue) {
        continue;
      }
      const daysUntil = localDayDiff(today, dateValue);
      const relevantDays = kind === "return" ? settings.returnReminderDays : [90, 30, 7];
      if (daysUntil < 0 || !relevantDays.some((days) => daysUntil <= days)) {
        continue;
      }
      upsertGeneratedNudge(candidates, existingById, {
        id: `finance-${kind}-${transaction.id}-${dateValue}`,
        title: kind === "return" ? "Return deadline" : "Warranty date",
        message: `${transaction.store} ${kind === "return" ? "return deadline" : "warranty"} in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
        sourceModule: "finance",
        sourceId: transaction.id,
        sourceProfileId: transaction.profileId,
        sourceProfileName: financeProfileName(transaction.profileId),
        date: today,
        time: null,
        priority: nudgePriorityForDays(daysUntil),
        snoozeUntil: null
      });
    }
  }

  for (const recurring of loadFinanceRecurring().filter((item) => item.active)) {
    const daysUntil = localDayDiff(today, recurring.nextDueDate);
    if (daysUntil < 0 || daysUntil > 7) {
      continue;
    }
    upsertGeneratedNudge(candidates, existingById, {
      id: `finance-recurring-${recurring.id}-${recurring.nextDueDate}`,
      title: "Recurring expense due",
      message: `${recurring.name} is due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
      sourceModule: "finance",
      sourceId: recurring.id,
      sourceProfileId: recurring.profileId,
      sourceProfileName: financeProfileName(recurring.profileId),
      date: today,
      time: null,
      priority: nudgePriorityForDays(daysUntil),
      snoozeUntil: null
    });
  }

  if (settings.dailyJournalReminderEnabled && !loadJournalEntries().some((entry) => entry.date === today)) {
    upsertGeneratedNudge(candidates, existingById, {
      id: `journal-daily-${today}`,
      title: "Journal reminder",
      message: "Add today’s DexNest Journal entry.",
      sourceModule: "journal",
      sourceId: today,
      date: today,
      time: null,
      priority: "soft",
      snoozeUntil: null
    });
  }

  const latestBackup = listBackups()[0] ?? null;
  const daysSinceBackup = latestBackup ? localDayDiff(localDateStringFromTimestamp(latestBackup.createdAt), today) : Number.POSITIVE_INFINITY;
  if (daysSinceBackup >= settings.backupReminderAfterDays) {
    upsertGeneratedNudge(candidates, existingById, {
      id: `backup-reminder-${today}`,
      title: "Backup reminder",
      message: latestBackup ? `Last backup was ${daysSinceBackup} days ago.` : "No DexNest backup found yet.",
      sourceModule: "backup",
      sourceId: latestBackup?.path ?? null,
      date: today,
      time: null,
      priority: daysSinceBackup > settings.backupReminderAfterDays * 2 ? "urgent" : "normal",
      snoozeUntil: null
    });
  }

  return candidates;
}

function refreshNudges(source: DexNestActionTrigger | "system" = "system", writeAudit = true): Nudge[] {
  const startedAt = Date.now();
  const settings = loadNudgeSettings();
  const existing = loadNudges();
  const generated = generatedNudgeCandidates(settings);
  const generatedIds = new Set(generated.map((nudge) => nudge.id));
  const manualOrInactive = existing.filter((nudge) => !generatedIds.has(nudge.id));
  const next = saveNudges([...generated, ...manualOrInactive].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  const newCount = generated.filter((nudge) => !existing.some((item) => item.id === nudge.id)).length;

  if (writeAudit || newCount > 0) {
    localDb.appendActionEvent({
      module: "DexNest Calendar",
      actionId: "calendar.nudge.refresh",
      eventType: newCount > 0 ? "nudge_generated" : "nudge_refreshed",
      status: "success",
      source: source === "system" ? "system" : source,
      summary: `Refreshed DexNest nudges with ${newCount} new nudge${newCount === 1 ? "" : "s"}.`,
      metadataJson: { generatedCount: generated.length, newCount, activeCount: currentNudges().length },
      durationMs: Date.now() - startedAt
    });
  }

  return next;
}

function logJournalEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Journal",
    actionId,
    eventType: "journal_action",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function logCalendarEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Calendar",
    actionId,
    eventType: "calendar_action",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function logNudgeEvent(
  actionId: string,
  eventType: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Calendar",
    actionId,
    eventType,
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function finderState() {
  const items = loadFinderItems().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {
    items,
    itemsPath: finderItemsPath,
    statusCounts: {
      at_home: items.filter((item) => item.status === "at_home").length,
      lent_out: items.filter((item) => item.status === "lent_out").length,
      missing: items.filter((item) => item.status === "missing").length,
      archived: items.filter((item) => item.status === "archived").length
    }
  };
}

function logFinderEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Finder",
    actionId,
    eventType: "finder_action",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function finderItemMatches(item: FinderItem, query: string, status = "all"): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesStatus = status === "all" || item.status === status;
  if (!matchesStatus) {
    return false;
  }
  if (!normalizedQuery) {
    return true;
  }

  return [
    item.itemName,
    item.location,
    item.room ?? "",
    item.container ?? "",
    item.tags.join(" ")
  ].join(" ").toLowerCase().includes(normalizedQuery);
}

function reverseLookupMatches(item: FinderItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return false;
  }

  return [item.location, item.room ?? "", item.container ?? ""].join(" ").toLowerCase().includes(normalizedQuery);
}

function financeMonthKey(value: string): string {
  return value.slice(0, 7);
}

function financeTotalBy<T extends string>(transactions: FinanceTransaction[], key: (transaction: FinanceTransaction) => T): Record<T, number> {
  return transactions.reduce((totals, transaction) => {
    const group = key(transaction);
    totals[group] = Number(((totals[group] ?? 0) + transaction.amount).toFixed(2));
    return totals;
  }, {} as Record<T, number>);
}

function financeState() {
  const profilesFile = loadFinanceProfilesFile();
  const activeProfileId = profilesFile.activeProfileId;
  // Dashboard, lists, summary and deadlines all scope to the active profile only.
  const transactions = loadFinanceTransactions().filter((item) => item.profileId === activeProfileId).sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const recurring = loadFinanceRecurring().filter((item) => item.profileId === activeProfileId).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const settings = loadFinanceSettings();
  const today = todayDateString();
  const currentMonth = financeMonthKey(today);
  const previousMonthDate = parseLocalDateInput(`${currentMonth}-01`);
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonth = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthTransactions = transactions.filter((transaction) => financeMonthKey(transaction.date) === currentMonth);
  const previousMonthTransactions = transactions.filter((transaction) => financeMonthKey(transaction.date) === previousMonth);
  const currentMonthTotal = Number(currentMonthTransactions.reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2));
  const previousMonthTotal = Number(previousMonthTransactions.reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2));
  const addDays = (days: number) => {
    const date = parseLocalDateInput(today);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const within = (value: string | null | undefined, end: string) => Boolean(value && value >= today && value <= end);
  return {
    transactions,
    recurring,
    settings,
    profiles: profilesFile.profiles,
    activeProfileId,
    profilesPath: financeProfilesPath,
    transactionsPath: financeTransactionsPath,
    recurringPath: financeRecurringPath,
    settingsPath: financeSettingsPath,
    receiptsPath: receiptsRoot,
    summary: {
      currentMonth,
      previousMonth,
      currentMonthTotal,
      previousMonthTotal,
      categoryTotals: financeTotalBy(currentMonthTransactions, (transaction) => transaction.category || "Other"),
      paymentTypeTotals: financeTotalBy(currentMonthTransactions, (transaction) => transaction.paymentType),
      cashTotal: Number(currentMonthTransactions.filter((transaction) => transaction.paymentType === "cash").reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2)),
      cardTotal: Number(currentMonthTransactions.filter((transaction) => transaction.paymentType === "debit" || transaction.paymentType === "credit").reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2)),
      transactionCount: currentMonthTransactions.length
    },
    deadlines: {
      returns7: transactions.filter((transaction) => within(transaction.returnDeadline, addDays(7))),
      returns30: transactions.filter((transaction) => within(transaction.returnDeadline, addDays(30))),
      warranties90: transactions.filter((transaction) => within(transaction.warrantyUntil, addDays(90))),
      expiredReturns: transactions.filter((transaction) => Boolean(transaction.returnDeadline && transaction.returnDeadline < today))
    }
  };
}

function logFinanceEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Finance",
    actionId,
    eventType: "finance_action",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function financeTransactionMetadata(transaction: FinanceTransaction): Record<string, unknown> {
  return {
    transactionId: transaction.id,
    profileId: transaction.profileId,
    category: transaction.category,
    paymentType: transaction.paymentType,
    amount: transaction.amount,
    hasReceipt: Boolean(transaction.receiptFilePath)
  };
}

function copyReceiptIntoFinance(sourcePath: string | null | undefined): { path: string | null; originalName: string | null } {
  if (!sourcePath) {
    return { path: null, originalName: null };
  }
  if (!existsSync(sourcePath)) {
    throw new Error("Receipt file not found.");
  }
  ensureFinanceRoot();
  const originalName = sanitizeFileName(basename(sourcePath));
  const storedName = uniqueFileName(receiptsRoot, originalName);
  const storedPath = safeOutputPath(receiptsRoot, storedName);
  copyFileSync(sourcePath, storedPath);
  return { path: storedPath, originalName };
}

function normalizePaymentType(value: unknown): FinancePaymentType {
  return value === "cash" || value === "debit" || value === "credit" || value === "e_transfer" || value === "other" ? value : "other";
}

function normalizeRecurringFrequency(value: unknown): FinanceRecurringFrequency {
  return value === "monthly" || value === "yearly" || value === "weekly" || value === "custom" ? value : "monthly";
}

function normalizeFinanceTransaction(input: FinanceTransactionInput, existing?: FinanceTransaction): FinanceTransaction {
  const now = new Date().toISOString();
  const copiedReceipt = input.receiptPath ? copyReceiptIntoFinance(input.receiptPath) : { path: input.receiptFilePath ?? existing?.receiptFilePath ?? null, originalName: existing?.receiptOriginalName ?? null };
  const amount = Number(input.amount ?? existing?.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter a valid non-negative transaction amount.");
  }

  return {
    id: input.id ?? existing?.id ?? createId("finance-transaction"),
    profileId: input.profileId || existing?.profileId || activeFinanceProfileId(),
    date: input.date || existing?.date || todayDateString(),
    store: input.store?.trim() || existing?.store || "Unknown store",
    amount: Number(amount.toFixed(2)),
    currency: (input.currency?.trim() || existing?.currency || loadFinanceSettings().defaultCurrency || "CAD").toUpperCase(),
    category: input.category?.trim() || existing?.category || "Other",
    paymentType: normalizePaymentType(input.paymentType ?? existing?.paymentType),
    cardName: input.cardName ?? existing?.cardName ?? null,
    notes: input.notes ?? existing?.notes ?? "",
    receiptFilePath: copiedReceipt.path,
    receiptOriginalName: copiedReceipt.originalName ?? existing?.receiptOriginalName ?? null,
    returnDeadline: input.returnDeadline || null,
    warrantyUntil: input.warrantyUntil || null,
    tags: parseTagList(input.tags ?? existing?.tags),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function normalizeFinanceRecurring(input: FinanceRecurringInput, existing?: FinanceRecurringExpense): FinanceRecurringExpense {
  const now = new Date().toISOString();
  const amount = Number(input.amount ?? existing?.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter a valid non-negative recurring amount.");
  }

  return {
    id: input.id ?? existing?.id ?? createId("finance-recurring"),
    profileId: input.profileId || existing?.profileId || activeFinanceProfileId(),
    name: input.name?.trim() || existing?.name || "Untitled recurring expense",
    amount: Number(amount.toFixed(2)),
    currency: (input.currency?.trim() || existing?.currency || loadFinanceSettings().defaultCurrency || "CAD").toUpperCase(),
    frequency: normalizeRecurringFrequency(input.frequency ?? existing?.frequency),
    nextDueDate: input.nextDueDate || existing?.nextDueDate || todayDateString(),
    category: input.category?.trim() || existing?.category || "Other",
    paymentType: normalizePaymentType(input.paymentType ?? existing?.paymentType),
    notes: input.notes ?? existing?.notes ?? "",
    active: input.active ?? existing?.active ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function captureState() {
  const items = loadCaptureItems().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {
    items,
    inbox: items.filter((item) => item.status === "inbox"),
    routed: items.filter((item) => item.status === "routed"),
    archived: items.filter((item) => item.status === "archived"),
    itemsPath: captureItemsPath,
    capturesPath: capturesRoot
  };
}

function startOfLocalWeek(): string {
  const today = parseLocalDateInput(todayDateString());
  const day = today.getDay();
  today.setDate(today.getDate() - day);
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function commandStats() {
  const today = todayDateString();
  const weekStart = startOfLocalWeek();
  const events = localDb.listRecentEvents(500);
  const todayEvents = events.filter((event) => localDateStringFromTimestamp(event.timestamp) === today);
  const finance = financeState();
  const heatmap = heatmapState();
  const nudges = currentNudges();
  return {
    journalEntriesThisWeek: loadJournalEntries().filter((entry) => entry.date >= weekStart && entry.date <= today).length,
    calendarUpcoming: calendarState().upcomingEvents.length,
    todayNudges: nudges.filter((nudge) => nudge.date === today).length,
    urgentNudges: nudges.filter((nudge) => nudge.priority === "urgent").length,
    activeNudges: nudges.length,
    transactionsThisMonth: finance.summary.transactionCount,
    receiptsThisMonth: finance.transactions.filter((transaction) => transaction.receiptFilePath && transaction.date.slice(0, 7) === finance.summary.currentMonth).length,
    vaultDocuments: loadVaultDocuments().length,
    dropIncoming: loadDropIncoming().length,
    dropOutgoing: loadDropShelf().length,
    capturesInbox: captureState().inbox.length,
    finderItems: loadFinderItems().filter((item) => item.status !== "archived").length,
    devProjects: loadProjects().length,
    actionsRunToday: todayEvents.filter((event) => event.actionId).length,
    failedActionsToday: todayEvents.filter((event) => event.status === "failed").length,
    routinesRunToday: todayEvents.filter((event) => event.eventType === "routine_completed").length,
    heatmapActiveSecondsToday: heatmap.summary.activeSecondsToday,
    heatmapTopAppToday: heatmap.summary.topAppToday,
    heatmapStatus: heatmap.trackingStatus,
    updatedAt: new Date().toISOString()
  };
}

function routinesState() {
  return {
    routines: loadRoutines(),
    routinesPath
  };
}

function aggregateHeatmapEvents(events = loadHeatmapEvents()) {
  const today = todayDateString();
  const weekStart = startOfLocalWeek();
  const todayEvents = events.filter((event) => localDateStringFromTimestamp(event.timestamp) === today);
  const weekEvents = events.filter((event) => localDateStringFromTimestamp(event.timestamp) >= weekStart);
  const totalsByApp = new Map<string, number>();
  const weekTotalsByApp = new Map<string, number>();
  const hourlyTotals = new Map<number, number>();
  const projectTotals = new Map<string, number>();
  let activeSecondsToday = 0;
  let idleSecondsToday = 0;

  for (const event of todayEvents) {
    const duration = Math.max(0, event.durationSeconds || 0);
    totalsByApp.set(event.appName, (totalsByApp.get(event.appName) ?? 0) + duration);
    const hour = new Date(event.timestamp).getHours();
    hourlyTotals.set(hour, (hourlyTotals.get(hour) ?? 0) + duration);
    if (event.projectId) {
      projectTotals.set(event.projectId, (projectTotals.get(event.projectId) ?? 0) + duration);
    }
    if (event.active) {
      activeSecondsToday += duration;
    } else {
      idleSecondsToday += duration;
    }
  }

  for (const event of weekEvents) {
    weekTotalsByApp.set(event.appName, (weekTotalsByApp.get(event.appName) ?? 0) + Math.max(0, event.durationSeconds || 0));
  }

  const sortTotals = (totals: Map<string | number, number>) =>
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, seconds]) => ({ name: String(name), seconds }));

  const topAppToday = sortTotals(totalsByApp)[0]?.name ?? "none";

  return {
    todayByApp: sortTotals(totalsByApp),
    weekByApp: sortTotals(weekTotalsByApp),
    activeHours: sortTotals(hourlyTotals).map((item) => ({ hour: Number(item.name), seconds: item.seconds })),
    projectUsage: sortTotals(projectTotals),
    activeSecondsToday,
    idleSecondsToday,
    topAppToday
  };
}

function heatmapGoalProgress(goals = loadHeatmapGoals(), events = loadHeatmapEvents()) {
  const weekStart = startOfLocalWeek();
  const weekEvents = events.filter((event) => localDateStringFromTimestamp(event.timestamp) >= weekStart);
  return goals.map((goal) => {
    const keyword = goal.keyword.trim().toLowerCase();
    const seconds = weekEvents
      .filter((event) => !keyword || `${event.appName} ${event.windowTitle} ${event.projectId ?? ""}`.toLowerCase().includes(keyword))
      .reduce((sum, event) => sum + Math.max(0, event.durationSeconds || 0), 0);
    const targetSeconds = Math.max(0, goal.targetHoursPerWeek * 3600);
    return {
      ...goal,
      progressSeconds: seconds,
      targetSeconds,
      percent: targetSeconds > 0 ? Math.min(100, Math.round((seconds / targetSeconds) * 100)) : 0
    };
  });
}

function heatmapState() {
  const settings = loadHeatmapSettings();
  const events = loadHeatmapEvents();
  const goals = loadHeatmapGoals();
  return {
    settings,
    events: events.slice(0, 100),
    goals,
    goalProgress: heatmapGoalProgress(goals, events),
    summary: aggregateHeatmapEvents(events),
    eventsPath: heatmapEventsPath,
    settingsPath: heatmapSettingsPath,
    goalsPath: heatmapGoalsPath,
    trackingStatus: settings.enabled && performanceModePauses("heatmap")
      ? "paused by Performance Mode"
      : settings.enabled && !settings.paused && heatmapSampleTimer ? "running" : settings.enabled ? "paused" : "disabled",
    detectionNote: process.platform === "win32"
      ? "Windows active window metadata is sampled with a local one-shot Win32 call."
      : "Active window detection is currently Windows-only; manual placeholder logging is used here."
  };
}

function logHeatmapAudit(
  actionId: string,
  eventType: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown> = {},
  startedAt = Date.now(),
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Heatmap",
    actionId,
    eventType,
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function normalizeHeatmapGoal(input: HeatmapGoalInput, existing?: HeatmapGoal): HeatmapGoal {
  const now = new Date().toISOString();
  const target = Number(input.targetHoursPerWeek ?? existing?.targetHoursPerWeek ?? 5);
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error("Goal target hours must be greater than zero.");
  }

  return {
    id: input.id ?? input.goalId ?? existing?.id ?? createId("heatmap-goal"),
    name: input.name?.trim() || existing?.name || "Focus goal",
    targetHoursPerWeek: Number(target.toFixed(2)),
    keyword: input.keyword?.trim() || existing?.keyword || "",
    active: input.active ?? existing?.active ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

async function runHeatmapAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as HeatmapGoalInput & Partial<HeatmapSettings> & { confirmedDangerous?: boolean }) : {};

  try {
    if (action.id === "heatmap.open") {
      logHeatmapAudit(action.id, "heatmap_opened", "success", source, "Opened DexNest Heatmap.", {}, startedAt);
      return { ok: true, actionId: action.id, heatmapState: heatmapState() };
    }

    if (action.id === "heatmap.start") {
      const settings = loadHeatmapSettings();
      const updated = saveHeatmapSettings({
        ...settings,
        enabled: true,
        paused: false,
        sampleIntervalSeconds: Math.max(60, Number(input.sampleIntervalSeconds ?? settings.sampleIntervalSeconds ?? 60)),
        aggregationIntervalHours: Math.max(3, Number(input.aggregationIntervalHours ?? settings.aggregationIntervalHours ?? 3)),
        pauseDuringFullscreen: input.pauseDuringFullscreen ?? settings.pauseDuringFullscreen,
        privateApps: Array.isArray(input.privateApps) ? input.privateApps : settings.privateApps,
        privateTitleKeywords: Array.isArray(input.privateTitleKeywords) ? input.privateTitleKeywords : settings.privateTitleKeywords
      });
      startHeatmapTimer();
      if (performanceModePauses("heatmap")) {
        logHeatmapAudit(action.id, "heatmap_paused_by_performance", "skipped", source, "Heatmap tracking is paused by Performance Mode.", { sampleIntervalSeconds: updated.sampleIntervalSeconds }, startedAt);
        return { ok: true, actionId: action.id, heatmapState: heatmapState() };
      }
      logHeatmapAudit(action.id, "heatmap_started", "success", source, "Started Heatmap tracking.", { sampleIntervalSeconds: updated.sampleIntervalSeconds }, startedAt);
      return { ok: true, actionId: action.id, heatmapState: heatmapState() };
    }

    if (action.id === "heatmap.pause") {
      const settings = loadHeatmapSettings();
      const enabled = input.enabled === false ? false : true;
      saveHeatmapSettings({ ...settings, enabled, paused: true });
      stopHeatmapTimer();
      logHeatmapAudit(action.id, enabled ? "heatmap_paused" : "heatmap_disabled", "success", source, enabled ? "Paused Heatmap tracking." : "Disabled Heatmap tracking.", {}, startedAt);
      return { ok: true, actionId: action.id, heatmapState: heatmapState() };
    }

    if (action.id === "heatmap.log_current_app") {
      const result = await logHeatmapSample(source);
      return { ok: result.ok, actionId: action.id, heatmapState: result.heatmapState, snapshot: result.snapshot };
    }

    if (action.id === "heatmap.aggregate_now") {
      const settings = loadHeatmapSettings();
      saveHeatmapSettings({ ...settings, lastAggregatedAt: new Date().toISOString() });
      const state = heatmapState();
      logHeatmapAudit(action.id, "heatmap_aggregation_completed", "success", source, "Aggregated Heatmap summaries.", { eventCount: state.events.length, topAppToday: state.summary.topAppToday }, startedAt);
      return { ok: true, actionId: action.id, heatmapState: state };
    }

    if (action.id === "heatmap.create_goal" || action.id === "heatmap.update_goal") {
      const goals = loadHeatmapGoals();
      const existingId = input.goalId ?? input.id;
      const existing = existingId ? goals.find((goal) => goal.id === existingId) : undefined;
      const goal = normalizeHeatmapGoal(input, existing);
      saveHeatmapGoals([goal, ...goals.filter((item) => item.id !== goal.id)]);
      logHeatmapAudit(action.id, action.id === "heatmap.create_goal" ? "heatmap_goal_created" : "heatmap_goal_updated", "success", source, "Saved Heatmap goal.", { goalId: goal.id, active: goal.active }, startedAt);
      return { ok: true, actionId: action.id, goal, heatmapState: heatmapState() };
    }

    if (action.id === "heatmap.delete_goal") {
      const goalId = String(input.goalId ?? input.id ?? "");
      saveHeatmapGoals(loadHeatmapGoals().filter((goal) => goal.id !== goalId));
      logHeatmapAudit(action.id, "heatmap_goal_deleted", "success", source, "Deleted Heatmap goal.", { goalId }, startedAt);
      return { ok: true, actionId: action.id, heatmapState: heatmapState() };
    }

    if (action.id === "heatmap.clear_data") {
      saveHeatmapEvents([]);
      logHeatmapAudit(action.id, "heatmap_data_cleared", "success", source, "Cleared Heatmap data.", {}, startedAt);
      return { ok: true, actionId: action.id, heatmapState: heatmapState() };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Heatmap action failed.";
    logHeatmapAudit(action.id, "heatmap_action_failed", "failed", source, "Heatmap action failed.", {}, startedAt, message);
    return { ok: false, actionId: action.id, error: message, heatmapState: heatmapState() };
  }

  return null;
}

function logRoutineEvent(
  actionId: string,
  eventType: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Deck",
    actionId,
    eventType,
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function logCaptureEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Capture",
    actionId,
    eventType: "capture_action",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function captureMetadata(item: CaptureItem): Record<string, unknown> {
  return {
    captureId: item.id,
    type: item.type,
    status: item.status,
    routedTo: item.routedTo ?? null,
    hasFile: Boolean(item.filePath)
  };
}

function copyFileIntoCapture(sourcePath: string | null | undefined): { path: string | null; originalName: string | null } {
  if (!sourcePath) {
    return { path: null, originalName: null };
  }
  if (!existsSync(sourcePath)) {
    throw new Error("Capture source file not found.");
  }
  ensureCaptureRoot();
  const originalName = sanitizeFileName(basename(sourcePath));
  const storedName = uniqueFileName(capturesRoot, originalName);
  const storedPath = safeOutputPath(capturesRoot, storedName);
  copyFileSync(sourcePath, storedPath);
  return { path: storedPath, originalName };
}

function normalizeCaptureType(value: unknown): CaptureItemType {
  return value === "note" || value === "link" || value === "task" || value === "expense" || value === "file" || value === "image" || value === "audio_placeholder" || value === "document" || value === "other" ? value : "note";
}

function normalizeCaptureSource(value: unknown): CaptureItemSource {
  return value === "manual" || value === "clipboard" || value === "drop" || value === "tools" || value === "finance" || value === "journal" || value === "command" ? value : "manual";
}

function normalizeCaptureItem(input: CaptureItemInput, existing?: CaptureItem): CaptureItem {
  const now = new Date().toISOString();
  const copiedFile = input.filePath && input.filePath !== existing?.filePath
    ? copyFileIntoCapture(input.filePath)
    : { path: existing?.filePath ?? null, originalName: existing?.originalFileName ?? null };
  const title = input.title?.trim() || existing?.title || previewText(input.text ?? existing?.text ?? "") || copiedFile.originalName || "Untitled capture";
  const url = input.url?.trim() || (normalizeCaptureType(input.type ?? existing?.type) === "link" ? (input.text?.trim() || existing?.url || null) : existing?.url ?? null);

  return {
    id: input.id ?? existing?.id ?? createId("capture-item"),
    type: normalizeCaptureType(input.type ?? existing?.type),
    title,
    text: input.text ?? existing?.text ?? "",
    source: normalizeCaptureSource(input.source ?? existing?.source),
    filePath: copiedFile.path,
    originalFileName: copiedFile.originalName,
    url,
    tags: parseTagList(input.tags ?? existing?.tags),
    status: input.status ?? existing?.status ?? "inbox",
    routedTo: input.routedTo ?? existing?.routedTo ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function logToolsEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Tools",
    actionId,
    eventType: "tools_action",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function logVaultEvent(
  actionId: string,
  status: DexNestEventStatus,
  source: DexNestActionTrigger,
  summary: string,
  metadataJson: Record<string, unknown>,
  startedAt: number,
  errorMessage: string | null = null
): void {
  localDb.appendActionEvent({
    module: "DexNest Vault",
    actionId,
    eventType: "vault_action",
    status,
    source,
    summary,
    metadataJson,
    errorMessage,
    durationMs: Date.now() - startedAt
  });
}

function createVaultDocumentFromFile(filePath: string, input: VaultImportInput, versionBase?: VaultDocumentRecord): VaultDocumentRecord {
  if (!filePath || !existsSync(filePath)) {
    throw new Error("Vault import file not found.");
  }

  ensureVaultRoot();
  const now = new Date().toISOString();
  const originalFileName = basename(filePath);
  const storageRoot = versionBase ? vaultVersionsRoot : vaultDocumentsRoot;
  const storedFileName = uniqueFileName(storageRoot, originalFileName);
  const storedPath = safeOutputPath(storageRoot, storedFileName);
  copyFileSync(filePath, storedPath);

  const versionGroupId = versionBase?.versionGroupId ?? versionBase?.id ?? createId("vault-version");
  const existingVersions = versionBase
    ? loadVaultDocuments().filter((document) => (document.versionGroupId ?? document.id) === versionGroupId)
    : [];
  const versionNumber = versionBase ? Math.max(1, ...existingVersions.map((document) => document.versionNumber ?? 1)) + 1 : 1;

  return {
    id: createId("vault-doc"),
    title: input.title?.trim() || basename(originalFileName, extname(originalFileName)) || originalFileName,
    originalFileName: sanitizeFileName(originalFileName),
    storedFileName,
    filePath: storedPath,
    fileType: extname(originalFileName).toLowerCase() || "file",
    sizeBytes: statSync(storedPath).size,
    category: vaultCategories.includes(String(input.category ?? "")) ? String(input.category) : "Other",
    tags: normalizeTags(input.tags),
    notes: String(input.notes ?? ""),
    sourceModule: String(input.sourceModule ?? "DexNest Vault"),
    expiryDate: input.expiryDate ? String(input.expiryDate) : null,
    createdAt: now,
    updatedAt: now,
    versionGroupId,
    versionNumber
  };
}

function importVaultDocuments(input: VaultImportInput, source: DexNestActionTrigger, actionId = "vault.import_documents") {
  const startedAt = Date.now();
  const paths = Array.isArray(input.paths) ? input.paths.filter(Boolean) : [];

  try {
    if (paths.length === 0) {
      throw new Error("Select one or more documents to import.");
    }

    const existingDocuments = loadVaultDocuments();
    const imported = paths.map((filePath) => createVaultDocumentFromFile(filePath, input));
    saveVaultDocuments([...imported, ...existingDocuments]);
    reindexSearchIndex();
    const queuedJobs = imported
      .map((document) => queueVaultOcrJob(document))
      .filter((job): job is VaultOcrJob => Boolean(job));
    if (loadVaultOcrSettings().autoOcrOnImport && queuedJobs.length > 0) {
      void processVaultOcrQueue(source);
    }
    logVaultEvent(actionId, "success", source, `Imported ${imported.length} Vault document${imported.length === 1 ? "" : "s"}.`, {
      documentIds: imported.map((document) => document.id),
      category: input.category ?? "Other",
      fileCount: imported.length,
      ocrQueuedCount: queuedJobs.length,
      outputSize: imported.reduce((total, document) => total + document.sizeBytes, 0)
    }, startedAt);
    return { ok: true, actionId, documents: imported };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Vault import failed.";
    logVaultEvent(actionId, "failed", source, errorMessage, { fileCount: paths.length }, startedAt, errorMessage);
    return { ok: false, actionId, error: errorMessage };
  }
}

function safeSecureItemType(value: unknown): SecureVaultItemType {
  const itemType = String(value ?? "other") as SecureVaultItemType;
  return secureVaultItemTypes.includes(itemType) ? itemType : "other";
}

function secureItemMetadata(item?: Pick<SecureVaultUnlockedItem | SecureVaultStoredItem, "id" | "title" | "type"> | null): Record<string, unknown> {
  return item ? { itemId: item.id, itemType: item.type, title: item.title } : {};
}

function runSecureVaultAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown) {
  const params = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const startedAt = Date.now();

  try {
    if (action.id === "vault.secure.setup") {
      const masterPassword = String(params.masterPassword ?? "");
      const confirmPassword = String(params.confirmPassword ?? "");
      if (loadSecureVaultFile()) {
        throw new Error("Secure Vault is already set up.");
      }
      if (masterPassword.length < 8) {
        throw new Error("Master password must be at least 8 characters.");
      }
      if (masterPassword !== confirmPassword) {
        throw new Error("Master passwords do not match.");
      }
      const autoLockMinutes = Math.min(60, Math.max(1, Math.floor(Number(params.autoLockMinutes ?? secureVaultDefaultAutoLockMinutes))));
      const file = saveSecureVaultFile(defaultSecureVaultFile(masterPassword, autoLockMinutes));
      scheduleSecureVaultAutoLock(file.settings.autoLockMinutes);
      logVaultEvent(action.id, "success", source, "Set up DexNest Secure Vault.", { kdf: file.kdf.name, autoLockMinutes: file.settings.autoLockMinutes }, startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.unlock") {
      const file = loadSecureVaultFile();
      if (!file) {
        throw new Error("Secure Vault is not set up.");
      }
      const key = deriveSecureVaultKey(String(params.masterPassword ?? ""), file.kdf);
      verifySecureVaultKey(file, key);
      secureVaultKey = key;
      scheduleSecureVaultAutoLock(file.settings.autoLockMinutes);
      logVaultEvent(action.id, "success", source, "Unlocked DexNest Secure Vault.", { itemCount: file.items.length }, startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.lock") {
      lockSecureVault();
      logVaultEvent(action.id, "success", source, "Locked DexNest Secure Vault.", {}, startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.set_lock_mode") {
      const file = loadSecureVaultFile();
      if (!file) {
        throw new Error("Secure Vault is not set up.");
      }
      const lockMode: "on_app_exit" | "timer" = params.lockMode === "timer" ? "timer" : "on_app_exit";
      const nextAutoLock = params.autoLockMinutes !== undefined
        ? Math.min(60, Math.max(1, Math.floor(Number(params.autoLockMinutes))))
        : file.settings.autoLockMinutes;
      saveSecureVaultFile({ ...file, settings: { ...file.settings, lockMode, autoLockMinutes: nextAutoLock } });
      // Apply immediately to the live session: arm/clear the inactivity timer.
      if (secureVaultKey) {
        scheduleSecureVaultAutoLock(nextAutoLock);
        // Realign the trusted session expiry to the new mode.
        if (isTrustedSessionActive()) {
          trustedSessionExpiresAt = lockMode === "timer"
            ? Date.now() + loadAssistantSecuritySettings().sessionTimeoutMinutes * 60 * 1000
            : Number.POSITIVE_INFINITY;
        }
      } else if (secureVaultAutoLockTimer) {
        clearTimeout(secureVaultAutoLockTimer);
        secureVaultAutoLockTimer = null;
      }
      logVaultEvent(action.id, "success", source, `Set Secure Vault lock mode to ${lockMode}.`, { lockMode, autoLockMinutes: nextAutoLock }, startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.import_encrypted_placeholder") {
      logVaultEvent(action.id, "skipped", source, "Secure Vault encrypted import is a future placeholder.", {}, startedAt);
      return { ok: false, actionId: action.id, error: "Encrypted Secure Vault import is a future placeholder." };
    }

    const file = loadSecureVaultFile();
    if (!file) {
      throw new Error("Secure Vault is not set up.");
    }
    const key = requireSecureVaultKey();
    touchSecureVaultActivity();

    if (action.id === "vault.secure.create_item") {
      const now = new Date().toISOString();
      const item: SecureVaultStoredItem = {
        id: createId("secure-item"),
        title: String(params.title ?? "").trim() || "Untitled secure item",
        type: safeSecureItemType(params.type),
        username: String(params.username ?? "").trim() || undefined,
        url: String(params.url ?? "").trim() || undefined,
        tags: normalizeTags(params.tags as string[] | string | undefined),
        secret: encryptSecureValue(String(params.secret ?? ""), key),
        notes: encryptSecureValue(String(params.notes ?? ""), key),
        createdAt: now,
        updatedAt: now,
        lastCopiedAt: null,
        favorite: Boolean(params.favorite)
      };
      saveSecureVaultFile({ ...file, items: [item, ...file.items] });
      logVaultEvent(action.id, "success", source, "Created Secure Vault item.", secureItemMetadata(item), startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.edit_item") {
      const itemId = String(params.itemId ?? "");
      const existing = file.items.find((item) => item.id === itemId);
      if (!existing) {
        throw new Error("Secure Vault item not found.");
      }
      const updated: SecureVaultStoredItem = {
        ...existing,
        title: String(params.title ?? existing.title).trim() || existing.title,
        type: safeSecureItemType(params.type ?? existing.type),
        username: String(params.username ?? existing.username ?? "").trim() || undefined,
        url: String(params.url ?? existing.url ?? "").trim() || undefined,
        tags: normalizeTags(params.tags as string[] | string | undefined),
        secret: encryptSecureValue(String(params.secret ?? decryptSecureValue(existing.secret, key)), key),
        notes: encryptSecureValue(String(params.notes ?? decryptSecureValue(existing.notes, key)), key),
        updatedAt: new Date().toISOString(),
        favorite: Boolean(params.favorite)
      };
      saveSecureVaultFile({ ...file, items: file.items.map((item) => item.id === itemId ? updated : item) });
      logVaultEvent(action.id, "success", source, "Edited Secure Vault item.", secureItemMetadata(updated), startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.delete_item") {
      const itemId = String(params.itemId ?? "");
      const existing = file.items.find((item) => item.id === itemId);
      if (!existing) {
        throw new Error("Secure Vault item not found.");
      }
      saveSecureVaultFile({ ...file, items: file.items.filter((item) => item.id !== itemId) });
      logVaultEvent(action.id, "success", source, "Deleted Secure Vault item.", secureItemMetadata(existing), startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.copy_secret" || action.id === "vault.secure.copy_username") {
      const itemId = String(params.itemId ?? "");
      const existing = file.items.find((item) => item.id === itemId);
      if (!existing) {
        throw new Error("Secure Vault item not found.");
      }
      const copiedValue = action.id === "vault.secure.copy_secret"
        ? decryptSecureValue(existing.secret, key)
        : existing.username ?? "";
      if (!copiedValue) {
        throw new Error(action.id === "vault.secure.copy_secret" ? "Secure item has no secret." : "Secure item has no username.");
      }
      // TODO: When DexNest adds an automatic clipboard listener, mark Secure Vault writes as excluded from Clipboard history.
      clipboard.writeText(copiedValue);
      lastClipboardListenerText = copiedValue;
      secureVaultProtectedClipboardValue = copiedValue;
      if (secureVaultClipboardTimer) {
        clearTimeout(secureVaultClipboardTimer);
      }
      secureVaultClipboardTimer = setTimeout(() => {
        if (clipboard.readText() === copiedValue) {
          clipboard.clear();
        }
        if (secureVaultProtectedClipboardValue === copiedValue) {
          secureVaultProtectedClipboardValue = null;
        }
      }, 30000);
      const updatedItem: SecureVaultStoredItem = { ...existing, lastCopiedAt: new Date().toISOString() };
      saveSecureVaultFile({ ...file, items: file.items.map((item) => item.id === itemId ? updatedItem : item) });
      logVaultEvent(action.id, "success", source, action.id === "vault.secure.copy_secret" ? "Copied Secure Vault secret to clipboard." : "Copied Secure Vault username to clipboard.", secureItemMetadata(existing), startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    if (action.id === "vault.secure.export_encrypted") {
      void shell.showItemInFolder(secureVaultPath);
      logVaultEvent(action.id, "success", source, "Opened encrypted Secure Vault file location.", { filePath: secureVaultPath }, startedAt);
      return { ok: true, actionId: action.id, secure: secureVaultState() };
    }

    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Secure Vault action failed.";
    logVaultEvent(action.id, "failed", source, errorMessage, {
      itemId: typeof params.itemId === "string" ? params.itemId : undefined,
      itemType: typeof params.type === "string" ? params.type : undefined,
      title: typeof params.title === "string" ? params.title : undefined
    }, startedAt, errorMessage);
    return { ok: false, actionId: action.id, error: errorMessage, secure: secureVaultState() };
  }
}

function runVaultAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown) {
  const params = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const startedAt = Date.now();

  try {
    if (action.id.startsWith("vault.secure.")) {
      return runSecureVaultAction(action, source, payload);
    }

    if (action.id === "vault.open" || action.id === "vault.show_expiring_soon") {
      logVaultEvent(action.id, "success", source, action.id === "vault.open" ? "Opened DexNest Vault." : "Opened Vault expiring documents.", { view: "vault" }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "vault.import_documents") {
      return importVaultDocuments({
        paths: Array.isArray(params.paths) ? params.paths.map(String) : [],
        category: String(params.category ?? "Other"),
        tags: params.tags as string[] | string | undefined,
        notes: String(params.notes ?? ""),
        expiryDate: params.expiryDate ? String(params.expiryDate) : null,
        sourceModule: String(params.sourceModule ?? "DexNest Vault"),
        title: typeof params.title === "string" ? params.title : undefined
      }, source, action.id);
    }

    if (action.id === "vault.edit_document_metadata") {
      const documentId = String(params.documentId ?? "");
      const documents = loadVaultDocuments();
      const existing = documents.find((document) => document.id === documentId);
      if (!existing) {
        throw new Error("Vault document not found.");
      }
      const updated: VaultDocumentRecord = {
        ...existing,
        title: String(params.title ?? existing.title).trim() || existing.title,
        category: vaultCategories.includes(String(params.category ?? "")) ? String(params.category) : existing.category,
        tags: normalizeTags(params.tags as string[] | string | undefined).length ? normalizeTags(params.tags as string[] | string | undefined) : existing.tags,
        notes: typeof params.notes === "string" ? params.notes : existing.notes,
        expiryDate: params.expiryDate ? String(params.expiryDate) : null,
        updatedAt: new Date().toISOString()
      };
      saveVaultDocuments(documents.map((document) => document.id === documentId ? updated : document));
      // Auto-refresh the Search index so edited notes/tags/expiry are immediately
      // searchable by Search and Smart Lookup without a manual rebuild.
      reindexSearchIndex();
      logVaultEvent(action.id, "success", source, "Updated Vault document metadata.", {
        documentId,
        category: updated.category,
        fileType: updated.fileType,
        sizeBytes: updated.sizeBytes
      }, startedAt);
      return { ok: true, actionId: action.id, document: updated };
    }

    if (action.id === "vault.ocr.run_queue") {
      if (performanceModePauses("ocr")) {
        void processVaultOcrQueue(source);
        return { ok: false, actionId: action.id, error: "Vault OCR queue is paused by Performance Mode.", vaultState: vaultState() };
      }
      vaultOcrQueuePaused = false;
      void processVaultOcrQueue(source);
      logVaultEvent(action.id, "success", source, "Started Vault GPU OCR queue.", { queuedCount: loadVaultOcrJobs().filter((job) => job.status === "queued").length, engine: "paddleocr", device: "gpu" }, startedAt);
      return { ok: true, actionId: action.id, vaultState: vaultState() };
    }

    if (action.id === "vault.ocr.pause_queue") {
      vaultOcrQueuePaused = true;
      logVaultEvent(action.id, "success", source, "Paused Vault GPU OCR queue.", { running: vaultOcrQueueRunning }, startedAt);
      return { ok: true, actionId: action.id, vaultState: vaultState() };
    }

    if (action.id === "vault.ocr.retry_failed") {
      const now = new Date().toISOString();
      const jobs = loadVaultOcrJobs();
      const failed = jobs.filter((job) => job.status === "failed");
      saveVaultOcrJobs(jobs.map((job) => job.status === "failed" ? { ...job, status: "queued", error: null, startedAt: null, completedAt: null, createdAt: now } : job));
      for (const job of failed) {
        updateVaultDocumentOcr(job.documentId, { ocrStatus: "queued", ocrError: null, ocrUpdatedAt: now });
      }
      if (performanceModePauses("ocr")) {
        void processVaultOcrQueue(source);
        logVaultEvent(action.id, "skipped", source, "Retried failed Vault OCR jobs, but Performance Mode paused the queue.", { retriedCount: failed.length, engine: "paddleocr", device: "gpu" }, startedAt);
        return { ok: true, actionId: action.id, vaultState: vaultState() };
      }
      vaultOcrQueuePaused = false;
      void processVaultOcrQueue(source);
      logVaultEvent(action.id, "success", source, "Retried failed Vault OCR jobs.", { retriedCount: failed.length, engine: "paddleocr", device: "gpu" }, startedAt);
      return { ok: true, actionId: action.id, vaultState: vaultState() };
    }

    if (action.id === "vault.ocr.rerun_document") {
      const document = verifiedVaultDocument(String(params.documentId ?? ""));
      const job = queueVaultOcrJob(document, true);
      if (job) {
        if (performanceModePauses("ocr")) {
          void processVaultOcrQueue(source);
          logVaultEvent(action.id, "skipped", source, "Queued Vault document for OCR, but Performance Mode paused the queue.", { documentId: document.id, fileType: document.fileType, engine: "paddleocr", device: "gpu", queued: true }, startedAt);
          return { ok: true, actionId: action.id, vaultState: vaultState() };
        }
        vaultOcrQueuePaused = false;
        void processVaultOcrQueue(source);
      }
      logVaultEvent(action.id, "success", source, "Queued Vault document for OCR rerun.", { documentId: document.id, fileType: document.fileType, engine: "paddleocr", device: "gpu", queued: Boolean(job) }, startedAt);
      return { ok: true, actionId: action.id, vaultState: vaultState() };
    }

    if (action.id === "vault.ocr.update_settings") {
      const next = saveVaultOcrSettings({
        autoOcrOnImport: Boolean(params.autoOcrOnImport),
        pythonPath: typeof params.pythonPath === "string" && params.pythonPath.trim() ? params.pythonPath.trim() : null
      });
      saveToolsSettings({ ...loadToolsSettings(), pythonPath: next.pythonPath ?? loadToolsSettings().pythonPath ?? null, ocrEngine: "paddleocr", ocrDevice: "gpu" });
      logVaultEvent(action.id, "success", source, "Updated Vault OCR settings.", { autoOcrOnImport: next.autoOcrOnImport, engine: "paddleocr", device: "gpu", hasPythonPath: Boolean(next.pythonPath) }, startedAt);
      return { ok: true, actionId: action.id, vaultState: vaultState() };
    }

    if (action.id === "vault.ocr.open_text" || action.id === "vault.ocr.copy_text") {
      const document = verifiedVaultDocument(String(params.documentId ?? ""));
      if (!document.ocrTextPath || !existsSync(document.ocrTextPath) || !isPathInside(vaultOcrRoot, document.ocrTextPath)) {
        throw new Error("Vault OCR text is not available for this document.");
      }
      if (action.id === "vault.ocr.open_text") {
        void shell.openPath(document.ocrTextPath);
      } else {
        clipboard.writeText(readFileSync(document.ocrTextPath, "utf8"));
      }
      logVaultEvent(action.id, "success", source, action.id === "vault.ocr.open_text" ? "Opened Vault OCR text file." : "Copied Vault OCR text.", { documentId: document.id, fileType: document.fileType, textBytes: statSync(document.ocrTextPath).size }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "vault.open_document" || action.id === "vault.open_document_folder" || action.id === "vault.send_document_to_drop") {
      const document = verifiedVaultDocument(String(params.documentId ?? ""));

      if (action.id === "vault.open_document") {
        void shell.openPath(document.filePath);
        logVaultEvent(action.id, "success", source, "Opened Vault document.", { documentId: document.id, fileType: document.fileType, sizeBytes: document.sizeBytes }, startedAt);
        return { ok: true, actionId: action.id };
      }

      if (action.id === "vault.open_document_folder") {
        void shell.openPath(dirname(document.filePath));
        logVaultEvent(action.id, "success", source, "Opened Vault document folder.", { documentId: document.id, fileType: document.fileType, sizeBytes: document.sizeBytes }, startedAt);
        return { ok: true, actionId: action.id };
      }

      const item = createDropFileItem(document.filePath, "desktop", "outgoing");
      saveDropShelf([item, ...loadDropShelf()]);
      broadcastDropUpdate("Vault document added to Drop.", "drop.outgoing_file_added");
      logVaultEvent(action.id, "success", source, "Sent Vault document to DexNest Drop.", { documentId: document.id, fileType: document.fileType, sizeBytes: document.sizeBytes }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "vault.add_document_version") {
      const baseDocument = findVaultDocument(String(params.documentId ?? ""));
      const paths = Array.isArray(params.paths) ? params.paths.map(String).filter(Boolean) : [];
      if (!baseDocument) {
        throw new Error("Vault document not found.");
      }
      if (paths.length !== 1) {
        throw new Error("Select exactly one file for the new version.");
      }
      const nextVersion = createVaultDocumentFromFile(paths[0], {
        category: baseDocument.category,
        tags: baseDocument.tags,
        notes: baseDocument.notes,
        expiryDate: baseDocument.expiryDate,
        sourceModule: "DexNest Vault",
        title: baseDocument.title
      }, baseDocument);
      saveVaultDocuments([nextVersion, ...loadVaultDocuments()]);
      reindexSearchIndex();
      logVaultEvent(action.id, "success", source, "Added Vault document version.", {
        documentId: nextVersion.id,
        versionGroupId: nextVersion.versionGroupId,
        versionNumber: nextVersion.versionNumber,
        fileType: nextVersion.fileType,
        sizeBytes: nextVersion.sizeBytes
      }, startedAt);
      return { ok: true, actionId: action.id, document: nextVersion };
    }

    if (action.id === "vault.delete_document") {
      const documentId = String(params.documentId ?? "");
      const deleteFile = Boolean(params.deleteFile);
      const documents = loadVaultDocuments();
      const document = documents.find((item) => item.id === documentId);
      if (!document) {
        throw new Error("Vault document not found.");
      }
      if (deleteFile && (!existsSync(document.filePath) || (!isPathInside(vaultDocumentsRoot, document.filePath) && !isPathInside(vaultVersionsRoot, document.filePath)))) {
        throw new Error("Vault copied file path is outside DexNest Vault storage.");
      }
      if (deleteFile && existsSync(document.filePath)) {
        rmSync(document.filePath, { force: true });
      }
      saveVaultDocuments(documents.filter((item) => item.id !== documentId));
      reindexSearchIndex();
      logVaultEvent(action.id, "success", source, deleteFile ? "Deleted Vault document metadata and copied file." : "Deleted Vault document metadata only.", {
        documentId,
        deletedCopiedFile: deleteFile,
        fileType: document.fileType,
        sizeBytes: document.sizeBytes
      }, startedAt);
      return { ok: true, actionId: action.id };
    }

    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "DexNest Vault action failed.";
    logVaultEvent(action.id, "failed", source, errorMessage, {
      documentId: typeof params.documentId === "string" ? params.documentId : undefined
    }, startedAt, errorMessage);
    return { ok: false, actionId: action.id, error: errorMessage };
  }
}

function parsePageRange(range: string, pageCount: number): number[] {
  const pages = new Set<number>();
  const parts = range.split(",").map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      throw new Error("Use page ranges like 1-3 or 1,3,5.");
    }

    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`Page range must be within 1-${pageCount}.`);
    }

    for (let page = start; page <= end; page += 1) {
      pages.add(page - 1);
    }
  }

  if (pages.size === 0) {
    throw new Error("Page range is required.");
  }

  return [...pages];
}

async function getPdfInfo(paths: string[]): Promise<Array<{ fileName: string; byteLength: number; pageCount: number | null }>> {
  const info = [];
  for (const filePath of paths) {
    let pageCount: number | null = null;
    try {
      const pdf = await PDFDocument.load(readFileSync(filePath));
      pageCount = pdf.getPageCount();
    } catch {
      pageCount = null;
    }
    info.push({
      fileName: basename(filePath),
      byteLength: statSync(filePath).size,
      pageCount
    });
  }
  return info;
}

async function mergePdfs(paths: string[]): Promise<ToolsOutputItem> {
  if (paths.length < 2) {
    throw new Error("Select at least two PDFs to merge.");
  }

  const merged = await PDFDocument.create();
  for (const filePath of paths) {
    const sourcePdf = await PDFDocument.load(readFileSync(filePath));
    const copiedPages = await merged.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }

  const output = createToolsOutput(`dexnest-merged-${Date.now()}.pdf`, "merge_pdfs");
  writeFileSync(output.path, await merged.save());
  return recordToolsOutput(output.path, "merge_pdfs");
}

async function splitPdf(paths: string[], range: string): Promise<ToolsOutputItem> {
  if (paths.length !== 1) {
    throw new Error("Select exactly one PDF to split.");
  }

  const sourcePdf = await PDFDocument.load(readFileSync(paths[0]));
  const pageIndexes = parsePageRange(range, sourcePdf.getPageCount());
  const split = await PDFDocument.create();
  const copiedPages = await split.copyPages(sourcePdf, pageIndexes);
  copiedPages.forEach((page) => split.addPage(page));

  const baseName = basename(paths[0], extname(paths[0]));
  const output = createToolsOutput(`${baseName}-pages-${range.replace(/[^0-9,-]/g, "")}.pdf`, "split_pdf");
  writeFileSync(output.path, await split.save());
  return recordToolsOutput(output.path, "split_pdf");
}

async function imagesToPdf(paths: string[]): Promise<ToolsOutputItem> {
  if (paths.length === 0) {
    throw new Error("Select one or more images.");
  }

  const pdf = await PDFDocument.create();
  for (const filePath of paths) {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      throw new Error(`Could not read image: ${basename(filePath)}`);
    }

    const pngBytes = image.toPNG();
    const embedded = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }

  const output = createToolsOutput(`dexnest-images-${Date.now()}.pdf`, "images_to_pdf");
  writeFileSync(output.path, await pdf.save());
  return recordToolsOutput(output.path, "images_to_pdf");
}

function processImages(
  actionId: string,
  paths: string[],
  operation: "compress_image" | "resize_image" | "convert_image",
  options: Record<string, unknown>
): ToolsOutputItem[] {
  if (paths.length === 0) {
    throw new Error("Select one or more images.");
  }

  const outputs: ToolsOutputItem[] = [];
  const format = String(options.format ?? "jpg").toLowerCase();
  const quality = Math.min(100, Math.max(1, Number(options.quality ?? 80)));
  const width = Number(options.width ?? 0);
  const height = Number(options.height ?? 0);

  for (const filePath of paths) {
    let image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      throw new Error(`Could not read image: ${basename(filePath)}`);
    }

    if (operation === "resize_image" && (width > 0 || height > 0)) {
      const currentSize = image.getSize();
      image = image.resize({
        width: width > 0 ? width : undefined,
        height: height > 0 ? height : Math.round((width / currentSize.width) * currentSize.height),
        quality: "best"
      });
    }

    const extension = format === "png" ? "png" : "jpg";
    const baseName = basename(filePath, extname(filePath));
    const output = createToolsOutput(`${baseName}-${operation}.${extension}`, operation);
    const bytes = extension === "png" ? image.toPNG() : image.toJPEG(quality);
    writeFileSync(output.path, bytes);
    outputs.push(recordToolsOutput(output.path, operation));
  }

  return outputs;
}

async function convertMedia(paths: string[], operation: "mp4_to_mp3" | "extract_audio" | "convert_audio", format: string): Promise<ToolsOutputItem[]> {
  if (paths.length === 0) {
    throw new Error("Select one or more media files.");
  }

  const ffmpegPath = resolveFfmpegPath();
  const safeFormat = ["mp3", "wav", "m4a"].includes(format.toLowerCase()) ? format.toLowerCase() : "mp3";
  const outputs: ToolsOutputItem[] = [];

  for (const filePath of paths) {
    const baseName = basename(filePath, extname(filePath));
    const output = createToolsOutput(`${baseName}-${operation}.${operation === "mp4_to_mp3" ? "mp3" : safeFormat}`, operation);
    await execFileAsync(ffmpegPath, ["-y", "-i", filePath, "-vn", output.path]);
    outputs.push(recordToolsOutput(output.path, operation));
  }

  return outputs;
}

async function convertOffice(paths: string[], operation: "docx_to_pdf" | "pptx_to_pdf" | "pdf_to_docx_experimental", targetExtension: "pdf" | "docx"): Promise<ToolsOutputItem[]> {
  if (paths.length === 0) {
    throw new Error("Select one or more Office/PDF files.");
  }

  const libreOfficePath = resolveLibreOfficePath();
  const outputs: ToolsOutputItem[] = [];

  for (const filePath of paths) {
    const tempFolder = createToolsTempFolder(operation);
    try {
      await execFileAsync(libreOfficePath, ["--headless", "--convert-to", targetExtension, "--outdir", tempFolder, filePath]);
      const produced = readdirSync(tempFolder)
        .map((fileName) => join(tempFolder, fileName))
        .find((candidate) => extname(candidate).toLowerCase() === `.${targetExtension}`);
      if (!produced) {
        throw new Error(`LibreOffice did not create a ${targetExtension.toUpperCase()} output.`);
      }
      const output = createToolsOutput(`${basename(filePath, extname(filePath))}-${operation}.${targetExtension}`, operation);
      copyFileSync(produced, output.path);
      outputs.push(recordToolsOutput(output.path, operation));
    } finally {
      rmSync(tempFolder, { recursive: true, force: true });
    }
  }

  return outputs;
}

async function pdfToImages(paths: string[]): Promise<ToolsOutputItem[]> {
  if (paths.length === 0) {
    throw new Error("Select one or more PDFs.");
  }

  const pdftoppmPath = resolveCommandPath("pdftoppm", "Poppler is required for PDF image export. Install it and add pdftoppm to PATH.");
  const outputs: ToolsOutputItem[] = [];

  for (const filePath of paths) {
    const tempFolder = createToolsTempFolder("pdf_to_images");
    try {
      const prefix = join(tempFolder, basename(filePath, extname(filePath)));
      await execFileAsync(pdftoppmPath, ["-png", filePath, prefix]);
      const producedImages = readdirSync(tempFolder)
        .filter((fileName) => extname(fileName).toLowerCase() === ".png")
        .map((fileName) => join(tempFolder, fileName));
      if (producedImages.length === 0) {
        throw new Error("No PDF page images were created.");
      }
      for (const produced of producedImages) {
        const output = createToolsOutput(`${basename(produced, extname(produced))}-pdf-page.png`, "pdf_to_images");
        copyFileSync(produced, output.path);
        outputs.push(recordToolsOutput(output.path, "pdf_to_images"));
      }
    } finally {
      rmSync(tempFolder, { recursive: true, force: true });
    }
  }

  return outputs;
}

async function pdfToText(paths: string[]): Promise<ToolsOutputItem[]> {
  if (paths.length === 0) {
    throw new Error("Select one or more PDFs.");
  }

  const pdftotextPath = resolveCommandPath("pdftotext", "Poppler is required for PDF text export. Install it and add pdftotext to PATH.");
  const outputs: ToolsOutputItem[] = [];

  for (const filePath of paths) {
    const output = createToolsOutput(`${basename(filePath, extname(filePath))}-pdf-text.txt`, "pdf_to_text");
    await execFileAsync(pdftotextPath, [filePath, output.path]);
    outputs.push(recordToolsOutput(output.path, "pdf_to_text"));
  }

  return outputs;
}

function safeOcrLanguage(value: unknown): string {
  const language = String(value ?? loadToolsSettings().ocrLanguage ?? "eng").trim();
  return /^[a-zA-Z0-9_+-]+$/.test(language) ? language : "eng";
}

function safeOcrEngine(value: unknown): "tesseract" | "paddleocr" | "easyocr_placeholder" {
  return value === "tesseract" || value === "paddleocr" || value === "easyocr_placeholder"
    ? value
    : loadToolsSettings().ocrEngine ?? "paddleocr";
}

function safeOcrDevice(value: unknown): "gpu" | "cpu" {
  return value === "cpu" || value === "gpu" ? value : loadToolsSettings().ocrDevice ?? "gpu";
}

function assertOcrImagePath(filePath: string): void {
  const extension = extname(filePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(extension)) {
    throw new Error(`Unsupported OCR image type: ${extension || "unknown"}. Use PNG, JPG, JPEG, or WebP where supported by local Tesseract.`);
  }
}

async function runTesseractToText(inputPath: string, outputBasePath: string, language: string): Promise<string> {
  const tesseractPath = resolveTesseractPath();
  await execFileAsync(tesseractPath, [inputPath, outputBasePath, "-l", language, "txt"]);
  const textPath = `${outputBasePath}.txt`;
  if (!existsSync(textPath)) {
    throw new Error("Tesseract did not create a text output.");
  }
  return readFileSync(textPath, "utf8");
}

interface OcrPreprocessOptions {
  upscale: boolean;
  grayscale: boolean;
  contrast: boolean;
  sharpen: boolean;
  threshold: boolean;
  rotateDegrees: number;
}

interface OcrEngineResult {
  text: string;
  averageConfidence: number | null;
  engine: "tesseract" | "paddleocr";
  deviceUsed?: "gpu" | "cpu" | null;
  note?: string;
}

function ocrPreprocessOptions(params: Record<string, unknown>): OcrPreprocessOptions {
  return {
    upscale: Boolean(params.upscale),
    grayscale: params.grayscale !== false,
    contrast: Boolean(params.contrastBoost ?? params.contrast),
    sharpen: params.sharpen !== false,
    threshold: Boolean(params.threshold),
    rotateDegrees: Number(params.rotateDegrees ?? 0)
  };
}

async function prepareOcrImage(inputPath: string, options: OcrPreprocessOptions, tempFolder: string): Promise<string> {
  const shouldProcess = options.upscale || options.grayscale || options.contrast || options.sharpen || options.threshold || Boolean(options.rotateDegrees);
  if (!shouldProcess) {
    return inputPath;
  }

  const image = await Jimp.read(inputPath);
  if (options.upscale && typeof (image as unknown as { scale?: (value: number) => unknown }).scale === "function") {
    (image as unknown as { scale: (value: number) => unknown }).scale(2);
  }
  if (options.grayscale) {
    image.greyscale();
  }
  if (options.contrast) {
    image.contrast(0.38);
  }
  if (options.sharpen) {
    image.convolute([
      [0, -1, 0],
      [-1, 5, -1],
      [0, -1, 0]
    ]);
  }
  if (options.threshold && typeof (image as unknown as { threshold?: (options: { max: number }) => unknown }).threshold === "function") {
    (image as unknown as { threshold: (options: { max: number }) => unknown }).threshold({ max: 180 });
  }
  if (options.rotateDegrees === 90 || options.rotateDegrees === -90 || options.rotateDegrees === 180 || options.rotateDegrees === 270) {
    image.rotate(options.rotateDegrees);
  }

  const processedPath = join(tempFolder, `${basename(inputPath, extname(inputPath))}-ocr-preprocessed.png`);
  await image.write(processedPath as `${string}.${string}`);
  return processedPath;
}

function paddleOcrScript(): string {
  return [
    "import argparse, contextlib, io, json, os, pathlib, site, sys, warnings",
    "os.environ.setdefault('FLAGS_enable_pir_api', '0')",
    "os.environ.setdefault('FLAGS_use_mkldnn', '0')",
    "os.environ.setdefault('FLAGS_use_onednn', '0')",
    "warnings.filterwarnings('ignore')",
    "def add_nvidia_dll_dirs():",
    "    roots = []",
    "    try: roots.extend(site.getsitepackages())",
    "    except Exception: pass",
    "    try: roots.append(site.getusersitepackages())",
    "    except Exception: pass",
    "    added = []",
    "    seen = set()",
    "    for root in roots:",
    "        nvidia_root = pathlib.Path(root) / 'nvidia'",
    "        if not nvidia_root.exists(): continue",
    "        for dirpath, dirnames, filenames in os.walk(nvidia_root):",
    "            if not any(name.lower().endswith('.dll') for name in filenames): continue",
    "            path = str(dirpath)",
    "            if path in seen: continue",
    "            seen.add(path)",
    "            os.environ['PATH'] = path + os.pathsep + os.environ.get('PATH', '')",
    "            try: os.add_dll_directory(path)",
    "            except Exception: pass",
    "            added.append(path)",
    "    return added",
    "add_nvidia_dll_dirs()",
    "parser = argparse.ArgumentParser()",
    "parser.add_argument('--input', required=True)",
    "parser.add_argument('--lang', default='en')",
    "parser.add_argument('--device', choices=['gpu', 'cpu'], default='gpu')",
    "parser.add_argument('--output-json', required=True)",
    "args = parser.parse_args()",
    "if args.device == 'cpu':",
    "    os.environ['CUDA_VISIBLE_DEVICES'] = '-1'",
    "    os.environ['FLAGS_use_gpu'] = '0'",
    "def finish(payload, code=0):",
    "    with open(args.output_json, 'w', encoding='utf-8') as handle:",
    "        json.dump(payload, handle, ensure_ascii=False)",
    "    sys.exit(code)",
    "try:",
    "    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):",
    "        from paddleocr import PaddleOCR",
    "except Exception as exc:",
    "    finish({'ok': False, 'error': 'PaddleOCR is not installed. Install with: python -m pip install paddleocr paddlepaddle'}, 0)",
    "try:",
    "    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):",
    "        paddle_device = 'gpu:0' if args.device == 'gpu' else 'cpu'",
    "        paddle_kwargs = {'lang': args.lang, 'use_textline_orientation': True, 'device': paddle_device}",
    "        if args.device == 'cpu':",
    "            paddle_kwargs['enable_mkldnn'] = False",
    "        try:",
    "            ocr = PaddleOCR(**paddle_kwargs)",
    "        except TypeError:",
    "            try:",
    "                legacy_kwargs = {'lang': args.lang, 'use_angle_cls': True, 'use_gpu': args.device == 'gpu'}",
    "                if args.device == 'cpu': legacy_kwargs['enable_mkldnn'] = False",
    "                ocr = PaddleOCR(**legacy_kwargs)",
    "            except TypeError:",
    "                ocr = PaddleOCR(lang=args.lang)",
    "        if hasattr(ocr, 'predict'):",
    "            result = ocr.predict(args.input)",
    "        elif hasattr(ocr, 'ocr'):",
    "            try:",
    "                result = ocr.ocr(args.input)",
    "            except TypeError:",
    "                result = ocr.ocr(args.input, cls=True)",
    "        else:",
    "            raise RuntimeError('Installed PaddleOCR does not expose predict() or ocr().')",
    "    lines = []",
    "    confidences = []",
    "    def walk(node):",
    "        if hasattr(node, 'json'):",
    "            try:",
    "                walk(node.json)",
    "                return",
    "            except Exception: pass",
    "        if hasattr(node, 'to_dict'):",
    "            try:",
    "                walk(node.to_dict())",
    "                return",
    "            except Exception: pass",
    "        if isinstance(node, dict):",
    "            texts = node.get('rec_texts')",
    "            scores = node.get('rec_scores') or []",
    "            if isinstance(texts, list):",
    "                for index, value in enumerate(texts):",
    "                    if isinstance(value, str) and value.strip():",
    "                        lines.append(value)",
    "                        try:",
    "                            if index < len(scores): confidences.append(float(scores[index]))",
    "                        except Exception: pass",
    "            text = node.get('rec_text') or node.get('text')",
    "            score = node.get('rec_score') or node.get('confidence') or node.get('score')",
    "            if isinstance(text, str):",
    "                lines.append(text)",
    "                try:",
    "                    if score is not None: confidences.append(float(score))",
    "                except Exception: pass",
    "            for value in node.values(): walk(value)",
    "            return",
    "        if isinstance(node, (list, tuple)):",
    "            if len(node) >= 2 and isinstance(node[1], (list, tuple)) and len(node[1]) >= 2 and isinstance(node[1][0], str):",
    "                lines.append(node[1][0])",
    "                try: confidences.append(float(node[1][1]))",
    "                except Exception: pass",
    "            else:",
    "                for child in node: walk(child)",
    "    walk(result)",
    "    lines = [line.strip() for line in lines if isinstance(line, str) and line.strip()]",
    "    avg = sum(confidences) / len(confidences) if confidences else None",
    "    finish({'ok': True, 'text': '\\n'.join(lines), 'averageConfidence': avg, 'lineCount': len(lines)}, 0)",
    "except Exception as exc:",
    "    finish({'ok': False, 'error': str(exc)}, 0)"
  ].join("\n");
}

function writePaddleOcrSidecarScript(): string {
  mkdirSync(toolsTempRoot, { recursive: true });
  const scriptPath = join(toolsTempRoot, "dexnest-paddle-ocr-sidecar.py");
  writeFileSync(scriptPath, paddleOcrScript(), "utf8");
  return scriptPath;
}

async function runPaddleOcrToText(inputPath: string, language: string, device: "gpu" | "cpu"): Promise<OcrEngineResult> {
  const pythonPath = resolvePythonPath();
  if (device === "gpu") {
    const runtime = getPaddleRuntimeInfo(pythonPath);
    if (!runtime.ok) {
      throw new Error(`PaddleOCR GPU cannot start because DexNest could not inspect the local Paddle runtime. ${runtime.error ?? ""}`.trim());
    }
    if (!runtime.cudaCompiled || runtime.deviceCount < 1) {
      throw new Error(`PaddleOCR GPU is selected, but the installed PaddlePaddle runtime is CPU-only. Install a GPU-enabled PaddlePaddle build for Python 3.12, then retry. Current PaddlePaddle: ${runtime.paddleVersion ?? "unknown"}.`);
    }
  }
  const scriptPath = writePaddleOcrSidecarScript();
  const paddleLanguage = language === "eng" ? "en" : language;
  const resultPath = join(toolsTempRoot, `paddle-ocr-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await execFileAsync(pythonPath, [scriptPath, "--input", inputPath, "--lang", paddleLanguage, "--device", device, "--output-json", resultPath], toolsTempRoot);
  if (!existsSync(resultPath)) {
    throw new Error("PaddleOCR did not return a result file. Verify the local Python/PaddleOCR installation.");
  }
  const parsed = JSON.parse(readFileSync(resultPath, "utf8")) as { ok?: boolean; text?: string; averageConfidence?: number | null; error?: string; lineCount?: number };
  if (!parsed.ok) {
    const rawError = parsed.error ?? "";
    const isPaddleExecutorError = rawError.includes("ConvertPirAttribute2RuntimeAttribute") || rawError.includes("new_executor");
    const setupHint = device === "gpu"
      ? "PaddleOCR GPU failed. Verify a GPU-enabled local PaddlePaddle install, CUDA compatibility, and GPU drivers, or switch OCR device to CPU in Tools Settings."
      : "PaddleOCR CPU failed. Verify the local PaddleOCR/PaddlePaddle install.";
    throw new Error(isPaddleExecutorError ? setupHint : (rawError ? `${setupHint} ${rawError}` : setupHint));
  }
  return {
    text: parsed.text ?? "",
    averageConfidence: typeof parsed.averageConfidence === "number" ? parsed.averageConfidence : null,
    engine: "paddleocr",
    deviceUsed: device
  };
}

async function runOcrEngine(inputPath: string, outputBasePath: string, engine: "tesseract" | "paddleocr", language: string, device: "gpu" | "cpu"): Promise<OcrEngineResult> {
  if (engine === "paddleocr") {
    return runPaddleOcrToText(inputPath, language, device);
  }

  return {
    text: await runTesseractToText(inputPath, outputBasePath, language),
    averageConfidence: null,
    engine: "tesseract"
  };
}

function writeOcrOutputFiles(baseFileName: string, operation: "ocr_image" | "ocr_pdf", engine: string, text: string, metadata: Record<string, unknown>): ToolsOutputItem[] {
  const textOutput = createToolsOutput(`${baseFileName}-${engine}-ocr.txt`, operation);
  writeFileSync(textOutput.path, text, "utf8");
  const textRecord = recordToolsOutput(textOutput.path, operation);
  const metadataOutput = createToolsOutput(`${baseFileName}-${engine}-ocr-metadata.json`, `${operation}_metadata`);
  writeFileSync(metadataOutput.path, JSON.stringify({ ...metadata, textOutputPath: textOutput.path }, null, 2), "utf8");
  const metadataRecord = recordToolsOutput(metadataOutput.path, `${operation}_metadata`);
  return [textRecord, metadataRecord];
}

async function ocrImages(paths: string[], params: Record<string, unknown>): Promise<{ outputs: ToolsOutputItem[]; preview: string; averageConfidence: number | null; engine: string }> {
  if (paths.length === 0) {
    throw new Error("Select one or more image files for OCR.");
  }

  const settings = loadToolsSettings();
  const requestedEngine = safeOcrEngine(params.engine ?? settings.ocrEngine);
  const requestedDevice = safeOcrDevice(params.device ?? settings.ocrDevice);
  if (requestedEngine === "easyocr_placeholder") {
    throw new Error("EasyOCR is a placeholder for later. Use PaddleOCR or Tesseract.");
  }
  const engine = requestedEngine;
  const language = safeOcrLanguage(params.language);
  const preprocess = ocrPreprocessOptions(params);
  const outputs: ToolsOutputItem[] = [];
  const previews: string[] = [];
  const confidences: number[] = [];
  for (const filePath of paths) {
    assertOcrImagePath(filePath);
    const tempFolder = createToolsTempFolder("ocr_image");
    try {
      const inputPath = await prepareOcrImage(filePath, preprocess, tempFolder);
      const outputBase = join(tempFolder, "ocr-output");
      const result = await runOcrEngine(inputPath, outputBase, engine, language, requestedDevice);
      outputs.push(...writeOcrOutputFiles(basename(filePath, extname(filePath)), "ocr_image", result.engine, result.text, {
        engine: result.engine,
        device: result.engine === "paddleocr" ? (result.deviceUsed ?? requestedDevice) : null,
        averageConfidence: result.averageConfidence,
        language,
        originalFileName: basename(filePath),
        preprocessing: preprocess,
        ...(result.note ? { note: result.note } : {}),
        createdAt: new Date().toISOString()
      }));
      previews.push(result.text);
      if (typeof result.averageConfidence === "number") {
        confidences.push(result.averageConfidence);
      }
    } finally {
      rmSync(tempFolder, { recursive: true, force: true });
    }
  }

  return {
    outputs,
    preview: previewText(previews.join("\n\n")),
    averageConfidence: confidences.length ? confidences.reduce((sum, item) => sum + item, 0) / confidences.length : null,
    engine
  };
}

async function ocrPdfs(paths: string[], params: Record<string, unknown>): Promise<{ outputs: ToolsOutputItem[]; preview: string; averageConfidence: number | null; engine: string }> {
  if (paths.length === 0) {
    throw new Error("Select one or more PDF files for OCR.");
  }

  const settings = loadToolsSettings();
  const requestedEngine = safeOcrEngine(params.engine ?? settings.ocrEngine);
  const requestedDevice = safeOcrDevice(params.device ?? settings.ocrDevice);
  if (requestedEngine === "easyocr_placeholder") {
    throw new Error("EasyOCR is a placeholder for later. Use PaddleOCR or Tesseract.");
  }
  const engine = requestedEngine;
  const language = safeOcrLanguage(params.language);
  const preprocess = ocrPreprocessOptions(params);
  const pdftoppmPath = resolveCommandPath("pdftoppm", "Poppler is required for PDF OCR image export. Install it and add pdftoppm to PATH.");
  const outputs: ToolsOutputItem[] = [];
  const previews: string[] = [];
  const confidences: number[] = [];

  for (const filePath of paths) {
    if (extname(filePath).toLowerCase() !== ".pdf") {
      throw new Error("PDF OCR only accepts PDF files.");
    }

    const tempFolder = createToolsTempFolder("ocr_pdf");
    try {
      const prefix = join(tempFolder, basename(filePath, extname(filePath)));
      await execFileAsync(pdftoppmPath, ["-png", filePath, prefix]);
      const producedImages = readdirSync(tempFolder)
        .filter((fileName) => extname(fileName).toLowerCase() === ".png")
        .map((fileName) => join(tempFolder, fileName))
        .sort();
      if (producedImages.length === 0) {
        throw new Error("No PDF page images were created for OCR.");
      }

      const pageTexts: string[] = [];
      let deviceUsed: "gpu" | "cpu" | null = engine === "paddleocr" ? requestedDevice : null;
      let fallbackNote: string | undefined;
      for (const [index, imagePath] of producedImages.entries()) {
        const inputPath = await prepareOcrImage(imagePath, preprocess, tempFolder);
        const pageBase = join(tempFolder, `ocr-page-${index + 1}`);
        const result = await runOcrEngine(inputPath, pageBase, engine, language, requestedDevice);
        pageTexts.push(result.text);
        if (engine === "paddleocr" && result.deviceUsed) {
          deviceUsed = result.deviceUsed;
        }
        if (result.note) {
          fallbackNote = result.note;
        }
        if (typeof result.averageConfidence === "number") {
          confidences.push(result.averageConfidence);
        }
      }

      const combinedText = pageTexts.join("\n\n");
      outputs.push(...writeOcrOutputFiles(basename(filePath, extname(filePath)), "ocr_pdf", engine, combinedText, {
        engine,
        device: deviceUsed,
        averageConfidence: confidences.length ? confidences.reduce((sum, item) => sum + item, 0) / confidences.length : null,
        language,
        originalFileName: basename(filePath),
        pageCount: producedImages.length,
        preprocessing: preprocess,
        ...(fallbackNote ? { note: fallbackNote } : {}),
        createdAt: new Date().toISOString()
      }));
      previews.push(combinedText);
    } finally {
      rmSync(tempFolder, { recursive: true, force: true });
    }
  }

  return {
    outputs,
    preview: previewText(previews.join("\n\n")),
    averageConfidence: confidences.length ? confidences.reduce((sum, item) => sum + item, 0) / confidences.length : null,
    engine
  };
}

async function runVaultOcrForDocument(document: VaultDocumentRecord): Promise<{ textPath: string; metadataPath: string; textLength: number; averageConfidence: number | null }> {
  if (!existsSync(document.filePath)) {
    throw new Error("Vault document file is missing.");
  }
  if (!isVaultOcrSupported(document.fileType)) {
    throw new Error("Unsupported Vault OCR file type.");
  }

  const settings = loadToolsSettings();
  const language = safeOcrLanguage(settings.ocrLanguage);
  const preprocess = ocrPreprocessOptions({
    upscale: true,
    grayscale: true,
    contrastBoost: true,
    sharpen: true,
    threshold: false
  });
  const tempFolder = createToolsTempFolder("vault_ocr");
  const confidences: number[] = [];
  const texts: string[] = [];

  try {
    if (document.fileType.toLowerCase() === ".pdf") {
      const pdftoppmPath = resolveCommandPath("pdftoppm", "Poppler is required for Vault PDF OCR. Install it and add pdftoppm to PATH.");
      const prefix = join(tempFolder, basename(document.filePath, extname(document.filePath)));
      await execFileAsync(pdftoppmPath, ["-png", document.filePath, prefix]);
      const producedImages = readdirSync(tempFolder)
        .filter((fileName) => extname(fileName).toLowerCase() === ".png")
        .map((fileName) => join(tempFolder, fileName))
        .sort();
      if (producedImages.length === 0) {
        throw new Error("No PDF page images were created for Vault OCR.");
      }
      for (const imagePath of producedImages) {
        const inputPath = await prepareOcrImage(imagePath, preprocess, tempFolder);
        const result = await runPaddleOcrToText(inputPath, language, "gpu");
        texts.push(result.text);
        if (typeof result.averageConfidence === "number") {
          confidences.push(result.averageConfidence);
        }
      }
    } else {
      assertOcrImagePath(document.filePath);
      const inputPath = await prepareOcrImage(document.filePath, preprocess, tempFolder);
      const result = await runPaddleOcrToText(inputPath, language, "gpu");
      texts.push(result.text);
      if (typeof result.averageConfidence === "number") {
        confidences.push(result.averageConfidence);
      }
    }

    const text = texts.join("\n\n").trim();
    if (!text) {
      throw new Error("PaddleOCR GPU completed but returned empty text.");
    }
    const averageConfidence = confidences.length ? confidences.reduce((sum, item) => sum + item, 0) / confidences.length : null;
    const output = saveVaultOcrOutput(document, text, {
      documentId: document.id,
      originalFileName: document.originalFileName,
      storedFileName: document.storedFileName,
      sourceFilePath: document.filePath,
      engine: "paddleocr",
      device: "gpu",
      language,
      averageConfidence,
      textLength: text.length,
      preprocessing: preprocess,
      createdAt: new Date().toISOString()
    });
    return { textPath: output.textPath, metadataPath: output.metadataPath, textLength: text.length, averageConfidence };
  } finally {
    rmSync(tempFolder, { recursive: true, force: true });
  }
}

async function processVaultOcrQueue(source: DexNestActionTrigger | "system" = "system"): Promise<void> {
  if (vaultOcrQueueRunning || vaultOcrQueuePaused) {
    return;
  }
  if (performanceModePauses("ocr")) {
    vaultOcrQueuePaused = true;
    localDb.appendActionEvent({
      module: "DexNest Vault",
      actionId: "vault.ocr.run_queue",
      eventType: "vault_ocr_queue_paused_by_performance",
      status: "skipped",
      source: source === "system" ? "system" : source,
      summary: "Vault OCR queue is paused by Performance Mode.",
      metadataJson: { queuedCount: loadVaultOcrJobs().filter((job) => job.status === "queued").length, engine: "paddleocr", device: "gpu" }
    });
    return;
  }

  vaultOcrQueueRunning = true;
  try {
    while (!vaultOcrQueuePaused) {
      const job = loadVaultOcrJobs().find((item) => item.status === "queued");
      if (!job) {
        break;
      }
      const startedAt = Date.now();
      const startedIso = new Date().toISOString();
      setVaultOcrJob(job.id, { status: "running", startedAt: startedIso, error: null });
      updateVaultDocumentOcr(job.documentId, { ocrStatus: "running", ocrError: null, ocrUpdatedAt: startedIso });
      const document = findVaultDocument(job.documentId);
      if (!document) {
        const errorMessage = "Vault document metadata not found for OCR job.";
        setVaultOcrJob(job.id, { status: "failed", completedAt: new Date().toISOString(), error: errorMessage });
        continue;
      }
      try {
        const result = await runVaultOcrForDocument(document);
        const completedAt = new Date().toISOString();
        setVaultOcrJob(job.id, {
          status: "completed",
          completedAt,
          error: null,
          outputTextPath: result.textPath,
          outputMetadataPath: result.metadataPath
        });
        updateVaultDocumentOcr(document.id, {
          ocrStatus: "completed",
          ocrTextPath: result.textPath,
          ocrMetadataPath: result.metadataPath,
          ocrError: null,
          ocrUpdatedAt: completedAt
        });
        // Make the freshly extracted OCR text searchable right away.
        reindexSearchIndex();
        localDb.appendActionEvent({
          module: "DexNest Vault",
          actionId: "vault.ocr.run_queue",
          eventType: "vault_ocr_completed",
          status: "success",
          source: source === "system" ? "system" : source,
          summary: "Completed Vault document GPU OCR.",
          metadataJson: { jobId: job.id, documentId: document.id, fileType: document.fileType, engine: "paddleocr", device: "gpu", textLength: result.textLength, averageConfidence: result.averageConfidence },
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Vault OCR failed.";
        const completedAt = new Date().toISOString();
        setVaultOcrJob(job.id, { status: "failed", completedAt, error: errorMessage });
        updateVaultDocumentOcr(document.id, { ocrStatus: "failed", ocrError: errorMessage, ocrUpdatedAt: completedAt });
        localDb.appendActionEvent({
          module: "DexNest Vault",
          actionId: "vault.ocr.run_queue",
          eventType: "vault_ocr_failed",
          status: "failed",
          source: source === "system" ? "system" : source,
          summary: "Vault document GPU OCR failed.",
          metadataJson: { jobId: job.id, documentId: document.id, fileType: document.fileType, engine: "paddleocr", device: "gpu" },
          errorMessage,
          durationMs: Date.now() - startedAt
        });
      }
    }
  } finally {
    vaultOcrQueueRunning = false;
  }
}

async function cleanScanImages(paths: string[], options: Record<string, unknown>, operation: "clean_scan" | "cleaned_image_to_pdf" = "clean_scan"): Promise<ToolsOutputItem[]> {
  if (paths.length === 0) {
    throw new Error("Select one or more scan images.");
  }

  const outputs: ToolsOutputItem[] = [];
  const rotateDegrees = Number(options.rotateDegrees ?? 0);
  const shouldGrayscale = options.grayscale !== false;
  const contrastValue = Math.max(-1, Math.min(1, Number(options.contrast ?? 0.28)));
  const shouldSharpen = options.sharpen !== false;

  for (const filePath of paths) {
    assertOcrImagePath(filePath);
    const image = await Jimp.read(filePath);
    if (shouldGrayscale) {
      image.greyscale();
    }
    if (contrastValue !== 0) {
      image.contrast(contrastValue);
    }
    if (shouldSharpen) {
      image.convolute([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
      ]);
    }
    if (rotateDegrees === 90 || rotateDegrees === -90 || rotateDegrees === 180 || rotateDegrees === 270) {
      image.rotate(rotateDegrees);
    }

    const output = createToolsOutput(`${basename(filePath, extname(filePath))}-cleaned.png`, operation);
    await image.write(output.path as `${string}.${string}`);
    outputs.push(recordToolsOutput(output.path, operation));
  }

  return outputs;
}

async function pptxToImages(paths: string[]): Promise<ToolsOutputItem[]> {
  if (paths.length === 0) {
    throw new Error("Select one or more PPTX files.");
  }

  const libreOfficePath = resolveLibreOfficePath();
  const pdftoppmPath = resolveCommandPath("pdftoppm", "Poppler is required for PPTX image export. Install it and add pdftoppm to PATH.");
  const outputs: ToolsOutputItem[] = [];

  for (const filePath of paths) {
    const tempFolder = createToolsTempFolder("pptx_to_images");
    try {
      await execFileAsync(libreOfficePath, ["--headless", "--convert-to", "pdf", "--outdir", tempFolder, filePath]);
      const pdfPath = readdirSync(tempFolder)
        .map((fileName) => join(tempFolder, fileName))
        .find((candidate) => extname(candidate).toLowerCase() === ".pdf");
      if (!pdfPath) {
        throw new Error("LibreOffice did not create a PDF intermediate.");
      }
      const prefix = join(tempFolder, basename(filePath, extname(filePath)));
      await execFileAsync(pdftoppmPath, ["-png", pdfPath, prefix]);
      const producedImages = readdirSync(tempFolder)
        .filter((fileName) => extname(fileName).toLowerCase() === ".png")
        .map((fileName) => join(tempFolder, fileName));
      if (producedImages.length === 0) {
        throw new Error("No PPTX slide images were created.");
      }
      for (const produced of producedImages) {
        const output = createToolsOutput(`${basename(produced, extname(produced))}-slide.png`, "pptx_to_images");
        copyFileSync(produced, output.path);
        outputs.push(recordToolsOutput(output.path, "pptx_to_images"));
      }
    } finally {
      rmSync(tempFolder, { recursive: true, force: true });
    }
  }

  return outputs;
}

async function runToolsAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown): Promise<ToolsRunResult | null> {
  const params = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const paths = Array.isArray(params.paths) ? params.paths.map(String).filter(Boolean) : [];
  const startedAt = Date.now();

  try {
    if (action.id === "tools.open") {
      logToolsEvent(action.id, "success", source, "Opened DexNest Tools.", { view: "tools" }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "tools.open_output_folder") {
      void shell.openPath(getToolsOutputFolder());
      logToolsEvent(action.id, "success", source, "Opened DexNest Tools output folder.", { path: getToolsOutputFolder() }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "tools.send_output_to_drop") {
      const filePath = getVerifiedToolsOutputPath(String(params.path ?? ""));
      const item = createDropFileItem(filePath, "desktop", "outgoing");
      saveDropShelf([item, ...loadDropShelf()]);
      broadcastDropUpdate("Tools output added to Drop.", "drop.outgoing_file_added");
      logToolsEvent(action.id, "success", source, "Sent Tools output to DexNest Drop.", {
        fileName: item.originalName,
        outputSize: item.byteLength
      }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "tools.save_output_to_vault") {
      const filePath = getVerifiedToolsOutputPath(String(params.path ?? ""));
      const result = importVaultDocuments({
        paths: [filePath],
        category: String(params.category ?? "Other"),
        tags: params.tags as string[] | string | undefined,
        notes: String(params.notes ?? ""),
        expiryDate: params.expiryDate ? String(params.expiryDate) : null,
        sourceModule: "DexNest Tools",
        title: typeof params.title === "string" ? params.title : undefined
      }, source, action.id);
      if (!result.ok) {
        throw new Error(result.error ?? "Save to Vault failed.");
      }
      logToolsEvent(action.id, "success", source, "Saved Tools output to DexNest Vault.", {
        fileName: basename(filePath),
        category: String(params.category ?? "Other")
      }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "tools.merge_pdfs") {
      const output = await mergePdfs(paths);
      logToolsEvent(action.id, "success", source, `Merged ${paths.length} PDFs.`, {
        fileCount: paths.length,
        outputSize: output.byteLength,
        operation: "merge_pdfs"
      }, startedAt);
      return { ok: true, actionId: action.id, output, outputs: [output] };
    }

    if (action.id === "tools.split_pdf") {
      const output = await splitPdf(paths, String(params.range ?? ""));
      logToolsEvent(action.id, "success", source, "Split PDF by page range.", {
        fileCount: paths.length,
        outputSize: output.byteLength,
        operation: "split_pdf",
        range: String(params.range ?? "")
      }, startedAt);
      return { ok: true, actionId: action.id, output, outputs: [output] };
    }

    if (action.id === "tools.images_to_pdf") {
      const output = await imagesToPdf(paths);
      logToolsEvent(action.id, "success", source, `Created PDF from ${paths.length} image${paths.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputSize: output.byteLength,
        operation: "images_to_pdf"
      }, startedAt);
      return { ok: true, actionId: action.id, output, outputs: [output] };
    }

    if (action.id === "tools.compress_image" || action.id === "tools.resize_image" || action.id === "tools.convert_image") {
      const operation = action.id.replace("tools.", "") as "compress_image" | "resize_image" | "convert_image";
      const outputs = processImages(action.id, paths, operation, params);
      logToolsEvent(action.id, "success", source, `Processed ${outputs.length} image${outputs.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: outputs[0] };
    }

    if (action.id === "tools.mp4_to_mp3" || action.id === "tools.extract_audio" || action.id === "tools.convert_audio") {
      const operation = action.id.replace("tools.", "") as "mp4_to_mp3" | "extract_audio" | "convert_audio";
      const outputs = await convertMedia(paths, operation, String(params.format ?? "mp3"));
      logToolsEvent(action.id, "success", source, `Converted ${outputs.length} media file${outputs.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: outputs.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: outputs[0] };
    }

    if (action.id === "tools.docx_to_pdf" || action.id === "tools.pptx_to_pdf" || action.id === "tools.pdf_to_docx_experimental") {
      const operation = action.id.replace("tools.", "") as "docx_to_pdf" | "pptx_to_pdf" | "pdf_to_docx_experimental";
      const outputs = await convertOffice(paths, operation, operation === "pdf_to_docx_experimental" ? "docx" : "pdf");
      logToolsEvent(action.id, "success", source, `Converted ${outputs.length} document${outputs.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: outputs.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation,
        experimental: operation === "pdf_to_docx_experimental"
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: outputs[0] };
    }

    if (action.id === "tools.pptx_to_images") {
      const outputs = await pptxToImages(paths);
      logToolsEvent(action.id, "success", source, `Exported ${outputs.length} slide image${outputs.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: outputs.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation: "pptx_to_images"
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: outputs[0] };
    }

    if (action.id === "tools.pdf_to_images") {
      const outputs = await pdfToImages(paths);
      logToolsEvent(action.id, "success", source, `Exported ${outputs.length} PDF page image${outputs.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: outputs.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation: "pdf_to_images"
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: outputs[0] };
    }

    if (action.id === "tools.pdf_to_text") {
      const outputs = await pdfToText(paths);
      logToolsEvent(action.id, "success", source, `Exported text from ${paths.length} PDF${paths.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: outputs.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation: "pdf_to_text"
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: outputs[0] };
    }

    if (action.id === "tools.ocr_image") {
      const result = await ocrImages(paths, params);
      logToolsEvent(action.id, "success", source, `OCR completed for ${paths.length} image file${paths.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: result.outputs.length,
        outputSize: result.outputs.reduce((total, item) => total + item.byteLength, 0),
        operation: "ocr_image",
        engine: result.engine,
        averageConfidence: result.averageConfidence,
        language: safeOcrLanguage(params.language)
      }, startedAt);
      return { ok: true, actionId: action.id, outputs: result.outputs, output: result.outputs[0], ocrPreview: result.preview, ocrMetadata: { engine: result.engine, averageConfidence: result.averageConfidence } };
    }

    if (action.id === "tools.ocr_pdf") {
      const result = await ocrPdfs(paths, params);
      logToolsEvent(action.id, "success", source, `OCR completed for ${paths.length} PDF file${paths.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: result.outputs.length,
        outputSize: result.outputs.reduce((total, item) => total + item.byteLength, 0),
        operation: "ocr_pdf",
        engine: result.engine,
        averageConfidence: result.averageConfidence,
        language: safeOcrLanguage(params.language)
      }, startedAt);
      return { ok: true, actionId: action.id, outputs: result.outputs, output: result.outputs[0], ocrPreview: result.preview, ocrMetadata: { engine: result.engine, averageConfidence: result.averageConfidence } };
    }

    if (action.id === "tools.clean_scan") {
      const outputs = await cleanScanImages(paths, params, "clean_scan");
      logToolsEvent(action.id, "success", source, `Cleaned ${outputs.length} scan image${outputs.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: outputs.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation: "clean_scan"
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: outputs[0] };
    }

    if (action.id === "tools.cleaned_image_to_pdf") {
      const cleanedOutputs = await cleanScanImages(paths, params, "cleaned_image_to_pdf");
      const pdfOutput = await imagesToPdf(cleanedOutputs.map((output) => output.path));
      const outputs = [...cleanedOutputs, pdfOutput];
      logToolsEvent(action.id, "success", source, `Created cleaned PDF from ${paths.length} scan image${paths.length === 1 ? "" : "s"}.`, {
        fileCount: paths.length,
        outputCount: outputs.length,
        outputSize: outputs.reduce((total, item) => total + item.byteLength, 0),
        operation: "cleaned_image_to_pdf"
      }, startedAt);
      return { ok: true, actionId: action.id, outputs, output: pdfOutput };
    }

    if (action.id === "tools.open_tools_settings" || action.id === "tools.open_ocr_settings") {
      logToolsEvent(action.id, "success", source, "Opened DexNest Tools settings.", { view: action.id === "tools.open_ocr_settings" ? "ocr_settings" : "tools_settings" }, startedAt);
      return { ok: true, actionId: action.id };
    }

    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "DexNest Tools action failed.";
    logToolsEvent(action.id, "failed", source, errorMessage, {
      fileCount: paths.length,
      operation: action.id.replace("tools.", "")
    }, startedAt, errorMessage);
    return { ok: false, actionId: action.id, error: errorMessage };
  }
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
    const result = saveClipboardText(text, "manual");
    if (result.reason === "empty") {
      logActionEvent(action, "skipped", source, "Clipboard save skipped because clipboard text was empty.", { byteLength: 0 });
      return { ok: false, actionId: action.id, error: "Clipboard text is empty." };
    }
    if (result.reason === "secure_vault") {
      logActionEvent(action, "skipped", source, "Clipboard save skipped because the current clipboard value came from DexNest Secure Vault.", { protectedSource: "secure_vault" });
      return { ok: false, actionId: action.id, error: clipboardProtectedError() };
    }
    if (result.reason === "duplicate") {
      logActionEvent(action, "skipped", source, "Clipboard save skipped because it matched the latest history item.", { duplicate: true });
      return { ok: false, actionId: action.id, error: "Clipboard text is already the latest history item." };
    }

    const item = result.item as ClipboardHistoryItem;
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

  if (action.id === "clipboard.toggle_listener") {
    const enabled = Boolean(params.enabled);
    const settings = saveClipboardSettings({ ...loadClipboardSettings(), listenerEnabled: enabled });
    if (enabled) {
      startClipboardListener();
    } else {
      stopClipboardListener();
    }
    logActionEvent(action, "success", source, `Clipboard listener ${enabled ? "enabled" : "disabled"}.`, {
      enabled,
      intervalMs: settings.listenerIntervalMs
    });
    return { ok: true, actionId: action.id, settings: loadClipboardSettings() };
  }

  if (action.id === "clipboard.test_read_current") {
    try {
      const text = clipboard.readText();
      const settings = loadClipboardSettings();
      saveClipboardSettings({
        ...settings,
        lastReadAt: now,
        lastReadPreview: previewText(text),
        lastReadError: null
      });
      logActionEvent(action, "success", source, `Read current Clipboard preview, ${byteLength(text)} bytes.`, {
        byteLength: byteLength(text),
        hasText: Boolean(text.trim())
      });
      return { ok: true, actionId: action.id, preview: previewText(text), byteLength: byteLength(text) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Clipboard read failed.";
      saveClipboardSettings({ ...loadClipboardSettings(), lastReadAt: now, lastReadError: errorMessage });
      logActionEvent(action, "failed", source, "Clipboard test read failed.", {}, errorMessage);
      return { ok: false, actionId: action.id, error: errorMessage };
    }
  }

  if (action.id === "clipboard.start_multi_copy") {
    const existingSession = loadClipboardActiveMultiCopySession();
    if (existingSession) {
      logActionEvent(action, "skipped", source, "Multi-copy session is already active.", { sessionId: existingSession.id });
      return { ok: false, actionId: action.id, error: "Multi-copy is already running." };
    }
    const session = saveClipboardActiveMultiCopySession({
      id: createId("multi-copy"),
      startedAt: now,
      updatedAt: now,
      items: []
    });
    logActionEvent(action, "success", source, "Started DexNest multi-copy session.", { sessionId: session?.id });
    return { ok: true, actionId: action.id, session };
  }

  if (action.id === "clipboard.stop_multi_copy") {
    const session = loadClipboardActiveMultiCopySession();
    if (!session) {
      logActionEvent(action, "skipped", source, "No active multi-copy session to stop.");
      return { ok: false, actionId: action.id, error: "No active multi-copy session." };
    }
    saveClipboardActiveMultiCopySession(null);
    logActionEvent(action, "success", source, `Stopped DexNest multi-copy session with ${session.items.length} temporary items.`, {
      sessionId: session.id,
      itemCount: session.items.length
    });
    return { ok: true, actionId: action.id, itemCount: session.items.length };
  }

  if (action.id === "clipboard.save_multi_copy_group") {
    const session = loadClipboardActiveMultiCopySession();
    if (!session) {
      logActionEvent(action, "skipped", source, "No active multi-copy session to save.");
      return { ok: false, actionId: action.id, error: "No active multi-copy session." };
    }
    const name = String(params.name ?? "").trim() || `Multi-copy ${formatLocalDateTime(now)}`;
    const group: ClipboardMultiGroup = {
      id: createId("multi-group"),
      name,
      items: session.items,
      createdAt: session.startedAt,
      updatedAt: now
    };
    saveClipboardMultiGroups([group, ...loadClipboardMultiGroups()]);
    logActionEvent(action, "success", source, `Saved DexNest multi-copy group with ${group.items.length} items.`, {
      groupId: group.id,
      itemCount: group.items.length
    });
    return { ok: true, actionId: action.id, group };
  }

  if (action.id === "clipboard.clear_multi_copy_session") {
    if (!params.confirmedDangerous) {
      logActionEvent(action, "cancelled", source, "Multi-copy session clear cancelled because confirmation was missing.");
      return { ok: false, actionId: action.id, error: "Confirmation required." };
    }
    const session = loadClipboardActiveMultiCopySession();
    if (!session) {
      logActionEvent(action, "skipped", source, "No active multi-copy session to clear.");
      return { ok: false, actionId: action.id, error: "No active multi-copy session." };
    }
    clearActiveMultiCopyAfterPaste("manual", source);
    return { ok: true, actionId: action.id };
  }

  if (action.id === "clipboard.copy_combined_group") {
    const settings = loadClipboardSettings();
    const groupId = typeof params.groupId === "string" ? params.groupId : "";
    const group = groupId ? loadClipboardMultiGroups().find((item) => item.id === groupId) : null;
    const activeSession = loadClipboardActiveMultiCopySession();
    const items = group?.items ?? activeSession?.items ?? [];
    if (items.length === 0) {
      logActionEvent(action, "failed", source, "Combined Clipboard group copy failed because there were no items.", { groupId: groupId || null });
      return { ok: false, actionId: action.id, error: "No Clipboard group items to copy." };
    }
    const combinedText = combinedClipboardText(items, String(params.separator ?? settings.combinedSeparator ?? "\n\n"));
    if (!combinedText.trim()) {
      logActionEvent(action, "failed", source, "Combined Clipboard group copy failed because text was empty.", { groupId: groupId || null, itemCount: items.length });
      return { ok: false, actionId: action.id, error: "Combined Clipboard text is empty." };
    }
    clipboard.writeText(combinedText);
    lastClipboardListenerText = combinedText;
    if (!groupId && activeSession) {
      armActiveMultiCopyForPaste(activeSession, combinedText);
    }
    logActionEvent(action, "success", source, `Copied combined Clipboard group with ${items.length} items.`, {
      groupId: groupId || (activeSession?.id ?? null),
      itemCount: items.length,
      byteLength: byteLength(combinedText)
    });
    return { ok: true, actionId: action.id, itemCount: items.length, byteLength: byteLength(combinedText) };
  }

  if (action.id === "clipboard.update_settings") {
    const currentSettings = loadClipboardSettings();
    const retentionValue = params.historyRetentionDays === "never" ? "never" : Number(params.historyRetentionDays);
    const nextRetention = retentionValue === "never" || retentionValue === 1 || retentionValue === 3 || retentionValue === 7 || retentionValue === 30
      ? retentionValue
      : currentSettings.historyRetentionDays;
    const nextSettings: ClipboardSettings = {
      ...currentSettings,
      multiCopyHotkeyEnabled: typeof params.multiCopyHotkeyEnabled === "boolean" ? params.multiCopyHotkeyEnabled : currentSettings.multiCopyHotkeyEnabled,
      multiCopyHotkey: typeof params.multiCopyHotkey === "string" ? normalizeClipboardHotkey(params.multiCopyHotkey) : currentSettings.multiCopyHotkey,
      multiCopyAutoClearMinutes: Number.isFinite(Number(params.multiCopyAutoClearMinutes))
        ? Math.max(1, Math.min(240, Number(params.multiCopyAutoClearMinutes)))
        : currentSettings.multiCopyAutoClearMinutes,
      historyRetentionDays: nextRetention,
      combinedSeparator: typeof params.combinedSeparator === "string" ? params.combinedSeparator : currentSettings.combinedSeparator,
      secretProtectionEnabled: typeof params.secretProtectionEnabled === "boolean" ? params.secretProtectionEnabled : currentSettings.secretProtectionEnabled,
      slotSequenceEnabled: typeof params.slotSequenceEnabled === "boolean" ? params.slotSequenceEnabled : currentSettings.slotSequenceEnabled,
      slotSequenceWindowMs: Number.isFinite(Number(params.slotSequenceWindowMs))
        ? Math.max(200, Math.min(3000, Number(params.slotSequenceWindowMs)))
        : currentSettings.slotSequenceWindowMs
    };
    saveClipboardSettings(nextSettings);
    registerClipboardHotkey();
    registerKeyboardShortcuts();
    reconcileSlotHook();
    if (!nextSettings.multiCopyHotkeyEnabled) {
      stopArmedMultiCopyPasteDetection();
    }
    scheduleActiveMultiCopyAutoClear();
    logActionEvent(action, "success", source, "Updated DexNest Clipboard settings.", {
      multiCopyHotkeyEnabled: nextSettings.multiCopyHotkeyEnabled,
      multiCopyHotkey: nextSettings.multiCopyHotkey,
      multiCopyHotkeyStatus: loadClipboardSettings().multiCopyHotkeyStatus,
      multiCopyAutoClearMinutes: nextSettings.multiCopyAutoClearMinutes,
      historyRetentionDays: nextSettings.historyRetentionDays,
      separatorLength: nextSettings.combinedSeparator.length
    });
    return { ok: true, actionId: action.id, settings: nextSettings };
  }

  if (action.id === "clipboard.delete_multi_copy_group") {
    if (!params.confirmedDangerous) {
      logActionEvent(action, "cancelled", source, "Multi-copy group delete cancelled because confirmation was missing.");
      return { ok: false, actionId: action.id, error: "Confirmation required." };
    }
    const groupId = String(params.groupId ?? "");
    const groups = loadClipboardMultiGroups();
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      logActionEvent(action, "failed", source, "Multi-copy group delete failed because the group was not found.", { groupId });
      return { ok: false, actionId: action.id, error: "Multi-copy group not found." };
    }
    saveClipboardMultiGroups(groups.filter((item) => item.id !== groupId));
    logActionEvent(action, "success", source, `Deleted multi-copy group with ${group.items.length} items.`, {
      groupId,
      itemCount: group.items.length
    });
    return { ok: true, actionId: action.id };
  }

  if (action.id === "clipboard.copy_history_item") {
    const itemId = String(params.id ?? "");
    const items = [...loadClipboardHistory(), ...(loadClipboardActiveMultiCopySession()?.items ?? []), ...loadClipboardMultiGroups().flatMap((group) => group.items)];
    const item = items.find((historyItem) => historyItem.id === itemId);
    if (!item) {
      logActionEvent(action, "failed", source, "Clipboard history copy failed because the item was not found.", { itemId });
      return { ok: false, actionId: action.id, error: "Clipboard item not found." };
    }
    clipboard.writeText(item.text);
    lastClipboardListenerText = item.text;
    logActionEvent(action, "success", source, `Copied Clipboard history item, ${item.byteLength} bytes.`, {
      itemId,
      byteLength: item.byteLength
    });
    return { ok: true, actionId: action.id };
  }

  if (action.id === "clipboard.assign_slot" || /^clipboard\.slot[1-3]\.save_current$/.test(action.id)) {
    const slotNumber = slotNumberFromAction(action.id, params);
    const text = clipboard.readText();
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 5) {
      logActionEvent(action, "failed", source, "Clipboard slot assignment failed because the slot was invalid.", { slot: params.slot });
      return { ok: false, actionId: action.id, error: "Slot must be 1 through 5." };
    }
    if (!text.trim()) {
      logActionEvent(action, "skipped", source, "Clipboard slot assignment skipped because clipboard text was empty.", { slot: slotNumber });
      return { ok: false, actionId: action.id, error: "Clipboard text is empty." };
    }
    if (isProtectedClipboardText(text)) {
      logActionEvent(action, "skipped", source, "Clipboard slot assignment skipped for a Secure Vault protected value.", { slot: slotNumber, protectedSource: "secure_vault" });
      notifyClipboardHotkey("Protected secret skipped.", "error");
      return { ok: false, actionId: action.id, error: clipboardProtectedError() };
    }
    const sensitive = looksSensitiveClipboardText(text);
    if (sensitive && params.confirmedSensitive !== true) {
      logActionEvent(action, "cancelled", source, "Clipboard slot assignment blocked because the clipboard looked sensitive.", {
        slot: slotNumber,
        sensitivityCategory: "likely_sensitive",
        byteLength: byteLength(text)
      });
      if (source === "keyboard_shortcut") {
        notifyClipboardHotkey("Clipboard looks sensitive. Open DexNest Clipboard to confirm saving it.", "error");
      }
      return {
        ok: false,
        actionId: action.id,
        status: "sensitive_confirmation_required",
        error: "Clipboard looks sensitive. Confirm before saving it to a slot."
      };
    }
    const slots = loadClipboardSlots();
    const existingSlot = slots.find((slot) => slot.slot === slotNumber);
    const nextSlot: ClipboardSlot = {
      slot: slotNumber,
      slotId: slotNumber,
      type: "text",
      value: text,
      text,
      preview: sensitive ? "Sensitive text saved" : previewText(text),
      byteLength: byteLength(text),
      createdAt: existingSlot?.createdAt || now,
      updatedAt: now,
      source: slotSourceFor(source)
    };
    saveClipboardSlots(slots.map((slot) => slot.slot === slotNumber ? nextSlot : slot));
    logActionEvent(action, "success", source, `Assigned current clipboard to slot ${slotNumber}, ${nextSlot.byteLength} bytes.`, {
      slot: slotNumber,
      contentType: "text",
      byteLength: nextSlot.byteLength,
      sensitivityCategory: sensitive ? "likely_sensitive_confirmed" : "normal"
    });
    if (source === "keyboard_shortcut") {
      notifyClipboardHotkey(`Saved to Slot ${slotNumber}.`, "success");
    }
    return { ok: true, actionId: action.id, slot: nextSlot };
  }

  if (action.id === "clipboard.copy_slot" || /^clipboard\.slot[1-3]\.paste$/.test(action.id)) {
    const slotNumber = slotNumberFromAction(action.id, params);
    const slot = loadClipboardSlots().find((item) => item.slot === slotNumber);
    const slotText = slot?.value || slot?.text || "";
    if (!slotText) {
      logActionEvent(action, "failed", source, "Clipboard slot copy failed because the slot was empty.", { slot: slotNumber });
      if (source === "keyboard_shortcut") {
        notifyClipboardHotkey(`Slot ${slotNumber} is empty.`, "error");
      }
      return { ok: false, actionId: action.id, error: "Clipboard slot is empty." };
    }
    const slotByteLength = slot?.byteLength ?? byteLength(slotText);
    const slotContentType = slot?.type ?? "text";
    clipboard.writeText(slotText);
    lastClipboardListenerText = slotText;
    let pastedDirectly = false;
    let pasteError: string | null = null;
    if (source === "keyboard_shortcut" || params.pasteDirect === true) {
      pastedDirectly = true;
      void sendWindowsPasteShortcut().catch((error) => {
        pasteError = error instanceof Error ? error.message : "Direct paste failed.";
        notifyClipboardHotkey(`Slot ${slotNumber} copied. Press Ctrl+V.`, "error");
      });
    }
    logActionEvent(action, "success", source, `${pastedDirectly ? "Pasted" : "Copied"} Clipboard slot ${slotNumber}, ${slotByteLength} bytes.`, {
      slot: slotNumber,
      contentType: slotContentType,
      byteLength: slotByteLength,
      pasteMode: pastedDirectly ? "direct" : "clipboard_fallback",
      sensitivityCategory: looksSensitiveClipboardText(slotText) ? "likely_sensitive_confirmed" : "normal"
    });
    if (source === "keyboard_shortcut") {
      notifyClipboardHotkey(pastedDirectly ? `Pasted Slot ${slotNumber}.` : `Slot ${slotNumber} copied. Press Ctrl+V.`, pastedDirectly ? "success" : "error");
    }
    return { ok: true, actionId: action.id, pasteMode: pastedDirectly ? "direct" : "clipboard_fallback", pasteError };
  }

  if (action.id === "clipboard.clear_slot") {
    const slotNumber = slotNumberFromAction(action.id, params);
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 5) {
      logActionEvent(action, "failed", source, "Clipboard slot clear failed because the slot was invalid.", { slot: params.slot });
      return { ok: false, actionId: action.id, error: "Slot must be 1 through 5." };
    }
    const slots = loadClipboardSlots();
    const slot = slots.find((item) => item.slot === slotNumber);
    const clearedSlot: ClipboardSlot = {
      slot: slotNumber,
      slotId: slotNumber,
      type: "text",
      value: "",
      text: "",
      preview: "",
      byteLength: 0,
      createdAt: "",
      updatedAt: "",
      source: "clipboard_ui"
    };
    saveClipboardSlots(slots.map((item) => item.slot === slotNumber ? clearedSlot : item));
    logActionEvent(action, "success", source, `Cleared Clipboard slot ${slotNumber}.`, {
      slot: slotNumber,
      contentType: slot?.type ?? "text",
      byteLength: slot?.byteLength ?? 0
    });
    return { ok: true, actionId: action.id, slot: clearedSlot };
  }

  if (action.id === "clipboard.clear_history") {
    if (!params.confirmedDangerous) {
      logActionEvent(action, "cancelled", source, "Clipboard history clear cancelled because confirmation was missing.");
      return { ok: false, actionId: action.id, error: "Confirmation required." };
    }
    const count = loadClipboardHistory().length;
    saveClipboardHistory([]);
    logActionEvent(action, "success", source, `Cleared ${count} Clipboard history items.`, { count });
    return { ok: true, actionId: action.id };
  }

  if (action.id === "clipboard.cleanup_history") {
    const result = cleanupClipboardHistory(Boolean(params.force), source);
    return { ok: true, actionId: action.id, removedCount: result.removedCount, skipped: result.skipped };
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
    broadcastDropUpdate("Text sent to phone.", "drop.outgoing_text_created");
    return { ok: true, actionId: action.id, item };
  }

  if (action.id === "drop.send_clipboard_to_drop") {
    const explicitText = typeof params.text === "string" ? params.text : "";
    const confirmed = params.confirmed === true || params.confirmedDangerous === true;
    if (source === "stream_deck_http" && !explicitText && !confirmed) {
      const text = clipboard.readText();
      const trimmed = text.trim();
      const protectedValue = isProtectedClipboardText(text);
      const sensitive = protectedValue || looksSensitiveClipboardText(text);
      const preview = {
        kind: trimmed ? "text" : "unknown",
        charCount: trimmed.length,
        safePreview: trimmed && !sensitive ? endpointPreviewText(trimmed) : ""
      };
      logActionEvent(action, "cancelled", source, "Clipboard-to-Drop requires confirmation from Stream Deck HTTP.", {
        clipboardKind: preview.kind,
        charCount: preview.charCount,
        confirmationRequired: true,
        sensitivePreviewHidden: sensitive
      });
      return {
        ok: false,
        status: "confirmation_required",
        actionId: action.id,
        message: "Open DexNest to confirm sending current clipboard to Drop.",
        error: "Open DexNest to confirm sending current clipboard to Drop.",
        preview
      };
    }

    const text = explicitText || clipboard.readText();
    if (!text.trim()) {
      logActionEvent(action, "skipped", source, "Clipboard-to-Drop skipped because clipboard text was empty.", { byteLength: 0 });
      return { ok: false, actionId: action.id, error: "Clipboard text is empty." };
    }
    if (!explicitText && isProtectedClipboardText(text)) {
      logActionEvent(action, "skipped", source, "Clipboard-to-Drop skipped for a Secure Vault protected value.", {
        protectedSource: "secure_vault",
        confirmationRequired: source === "stream_deck_http"
      });
      return { ok: false, actionId: action.id, error: clipboardProtectedError() };
    }
    if (source === "stream_deck_http" && !explicitText && looksSensitiveClipboardText(text)) {
      logActionEvent(action, "cancelled", source, "Clipboard-to-Drop blocked because the clipboard looked sensitive.", {
        clipboardKind: "text",
        charCount: text.trim().length,
        confirmationRequired: true,
        sensitivePreviewHidden: true
      });
      return {
        ok: false,
        status: "confirmation_required",
        actionId: action.id,
        message: "Clipboard looks sensitive. Open DexNest Drop to confirm sending it.",
        error: "Clipboard looks sensitive. Open DexNest Drop to confirm sending it.",
        preview: {
          kind: "text",
          charCount: text.trim().length,
          safePreview: ""
        }
      };
    }

    const item = createDropTextItem(text, explicitText ? "manual" : "clipboard", "outgoing");
    saveDropShelf([item, ...loadDropShelf()]);
    logActionEvent(action, "success", source, `${explicitText ? "Sent explicit text" : "Sent clipboard text"} to outgoing Drop, ${item.byteLength} bytes.`, {
      dropId: item.id,
      byteLength: item.byteLength,
      expiresAt: item.expiresAt,
      explicitText: Boolean(explicitText),
      confirmedFromEndpoint: source === "stream_deck_http" ? confirmed : false
    });
    broadcastDropUpdate("Clipboard sent to phone.", "drop.outgoing_text_created");
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
    broadcastDropUpdate("File added for phone download.", "drop.outgoing_file_added");
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
    broadcastDropUpdate("Outgoing file removed.", "drop.outgoing_file_removed");
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
    broadcastDropUpdate("Outgoing Drop shelf cleared.", "drop.outgoing_cleared");
    return { ok: true, actionId: action.id, count };
  }

  if (action.id === "drop.clear_incoming") {
    const count = loadDropIncoming().length;
    saveDropIncoming([]);
    logActionEvent(action, "success", source, `Cleared ${count} incoming Drop metadata item${count === 1 ? "" : "s"}.`, { count });
    broadcastDropUpdate("Incoming Drop list cleared.", "drop.incoming_cleared");
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

async function chooseDropReceiveFolder(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const openOptions: OpenDialogOptions = {
    title: "Choose DexNest Drop receive folder",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, openOptions) : await dialog.showOpenDialog(openOptions);
  const selectedPath = result.canceled ? "" : result.filePaths[0];
  if (!selectedPath) {
    return { ok: false, error: "No folder selected." };
  }

  const isOutsideLocalData = !isPathInside(localDataRoot, selectedPath);
  if (isOutsideLocalData) {
    const messageOptions: MessageBoxOptions = {
      type: "warning",
      buttons: ["Use folder", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "DexNest Drop receive folder",
      message: "This folder is outside local-data.",
      detail: "DexNest can use it, but project rules prefer local-data for user data."
    };
    const response = mainWindow
      ? await dialog.showMessageBox(mainWindow, messageOptions)
      : await dialog.showMessageBox(messageOptions);
    if (response.response !== 0) {
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
  broadcastDropUpdate("Receive folder changed.", "drop.receive_folder_changed");
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
  broadcastDropUpdate("Receive folder reset.", "drop.receive_folder_reset");
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

function sharedDesignTokensCss(): string {
  const tokensPath = resolve(repoRoot, "packages", "shared-ui", "src", "tokens.css");
  return readFileSync(tokensPath, "utf8");
}

function designTokenValue(tokenName: string): string {
  const match = sharedDesignTokensCss().match(new RegExp(`${tokenName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*:\\s*([^;]+);`));
  if (!match) {
    throw new Error(`DexNest design token not found: ${tokenName}`);
  }
  return match[1].trim();
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
    background_color: designTokenValue("--bg"),
    theme_color: designTokenValue("--accent-drop"),
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
  const background = designTokenValue("--bg");
  const accent = designTokenValue("--accent-drop");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="DexNest Drop">
  <rect width="512" height="512" rx="96" fill="${background}"/>
  <path d="M256 92 372 160v136L256 420 140 296V160L256 92Z" fill="none" stroke="${accent}" stroke-width="28" stroke-linejoin="round"/>
  <path d="M256 92v120m0 0 116-52m-116 52-116-52m116 52v208" fill="none" stroke="${accent}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function renderDropPhonePage(): string {
  const tokenCss = sharedDesignTokensCss();
  const themeColor = designTokenValue("--accent-drop");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="${themeColor}" />
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
    }
    ${tokenCss}
    :root {
      --accent: var(--accent-drop);
      --font-ui: Inter, system-ui, -apple-system, sans-serif;
      --font-tech: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
      --radius: 16px;
      --radius-sm: 12px;
      --gap: 14px;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--font-ui);
      color: var(--text);
      background:
        radial-gradient(120% 72% at 50% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 58%),
        var(--bg);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      overscroll-behavior-y: contain;
    }
    main { display: grid; gap: var(--gap); max-width: 640px; margin: 0 auto; padding: 0 14px max(112px, calc(env(safe-area-inset-bottom) + 92px)); }
    h1, h2, h3, p { margin: 0; }
    p { line-height: 1.5; }

    /* Sticky brand bar */
    .topbar {
      position: sticky; top: 0; z-index: 5;
      display: flex; align-items: center; gap: 12px;
      padding: max(14px, calc(env(safe-area-inset-top) + 12px)) 4px 12px;
      margin-bottom: 2px;
      background: color-mix(in srgb, var(--bg) 78%, transparent);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      backdrop-filter: blur(16px) saturate(140%);
    }
    .brand-icon {
      width: 42px; height: 42px; flex: none; color: var(--accent);
      display: grid; place-items: center; border-radius: 13px;
      border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
    }
    .brand-icon svg { width: 22px; height: 22px; }
    .brand-text h1 { font-size: 1.15rem; font-weight: 650; letter-spacing: -0.01em; }
    .brand-text .sub { font-size: 0.72rem; color: var(--text-muted); margin-top: 1px; }

    /* Cards */
    .card {
      display: grid; gap: 12px; padding: 16px;
      border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--surface);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.015), 0 10px 34px -24px rgba(0,0,0,0.95);
    }
    .card-head { display: flex; align-items: center; gap: 9px; }
    .card-head .bar { width: 3px; height: 14px; border-radius: 3px; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
    .card-head h2 { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); }

    /* Controls */
    button, input, textarea, a.btn {
      width: 100%; min-height: 48px; padding: 13px 14px; font: inherit;
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      color: var(--text); background: var(--surface-2);
      transition: border-color 0.15s ease, background 0.15s ease, transform 0.08s ease;
    }
    button, a.btn { text-align: center; text-decoration: none; cursor: pointer; font-weight: 500; }
    button:active, a.btn:active { transform: scale(0.985); background: var(--surface-hover); }
    input:focus, textarea:focus { outline: none; border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
    button.primary, a.primary {
      border-color: color-mix(in srgb, var(--accent) 45%, transparent);
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      color: color-mix(in srgb, var(--accent) 78%, var(--text));
      font-weight: 600;
    }
    textarea { min-height: 116px; resize: vertical; text-align: left; line-height: 1.5; }
    input[type="file"] { padding: 11px 12px; color: var(--text-muted); font-size: 0.88rem; }
    input[type="file"]::file-selector-button {
      margin-right: 12px; padding: 8px 14px; min-height: 0;
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); border-radius: 10px;
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: color-mix(in srgb, var(--accent) 82%, var(--text)); font: inherit; font-weight: 600;
    }

    /* Items */
    .item { display: grid; gap: 10px; padding: 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
    .item > p:first-child { font-size: 0.95rem; overflow-wrap: anywhere; }
    .mono { font-family: var(--font-tech); overflow-wrap: anywhere; }
    .notice, .meta, .file-count { color: var(--text-muted); }
    .meta, .file-count { font-family: var(--font-tech); font-size: 0.74rem; }
    .empty { padding: 18px 14px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--radius-sm); font-size: 0.85rem; }
    .path-row { display: grid; gap: 4px; padding-top: 2px; }
    .path-row .label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }

    /* Toasts */
    .toast-stack { position: fixed; left: 14px; right: 14px; bottom: max(16px, calc(env(safe-area-inset-bottom) + 12px)); display: grid; gap: 8px; z-index: 20; pointer-events: none; }
    .toast {
      padding: 13px 15px; border: 1px solid color-mix(in srgb, var(--success) 45%, transparent); border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--surface-2) 82%, var(--bg));
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      color: var(--text); font-size: 0.9rem;
      box-shadow: 0 14px 40px -16px rgba(0,0,0,0.9);
      animation: toast-in 0.22s cubic-bezier(0.22,1,0.36,1);
    }
    .toast[data-tone="error"] { border-color: color-mix(in srgb, var(--error) 50%, transparent); }
    @keyframes toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.001ms !important; transition: none !important; } }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <span class="brand-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19 7v6l-7 4-7-4V7l7-4Z"/><path d="M12 3v5m0 0 7-3M12 8 5 5m7 3v9"/></svg>
      </span>
      <div class="brand-text">
        <h1>DexNest Drop</h1>
        <p class="sub">Local Wi-Fi · phone ↔ PC</p>
      </div>
    </header>
    <section class="card">
      <div class="card-head"><span class="bar"></span><h2>From PC · Text</h2></div>
      <div id="texts"></div>
    </section>
    <section class="card">
      <div class="card-head"><span class="bar"></span><h2>From PC · Files</h2></div>
      <div id="files"></div>
    </section>
    <section class="card">
      <div class="card-head"><span class="bar"></span><h2>Send to PC · Text</h2></div>
      <textarea id="note" placeholder="Write a note to save on the PC"></textarea>
      <p id="textStatus" class="notice"></p>
    </section>
    <section class="card">
      <div class="card-head"><span class="bar"></span><h2>Send to PC · Files</h2></div>
      <p class="notice">Photos / gallery</p>
      <input id="uploadGallery" type="file" accept="image/*" multiple />
      <p id="gallerySelectedCount" class="file-count">No photos selected</p>
      <p class="notice">Files / docs</p>
      <input id="uploadFiles" type="file" multiple />
      <p id="selectedCount" class="file-count">No files selected</p>
      <p id="fileStatus" class="notice"></p>
      <div class="path-row"><span class="label">PC receive folder</span><span id="receivePath" class="mono"></span></div>
    </section>
  </main>
  <div id="toastStack" class="toast-stack" aria-live="polite"></div>
  <script>
    let uploadActive = false;
    let refreshTimer = null;
    let dropEvents = null;
    let textUploadTimer = null;
    let lastSentText = '';
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
      let state;
      try {
        const response = await fetch('/drop/api/state');
        state = await response.json();
      } catch (error) {
        toast('Refresh failed', 'error');
        return;
      }
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
    async function uploadTextNow() {
      const note = document.getElementById('note');
      const text = note.value.trim();
      if (!text || text === lastSentText) return;
      lastSentText = text;
      const response = await fetch('/drop/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      document.getElementById('textStatus').textContent = response.ok ? 'Uploaded text to PC.' : 'Text upload failed.';
      if (response.ok) {
        note.value = '';
        lastSentText = '';
        toast('Text sent');
      } else {
        lastSentText = '';
        toast('Text send failed', 'error');
      }
      await loadDrop();
    }
    document.getElementById('note').oninput = () => {
      if (textUploadTimer) clearTimeout(textUploadTimer);
      document.getElementById('textStatus').textContent = 'Auto-sending after typing stops.';
      textUploadTimer = setTimeout(() => {
        void uploadTextNow();
      }, 900);
    };
    document.getElementById('uploadFiles').onchange = (event) => {
      const count = event.target.files ? event.target.files.length : 0;
      document.getElementById('selectedCount').textContent = count ? count + ' file' + (count === 1 ? '' : 's') + ' selected' : 'No files selected';
      if (count) void uploadSelectedFiles('uploadFiles', 'selectedCount', 'No files selected');
    };
    document.getElementById('uploadGallery').onchange = (event) => {
      const count = event.target.files ? event.target.files.length : 0;
      document.getElementById('gallerySelectedCount').textContent = count ? count + ' photo' + (count === 1 ? '' : 's') + ' selected' : 'No photos selected';
      if (count) void uploadSelectedFiles('uploadGallery', 'gallerySelectedCount', 'No photos selected');
    };
    async function uploadSelectedFiles(inputId, countId, emptyLabel) {
      const input = document.getElementById(inputId);
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
        document.getElementById(countId).textContent = emptyLabel;
      }
      uploadActive = false;
      await loadDrop();
    }
    function connectDropEvents() {
      if (dropEvents) dropEvents.close();
      if (!window.EventSource) {
        refreshTimer = setInterval(loadDrop, 3000);
        return;
      }
      try {
        dropEvents = new EventSource('/drop/api/events');
      } catch (error) {
        if (!refreshTimer) refreshTimer = setInterval(loadDrop, 3000);
        return;
      }
      dropEvents.onmessage = (event) => {
        let payload = {};
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        void loadDrop();
        if (payload.eventType && payload.eventType.indexOf('drop.outgoing') === 0 && payload.message) {
          toast(payload.message);
        }
      };
      dropEvents.onerror = () => {
        if (!refreshTimer) refreshTimer = setInterval(loadDrop, 3000);
      };
    }
    loadDrop();
    connectDropEvents();
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

  if (request.method === "GET" && url.pathname === "/drop/api/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    sendDropEvent(response, {
      eventType: "drop.connected",
      message: "DexNest Drop live updates connected.",
      timestamp: new Date().toISOString()
    });
    dropEventClients.add(response);
    request.on("close", () => {
      dropEventClients.delete(response);
    });
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
    broadcastDropUpdate("Text received from phone.", "drop.incoming_text_created");
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
    broadcastDropUpdate(`${savedItems.length} file${savedItems.length === 1 ? "" : "s"} received from phone.`, "drop.incoming_files_created");
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

function runJournalAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as JournalEntryInput & { entryId?: string }) : {};

  try {
    if (action.id === "journal.open" || action.id === "journal.open_today") {
      logJournalEvent(action.id, "success", source, "Opened DexNest Journal.", {}, startedAt);
      return { ok: true, actionId: action.id, journalState: journalState() };
    }

    if (action.id === "journal.create_entry" || action.id === "journal.update_entry") {
      const entries = loadJournalEntries();
      const now = new Date().toISOString();
      const entryId = input.id ?? createId("journal-entry");
      const existing = entries.find((entry) => entry.id === entryId);
      const rawText = input.rawText ?? existing?.rawText ?? "";
      const cleanedText = cleanJournalText(rawText);
      const nextEntry: JournalEntry = {
        id: entryId,
        date: input.date ?? existing?.date ?? todayDateString(),
        title: input.title ?? existing?.title ?? "",
        rawText,
        cleanedText,
        mood: input.mood ?? existing?.mood ?? "",
        productivity: input.productivity ?? existing?.productivity ?? "",
        tags: parseTagList(input.tags ?? existing?.tags),
        peopleTags: parseTagList(input.peopleTags ?? existing?.peopleTags),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        extractedItems: extractCalendarCandidatesFromText(rawText, input.date ?? existing?.date ?? todayDateString())
      };
      const saved = saveJournalEntries([nextEntry, ...entries.filter((entry) => entry.id !== entryId)]);
      logJournalEvent(
        action.id,
        "success",
        source,
        `${existing ? "Updated" : "Created"} DexNest Journal entry.`,
        {
          entryId,
          date: nextEntry.date,
          tagCount: nextEntry.tags.length,
          peopleTagCount: nextEntry.peopleTags.length,
          rawTextBytes: byteLength(rawText),
          extractedCandidateCount: nextEntry.extractedItems.length
        },
        startedAt
      );
      return { ok: true, actionId: action.id, entry: nextEntry, journalState: { ...journalState(), entries: saved } };
    }

    if (action.id === "journal.delete_entry") {
      const entryId = input.entryId ?? input.id ?? "";
      const entries = loadJournalEntries();
      const existing = entries.find((entry) => entry.id === entryId);
      saveJournalEntries(entries.filter((entry) => entry.id !== entryId));
      logJournalEvent(
        action.id,
        "success",
        source,
        "Deleted DexNest Journal entry.",
        { entryId, date: existing?.date ?? null },
        startedAt
      );
      return { ok: true, actionId: action.id, journalState: journalState() };
    }

    if (action.id === "journal.extract_events") {
      const rawText = input.rawText ?? loadJournalEntries().find((entry) => entry.id === input.entryId)?.rawText ?? "";
      const candidates = extractCalendarCandidatesFromText(rawText, input.date ?? todayDateString());
      logJournalEvent(
        action.id,
        "success",
        source,
        `Extracted ${candidates.length} Calendar candidate${candidates.length === 1 ? "" : "s"} from Journal text.`,
        { entryId: input.entryId ?? input.id ?? null, candidateCount: candidates.length },
        startedAt
      );
      return { ok: true, actionId: action.id, candidates };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest Journal action failed.";
    logJournalEvent(action.id, "failed", source, message, payloadMetadata(payload), startedAt, message);
    return { ok: false, actionId: action.id, error: message };
  }

  return null;
}

function normalizeCalendarInput(input: CalendarEventInput, existing?: CalendarEvent): CalendarEvent {
  const now = new Date().toISOString();
  return {
    id: input.id ?? existing?.id ?? createId("calendar-event"),
    title: input.title?.trim() || existing?.title || "Untitled event",
    date: input.date || existing?.date || todayDateString(),
    startTime: input.startTime ?? existing?.startTime ?? null,
    endTime: input.endTime ?? existing?.endTime ?? null,
    allDay: input.allDay ?? existing?.allDay ?? false,
    sourceModule: input.sourceModule ?? existing?.sourceModule ?? "calendar",
    sourceId: input.sourceId ?? existing?.sourceId ?? null,
    recurrence: input.recurrence ?? existing?.recurrence ?? null,
    reminderLevel: input.reminderLevel ?? existing?.reminderLevel ?? "normal",
    notes: input.notes ?? existing?.notes ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function runCalendarAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as CalendarEventInput & { eventId?: string; nudgeId?: string; snoozeMinutes?: number; nudgeSettings?: Partial<NudgeSettings> }) : {};

  try {
    if (action.id === "calendar.open" || action.id === "calendar.show_today" || action.id === "calendar.show_upcoming") {
      refreshNudges(source, false);
      logCalendarEvent(action.id, "success", source, "Opened DexNest Calendar.", {}, startedAt);
      return { ok: true, actionId: action.id, calendarState: calendarState() };
    }

    if (action.id === "calendar.nudge.refresh") {
      const next = refreshNudges(source, true);
      return { ok: true, actionId: action.id, nudges: next, calendarState: calendarState() };
    }

    if (action.id === "calendar.nudge.dismiss" || action.id === "calendar.nudge.complete" || action.id === "calendar.nudge.snooze") {
      const nudgeId = input.nudgeId ?? input.id ?? "";
      const nudges = loadNudges();
      const existing = nudges.find((nudge) => nudge.id === nudgeId);
      if (!existing) {
        throw new Error("Nudge not found.");
      }
      const nextStatus: NudgeStatus = action.id === "calendar.nudge.dismiss" ? "dismissed" : action.id === "calendar.nudge.complete" ? "completed" : "snoozed";
      const snoozeMinutes = Math.max(5, Number(input.snoozeMinutes ?? 60));
      const updated: Nudge = {
        ...existing,
        status: nextStatus,
        snoozeUntil: nextStatus === "snoozed" ? new Date(Date.now() + snoozeMinutes * 60_000).toISOString() : null,
        updatedAt: new Date().toISOString()
      };
      saveNudges([updated, ...nudges.filter((nudge) => nudge.id !== nudgeId)]);
      logNudgeEvent(
        action.id,
        nextStatus === "dismissed" ? "nudge_dismissed" : nextStatus === "completed" ? "nudge_completed" : "nudge_snoozed",
        "success",
        source,
        nextStatus === "dismissed" ? "Dismissed DexNest nudge." : nextStatus === "completed" ? "Completed DexNest nudge." : "Snoozed DexNest nudge.",
        { nudgeId, sourceModule: existing.sourceModule, sourceId: existing.sourceId ?? null, priority: existing.priority, snoozeMinutes: nextStatus === "snoozed" ? snoozeMinutes : null },
        startedAt
      );
      createDexNestTray();
      return { ok: true, actionId: action.id, nudge: updated, calendarState: calendarState() };
    }

    if (action.id === "calendar.nudge.open_source") {
      const nudgeId = input.nudgeId ?? input.id ?? "";
      const nudge = loadNudges().find((item) => item.id === nudgeId);
      if (!nudge) {
        throw new Error("Nudge not found.");
      }
      const viewMap: Record<string, string> = {
        backup: "settings",
        calendar: "calendar",
        finance: "finance",
        journal: "journal",
        vault: "vault"
      };
      const view = viewMap[nudge.sourceModule] ?? "calendar";
      focusDexNestWindow(view, "system");
      logNudgeEvent(action.id, "nudge_source_opened", "success", source, "Opened DexNest nudge source.", { nudgeId, sourceModule: nudge.sourceModule, sourceId: nudge.sourceId ?? null }, startedAt);
      return { ok: true, actionId: action.id, calendarState: calendarState() };
    }

    if (action.id === "calendar.nudge.update_settings") {
      const current = loadNudgeSettings();
      const next = saveNudgeSettings({
        enabled: input.nudgeSettings?.enabled ?? current.enabled,
        vaultExpiryReminderDays: Array.isArray(input.nudgeSettings?.vaultExpiryReminderDays) ? input.nudgeSettings.vaultExpiryReminderDays.map(Number).filter((item) => item > 0) : current.vaultExpiryReminderDays,
        returnReminderDays: Array.isArray(input.nudgeSettings?.returnReminderDays) ? input.nudgeSettings.returnReminderDays.map(Number).filter((item) => item > 0) : current.returnReminderDays,
        dailyJournalReminderEnabled: input.nudgeSettings?.dailyJournalReminderEnabled ?? current.dailyJournalReminderEnabled,
        backupReminderAfterDays: Math.max(1, Number(input.nudgeSettings?.backupReminderAfterDays ?? current.backupReminderAfterDays))
      });
      refreshNudges(source, true);
      logNudgeEvent(action.id, "nudge_settings_updated", "success", source, "Updated DexNest nudge settings.", { enabled: next.enabled, backupReminderAfterDays: next.backupReminderAfterDays }, startedAt);
      return { ok: true, actionId: action.id, nudgeSettings: next, calendarState: calendarState() };
    }

    if (action.id === "calendar.create_event" || action.id === "calendar.update_event") {
      const events = loadCalendarEvents();
      const existing = input.id ? events.find((event) => event.id === input.id) : null;
      const nextEvent = normalizeCalendarInput(input, existing ?? undefined);
      const duplicateJournalEvent = action.id === "calendar.create_event" && nextEvent.sourceModule === "journal"
        ? events.find((event) =>
            event.sourceModule === "journal"
            && event.sourceId === nextEvent.sourceId
            && event.date === nextEvent.date
            && event.title.trim().toLowerCase() === nextEvent.title.trim().toLowerCase()
          )
        : null;

      if (duplicateJournalEvent) {
        logCalendarEvent(
          action.id,
          "skipped",
          source,
          "Skipped duplicate Journal-derived Calendar event.",
          {
            eventId: duplicateJournalEvent.id,
            date: duplicateJournalEvent.date,
            sourceModule: duplicateJournalEvent.sourceModule,
            sourceId: duplicateJournalEvent.sourceId
          },
          startedAt
        );
        return {
          ok: false,
          actionId: action.id,
          duplicate: true,
          event: duplicateJournalEvent,
          error: "This Journal event is already on the Calendar."
        };
      }

      saveCalendarEvents([nextEvent, ...events.filter((event) => event.id !== nextEvent.id)]);
      logCalendarEvent(
        action.id,
        "success",
        source,
        `${existing ? "Updated" : "Created"} DexNest Calendar event.`,
        {
          eventId: nextEvent.id,
          date: nextEvent.date,
          allDay: nextEvent.allDay,
          sourceModule: nextEvent.sourceModule,
          sourceId: nextEvent.sourceId,
          reminderLevel: nextEvent.reminderLevel,
          recurrence: nextEvent.recurrence
        },
        startedAt
      );
      return { ok: true, actionId: action.id, event: nextEvent, calendarState: calendarState() };
    }

    if (action.id === "calendar.delete_event") {
      const eventId = input.eventId ?? input.id ?? "";
      const events = loadCalendarEvents();
      const existing = events.find((event) => event.id === eventId);
      saveCalendarEvents(events.filter((event) => event.id !== eventId));
      logCalendarEvent(action.id, "success", source, "Deleted DexNest Calendar event.", { eventId, date: existing?.date ?? null }, startedAt);
      return { ok: true, actionId: action.id, calendarState: calendarState() };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest Calendar action failed.";
    logCalendarEvent(action.id, "failed", source, message, payloadMetadata(payload), startedAt, message);
    return { ok: false, actionId: action.id, error: message };
  }

  return null;
}

function normalizeFinderItem(input: FinderItemInput, existing?: FinderItem): FinderItem {
  const now = new Date().toISOString();
  return {
    id: input.id ?? existing?.id ?? createId("finder-item"),
    itemName: input.itemName?.trim() || existing?.itemName || "Untitled item",
    location: input.location?.trim() || existing?.location || "Unknown location",
    room: input.room?.trim() || existing?.room || "",
    container: input.container?.trim() || existing?.container || "",
    notes: input.notes ?? existing?.notes ?? "",
    tags: parseTagList(input.tags ?? existing?.tags),
    status: input.status ?? existing?.status ?? "at_home",
    lentTo: input.lentTo ?? existing?.lentTo ?? null,
    photoPath: input.photoPath ?? existing?.photoPath ?? null,
    confidence: input.confidence ?? existing?.confidence ?? "sure",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function runFinderAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as FinderItemInput & { statusFilter?: string; newLocation?: string; updateExisting?: boolean }) : {};

  try {
    if (action.id === "finder.open") {
      logFinderEvent(action.id, "success", source, "Opened DexNest Finder.", {}, startedAt);
      return { ok: true, actionId: action.id, finderState: finderState() };
    }

    if (action.id === "finder.create_item" || action.id === "finder.update_item") {
      const items = loadFinderItems();
      const itemName = input.itemName?.trim().toLowerCase();
      const existing = input.id
        ? items.find((item) => item.id === input.id)
        : input.updateExisting && itemName
          ? items.find((item) => item.itemName.trim().toLowerCase() === itemName && item.status !== "archived")
          : undefined;
      const nextItem = normalizeFinderItem(input, existing);
      saveFinderItems([nextItem, ...items.filter((item) => item.id !== nextItem.id)]);
      logFinderEvent(action.id, "success", source, `${existing ? "Updated" : "Created"} DexNest Finder item.`, {
        itemId: nextItem.id,
        status: nextItem.status
      }, startedAt);
      return { ok: true, actionId: action.id, item: nextItem, finderState: finderState() };
    }

    if (action.id === "finder.delete_item") {
      const itemId = input.itemId ?? input.id ?? "";
      const items = loadFinderItems();
      const existing = items.find((item) => item.id === itemId);
      saveFinderItems(items.filter((item) => item.id !== itemId));
      logFinderEvent(action.id, "success", source, "Deleted DexNest Finder item.", {
        itemId,
        status: existing?.status ?? null
      }, startedAt);
      return { ok: true, actionId: action.id, finderState: finderState() };
    }

    if (["finder.archive_item", "finder.mark_moved", "finder.mark_lent_out", "finder.mark_returned"].includes(action.id)) {
      const itemId = input.itemId ?? input.id ?? "";
      const items = loadFinderItems();
      const existing = items.find((item) => item.id === itemId);
      if (!existing) {
        throw new Error("Finder item not found.");
      }

      const patch: FinderItemInput = { id: itemId };
      if (action.id === "finder.archive_item") {
        patch.status = "archived";
      }
      if (action.id === "finder.mark_moved") {
        patch.location = input.newLocation ?? input.location ?? existing.location;
        patch.room = input.room ?? existing.room;
        patch.container = input.container ?? existing.container;
        patch.status = "at_home";
        patch.lentTo = null;
      }
      if (action.id === "finder.mark_lent_out") {
        patch.status = "lent_out";
        patch.lentTo = input.lentTo ?? existing.lentTo ?? "";
      }
      if (action.id === "finder.mark_returned") {
        patch.status = "at_home";
        patch.lentTo = null;
      }

      const nextItem = normalizeFinderItem({ ...existing, ...patch }, existing);
      saveFinderItems([nextItem, ...items.filter((item) => item.id !== itemId)]);
      logFinderEvent(action.id, "success", source, "Updated DexNest Finder item status/location.", {
        itemId,
        status: nextItem.status
      }, startedAt);
      return { ok: true, actionId: action.id, item: nextItem, finderState: finderState() };
    }

    if (action.id === "finder.search_items") {
      const query = input.query ?? "";
      const statusFilter = input.statusFilter ?? input.status ?? "all";
      const results = loadFinderItems().filter((item) => finderItemMatches(item, query, statusFilter));
      logFinderEvent(action.id, "success", source, `Searched DexNest Finder with ${results.length} result${results.length === 1 ? "" : "s"}.`, {
        queryLength: query.length,
        statusFilter,
        resultCount: results.length
      }, startedAt);
      return { ok: true, actionId: action.id, results, finderState: finderState() };
    }

    if (action.id === "finder.reverse_lookup") {
      const query = input.query ?? "";
      const results = loadFinderItems().filter((item) => reverseLookupMatches(item, query));
      logFinderEvent(action.id, "success", source, `Ran DexNest Finder reverse lookup with ${results.length} result${results.length === 1 ? "" : "s"}.`, {
        queryLength: query.length,
        resultCount: results.length
      }, startedAt);
      return { ok: true, actionId: action.id, results, finderState: finderState() };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest Finder action failed.";
    logFinderEvent(action.id, "failed", source, message, payloadMetadata(payload), startedAt, message);
    return { ok: false, actionId: action.id, error: message };
  }

  return null;
}

function findFinanceTransaction(transactionId: string): FinanceTransaction {
  const transaction = loadFinanceTransactions().find((item) => item.id === transactionId);
  if (!transaction) {
    throw new Error("Finance transaction not found.");
  }
  return transaction;
}

function runFinanceAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as FinanceTransactionInput & FinanceRecurringInput & { active?: boolean }) : {};

  try {
    if (action.id === "finance.open" || action.id === "finance.show_monthly_summary") {
      logFinanceEvent(action.id, "success", source, "Opened DexNest Finance.", {}, startedAt);
      return { ok: true, actionId: action.id, financeState: financeState() };
    }

    if (action.id.startsWith("finance.profile.")) {
      const file = loadFinanceProfilesFile();
      const now = new Date().toISOString();
      const profileId = String((input as { profileId?: string }).profileId ?? "");
      const nameInput = String((input as { name?: string }).name ?? "").trim();
      const findProfile = (id: string) => file.profiles.find((p) => p.id === id);

      if (action.id === "finance.profile.create") {
        if (!nameInput) { throw new Error("Profile name is required."); }
        const base = slugifyProjectId(nameInput) || "profile";
        let id = base;
        let suffix = 2;
        while (file.profiles.some((p) => p.id === id)) { id = `${base}-${suffix}`; suffix += 1; }
        const profile: FinanceProfile = { id, name: nameInput, status: "active", isDefault: false, createdAt: now, updatedAt: now };
        const next = saveFinanceProfilesFile({ profiles: [...file.profiles, profile], activeProfileId: id });
        logFinanceEvent(action.id, "success", source, "Created DexNest Finance profile.", { profileId: id, activeProfileId: next.activeProfileId }, startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }

      const profile = findProfile(profileId);
      if (!profile) { throw new Error("Finance profile not found."); }

      if (action.id === "finance.profile.rename") {
        if (!nameInput) { throw new Error("Profile name is required."); }
        saveFinanceProfilesFile({ ...file, profiles: file.profiles.map((p) => (p.id === profileId ? { ...p, name: nameInput, updatedAt: now } : p)) });
        logFinanceEvent(action.id, "success", source, "Renamed DexNest Finance profile.", { profileId }, startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }

      if (action.id === "finance.profile.archive") {
        const activeProfiles = file.profiles.filter((p) => p.status === "active");
        if (activeProfiles.length <= 1) { throw new Error("Cannot archive the last active profile."); }
        let profiles = file.profiles.map((p) => (p.id === profileId ? { ...p, status: "archived" as const, isDefault: false, updatedAt: now } : p));
        // Reassign default and active away from the archived profile.
        if (!profiles.some((p) => p.isDefault && p.status === "active")) {
          const nextDefault = profiles.find((p) => p.status === "active");
          if (nextDefault) { profiles = profiles.map((p) => ({ ...p, isDefault: p.id === nextDefault.id })); }
        }
        let activeProfileId = file.activeProfileId;
        if (activeProfileId === profileId) { activeProfileId = (profiles.find((p) => p.isDefault) ?? profiles.find((p) => p.status === "active"))!.id; }
        saveFinanceProfilesFile({ profiles, activeProfileId });
        logFinanceEvent(action.id, "success", source, "Archived DexNest Finance profile (data kept).", { profileId, activeProfileId }, startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }

      if (action.id === "finance.profile.restore") {
        saveFinanceProfilesFile({ ...file, profiles: file.profiles.map((p) => (p.id === profileId ? { ...p, status: "active" as const, updatedAt: now } : p)) });
        logFinanceEvent(action.id, "success", source, "Restored DexNest Finance profile.", { profileId }, startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }

      if (action.id === "finance.profile.set_default") {
        if (profile.status !== "active") { throw new Error("Only an active profile can be the default."); }
        saveFinanceProfilesFile({ ...file, profiles: file.profiles.map((p) => ({ ...p, isDefault: p.id === profileId, updatedAt: p.id === profileId ? now : p.updatedAt })) });
        logFinanceEvent(action.id, "success", source, "Set default DexNest Finance profile.", { profileId }, startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }

      if (action.id === "finance.profile.switch") {
        if (profile.status !== "active") { throw new Error("Cannot switch to an archived profile."); }
        saveFinanceProfilesFile({ ...file, activeProfileId: profileId });
        logFinanceEvent(action.id, "success", source, "Switched active DexNest Finance profile.", { profileId }, startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }
    }

    if (action.id === "finance.create_transaction" || action.id === "finance.update_transaction" || action.id === "finance.attach_receipt") {
      const transactions = loadFinanceTransactions();
      const existingId = input.transactionId ?? input.id;
      const existing = existingId ? transactions.find((transaction) => transaction.id === existingId) : undefined;
      const nextTransaction = normalizeFinanceTransaction({ ...existing, ...input, id: existing?.id ?? input.id }, existing);
      saveFinanceTransactions([nextTransaction, ...transactions.filter((transaction) => transaction.id !== nextTransaction.id)]);
      logFinanceEvent(action.id, "success", source, `${existing ? "Updated" : "Created"} DexNest Finance transaction.`, financeTransactionMetadata(nextTransaction), startedAt);
      return { ok: true, actionId: action.id, transaction: nextTransaction, financeState: financeState() };
    }

    if (action.id === "finance.delete_transaction") {
      const transactionId = String(input.transactionId ?? input.id ?? "");
      const transactions = loadFinanceTransactions();
      const existing = transactions.find((transaction) => transaction.id === transactionId);
      saveFinanceTransactions(transactions.filter((transaction) => transaction.id !== transactionId));
      logFinanceEvent(action.id, "success", source, "Deleted DexNest Finance transaction metadata.", existing ? financeTransactionMetadata(existing) : { transactionId }, startedAt);
      return { ok: true, actionId: action.id, financeState: financeState() };
    }

    if (action.id === "finance.send_receipt_to_drop" || action.id === "finance.save_receipt_to_vault") {
      const transaction = findFinanceTransaction(String(input.transactionId ?? input.id ?? ""));
      if (!transaction.receiptFilePath || !existsSync(transaction.receiptFilePath)) {
        throw new Error("This transaction has no receipt file.");
      }

      if (action.id === "finance.send_receipt_to_drop") {
        const item = createDropFileItem(transaction.receiptFilePath, "desktop", "outgoing");
        saveDropShelf([item, ...loadDropShelf()]);
        broadcastDropUpdate("Finance receipt added to Drop.", "drop.outgoing_file_added");
        logFinanceEvent(action.id, "success", source, "Sent Finance receipt to DexNest Drop.", financeTransactionMetadata(transaction), startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }

      const imported = importVaultDocuments({
        paths: [transaction.receiptFilePath],
        category: "Receipts",
        tags: [...transaction.tags, "finance", "receipt", `finance-profile:${transaction.profileId}`],
        notes: "",
        sourceModule: "DexNest Finance",
        title: `${transaction.store} receipt`
      }, source, action.id);
      logFinanceEvent(action.id, imported.ok ? "success" : "failed", source, imported.ok ? "Saved Finance receipt to DexNest Vault." : imported.error ?? "Save receipt to Vault failed.", financeTransactionMetadata(transaction), startedAt, imported.ok ? null : imported.error ?? null);
      return imported.ok ? { ...imported, financeState: financeState() } : imported;
    }

    if (action.id === "finance.create_recurring" || action.id === "finance.update_recurring") {
      const recurringItems = loadFinanceRecurring();
      const existingId = input.recurringId ?? input.id;
      const existing = existingId ? recurringItems.find((item) => item.id === existingId) : undefined;
      const nextRecurring = normalizeFinanceRecurring({ ...existing, ...input, id: existing?.id ?? input.id }, existing);
      saveFinanceRecurring([nextRecurring, ...recurringItems.filter((item) => item.id !== nextRecurring.id)]);
      logFinanceEvent(action.id, "success", source, `${existing ? "Updated" : "Created"} DexNest recurring expense.`, {
        recurringId: nextRecurring.id,
        category: nextRecurring.category,
        paymentType: nextRecurring.paymentType,
        amount: nextRecurring.amount,
        active: nextRecurring.active
      }, startedAt);
      return { ok: true, actionId: action.id, recurring: nextRecurring, financeState: financeState() };
    }

    if (action.id === "finance.delete_recurring" || action.id === "finance.toggle_recurring") {
      const recurringId = String(input.recurringId ?? input.id ?? "");
      const recurringItems = loadFinanceRecurring();
      const existing = recurringItems.find((item) => item.id === recurringId);
      if (!existing) {
        throw new Error("Recurring expense not found.");
      }

      if (action.id === "finance.delete_recurring") {
        saveFinanceRecurring(recurringItems.filter((item) => item.id !== recurringId));
        logFinanceEvent(action.id, "success", source, "Deleted DexNest recurring expense.", {
          recurringId,
          category: existing.category,
          paymentType: existing.paymentType,
          amount: existing.amount
        }, startedAt);
        return { ok: true, actionId: action.id, financeState: financeState() };
      }

      const nextRecurring = { ...existing, active: input.active ?? !existing.active, updatedAt: new Date().toISOString() };
      saveFinanceRecurring([nextRecurring, ...recurringItems.filter((item) => item.id !== recurringId)]);
      logFinanceEvent(action.id, "success", source, "Toggled DexNest recurring expense.", {
        recurringId,
        active: nextRecurring.active,
        category: nextRecurring.category,
        paymentType: nextRecurring.paymentType,
        amount: nextRecurring.amount
      }, startedAt);
      return { ok: true, actionId: action.id, recurring: nextRecurring, financeState: financeState() };
    }

    if (action.id === "finance.create_return_reminder" || action.id === "finance.create_warranty_reminder") {
      const transaction = findFinanceTransaction(String(input.transactionId ?? input.id ?? ""));
      const date = action.id === "finance.create_return_reminder" ? transaction.returnDeadline : transaction.warrantyUntil;
      if (!date) {
        throw new Error(action.id === "finance.create_return_reminder" ? "No return deadline set." : "No warranty date set.");
      }
      const event = normalizeCalendarInput({
        title: action.id === "finance.create_return_reminder" ? `Return deadline: ${transaction.store}` : `Warranty reminder: ${transaction.store}`,
        date,
        allDay: true,
        sourceModule: "finance",
        sourceId: transaction.id,
        reminderLevel: "normal",
        notes: `DexNest Finance ${action.id === "finance.create_return_reminder" ? "return" : "warranty"} reminder.`
      });
      saveCalendarEvents([event, ...loadCalendarEvents()]);
      logFinanceEvent(action.id, "success", source, "Created DexNest Calendar reminder from Finance.", {
        ...financeTransactionMetadata(transaction),
        eventId: event.id,
        date
      }, startedAt);
      return { ok: true, actionId: action.id, event, financeState: financeState(), calendarState: calendarState() };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest Finance action failed.";
    logFinanceEvent(action.id, "failed", source, message, payloadMetadata(payload), startedAt, message);
    return { ok: false, actionId: action.id, error: message };
  }

  return null;
}

function findCaptureItem(captureId: string): CaptureItem {
  const item = loadCaptureItems().find((entry) => entry.id === captureId);
  if (!item) {
    throw new Error("Capture item not found.");
  }
  return item;
}

function saveRoutedCaptureItem(item: CaptureItem, routedTo: string): CaptureItem {
  const updated = { ...item, status: "routed" as CaptureItemStatus, routedTo, updatedAt: new Date().toISOString() };
  saveCaptureItems([updated, ...loadCaptureItems().filter((entry) => entry.id !== item.id)]);
  return updated;
}

function runCaptureAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as CaptureItemInput & { location?: string; amount?: string | number; date?: string }) : {};

  try {
    if (action.id === "capture.open") {
      logCaptureEvent(action.id, "success", source, "Opened DexNest Capture.", {}, startedAt);
      return { ok: true, actionId: action.id, captureState: captureState() };
    }

    if (action.id === "capture.create_note" || action.id === "capture.create_from_file") {
      const item = normalizeCaptureItem(input);
      saveCaptureItems([item, ...loadCaptureItems()]);
      logCaptureEvent(action.id, "success", source, "Created DexNest Capture item.", captureMetadata(item), startedAt);
      return { ok: true, actionId: action.id, item, captureState: captureState() };
    }

    if (action.id === "capture.create_from_clipboard") {
      const text = clipboard.readText();
      const item = normalizeCaptureItem({ ...input, type: input.type ?? "note", title: input.title ?? "Clipboard capture", text, source: "clipboard" });
      saveCaptureItems([item, ...loadCaptureItems()]);
      logCaptureEvent(action.id, "success", source, "Created DexNest Capture item from clipboard.", { ...captureMetadata(item), byteLength: byteLength(text) }, startedAt);
      return { ok: true, actionId: action.id, item, captureState: captureState() };
    }

    if (action.id === "capture.archive_item" || action.id === "capture.delete_item") {
      const item = findCaptureItem(String(input.captureId ?? input.id ?? ""));
      const status: CaptureItemStatus = action.id === "capture.archive_item" ? "archived" : "deleted";
      const updated = { ...item, status, updatedAt: new Date().toISOString() };
      saveCaptureItems([updated, ...loadCaptureItems().filter((entry) => entry.id !== item.id)]);
      logCaptureEvent(action.id, "success", source, action.id === "capture.archive_item" ? "Archived DexNest Capture item." : "Deleted DexNest Capture item.", captureMetadata(updated), startedAt);
      return { ok: true, actionId: action.id, item: updated, captureState: captureState() };
    }

    if (action.id.startsWith("capture.route_to_")) {
      const item = findCaptureItem(String(input.captureId ?? input.id ?? ""));
      const route = action.id.replace("capture.route_to_", "");
      if (route === "journal") {
        const journal = normalizeJournalCapture(item);
        saveJournalEntries([journal, ...loadJournalEntries().filter((entry) => entry.id !== journal.id)]);
      }
      if (route === "calendar") {
        const event = normalizeCalendarInput({ title: item.title, date: input.date || todayDateString(), allDay: true, sourceModule: "capture", sourceId: item.id, reminderLevel: "normal", notes: "From DexNest Capture." });
        saveCalendarEvents([event, ...loadCalendarEvents()]);
      }
      if (route === "vault") {
        if (!item.filePath) {
          throw new Error("Vault routing needs an attached file for this MVP.");
        }
        const imported = importVaultDocuments({ paths: [item.filePath], category: "Other", tags: [...item.tags, "capture"], notes: "", sourceModule: "DexNest Capture", title: item.title }, source, action.id);
        if (!imported.ok) {
          throw new Error(imported.error ?? "Vault import failed.");
        }
      }
      if (route === "finance") {
        const amountMatch = item.text.match(/(?:\$|CAD\s*)?(\d+(?:\.\d{1,2})?)/i);
        const transaction = normalizeFinanceTransaction({ date: input.date || todayDateString(), store: item.title, amount: input.amount ?? amountMatch?.[1] ?? 0, category: "Capture", paymentType: "other", notes: item.text, tags: item.tags, receiptPath: item.filePath ?? null });
        saveFinanceTransactions([transaction, ...loadFinanceTransactions()]);
      }
      if (route === "finder") {
        const itemName = input.title || item.title;
        const location = typeof input.location === "string" && input.location.trim() ? input.location.trim() : windowlessLocationFromText(item.text);
        const finderItem = normalizeFinderItem({ itemName, location, notes: item.text, tags: item.tags, status: "at_home" });
        saveFinderItems([finderItem, ...loadFinderItems()]);
      }
      if (route === "drop") {
        if (item.filePath) {
          saveDropShelf([createDropFileItem(item.filePath, "desktop", "outgoing"), ...loadDropShelf()]);
        } else {
          const dropItem = createDropTextItem(item.text || item.title, "manual", "outgoing");
          saveDropShelf([dropItem, ...loadDropShelf()]);
        }
        broadcastDropUpdate("Capture item added to Drop.", "drop.capture_added");
      }

      const updated = saveRoutedCaptureItem(item, route);
      logCaptureEvent(action.id, "success", source, `Routed DexNest Capture item to ${route}.`, captureMetadata(updated), startedAt);
      return { ok: true, actionId: action.id, item: updated, captureState: captureState() };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest Capture action failed.";
    logCaptureEvent(action.id, "failed", source, message, payloadMetadata(payload), startedAt, message);
    return { ok: false, actionId: action.id, error: message };
  }

  return null;
}

function normalizeJournalCapture(item: CaptureItem): JournalEntry {
  const now = new Date().toISOString();
  const rawText = [item.title, item.text, item.url ?? ""].filter(Boolean).join("\n\n");
  return {
    id: createId("journal-entry"),
    date: todayDateString(),
    title: item.title,
    rawText,
    cleanedText: cleanJournalText(rawText),
    mood: "",
    productivity: "",
    tags: item.tags,
    peopleTags: [],
    createdAt: now,
    updatedAt: now,
    extractedItems: extractCalendarCandidatesFromText(rawText, todayDateString())
  };
}

function windowlessLocationFromText(text: string): string {
  const match = text.match(/\b(?:in|at|inside)\s+(.{2,80})/i);
  return match?.[1]?.trim() || "Unknown location";
}

function normalizeRoutine(input: RoutineInput, existing?: DexNestRoutine): DexNestRoutine {
  const now = new Date().toISOString();
  const steps = (input.steps ?? existing?.steps ?? [])
    .map((step) => ({
      id: step.id ?? createId("routine-step"),
      actionId: String(step.actionId ?? "").trim(),
      params: step.params ?? {}
    }))
    .filter((step) => Boolean(step.actionId));
  return {
    id: input.id ?? existing?.id ?? createId("routine"),
    name: input.name?.trim() || existing?.name || "Untitled routine",
    description: input.description ?? existing?.description ?? "",
    steps,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt ?? null,
    lastRunStatus: existing?.lastRunStatus ?? null,
    lastRunSummary: existing?.lastRunSummary ?? null
  };
}

// Generate ready-to-use Stream Deck PowerShell scripts that call the local
// DexNest action endpoint. No secrets / API keys / local-data are written.
function exportStreamDeckButtonPack(source: DexNestActionTrigger): { ok: boolean; actionId: string; folder: string; scripts: number; shortcuts: number; placeholders: number; categories: number; message: string } {
  const folder = resolve(repoRoot, "streamdeck-actions");
  const scriptsRoot = join(folder, "scripts");
  const shortcutsRoot = join(folder, "shortcuts");
  const endpointBase = `http://127.0.0.1:${actionPort}/actions`;
  const healthUrl = `http://127.0.0.1:${actionPort}/health`;

  type Button = { category: string; file: string; title: string; actionId?: string; body?: string; note?: string; placeholder?: boolean };
  const buttons: Button[] = [
    // Part A — Core
    { category: "Core", file: "open-command", title: "Open Command", actionId: "command.open_home", body: "{}" },
    { category: "Core", file: "open-search", title: "Open Search", actionId: "search.open", body: "{}" },
    { category: "Core", file: "start-mic", title: "Start Mic / Ask DexNest", actionId: "assistant.start_listening", body: "{}", note: "Starts listening in the background (works minimized/tray); shows the desktop voice overlay and does not force-open the app." },
    { category: "Core", file: "toggle-performance-mode", title: "Toggle Performance Mode", actionId: "system.performance.toggle", body: "{}" },
    { category: "Core", file: "lock-sensitive-session", title: "Lock Sensitive Session", actionId: "system.lifecycle.lock_sensitive_session", body: "{}" },
    { category: "Core", file: "open-app-health", title: "Open App Health", actionId: "system.health.open", body: "{}" },
    // Part B — Clipboard slots
    { category: "Clipboard", file: "save-slot-1", title: "Save Clipboard to Slot 1", actionId: "clipboard.slot1.save_current", body: "{}" },
    { category: "Clipboard", file: "paste-slot-1", title: "Paste Slot 1", actionId: "clipboard.slot1.paste", body: "{}" },
    { category: "Clipboard", file: "save-slot-2", title: "Save Clipboard to Slot 2", actionId: "clipboard.slot2.save_current", body: "{}" },
    { category: "Clipboard", file: "paste-slot-2", title: "Paste Slot 2", actionId: "clipboard.slot2.paste", body: "{}" },
    { category: "Clipboard", file: "save-slot-3", title: "Save Clipboard to Slot 3", actionId: "clipboard.slot3.save_current", body: "{}" },
    { category: "Clipboard", file: "paste-slot-3", title: "Paste Slot 3", actionId: "clipboard.slot3.paste", body: "{}" },
    { category: "Clipboard", file: "open-clipboard", title: "Open Clipboard", actionId: "clipboard.open", body: "{}" },
    // Part C — Multi-copy
    { category: "Clipboard", file: "multicopy-add", title: "Multi-copy: Add Current", actionId: "clipboard.multi_copy_add_current", body: "{}", note: "Adds the current clipboard to the active multi-copy session (secrets are skipped)." },
    { category: "Clipboard", file: "multicopy-paste-group", title: "Multi-copy: Paste Group", actionId: "clipboard.paste_multi_copy_group", body: "{}" },
    { category: "Clipboard", file: "multicopy-clear", title: "Multi-copy: Clear Session", actionId: "clipboard.clear_multi_copy_session", body: "{\"confirmedDangerous\":true}" },
    // Part D — Drop
    { category: "Drop", file: "open-drop", title: "Open Drop", actionId: "drop.open", body: "{}" },
    { category: "Drop", file: "send-clipboard-to-phone", title: "Send Clipboard to Phone", actionId: "drop.send_clipboard_to_drop", body: "{}" },
    { category: "Drop", file: "copy-latest-phone-text", title: "Copy Latest Phone Text", actionId: "drop.copy_latest_phone_text", body: "{}" },
    { category: "Drop", file: "open-incoming-folder", title: "Open Incoming Folder", actionId: "drop.open_incoming_folder", body: "{}" },
    // Part E — Journal / Calendar / Finance / Backup
    { category: "Journal", file: "start-todays-journal", title: "Start Today's Journal", actionId: "journal.start_today_voice", body: "{}", note: "Starts the journal voice workflow; falls back to opening today's entry if speech is unavailable." },
    { category: "Journal", file: "save-journal", title: "Save Journal", actionId: "journal.save_voice", body: "{}" },
    { category: "Journal", file: "open-journal", title: "Open Journal", actionId: "journal.open_today", body: "{}" },
    { category: "Calendar", file: "open-today-calendar", title: "Open Today's Calendar", actionId: "calendar.show_today", body: "{}" },
    { category: "Calendar", file: "show-upcoming-events", title: "Show Upcoming Events", actionId: "calendar.show_upcoming", body: "{}" },
    { category: "Finance", file: "open-finance", title: "Open Finance", actionId: "finance.open", body: "{}" },
    { category: "Backup", file: "backup-now", title: "Backup Now", actionId: "backup.create", body: "{}" },
    { category: "Backup", file: "open-backup-folder", title: "Open Backup Folder", actionId: "backup.open_folder", body: "{}" }
  ];

  // Part F — Dev: per configured project, Start + Stop (Dev Launch Profiles are
  // not present in this build, so use the existing project start/stop actions).
  const projects = loadProjects();
  for (const project of projects) {
    const hasStart = Boolean(project.commands?.start?.trim());
    buttons.push(hasStart
      ? { category: "Dev", file: `start-${project.id}`, title: `Start ${project.name}`, actionId: `dev.project.${project.id}.run_start`, body: "{}" }
      : { category: "Dev", file: `start-${project.id}`, title: `Start ${project.name}`, placeholder: true, note: `No start command configured for ${project.name}. Set one in DexNest Dev, then re-export.` });
    buttons.push({ category: "Dev", file: `stop-${project.id}`, title: `Stop ${project.name}`, actionId: `dev.project.${project.id}.stop`, body: "{\"confirmedDangerous\":true}", note: "Stops the project (stop command / Docker / configured ports)." });
  }
  if (projects.length === 0) {
    buttons.push({ category: "Dev", file: "no-projects", title: "No Dev projects configured", placeholder: true, note: "Add a Dev project in DexNest, then re-export to get Start/Stop buttons." });
  }

  const scriptFor = (button: Button): string => {
    const lines: string[] = [
      `# DexNest Stream Deck: ${button.title}${button.placeholder ? " (PLACEHOLDER)" : ""}`,
      "# Calls the local DexNest action endpoint. No secrets or API keys are stored here.",
      "# DexNest must be running (window or tray). Endpoint is local-only (127.0.0.1)."
    ];
    if (button.note) { lines.push(`# ${button.note}`); }
    if (button.placeholder || !button.actionId) {
      lines.push(`Write-Host 'DexNest: ${button.title.replace(/'/g, "''")} is not configured yet. Configure it in DexNest, then re-export.'`);
      return lines.join("\r\n") + "\r\n";
    }
    lines.push("$ErrorActionPreference = 'SilentlyContinue'");
    lines.push(`$uri = '${endpointBase}/${button.actionId}'`);
    lines.push(`$body = '${button.body ?? "{}"}'`);
    lines.push("Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $body | Out-Null");
    return lines.join("\r\n") + "\r\n";
  };

  const categories = [...new Set(buttons.map((button) => button.category))];

  // Write .ps1 scripts under scripts/<Category>/
  for (const category of categories) { mkdirSync(join(scriptsRoot, category), { recursive: true }); }
  for (const button of buttons) {
    writeFileSync(join(scriptsRoot, button.category, `${button.file}.ps1`), scriptFor(button), "utf8");
  }

  // Generate Windows .lnk shortcuts under shortcuts/<Category>/ (never the Desktop)
  // so Stream Deck System → Open can select them directly. .lnk files can't be
  // authored from Node, so use WScript.Shell via PowerShell. Best-effort.
  let shortcutsCreated = 0;
  if (process.platform === "win32") {
    try {
      for (const category of categories) { mkdirSync(join(shortcutsRoot, category), { recursive: true }); }
      const psEscape = (value: string) => value.replace(/'/g, "''");
      const items = buttons.map((button) =>
        `  @{ lnk='${psEscape(join(shortcutsRoot, button.category, `${button.file}.lnk`))}'; script='${psEscape(join(scriptsRoot, button.category, `${button.file}.ps1`))}'; desc='${psEscape(`DexNest: ${button.title}`)}' }`
      ).join(",\r\n");
      const psScript = [
        "$ErrorActionPreference = 'Stop'",
        "$ws = New-Object -ComObject WScript.Shell",
        "$psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source",
        "if (-not $psExe) { $psExe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe' }",
        `$work = '${psEscape(folder)}'`,
        "$items = @(",
        items,
        ")",
        "foreach ($it in $items) {",
        "  $sc = $ws.CreateShortcut($it.lnk)",
        "  $sc.TargetPath = $psExe",
        "  $sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $it.script + '\"'",
        "  $sc.WorkingDirectory = $work",
        "  $sc.WindowStyle = 7",
        "  $sc.Description = $it.desc",
        "  $sc.Save()",
        "}",
        "Write-Output 'OK'"
      ].join("\r\n");
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, timeout: 30000 });
      shortcutsCreated = buttons.length;
    } catch {
      shortcutsCreated = 0;
    }
  }

  const buttonsByCategory = categories.flatMap((category) => [
    `### ${category}`,
    "",
    ...buttons.filter((button) => button.category === category).map((button) =>
      `- **${button.title}** — \`scripts/${button.category}/${button.file}.ps1\` · \`shortcuts/${button.category}/${button.file}.lnk\`${button.placeholder ? " _(placeholder — configure in DexNest, then re-export)_" : ""}`
    ),
    ""
  ]);

  const readme = [
    "# DexNest Stream Deck Control Pack",
    "",
    `Ready-to-use actions that trigger DexNest through its local action endpoint (\`${endpointBase}/<action>\`).`,
    "Two forms are exported for every action:",
    "- `scripts/<Category>/*.ps1` — the PowerShell scripts.",
    "- `shortcuts/<Category>/*.lnk` — Windows shortcuts that run the matching script.",
    "",
    "## Use in Stream Deck",
    "",
    "**System → Open → choose the `.lnk` file** in the `shortcuts/<Category>/` folder.",
    "Stream Deck's Open action can select a shortcut directly (no Arguments field needed).",
    "Each `.lnk` targets `powershell.exe` with `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"<script>\"` and runs hidden.",
    "",
    "Example shortcut path:",
    "```",
    `${join(shortcutsRoot, "Core", "open-command.lnk")}`,
    "```",
    "",
    "## Requirements",
    "",
    "- **DexNest must be running** (window open or minimized to tray).",
    "- Stream Deck control must be allowed in DexNest Settings (it is on by default).",
    "",
    "## Test the endpoint",
    "",
    "```",
    `Invoke-RestMethod ${healthUrl}`,
    "```",
    "",
    "## Recommended layout",
    "",
    "- **Page 1 — Core:** Open Command · Open Search · Start Mic / Ask DexNest · Toggle Performance Mode · Lock Sensitive Session · Open App Health",
    "- **Page 2 — Clipboard:** Save/Paste Slot 1-3 · Open Clipboard · Multi-copy Add / Paste Group / Clear",
    "- **Page 3 — Drop & Journal:** Open Drop · Send Clipboard to Phone · Copy Latest Phone Text · Incoming Folder · Start/Save/Open Journal",
    "- **Page 4 — Calendar / Finance / Backup / Dev:** Today's Calendar · Upcoming Events · Open Finance · Backup Now · Open Backup Folder · Start/Stop each Dev project",
    "",
    "## Buttons",
    "",
    ...buttonsByCategory,
    "## Notes",
    "",
    "- These scripts and shortcuts contain **no secrets, API keys, or local-data** — only the local action id.",
    "- **Start Mic / Ask DexNest** works while DexNest is minimized; it shows the desktop voice overlay and does not force-open the app.",
    "- **Copy Latest Phone Text** copies the most recent incoming phone text to your Windows clipboard; the text is never logged or returned over HTTP.",
    "- Destructive actions (Clear multi-copy, Stop project) include `confirmedDangerous` in their body, matching DexNest's existing confirmation rules.",
    "- If you enable PIN/token auth or LAN exposure in DexNest Settings, keep these local-only; the scripts intentionally do not embed any token.",
    ""
  ].join("\r\n");
  writeFileSync(join(folder, "README.md"), readme, "utf8");

  const placeholders = buttons.filter((button) => button.placeholder).length;
  localDb.appendActionEvent({
    module: "DexNest Deck",
    actionId: "deck.export_button_pack",
    eventType: "deck_button_pack_exported",
    status: "success",
    source,
    summary: `Exported ${buttons.length} Stream Deck scripts + ${shortcutsCreated} shortcuts across ${categories.length} categories (${placeholders} placeholders).`,
    metadataJson: { folder, scripts: buttons.length, shortcuts: shortcutsCreated, placeholders, categories: categories.length }
  });

  return { ok: true, actionId: "deck.export_button_pack", folder, scripts: buttons.length, shortcuts: shortcutsCreated, placeholders, categories: categories.length, message: `Exported ${buttons.length} scripts + ${shortcutsCreated} shortcuts to ${folder}.` };
}

async function runDeckRoutineAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as RoutineInput & { confirmedDangerous?: boolean }) : {};

  try {
    if (action.id === "deck.routine.create" || action.id === "deck.routine.update") {
      const routines = loadRoutines();
      const existingId = input.routineId ?? input.id;
      const existing = existingId ? routines.find((routine) => routine.id === existingId) : undefined;
      const routine = normalizeRoutine({ ...existing, ...input, id: existing?.id ?? input.id }, existing);
      saveRoutines([routine, ...routines.filter((item) => item.id !== routine.id)]);
      logRoutineEvent(action.id, "routine_saved", "success", source, `${existing ? "Updated" : "Created"} DexNest routine.`, { routineId: routine.id, stepCount: routine.steps.length }, startedAt);
      return { ok: true, actionId: action.id, routine, routinesState: routinesState() };
    }

    if (action.id === "deck.routine.delete") {
      const routineId = String(input.routineId ?? input.id ?? "");
      saveRoutines(loadRoutines().filter((routine) => routine.id !== routineId));
      logRoutineEvent(action.id, "routine_deleted", "success", source, "Deleted DexNest routine.", { routineId }, startedAt);
      return { ok: true, actionId: action.id, routinesState: routinesState() };
    }

    if (action.id === "deck.routine.reorder") {
      const routineId = String(input.routineId ?? input.id ?? "");
      const routines = loadRoutines();
      const existing = routines.find((routine) => routine.id === routineId);
      if (!existing) {
        throw new Error("Routine not found.");
      }
      const routine = normalizeRoutine({ ...existing, steps: input.steps ?? existing.steps }, existing);
      saveRoutines([routine, ...routines.filter((item) => item.id !== routine.id)]);
      logRoutineEvent(action.id, "routine_reordered", "success", source, "Reordered DexNest routine steps.", { routineId, stepCount: routine.steps.length }, startedAt);
      return { ok: true, actionId: action.id, routine, routinesState: routinesState() };
    }

    if (action.id === "deck.routine.run") {
      const routineId = String(input.routineId ?? input.id ?? "");
      const routineName = typeof (input as { routineName?: unknown }).routineName === "string" ? String((input as { routineName?: unknown }).routineName).trim().toLowerCase() : "";
      const routines = loadRoutines();
      // Resolve by id first; voice commands ("run morning routine") pass a name.
      const routine = routines.find((item) => item.id === routineId)
        ?? (routineName ? routines.find((item) => item.name.trim().toLowerCase() === routineName)
          ?? routines.find((item) => item.name.trim().toLowerCase().includes(routineName)) : undefined);
      if (!routine) {
        throw new Error("Routine not found.");
      }
      if (!routine.enabled) {
        throw new Error("Routine is disabled.");
      }
      logRoutineEvent(action.id, "routine_started", "pending", source, "Started DexNest routine.", { routineId, stepCount: routine.steps.length }, startedAt);

      let completed = 0;
      for (const step of routine.steps) {
        const stepAction = findAction(step.actionId);
        if (!stepAction) {
          throw new Error(`Routine step action not found: ${step.actionId}`);
        }
        const stepNeedsConfirmation = stepAction.dangerLevel === "danger" || stepAction.dangerLevel === "critical" || stepAction.requiresConfirmation;
        if (stepNeedsConfirmation && input.confirmedDangerous !== true && step.params?.confirmedDangerous !== true) {
          throw new Error(`Routine step requires confirmation: ${step.actionId}`);
        }
        const result = await runRegisteredAction(step.actionId, "routine", { ...(step.params ?? {}), confirmedDangerous: input.confirmedDangerous === true || step.params?.confirmedDangerous === true });
        const resultError = "error" in result && typeof result.error === "string" ? result.error : "Routine step failed.";
        logRoutineEvent(action.id, result.ok ? "routine_step_success" : "routine_step_failed", result.ok ? "success" : "failed", source, result.ok ? "Routine step completed." : "Routine step failed.", { routineId, stepId: step.id, stepActionId: step.actionId }, startedAt, result.ok ? null : resultError);
        if (!result.ok) {
          throw new Error(resultError || `Routine step failed: ${step.actionId}`);
        }
        completed += 1;
      }

      const updated = { ...routine, lastRunAt: new Date().toISOString(), lastRunStatus: "success", lastRunSummary: `${completed}/${routine.steps.length} steps completed.`, updatedAt: new Date().toISOString() };
      saveRoutines([updated, ...routines.filter((item) => item.id !== routine.id)]);
      logRoutineEvent(action.id, "routine_completed", "success", source, "Completed DexNest routine.", { routineId, completed, stepCount: routine.steps.length }, startedAt);
      return { ok: true, actionId: action.id, routine: updated, routinesState: routinesState() };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest routine action failed.";
    const routineId = String(input.routineId ?? input.id ?? "");
    if (routineId) {
      const routines = loadRoutines();
      const routine = routines.find((item) => item.id === routineId);
      if (routine) {
        saveRoutines([{ ...routine, lastRunAt: new Date().toISOString(), lastRunStatus: "failed", lastRunSummary: message, updatedAt: new Date().toISOString() }, ...routines.filter((item) => item.id !== routineId)]);
      }
    }
    logRoutineEvent(action.id, "routine_failed", "failed", source, message, { routineId: routineId || null }, startedAt, message);
    return { ok: false, actionId: action.id, error: message, routinesState: routinesState() };
  }

  return null;
}

async function runSearchAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const input = typeof payload === "object" && payload !== null ? (payload as SearchQueryInput) : {};

  try {
    if (action.id === "search.open") {
      logSearchEvent(action.id, "search_opened", "success", source, "Opened DexNest Search.", {}, startedAt);
      return { ok: true, actionId: action.id, searchState: searchState() };
    }

    if (action.id === "search.rebuild_index") {
      const records = reindexSearchIndex("manual");
      const ocrTextFileCount = records.filter((record) => record.entityType === "tools_ocr_text").length;
      logSearchEvent(
        action.id,
        "search_index_rebuilt",
        "success",
        source,
        `Rebuilt DexNest Search index with ${records.length} records and ${ocrTextFileCount} OCR text files.`,
        {
          recordCount: records.length,
          ocrTextFileCount,
          sources: [...new Set(records.map((record) => record.sourceModule))]
        },
        startedAt
      );
      return { ok: true, actionId: action.id, index: records, searchState: searchState(input) };
    }

    if (action.id === "search.clear_index") {
      saveSearchIndex([]);
      logSearchEvent(action.id, "search_index_cleared", "success", source, "Cleared DexNest Search index.", {}, startedAt);
      return { ok: true, actionId: action.id, searchState: searchState() };
    }

    if (action.id === "search.run_query") {
      const results = runSearchQuery(input);
      logSearchEvent(
        action.id,
        "search_query_run",
        "success",
        source,
        `Ran DexNest Search query with ${results.length} results.`,
        {
          queryLength: (input.query ?? "").length,
          sourceModule: input.sourceModule ?? "all",
          fileType: input.fileType ?? "all",
          hasDateFrom: Boolean(input.dateFrom),
          hasDateTo: Boolean(input.dateTo),
          resultCount: results.length
        },
        startedAt
      );
      return { ok: true, actionId: action.id, results, resultCount: results.length };
    }

    if (action.id === "search.secure.run") {
      const results = runSecureVaultSearch(input);
      logSearchEvent(
        action.id,
        "secure_search_run",
        "success",
        source,
        `Ran DexNest Secure Vault search with ${results.length} result${results.length === 1 ? "" : "s"}.`,
        {
          resultCount: results.length,
          includeSecretValues: Boolean(input.includeSecretValues)
        },
        startedAt
      );
      return { ok: true, actionId: action.id, secureResults: results, resultCount: results.length };
    }

    if (action.id === "search.smart_lookup") {
      const smartResults = runSmartLookup(input);
      const fieldTypes = [...new Set(smartResults.map((result) => result.fieldType))];
      logSearchEvent(
        action.id,
        "smart_lookup_run",
        "success",
        source,
        `Ran DexNest Smart Lookup with ${smartResults.length} result${smartResults.length === 1 ? "" : "s"}.`,
        {
          // Metadata only: field categories, source types, counts, sensitivity.
          // Never the question text, note contents, or extracted values.
          requestedFieldTypes: requestedSmartFields(String(input.question ?? input.query ?? "")),
          resultFieldTypes: fieldTypes,
          resultCount: smartResults.length,
          sourceModules: [...new Set(smartResults.map((result) => result.sourceModule))],
          sourceTypes: [...new Set(smartResults.map((result) => result.sourceType))],
          sensitivity: smartResults.some((result) => result.sensitive) ? "sensitive" : (smartResults.length ? "personal" : "none"),
          // Metadata only: whether a sensitive answer was auto-revealed, never the value.
          autoReveal: smartResults.some((result) => result.sensitive && result.autoRevealed),
          trustedSession: isTrustedSessionActive(),
          status: smartResults.length ? "found" : "not_found"
        },
        startedAt
      );
      return { ok: true, actionId: action.id, smartResults, resultCount: smartResults.length };
    }

    if (action.id === "search.smart_lookup_reveal") {
      const fieldType = String(input.fieldType ?? "unknown");
      if (sensitiveSmartFields.has(fieldType) && input.confirmedDangerous !== true) {
        throw new Error("Confirm reveal before showing a sensitive Smart Lookup answer.");
      }
      logSearchEvent(action.id, "smart_lookup_revealed", "success", source, "Revealed a Smart Lookup answer.", { fieldType, sensitive: sensitiveSmartFields.has(fieldType) }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "search.smart_lookup_copy_answer") {
      const answerValue = String(input.answerValue ?? "");
      const fieldType = String(input.fieldType ?? "unknown");
      if (!answerValue) {
        throw new Error("No Smart Lookup answer was provided to copy.");
      }
      if (sensitiveSmartFields.has(fieldType) && input.confirmedDangerous !== true) {
        throw new Error("Confirm copy before copying a sensitive Smart Lookup answer.");
      }
      clipboard.writeText(answerValue);
      lastClipboardListenerText = answerValue;
      secureVaultProtectedClipboardValue = answerValue;
      if (secureVaultClipboardTimer) {
        clearTimeout(secureVaultClipboardTimer);
      }
      secureVaultClipboardTimer = setTimeout(() => {
        if (clipboard.readText() === answerValue) {
          clipboard.clear();
        }
        if (secureVaultProtectedClipboardValue === answerValue) {
          secureVaultProtectedClipboardValue = null;
        }
      }, 30000);
      logSearchEvent(action.id, "smart_lookup_answer_copied", "success", source, "Copied a Smart Lookup answer with auto-clear.", { fieldType, sensitive: sensitiveSmartFields.has(fieldType), valueLength: answerValue.length }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "search.smart_lookup_open_source") {
      const sourceId = String(input.sourceId ?? input.resultId ?? "");
      const record = loadSearchIndex().find((item) => item.id === sourceId);
      if (!record?.filePath) {
        throw new Error("Smart Lookup source file was not found in the current index.");
      }
      void shell.openPath(record.filePath);
      logSearchEvent(action.id, "smart_lookup_source_opened", "success", source, "Opened Smart Lookup source document.", { sourceRecordId: record.id, sourceModule: record.sourceModule, entityType: record.entityType }, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (action.id === "search.save_query") {
      const now = new Date().toISOString();
      const savedSearch: SavedSearch = {
        id: createId("saved-search"),
        title: previewText(input.title || input.query || "Saved DexNest Search"),
        query: input.query ?? "",
        sourceModule: input.sourceModule ?? "all",
        fileType: input.fileType ?? "all",
        dateFrom: input.dateFrom ?? "",
        dateTo: input.dateTo ?? "",
        createdAt: now,
        updatedAt: now
      };
      saveSavedSearches([savedSearch, ...loadSavedSearches()]);
      logSearchEvent(
        action.id,
        "search_saved_query_created",
        "success",
        source,
        "Saved DexNest Search query.",
        {
          savedSearchId: savedSearch.id,
          queryLength: savedSearch.query.length,
          sourceModule: savedSearch.sourceModule,
          fileType: savedSearch.fileType
        },
        startedAt
      );
      return { ok: true, actionId: action.id, savedSearch, searchState: searchState(input) };
    }

    if (action.id === "search.delete_saved_query") {
      const savedSearchId = input.savedSearchId ?? "";
      const nextSavedSearches = loadSavedSearches().filter((savedSearch) => savedSearch.id !== savedSearchId);
      saveSavedSearches(nextSavedSearches);
      logSearchEvent(
        action.id,
        "search_saved_query_deleted",
        "success",
        source,
        "Deleted DexNest saved Search query.",
        { savedSearchId },
        startedAt
      );
      return { ok: true, actionId: action.id, searchState: searchState(input) };
    }

    if (action.id === "search.open_result_folder" && input.indexFolder) {
      void shell.openPath(searchIndexRoot);
      logSearchEvent(action.id, "search_index_folder_opened", "success", source, "Opened DexNest Search index folder.", {}, startedAt);
      return { ok: true, actionId: action.id };
    }

    if (["search.open_result", "search.open_result_folder", "search.send_result_to_drop"].includes(action.id)) {
      const result = loadSearchIndex().find((record) => record.id === input.resultId);
      if (!result) {
        throw new Error("Search result was not found in the current index.");
      }
      if (!result.filePath) {
        throw new Error("Search result does not have a local file path.");
      }

      if (action.id === "search.open_result") {
        void shell.openPath(result.filePath);
        logSearchEvent(action.id, "search_result_opened", "success", source, "Opened DexNest Search result.", {
          resultId: result.id,
          sourceModule: result.sourceModule,
          entityType: result.entityType,
          fileType: result.fileType ?? null
        }, startedAt);
        return { ok: true, actionId: action.id };
      }

      if (action.id === "search.open_result_folder") {
        void shell.openPath(dirname(result.filePath));
        logSearchEvent(action.id, "search_result_folder_opened", "success", source, "Opened DexNest Search result folder.", {
          resultId: result.id,
          sourceModule: result.sourceModule,
          entityType: result.entityType,
          fileType: result.fileType ?? null
        }, startedAt);
        return { ok: true, actionId: action.id };
      }

      const item = createDropFileItem(result.filePath, "desktop", "outgoing");
      saveDropShelf([item, ...loadDropShelf()]);
      broadcastDropUpdate("Search result sent to phone.", "drop.outgoing_file_added");
      logSearchEvent(action.id, "search_result_sent_to_drop", "success", source, "Sent DexNest Search result to Drop.", {
        resultId: result.id,
        sourceModule: result.sourceModule,
        entityType: result.entityType,
        fileType: result.fileType ?? null,
        sizeBytes: result.sizeBytes ?? null
      }, startedAt);
      return { ok: true, actionId: action.id, dropItem: item };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DexNest Search action failed.";
    logSearchEvent(
      action.id,
      "search_action_failed",
      "failed",
      source,
      message,
      payloadMetadata(payload),
      startedAt,
      message
    );
    return { ok: false, actionId: action.id, error: message };
  }

  return null;
}

function navigationTargetForAction(actionId: string): { view: string; focusAssistant?: boolean; message: string } | null {
  const targets: Record<string, { view: string; focusAssistant?: boolean; message: string }> = {
    "command.open_home": { view: "command", message: "DexNest opened Command." },
    "command.open_palette": { view: "command", message: "DexNest opened Command Palette." },
    "search.open": { view: "search", focusAssistant: true, message: "DexNest opened Search." },
    "drop.open": { view: "drop", message: "DexNest opened Drop." },
    "clipboard.open": { view: "clipboard", message: "DexNest opened Clipboard." },
    "dev.open_dashboard": { view: "dev", message: "DexNest opened Dev." },
    "vault.open": { view: "vault", message: "DexNest opened Vault." },
    "settings.open": { view: "settings", message: "DexNest opened Settings." },
    "audit.open_history": { view: "audit", message: "DexNest opened Audit." },
    "system.health.open": { view: "settings", message: "DexNest opened App Health." },
    "system.performance.open": { view: "settings", message: "DexNest opened Performance Mode settings." }
  };
  return targets[actionId] ?? null;
}

function openNavigationAction(action: DexNestActionDefinition, source: DexNestActionTrigger, startedAt: number) {
  const target = navigationTargetForAction(action.id);
  if (!target) {
    return null;
  }

  focusDexNestWindow(target.view, source, {
    actionId: action.id,
    eventType: "navigation_action_opened",
    summary: target.message,
    focusAssistant: target.focusAssistant,
    writeAudit: false
  });

  logActionEvent(action, "success", source, target.message, {
    view: target.view,
    focusAssistant: Boolean(target.focusAssistant)
  }, null, Date.now() - startedAt);

  return { ok: true, actionId: action.id, message: target.message };
}

async function runExternalDevicesAction(action: DexNestActionDefinition, source: DexNestActionTrigger, payload: unknown = {}) {
  const startedAt = Date.now();
  const params = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const settings = loadExternalDevicesSettings();

  try {
    if ((source === "voice" || source === "assistant" || source === "ambient_voice" || source === "push_to_talk") && !settings.allowVoiceControl) {
      throw new ExternalDeviceActionError("disabled", "voice_control_disabled", "Govee voice control is disabled in Settings.");
    }
    if (source === "stream_deck_http" && !settings.allowStreamDeckControl) {
      throw new ExternalDeviceActionError("disabled", "stream_deck_control_disabled", "Govee Stream Deck endpoint control is disabled in Settings.");
    }
    if (source === "keyboard_shortcut" && !settings.allowKeyboardShortcutControl) {
      throw new ExternalDeviceActionError("disabled", "keyboard_shortcut_control_disabled", "Govee keyboard shortcut control is disabled in Settings.");
    }

    if (action.id === "external.govee.apply_scene") {
      logExternalDeviceEvent(action.id, "skipped", source, "Govee scene application is a placeholder for this MVP.", {
        actionType: "apply_scene",
        sceneProvided: Boolean(params.scene)
      }, startedAt);
      return {
        ok: false,
        status: "not_configured",
        actionId: action.id,
        provider: "govee",
        errorCode: "govee_scene_placeholder",
        error: "Govee scene support is a placeholder until the local API mapping is confirmed.",
        message: "Govee scene support is a placeholder until the local API mapping is confirmed.",
        source,
        externalDevicesState: externalDevicesState()
      };
    }

    if (action.id === "external.govee.update_settings") {
      const apiKey = typeof params.apiKey === "string" ? params.apiKey.trim() : "";
      const next: Partial<ExternalDevicesSettings> = {
        goveeEnabled: typeof params.goveeEnabled === "boolean" ? params.goveeEnabled : settings.goveeEnabled,
        defaultDeviceAlias: typeof params.defaultDeviceAlias === "string" ? params.defaultDeviceAlias.trim() || null : settings.defaultDeviceAlias,
        allowVoiceControl: typeof params.allowVoiceControl === "boolean" ? params.allowVoiceControl : settings.allowVoiceControl,
        allowStreamDeckControl: typeof params.allowStreamDeckControl === "boolean" ? params.allowStreamDeckControl : settings.allowStreamDeckControl,
        allowKeyboardShortcutControl: typeof params.allowKeyboardShortcutControl === "boolean" ? params.allowKeyboardShortcutControl : settings.allowKeyboardShortcutControl,
        requireConfirmationForPowerOff: typeof params.requireConfirmationForPowerOff === "boolean" ? params.requireConfirmationForPowerOff : settings.requireConfirmationForPowerOff,
        requireConfirmationForBrightnessBelow10: typeof params.requireConfirmationForBrightnessBelow10 === "boolean" ? params.requireConfirmationForBrightnessBelow10 : settings.requireConfirmationForBrightnessBelow10,
        requireConfirmationForScenes: typeof params.requireConfirmationForScenes === "boolean" ? params.requireConfirmationForScenes : settings.requireConfirmationForScenes
      };
      let savedStorageMethod: IntegrationStorageMethod | null = null;
      if (apiKey) {
        // Store integration key in the encrypted Integration Keychain (no Vault).
        const stored = setIntegrationCredential("govee", "Govee API Key", apiKey);
        next.goveeApiKeyCredentialId = stored.id;
        savedStorageMethod = stored.storageMethod;
      }
      const saved = saveExternalDevicesSettings(next);
      logExternalDeviceEvent(action.id, "success", source, "Updated DexNest Govee provider settings.", {
        actionType: "update_settings",
        goveeEnabled: saved.goveeEnabled,
        // Metadata only — never the key itself.
        apiKeyStored: Boolean(saved.goveeApiKeyCredentialId || saved.goveeApiKeySecretId),
        keychainStorageMethod: savedStorageMethod,
        provider: "govee",
        allowVoiceControl: saved.allowVoiceControl,
        allowStreamDeckControl: saved.allowStreamDeckControl,
        allowKeyboardShortcutControl: saved.allowKeyboardShortcutControl
      }, startedAt);
      return { ok: true, actionId: action.id, externalDevicesState: externalDevicesState(), message: apiKey ? "Govee key saved to Integration Keychain." : "Govee settings saved." };
    }

    if (action.id === "external.govee.update_alias") {
      const deviceId = String(params.deviceId ?? "").trim();
      if (!deviceId) {
        throw new Error("Device ID is required to update a Govee alias.");
      }
      const userAlias = typeof params.userAlias === "string" ? params.userAlias.trim() : "";
      const roomAlias = typeof params.roomAlias === "string" ? params.roomAlias.trim() : "";
      const devices = updateCachedGoveeDevice(deviceId, { userAlias, roomAlias });
      const device = devices.find((item) => item.deviceId === deviceId);
      logExternalDeviceEvent(action.id, "success", source, "Updated local Govee device alias.", {
        actionType: "update_alias",
        deviceName: device?.deviceName ?? null,
        hasUserAlias: Boolean(userAlias),
        hasRoomAlias: Boolean(roomAlias)
      }, startedAt);
      return { ok: true, actionId: action.id, externalDevicesState: externalDevicesState(), message: "Govee alias saved." };
    }

    if (action.id === "external.govee.update_group") {
      const now = new Date().toISOString();
      const inputId = String(params.groupId ?? params.id ?? "").trim();
      const name = String(params.name ?? "Room lights").trim();
      const aliases = Array.isArray(params.aliases)
        ? params.aliases.map((item) => String(item).trim()).filter(Boolean)
        : String(params.aliases ?? "lights, room lights, all lights").split(",").map((item) => item.trim()).filter(Boolean);
      const deviceIds = Array.isArray(params.deviceIds)
        ? params.deviceIds.map((item) => String(item).trim()).filter(Boolean)
        : [];
      if (!name) {
        throw new ExternalDeviceActionError("invalid_params", "missing_group_name", "Govee group name is required.");
      }
      if (deviceIds.length === 0) {
        throw new ExternalDeviceActionError("invalid_params", "missing_group_devices", "Select at least one Govee device for the group.");
      }
      const devices = loadExternalDevicesCache();
      const missingIds = deviceIds.filter((deviceId) => !devices.some((device) => device.deviceId === deviceId));
      if (missingIds.length) {
        throw new ExternalDeviceActionError("not_found", "govee_group_device_not_found", "One or more selected Govee devices are not in the local cache.", {
          details: { missingCount: missingIds.length, availableDevices: devices.map(safeGoveeDeviceSummary) }
        });
      }
      const groups = loadExternalDeviceGroups();
      const existing = inputId ? groups.find((group) => group.id === inputId) : undefined;
      const group: ExternalDeviceGroup = {
        id: existing?.id ?? (inputId || normalizeAlias(name).replace(/\s+/g, "_") || createId("govee-group")),
        name,
        aliases: [...new Set(aliases)],
        provider: "govee",
        deviceIds: [...new Set(deviceIds)],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      saveExternalDeviceGroups(existing
        ? groups.map((item) => item.id === existing.id ? group : item)
        : [group, ...groups]
      );
      logExternalDeviceEvent(action.id, "success", source, "Saved local Govee device group.", {
        actionType: "update_group",
        groupId: group.id,
        groupName: group.name,
        aliasCount: group.aliases.length,
        deviceCount: group.deviceIds.length
      }, startedAt);
      return { ok: true, actionId: action.id, externalDevicesState: externalDevicesState(), message: `Saved ${group.name}.` };
    }

    if (action.id === "external.govee.delete_group") {
      const groupId = String(params.groupId ?? params.id ?? "").trim();
      if (!groupId) {
        throw new ExternalDeviceActionError("invalid_params", "missing_group_id", "Govee group ID is required.");
      }
      const groups = loadExternalDeviceGroups();
      const group = groups.find((item) => item.id === groupId);
      saveExternalDeviceGroups(groups.filter((item) => item.id !== groupId));
      logExternalDeviceEvent(action.id, "success", source, "Deleted local Govee device group.", {
        actionType: "delete_group",
        groupId,
        groupName: group?.name ?? null,
        deviceCount: group?.deviceIds.length ?? 0
      }, startedAt);
      return { ok: true, actionId: action.id, externalDevicesState: externalDevicesState(), message: group ? `Deleted ${group.name}.` : "Deleted Govee group." };
    }

    if (action.id === "external.govee.remove_api_key") {
      // Remove the Integration Keychain credential (always possible, no Vault).
      removeIntegrationCredential("govee");
      // Best-effort: also remove a legacy Vault secret if the Vault is unlocked.
      if (settings.goveeApiKeySecretId && secureVaultKey !== null) {
        const file = loadSecureVaultFile();
        if (file) {
          saveSecureVaultFile({ ...file, items: file.items.filter((item) => item.id !== settings.goveeApiKeySecretId) });
          touchSecureVaultActivity();
        }
      }
      const saved = saveExternalDevicesSettings({ goveeApiKeyCredentialId: null, goveeApiKeySecretId: null });
      logExternalDeviceEvent(action.id, "success", source, "Removed Govee API key.", {
        actionType: "remove_api_key",
        provider: "govee",
        goveeEnabled: saved.goveeEnabled
      }, startedAt);
      return { ok: true, actionId: action.id, externalDevicesState: externalDevicesState(), message: "Govee API key removed." };
    }

    if (action.id === "external.govee.migrate_key") {
      // One-time migration of an existing Secure Vault Govee key into the
      // Integration Keychain. Requires the Vault unlocked just for this step.
      logExternalDeviceEvent(action.id, "pending", source, "Started Govee key migration to Integration Keychain.", { actionType: "migrate_key", provider: "govee" }, startedAt);
      if (!settings.goveeApiKeySecretId) {
        throw new ExternalDeviceActionError("missing_requirement", "no_legacy_key", "There is no Secure Vault Govee key to migrate.");
      }
      const file = loadSecureVaultFile();
      if (!file) {
        throw new ExternalDeviceActionError("not_configured", "secure_vault_not_setup", "Secure Vault is not set up.");
      }
      let key: Buffer;
      try {
        key = requireSecureVaultKey();
      } catch {
        throw new ExternalDeviceActionError("locked", "secure_vault_locked", "Unlock Secure Vault once to migrate the Govee key.", { missingRequirement: "secure_vault_unlock" });
      }
      const item = file.items.find((candidate) => candidate.id === settings.goveeApiKeySecretId);
      if (!item) {
        throw new ExternalDeviceActionError("missing_requirement", "govee_api_key_missing", "Stored Govee key was not found in Secure Vault.");
      }
      const decrypted = decryptSecureValue(item.secret, key);
      const stored = setIntegrationCredential("govee", "Govee API Key", decrypted);
      // Remove the Vault copy now that it lives in the keychain.
      saveSecureVaultFile({ ...file, items: file.items.filter((candidate) => candidate.id !== settings.goveeApiKeySecretId) });
      touchSecureVaultActivity();
      const saved = saveExternalDevicesSettings({ goveeApiKeyCredentialId: stored.id, goveeApiKeySecretId: null });
      logExternalDeviceEvent(action.id, "success", source, "Completed Govee key migration to Integration Keychain.", {
        actionType: "migrate_key",
        provider: "govee",
        keychainStorageMethod: stored.storageMethod,
        goveeEnabled: saved.goveeEnabled
      }, startedAt);
      return { ok: true, actionId: action.id, externalDevicesState: externalDevicesState(), message: "Govee key moved to Integration Keychain." };
    }

    if (action.id === "external.govee.test_connection") {
      const devices = await goveeListDevices(readGoveeApiKey());
      logExternalDeviceEvent(action.id, "success", source, "Tested Govee connection.", {
        actionType: "test_connection",
        deviceCount: devices.length
      }, startedAt);
      return { ok: true, actionId: action.id, message: `Govee connection OK. ${devices.length} device(s) visible.`, deviceCount: devices.length, externalDevicesState: externalDevicesState() };
    }

    if (action.id === "external.govee.refresh_devices") {
      const devices = saveExternalDevicesCache(await goveeListDevices(readGoveeApiKey()));
      logExternalDeviceEvent(action.id, "success", source, "Refreshed Govee device cache.", {
        actionType: "refresh_devices",
        deviceCount: devices.length
      }, startedAt);
      return { ok: true, actionId: action.id, message: `Refreshed ${devices.length} Govee device(s).`, devices, externalDevicesState: externalDevicesState() };
    }

    const target = findExternalDeviceTarget(params);
    const alias = target.type === "group" ? target.group.name : (target.device.userAlias || target.device.roomAlias || target.device.deviceName);
    const actionType = action.id.replace("external.govee.", "");
    const commandResults: Array<{ deviceName: string; status: "success" | "failed"; error?: string }> = [];

    if (target.devices.some((device) => !device.controllable)) {
      throw new ExternalDeviceActionError("disabled", "govee_device_not_controllable", `${alias} includes a device that is not marked controllable by Govee.`, {
        details: { targetType: target.type, deviceCount: target.devices.length }
      });
    }

    const controlDevice = async (device: ExternalDeviceCacheItem): Promise<void> => {
      if (action.id === "external.govee.turn_on") {
        await goveeControl(device, "turn", "on");
        updateCachedGoveeDevice(device.deviceId, { lastKnownPowerState: "on" });
        return;
      }
      if (action.id === "external.govee.turn_off") {
        await goveeControl(device, "turn", "off");
        updateCachedGoveeDevice(device.deviceId, { lastKnownPowerState: "off" });
        return;
      }
      if (action.id === "external.govee.toggle") {
        const next = device.lastKnownPowerState === "on" ? "off" : "on";
        await goveeControl(device, "turn", next);
        updateCachedGoveeDevice(device.deviceId, { lastKnownPowerState: next });
        return;
      }
      if (action.id === "external.govee.set_brightness") {
        const brightness = brightnessValue(params.brightness);
        await goveeControl(device, "brightness", brightness);
        updateCachedGoveeDevice(device.deviceId, { lastKnownBrightness: brightness });
        return;
      }
      if (action.id === "external.govee.set_color") {
        await goveeControl(device, "color", colorValue(params.color));
        return;
      }
      if (action.id === "external.govee.set_color_temperature") {
        await goveeControl(device, "colorTem", kelvinValue(params.kelvin));
      }
    };

    const turnsOff = action.id === "external.govee.turn_off" || (action.id === "external.govee.toggle" && target.devices.some((device) => device.lastKnownPowerState === "on"));
    if (turnsOff && settings.requireConfirmationForPowerOff && params.confirmedDangerous !== true) {
      logExternalDeviceEvent(action.id, "cancelled", source, "Govee power-off requires confirmation.", { actionType, targetType: target.type, targetAlias: alias, deviceCount: target.devices.length, confirmationRequired: true }, startedAt);
      return { ok: false, status: "confirmation_required", actionId: action.id, error: "Power-off requires confirmation.", message: "Power-off requires confirmation." };
    }
    if (action.id === "external.govee.set_brightness") {
      const brightness = brightnessValue(params.brightness);
      if (settings.requireConfirmationForBrightnessBelow10 && brightness < 10 && params.confirmedDangerous !== true) {
        logExternalDeviceEvent(action.id, "cancelled", source, "Low Govee brightness requires confirmation.", { actionType, targetType: target.type, targetAlias: alias, brightness, deviceCount: target.devices.length, confirmationRequired: true }, startedAt);
        return { ok: false, status: "confirmation_required", actionId: action.id, error: "Brightness below 10 requires confirmation.", message: "Brightness below 10 requires confirmation." };
      }
    }

    // Control all devices in a group concurrently — a 2-lamp group used to take
    // ~2x as long because each Govee HTTP call ran sequentially.
    await Promise.all(target.devices.map(async (device) => {
      try {
        await controlDevice(device);
        commandResults.push({ deviceName: device.userAlias || device.deviceName, status: "success" });
      } catch (error) {
        commandResults.push({ deviceName: device.userAlias || device.deviceName, status: "failed", error: safeGoveeError(error) });
      }
    }));

    const successCount = commandResults.filter((result) => result.status === "success").length;
    const failedCount = commandResults.length - successCount;
    const resultStatus = failedCount === 0 ? "success" : successCount > 0 ? "partial_success" : "failed";
    const eventStatus: DexNestEventStatus = resultStatus === "failed" ? "failed" : "success";
    const message = target.type === "group"
      ? `${action.title} completed for ${successCount}/${commandResults.length} ${alias} device(s).`
      : failedCount ? `${action.title} failed for ${alias}.` : `${action.title} completed for ${alias}.`;

    logExternalDeviceEvent(action.id, eventStatus, source, message, {
      actionType,
      targetType: target.type,
      targetAlias: alias,
      groupId: target.type === "group" ? target.group.id : null,
      deviceCount: target.devices.length,
      successCount,
      failedCount,
      brightness: action.id === "external.govee.set_brightness" ? brightnessValue(params.brightness) : undefined,
      kelvin: action.id === "external.govee.set_color_temperature" ? kelvinValue(params.kelvin) : undefined,
      colorProvided: action.id === "external.govee.set_color" ? Boolean(params.color) : undefined
    }, startedAt, failedCount && !successCount ? commandResults.find((result) => result.error)?.error : null);

    return {
      ok: successCount > 0,
      status: resultStatus,
      actionId: action.id,
      message,
      provider: "govee",
      targetType: target.type,
      targetAlias: alias,
      deviceCount: target.devices.length,
      results: commandResults,
      externalDevicesState: externalDevicesState()
    };
  } catch (error) {
    const failure = externalDeviceFailure(error, params);
    const message = failure.message;
    const requestedAlias = typeof params.alias === "string" ? params.alias : undefined;
    logExternalDeviceEvent(action.id, "failed", source, message, {
      actionType: action.id.replace("external.govee.", ""),
      errorCode: failure.errorCode,
      status: failure.status,
      requestedAlias
    }, startedAt, message);
    return {
      ok: false,
      status: failure.status,
      actionId: action.id,
      error: message,
      message,
      provider: "govee",
      errorCode: failure.errorCode,
      missingRequirement: failure.missingRequirement,
      source,
      details: failure.details,
      externalDevicesState: externalDevicesState()
    };
  }

  return null;
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
      metadataJson: payloadMetadata(payload)
    });

    return {
      ok: false,
      actionId,
      error: `Unknown DexNest action: ${actionId}`
    };
  }

  const params = typeof payload === "object" && payload !== null ? (payload as { confirmedDangerous?: boolean }) : {};
  const needsConfirmation = action.dangerLevel === "danger" || action.dangerLevel === "critical" || action.requiresConfirmation;
  if (needsConfirmation && params.confirmedDangerous !== true) {
    localDb.appendActionEvent({
      module: action.module,
      actionId,
      eventType: "action_confirmation_required",
      status: "cancelled",
      source,
      summary: `${action.title} was blocked because confirmation was required.`,
      metadataJson: {
        dangerLevel: action.dangerLevel
      }
    });

    return {
      ok: false,
      actionId,
      status: "confirmation_required",
      error: `${action.title} requires confirmation.`
    };
  }

  const navigationResult = openNavigationAction(action, source, startedAt);
  if (navigationResult) {
    return navigationResult;
  }

  const projectMatch = actionId.match(/^dev\.project\.([a-z0-9-]+)\.(.+)$/);
  if (projectMatch) {
    return runProjectAction(actionId, projectMatch[1], projectMatch[2], source, payload);
  }

  // --- Stream Deck Final Pack helper actions (background mic, multi-copy, latest
  // phone text, journal voice, open export folder). Metadata-only audit; secrets
  // are blocked. Handled by id before module dispatch.
  if (action.id === "assistant.start_listening") {
    const startedAtListen = Date.now();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, actionId, error: "DexNest window is not ready." };
    }
    // Drive the existing wake/listening pipeline in the renderer. Works while the
    // app is minimized / hidden in tray; shows the desktop voice overlay and does
    // NOT force the main window open.
    mainWindow.webContents.send("dexnest:wake-detected", { source: "stream_deck", score: null });
    localDb.appendActionEvent({ module: "DexNest Assistant", actionId, eventType: "assistant_listen_started", status: "success", source, summary: "Started DexNest listening from Stream Deck.", metadataJson: { source }, durationMs: Date.now() - startedAtListen });
    return { ok: true, actionId, message: "Listening…" };
  }

  if (action.id === "clipboard.multi_copy_add_current") {
    const startedAtAdd = Date.now();
    const text = clipboard.readText();
    if (!text.trim()) {
      logActionEvent(action, "skipped", source, "Multi-copy add skipped because the clipboard was empty.", {});
      return { ok: false, actionId, error: "Clipboard is empty." };
    }
    if (isProtectedClipboardText(text)) {
      logActionEvent(action, "skipped", source, "Multi-copy add skipped a Secure Vault protected value.", { protectedSource: "secure_vault" });
      return { ok: false, actionId, error: clipboardProtectedError() };
    }
    if (looksSensitiveClipboardText(text)) {
      logActionEvent(action, "skipped", source, "Multi-copy add skipped a likely-sensitive clipboard value.", { sensitivityCategory: "likely_sensitive", byteLength: byteLength(text) });
      return { ok: false, actionId, error: "Clipboard looks sensitive — not added to the multi-copy group." };
    }
    const nowAdd = new Date().toISOString();
    const existingSession = loadClipboardActiveMultiCopySession();
    const session: ClipboardActiveMultiCopySession = existingSession ?? { id: createId("multi-copy"), startedAt: nowAdd, updatedAt: nowAdd, items: [] };
    if (session.items.at(-1)?.text === text) {
      logActionEvent(action, "skipped", source, "Multi-copy add skipped duplicate clipboard value.", { itemCount: session.items.length });
      return { ok: true, actionId, itemCount: session.items.length, message: `Already in group (${session.items.length}).` };
    }
    const item = makeClipboardHistoryItem(text, "multi_copy");
    const updated = saveClipboardActiveMultiCopySession({ ...session, updatedAt: nowAdd, armedForPasteAt: null, items: [...session.items, item] }) as ClipboardActiveMultiCopySession;
    const combined = combinedClipboardText(updated.items, loadClipboardSettings().combinedSeparator || "\n\n");
    clipboard.writeText(combined);
    lastClipboardListenerText = combined;
    armActiveMultiCopyForPaste(updated, combined);
    logActionEvent(action, "success", source, `Added clipboard to multi-copy group (${updated.items.length} items).`, { itemCount: updated.items.length, byteLength: byteLength(item.text) });
    return { ok: true, actionId, itemCount: updated.items.length, message: `Added to multi-copy (${updated.items.length}).` };
  }

  if (action.id === "clipboard.paste_multi_copy_group") {
    const startedAtPaste = Date.now();
    const session = loadClipboardActiveMultiCopySession();
    if (!session || session.items.length === 0) {
      logActionEvent(action, "skipped", source, "Multi-copy paste skipped because the session was empty.", {});
      return { ok: false, actionId, error: "Multi-copy group is empty." };
    }
    const combined = combinedClipboardText(session.items, loadClipboardSettings().combinedSeparator || "\n\n");
    if (!combined.trim()) {
      return { ok: false, actionId, error: "Multi-copy group text is empty." };
    }
    clipboard.writeText(combined);
    lastClipboardListenerText = combined;
    let pasted = false;
    let pasteError: string | null = null;
    if (process.platform === "win32") {
      try { await sendWindowsPasteShortcut(); pasted = true; } catch (error) { pasteError = error instanceof Error ? error.message : "Direct paste failed."; }
    }
    logActionEvent(action, pasted ? "success" : "success", source, `${pasted ? "Pasted" : "Copied"} multi-copy group (${session.items.length} items).`, { itemCount: session.items.length, byteLength: byteLength(combined), pasteMode: pasted ? "direct" : "clipboard_fallback" });
    return { ok: true, actionId, itemCount: session.items.length, pasted, pasteError, message: pasted ? `Pasted ${session.items.length} items.` : `Group copied (${session.items.length}). Press Ctrl+V.` };
  }

  if (action.id === "drop.copy_latest_phone_text") {
    const startedAtText = Date.now();
    const latest = loadDropIncoming()
      .filter((item): item is DropTextItem => item.type === "text" && Boolean(item.text && item.text.trim()))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (!latest) {
      logActionEvent(action, "skipped", source, "No incoming phone text to copy.", { found: false });
      return { ok: false, actionId, error: "No incoming phone text yet." };
    }
    clipboard.writeText(latest.text);
    lastClipboardListenerText = latest.text;
    // Metadata only — never log or return the private text content.
    logActionEvent(action, "success", source, "Copied latest incoming phone text to the clipboard.", { found: true, byteLength: byteLength(latest.text) });
    return { ok: true, actionId, byteLength: byteLength(latest.text), message: "Latest phone text copied to clipboard." };
  }

  if (action.id === "journal.start_today_voice" || action.id === "journal.save_voice") {
    const startedAtJournal = Date.now();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, actionId, error: "DexNest window is not ready." };
    }
    // Reuse the assistant command pipeline: the renderer enters journal voice mode
    // ("start today's journal") or saves it ("save journal"), with its own
    // speech-unavailable fallback. Works while minimized.
    const text = action.id === "journal.start_today_voice" ? "start today's journal" : "save journal";
    mainWindow.webContents.send("dexnest:run-assistant-command", { text, source: "stream_deck" });
    localDb.appendActionEvent({ module: "DexNest Journal", actionId, eventType: action.id === "journal.save_voice" ? "journal_voice_saved" : "journal_voice_started", status: "success", source, summary: action.id === "journal.save_voice" ? "Saved journal from Stream Deck." : "Started today's journal from Stream Deck.", metadataJson: { source }, durationMs: Date.now() - startedAtJournal });
    return { ok: true, actionId, message: action.id === "journal.save_voice" ? "Saving journal…" : "Starting today's journal…" };
  }

  if (action.id === "deck.open_export_folder") {
    const folder = resolve(repoRoot, "streamdeck-actions");
    if (!existsSync(folder)) {
      return { ok: false, actionId, error: "Export folder not found. Run Export Final Stream Deck Pack first." };
    }
    void shell.openPath(folder);
    localDb.appendActionEvent({ module: "DexNest Deck", actionId, eventType: "deck_export_folder_opened", status: "success", source, summary: "Opened the Stream Deck export folder.", metadataJson: { folder }, durationMs: 0 });
    return { ok: true, actionId, folder, message: "Opened export folder." };
  }

  // --- Delete / clear / remove pass: individual-item removals that were missing.
  // Metadata-only audit (never content / paths beyond the folder); file deletes
  // are guarded to their own folder and require confirmation (critical).
  const dp = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  if (action.id === "clipboard.delete_history_item") {
    const id = String(dp.id ?? dp.itemId ?? "");
    const history = loadClipboardHistory();
    const exists = history.some((item) => item.id === id);
    saveClipboardHistory(history.filter((item) => item.id !== id));
    logActionEvent(action, exists ? "success" : "skipped", source, exists ? "Removed one Clipboard history item." : "Clipboard history item not found.", { found: exists });
    return { ok: exists, actionId, message: exists ? "History item removed." : "Item not found." };
  }

  if (action.id === "drop.remove_incoming_item") {
    const id = String(dp.id ?? "");
    const incoming = loadDropIncoming();
    const exists = incoming.some((item) => item.id === id);
    saveDropIncoming(incoming.filter((item) => item.id !== id));
    logActionEvent(action, exists ? "success" : "skipped", source, exists ? "Removed one incoming Drop item from the list (file kept)." : "Incoming Drop item not found.", { found: exists });
    if (exists) { broadcastDropUpdate("Incoming Drop item removed.", "drop.incoming_cleared"); }
    return { ok: exists, actionId, message: exists ? "Removed from list." : "Item not found." };
  }

  if (action.id === "drop.delete_incoming_file") {
    const id = String(dp.id ?? "");
    const incoming = loadDropIncoming();
    const item = incoming.find((entry) => entry.id === id);
    if (!item) { return { ok: false, actionId, error: "Incoming Drop item not found." }; }
    const filePath = item.type === "file" ? item.path : null;
    if (!filePath || !isPathInside(resolve(dropIncomingRoot), resolve(filePath))) {
      return { ok: false, actionId, error: "This item has no received file inside the Drop folder." };
    }
    try { if (existsSync(filePath)) { unlinkSync(filePath); } } catch (error) {
      logActionEvent(action, "failed", source, "Failed to delete incoming Drop file from disk.", { found: true }, error instanceof Error ? error.message : null);
      return { ok: false, actionId, error: "Could not delete the file from disk." };
    }
    saveDropIncoming(incoming.filter((entry) => entry.id !== id));
    logActionEvent(action, "success", source, "Deleted a received Drop file from disk.", { deletedFromDisk: true });
    broadcastDropUpdate("Incoming Drop file deleted.", "drop.incoming_cleared");
    return { ok: true, actionId, message: "File deleted from disk." };
  }

  if (action.id === "tools.delete_output") {
    const id = String(dp.id ?? "");
    const outputs = loadToolsOutputs();
    const exists = outputs.some((item) => item.id === id);
    saveToolsOutputs(outputs.filter((item) => item.id !== id));
    logActionEvent(action, exists ? "success" : "skipped", source, exists ? "Removed a Tools output from the list (file kept)." : "Tools output not found.", { found: exists });
    return { ok: exists, actionId, message: exists ? "Removed from list." : "Output not found." };
  }

  if (action.id === "tools.delete_output_file") {
    const id = String(dp.id ?? "");
    const outputs = loadToolsOutputs();
    const item = outputs.find((entry) => entry.id === id);
    if (!item) { return { ok: false, actionId, error: "Tools output not found." }; }
    const outputFolder = resolve(getToolsOutputFolder());
    if (!isPathInside(outputFolder, resolve(item.path)) && !isPathInside(resolve(toolsOutputRoot), resolve(item.path))) {
      return { ok: false, actionId, error: "Output file is outside the DexNest Tools output folder." };
    }
    try { if (existsSync(item.path)) { unlinkSync(item.path); } } catch (error) {
      logActionEvent(action, "failed", source, "Failed to delete Tools output file from disk.", { found: true }, error instanceof Error ? error.message : null);
      return { ok: false, actionId, error: "Could not delete the file from disk." };
    }
    saveToolsOutputs(outputs.filter((entry) => entry.id !== id));
    logActionEvent(action, "success", source, "Deleted a Tools output file from disk.", { deletedFromDisk: true });
    return { ok: true, actionId, message: "Output file deleted from disk." };
  }

  if (action.id === "backup.delete_file") {
    const fileName = String(dp.fileName ?? "");
    const requestedPath = typeof dp.path === "string" ? dp.path : (fileName ? join(backupsRoot, sanitizeFileName(fileName)) : "");
    if (!requestedPath || !isPathInside(resolve(backupsRoot), resolve(requestedPath)) || !resolve(requestedPath).toLowerCase().endsWith(".zip")) {
      return { ok: false, actionId, error: "Invalid backup file." };
    }
    if (!existsSync(requestedPath)) { return { ok: false, actionId, error: "Backup file not found." }; }
    try { unlinkSync(requestedPath); } catch (error) {
      logActionEvent(action, "failed", source, "Failed to delete backup file from disk.", {}, error instanceof Error ? error.message : null);
      return { ok: false, actionId, error: "Could not delete the backup file." };
    }
    logActionEvent(action, "success", source, "Deleted a DexNest backup file from disk.", { deletedFromDisk: true });
    return { ok: true, actionId, backupState: backupState(), message: "Backup deleted." };
  }

  if (action.id === "system.data.preview_delete") {
    const categoryIds = Array.isArray(dp.categoryIds) ? (dp.categoryIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
    if (categoryIds.length === 0) {
      return { ok: false, actionId, error: "Select at least one category to preview." };
    }
    const preview = previewDataDeletion(categoryIds);
    logActionEvent(action, "success", source, `Previewed Data Management deletion for ${categoryIds.length} categor${categoryIds.length === 1 ? "y" : "ies"}.`, { categoryIds, totalRecords: preview.totalRecords, totalFiles: preview.totalFiles });
    return { ok: true, actionId, preview };
  }

  if (action.id === "system.data.execute_delete") {
    const categoryIds = Array.isArray(dp.categoryIds) ? (dp.categoryIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
    const confirmText = typeof dp.confirmText === "string" ? dp.confirmText : "";
    const createBackupFirst = dp.createBackupFirst === true;
    if (categoryIds.length === 0) {
      return { ok: false, actionId, error: "Select at least one category to delete." };
    }
    if (confirmText !== "DELETE") {
      return { ok: false, actionId, error: "Type DELETE to confirm." };
    }
    const result = executeDataDeletion(categoryIds, source, createBackupFirst);
    return { actionId, ...result };
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

  if (action.id === "deck.export_button_pack") {
    return exportStreamDeckButtonPack(source);
  }

  if (action.module === "deck" && action.id.startsWith("deck.routine.")) {
    const result = await runDeckRoutineAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "command" && action.id === "command.update_settings") {
    const settings = loadCommandSettings();
    const input = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    const nextSettings = saveCommandSettings({
      ...settings,
      globalShortcutEnabled: typeof input.globalShortcutEnabled === "boolean" ? input.globalShortcutEnabled : settings.globalShortcutEnabled,
      globalShortcut: typeof input.globalShortcut === "string" ? normalizeCommandShortcut(input.globalShortcut) : settings.globalShortcut
    });
    registerCommandShortcut();
    registerKeyboardShortcuts();
    const refreshedSettings = loadCommandSettings();
    localDb.appendActionEvent({
      module: "DexNest Command",
      actionId,
      eventType: "command_settings_updated",
      status: "success",
      source,
      summary: "Updated DexNest Command access settings.",
      metadataJson: {
        globalShortcutEnabled: nextSettings.globalShortcutEnabled,
        globalShortcut: refreshedSettings.globalShortcut,
        globalShortcutStatus: refreshedSettings.globalShortcutStatus
      }
    });
    return { ok: true, actionId, settings: refreshedSettings };
  }

  if (action.module === "command" && (action.id === "command.open_home" || action.id === "command.open_palette" || action.id === "command.refresh_stats" || action.id === "command.open_recent_activity")) {
    if (action.id === "command.open_home" || action.id === "command.open_palette") {
      localDb.appendActionEvent({
        module: "DexNest Command",
        actionId,
        eventType: action.id === "command.open_palette" ? "command_palette_opened" : "command_home_opened",
        status: "success",
        source,
        summary: action.id === "command.open_palette" ? "Opened DexNest Command palette." : "Opened DexNest Command home.",
        metadataJson: {}
      });
      return { ok: true, actionId };
    }
    localDb.appendActionEvent({
      module: "DexNest Command",
      actionId,
      eventType: action.id === "command.refresh_stats" ? "command_stats_refreshed" : "command_recent_activity_opened",
      status: "success",
      source,
      summary: action.id === "command.refresh_stats" ? "Refreshed DexNest Command stats." : "Opened DexNest Command recent activity.",
      metadataJson: {}
    });
    return { ok: true, actionId, commandStats: commandStats(), events: localDb.listRecentEvents(10) };
  }

  if (action.module === "tools") {
    const result = await runToolsAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "vault") {
    const result = runVaultAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "search") {
    const result = await runSearchAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "external_devices") {
    const result = await runExternalDevicesAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "journal") {
    const result = runJournalAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "calendar") {
    const result = runCalendarAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "finder") {
    const result = runFinderAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "finance") {
    const result = runFinanceAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "heatmap") {
    const result = await runHeatmapAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "backup") {
    const result = runBackupAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "system" && action.id.startsWith("system.health.")) {
    const health = appHealthState(source, action.id === "system.health.run_checks");
    return { ok: true, actionId, health };
  }

  if (action.module === "system" && action.id.startsWith("system.performance.")) {
    const input = typeof payload === "object" && payload !== null ? payload as Partial<PerformanceModeSettings> & { reason?: PerformanceModeReason } : {};
    if (action.id === "system.performance.open") {
      logActionEvent(action, "success", source, "Opened DexNest Performance Mode settings.", {}, null, Date.now() - startedAt);
      return { ok: true, actionId, performanceModeState: performanceModeState(), performanceModeSettings: loadPerformanceModeSettings() };
    }
    if (action.id === "system.performance.enable" || action.id === "system.performance.disable") {
      const result = setPerformanceModeEnabled(action.id === "system.performance.enable", input.reason ?? "manual", source);
      return { ok: true, actionId, performanceModeState: result.state, performanceModeSettings: result.settings };
    }
    if (action.id === "system.performance.toggle") {
      const current = performanceModeState();
      const result = setPerformanceModeEnabled(!current.enabled, input.reason ?? "manual", source);
      return { ok: true, actionId, performanceModeState: result.state, performanceModeSettings: result.settings };
    }
    if (action.id === "system.performance.update_settings") {
      const settings = savePerformanceModeSettings(input);
      localDb.appendActionEvent({
        module: "DexNest System",
        actionId,
        eventType: "performance_mode_settings_updated",
        status: "success",
        source,
        summary: "Updated DexNest Performance Mode settings.",
        metadataJson: {
          performanceModeEnabled: settings.performanceModeEnabled,
          pausedWorkers: pausedWorkersForPerformance(settings),
          autoEnableWhenFullscreen: settings.autoEnableWhenFullscreen,
          autoEnableWhenGameDetected: settings.autoEnableWhenGameDetected
        },
        durationMs: Date.now() - startedAt
      });
      createDexNestTray();
      return { ok: true, actionId, performanceModeState: performanceModeState(), performanceModeSettings: settings };
    }
  }

  if (action.module === "system" && action.id.startsWith("system.lifecycle.")) {
    const input = typeof payload === "object" && payload !== null ? payload as Partial<AppLifecycleSettings> : {};
    if (action.id === "system.lifecycle.update_settings") {
      const settings = saveAppLifecycleSettings(input, source);
      createDexNestTray();
      return {
        ok: settings.loginItemStatus !== "failed",
        actionId,
        appLifecycleSettings: appLifecycleState(),
        error: settings.loginItemLastError ?? undefined
      };
    }
    if (action.id === "system.lifecycle.test_tray_notice") {
      trayCloseNoticeShownThisSession = false;
      showTrayCloseNotice();
      localDb.appendActionEvent({
        module: "DexNest System",
        actionId,
        eventType: "tray_notice_tested",
        status: "success",
        source,
        summary: "Tested DexNest tray notification.",
        metadataJson: { trayAvailable: Boolean(tray) },
        durationMs: Date.now() - startedAt
      });
      return { ok: true, actionId };
    }
    if (action.id === "system.lifecycle.quit_full") {
      quitDexNestFully(source);
      return { ok: true, actionId };
    }
    if (action.id === "system.lifecycle.lock_sensitive_session") {
      lockSensitiveSessionFromTray();
      return { ok: true, actionId };
    }
  }

  if (action.module === "system" && action.id.startsWith("system.keyboard_shortcuts.")) {
    const input = typeof payload === "object" && payload !== null ? payload as Partial<KeyboardShortcutSettings> : {};
    let settings: KeyboardShortcutSettings;
    if (action.id === "system.keyboard_shortcuts.reset_defaults") {
      settings = saveKeyboardShortcutSettings(defaultKeyboardShortcutSettings());
    } else if (action.id === "system.keyboard_shortcuts.disable_all") {
      const current = loadKeyboardShortcutSettings();
      settings = saveKeyboardShortcutSettings({ ...current, enabled: false, mappings: current.mappings.map((mapping) => ({ ...mapping, enabled: false })) });
    } else {
      const current = loadKeyboardShortcutSettings();
      settings = saveKeyboardShortcutSettings({
        enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
        mappings: Array.isArray(input.mappings) ? input.mappings as KeyboardShortcutMapping[] : current.mappings,
        updatedAt: new Date().toISOString()
      });
    }
    localDb.appendActionEvent({
      module: "DexNest System",
      actionId,
      eventType: "keyboard_shortcuts_updated",
      status: "success",
      source,
      summary: "Updated DexNest keyboard shortcut settings.",
      metadataJson: {
        enabled: settings.enabled,
        mappingCount: settings.mappings.length,
        activeCount: settings.mappings.filter((mapping) => mapping.status === "active").length,
        conflictCount: shortcutConflictDetails(settings).length
      },
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId, keyboardShortcutSettings: settings };
  }

  if (action.module === "system" && action.id === "system.stream_deck.update_settings") {
    const input = typeof payload === "object" && payload !== null ? payload as Partial<StreamDeckSettings> : {};
    const settings = saveStreamDeckSettings(input);
    localDb.appendActionEvent({
      module: "DexNest Deck",
      actionId,
      eventType: "stream_deck_settings_updated",
      status: "success",
      source,
      summary: "Updated DexNest Stream Deck endpoint settings.",
      metadataJson: {
        lanEnabled: settings.lanEnabled,
        tokenEnabled: settings.tokenEnabled,
        hasToken: Boolean(settings.token)
      },
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId, streamDeckSettings: { ...settings, token: settings.token ? "set" : "" } };
  }

  if (action.module === "capture") {
    const result = runCaptureAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "voice") {
    const input = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    const eventTypeByAction: Record<string, string> = {
      "voice.open": "voice_opened",
      "voice.start_listening": "voice_listening_started",
      "voice.stop_listening": "voice_listening_stopped",
      "voice.route_command": "voice_intent_detected",
      "voice.confirm_command": "voice_command_confirmed",
      "voice.cancel_command": "voice_command_cancelled",
      "voice.start_dictation_placeholder": "voice_dictation_started",
      "voice.tts_response": "voice_tts_response",
      "voice.ambient.update_settings": "ambient_voice_settings_updated",
      "voice.ambient.start_listening": "ambient_voice_listening_started",
      "voice.ambient.stop_listening": "ambient_voice_listening_stopped",
      "voice.ambient.test_microphone": "ambient_voice_microphone_tested",
      "voice.ambient.test_command": "ambient_voice_command_tested",
      "voice.ambient.toggle": "ambient_voice_toggled",
      "voice.workflow.update_settings": "voice_workflow_settings_updated",
      "voice.workflow.start": "voice_workflow_started",
      "voice.workflow.stop": "voice_workflow_stopped",
      "voice.workflow.capture_saved": "voice_capture_saved",
      "voice.workflow.finder_candidate": "voice_finder_candidate",
      "voice.workflow.finder_lookup": "voice_finder_lookup",
      "voice.workflow.calendar_candidate": "voice_calendar_candidate",
      "voice.workflow.calendar_confirmed": "voice_calendar_confirmed",
      "voice.workflow.calendar_cancelled": "voice_calendar_cancelled",
      "voice.workflow.calendar_lookup": "voice_calendar_lookup",
      "speech.update_settings": "speech_settings_updated",
      "speech.check_model": "speech_model_checked",
      "speech.install_model": "speech_model_installed",
      "speech.open_model_folder": "speech_model_folder_opened",
      "speech.transcribe": "speech_transcription_requested"
    };
    if (action.id === "speech.update_settings") {
      const saved = saveSpeechSettings(input as Partial<SpeechSettings>);
      return { ok: true, actionId, speechState: speechServiceState(), settings: saved };
    }
    if (action.id === "voice.workflow.update_settings") {
      const saved = saveVoiceWorkflowSettings(input as Partial<VoiceWorkflowSettings>);
      return { ok: true, actionId, settings: saved };
    }
    if (action.id === "speech.check_model" || action.id === "speech.install_model") {
      const status = await checkSpeechModel(action.id === "speech.install_model");
      localDb.appendActionEvent({
        module: "DexNest Voice",
        actionId,
        eventType: eventTypeByAction[actionId],
        status: status.ok ? "success" : "failed",
        source,
        summary: status.ok ? "Checked DexNest speech model." : "DexNest speech model check failed.",
        metadataJson: {
          engine: status.engine,
          model: status.model,
          deviceDetected: status.deviceDetected,
          installed: status.installed,
          fasterWhisperAvailable: status.fasterWhisperAvailable
        },
        errorMessage: status.ok ? null : status.message,
        durationMs: Date.now() - startedAt
      });
      return { ok: status.ok, actionId, modelStatus: status, speechState: speechServiceState(status), error: status.ok ? undefined : status.message };
    }
    if (action.id === "speech.open_model_folder") {
      ensureSpeechRoot();
      void shell.openPath(speechModelsRoot);
      localDb.appendActionEvent({
        module: "DexNest Voice",
        actionId,
        eventType: eventTypeByAction[actionId],
        status: "success",
        source,
        summary: "Opened DexNest speech model folder.",
        metadataJson: { modelRoot: speechModelsRoot },
        durationMs: Date.now() - startedAt
      });
      return { ok: true, actionId, path: speechModelsRoot };
    }
    if (action.id === "speech.transcribe") {
      localDb.appendActionEvent({
        module: "DexNest Voice",
        actionId,
        eventType: eventTypeByAction[actionId],
        status: "skipped",
        source,
        summary: "Speech transcription requires microphone audio through the DexNest desktop bridge.",
        metadataJson: { sourceModule: typeof input.sourceModule === "string" ? input.sourceModule : null },
        durationMs: Date.now() - startedAt
      });
      return { ok: false, actionId, status: "requires_audio", error: "Use a DexNest mic button to capture local audio first." };
    }
    if (action.id === "voice.ambient.update_settings" || action.id === "voice.ambient.toggle") {
      const saved = action.id === "voice.ambient.toggle"
        ? saveAmbientVoiceSettings({ ambientVoiceEnabled: !loadAmbientVoiceSettings().ambientVoiceEnabled }, source)
        : saveAmbientVoiceSettings(input as Partial<AmbientVoiceSettings>, source);
      return { ok: true, actionId, ambientVoiceState: ambientVoiceState(), message: `Ambient Voice ${saved.ambientVoiceEnabled ? "enabled" : "disabled"}.` };
    }
    if (action.id === "voice.ambient.start_listening") {
      requestAmbientListening(source === "module_ui" ? "ambient_voice" : source);
      return { ok: true, actionId, ambientVoiceState: ambientVoiceState(), message: "Ambient Voice listening requested." };
    }
    if (action.id === "voice.ambient.stop_listening") {
      updateAmbientVoiceRuntime({ currentState: "idle", lastActionResult: "Listening stopped.", lastSource: source }, source);
    }
    const safeVoiceMetadata = {
      intent: typeof input.intent === "string" ? input.intent : null,
      targetModule: typeof input.targetModule === "string" ? input.targetModule : null,
      routedActionId: typeof input.actionId === "string" ? input.actionId : null,
      confidence: typeof input.confidence === "string" ? input.confidence : null,
      sensitivity: typeof input.sensitivity === "string" ? input.sensitivity : null,
      status: typeof input.status === "string" ? input.status : null,
      currentState: typeof input.currentState === "string" ? input.currentState : null,
      ttsSpoken: typeof input.ttsSpoken === "boolean" ? input.ttsSpoken : null,
      blockedReason: typeof input.blockedReason === "string" ? input.blockedReason : null,
      workflowMode: typeof input.workflowMode === "string" ? input.workflowMode : null,
      chunksCount: typeof input.chunksCount === "number" ? input.chunksCount : null,
      missingFieldCount: typeof input.missingFieldCount === "number" ? input.missingFieldCount : null,
      eventType: typeof input.eventType === "string" ? input.eventType : null,
      parsedDate: typeof input.parsedDate === "boolean" ? input.parsedDate : null,
      parsedTime: typeof input.parsedTime === "boolean" ? input.parsedTime : null,
      durationMs: typeof input.durationMs === "number" ? input.durationMs : null,
      sensitivityCategory: typeof input.sensitivityCategory === "string" ? input.sensitivityCategory : null,
      source: typeof input.source === "string" ? input.source : source,
      speechRecognitionAvailable: typeof input.speechRecognitionAvailable === "boolean" ? input.speechRecognitionAvailable : null
    };
    const requestedStatus = typeof input.status === "string" ? input.status : "success";
    const auditStatus: DexNestEventStatus = requestedStatus === "failed"
      ? "failed"
      : requestedStatus === "cancelled"
        ? "cancelled"
        : requestedStatus === "skipped" || requestedStatus === "paused"
          ? "skipped"
          : "success";
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId,
      eventType: eventTypeByAction[actionId] ?? "voice_action",
      status: auditStatus,
      source,
      summary: actionId === "voice.route_command"
        ? "Routed DexNest voice command intent."
        : actionId === "voice.confirm_command"
          ? "Confirmed DexNest voice command."
          : actionId === "voice.cancel_command"
            ? "Cancelled DexNest voice command."
            : actionId === "voice.start_listening"
              ? "Started DexNest click-to-speak listening."
              : actionId === "voice.stop_listening"
                ? "Stopped DexNest click-to-speak listening."
                : "Ran DexNest Voice action.",
      metadataJson: safeVoiceMetadata,
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId, message: "DexNest Voice action logged." };
  }

  if (action.module === "assistant") {
    const input = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    // Metadata only. Never store the transcript, the answer, OCR text, or any
    // sensitive value (SIN/passport/permit/health card). For sensitive queries
    // we keep only intent category, target module, status, and sensitivity.
    const sensitivity = typeof input.sensitivity === "string" ? input.sensitivity : null;
    const isSensitive = sensitivity === "sensitive";
    const safeAssistantMetadata = {
      router: typeof input.router === "string" ? input.router : null,
      intent: typeof input.intent === "string" ? input.intent : null,
      targetModule: typeof input.targetModule === "string" ? input.targetModule : null,
      routedActionId: isSensitive ? null : (typeof input.actionId === "string" ? input.actionId : null),
      confidence: typeof input.confidence === "string" ? input.confidence : null,
      sensitivity,
      status: typeof input.status === "string" ? input.status : null,
      resultCount: typeof input.resultCount === "number" ? input.resultCount : null
    };
    const eventTypeByAction: Record<string, string> = {
      "assistant.command_received": "assistant_command_received",
      "assistant.routed": "assistant_intent_routed",
      "assistant.confirmed": "assistant_command_confirmed",
      "assistant.cancelled": "assistant_command_cancelled"
    };
    const summaryByAction: Record<string, string> = {
      "assistant.command_received": "DexNest Assistant received a command.",
      "assistant.routed": "DexNest Assistant routed an intent.",
      "assistant.confirmed": "DexNest Assistant command confirmed.",
      "assistant.cancelled": "DexNest Assistant command cancelled."
    };
    localDb.appendActionEvent({
      module: "DexNest Assistant",
      actionId,
      eventType: eventTypeByAction[actionId] ?? "assistant_action",
      status: "success",
      source,
      summary: summaryByAction[actionId] ?? "Ran DexNest Assistant action.",
      metadataJson: safeAssistantMetadata,
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId, message: "DexNest Assistant action logged." };
  }

  logActionEvent(
    action,
    "success",
    source,
    `${action.title} completed.`,
    { handlerType: action.handlerType, handlerRef: action.handlerRef, ...payloadMetadata(payload) },
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

// --- Dev project lifecycle helpers (Windows-focused; safe no-op elsewhere) ----

function execCapture(command: string, cwd: string, timeoutMs = 60000): Promise<{ ok: boolean; stdout: string; stderr: string; error: string | null }> {
  return new Promise((resolveExec) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      resolveExec({
        ok: !error,
        stdout: stripAnsi(stdout ?? ""),
        stderr: stripAnsi(stderr ?? ""),
        error: error instanceof Error ? error.message : null
      });
    });
  });
}

// Find PIDs that are LISTENING on a specific local port (exact match only, so we
// never touch unrelated processes).
async function findPortPids(port: number): Promise<number[]> {
  if (process.platform !== "win32") { return []; }
  const result = await execCapture("netstat -ano -p TCP", process.cwd(), 8000);
  const pids = new Set<number>();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) { continue; }
    const parts = line.trim().split(/\s+/);
    const local = parts[1] ?? "";
    const pid = Number(parts[parts.length - 1]);
    if (local.endsWith(`:${port}`) && Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
}

async function processImageForPid(pid: number): Promise<string> {
  if (process.platform !== "win32") { return "unknown"; }
  const result = await execCapture(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, process.cwd(), 5000);
  const match = /^"([^"]+)"/.exec(result.stdout.trim());
  return match ? match[1] : "unknown";
}

function checkPortListening(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolveCheck) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) { return; }
      settled = true;
      socket.destroy();
      resolveCheck(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function httpHealthCheck(url: string, timeoutMs = 4000): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  return new Promise((resolveHealth) => {
    let getter: typeof httpGet;
    try {
      getter = new URL(url).protocol === "https:" ? httpsGet : httpGet;
    } catch {
      resolveHealth({ ok: false, status: null, error: "Invalid URL." });
      return;
    }
    const request = getter(url, (response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      resolveHealth({ ok: status > 0 && status < 500, status, error: null });
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); resolveHealth({ ok: false, status: null, error: "Timed out." }); });
    request.on("error", (error) => resolveHealth({ ok: false, status: null, error: error.message }));
  });
}

// Persist a lifecycle result so the existing Dev output panel shows it, and log a
// metadata-only Audit event (never command output / file contents).
function finishLifecycle(
  project: DexNestProject,
  actionId: string,
  operation: string,
  source: DexNestActionTrigger,
  status: "success" | "failed",
  summary: string,
  stdout: string,
  stderr: string,
  startedAt: number,
  metadata: Record<string, unknown>
): { ok: boolean; actionId: string; summary: string; output: string; stdout: string; stderr: string; status: "success" | "failed"; durationMs: number } {
  const durationMs = Date.now() - startedAt;
  saveCommandResult({
    actionId,
    projectId: project.id,
    projectName: project.name,
    commandKey: operation,
    command: operation,
    status,
    stdout: stdout.slice(-4000),
    stderr: stderr.slice(-4000),
    summary,
    durationMs,
    finishedAt: new Date().toISOString(),
    errorMessage: status === "failed" ? summary : null
  });
  localDb.appendActionEvent({
    module: "DexNest Dev",
    actionId,
    eventType: `project_${operation}`,
    status: status === "success" ? "success" : "failed",
    source,
    summary: `${project.name}: ${summary}`,
    metadataJson: { ...projectMetadata(project), operation, ...metadata, durationMs }
  });
  return { ok: status === "success", actionId, summary, output: summarizeOutput(stdout, stderr), stdout, stderr, status, durationMs };
}

async function killProjectPorts(project: DexNestProject, source: DexNestActionTrigger, actionId: string, startedAt: number) {
  const ports = project.ports ?? [];
  if (ports.length === 0) {
    return finishLifecycle(project, actionId, "kill_ports", source, "failed", "No ports configured for this project.", "", "", startedAt, { ports: [] });
  }
  const lines: string[] = [];
  let killedCount = 0;
  for (const port of ports) {
    const pids = await findPortPids(port);
    if (pids.length === 0) { lines.push(`Port ${port}: nothing listening.`); continue; }
    for (const pid of pids) {
      const image = await processImageForPid(pid);
      const result = await execCapture(`taskkill /F /PID ${pid}`, process.cwd(), 5000);
      killedCount += result.ok ? 1 : 0;
      lines.push(`Port ${port}: ${result.ok ? "killed" : "failed to kill"} PID ${pid} (${image}).`);
    }
  }
  return finishLifecycle(project, actionId, "kill_ports", source, "success", `Cleared ${killedCount} process(es) on ${ports.join(", ")}.`, lines.join("\n"), "", startedAt, { ports, killedCount });
}

async function dockerDownProject(project: DexNestProject, source: DexNestActionTrigger, actionId: string, startedAt: number, operation = "docker_down") {
  if (!project.dockerComposeEnabled) {
    return finishLifecycle(project, actionId, operation, source, "failed", "Docker Compose is not enabled for this project.", "", "", startedAt, { dockerComposeEnabled: false });
  }
  const result = await execCapture("docker compose down", project.path, 120000);
  return finishLifecycle(project, actionId, operation, source, result.ok ? "success" : "failed", result.ok ? "Stopped Docker Compose stack." : (result.error ?? "docker compose down failed."), result.stdout, result.stderr, startedAt, { dockerComposeEnabled: true });
}

async function stopProject(project: DexNestProject, source: DexNestActionTrigger, actionId: string, startedAt: number, operation = "stop") {
  const parts: string[] = [];
  let anyFailure = false;
  if (project.stopCommand && project.stopCommand.trim()) {
    const result = await execCapture(project.stopCommand.trim(), project.path, 120000);
    anyFailure = anyFailure || !result.ok;
    parts.push(`Stop command: ${result.ok ? "ok" : "failed"}\n${summarizeOutput(result.stdout, result.stderr)}`);
  }
  if (project.dockerComposeEnabled) {
    const result = await execCapture("docker compose down", project.path, 120000);
    anyFailure = anyFailure || !result.ok;
    parts.push(`Docker compose down: ${result.ok ? "ok" : "failed"}\n${summarizeOutput(result.stdout, result.stderr)}`);
  }
  if ((project.ports ?? []).length > 0) {
    for (const port of project.ports ?? []) {
      const pids = await findPortPids(port);
      for (const pid of pids) {
        const result = await execCapture(`taskkill /F /PID ${pid}`, process.cwd(), 5000);
        anyFailure = anyFailure || !result.ok;
        parts.push(`Port ${port}: ${result.ok ? "killed" : "failed"} PID ${pid}.`);
      }
      if (pids.length === 0) { parts.push(`Port ${port}: nothing listening.`); }
    }
  }
  if (parts.length === 0) {
    return finishLifecycle(project, actionId, operation, source, "failed", "Nothing to stop — configure a stop command, ports, or Docker Compose.", "", "", startedAt, {});
  }
  return finishLifecycle(project, actionId, operation, source, anyFailure ? "failed" : "success", anyFailure ? "Stop completed with some failures." : "Project stopped.", parts.join("\n\n"), "", startedAt, { ports: project.ports ?? [], dockerComposeEnabled: Boolean(project.dockerComposeEnabled) });
}

async function checkProjectHealth(project: DexNestProject, source: DexNestActionTrigger, actionId: string, startedAt: number) {
  const lines: string[] = [];
  let allOk = true;
  for (const port of project.ports ?? []) {
    const listening = await checkPortListening(port);
    allOk = allOk && listening;
    lines.push(`Port ${port}: ${listening ? "listening ✓" : "not responding ✗"}`);
  }
  if (project.healthUrl && project.healthUrl.trim()) {
    const health = await httpHealthCheck(project.healthUrl.trim());
    allOk = allOk && health.ok;
    lines.push(`Health ${project.healthUrl.trim()}: ${health.ok ? `ok (${health.status}) ✓` : `failed (${health.status ?? health.error}) ✗`}`);
  }
  for (const url of project.urls ?? []) {
    if (!isLocalUrl(url)) { continue; }
    const health = await httpHealthCheck(url);
    lines.push(`URL ${url}: ${health.ok ? `ok (${health.status}) ✓` : `down (${health.status ?? health.error}) ✗`}`);
  }
  if (lines.length === 0) {
    return finishLifecycle(project, actionId, "check_health", source, "failed", "No ports, health URL, or local URLs configured.", "", "", startedAt, {});
  }
  return finishLifecycle(project, actionId, "check_health", source, allOk ? "success" : "failed", allOk ? "All health checks passed." : "Some health checks failed.", lines.join("\n"), "", startedAt, { portCount: (project.ports ?? []).length, checkedUrl: Boolean(project.healthUrl) });
}

async function showProjectProcesses(project: DexNestProject, source: DexNestActionTrigger, actionId: string, startedAt: number) {
  const ports = project.ports ?? [];
  if (ports.length === 0) {
    return finishLifecycle(project, actionId, "show_processes", source, "failed", "No ports configured for this project.", "", "", startedAt, {});
  }
  const lines: string[] = [];
  let found = 0;
  for (const port of ports) {
    const pids = await findPortPids(port);
    if (pids.length === 0) { lines.push(`Port ${port}: free.`); continue; }
    for (const pid of pids) {
      const image = await processImageForPid(pid);
      found += 1;
      lines.push(`Port ${port}: PID ${pid} — ${image}`);
    }
  }
  return finishLifecycle(project, actionId, "show_processes", source, "success", `${found} process(es) on ${ports.join(", ")}.`, lines.join("\n"), "", startedAt, { ports, found });
}

function openProjectLogs(project: DexNestProject, source: DexNestActionTrigger, actionId: string, startedAt: number): Promise<ReturnType<typeof finishLifecycle>> | ReturnType<typeof finishLifecycle> {
  if (project.logPath && project.logPath.trim()) {
    void shell.openPath(project.logPath.trim());
    return finishLifecycle(project, actionId, "open_logs", source, "success", `Opened logs at ${project.logPath.trim()}.`, "", "", startedAt, { mode: "path" });
  }
  if (project.logCommand && project.logCommand.trim()) {
    return execCapture(project.logCommand.trim(), project.path, 60000).then((result) =>
      finishLifecycle(project, actionId, "open_logs", source, result.ok ? "success" : "failed", result.ok ? "Fetched project logs." : (result.error ?? "Log command failed."), result.stdout, result.stderr, startedAt, { mode: "command" })
    );
  }
  return finishLifecycle(project, actionId, "open_logs", source, "failed", "No log path or log command configured.", "", "", startedAt, {});
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

  if (operation === "open_urls") {
    const opened = (project.urls ?? []).filter((url) => isLocalUrl(url));
    opened.forEach((url) => void shell.openExternal(url));
    return finishLifecycle(project, actionId, "open_urls", source, opened.length > 0 ? "success" : "failed", opened.length > 0 ? `Opened ${opened.length} local URL(s).` : "No local URLs configured.", opened.join("\n"), "", Date.now(), { count: opened.length });
  }

  if (operation === "check_health") {
    return checkProjectHealth(project, source, actionId, Date.now());
  }

  if (operation === "show_processes") {
    return showProjectProcesses(project, source, actionId, Date.now());
  }

  if (operation === "open_logs") {
    return openProjectLogs(project, source, actionId, Date.now());
  }

  if (operation === "kill_ports") {
    return killProjectPorts(project, source, actionId, Date.now());
  }

  if (operation === "docker_down") {
    return dockerDownProject(project, source, actionId, Date.now());
  }

  if (operation === "stop") {
    return stopProject(project, source, actionId, Date.now());
  }

  if (operation === "restart") {
    const startedAt = Date.now();
    return stopProject(project, source, actionId, startedAt, "restart").then(async (stopResult) => {
      await new Promise((r) => setTimeout(r, 600));
      const startResult = await runProjectCommand(project, "start", source, true);
      const combinedStdout = `${stopResult.stdout}\n\n--- start ---\n${startResult.stdout}`;
      return finishLifecycle(project, actionId, "restart", source, startResult.ok ? "success" : "failed", startResult.ok ? "Project restarted." : "Restart failed during start.", combinedStdout, startResult.stderr, startedAt, { ports: project.ports ?? [] });
    });
  }

  if (operation.startsWith("run_")) {
    const commandKey = operation.replace("run_", "") as keyof DexNestProject["commands"];
    const params = typeof payload === "object" && payload !== null ? (payload as { confirmedDangerous?: boolean }) : {};
    return runProjectCommand(project, commandKey, source, params.confirmedDangerous);
  }

  return { ok: false, actionId, error: `Unsupported project operation: ${operation}` };
}

function startWindowsDictation(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, error: "Windows dictation shortcut is only available on Windows." });
  }

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DexNestKeyboard {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@
[DexNestKeyboard]::keybd_event(0x5B, 0, 0, 0)
[DexNestKeyboard]::keybd_event(0x48, 0, 0, 0)
Start-Sleep -Milliseconds 80
[DexNestKeyboard]::keybd_event(0x48, 0, 2, 0)
[DexNestKeyboard]::keybd_event(0x5B, 0, 2, 0)
`;

  return new Promise((resolvePromise) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 3000 },
      (error) => {
        if (error) {
          localDb.appendActionEvent({
            module: "DexNest Voice",
            actionId: "voice.start_dictation_placeholder",
            eventType: "voice_windows_dictation_failed",
            status: "failed",
            source: "module_ui",
            summary: "Failed to start Windows dictation shortcut.",
            metadataJson: {},
            errorMessage: error.message
          });
          resolvePromise({ ok: false, error: error.message });
          return;
        }

        localDb.appendActionEvent({
          module: "DexNest Voice",
          actionId: "voice.start_dictation_placeholder",
          eventType: "voice_windows_dictation_started",
          status: "success",
          source: "module_ui",
          summary: "Started Windows dictation shortcut from DexNest Mic button.",
          metadataJson: {}
        });
        resolvePromise({ ok: true });
      }
    );
  });
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

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const auth = authorizeControlEndpoint(request, url);
    if (!auth.ok) {
      sendJson(response, auth.statusCode, { ok: false, status: "failed", message: auth.error });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        status: "success",
        message: "DexNest Stream Deck control endpoint is running.",
        localOnly: !loadStreamDeckSettings().lanEnabled,
        tokenEnabled: loadStreamDeckSettings().tokenEnabled,
        lanEnabled: loadStreamDeckSettings().lanEnabled,
        baseUrl: `http://127.0.0.1:${actionPort}`,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/actions") {
      sendJson(response, 200, {
        ok: true,
        status: "success",
        message: "DexNest actions listed.",
        actions: [...actionRegistry.list(), ...getProjectActionDefinitions()].map(deckActionSummary)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/actions/pinned") {
      sendJson(response, 200, {
        ok: true,
        status: "success",
        message: "DexNest pinned actions listed.",
        actions: pinnedActionDetails()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/routines") {
      sendJson(response, 200, {
        ok: true,
        status: "success",
        message: "DexNest routines listed.",
        routines: loadRoutines().map((routine) => ({
          id: routine.id,
          name: routine.name,
          description: routine.description,
          enabled: routine.enabled,
          stepCount: routine.steps.length,
          lastRunAt: routine.lastRunAt ?? null,
          hasDangerousSteps: routineHasDangerousSteps(routine.id)
        }))
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/actions/run") {
      const startedAt = Date.now();
      const body = await readBody(request) as { actionId?: string; params?: unknown; confirmedDangerous?: boolean };
      const actionId = String(body.actionId ?? "");
      const action = findAction(actionId);
      if (!action) {
        sendJson(response, 404, { ok: false, status: "failed", actionId, message: "Action not found.", durationMs: Date.now() - startedAt });
        return;
      }
      const result = await runRegisteredAction(actionId, "stream_deck_http", { ...(typeof body.params === "object" && body.params !== null ? body.params as Record<string, unknown> : {}), confirmedDangerous: body.confirmedDangerous === true });
      sendJson(response, endpointStatusCode(result), safeEndpointResponse(result, startedAt, action));
      return;
    }

    if (request.method === "POST" && url.pathname === "/routines/run") {
      const startedAt = Date.now();
      const body = await readBody(request) as { routineId?: string; confirmedDangerous?: boolean };
      const routineId = String(body.routineId ?? "");
      if (routineHasDangerousSteps(routineId) && body.confirmedDangerous !== true) {
        sendJson(response, 409, { ok: false, status: "confirmation_required", actionId: "deck.routine.run", message: "Routine includes an action requiring confirmation. Open DexNest or pass confirmedDangerous after explicit confirmation.", durationMs: Date.now() - startedAt });
        return;
      }
      const result = await runRegisteredAction("deck.routine.run", "stream_deck_http", { routineId, confirmedDangerous: body.confirmedDangerous === true });
      sendJson(response, endpointStatusCode(result), safeEndpointResponse(result, startedAt, findAction("deck.routine.run")));
      return;
    }

    if (request.method === "POST" && url.pathname === "/performance/toggle") {
      const startedAt = Date.now();
      const current = performanceModeState();
      const result = setPerformanceModeEnabled(!current.enabled, "manual", "stream_deck_http");
      sendJson(response, 200, { ok: true, status: "success", actionId: "system.performance.toggle", message: `Performance Mode ${result.state.enabled ? "enabled" : "disabled"}.`, durationMs: Date.now() - startedAt });
      return;
    }

    if (request.method === "POST" && url.pathname === "/assistant/ask") {
      const startedAt = Date.now();
      askDexNestFromTray();
      localDb.appendActionEvent({
        module: "DexNest Assistant",
        actionId: "assistant.command_received",
        eventType: "assistant_stream_deck_opened",
        status: "success",
        source: "stream_deck_http",
        summary: "Opened Ask DexNest from Stream Deck endpoint.",
        metadataJson: {},
        durationMs: Date.now() - startedAt
      });
      sendJson(response, 200, { ok: true, status: "success", actionId: "assistant.command_received", message: "Ask DexNest opened. Open DexNest to view or enter sensitive results.", durationMs: Date.now() - startedAt });
      return;
    }

    if (request.method === "POST" && url.pathname === "/drop/send-clipboard") {
      const startedAt = Date.now();
      const action = findAction("drop.send_clipboard_to_drop");
      const payload = await readBody(request);
      const result = await runRegisteredAction("drop.send_clipboard_to_drop", "stream_deck_http", typeof payload === "object" && payload !== null ? payload : {});
      sendJson(response, endpointStatusCode(result), safeEndpointResponse(result, startedAt, action));
      return;
    }

    if (request.method === "POST" && url.pathname === "/sensitive/lock") {
      const startedAt = Date.now();
      lockSensitiveSessionFromTray();
      sendJson(response, 200, { ok: true, status: "success", actionId: "system.lifecycle.lock_sensitive_session", message: "Sensitive session locked.", durationMs: Date.now() - startedAt });
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
      const result = await runRegisteredAction(actionId, "stream_deck_http");
      sendJson(response, 404, result);
      return;
    }

    try {
      const startedAt = Date.now();
      const payload = await readBody(request);
      const result = await runRegisteredAction(actionId, "stream_deck_http", payload);
      sendJson(response, endpointStatusCode(result), safeEndpointResponse(result, startedAt, action));
    } catch (error) {
      logActionEvent(
        action,
        "failed",
        "stream_deck_http",
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

async function selectToolsFiles(kind: "pdf" | "image" | "any"): Promise<ToolsSelectedFile[]> {
  const filters = kind === "pdf"
    ? [{ name: "PDF files", extensions: ["pdf"] }]
    : kind === "image"
      ? [{ name: "Image files", extensions: ["png", "jpg", "jpeg", "webp"] }]
      : [{ name: "DexNest Tools files", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "mp4", "mov", "mkv", "mp3", "wav", "m4a", "docx", "pptx"] }];
  const options: OpenDialogOptions = {
    title: "Select DexNest Tools files",
    properties: ["openFile", "multiSelections"],
    filters
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled) {
    return [];
  }

  return result.filePaths.filter((filePath) => existsSync(filePath)).map(selectedFileMetadata);
}

async function selectVaultFiles(): Promise<ToolsSelectedFile[]> {
  const options: OpenDialogOptions = {
    title: "Select DexNest Vault documents",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Documents and files", extensions: ["pdf", "docx", "pptx", "png", "jpg", "jpeg", "webp", "txt", "md", "xlsx", "csv", "zip"] }]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled) {
    return [];
  }

  return result.filePaths.filter((filePath) => existsSync(filePath)).map(selectedFileMetadata);
}

async function selectFinanceReceipt(): Promise<ToolsSelectedFile[]> {
  const options: OpenDialogOptions = {
    title: "Select DexNest Finance receipt",
    properties: ["openFile"],
    filters: [{ name: "Receipt files", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "heic", "txt", "docx"] }]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled) {
    return [];
  }

  return result.filePaths.filter((filePath) => existsSync(filePath)).map(selectedFileMetadata);
}

async function selectCaptureFile(): Promise<ToolsSelectedFile[]> {
  const options: OpenDialogOptions = {
    title: "Select DexNest Capture file",
    properties: ["openFile"],
    filters: [{ name: "Capture files", extensions: ["pdf", "docx", "pptx", "png", "jpg", "jpeg", "webp", "heic", "txt", "md", "xlsx", "csv", "zip", "mp3", "wav", "m4a"] }]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled) {
    return [];
  }

  return result.filePaths.filter((filePath) => existsSync(filePath)).map(selectedFileMetadata);
}

async function chooseToolsOutputFolder(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const options: OpenDialogOptions = {
    title: "Choose DexNest Tools output folder",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  const selectedPath = result.canceled ? "" : result.filePaths[0];
  if (!selectedPath) {
    return { ok: false, error: "No folder selected." };
  }

  mkdirSync(selectedPath, { recursive: true });
  saveToolsSettings({ ...loadToolsSettings(), outputFolderPath: selectedPath });
  localDb.appendActionEvent({
    module: "DexNest Tools",
    actionId: "tools.output_folder_changed",
    eventType: "tools_output_folder_changed",
    status: "success",
    source: "module_ui",
    summary: "Changed DexNest Tools output folder.",
    metadataJson: { path: selectedPath }
  });
  return { ok: true, path: selectedPath };
}

function resetToolsOutputFolder(): { ok: boolean; path: string } {
  saveToolsSettings({ ...loadToolsSettings(), outputFolderPath: null });
  ensureToolsRoot();
  localDb.appendActionEvent({
    module: "DexNest Tools",
    actionId: "tools.output_folder_reset",
    eventType: "tools_output_folder_reset",
    status: "success",
    source: "module_ui",
    summary: "Reset DexNest Tools output folder.",
    metadataJson: { path: toolsOutputRoot }
  });
  return { ok: true, path: toolsOutputRoot };
}

function updateToolsSettings(input: Partial<ToolsSettings>): ToolsSettings {
  const nextSettings = saveToolsSettings({
    ...loadToolsSettings(),
    ffmpegPath: typeof input.ffmpegPath === "string" && input.ffmpegPath.trim() ? input.ffmpegPath.trim() : null,
    libreOfficePath: typeof input.libreOfficePath === "string" && input.libreOfficePath.trim() ? input.libreOfficePath.trim() : null,
    tesseractPath: typeof input.tesseractPath === "string" && input.tesseractPath.trim() ? input.tesseractPath.trim() : null,
    pythonPath: typeof input.pythonPath === "string" && input.pythonPath.trim() ? input.pythonPath.trim() : null,
    ocrEngine: safeOcrEngine(input.ocrEngine),
    ocrDevice: safeOcrDevice(input.ocrDevice),
    ocrLanguage: safeOcrLanguage(input.ocrLanguage)
  });

  localDb.appendActionEvent({
    module: "DexNest Tools",
    actionId: "tools.open_tools_settings",
    eventType: "tools_settings_updated",
    status: "success",
    source: "module_ui",
    summary: "Updated DexNest Tools dependency settings.",
    metadataJson: {
      hasFfmpegPath: Boolean(nextSettings.ffmpegPath),
      hasLibreOfficePath: Boolean(nextSettings.libreOfficePath),
      hasTesseractPath: Boolean(nextSettings.tesseractPath),
      hasPythonPath: Boolean(nextSettings.pythonPath),
      ocrEngine: nextSettings.ocrEngine,
      ocrDevice: nextSettings.ocrDevice,
      ocrLanguage: nextSettings.ocrLanguage
    }
  });

  return nextSettings;
}

function openToolsFile(filePath: string): { ok: boolean; error?: string } {
  if (!filePath || !existsSync(filePath)) {
    return { ok: false, error: "File not found." };
  }

  void shell.openPath(filePath);
  return { ok: true };
}

function shouldStartHiddenToTray(): boolean {
  const settings = loadAppLifecycleSettings();
  return process.argv.includes("--hidden") || settings.minimizeToTrayOnStartup;
}

function syncAppLifecycleLoginItemStatus(): void {
  const settings = loadAppLifecycleSettings();
  const next = settings.startDexNestWithWindows ? applyLoginItemSettings(settings) : { ...settings, ...currentLoginItemStatus() };
  writeJsonFile(appLifecycleSettingsPath, { ...next, updatedAt: settings.updatedAt });
}

function registerIpcHandlers(): void {
  ipcMain.on("dexnest:renderer-ready", () => {
    rendererReady = true;
    flushPendingOpenView();
  });

  ipcMain.handle("dexnest:get-app-info", () => {
    const commandSettings = loadCommandSettings();
    const lifecycle = appLifecycleState();
    return {
    appName: "DexNest",
    dataRoot: localDataRoot,
    dbPath: localDb.dbPath,
    actionEndpoint: `http://127.0.0.1:${actionPort}`,
    projectsConfigPath,
    commandSettingsPath,
    keyboardShortcutsPath,
    keyboardShortcutSettings: loadKeyboardShortcutSettings(),
    keyboardShortcutConflicts: shortcutConflictDetails(),
    streamDeckSettingsPath,
    streamDeckSettings: { ...loadStreamDeckSettings(), token: loadStreamDeckSettings().token ? "set" : "" },
    commandShortcutEnabled: commandSettings.globalShortcutEnabled,
    commandShortcut: commandSettings.globalShortcut,
    commandShortcutStatus: commandSettings.globalShortcutStatus,
    commandShortcutLastError: commandSettings.globalShortcutLastError,
    trayStatus: commandSettings.trayStatus,
    commandResultsPath,
    pinnedActionsPath,
    clipboardHistoryPath,
    clipboardSnippetsPath,
    clipboardSettingsPath,
    clipboardMultiGroupsPath,
    clipboardActiveMultiCopyPath,
    clipboardSlotsPath,
    dropShelfPath,
    dropIncomingPath,
    dropReceiveFolderPath: dropIncomingRoot,
    dropOutgoingFolderPath: dropOutgoingRoot,
    dropTempFolderPath: dropTempRoot,
    toolsInputFolderPath: toolsInputRoot,
    toolsOutputFolderPath: getToolsOutputFolder(),
    toolsDefaultOutputFolderPath: toolsOutputRoot,
    toolsTempFolderPath: toolsTempRoot,
    toolsOutputsPath,
    vaultDocumentsPath: vaultDocumentsRoot,
    vaultImportsPath: vaultImportsRoot,
    vaultVersionsPath: vaultVersionsRoot,
    vaultOcrOutputPath: vaultOcrRoot,
    vaultOcrJobsPath,
    vaultOcrSettingsPath,
    vaultMetadataPath: vaultDocumentsPath,
    searchIndexPath,
    searchIndexFolderPath: searchIndexRoot,
    savedSearchesPath,
    journalEntriesPath,
    calendarEventsPath,
    nudgesPath,
    nudgeSettingsPath,
    finderItemsPath,
    financeTransactionsPath,
    financeRecurringPath,
    financeSettingsPath,
    receiptsPath: receiptsRoot,
    captureItemsPath,
    capturesPath: capturesRoot,
    routinesPath,
    heatmapEventsPath,
    heatmapSettingsPath,
    heatmapGoalsPath,
    speechSettingsPath,
    voiceWorkflowSettingsPath,
    voiceWorkflowSettings: loadVoiceWorkflowSettings(),
    speechModelsRoot,
    speechDebugAudioRoot,
    speechState: speechServiceState(),
    ambientVoiceSettingsPath,
    ambientVoiceState: ambientVoiceState(),
    externalDevicesSettingsPath,
    externalDevicesCachePath,
    externalDevicesGroupsPath,
    externalDevicesState: externalDevicesState(),
    performanceModeSettingsPath,
    appLifecycleSettingsPath,
    appLifecycleSettings: lifecycle,
    performanceModeState: performanceModeState(),
    performanceModeSettings: loadPerformanceModeSettings(),
    backupFolderPath: backupsRoot,
    restoreStagingPath: restoreStagingRoot,
    packageMode: app.isPackaged ? "packaged" : "development",
    currentBranch: currentGitBranch(),
    localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localDateTimePreview: formatLocalDateTime(new Date()),
    localToday: getLocalTodayDateString(),
    dropLocalUrl: dropLocalUrl(),
    dropPhoneUrl: dropPhoneUrl(),
    lanIp: getLanIp(),
    projectCount: loadProjects().length,
    performanceMode: performanceModeState().enabled ? "Enabled" : "Not enabled"
    };
  });

  ipcMain.handle("dexnest:get-performance-mode-state", () => performanceModeState());
  ipcMain.handle("dexnest:get-performance-mode-settings", () => loadPerformanceModeSettings());
  ipcMain.handle("dexnest:save-performance-mode-settings", (_event, input: Partial<PerformanceModeSettings>) => {
    const settings = savePerformanceModeSettings(input ?? {});
    createDexNestTray();
    return { settings, state: performanceModeState() };
  });
  ipcMain.handle("dexnest:set-performance-mode-enabled", (_event, input: { enabled?: boolean; reason?: PerformanceModeReason }) =>
    setPerformanceModeEnabled(Boolean(input?.enabled), input?.reason ?? "manual", "module_ui")
  );

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

  ipcMain.handle("dexnest:get-tools-state", () => toolsState());

  ipcMain.handle("dexnest:get-vault-state", () => vaultState());

  ipcMain.handle("dexnest:get-search-state", () => searchState());

  ipcMain.handle("dexnest:get-journal-state", () => journalState());

  ipcMain.handle("dexnest:get-calendar-state", () => calendarState());

  ipcMain.handle("dexnest:get-finder-state", () => finderState());

  ipcMain.handle("dexnest:get-finance-state", () => financeState());

  ipcMain.handle("dexnest:get-capture-state", () => captureState());

  ipcMain.handle("dexnest:get-heatmap-state", () => heatmapState());

  ipcMain.handle("dexnest:get-routines-state", () => routinesState());

  ipcMain.handle("dexnest:get-backup-state", () => backupState());

  ipcMain.handle("dexnest:get-external-devices-state", () => externalDevicesState());

  ipcMain.handle("dexnest:get-data-management-state", () => dataManagementState());

  ipcMain.handle("dexnest:select-backup-zip", () => selectBackupZip());

  // Read-only: return the last cached result instantly. Checks run only via the
  // explicit `system.health.run_checks` action (Run checks button).
  ipcMain.handle("dexnest:get-app-health", () => cachedAppHealthState());

  ipcMain.handle("dexnest:get-command-stats", () => commandStats());

  ipcMain.handle("dexnest:select-tools-files", (_event, kind: "pdf" | "image" | "any") => selectToolsFiles(kind));

  ipcMain.handle("dexnest:select-vault-files", () => selectVaultFiles());

  ipcMain.handle("dexnest:select-finance-receipt", () => selectFinanceReceipt());

  ipcMain.handle("dexnest:select-capture-file", () => selectCaptureFile());

  ipcMain.handle("dexnest:get-pdf-info", (_event, paths: string[]) => getPdfInfo(paths));

  ipcMain.handle("dexnest:choose-tools-output-folder", () => chooseToolsOutputFolder());

  ipcMain.handle("dexnest:reset-tools-output-folder", () => resetToolsOutputFolder());

  ipcMain.handle("dexnest:save-tools-settings", (_event, input: Partial<ToolsSettings>) => updateToolsSettings(input));

  ipcMain.handle("dexnest:get-assistant-state", () => assistantState());
  ipcMain.handle("dexnest:save-assistant-settings", (_event, input: Partial<AssistantSettings>) => updateAssistantSettings(input));
  ipcMain.handle("dexnest:test-ollama", (_event, input: { ollamaUrl?: string; ollamaModel?: string }) => testOllamaConnection(input ?? {}));
  ipcMain.handle("dexnest:assistant-llm-intent", (_event, input: { query?: unknown }) => runOllamaIntent(input ?? {}));
  ipcMain.handle("dexnest:get-ambient-voice-state", () => ambientVoiceState());
  ipcMain.handle("dexnest:save-ambient-voice-settings", (_event, input: Partial<AmbientVoiceSettings>) => ({
    settings: saveAmbientVoiceSettings(input ?? {}, "module_ui"),
    state: ambientVoiceState()
  }));
  ipcMain.handle("dexnest:update-ambient-voice-state", (_event, input: Partial<Pick<AmbientVoiceState, "currentState" | "lastRecognizedCommand" | "lastActionResult" | "lastSource">>) =>
    updateAmbientVoiceRuntime(input ?? {}, (input?.lastSource as DexNestActionTrigger | undefined) ?? "module_ui")
  );
  ipcMain.handle("dexnest:start-ambient-listening", (_event, input: { source?: DexNestActionTrigger } = {}) => {
    requestAmbientListening(input.source ?? "module_ui");
    return ambientVoiceState();
  });
  ipcMain.handle("dexnest:get-speech-state", () => speechServiceState());
  ipcMain.handle("dexnest:get-voice-workflow-settings", () => loadVoiceWorkflowSettings());
  ipcMain.handle("dexnest:save-voice-workflow-settings", (_event, input: Partial<VoiceWorkflowSettings>) => saveVoiceWorkflowSettings(input ?? {}));
  ipcMain.handle("dexnest:save-speech-settings", (_event, input: Partial<SpeechSettings>) => ({
    settings: saveSpeechSettings(input ?? {}),
    speechState: speechServiceState()
  }));
  ipcMain.handle("dexnest:check-speech-model", async () => {
    const startedAt = Date.now();
    const status = await checkSpeechModel(false);
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId: "speech.check_model",
      eventType: "speech_model_checked",
      status: status.ok ? "success" : "failed",
      source: "module_ui",
      summary: status.ok ? "Checked DexNest speech model." : "DexNest speech model check failed.",
      metadataJson: {
        engine: status.engine,
        model: status.model,
        deviceDetected: status.deviceDetected,
        installed: status.installed,
        fasterWhisperAvailable: status.fasterWhisperAvailable
      },
      errorMessage: status.ok ? null : status.message,
      durationMs: Date.now() - startedAt
    });
    return { ok: status.ok, status, speechState: speechServiceState(status) };
  });
  ipcMain.handle("dexnest:install-speech-model", async () => {
    const startedAt = Date.now();
    const status = await checkSpeechModel(true);
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId: "speech.install_model",
      eventType: "speech_model_installed",
      status: status.ok ? "success" : "failed",
      source: "module_ui",
      summary: status.ok ? "Installed or verified DexNest speech model." : "DexNest speech model install failed.",
      metadataJson: {
        engine: status.engine,
        model: status.model,
        deviceDetected: status.deviceDetected,
        installed: status.installed,
        fasterWhisperAvailable: status.fasterWhisperAvailable
      },
      errorMessage: status.ok ? null : status.message,
      durationMs: Date.now() - startedAt
    });
    return { ok: status.ok, status, speechState: speechServiceState(status) };
  });
  ipcMain.handle("dexnest:open-speech-model-folder", () => {
    ensureSpeechRoot();
    void shell.openPath(speechModelsRoot);
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId: "speech.open_model_folder",
      eventType: "speech_model_folder_opened",
      status: "success",
      source: "module_ui",
      summary: "Opened DexNest speech model folder.",
      metadataJson: { modelRoot: speechModelsRoot }
    });
    return { ok: true, path: speechModelsRoot };
  });
  ipcMain.handle("dexnest:get-wake-engine-state", () => wakeEngineState());
  ipcMain.handle("dexnest:check-wake-engine", async () => {
    const result = await checkWakeEngine();
    return { ...result, state: wakeEngineState() };
  });
  ipcMain.handle("dexnest:start-wake-engine", () => {
    const result = startWakeEngine();
    return { ...result, state: wakeEngineState() };
  });
  ipcMain.handle("dexnest:stop-wake-engine", () => {
    stopWakeEngine();
    return { ok: true, state: wakeEngineState() };
  });

  // Desktop voice wave overlay (Phase 24.1) — passive display of voice state.
  ipcMain.on("dexnest:voice-overlay", (_event, payload: { type?: string; state?: string; level?: number } = {}) => {
    const settings = loadAmbientVoiceSettings();
    if (!(settings.voiceOverlayEnabled ?? true)) { hideVoiceOverlay(); return; }
    if (payload.type === "hide") { hideVoiceOverlay(); return; }
    if (payload.type === "level") { updateVoiceOverlay(payload); return; }
    // show / state / error
    showVoiceOverlay(payload);
  });

  ipcMain.handle("dexnest:warm-speech-engine", async () => {
    const warmResult = await warmSpeechEngine();
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId: "speech.warm_engine",
      eventType: warmResult.ok ? "speech_engine_warmed" : "speech_engine_warm_failed",
      status: warmResult.ok ? "success" : "failed",
      source: "module_ui",
      summary: warmResult.ok ? "Warmed the faster-whisper speech engine." : "Failed to warm the faster-whisper speech engine.",
      metadataJson: {
        engineState: warmResult.engineState,
        model: warmResult.diagnostics.model,
        device: warmResult.diagnostics.device,
        computeType: warmResult.diagnostics.computeType,
        loadLatencyMs: warmResult.diagnostics.loadLatencyMs
      },
      errorMessage: warmResult.ok ? null : (warmResult.error ?? "Warm failed.")
    });
    return { ...warmResult, speechState: speechServiceState() };
  });
  ipcMain.handle("dexnest:transcribe-speech", (_event, input: {
    audioBytes?: ArrayBuffer | Uint8Array | number[];
    mimeType?: string;
    source?: DexNestActionTrigger;
    sourceModule?: string;
    language?: string;
    manualOverride?: boolean;
  }) => transcribeSpeechAudio({
    audioBytes: input?.audioBytes,
    mimeType: input?.mimeType,
    source: input?.source ?? "module_ui",
    sourceModule: input?.sourceModule,
    language: input?.language,
    manualOverride: input?.manualOverride
  }));

  ipcMain.handle("dexnest:get-assistant-security-state", () => assistantSecurityState());
  ipcMain.handle("dexnest:save-assistant-security-settings", (_event, input: Partial<AssistantSecuritySettings>) => {
    const next = updateAssistantSecuritySettings(input ?? {});
    // Metadata only — never the password or any sensitive value.
    localDb.appendActionEvent({
      module: "DexNest Assistant",
      actionId: "assistant.update_security_settings",
      eventType: "assistant_security_settings_updated",
      status: "success",
      source: "module_ui",
      summary: "Updated DexNest Assistant trusted session settings.",
      metadataJson: {
        trustedSessionEnabled: next.trustedSessionEnabled,
        autoRevealWhileUnlocked: next.autoRevealWhileUnlocked,
        sessionTimeoutMinutes: next.sessionTimeoutMinutes,
        speakSensitiveAnswers: next.speakSensitiveAnswers,
        lockOnAppClose: next.lockOnAppClose
      }
    });
    return assistantSecurityState();
  });
  ipcMain.handle("dexnest:unlock-trusted-session", (_event, input: { masterPassword?: string }) => {
    // The master password is read here only to validate via Secure Vault and is
    // never stored or written to the audit log.
    const result = unlockTrustedSession(typeof input?.masterPassword === "string" ? input.masterPassword : undefined);
    const state = assistantSecurityState();
    localDb.appendActionEvent({
      module: "DexNest Assistant",
      actionId: "assistant.unlock_session",
      eventType: "assistant_sensitive_session_unlocked",
      status: result.ok ? "success" : "failed",
      source: "module_ui",
      summary: result.ok ? "Unlocked DexNest Assistant trusted session." : "Failed to unlock DexNest Assistant trusted session.",
      metadataJson: { sessionTimeoutMinutes: state.settings.sessionTimeoutMinutes, secureVaultUnlocked: state.secureVaultUnlocked },
      errorMessage: result.ok ? null : (result.error ?? "Unlock failed.")
    });
    return { ...result, state };
  });
  ipcMain.handle("dexnest:lock-trusted-session", () => {
    lockTrustedSession();
    localDb.appendActionEvent({
      module: "DexNest Assistant",
      actionId: "assistant.lock_session",
      eventType: "assistant_sensitive_session_locked",
      status: "success",
      source: "module_ui",
      summary: "Locked DexNest Assistant trusted session.",
      metadataJson: {}
    });
    return assistantSecurityState();
  });

  ipcMain.handle("dexnest:open-tools-file", (_event, filePath: string) => openToolsFile(filePath));

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

  ipcMain.handle("dexnest:start-windows-dictation", () => startWindowsDictation());

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

// --- Desktop ambient voice wave overlay (Phase 24.1) -----------------------
// A separate frameless, transparent, click-through, always-on-top window that
// shows a rainbow voice-wave visualizer at the bottom-centre of the primary
// display. It is purely a passive display of voice state — it never touches the
// speech/wake pipeline. Driven by IPC from the renderer's voice states.
let voiceOverlayWindow: BrowserWindow | null = null;
let voiceOverlayHideTimer: ReturnType<typeof setTimeout> | null = null;

function voiceOverlayHtml(): string {
  // Self-contained always-on-top "Listening" card — visually identical to the
  // in-app AssistantOrb (rainbow sphere + glow rings) so there is a single,
  // consistent indicator. Shown only while DexNest is listening AND hidden.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:Inter,system-ui,-apple-system,sans-serif;}
    #card{position:absolute;left:50%;bottom:10px;transform:translate(-50%,12px);display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 24px;border-radius:26px;border:1px solid rgba(99,102,241,0.28);background:rgba(10,10,12,0.86);box-shadow:0 16px 50px -12px rgba(99,102,241,0.5),inset 0 0 30px rgba(99,102,241,0.06);opacity:0;transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1),border-color .2s ease;}
    #card.show{opacity:1;transform:translate(-50%,0);}
    .orbwrap{position:relative;display:flex;align-items:center;justify-content:center;width:84px;height:84px;}
    .ring{position:absolute;width:67px;height:67px;border-radius:50%;border:1px solid rgba(99,102,241,0.4);animation:glowring 2.4s ease-out infinite;}
    .ring.r2{border-color:rgba(34,211,238,0.4);animation-delay:.6s;}
    .ring.r3{border-color:rgba(168,85,247,0.4);animation-delay:1.2s;}
    .orb{position:relative;width:58px;height:58px;border-radius:50%;overflow:hidden;background:#05070f;box-shadow:inset -6px -10px 22px rgba(0,0,0,0.55),0 0 38px rgba(99,102,241,0.4),0 0 22px rgba(34,211,238,0.3);}
    .rainbow{position:absolute;inset:-20%;border-radius:50%;background:conic-gradient(from 0deg,#FB4D6A,#FB923C,#FACC15,#4ADE80,#22D3EE,#6366F1,#A855F7,#FB4D6A);filter:blur(6px);opacity:.95;animation:spin 6s linear infinite;}
    .rainbow2{position:absolute;inset:-10%;border-radius:50%;background:conic-gradient(from 0deg,#FB4D6A,#FB923C,#FACC15,#4ADE80,#22D3EE,#6366F1,#A855F7,#FB4D6A);filter:blur(10px);opacity:.7;mix-blend-mode:screen;animation:spinrev 8s linear infinite;}
    .inner{position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 26px rgba(0,0,0,0.55);}
    .hl{position:absolute;left:20%;top:16%;width:22px;height:11px;border-radius:50%;background:rgba(255,255,255,0.45);filter:blur(3px);}
    .label{color:#c7c9ff;font-size:13px;font-weight:500;letter-spacing:.01em;}
    @keyframes spin{to{transform:rotate(360deg);}}
    @keyframes spinrev{to{transform:rotate(-360deg);}}
    @keyframes glowring{0%{transform:scale(.82);opacity:.7;}100%{transform:scale(1.5);opacity:0;}}
  </style></head><body>
    <div id="card">
      <div class="orbwrap">
        <span class="ring"></span><span class="ring r2"></span><span class="ring r3"></span>
        <div class="orb"><div class="rainbow"></div><div class="rainbow2"></div><div class="inner"></div><div class="hl"></div></div>
      </div>
      <div class="label">Listening…</div>
    </div>
  <script>
  (function(){
    var card=document.getElementById('card');
    if(window.dexNest&&window.dexNest.onVoiceOverlay){
      window.dexNest.onVoiceOverlay(function(p){
        if(!p)return;
        if(typeof p.animations==='boolean' && !p.animations){
          var st=document.createElement('style');st.textContent='.rainbow,.rainbow2,.ring{animation:none!important}';document.head.appendChild(st);
        }
        if(p.type==='level')return;
        if(p.type==='hide'||p.state==='done'||p.state==='transcribing'||p.state==='routing'||p.state==='speaking'){card.classList.remove('show');return;}
        card.classList.add('show');
      });
    }
  })();
  </script></body></html>`;
}

function voiceOverlayDimensions(): { width: number; height: number; margin: number } {
  const size = loadAmbientVoiceSettings().voiceOverlaySize ?? "compact";
  return size === "normal" ? { width: 200, height: 224, margin: 64 } : { width: 168, height: 188, margin: 56 };
}

function positionVoiceOverlay(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const dims = voiceOverlayDimensions();
  win.setBounds({
    width: dims.width,
    height: dims.height,
    x: Math.round(x + (width - dims.width) / 2),
    y: Math.round(y + height - dims.height - dims.margin)
  });
}

function ensureVoiceOverlayWindow(): BrowserWindow | null {
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
    return voiceOverlayWindow;
  }
  const dims = voiceOverlayDimensions();
  const win = new BrowserWindow({
    width: dims.width,
    height: dims.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    fullscreenable: false,
    acceptFirstMouse: false,
    webPreferences: {
      preload: join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "screen-saver");
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* platform dependent */ }
  positionVoiceOverlay(win);
  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(voiceOverlayHtml()));
  win.on("closed", () => { voiceOverlayWindow = null; });
  voiceOverlayWindow = win;
  return win;
}

function sendVoiceOverlay(win: BrowserWindow, payload: Record<string, unknown>): void {
  const dispatch = () => { if (!win.isDestroyed()) win.webContents.send("dexnest-overlay:update", payload); };
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", dispatch);
  } else {
    dispatch();
  }
}

function scheduleVoiceOverlayAutoHide(): void {
  if (voiceOverlayHideTimer) { clearTimeout(voiceOverlayHideTimer); }
  // Safety net: never let the overlay stay stuck if a "done" event is missed.
  voiceOverlayHideTimer = setTimeout(() => { hideVoiceOverlay(); }, 15000);
}

function showVoiceOverlay(payload: Record<string, unknown>): void {
  const settings = loadAmbientVoiceSettings();
  if (!(settings.voiceOverlayEnabled ?? true)) { hideVoiceOverlay(); return; }
  const win = ensureVoiceOverlayWindow();
  if (!win) { return; }
  positionVoiceOverlay(win);
  if (!win.isVisible()) { win.showInactive(); }
  sendVoiceOverlay(win, { ...payload, animations: settings.voiceOverlayAnimations ?? true });
  scheduleVoiceOverlayAutoHide();
}

function updateVoiceOverlay(payload: Record<string, unknown>): void {
  if (!voiceOverlayWindow || voiceOverlayWindow.isDestroyed() || !voiceOverlayWindow.isVisible()) {
    if (payload.type === "level") { return; }
    showVoiceOverlay(payload);
    return;
  }
  sendVoiceOverlay(voiceOverlayWindow, payload);
  if (payload.type !== "level") { scheduleVoiceOverlayAutoHide(); }
}

function hideVoiceOverlay(): void {
  if (voiceOverlayHideTimer) { clearTimeout(voiceOverlayHideTimer); voiceOverlayHideTimer = null; }
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
    sendVoiceOverlay(voiceOverlayWindow, { type: "hide" });
    // Let the fade-out animation play, then actually hide the window so it stops rendering.
    const win = voiceOverlayWindow;
    setTimeout(() => { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); }, 500);
  }
}

function destroyVoiceOverlay(): void {
  if (voiceOverlayHideTimer) { clearTimeout(voiceOverlayHideTimer); voiceOverlayHideTimer = null; }
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
    voiceOverlayWindow.destroy();
  }
  voiceOverlayWindow = null;
}

function createWindow(): void {
  const startHidden = shouldStartHiddenToTray();
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "DexNest",
    show: !startHidden,
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

  mainWindow.on("close", (event) => {
    if (isQuittingDexNest) {
      return;
    }
    event.preventDefault();
    void handleWindowCloseRequest();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });

  if (startHidden) {
    mainWindow.once("ready-to-show", () => {
      trayModeActive = true;
    });
  }
}

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    focusDexNestWindow("command", "system");
    localDb.appendActionEvent({
      module: "DexNest System",
      actionId: "system.lifecycle.second_instance",
      eventType: "second_instance_focused",
      status: "success",
      source: "system",
      summary: "Focused the existing DexNest instance instead of opening a duplicate.",
      metadataJson: {}
    });
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    return;
  }
  localDb.initialize();
  ensureDropRoot();
  ensureToolsRoot();
  ensureVaultRoot();
  ensureFinanceRoot();
  ensureCaptureRoot();
  ensureSearchRoot();
  ensureSpeechRoot();
  ensureBackupRoot();
  registerIpcHandlers();
  syncAppLifecycleLoginItemStatus();
  cleanupClipboardHistory(false, "system");
  startActionEndpoint();
  refreshNudges("system", false);
  startHeatmapTimer();
  startClipboardListener();
  registerClipboardHotkey();
  reconcileSlotHook();
  registerAmbientVoiceShortcut();
  scheduleActiveMultiCopyAutoClear();
  createWindow();
    registerCommandShortcut();
    registerKeyboardShortcuts();
    createDexNestTray();
  if (shouldStartHiddenToTray()) {
    trayModeActive = true;
  }

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
  isQuittingDexNest = true;
  // Full quit always clears the in-memory Secure Vault key + trusted session.
  lockSecureVault();
  lockTrustedSession();
  stopSpeechWorker();
  stopWakeEngine();
  destroyVoiceOverlay();
  stopHeatmapTimer();
  stopClipboardListener();
  unregisterClipboardHotkey();
  unregisterAmbientVoiceShortcut();
  unregisterCommandShortcut();
  unregisterKeyboardShortcuts();
  stopSlotHook();
  stopArmedMultiCopyPasteDetection();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (clipboardMultiCopyTimeoutTimer) {
    clearTimeout(clipboardMultiCopyTimeoutTimer);
    clipboardMultiCopyTimeoutTimer = null;
  }
  actionServer?.close();
  localDb.close();
});
