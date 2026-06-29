import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { formatLocalDate, formatLocalDateTime, getLocalTodayDateString, parseLocalDateInput, resolveRelativeLocalDate, toLocalDateInputValue } from "@dexnest/shared-types";
import "@dexnest/shared-ui/tokens.css";
import "./styles.css";

type ViewId = "command" | "dev" | "deck" | "clipboard" | "drop" | "tools" | "vault" | "search" | "capture" | "journal" | "calendar" | "finder" | "finance" | "heatmap" | "audit" | "settings";
type ActionStatus = "success" | "failed" | "skipped" | "cancelled" | "pending";
type ToastTone = "success" | "error";
type AppCloseBehavior = "minimize_to_tray" | "ask" | "exit";
type AmbientVoiceStatus = "idle" | "listening" | "processing" | "speaking" | "paused";
type SpeechEngine = "faster_whisper" | "whisper_cpp" | "windows_fallback";
type SpeechDevice = "auto" | "cuda" | "cpu";
type SpeechComputeType = "auto" | "int8" | "float16";
type SpeechStatus = "success" | "failed" | "cancelled";

interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}

interface AppInfo {
  appName: string;
  dataRoot: string;
  dbPath: string;
  actionEndpoint: string;
  projectsConfigPath: string;
  commandSettingsPath: string;
  keyboardShortcutsPath: string;
  keyboardShortcutSettings: KeyboardShortcutSettings;
  keyboardShortcutConflicts: string[];
  streamDeckSettingsPath: string;
  streamDeckSettings: StreamDeckSettings;
  commandShortcutEnabled: boolean;
  commandShortcut: string;
  commandShortcutStatus: "active" | "disabled" | "failed";
  commandShortcutLastError: string | null;
  trayStatus: "active" | "failed";
  commandResultsPath: string;
  pinnedActionsPath: string;
  clipboardHistoryPath: string;
  clipboardSnippetsPath: string;
  clipboardSettingsPath: string;
  clipboardMultiGroupsPath: string;
  clipboardActiveMultiCopyPath: string;
  clipboardSlotsPath: string;
  dropShelfPath: string;
  dropIncomingPath: string;
  dropReceiveFolderPath: string;
  dropOutgoingFolderPath: string;
  dropTempFolderPath: string;
  toolsInputFolderPath: string;
  toolsOutputFolderPath: string;
  toolsDefaultOutputFolderPath: string;
  toolsTempFolderPath: string;
  toolsOutputsPath: string;
  vaultDocumentsPath: string;
  vaultImportsPath: string;
  vaultVersionsPath: string;
  vaultOcrOutputPath: string;
  vaultOcrJobsPath: string;
  vaultOcrSettingsPath: string;
  vaultMetadataPath: string;
  searchIndexPath: string;
  searchIndexFolderPath: string;
  savedSearchesPath: string;
  journalEntriesPath: string;
  calendarEventsPath: string;
  nudgesPath: string;
  nudgeSettingsPath: string;
  finderItemsPath: string;
  financeTransactionsPath: string;
  financeRecurringPath: string;
  financeSettingsPath: string;
  receiptsPath: string;
  captureItemsPath: string;
  capturesPath: string;
  routinesPath: string;
  heatmapEventsPath: string;
  heatmapSettingsPath: string;
  heatmapGoalsPath: string;
  speechSettingsPath: string;
  voiceWorkflowSettingsPath: string;
  voiceWorkflowSettings: VoiceWorkflowSettings;
  speechModelsRoot: string;
  speechDebugAudioRoot: string;
  speechState: SpeechServiceState;
  ambientVoiceSettingsPath: string;
  ambientVoiceState: AmbientVoiceState;
  externalDevicesSettingsPath: string;
  externalDevicesCachePath: string;
  externalDevicesGroupsPath: string;
  externalDevicesState: ExternalDevicesState;
  performanceModeSettingsPath: string;
  appLifecycleSettingsPath: string;
  appLifecycleSettings: AppLifecycleSettings;
  performanceModeState: PerformanceModeState;
  performanceModeSettings: PerformanceModeSettings;
  backupFolderPath: string;
  restoreStagingPath: string;
  packageMode: string;
  currentBranch: string;
  localTimeZone: string;
  localDateTimePreview: string;
  localToday: string;
  dropLocalUrl: string;
  dropPhoneUrl: string;
  lanIp: string | null;
  projectCount: number;
  performanceMode: string;
}

interface ActionDefinition {
  id: string;
  title: string;
  module: string;
  moduleId: string;
  description: string;
  category: string;
  dangerLevel: string;
  requiresConfirmation: boolean;
  handlerType: string;
  handlerRef: string;
  allowedTriggers: string[];
  reversible: boolean;
  enabled: boolean;
  status: string;
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

interface AmbientVoiceSettings {
  ambientVoiceEnabled: boolean;
  wakeWordEnabled: boolean;
  wakeWord: string;
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
  wakeChimeEnabled?: boolean;
  wakeChimeVolume?: number;
  voiceOverlayEnabled?: boolean;
  voiceOverlayScreen?: string;
  voiceOverlayPosition?: string;
  voiceOverlaySize?: "compact" | "normal";
  voiceOverlayAnimations?: boolean;
  voiceName?: string | null;
  voiceRate: number;
  voiceVolume: number;
  shortResponsesOnly: boolean;
  muteInPerformanceMode: boolean;
  maxListeningSeconds: number;
  commandCooldownMs: number;
  updatedAt: string;
}

interface AmbientVoiceState {
  settingsPath: string;
  settings: AmbientVoiceSettings;
  currentState: AmbientVoiceStatus;
  lastRecognizedCommand: string;
  lastActionResult: string;
  lastSource: string;
  lastChangedAt: string;
  pausedByPerformanceMode: boolean;
  wakeWordStatus: "placeholder" | "disabled";
}

interface SpeechSettings {
  speechEngine: SpeechEngine;
  fallbackToWindows: boolean;
  modelName: string;
  modelSizeOptions: string[];
  device: SpeechDevice;
  computeType: SpeechComputeType;
  maxRecordingSeconds: number;
  silenceStopEnabled: boolean;
  vadEnabled: boolean;
  initialSilenceTimeoutMs?: number;
  endSilenceTimeoutMs?: number;
  minSpeechMs?: number;
  silenceThreshold?: number | "auto";
  autoStopOnSilence?: boolean;
  micPrewarmEnabled?: boolean;
  keepSpeechModelWarm?: boolean;
  selectedInputDeviceId?: string | null;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  vadMode?: "auto" | "manual";
  noiseFloor?: number;
  speechThresholdMargin?: number;
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

type VadStopReason = "stopped_by_silence" | "stopped_by_timeout" | "stopped_by_max_recording" | "no_speech" | "stopped_by_post_speech_window";

interface SpeechCaptureMetrics {
  micClickToRecordingMs: number;
  recordingDurationMs: number;
  speechDetectedAtMs: number | null;
  silenceStopDelayMs: number | null;
  transcriptionLatencyMs?: number;
  routingLatencyMs?: number;
  actionLatencyMs?: number;
  vadOutcome: "speech" | "no_speech" | "max_recording";
  stopReason?: VadStopReason;
  noiseFloor?: number;
  speechThreshold?: number;
  wakeToRecordingStartMs?: number | null;
  wakeToSearchNavigationMs?: number | null;
  ttsAttempted?: boolean;
  ttsSpoken?: boolean;
  ttsBlockedReason?: string;
}

interface TtsDiagnostics {
  available: boolean;
  voicesCount: number;
  selectedVoice: string;
  lastAttemptedAt: string | null;
  lastSpoken: boolean;
  blockedReason: string;
  error: string;
  lastSource: string;
  lastActionId: string;
  lastTextPreview: string;
}

interface QueuedAssistantCommand {
  id: string;
  text: string;
  source: string;
  metrics?: Partial<SpeechCaptureMetrics>;
}

// Live VAD meter for diagnostics (mic level + threshold + state).
interface VadLiveMeter {
  level: number;
  noiseFloor: number;
  speechThreshold: number;
  state: "idle" | "waiting" | "speech_detected" | "silence" | "stopped_by_silence" | "stopped_by_timeout";
}

// --- Lightweight renderer performance instrumentation (Phase 23.12) ---------
// Records the most recent module-switch render time (to first paint) so it can
// be shown in Settings diagnostics. Module-level + subscribe so it never causes
// the whole App to re-render on every measurement.
interface PerfStats {
  lastModule: string;
  lastModuleSwitchMs: number | null;
  worstModuleSwitchMs: number | null;
}
let perfStats: PerfStats = { lastModule: "", lastModuleSwitchMs: null, worstModuleSwitchMs: null };
const perfListeners = new Set<() => void>();
function getPerfStats(): PerfStats { return perfStats; }
function subscribePerf(listener: () => void): () => void { perfListeners.add(listener); return () => perfListeners.delete(listener); }
function recordModuleSwitch(view: string, ms: number): void {
  const rounded = Math.round(ms);
  perfStats = {
    lastModule: view,
    lastModuleSwitchMs: rounded,
    worstModuleSwitchMs: Math.max(rounded, perfStats.worstModuleSwitchMs ?? 0)
  };
  for (const listener of perfListeners) { listener(); }
}

let vadLiveMeter: VadLiveMeter = { level: 0, noiseFloor: 0, speechThreshold: 0.03, state: "idle" };
const vadMeterListeners = new Set<() => void>();
function getVadLiveMeter(): VadLiveMeter { return { ...vadLiveMeter }; }
function subscribeVadMeter(listener: () => void): () => void { vadMeterListeners.add(listener); return () => vadMeterListeners.delete(listener); }
function setVadLiveMeter(patch: Partial<VadLiveMeter>): void {
  vadLiveMeter = { ...vadLiveMeter, ...patch };
  for (const listener of vadMeterListeners) { listener(); }
}

// --- Renderer microphone pre-warm manager (Phase 23A.1) --------------------
// Holds a MediaStream + AudioContext ready so a mic click starts recording in
// <150ms instead of waiting for getUserMedia. Only ever initialized on an
// explicit trigger (settings open / mic click), never silently in the
// background, and released when Performance Mode blocks speech.
type MicStreamStatus = "unavailable" | "requesting" | "ready" | "recording" | "blocked" | "error";

interface MicWarmState {
  permission: "unknown" | "granted" | "denied" | "prompt";
  streamStatus: MicStreamStatus;
  audioContextStatus: AudioContextState | "none";
  lastStartLatencyMs: number | null;
  error: string | null;
}

const micWarm: { stream: MediaStream | null; audioContext: AudioContext | null; state: MicWarmState } = {
  stream: null,
  audioContext: null,
  state: {
    permission: "unknown",
    streamStatus: "unavailable",
    audioContextStatus: "none",
    lastStartLatencyMs: null,
    error: null
  }
};
const micWarmListeners = new Set<() => void>();

function getMicWarmState(): MicWarmState {
  return { ...micWarm.state };
}

function subscribeMicWarm(listener: () => void): () => void {
  micWarmListeners.add(listener);
  return () => micWarmListeners.delete(listener);
}

function setMicWarmState(patch: Partial<MicWarmState>): void {
  micWarm.state = { ...micWarm.state, ...patch };
  for (const listener of micWarmListeners) {
    listener();
  }
}

async function refreshMicPermission(): Promise<void> {
  try {
    const status = await (navigator.permissions?.query?.({ name: "microphone" as PermissionName }));
    if (status) {
      setMicWarmState({ permission: status.state as MicWarmState["permission"] });
    }
  } catch {
    // permissions API may not support "microphone" — leave as-is.
  }
}

// Pre-warm the mic stream + AudioContext. Safe to call repeatedly; no-op when
// already ready. Returns true when the stream is ready to record.
// Build audio constraints from settings: selected input device + WebRTC noise
// suppression / echo cancellation / auto gain (all default on).
function micAudioConstraints(settings?: SpeechSettings): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    noiseSuppression: settings?.noiseSuppression !== false,
    echoCancellation: settings?.echoCancellation !== false,
    autoGainControl: settings?.autoGainControl !== false
  };
  if (settings?.selectedInputDeviceId) {
    constraints.deviceId = { exact: settings.selectedInputDeviceId };
  }
  return constraints;
}

function micConstraintKey(settings?: SpeechSettings): string {
  return `${settings?.selectedInputDeviceId ?? "default"}|${settings?.noiseSuppression !== false}|${settings?.echoCancellation !== false}|${settings?.autoGainControl !== false}`;
}

let micActiveConstraintKey = "";

async function prewarmMic(settings?: SpeechSettings): Promise<boolean> {
  const key = micConstraintKey(settings);
  // Re-acquire when the device or audio constraints changed.
  if (settings && key !== micActiveConstraintKey && micWarm.stream) {
    micWarm.stream.getTracks().forEach((track) => track.stop());
    micWarm.stream = null;
  }
  if (micWarm.stream && micWarm.stream.getAudioTracks().some((track) => track.readyState === "live")) {
    setMicWarmState({ streamStatus: "ready" });
    return true;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setMicWarmState({ streamStatus: "unavailable", error: "Microphone recording is not available in this renderer." });
    return false;
  }
  setMicWarmState({ streamStatus: "requesting", error: null });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: settings ? micAudioConstraints(settings) : true });
    micActiveConstraintKey = key;
    micWarm.stream = stream;
    if (!micWarm.audioContext || micWarm.audioContext.state === "closed") {
      micWarm.audioContext = new AudioContext();
    }
    if (micWarm.audioContext.state === "suspended") {
      await micWarm.audioContext.resume().catch(() => undefined);
    }
    setMicWarmState({ streamStatus: "ready", permission: "granted", audioContextStatus: micWarm.audioContext.state, error: null });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microphone permission was not granted.";
    setMicWarmState({ streamStatus: "error", permission: /denied|notallowed/i.test(message) ? "denied" : micWarm.state.permission, error: message });
    return false;
  }
}

// Release the mic stream + AudioContext (e.g. Performance Mode blocks speech).
function releaseMic(blocked = false): void {
  if (micWarm.stream) {
    micWarm.stream.getTracks().forEach((track) => track.stop());
    micWarm.stream = null;
  }
  if (micWarm.audioContext && micWarm.audioContext.state !== "closed") {
    void micWarm.audioContext.close().catch(() => undefined);
  }
  micWarm.audioContext = null;
  setMicWarmState({ streamStatus: blocked ? "blocked" : "unavailable", audioContextStatus: "closed" });
}

// List audio input devices (labels need an active permission/stream).
async function listAudioInputDevices(): Promise<{ deviceId: string; label: string }[]> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    if (!micWarm.stream) {
      await prewarmMic();
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${device.deviceId.slice(0, 6)}` }));
  } catch {
    return [];
  }
}

// Listen silently for `durationMs` and return the average RMS noise floor.
async function calibrateNoiseFloor(settings: SpeechSettings, durationMs = 2000): Promise<number> {
  const ready = await prewarmMic(settings);
  if (!ready || !micWarm.stream) {
    throw new Error("Microphone is not available for calibration.");
  }
  const ctx = micWarm.audioContext ?? new AudioContext();
  micWarm.audioContext = ctx;
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => undefined);
  }
  const source = ctx.createMediaStreamSource(micWarm.stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let sum = 0;
  let frames = 0;
  const started = Date.now();
  return new Promise<number>((resolve) => {
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((total, value) => {
        const normalized = (value - 128) / 128;
        return total + normalized * normalized;
      }, 0) / data.length);
      sum += rms;
      frames += 1;
      setVadLiveMeter({ level: Number(rms.toFixed(4)), state: "waiting" });
      if (Date.now() - started > durationMs) {
        window.clearInterval(timer);
        try { source.disconnect(); } catch { /* ignore */ }
        setVadLiveMeter({ state: "idle" });
        resolve(Number((sum / Math.max(1, frames)).toFixed(4)));
      }
    }, 60);
  });
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

interface SpeechWorkerDiagnostics {
  engine: string;
  model: string;
  device: string;
  computeType: string;
  loadLatencyMs: number | null;
  lastTranscriptionMs: number | null;
  lastError: string | null;
}

interface SpeechServiceState {
  settingsPath: string;
  modelRoot: string;
  debugAudioRoot: string;
  settings: SpeechSettings;
  modelStatus: SpeechModelStatus;
  windowsFallbackAvailable: boolean;
  performancePaused: boolean;
  engineState?: string;
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
  speechState?: SpeechServiceState;
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
  apiKeyInKeychain?: boolean;
  keychainStorageMethod?: "electron_safeStorage" | "windows_dpapi" | "dev_insecure" | null;
  keychainAvailable?: boolean;
  hasLegacyVaultKey?: boolean;
  providerStatus: "disabled" | "ready" | "needs_secure_vault" | "locked" | "missing_api_key";
  providerMessage: string;
  devices: ExternalDeviceCacheItem[];
  groups: ExternalDeviceGroup[];
}

interface EventEntry {
  id: string;
  type: string;
  source: string;
  payload: unknown;
  createdAt: string;
  timestamp: string;
  module: string;
  actionId?: string;
  eventType: string;
  status: ActionStatus;
  summary: string;
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
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
}

interface ProjectFormState {
  id?: string;
  name: string;
  path: string;
  description: string;
  accent: string;
  start: string;
  build: string;
  test: string;
  typecheck: string;
  custom: string;
  urls: string;
  notes: string;
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

interface ClipboardState {
  history: ClipboardHistoryItem[];
  snippets: ClipboardSnippet[];
  settings: {
    listenerEnabled: boolean;
    listenerIntervalMs: number;
    historyRetentionDays: 1 | 3 | 7 | 30 | "never";
    lastHistoryCleanupAt: string | null;
    multiCopyHotkeyEnabled: boolean;
    multiCopyHotkey: string;
    multiCopyHotkeyStatus: "active" | "disabled" | "failed";
    multiCopyHotkeyLastError: string | null;
    multiCopyHotkeyRegistered: boolean;
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
      updatedAt: string;
      armedForPasteAt?: string | null;
      completedAt?: string | null;
      items: ClipboardHistoryItem[];
    } | null;
    appExclusionRules: string[];
    secretProtectionEnabled: boolean;
  };
  multiGroups: Array<{
    id: string;
    name: string;
    items: ClipboardHistoryItem[];
    createdAt: string;
    updatedAt: string;
  }>;
  slots: Array<{
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
  }>;
  snippetsPath: string;
  historyPath: string;
  settingsPath: string;
  multiGroupsPath: string;
  activeMultiCopyPath: string;
  slotsPath: string;
}

interface DropShelfItem {
  id: string;
  type: "text" | "file";
  text?: string;
  preview?: string;
  fileName?: string;
  originalName?: string;
  path?: string;
  byteLength: number;
  source: "manual" | "clipboard" | "phone" | "desktop";
  direction: "outgoing" | "incoming";
  createdAt: string;
  expiresAt: string | null;
}

interface DropState {
  shelf: DropShelfItem[];
  outgoing: DropShelfItem[];
  outgoingText: DropShelfItem[];
  outgoingFiles: DropShelfItem[];
  incoming: DropShelfItem[];
  shelfPath: string;
  incomingPath: string;
  receiveFolderPath: string;
  defaultReceiveFolderPath: string;
  customReceiveFolderPath: string | null;
  outgoingFolderPath: string;
  tempFolderPath: string;
  localUrl: string;
  phoneUrl: string;
  lanIp: string | null;
}

interface ToolsSelectedFile {
  path: string;
  name: string;
  byteLength: number;
  extension: string;
}

interface ToolsOutputItem {
  id: string;
  fileName: string;
  path: string;
  byteLength: number;
  operation: string;
  createdAt: string;
}

interface ToolsState {
  selectedFiles: ToolsSelectedFile[];
  outputs: ToolsOutputItem[];
  inputFolderPath: string;
  outputFolderPath: string;
  defaultOutputFolderPath: string;
  customOutputFolderPath: string | null;
  ffmpegPath: string | null;
  detectedFfmpegPath: string | null;
  libreOfficePath: string | null;
  detectedLibreOfficePath: string | null;
  tesseractPath: string | null;
  detectedTesseractPath: string | null;
  pythonPath: string | null;
  detectedPythonPath: string | null;
  ocrEngine: "tesseract" | "paddleocr" | "easyocr_placeholder";
  ocrDevice: "gpu" | "cpu";
  ocrLanguage: string;
  tempFolderPath: string;
  outputsPath: string;
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

type SecureVaultItemType = "password" | "api_key" | "token" | "recovery_code" | "private_note" | "server" | "other";

interface SecureVaultItem {
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
  itemTypes: SecureVaultItemType[];
  items: SecureVaultItem[];
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
  createdAt: string;
  updatedAt: string;
  indexedAt: string;
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
  sourceType?: string;
  sourceDocumentTitle: string;
  sourceFilePath?: string | null;
  ocrTextPath?: string | null;
  preview: string;
  score: number;
  autoRevealed?: boolean;
}

type VoiceIntentName =
  | "smart_lookup"
  | "calendar_create_candidate"
  | "calendar_show_today"
  | "calendar_show_upcoming"
  | "finder_search"
  | "finder_add"
  | "finder_reverse_lookup"
  | "drop_send_clipboard"
  | "open_module"
  | "dev_run_command"
  | "journal_open_today"
  | "search_query"
  | "capture_note"
  | "external_device_control"
  | "performance_mode"
  | "security_action"
  | "unknown";

type VoiceConfidence = "high" | "medium" | "low";
type VoiceSensitivity = "none" | "personal" | "sensitive";

interface VoiceRouteResult {
  intent: VoiceIntentName;
  targetModule: string;
  actionId?: string;
  params: Record<string, unknown>;
  confidence: VoiceConfidence;
  requiresConfirmation: boolean;
  sensitivity: VoiceSensitivity;
  explanation: string;
  suggestions?: string[];
}

type AssistantRouterUsed = "fast_path" | "rules" | "local-llm" | "fallback";

interface AssistantSettings {
  localIntentEngineEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  fallbackToRules: boolean;
}

interface AssistantSecuritySettings {
  trustedSessionEnabled: boolean;
  autoRevealWhileUnlocked: boolean;
  sessionTimeoutMinutes: number;
  speakSensitiveAnswers: boolean;
  lockOnAppClose: boolean;
}

interface AssistantSecurityState {
  settings: AssistantSecuritySettings;
  sessionUnlocked: boolean;
  sessionExpiresAt: number | null;
  secureVaultUnlocked: boolean;
  secureVaultSetup: boolean;
}

interface AppLifecycleSettings {
  closeBehavior: AppCloseBehavior;
  showTrayCloseNotice: boolean;
  minimizeToTrayOnStartup: boolean;
  startDexNestWithWindows: boolean;
  startMinimizedToTray: boolean;
  loginItemStatus: "enabled" | "disabled" | "failed";
  loginItemLastError: string | null;
  updatedAt: string;
  trayAvailable: boolean;
  trayModeActive: boolean;
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

interface StreamDeckSettings {
  localOnly: boolean;
  lanEnabled: boolean;
  tokenEnabled: boolean;
  token: string;
  updatedAt: string;
}

type PerformanceModeReason = "manual" | "fullscreen" | "game-detected" | "scheduled" | "unknown";

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

interface AssistantChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  // Assistant-only routing context (shown under Advanced/Debug).
  route?: VoiceRouteResult;
  routerUsed?: AssistantRouterUsed;
  awaitingConfirm?: boolean;
  resolved?: "ran" | "cancelled" | "failed" | "info" | "blocked";
  smartResults?: SmartLookupResult[];
  searchResults?: SearchResult[];
  finderResults?: FinderItem[];
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

interface SearchState {
  index: SearchIndexRecord[];
  savedSearches: SavedSearch[];
  indexPath: string;
  indexFolderPath: string;
  indexStatusPath: string;
  indexStatus: SearchIndexStatus;
  savedSearchesPath: string;
  resultCount: number;
  ocrTextFileCount: number;
  sources: string[];
  fileTypes: string[];
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

interface JournalState {
  entries: JournalEntry[];
  todayEntry: JournalEntry | null;
  entriesPath: string;
  today: string;
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

type NudgePriority = "soft" | "normal" | "urgent";
type NudgeStatus = "active" | "dismissed" | "snoozed" | "completed";

interface Nudge {
  id: string;
  title: string;
  message: string;
  sourceModule: string;
  sourceId?: string | null;
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

interface CalendarState {
  events: CalendarEvent[];
  today: string;
  todayEvents: CalendarEvent[];
  upcomingEvents: CalendarEvent[];
  eventsPath: string;
  nudges: Nudge[];
  todayNudges: Nudge[];
  upcomingNudges: Nudge[];
  urgentNudges: Nudge[];
  nudgesPath: string;
  nudgeSettingsPath: string;
  nudgeSettings: NudgeSettings;
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

interface FinderState {
  items: FinderItem[];
  itemsPath: string;
  statusCounts: Record<FinderItemStatus, number>;
}

type FinancePaymentType = "cash" | "debit" | "credit" | "e_transfer" | "other";
type FinanceRecurringFrequency = "monthly" | "yearly" | "weekly" | "custom";

interface FinanceTransaction {
  id: string;
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

interface FinanceRecurringExpense {
  id: string;
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

interface FinanceSummary {
  currentMonth: string;
  previousMonth: string;
  currentMonthTotal: number;
  previousMonthTotal: number;
  categoryTotals: Record<string, number>;
  paymentTypeTotals: Record<string, number>;
  cashTotal: number;
  cardTotal: number;
  transactionCount: number;
}

interface FinanceState {
  transactions: FinanceTransaction[];
  recurring: FinanceRecurringExpense[];
  settings: { defaultCurrency: string; receiptsPath: string };
  transactionsPath: string;
  recurringPath: string;
  settingsPath: string;
  receiptsPath: string;
  summary: FinanceSummary;
  deadlines: {
    returns7: FinanceTransaction[];
    returns30: FinanceTransaction[];
    warranties90: FinanceTransaction[];
    expiredReturns: FinanceTransaction[];
  };
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

interface CaptureState {
  items: CaptureItem[];
  inbox: CaptureItem[];
  routed: CaptureItem[];
  archived: CaptureItem[];
  itemsPath: string;
  capturesPath: string;
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

interface HeatmapGoalProgress extends HeatmapGoal {
  progressSeconds: number;
  targetSeconds: number;
  percent: number;
}

interface HeatmapSummary {
  todayByApp: Array<{ name: string; seconds: number }>;
  weekByApp: Array<{ name: string; seconds: number }>;
  activeHours: Array<{ hour: number; seconds: number }>;
  projectUsage: Array<{ name: string; seconds: number }>;
  activeSecondsToday: number;
  idleSecondsToday: number;
  topAppToday: string;
}

interface HeatmapState {
  settings: HeatmapSettings;
  events: HeatmapEvent[];
  goals: HeatmapGoal[];
  goalProgress: HeatmapGoalProgress[];
  summary: HeatmapSummary;
  eventsPath: string;
  settingsPath: string;
  goalsPath: string;
  trackingStatus: string;
  detectionNote: string;
}

interface CommandStats {
  journalEntriesThisWeek: number;
  calendarUpcoming: number;
  todayNudges: number;
  urgentNudges: number;
  activeNudges: number;
  transactionsThisMonth: number;
  receiptsThisMonth: number;
  vaultDocuments: number;
  dropIncoming: number;
  dropOutgoing: number;
  capturesInbox: number;
  finderItems: number;
  devProjects: number;
  actionsRunToday: number;
  failedActionsToday: number;
  routinesRunToday: number;
  heatmapActiveSecondsToday: number;
  heatmapTopAppToday: string;
  heatmapStatus: string;
  updatedAt: string;
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

interface RoutinesState {
  routines: DexNestRoutine[];
  routinesPath: string;
}

const emptyCommandStats: CommandStats = {
  journalEntriesThisWeek: 0,
  calendarUpcoming: 0,
  todayNudges: 0,
  urgentNudges: 0,
  activeNudges: 0,
  transactionsThisMonth: 0,
  receiptsThisMonth: 0,
  vaultDocuments: 0,
  dropIncoming: 0,
  dropOutgoing: 0,
  capturesInbox: 0,
  finderItems: 0,
  devProjects: 0,
  actionsRunToday: 0,
  failedActionsToday: 0,
  routinesRunToday: 0,
  heatmapActiveSecondsToday: 0,
  heatmapTopAppToday: "none",
  heatmapStatus: "disabled",
  updatedAt: new Date().toISOString()
};

interface PdfInfoItem {
  fileName: string;
  byteLength: number;
  pageCount: number | null;
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

interface BackupState {
  backupFolderPath: string;
  restoreStagingPath: string;
  defaultOptions: BackupOptions;
  backups: BackupFileSummary[];
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

interface DexNestBridge {
  getAppInfo: () => Promise<AppInfo>;
  listActions: () => Promise<ActionDefinition[]>;
  listProjects: () => Promise<DexNestProject[]>;
  listCommandResults: () => Promise<Record<string, ProjectCommandResult>>;
  clearCommandResult: (actionId: string) => Promise<void>;
  listPinnedActions: () => Promise<string[]>;
  savePinnedActions: (actionIds: string[]) => Promise<string[]>;
  getClipboardState: () => Promise<ClipboardState>;
  getDropState: () => Promise<DropState>;
  getToolsState: () => Promise<ToolsState>;
  getVaultState: () => Promise<VaultState>;
  getSearchState: () => Promise<SearchState>;
  getJournalState: () => Promise<JournalState>;
  getCalendarState: () => Promise<CalendarState>;
  getFinderState: () => Promise<FinderState>;
  getFinanceState: () => Promise<FinanceState>;
  getCaptureState: () => Promise<CaptureState>;
  getHeatmapState: () => Promise<HeatmapState>;
  getRoutinesState: () => Promise<RoutinesState>;
  getBackupState: () => Promise<BackupState>;
  getExternalDevicesState: () => Promise<ExternalDevicesState>;
  getAppHealth: () => Promise<AppHealthState>;
  getCommandStats: () => Promise<CommandStats>;
  getPerformanceModeState: () => Promise<PerformanceModeState>;
  getPerformanceModeSettings: () => Promise<PerformanceModeSettings>;
  savePerformanceModeSettings: (payload: Partial<PerformanceModeSettings>) => Promise<{ settings: PerformanceModeSettings; state: PerformanceModeState }>;
  setPerformanceModeEnabled: (payload: { enabled: boolean; reason?: PerformanceModeReason }) => Promise<{ settings: PerformanceModeSettings; state: PerformanceModeState }>;
  selectToolsFiles: (kind: "pdf" | "image" | "any") => Promise<ToolsSelectedFile[]>;
  selectVaultFiles: () => Promise<ToolsSelectedFile[]>;
  selectFinanceReceipt: () => Promise<ToolsSelectedFile[]>;
  selectCaptureFile: () => Promise<ToolsSelectedFile[]>;
  getPdfInfo: (paths: string[]) => Promise<PdfInfoItem[]>;
  chooseToolsOutputFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  resetToolsOutputFolder: () => Promise<{ ok: boolean; path: string }>;
  saveToolsSettings: (payload: { ffmpegPath?: string | null; libreOfficePath?: string | null; tesseractPath?: string | null; pythonPath?: string | null; ocrEngine?: string; ocrDevice?: string; ocrLanguage?: string }) => Promise<unknown>;
  openToolsFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  getAssistantState: () => Promise<{ settings: AssistantSettings }>;
  saveAssistantSettings: (payload: Partial<AssistantSettings>) => Promise<AssistantSettings>;
  testOllama: (payload: { ollamaUrl?: string; ollamaModel?: string }) => Promise<{ ok: boolean; models?: string[]; modelAvailable?: boolean; error?: string }>;
  assistantLlmIntent: (payload: { query: string }) => Promise<{ ok: boolean; intent?: Record<string, unknown>; error?: string }>;
  getAmbientVoiceState: () => Promise<AmbientVoiceState>;
  saveAmbientVoiceSettings: (payload: Partial<AmbientVoiceSettings>) => Promise<{ settings: AmbientVoiceSettings; state: AmbientVoiceState }>;
  updateAmbientVoiceState: (payload: Partial<Pick<AmbientVoiceState, "currentState" | "lastRecognizedCommand" | "lastActionResult" | "lastSource">>) => Promise<AmbientVoiceState>;
  startAmbientListening: (payload?: { source?: string }) => Promise<AmbientVoiceState>;
  getSpeechState: () => Promise<SpeechServiceState>;
  getVoiceWorkflowSettings: () => Promise<VoiceWorkflowSettings>;
  saveVoiceWorkflowSettings: (payload: Partial<VoiceWorkflowSettings>) => Promise<VoiceWorkflowSettings>;
  saveSpeechSettings: (payload: Partial<SpeechSettings>) => Promise<{ settings: SpeechSettings; speechState: SpeechServiceState }>;
  checkSpeechModel: () => Promise<{ ok: boolean; status: SpeechModelStatus; speechState: SpeechServiceState }>;
  installSpeechModel: () => Promise<{ ok: boolean; status: SpeechModelStatus; speechState: SpeechServiceState }>;
  warmSpeechEngine: () => Promise<{ ok: boolean; error?: string; speechState: SpeechServiceState }>;
  getWakeEngineState: () => Promise<WakeEngineState>;
  checkWakeEngine: () => Promise<{ ok: boolean; report: Record<string, unknown>; error?: string; state: WakeEngineState }>;
  startWakeEngine: () => Promise<{ ok: boolean; status: string; error?: string; state: WakeEngineState }>;
  stopWakeEngine: () => Promise<{ ok: boolean; state: WakeEngineState }>;
  voiceOverlay: (payload: { type?: string; state?: string; level?: number }) => void;
  onWakeDetected: (callback: (payload: { source: string; score: number | null }) => void) => () => void;
  openSpeechModelFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  transcribeSpeech: (payload: { audioBytes?: number[]; mimeType?: string; source?: string; sourceModule?: string; language?: string; manualOverride?: boolean }) => Promise<SpeechTranscriptionResult>;
  getAssistantSecurityState: () => Promise<AssistantSecurityState>;
  saveAssistantSecuritySettings: (payload: Partial<AssistantSecuritySettings>) => Promise<AssistantSecurityState>;
  unlockTrustedSession: (payload: { masterPassword?: string }) => Promise<{ ok: boolean; error?: string; state: AssistantSecurityState }>;
  lockTrustedSession: () => Promise<AssistantSecurityState>;
  copyDropIncomingText: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
  chooseDropReceiveFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  resetDropReceiveFolder: () => Promise<{ ok: boolean; path: string }>;
  logDropAutoRefresh: (enabled: boolean) => Promise<void>;
  startWindowsDictation: () => Promise<{ ok: boolean; error?: string }>;
  saveProject: (payload: unknown) => Promise<DexNestProject>;
  deleteProject: (projectId: string) => Promise<void>;
  listEvents: () => Promise<EventEntry[]>;
  runAction: (payload: { actionId: string; source?: string; params?: unknown }) => Promise<{
    ok: boolean;
    error?: string;
    output?: string | ToolsOutputItem;
    stdout?: string;
    stderr?: string;
    summary?: string;
    status?: "success" | "failed";
    durationMs?: number | null;
    outputs?: ToolsOutputItem[];
    info?: PdfInfoItem[];
    results?: SearchResult[] | FinderItem[];
    searchState?: SearchState;
    savedSearch?: SavedSearch;
    journalState?: JournalState;
    calendarState?: CalendarState;
    entry?: JournalEntry;
    event?: CalendarEvent;
    candidates?: ExtractedCalendarCandidate[];
    duplicate?: boolean;
    finderState?: FinderState;
    item?: FinderItem | CaptureItem;
    financeState?: FinanceState;
    transaction?: FinanceTransaction;
    recurring?: FinanceRecurringExpense;
    captureState?: CaptureState;
    heatmapState?: HeatmapState;
    routinesState?: RoutinesState;
    backupState?: BackupState;
    externalDevicesState?: ExternalDevicesState;
    health?: AppHealthState;
    keyboardShortcutSettings?: KeyboardShortcutSettings;
    streamDeckSettings?: StreamDeckSettings;
    preview?: BackupPreview;
    path?: string;
    fileName?: string;
    sizeBytes?: number;
    safetyBackupPath?: string;
    restored?: string[];
    commandStats?: CommandStats;
    events?: EventEntry[];
  }>;
  logActionResult: (payload: {
    actionId: string;
    status: ActionStatus;
    source?: string;
    summary: string;
    errorMessage?: string | null;
    metadataJson?: Record<string, unknown>;
  }) => Promise<void>;
  logUiEvent: (payload: { view: string; target: string; summary: string }) => Promise<void>;
  selectBackupZip: () => Promise<string | null>;
  rendererReady?: () => void;
  onClipboardHotkeyResult?: (callback: (payload: { message: string; tone: ToastTone }) => void) => () => void;
  onOpenView?: (callback: (payload: { view: string; focusAssistant?: boolean; startListening?: boolean; source?: string }) => void) => () => void;
}

declare global {
  interface Window {
    dexNest?: DexNestBridge;
  }
}

const defaultPerformanceModeSettings: PerformanceModeSettings = {
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

const defaultPerformanceModeState: PerformanceModeState = {
  enabled: false,
  reason: "unknown",
  enabledAt: null,
  pausedWorkers: [],
  lastChangedAt: new Date().toISOString()
};

const defaultExternalDevicesState: ExternalDevicesState = {
  settingsPath: "./local-data/settings/external-devices-settings.json",
  cachePath: "./local-data/settings/external-devices-cache.json",
  groupsPath: "./local-data/settings/external-devices-groups.json",
  settings: {
    goveeEnabled: false,
    goveeApiKeySecretId: null,
    defaultDeviceAlias: null,
    allowVoiceControl: true,
    allowStreamDeckControl: true,
    allowKeyboardShortcutControl: true,
    requireConfirmationForPowerOff: false,
    requireConfirmationForBrightnessBelow10: false,
    requireConfirmationForScenes: false,
    updatedAt: null
  },
  secureVaultSetup: false,
  secureVaultUnlocked: false,
  apiKeyStored: false,
  providerStatus: "disabled",
  providerMessage: "Govee provider is disabled.",
  devices: [],
  groups: []
};

const defaultAmbientVoiceSettings: AmbientVoiceSettings = {
  ambientVoiceEnabled: false,
  wakeWordEnabled: false,
  wakeWord: "Nest",
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
  wakeChimeEnabled: true,
  wakeChimeVolume: 0.35,
  voiceOverlayEnabled: true,
  voiceOverlayScreen: "primary",
  voiceOverlayPosition: "bottom_center",
  voiceOverlaySize: "compact",
  voiceOverlayAnimations: true,
  voiceName: null,
  voiceRate: 1,
  voiceVolume: 1,
  shortResponsesOnly: true,
  muteInPerformanceMode: true,
  maxListeningSeconds: 8,
  commandCooldownMs: 1200,
  updatedAt: new Date().toISOString()
};

const defaultAmbientVoiceState: AmbientVoiceState = {
  settingsPath: "./local-data/settings/ambient-voice-settings.json",
  settings: defaultAmbientVoiceSettings,
  currentState: "idle",
  lastRecognizedCommand: "",
  lastActionResult: "",
  lastSource: "system",
  lastChangedAt: new Date().toISOString(),
  pausedByPerformanceMode: false,
  wakeWordStatus: "disabled"
};

const defaultSpeechSettings: SpeechSettings = {
  speechEngine: "faster_whisper",
  fallbackToWindows: true,
  modelName: "base.en",
  modelSizeOptions: ["tiny.en", "base.en", "small.en"],
  device: "cpu",
  computeType: "int8",
  maxRecordingSeconds: 8,
  silenceStopEnabled: true,
  vadEnabled: true,
  keepAudioForDebug: false,
  pauseInPerformanceMode: true,
  autoSendAfterSpeech: true,
  showTranscriptBeforeSend: false,
  useSharedSpeechEverywhere: true,
  pythonPath: null,
  updatedAt: null
};

const defaultSpeechState: SpeechServiceState = {
  settingsPath: "./local-data/settings/speech-settings.json",
  modelRoot: "./local-data/models/speech",
  debugAudioRoot: "./local-data/debug/audio",
  settings: defaultSpeechSettings,
  modelStatus: {
    ok: false,
    installed: false,
    message: "Run Check local model for current status.",
    engine: "faster_whisper",
    model: "base.en",
    modelPath: "./local-data/models/speech/base.en",
    pythonPath: null,
    deviceDetected: "unknown",
    fasterWhisperAvailable: false,
    lastLatencyMs: null,
    lastError: null
  },
  windowsFallbackAvailable: false,
  performancePaused: false
};

const defaultVoiceWorkflowSettings: VoiceWorkflowSettings = {
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

const defaultAppLifecycleSettings: AppLifecycleSettings = {
  closeBehavior: "ask",
  showTrayCloseNotice: true,
  minimizeToTrayOnStartup: false,
  startDexNestWithWindows: false,
  startMinimizedToTray: true,
  loginItemStatus: "disabled",
  loginItemLastError: null,
  updatedAt: new Date().toISOString(),
  trayAvailable: false,
  trayModeActive: false
};

const defaultKeyboardShortcutSettings: KeyboardShortcutSettings = {
  enabled: true,
  updatedAt: new Date().toISOString(),
  mappings: []
};

const defaultStreamDeckSettings: StreamDeckSettings = {
  localOnly: true,
  lanEnabled: false,
  tokenEnabled: false,
  token: "",
  updatedAt: new Date().toISOString()
};

const fallbackBridge: DexNestBridge = {
  getAppInfo: async () => ({
    appName: "DexNest",
    dataRoot: "./local-data",
    dbPath: "./local-data/data/dexnest.sqlite",
    actionEndpoint: "http://127.0.0.1:43217",
    projectsConfigPath: "./local-data/settings/projects.json",
    commandSettingsPath: "./local-data/settings/command-settings.json",
    keyboardShortcutsPath: "./local-data/settings/keyboard-shortcuts.json",
    keyboardShortcutSettings: defaultKeyboardShortcutSettings,
    keyboardShortcutConflicts: [],
    streamDeckSettingsPath: "./local-data/settings/stream-deck-settings.json",
    streamDeckSettings: defaultStreamDeckSettings,
    commandShortcutEnabled: true,
    commandShortcut: "CommandOrControl+Space",
    commandShortcutStatus: "disabled",
    commandShortcutLastError: null,
    trayStatus: "failed",
    commandResultsPath: "./local-data/settings/project-command-results.json",
    pinnedActionsPath: "./local-data/settings/pinned-actions.json",
    clipboardHistoryPath: "./local-data/settings/clipboard-history.json",
    clipboardSnippetsPath: "./local-data/settings/clipboard-snippets.json",
    clipboardSettingsPath: "./local-data/settings/clipboard-settings.json",
    clipboardMultiGroupsPath: "./local-data/settings/clipboard-multi-groups.json",
    clipboardActiveMultiCopyPath: "./local-data/settings/clipboard-active-multicopy.json",
    clipboardSlotsPath: "./local-data/settings/clipboard-slots.json",
    dropShelfPath: "./local-data/settings/drop-shelf.json",
    dropIncomingPath: "./local-data/settings/drop-incoming.json",
    dropReceiveFolderPath: "./local-data/files/drop/incoming",
    defaultReceiveFolderPath: "./local-data/files/drop/incoming",
    customReceiveFolderPath: null,
    dropOutgoingFolderPath: "./local-data/files/drop/outgoing",
    dropTempFolderPath: "./local-data/files/drop/temp",
    toolsInputFolderPath: "./local-data/files/tools/input",
    toolsOutputFolderPath: "./local-data/files/tools/output",
    toolsDefaultOutputFolderPath: "./local-data/files/tools/output",
    toolsTempFolderPath: "./local-data/files/tools/temp",
    toolsOutputsPath: "./local-data/settings/tools-outputs.json",
    vaultDocumentsPath: "./local-data/files/vault/documents",
    vaultImportsPath: "./local-data/files/vault/imports",
    vaultVersionsPath: "./local-data/files/vault/versions",
    vaultOcrOutputPath: "./local-data/files/vault/ocr",
    vaultOcrJobsPath: "./local-data/settings/vault-ocr-jobs.json",
    vaultOcrSettingsPath: "./local-data/settings/vault-ocr-settings.json",
    vaultMetadataPath: "./local-data/settings/vault-documents.json",
    searchIndexPath: "./local-data/index/search-index.json",
    searchIndexFolderPath: "./local-data/index",
    savedSearchesPath: "./local-data/settings/saved-searches.json",
    journalEntriesPath: "./local-data/settings/journal-entries.json",
    calendarEventsPath: "./local-data/settings/calendar-events.json",
    nudgesPath: "./local-data/settings/nudges.json",
    nudgeSettingsPath: "./local-data/settings/nudge-settings.json",
    finderItemsPath: "./local-data/settings/finder-items.json",
    financeTransactionsPath: "./local-data/settings/finance-transactions.json",
    financeRecurringPath: "./local-data/settings/finance-recurring.json",
    financeSettingsPath: "./local-data/settings/finance-settings.json",
    receiptsPath: "./local-data/files/receipts",
    captureItemsPath: "./local-data/settings/capture-items.json",
    capturesPath: "./local-data/files/captures",
    routinesPath: "./local-data/settings/routines.json",
    heatmapEventsPath: "./local-data/settings/heatmap-events.json",
    heatmapSettingsPath: "./local-data/settings/heatmap-settings.json",
    heatmapGoalsPath: "./local-data/settings/heatmap-goals.json",
    speechSettingsPath: "./local-data/settings/speech-settings.json",
    voiceWorkflowSettingsPath: "./local-data/settings/voice-workflow-settings.json",
    voiceWorkflowSettings: defaultVoiceWorkflowSettings,
    speechModelsRoot: "./local-data/models/speech",
    speechDebugAudioRoot: "./local-data/debug/audio",
    speechState: defaultSpeechState,
    ambientVoiceSettingsPath: "./local-data/settings/ambient-voice-settings.json",
    ambientVoiceState: defaultAmbientVoiceState,
    externalDevicesSettingsPath: "./local-data/settings/external-devices-settings.json",
    externalDevicesCachePath: "./local-data/settings/external-devices-cache.json",
    externalDevicesGroupsPath: "./local-data/settings/external-devices-groups.json",
    externalDevicesState: defaultExternalDevicesState,
    performanceModeSettingsPath: "./local-data/settings/performance-mode-settings.json",
    appLifecycleSettingsPath: "./local-data/settings/app-lifecycle-settings.json",
    appLifecycleSettings: defaultAppLifecycleSettings,
    performanceModeState: defaultPerformanceModeState,
    performanceModeSettings: defaultPerformanceModeSettings,
    backupFolderPath: "./local-data/backups",
    restoreStagingPath: "./local-data/backups/restore-staging",
    packageMode: "development",
    currentBranch: "unknown",
    localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localDateTimePreview: formatLocalDateTime(new Date()),
    localToday: getLocalTodayDateString(),
    dropLocalUrl: "http://127.0.0.1:43217/drop",
    dropPhoneUrl: "http://127.0.0.1:43217/drop",
    lanIp: null,
    projectCount: 0,
    performanceMode: "Bridge unavailable"
  }),
  listActions: async () => [],
  listProjects: async () => [],
  listCommandResults: async () => ({}),
  clearCommandResult: async () => undefined,
  listPinnedActions: async () => ["command.open_home", "dev.open_dashboard", "deck.test_endpoint"],
  savePinnedActions: async (actionIds) => actionIds,
  getClipboardState: async () => ({
    history: [],
    snippets: [],
    settings: {
      listenerEnabled: false,
      listenerIntervalMs: 2000,
      historyRetentionDays: 1,
      lastHistoryCleanupAt: null,
      multiCopyHotkeyEnabled: true,
      multiCopyHotkey: "CommandOrControl+Shift+C",
      multiCopyHotkeyStatus: "disabled",
      multiCopyHotkeyLastError: null,
      multiCopyHotkeyRegistered: false,
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
      secretProtectionEnabled: true
    },
    multiGroups: [],
    slots: Array.from({ length: 5 }, (_item, index) => ({ slot: index + 1, text: "", preview: "", byteLength: 0, updatedAt: "" })),
    snippetsPath: "./local-data/settings/clipboard-snippets.json",
    historyPath: "./local-data/settings/clipboard-history.json",
    settingsPath: "./local-data/settings/clipboard-settings.json",
    multiGroupsPath: "./local-data/settings/clipboard-multi-groups.json",
    activeMultiCopyPath: "./local-data/settings/clipboard-active-multicopy.json",
    slotsPath: "./local-data/settings/clipboard-slots.json"
  }),
  getDropState: async () => ({
    shelf: [],
    outgoing: [],
    outgoingText: [],
    outgoingFiles: [],
    incoming: [],
    shelfPath: "./local-data/settings/drop-shelf.json",
    incomingPath: "./local-data/settings/drop-incoming.json",
    receiveFolderPath: "./local-data/files/drop/incoming",
    defaultReceiveFolderPath: "./local-data/files/drop/incoming",
    customReceiveFolderPath: null,
    outgoingFolderPath: "./local-data/files/drop/outgoing",
    tempFolderPath: "./local-data/files/drop/temp",
    localUrl: "http://127.0.0.1:43217/drop",
    phoneUrl: "http://127.0.0.1:43217/drop",
    lanIp: null
  }),
  getToolsState: async () => ({
    selectedFiles: [],
    outputs: [],
    inputFolderPath: "./local-data/files/tools/input",
    outputFolderPath: "./local-data/files/tools/output",
    defaultOutputFolderPath: "./local-data/files/tools/output",
    customOutputFolderPath: null,
    ffmpegPath: null,
    detectedFfmpegPath: null,
    libreOfficePath: null,
    detectedLibreOfficePath: null,
    tesseractPath: null,
    detectedTesseractPath: null,
    pythonPath: null,
    detectedPythonPath: null,
    ocrEngine: "paddleocr",
    ocrDevice: "gpu",
    ocrLanguage: "eng",
    tempFolderPath: "./local-data/files/tools/temp",
    outputsPath: "./local-data/settings/tools-outputs.json"
  }),
  getVaultState: async () => ({
    documents: [],
    categories: ["Immigration", "University", "Jobs", "Startup", "Tax", "Finance", "Medical", "Research", "Receipts", "Personal", "Other"],
    documentsPath: "./local-data/files/vault/documents",
    importsPath: "./local-data/files/vault/imports",
    versionsPath: "./local-data/files/vault/versions",
    tempPath: "./local-data/files/vault/temp",
    metadataPath: "./local-data/settings/vault-documents.json",
    documentCount: 0,
    totalSizeBytes: 0,
    ocrJobs: [],
    ocrSettings: { autoOcrOnImport: true, engine: "paddleocr", device: "gpu", pythonPath: null },
    ocrOutputPath: "./local-data/files/vault/ocr",
    ocrJobsPath: "./local-data/settings/vault-ocr-jobs.json",
    ocrQueueRunning: false,
    ocrQueuePaused: false,
    paddleGpuStatus: { ok: false, message: "Bridge unavailable.", pythonPath: null, paddleVersion: null, deviceCount: 0 },
    secure: {
      isSetup: false,
      isUnlocked: false,
      filePath: "./local-data/files/vault/secure/secure-vault.json",
      autoLockMinutes: 5,
      itemTypes: ["password", "api_key", "token", "recovery_code", "private_note", "server", "other"],
      items: []
    }
  }),
  getSearchState: async () => ({
    index: [],
    savedSearches: [],
    indexPath: "./local-data/index/search-index.json",
    indexFolderPath: "./local-data/index",
    indexStatusPath: "./local-data/settings/search-index-status.json",
    indexStatus: { staleDueToPerformanceMode: false, staleReason: null, staleSince: null, lastSkippedAutoIndexAt: null },
    savedSearchesPath: "./local-data/settings/saved-searches.json",
    resultCount: 0,
    ocrTextFileCount: 0,
    sources: [],
    fileTypes: []
  }),
  getJournalState: async () => ({
    entries: [],
    todayEntry: null,
    entriesPath: "./local-data/settings/journal-entries.json",
    today: getLocalTodayDateString()
  }),
  getCalendarState: async () => ({
    events: [],
    today: getLocalTodayDateString(),
    todayEvents: [],
    upcomingEvents: [],
    eventsPath: "./local-data/settings/calendar-events.json",
    nudges: [],
    todayNudges: [],
    upcomingNudges: [],
    urgentNudges: [],
    nudgesPath: "./local-data/settings/nudges.json",
    nudgeSettingsPath: "./local-data/settings/nudge-settings.json",
    nudgeSettings: {
      enabled: true,
      vaultExpiryReminderDays: [90, 30, 7],
      returnReminderDays: [7, 3, 1],
      dailyJournalReminderEnabled: true,
      backupReminderAfterDays: 7
    }
  }),
  getFinderState: async () => ({
    items: [],
    itemsPath: "./local-data/settings/finder-items.json",
    statusCounts: { at_home: 0, lent_out: 0, missing: 0, archived: 0 }
  }),
  getFinanceState: async () => ({
    transactions: [],
    recurring: [],
    settings: { defaultCurrency: "CAD", receiptsPath: "./local-data/files/receipts" },
    transactionsPath: "./local-data/settings/finance-transactions.json",
    recurringPath: "./local-data/settings/finance-recurring.json",
    settingsPath: "./local-data/settings/finance-settings.json",
    receiptsPath: "./local-data/files/receipts",
    summary: {
      currentMonth: getLocalTodayDateString().slice(0, 7),
      previousMonth: "",
      currentMonthTotal: 0,
      previousMonthTotal: 0,
      categoryTotals: {},
      paymentTypeTotals: {},
      cashTotal: 0,
      cardTotal: 0,
      transactionCount: 0
    },
    deadlines: { returns7: [], returns30: [], warranties90: [], expiredReturns: [] }
  }),
  getCaptureState: async () => ({
    items: [],
    inbox: [],
    routed: [],
    archived: [],
    itemsPath: "./local-data/settings/capture-items.json",
    capturesPath: "./local-data/files/captures"
  }),
  getHeatmapState: async () => ({
    settings: {
      enabled: false,
      paused: true,
      sampleIntervalSeconds: 60,
      aggregationIntervalHours: 3,
      pauseDuringFullscreen: true,
      privateApps: [],
      privateTitleKeywords: [],
      lastAggregatedAt: null
    },
    events: [],
    goals: [],
    goalProgress: [],
    summary: {
      todayByApp: [],
      weekByApp: [],
      activeHours: [],
      projectUsage: [],
      activeSecondsToday: 0,
      idleSecondsToday: 0,
      topAppToday: "none"
    },
    eventsPath: "./local-data/settings/heatmap-events.json",
    settingsPath: "./local-data/settings/heatmap-settings.json",
    goalsPath: "./local-data/settings/heatmap-goals.json",
    trackingStatus: "disabled",
    detectionNote: "Bridge unavailable."
  }),
  getRoutinesState: async () => ({ routines: [], routinesPath: "./local-data/settings/routines.json" }),
  getBackupState: async () => ({
    backupFolderPath: "./local-data/backups",
    restoreStagingPath: "./local-data/backups/restore-staging",
    defaultOptions: {
      includeSettings: true,
      includeFiles: true,
      includeVaultDocuments: true,
      includeSecureVault: true,
      includeReceipts: true,
      includeDropFiles: true,
      includeIndex: false
    },
    backups: []
  }),
  getExternalDevicesState: async () => defaultExternalDevicesState,
  getAppHealth: async () => ({
    overallStatus: "warn",
    checkedAt: new Date().toISOString(),
    summary: { pass: 0, warn: 1, fail: 0 },
    groups: [
      {
        id: "bridge",
        title: "Bridge",
        checks: [
          {
            id: "bridge-unavailable",
            label: "DexNest desktop bridge",
            status: "warn",
            detail: "DexNest preload bridge is unavailable.",
            suggestion: "Run DexNest through the Electron desktop app."
          }
        ]
      }
    ]
  }),
  getCommandStats: async () => emptyCommandStats,
  getPerformanceModeState: async () => defaultPerformanceModeState,
  getPerformanceModeSettings: async () => defaultPerformanceModeSettings,
  savePerformanceModeSettings: async (payload) => ({
    settings: { ...defaultPerformanceModeSettings, ...payload },
    state: { ...defaultPerformanceModeState, enabled: Boolean(payload.performanceModeEnabled), pausedWorkers: Boolean(payload.performanceModeEnabled) ? ["bridge_unavailable"] : [] }
  }),
  setPerformanceModeEnabled: async (payload) => ({
    settings: { ...defaultPerformanceModeSettings, performanceModeEnabled: payload.enabled },
    state: { ...defaultPerformanceModeState, enabled: payload.enabled, reason: payload.reason ?? "manual", pausedWorkers: payload.enabled ? ["bridge_unavailable"] : [] }
  }),
  selectBackupZip: async () => null,
  selectToolsFiles: async () => [],
  selectVaultFiles: async () => [],
  selectFinanceReceipt: async () => [],
  selectCaptureFile: async () => [],
  getPdfInfo: async () => [],
  chooseToolsOutputFolder: async () => ({ ok: false, error: "Bridge unavailable" }),
  resetToolsOutputFolder: async () => ({ ok: true, path: "./local-data/files/tools/output" }),
  saveToolsSettings: async () => fallbackBridge.getToolsState(),
  openToolsFile: async () => ({ ok: false, error: "Bridge unavailable" }),
  getAssistantState: async () => ({ settings: { localIntentEngineEnabled: false, ollamaUrl: "http://127.0.0.1:11434", ollamaModel: "qwen2.5:3b", fallbackToRules: true } }),
  saveAssistantSettings: async () => ({ localIntentEngineEnabled: false, ollamaUrl: "http://127.0.0.1:11434", ollamaModel: "qwen2.5:3b", fallbackToRules: true }),
  testOllama: async () => ({ ok: false, error: "Bridge unavailable" }),
  assistantLlmIntent: async () => ({ ok: false, error: "Bridge unavailable" }),
  getAmbientVoiceState: async () => defaultAmbientVoiceState,
  saveAmbientVoiceSettings: async () => ({ settings: defaultAmbientVoiceSettings, state: defaultAmbientVoiceState }),
  updateAmbientVoiceState: async () => defaultAmbientVoiceState,
  startAmbientListening: async () => defaultAmbientVoiceState,
  getSpeechState: async () => defaultSpeechState,
  getVoiceWorkflowSettings: async () => defaultVoiceWorkflowSettings,
  saveVoiceWorkflowSettings: async (payload) => ({ ...defaultVoiceWorkflowSettings, ...payload, updatedAt: new Date().toISOString() }),
  saveSpeechSettings: async (payload) => ({ settings: { ...defaultSpeechSettings, ...payload }, speechState: defaultSpeechState }),
  checkSpeechModel: async () => ({ ok: false, status: defaultSpeechState.modelStatus, speechState: defaultSpeechState }),
  installSpeechModel: async () => ({ ok: false, status: defaultSpeechState.modelStatus, speechState: defaultSpeechState }),
  warmSpeechEngine: async () => ({ ok: false, error: "Bridge unavailable", speechState: defaultSpeechState }),
  getWakeEngineState: async () => defaultWakeEngineState,
  checkWakeEngine: async () => ({ ok: false, report: {}, error: "Bridge unavailable", state: defaultWakeEngineState }),
  startWakeEngine: async () => ({ ok: false, status: "engine_missing", error: "Bridge unavailable", state: defaultWakeEngineState }),
  stopWakeEngine: async () => ({ ok: true, state: defaultWakeEngineState }),
  voiceOverlay: () => undefined,
  onWakeDetected: () => () => undefined,
  openSpeechModelFolder: async () => ({ ok: false, error: "Bridge unavailable" }),
  transcribeSpeech: async () => ({ transcript: "", engine: "faster_whisper", model: "base.en", language: "en", durationMs: 0, status: "failed", error: "Bridge unavailable", speechState: defaultSpeechState }),
  getAssistantSecurityState: async () => ({
    settings: { trustedSessionEnabled: true, autoRevealWhileUnlocked: true, sessionTimeoutMinutes: 10, speakSensitiveAnswers: false, lockOnAppClose: true },
    sessionUnlocked: false,
    sessionExpiresAt: null,
    secureVaultUnlocked: false,
    secureVaultSetup: false
  }),
  saveAssistantSecuritySettings: async () => fallbackBridge.getAssistantSecurityState(),
  unlockTrustedSession: async () => ({ ok: false, error: "Bridge unavailable", state: await fallbackBridge.getAssistantSecurityState() }),
  lockTrustedSession: async () => fallbackBridge.getAssistantSecurityState(),
  copyDropIncomingText: async () => ({ ok: true }),
  chooseDropReceiveFolder: async () => ({ ok: false, error: "Bridge unavailable" }),
  resetDropReceiveFolder: async () => ({ ok: true, path: "./local-data/files/drop/incoming" }),
  logDropAutoRefresh: async () => undefined,
  startWindowsDictation: async () => ({ ok: false, error: "Windows dictation bridge unavailable" }),
  saveProject: async (payload) => payload as DexNestProject,
  deleteProject: async () => undefined,
  listEvents: async () => [],
  runAction: async () => ({ ok: true }),
  logActionResult: async () => undefined,
  logUiEvent: async () => undefined,
  rendererReady: () => undefined
};

function getBridge(): DexNestBridge {
  return window.dexNest ?? fallbackBridge;
}

const views: Array<{ id: ViewId; label: string; accentClass: string; actionId: string }> = [
  { id: "command", label: "Command", accentClass: "accent-command", actionId: "command.open_home" },
  { id: "dev", label: "Dev", accentClass: "accent-dev", actionId: "dev.open_dashboard" },
  { id: "deck", label: "Deck", accentClass: "accent-deck", actionId: "deck.test_endpoint" },
  { id: "clipboard", label: "Clipboard", accentClass: "accent-clipboard", actionId: "clipboard.open" },
  { id: "drop", label: "Drop", accentClass: "accent-drop", actionId: "drop.open" },
  { id: "tools", label: "Tools", accentClass: "accent-tools", actionId: "tools.open" },
  { id: "vault", label: "Vault", accentClass: "accent-vault", actionId: "vault.open" },
  { id: "search", label: "Search", accentClass: "accent-search", actionId: "search.open" },
  { id: "capture", label: "Capture", accentClass: "accent-capture", actionId: "capture.open" },
  { id: "journal", label: "Journal", accentClass: "accent-journal", actionId: "journal.open_today" },
  { id: "calendar", label: "Calendar", accentClass: "accent-calendar", actionId: "calendar.show_today" },
  { id: "finder", label: "Finder", accentClass: "accent-finder", actionId: "finder.open" },
  { id: "finance", label: "Finance", accentClass: "accent-finance", actionId: "finance.open" },
  { id: "heatmap", label: "Heatmap", accentClass: "accent-heatmap", actionId: "heatmap.open" },
  { id: "audit", label: "Audit", accentClass: "accent-command", actionId: "audit.open_history" },
  { id: "settings", label: "Settings", accentClass: "accent-command", actionId: "settings.open" }
];

const moduleCards = [
  ["command", "Command", "Action hub and dashboard.", "available"],
  ["dev", "Dev", "Project cards and local commands.", "placeholder"],
  ["deck", "Deck", "Stream Deck localhost action surface.", "placeholder"],
  ["clipboard", "Clipboard", "Manual history and snippets.", "available"],
  ["drop", "Drop", "Local handoff shelf foundation.", "available"],
  ["tools", "Tools", "Local PDF and media utilities.", "available"],
  ["vault", "Vault", "Local document vault foundation.", "available"],
  ["search", "Search", "Manual local file and metadata search.", "available"],
  ["capture", "Capture", "Shared inbox for unsorted local items.", "available"],
  ["journal", "Journal", "Private daily capture and shutdown flow.", "available"],
  ["calendar", "Calendar", "Local events and reminders foundation.", "available"],
  ["finder", "Finder", "Physical item-location memory.", "available"],
  ["finance", "Finance", "Manual expenses, receipts, and reminders.", "available"],
  ["heatmap", "Heatmap", "Local app usage and goals.", "available"]
] as const;

function viewFromAction(action?: ActionDefinition): ViewId | null {
  if (!action?.handlerRef.startsWith("desktop.view.")) {
    return null;
  }

  const viewId = action.handlerRef.replace("desktop.view.", "") as ViewId;
  return views.some((view) => view.id === viewId) ? viewId : null;
}

const voiceModuleAliases: Record<string, { module: ViewId; actionId: string }> = {
  command: { module: "command", actionId: "command.open_home" },
  home: { module: "command", actionId: "command.open_home" },
  dev: { module: "dev", actionId: "dev.open_dashboard" },
  developer: { module: "dev", actionId: "dev.open_dashboard" },
  deck: { module: "deck", actionId: "deck.test_endpoint" },
  clipboard: { module: "clipboard", actionId: "clipboard.open" },
  drop: { module: "drop", actionId: "drop.open" },
  phone: { module: "drop", actionId: "drop.open" },
  tools: { module: "tools", actionId: "tools.open" },
  vault: { module: "vault", actionId: "vault.open" },
  search: { module: "search", actionId: "search.open" },
  capture: { module: "capture", actionId: "capture.open" },
  inbox: { module: "capture", actionId: "capture.open" },
  finance: { module: "finance", actionId: "finance.open" },
  journal: { module: "journal", actionId: "journal.open_today" },
  calendar: { module: "calendar", actionId: "calendar.show_today" },
  finder: { module: "finder", actionId: "finder.open" },
  heatmap: { module: "heatmap", actionId: "heatmap.open" },
  audit: { module: "audit", actionId: "audit.open_history" },
  settings: { module: "settings", actionId: "settings.open" }
};

function normalizeVoiceCommand(value: string): string {
  return value.toLowerCase().replace(/[^\w\s:'-]/g, " ").replace(/\s+/g, " ").trim();
}

function extractVoiceTime(input: string): string | null {
  return parseCalendarVoiceTime(input);
}

const weekdayIndexes: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

function addLocalDays(dateString: string, days: number): string {
  const date = parseLocalDateInput(dateString);
  date.setDate(date.getDate() + days);
  return toLocalDateInputValue(date);
}

function resolveWeekdayDate(input: string, baseDate = getLocalTodayDateString()): string | null {
  const normalized = input.toLowerCase();
  const match = normalized.match(/\b(this|next)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) {
    return null;
  }
  const modifier = match[1] ?? "";
  const target = weekdayIndexes[match[2]];
  const current = parseLocalDateInput(baseDate).getDay();
  let offset = (target - current + 7) % 7;
  if (modifier === "next" || (modifier !== "this" && offset === 0)) {
    offset += 7;
  }
  return addLocalDays(baseDate, offset);
}

function resolveCalendarVoiceDate(input: string): string | null {
  if (/\btonight\b/i.test(input)) {
    return getLocalTodayDateString();
  }
  const relative = resolveRelativeLocalDate(input);
  if (relative) {
    return relative;
  }
  return resolveWeekdayDate(input);
}

function parseCalendarVoiceTime(input: string, settings = defaultVoiceWorkflowSettings): string | null {
  const normalized = input.toLowerCase();
  if (/\b(tonight|evening)\b/.test(normalized)) {
    return "19:00";
  }
  if (/\bafternoon\b/.test(normalized)) {
    return "15:00";
  }
  if (/\bmorning\b/.test(normalized)) {
    return settings.defaultReminderTime || "09:00";
  }

  const match = input.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
    ?? input.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridian = match[3]?.toLowerCase();
  if (meridian === "pm" && hour < 12) {
    hour += 12;
  } else if (meridian === "am" && hour === 12) {
    hour = 0;
  } else if (!meridian && hour >= 1 && hour <= 7) {
    hour += 12;
  }
  if (hour > 23 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [hourPart, minutePart] = time.split(":");
  const date = new Date();
  date.setHours(Number(hourPart), Number(minutePart), 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function cleanVoiceCalendarTitle(input: string): string {
  return input
    .replace(/\b(add|create|schedule)\b/gi, "")
    .replace(/\b(remind me to|remind me about|remind me|add reminder to|please)\b/gi, "")
    .replace(/\b(today|tomorrow|tonight|morning|afternoon|evening|in\s+\d{1,3}\s+days?|(?:this|next)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/gi, "")
    .replace(/\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/gi, "")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi, "")
    .replace(/\bis\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

type CalendarVoiceEventType = "birthday" | "meeting" | "appointment" | "call" | "reminder";

interface CalendarVoiceCandidate {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  recurrence: string | null;
  reminderLevel: "soft" | "normal" | "urgent";
  notes: string;
  sourcePhrasePreview: string;
  confidence: VoiceConfidence;
  missingFields: string[];
  sensitivity: VoiceSensitivity;
  eventType: CalendarVoiceEventType;
}

function detectCalendarVoiceType(input: string): CalendarVoiceEventType {
  const lower = input.toLowerCase();
  if (lower.includes("birthday")) {
    return "birthday";
  }
  if (lower.includes("meeting")) {
    return "meeting";
  }
  if (lower.includes("appointment") || lower.includes("dentist")) {
    return "appointment";
  }
  if (lower.includes("call")) {
    return "call";
  }
  return "reminder";
}

function parseCalendarVoiceCandidate(input: string, settings = defaultVoiceWorkflowSettings): CalendarVoiceCandidate | null {
  const trimmed = input.trim();
  if (!/\b(add|create|schedule|remind me|reminder|meeting|appointment|birthday|call|dentist)\b/i.test(trimmed)) {
    return null;
  }

  const eventType = detectCalendarVoiceType(trimmed);
  const resolvedDate = resolveCalendarVoiceDate(trimmed);
  const startTime = parseCalendarVoiceTime(trimmed, settings);
  const allDay = eventType === "birthday";
  const missingFields: string[] = [];
  if (!resolvedDate) {
    missingFields.push("date");
  }
  if (!allDay && !startTime) {
    missingFields.push("time");
  }
  const date = resolvedDate ?? getLocalTodayDateString();
  const title = cleanVoiceCalendarTitle(trimmed)
    || (eventType === "birthday" ? "Birthday" : eventType === "call" ? "Call reminder" : "Voice Calendar event");
  const sensitive = assistantSensitiveRegex.test(trimmed);
  const confidence: VoiceConfidence = missingFields.length === 0 && title !== "Voice Calendar event"
    ? "high"
    : missingFields.length <= 1
      ? "medium"
      : "low";
  const duration = Math.max(5, settings.defaultMeetingDurationMinutes || 30);

  return {
    id: createClientId("calendar-voice-candidate"),
    title,
    date,
    startTime: allDay ? null : startTime,
    endTime: allDay || !startTime ? null : addMinutesToTime(startTime, duration),
    allDay,
    recurrence: eventType === "birthday" ? "yearly-placeholder" : null,
    reminderLevel: /urgent/i.test(trimmed) ? "urgent" : "normal",
    notes: "Created from DexNest Voice command candidate.",
    sourcePhrasePreview: sensitive ? "" : trimmed.replace(/\s+/g, " ").slice(0, 140),
    confidence,
    missingFields,
    sensitivity: sensitive ? "sensitive" : "personal",
    eventType
  };
}

function calendarCandidateToActionParams(candidate: CalendarVoiceCandidate): Record<string, unknown> {
  return {
    title: candidate.title,
    date: candidate.date,
    startTime: candidate.allDay ? null : candidate.startTime,
    endTime: candidate.allDay ? null : candidate.endTime,
    allDay: candidate.allDay,
    sourceModule: "voice",
    sourceId: candidate.id,
    recurrence: candidate.recurrence || null,
    reminderLevel: candidate.reminderLevel,
    notes: candidate.notes
  };
}

function buildVoiceCalendarParams(input: string, settings = defaultVoiceWorkflowSettings): Record<string, unknown> {
  const candidate = parseCalendarVoiceCandidate(input, settings);
  return candidate ? calendarCandidateToActionParams(candidate) : {
    title: cleanVoiceCalendarTitle(input) || "Voice Calendar event",
    date: getLocalTodayDateString(),
    startTime: null,
    allDay: true,
    sourceModule: "voice",
    sourceId: `voice-${Date.now()}`,
    recurrence: null,
    reminderLevel: "normal",
    notes: "Created from DexNest Voice command candidate."
  };
}

function parseCalendarLookupIntent(input: string): "calendar_show_today" | "calendar_show_upcoming" | null {
  const normalized = normalizeVoiceCommand(input);
  if (/\b(what do i have today|show today'?s calendar|show today calendar|calendar today|what is today)\b/.test(normalized)) {
    return "calendar_show_today";
  }
  if (/\b(what is tomorrow|show upcoming events|upcoming events|next event|what'?s next|what is my next event)\b/.test(normalized)) {
    return "calendar_show_upcoming";
  }
  return null;
}

function shouldAutoCreateCalendarCandidate(candidate: CalendarVoiceCandidate, settings: VoiceWorkflowSettings): boolean {
  if (!settings.autoCreateHighConfidenceCalendarVoiceEvents || candidate.confidence !== "high" || candidate.missingFields.length > 0) {
    return false;
  }
  return !(candidate.recurrence && settings.askBeforeRecurringEvents);
}

function updatedCalendarCandidate(candidate: CalendarVoiceCandidate, patch: Partial<CalendarVoiceCandidate>, settings = defaultVoiceWorkflowSettings): CalendarVoiceCandidate {
  const next = { ...candidate, ...patch };
  const missingFields: string[] = [];
  if (!next.date) {
    missingFields.push("date");
  }
  if (!next.allDay && !next.startTime) {
    missingFields.push("time");
  }
  const startTime = next.allDay ? null : next.startTime;
  return {
    ...next,
    startTime,
    endTime: next.allDay ? null : (next.endTime || (startTime ? addMinutesToTime(startTime, settings.defaultMeetingDurationMinutes || 30) : null)),
    missingFields,
    confidence: missingFields.length === 0 ? "high" : missingFields.length === 1 ? "medium" : "low"
  };
}

function parseCalendarFollowUpPatch(input: string, candidate: CalendarVoiceCandidate, settings = defaultVoiceWorkflowSettings): Partial<CalendarVoiceCandidate> | null {
  const patch: Partial<CalendarVoiceCandidate> = {};
  if (candidate.missingFields.includes("time") || /\b(at\s+)?\d{1,2}(?::\d{2})?\s*(am|pm)?\b|\bmorning|afternoon|evening|tonight\b/i.test(input)) {
    const time = parseCalendarVoiceTime(input, settings);
    if (time) {
      patch.startTime = time;
      patch.endTime = addMinutesToTime(time, settings.defaultMeetingDurationMinutes || 30);
      patch.allDay = false;
    }
  }
  if (candidate.missingFields.includes("date") || /\b(today|tomorrow|tonight|in\s+\d{1,3}\s+days?|this|next|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(input)) {
    const date = resolveCalendarVoiceDate(input);
    if (date) {
      patch.date = date;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function extractFinderQuery(input: string): string {
  return input
    .replace(/\b(where did i put|where is|where are|find my|find the|find)\b/gi, "")
    .replace(/\b(my|the)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchQuery(input: string): string {
  return input
    .replace(/\b(search for|search|find document|find file|find docs?|look up)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCaptureNote(input: string): string {
  return input
    .replace(/\b(capture this note|capture note|save note|remember this|add this to inbox|capture this)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findDevRunAction(input: string, actions: ActionDefinition[]): ActionDefinition | undefined {
  const normalized = normalizeVoiceCommand(input);
  const commandKey = normalized.includes("typecheck") || normalized.includes("type check")
    ? "typecheck"
    : normalized.includes("build")
      ? "build"
      : normalized.includes("test")
        ? "test"
        : normalized.includes("start") || normalized.includes("dev")
          ? "start"
          : null;
  if (!commandKey) {
    return undefined;
  }

  const candidates = actions.filter((action) => action.id.startsWith("dev.project.") && action.id.endsWith(`.run_${commandKey}`));
  return candidates.find((action) => /dexnest|desknest/i.test(action.title)) ?? candidates[0];
}

function performanceModeRouteFromText(text: string, actions: ActionDefinition[]): VoiceRouteResult | null {
  const normalized = normalizeVoiceCommand(text);
  const hasAction = (actionId: string) => actions.some((action) => action.id === actionId);
  const performancePhrase = /\b(performance mode|gaming mode)\b/i.test(normalized);
  if (!performancePhrase) {
    return null;
  }

  let actionId = "";
  if (/\b(toggle|switch)\b/i.test(normalized)) {
    actionId = "system.performance.toggle";
  } else if (/\b(turn on|enable|start)\b/i.test(normalized) || /\b(performance mode on|gaming mode on)\b/i.test(normalized)) {
    actionId = "system.performance.enable";
  } else if (/\b(turn off|disable|stop)\b/i.test(normalized) || /\b(performance mode off|gaming mode off)\b/i.test(normalized)) {
    actionId = "system.performance.disable";
  }
  if (!actionId || !hasAction(actionId)) {
    return null;
  }
  return {
    intent: "performance_mode",
    targetModule: "system",
    actionId,
    params: { reason: "assistant" },
    confidence: "high",
    requiresConfirmation: false,
    sensitivity: "none",
    explanation: "Routes directly to the registered DexNest Performance Mode action."
  };
}

function externalDeviceRouteFromText(text: string, actions: ActionDefinition[]): VoiceRouteResult | null {
  if (!/\b(light|lights|lamp|lamps|govee|device|devices)\b/i.test(text)) {
    return null;
  }
  const normalized = normalizeVoiceCommand(text);
  const hasAction = (actionId: string) => actions.some((action) => action.id === actionId);
  let actionId = "";
  const params: Record<string, unknown> = {};
  if (/\b(turn|switch)\s+on\b/i.test(normalized)) {
    actionId = "external.govee.turn_on";
  } else if (/\b(turn|switch)\s+off\b/i.test(normalized)) {
    actionId = "external.govee.turn_off";
  } else if (/\btoggle\b/i.test(normalized)) {
    actionId = "external.govee.toggle";
  } else if (/\b(dim|brighten|brightness|percent)\b/i.test(normalized) || /\b\d{1,3}\b/.test(normalized)) {
    // Note: normalizeVoiceCommand strips "%", so brightness is also detected from
    // a bare number ("set lights to 40[%]" → "set lights to 40").
    actionId = "external.govee.set_brightness";
    const percent = normalized.match(/\b(\d{1,3})\b/);
    params.brightness = percent ? Math.min(100, Math.max(1, Number(percent[1]))) : /\bdim\b/i.test(normalized) ? 25 : /\bbrighten\b/i.test(normalized) ? 75 : 60;
  } else if (/\b(warm|temperature|kelvin|cool white|white)\b/i.test(normalized)) {
    actionId = "external.govee.set_color_temperature";
    params.kelvin = /\bwarm\b/i.test(normalized) ? 2700 : 5000;
  } else if (/\b(blue|red|green|purple|pink|yellow|orange)\b/i.test(normalized)) {
    actionId = "external.govee.set_color";
    params.color = normalized.match(/\b(blue|red|green|purple|pink|yellow|orange)\b/i)?.[1].toLowerCase() ?? "blue";
  }
  if (!actionId || !hasAction(actionId)) {
    return null;
  }
  params.alias = extractGoveeAlias(normalized);
  return {
    intent: "external_device_control",
    targetModule: "external_devices",
    actionId,
    params,
    confidence: "high",
    requiresConfirmation: false,
    sensitivity: "none",
    explanation: "Routes to the registered DexNest External Devices Govee action."
  };
}

// Extracts the device/group alias from a normalized light command by stripping
// command verbs, on/off keywords, colors, numbers and modifiers — leaving the
// device noun phrase. Works regardless of word order ("turn off lights" and
// "turn lights off" both yield "lights"). Falls back to a sensible group alias.
function extractGoveeAlias(normalized: string): string {
  const stopWords = new RegExp(
    "\\b(please|can|could|you|the|a|an|to|by|at|of|my|turn|switch|toggle|set|make|change|dim|brighten|"
    + "on|off|up|down|warm|cool|cold|white|bright|dark|darker|brighter|color|colour|temperature|kelvin|"
    + "brightness|percent|percentage|degrees?|govee|device|devices)\\b",
    "gi"
  );
  const colorWords = /\b(blue|red|green|purple|pink|yellow|orange|cyan|magenta|teal)\b/gi;
  const alias = normalized
    .replace(stopWords, " ")
    .replace(colorWords, " ")
    .replace(/[0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return alias || "room lights";
}

function routeVoiceCommand(input: string, actions: ActionDefinition[], workflowSettings = defaultVoiceWorkflowSettings): VoiceRouteResult {
  const trimmed = input.trim();
  const normalized = normalizeVoiceCommand(trimmed);
  const sensitiveQuestion = /\b(sin|social insurance|passport|health card|work permit|permit number|document number|uci|expiry|expires|valid until)\b/i.test(trimmed);

  if (!trimmed) {
    return {
      intent: "unknown",
      targetModule: "command",
      params: {},
      confidence: "low",
      requiresConfirmation: false,
      sensitivity: "none",
      explanation: "Type or speak a DexNest command.",
      suggestions: ["Open Dev", "Search work permit", "Send clipboard to phone"]
    };
  }

  const performanceRoute = performanceModeRouteFromText(trimmed, actions);
  if (performanceRoute) {
    return performanceRoute;
  }

  if (/^(what|when|show|find).*\b(sin|social insurance|passport|health card|work permit|permit number|document number|uci|expiry|expires|valid until)\b/i.test(trimmed)) {
    return {
      intent: "smart_lookup",
      targetModule: "search",
      actionId: "search.smart_lookup",
      params: { question: trimmed },
      confidence: sensitiveQuestion ? "high" : "medium",
      requiresConfirmation: true,
      sensitivity: sensitiveQuestion ? "sensitive" : "personal",
      explanation: "Routes to local Smart Lookup using the existing Search index. Sensitive answers stay masked."
    };
  }

  const externalRoute = externalDeviceRouteFromText(trimmed, actions);
  if (externalRoute) {
    return externalRoute;
  }

  const calendarLookupIntent = parseCalendarLookupIntent(trimmed);
  if (calendarLookupIntent) {
    return buildRouteForIntent(calendarLookupIntent, trimmed, actions, workflowSettings) ?? {
      intent: calendarLookupIntent,
      targetModule: "calendar",
      actionId: calendarLookupIntent === "calendar_show_today" ? "calendar.show_today" : "calendar.show_upcoming",
      params: {},
      confidence: "high",
      requiresConfirmation: false,
      sensitivity: "personal",
      explanation: "Opens the requested local DexNest Calendar view."
    };
  }

  if (isStartCaptureCommand(trimmed)) {
    return {
      intent: "capture_note",
      targetModule: "capture",
      actionId: "voice.workflow.start",
      params: { workflowMode: "capture_note", targetModule: "capture" },
      confidence: "high",
      requiresConfirmation: false,
      sensitivity: "personal",
      explanation: "Starts DexNest Capture voice mode using the shared local Speech Service."
    };
  }

  const finderAdd = parseFinderAddPhrase(trimmed);
  if (finderAdd) {
    return {
      intent: "finder_add",
      targetModule: "finder",
      actionId: "finder.create_item",
      params: {
        itemName: finderAdd.itemName,
        location: finderAdd.location,
        room: finderAdd.room,
        container: finderAdd.container,
        notes: finderAdd.notes,
        confidence: finderAdd.confidence === "high" ? "sure" : "maybe",
        updateExisting: true
      },
      confidence: finderAdd.confidence,
      requiresConfirmation: finderAdd.confidence !== "high",
      sensitivity: "personal",
      explanation: "Creates or updates a DexNest Finder item-location memory."
    };
  }

  const finderLookup = parseFinderLookupPhrase(trimmed);
  if (finderLookup) {
    return {
      intent: finderLookup.kind === "location" ? "finder_reverse_lookup" : "finder_search",
      targetModule: "finder",
      actionId: finderLookup.kind === "location" ? "finder.reverse_lookup" : "finder.search_items",
      params: { query: finderLookup.query },
      confidence: finderLookup.query ? "high" : "low",
      requiresConfirmation: false,
      sensitivity: "personal",
      explanation: finderLookup.kind === "location" ? "Runs a DexNest Finder reverse lookup." : "Searches DexNest Finder item-location records."
    };
  }

  const calendarCandidate = parseCalendarVoiceCandidate(trimmed, workflowSettings);
  if (calendarCandidate) {
    return {
      intent: "calendar_create_candidate",
      targetModule: "calendar",
      actionId: "voice.workflow.calendar_candidate",
      params: { candidate: calendarCandidate },
      confidence: calendarCandidate.confidence,
      requiresConfirmation: true,
      sensitivity: calendarCandidate.sensitivity,
      explanation: "Creates an editable Calendar event candidate. DexNest will not add it until you confirm."
    };
  }

  if (/\b(where did i put|where is|where are|find my)\b/i.test(trimmed)) {
    const query = extractFinderQuery(trimmed);
    return {
      intent: "finder_search",
      targetModule: "finder",
      actionId: "finder.search_items",
      params: { query },
      confidence: query ? "high" : "low",
      requiresConfirmation: true,
      sensitivity: "personal",
      explanation: "Searches DexNest Finder item-location records."
    };
  }

  if (/\b(send|share).*\b(clipboard|this|current).*\b(phone|drop)\b/i.test(trimmed) || /\bsend clipboard to phone\b/i.test(trimmed)) {
    return {
      intent: "drop_send_clipboard",
      targetModule: "drop",
      actionId: "drop.send_clipboard_to_drop",
      params: {},
      confidence: "high",
      requiresConfirmation: true,
      sensitivity: "personal",
      explanation: "Sends the current Windows clipboard to DexNest Drop for phone pickup."
    };
  }

  const devRunAction = /\brun\b/i.test(trimmed) ? findDevRunAction(trimmed, actions) : undefined;
  if (devRunAction) {
    return {
      intent: "dev_run_command",
      targetModule: "dev",
      actionId: devRunAction.id,
      params: { confirmedDangerous: devRunAction.dangerLevel === "danger" || devRunAction.dangerLevel === "critical" },
      confidence: "medium",
      requiresConfirmation: true,
      sensitivity: "none",
      explanation: `Runs the registered Dev action "${devRunAction.title}" after confirmation.`
    };
  }

  if (/\b(open|show|go to)\b.*\b(today'?s journal|journal today|journal)\b/i.test(trimmed)) {
    return {
      intent: "journal_open_today",
      targetModule: "journal",
      actionId: "journal.open_today",
      params: {},
      confidence: "high",
      requiresConfirmation: true,
      sensitivity: "personal",
      explanation: "Opens today's local DexNest Journal view."
    };
  }

  for (const [alias, target] of Object.entries(voiceModuleAliases)) {
    if (new RegExp(`\\b(open|show|go to)\\s+${alias}\\b`, "i").test(normalized)) {
      return {
        intent: "open_module",
        targetModule: target.module,
        actionId: target.actionId,
        params: {},
        confidence: "high",
        requiresConfirmation: true,
        sensitivity: "none",
        explanation: `Opens DexNest ${target.module}.`
      };
    }
  }

  if (/^\s*(search|find document|find file|find docs?|look up)\b/i.test(trimmed)) {
    const query = extractSearchQuery(trimmed);
    return {
      intent: "search_query",
      targetModule: "search",
      actionId: "search.run_query",
      params: { query, sourceModule: "all", fileType: "all", dateFrom: "", dateTo: "" },
      confidence: query ? "high" : "low",
      requiresConfirmation: true,
      sensitivity: "personal",
      explanation: "Runs a local DexNest Search query against the current manual index."
    };
  }

  if (/^\s*(capture this note|capture note|save note|remember this|add this to inbox|capture this)\b/i.test(trimmed)) {
    const text = extractCaptureNote(trimmed) || trimmed;
    return {
      intent: "capture_note",
      targetModule: "capture",
      actionId: "capture.create_note",
      params: { title: text.slice(0, 60) || "Voice capture", text, type: "note", source: "command" },
      confidence: "medium",
      requiresConfirmation: true,
      sensitivity: "personal",
      explanation: "Creates a Capture inbox item after confirmation."
    };
  }

  return {
    intent: "unknown",
    targetModule: "command",
    params: { transcriptLength: trimmed.length },
    confidence: "low",
    requiresConfirmation: false,
    sensitivity: sensitiveQuestion ? "sensitive" : "none",
    explanation: "DexNest could not map this to a safe local action.",
    suggestions: ["Try: What is my work permit number?", "Try: Add meeting with Tim tomorrow at 3", "Try: Where did I put my passport?", "Try: Search work permit"]
  };
}

// Fast deterministic command router (Phase 23 Part D). Handles obvious commands
// instantly without ever calling Ollama. Returns null for anything it is not
// confident about, so the rules router + optional LLM can take over.
function fastCommandRouter(text: string, actions: ActionDefinition[], workflowSettings = defaultVoiceWorkflowSettings): VoiceRouteResult | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeVoiceCommand(trimmed);
  const hasAction = (actionId: string) => actions.some((action) => action.id === actionId);

  // Part E: Performance / gaming mode.
  const performanceRoute = performanceModeRouteFromText(trimmed, actions);
  if (performanceRoute) {
    return performanceRoute;
  }

  // Part F/G: Govee lights, lamps and groups.
  const externalRoute = externalDeviceRouteFromText(trimmed, actions);
  if (externalRoute) {
    return externalRoute;
  }

  // Part H: Security — lock sensitive session / lock vault / open secure vault.
  if (/\block\b/.test(normalized) && /\b(sensitive|session)\b/.test(normalized) && hasAction("assistant.lock_session")) {
    return {
      intent: "security_action",
      targetModule: "search",
      actionId: "assistant.lock_session",
      params: {},
      confidence: "high",
      requiresConfirmation: false,
      sensitivity: "none",
      explanation: "Locks the trusted sensitive session."
    };
  }
  if (/\block\b/.test(normalized) && /\b(secure\s+)?vault\b/.test(normalized) && hasAction("vault.secure.lock")) {
    return {
      intent: "security_action",
      targetModule: "vault",
      actionId: "vault.secure.lock",
      params: {},
      confidence: "high",
      requiresConfirmation: false,
      sensitivity: "none",
      explanation: "Locks the DexNest Secure Vault."
    };
  }
  if (/\b(open|show|go to)\b/.test(normalized) && /\bsecure vault\b/.test(normalized) && hasAction("vault.open")) {
    return {
      intent: "security_action",
      targetModule: "vault",
      actionId: "vault.open",
      params: {},
      confidence: "high",
      requiresConfirmation: false,
      sensitivity: "none",
      explanation: "Opens the DexNest Vault."
    };
  }

  // Part H: Open today's journal.
  if (/\b(open|show|go to|start)\b.*\b(today'?s journal|journal today|journal)\b/.test(normalized) && hasAction("journal.open_today")) {
    return buildRouteForIntent("journal_open_today", trimmed, actions, workflowSettings);
  }

  const calendarLookupIntent = parseCalendarLookupIntent(trimmed);
  if (calendarLookupIntent && hasAction(calendarLookupIntent === "calendar_show_today" ? "calendar.show_today" : "calendar.show_upcoming")) {
    return buildRouteForIntent(calendarLookupIntent, trimmed, actions, workflowSettings);
  }

  const calendarCandidate = parseCalendarVoiceCandidate(trimmed, workflowSettings);
  if (calendarCandidate && hasAction("voice.workflow.calendar_candidate")) {
    return buildRouteForIntent("calendar_create_candidate", trimmed, actions, workflowSettings);
  }

  // Part H: Open module ("open calendar", "open vault", …).
  if (isStartCaptureCommand(trimmed) && hasAction("voice.workflow.start")) {
    return buildRouteForIntent("capture_note", trimmed, actions, workflowSettings);
  }

  const finderAdd = parseFinderAddPhrase(trimmed);
  if (finderAdd && hasAction("finder.create_item")) {
    return buildRouteForIntent("finder_add", trimmed, actions, workflowSettings);
  }

  const finderLookup = parseFinderLookupPhrase(trimmed);
  if (finderLookup && hasAction(finderLookup.kind === "location" ? "finder.reverse_lookup" : "finder.search_items")) {
    return buildRouteForIntent(finderLookup.kind === "location" ? "finder_reverse_lookup" : "finder_search", trimmed, actions, workflowSettings);
  }

  if (/\b(open|show|go to)\b/.test(normalized)) {
    const target = detectModuleAliasFromText(trimmed);
    if (target && hasAction(target.actionId)) {
      return buildRouteForIntent("open_module", trimmed, actions, workflowSettings);
    }
  }

  // Part H: Smart Lookup for sensitive document fields.
  if (/^(what|when|where|show|find|tell me)\b/.test(normalized) && assistantSensitiveRegex.test(trimmed)) {
    return buildRouteForIntent("smart_lookup", trimmed, actions, workflowSettings);
  }

  // Part H: Finder location questions.
  if (/\b(where is|where did i put|where are|what is in|what's in)\b/.test(normalized)) {
    return buildRouteForIntent("finder_search", trimmed, actions, workflowSettings);
  }

  // Part H: Keyword search.
  if (/^\s*(search|find document|find file|find docs?|look up|find my)\b/.test(normalized)) {
    return buildRouteForIntent("search_query", trimmed, actions, workflowSettings);
  }

  // Part H: Send clipboard to phone (still confirmed downstream).
  if (/\bsend clipboard to phone\b/.test(normalized) || (/\b(send|share)\b/.test(normalized) && /\bclipboard\b/.test(normalized) && /\b(phone|drop)\b/.test(normalized))) {
    return buildRouteForIntent("drop_send_clipboard", trimmed, actions, workflowSettings);
  }

  // Part H: Dev run commands (still confirmed downstream).
  if (/\brun\b/.test(normalized)) {
    const devRoute = buildRouteForIntent("dev_run_command", trimmed, actions, workflowSettings);
    if (devRoute) {
      return devRoute;
    }
  }

  return null;
}

const assistantSensitiveRegex = /\b(sin|social insurance|passport|health card|work permit|permit number|document number|uci|expiry|expires|valid until)\b/i;

// --- Journal continuous voice mode helpers (Phase 23.4) --------------------
type JournalVoiceControl = "save" | "pause" | "resume" | "cancel";

function isStartJournalCommand(text: string): boolean {
  return /\b(start (?:today'?s )?journal|start my journal|open today'?s journal and start dictation|begin journal entry|start diary|begin diary|journal mode|start dictation)\b/i.test(text.trim());
}

// Detect control commands spoken/typed while in journal dictation mode.
function matchJournalControl(text: string): JournalVoiceControl | null {
  const t = text.toLowerCase().trim();
  if (/\b(save journal|save entry|finish journal|finish diary|stop journal|stop diary|save and stop)\b/.test(t)) {
    return "save";
  }
  if (/\b(cancel journal|cancel dictation|stop without saving|discard journal)\b/.test(t)) {
    return "cancel";
  }
  if (/\b(pause journal|pause dictation)\b/.test(t)) {
    return "pause";
  }
  if (/\b(resume journal|resume dictation|continue journal)\b/.test(t)) {
    return "resume";
  }
  return null;
}

// Build a short local title from the first dictation chunk (no Ollama).
function autoTitleFromChunk(chunk: string): string {
  const words = chunk.trim().replace(/[.?!,]+$/, "").split(/\s+/).slice(0, 6).join(" ");
  return words.slice(0, 48) || "Journal entry";
}

type JournalVoiceStatus = "idle" | "starting" | "listening" | "transcribing" | "appending" | "paused" | "saved" | "cancelled" | "error";

interface JournalVoiceState {
  mode: "none" | "journal_dictation";
  status: JournalVoiceStatus;
  startedAt: number | null;
  source: string;
  activeEntryId: string | null;
  chunksCount: number;
  lastSavedAt: number | null;
  lastTranscriptPreview: string;
  sensitivity: "none" | "sensitive";
  error: string;
}

const defaultJournalVoiceState: JournalVoiceState = {
  mode: "none",
  status: "idle",
  startedAt: null,
  source: "voice",
  activeEntryId: null,
  chunksCount: 0,
  lastSavedAt: null,
  lastTranscriptPreview: "",
  sensitivity: "none",
  error: ""
};

// --- Local wake word "Nest" MVP (Phase 23.8) -------------------------------
// This MVP ships the wake-word SERVICE INTERFACE and a manual Test trigger.
// No real always-on local wake engine (openWakeWord/Porcupine) is bundled yet,
// so the engine status is reported honestly as a placeholder — faster-whisper is
// never run continuously to fake wake detection.
type WakeWordStatus =
  | "disabled"
  | "starting"
  | "listening_for_nest"
  | "wake_detected"
  | "recording_command"
  | "transcribing"
  | "routing"
  | "paused_by_performance_mode"
  | "error";

interface WakeWordMetrics {
  wakeDetectedAt: number | null;
  commandRecordingStartLatencyMs: number | null;
  totalWakeToActionMs: number | null;
}

interface WakeWordServiceState {
  status: WakeWordStatus;
  engine: string;
  engineInstalled: boolean;
  lastError: string;
  metrics: WakeWordMetrics;
}

// Real main-process wake engine state (Phase 23.9).
interface WakeEngineState {
  status: "disabled" | "starting" | "listening_for_nest" | "wake_detected" | "recording_command" | "paused_by_performance_mode" | "engine_missing" | "error";
  installStatus: "unknown" | "ready" | "missing_dependencies" | "missing_model";
  lastError: string;
  detectionsCount: number;
  lastDetectedAt: number | null;
  scriptPath: string;
}

const defaultWakeEngineState: WakeEngineState = {
  status: "disabled",
  installStatus: "unknown",
  lastError: "",
  detectionsCount: 0,
  lastDetectedAt: null,
  scriptPath: ""
};

type WakeListener = (source: string) => void;

// Clean service interface. A real engine would implement detection inside start()
// and invoke the registered onWake callback; the placeholder only exposes the
// shape and lets the Test trigger fire the same callback path.
const wakeWordService = (() => {
  let started = false;
  let sensitivity = 0.5;
  let listener: WakeListener | null = null;
  return {
    start(): void { started = true; },
    stop(): void { started = false; },
    isRunning(): boolean { return started; },
    status(): { running: boolean; engineInstalled: boolean } {
      // No local engine bundled in this MVP → not installed.
      return { running: started, engineInstalled: false };
    },
    onWake(callback: WakeListener): void { listener = callback; },
    setSensitivity(value: number): void { sensitivity = Math.min(1, Math.max(0, value)); },
    getSensitivity(): number { return sensitivity; },
    // Used by the Test wake trigger (and a real engine on detection).
    fireWake(source = "ambient_wake_word"): void { listener?.(source); },
    dispose(): void { started = false; listener = null; }
  };
})();

// Set when a wake word fires so the next shared capture can measure
// wake→recording-start latency (Phase 23.10). 0 = not from a wake.
let lastWakeDetectedAtForMetric = 0;

const defaultTtsDiagnostics: TtsDiagnostics = {
  available: typeof window !== "undefined" && "speechSynthesis" in window,
  voicesCount: 0,
  selectedVoice: "System default",
  lastAttemptedAt: null,
  lastSpoken: false,
  blockedReason: "",
  error: "",
  lastSource: "",
  lastActionId: "",
  lastTextPreview: ""
};

function getTtsDiagnosticsSnapshot(selectedVoiceName?: string | null): Pick<TtsDiagnostics, "available" | "voicesCount" | "selectedVoice"> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return { available: false, voicesCount: 0, selectedVoice: selectedVoiceName || "System default" };
  }
  const voices = window.speechSynthesis.getVoices();
  const selected = selectedVoiceName ? voices.find((voice) => voice.name === selectedVoiceName) : null;
  return {
    available: true,
    voicesCount: voices.length,
    selectedVoice: selected?.name ?? selectedVoiceName ?? "System default"
  };
}

function clampTtsRate(value: number | undefined): number {
  return Math.min(2, Math.max(0.5, Number.isFinite(value) ? Number(value) : 1));
}

function clampTtsVolume(value: number | undefined): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? Number(value) : 1));
}

// Short local "wake" chime via WebAudio (no audio file, no network).
function playWakeChime(volume = 0.35): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      return;
    }
    const peak = Math.max(0.0002, Math.min(0.3, volume * 0.26));
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Short + soft so it cannot block recording or bleed into the command
    // (echo cancellation on the capture stream also suppresses it).
    osc.type = "sine";
    osc.frequency.setValueAtTime(740, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.07);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    // ignore — chime is best-effort
  }
}

// Remove a leading wake word ("Nest, turn off lights" → "turn off lights").
function stripWakeWord(transcript: string, wakeWord: string): string {
  const word = (wakeWord || "Nest").trim();
  const pattern = new RegExp(`^\\s*${word.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b[\\s,.:!-]*`, "i");
  return transcript.replace(pattern, "").trim() || transcript.trim();
}

type VoiceWorkflowMode = "none" | "assistant_command" | "journal_dictation" | "capture_note" | "finder_add" | "calendar_create";
type VoiceWorkflowStatus = "idle" | "starting" | "listening" | "transcribing" | "saving" | "saved" | "candidate" | "lookup_complete" | "paused" | "cancelled" | "error";

interface FinderVoiceCandidate {
  itemName: string;
  location: string;
  room: string;
  container: string;
  notes: string;
  confidence: VoiceConfidence;
  sourceText: string;
}

interface VoiceWorkflowState {
  mode: VoiceWorkflowMode;
  status: VoiceWorkflowStatus;
  startedAt: number | null;
  source: string;
  targetModule: "capture" | "finder" | "calendar" | "";
  activeEntityId: string | null;
  chunksCount: number;
  lastSavedAt: number | null;
  lastTranscriptPreview: string;
  error: string;
  confidence?: VoiceConfidence;
  missingFields?: string[];
  candidate?: FinderVoiceCandidate | null;
  calendarCandidate?: CalendarVoiceCandidate | null;
}

const defaultVoiceWorkflowState: VoiceWorkflowState = {
  mode: "none",
  status: "idle",
  startedAt: null,
  source: "voice",
  targetModule: "",
  activeEntityId: null,
  chunksCount: 0,
  lastSavedAt: null,
  lastTranscriptPreview: "",
  error: "",
  confidence: undefined,
  missingFields: [],
  candidate: null,
  calendarCandidate: null
};

type FinderLookupKind = "item" | "location";

interface FinderVoiceLookup {
  kind: FinderLookupKind;
  query: string;
}

function isSensitiveCaptureText(text: string): boolean {
  return assistantSensitiveRegex.test(text) || /\b(password|api key|token|recovery code|sin number|social insurance)\b/i.test(text);
}

function isStartCaptureCommand(text: string): boolean {
  return /\b(capture this|remember this|new note|quick note|save a note|add to inbox|start capture)\b/i.test(text.trim());
}

function matchCaptureControl(text: string): "save" | "stop" | "cancel" | null {
  const normalized = normalizeVoiceCommand(text);
  if (/\b(cancel capture|discard capture)\b/.test(normalized)) {
    return "cancel";
  }
  if (/\b(save capture|save note|finish capture)\b/.test(normalized)) {
    return "save";
  }
  if (/\b(stop capture|stop listening)\b/.test(normalized)) {
    return "stop";
  }
  return null;
}

function titleFromVoiceText(text: string, fallback: string): string {
  return text.trim().replace(/[.?!,]+$/g, "").split(/\s+/).slice(0, 7).join(" ").slice(0, 64) || fallback;
}

function cleanFinderItemName(value: string): string {
  return value
    .replace(/^\b(remember|my|the|a|an|i put|i kept)\b\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFinderLocation(value: string): string {
  return value
    .replace(/\b(right now|please|for me)\b/gi, "")
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferFinderRoom(location: string): string {
  const match = location.match(/\b(kitchen|bedroom|office|bathroom|living room|garage|basement|closet|desk|drawer)\b/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function inferFinderContainer(location: string): string {
  const match = location.match(/\b([a-z0-9 -]*(drawer|box|folder|shelf|cabinet|suitcase|bag|backpack|desk|closet|wallet)[a-z0-9 -]*)\b/i);
  return match?.[1]?.trim().toLowerCase() ?? "";
}

function parseFinderAddPhrase(text: string): FinderVoiceCandidate | null {
  const trimmed = text.trim().replace(/[“”]/g, "\"");
  const patterns = [
    /\bremember\s+(.{2,80}?)\s+(?:is|are)\s+(?:in|on|beside|under|inside|at)\s+(.{2,100})$/i,
    /\b(?:my\s+)?(.{2,80}?)\s+(?:is|are)\s+(?:in|on|beside|under|inside|at)\s+(.{2,100})$/i,
    /\bi\s+(?:put|kept)\s+(.{2,80}?)\s+(?:in|on|beside|under|inside|at)\s+(.{2,100})$/i
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) {
      continue;
    }
    const itemName = cleanFinderItemName(match[1] ?? "");
    const location = cleanFinderLocation(match[2] ?? "");
    if (!itemName || !location) {
      continue;
    }
    const vague = /\b(this|that|it|something|stuff|thing)\b/i.test(itemName) || itemName.length < 3 || location.length < 4;
    const confidence: VoiceConfidence = vague ? "medium" : "high";
    return {
      itemName,
      location,
      room: inferFinderRoom(location),
      container: inferFinderContainer(location),
      notes: "Added from DexNest voice workflow.",
      confidence,
      sourceText: trimmed
    };
  }
  return null;
}

function parseFinderLookupPhrase(text: string): FinderVoiceLookup | null {
  const normalized = normalizeVoiceCommand(text);
  const locationMatch = normalized.match(/\b(?:what is in|what's in|what do i keep in)\s+(.{2,80})$/i);
  if (locationMatch?.[1]) {
    return { kind: "location", query: cleanFinderLocation(locationMatch[1]) };
  }
  const itemMatch = normalized.match(/\b(?:where is my|where is the|where did i put my|where did i put the|find my|find the)\s+(.{2,80})$/i);
  if (itemMatch?.[1]) {
    return { kind: "item", query: cleanFinderItemName(itemMatch[1]) };
  }
  return null;
}

function detectModuleAliasFromText(text: string): { module: ViewId; actionId: string } | null {
  const normalized = normalizeVoiceCommand(text);
  for (const [alias, target] of Object.entries(voiceModuleAliases)) {
    if (new RegExp(`\\b${alias}\\b`, "i").test(normalized)) {
      return target;
    }
  }
  return null;
}

// Deterministically build a safe route for a known intent. DexNest — not the
// LLM — chooses the actionId and params here, so the model can only pick an
// intent category. Returns null when no safe registered action can be built.
function buildRouteForIntent(intent: VoiceIntentName, text: string, actions: ActionDefinition[], workflowSettings = defaultVoiceWorkflowSettings): VoiceRouteResult | null {
  const trimmed = text.trim();
  const sensitive = assistantSensitiveRegex.test(trimmed);

  switch (intent) {
    case "smart_lookup":
      return {
        intent,
        targetModule: "search",
        actionId: "search.smart_lookup",
        params: { question: trimmed },
        confidence: sensitive ? "high" : "medium",
        requiresConfirmation: true,
        sensitivity: sensitive ? "sensitive" : "personal",
        explanation: "Routes to local Smart Lookup using the existing Search index. Sensitive answers stay masked."
      };
    case "search_query": {
      const query = extractSearchQuery(trimmed) || trimmed;
      return {
        intent,
        targetModule: "search",
        actionId: "search.run_query",
        params: { query, sourceModule: "all", fileType: "all", dateFrom: "", dateTo: "" },
        confidence: query ? "high" : "low",
        requiresConfirmation: false,
        sensitivity: "personal",
        explanation: "Runs a local DexNest Search query against the current manual index."
      };
    }
    case "finder_search": {
      const lookup = parseFinderLookupPhrase(trimmed);
      const query = lookup?.query || extractFinderQuery(trimmed) || trimmed;
      return {
        intent,
        targetModule: "finder",
        actionId: "finder.search_items",
        params: { query },
        confidence: query ? "high" : "low",
        requiresConfirmation: false,
        sensitivity: "personal",
        explanation: "Searches DexNest Finder item-location records."
      };
    }
    case "finder_reverse_lookup": {
      const lookup = parseFinderLookupPhrase(trimmed);
      const query = lookup?.query || extractFinderQuery(trimmed) || trimmed;
      return {
        intent,
        targetModule: "finder",
        actionId: "finder.reverse_lookup",
        params: { query },
        confidence: query ? "high" : "low",
        requiresConfirmation: false,
        sensitivity: "personal",
        explanation: "Runs a DexNest Finder reverse lookup for a location or container."
      };
    }
    case "finder_add": {
      const candidate = parseFinderAddPhrase(trimmed);
      if (!candidate) {
        return null;
      }
      return {
        intent,
        targetModule: "finder",
        actionId: "finder.create_item",
        params: {
          itemName: candidate.itemName,
          location: candidate.location,
          room: candidate.room,
          container: candidate.container,
          notes: candidate.notes,
          confidence: candidate.confidence === "high" ? "sure" : "maybe",
          updateExisting: true
        },
        confidence: candidate.confidence,
        requiresConfirmation: candidate.confidence !== "high",
        sensitivity: "personal",
        explanation: "Creates or updates a DexNest Finder item-location memory."
      };
    }
    case "calendar_create_candidate":
      {
        const candidate = parseCalendarVoiceCandidate(trimmed, workflowSettings);
        if (!candidate) {
          return null;
        }
        return {
          intent,
          targetModule: "calendar",
          actionId: "voice.workflow.calendar_candidate",
          params: { candidate },
          confidence: candidate.confidence,
          requiresConfirmation: true,
          sensitivity: candidate.sensitivity,
          explanation: "Creates an editable Calendar event candidate. DexNest will not add it until you confirm."
        };
      }
    case "calendar_show_today":
      return {
        intent,
        targetModule: "calendar",
        actionId: "calendar.show_today",
        params: {},
        confidence: "high",
        requiresConfirmation: false,
        sensitivity: "personal",
        explanation: "Opens today's local DexNest Calendar events."
      };
    case "calendar_show_upcoming":
      return {
        intent,
        targetModule: "calendar",
        actionId: "calendar.show_upcoming",
        params: {},
        confidence: "high",
        requiresConfirmation: false,
        sensitivity: "personal",
        explanation: "Opens upcoming local DexNest Calendar events."
      };
    case "drop_send_clipboard":
      return {
        intent,
        targetModule: "drop",
        actionId: "drop.send_clipboard_to_drop",
        params: {},
        confidence: "high",
        requiresConfirmation: true,
        sensitivity: "personal",
        explanation: "Sends the current Windows clipboard to DexNest Drop for phone pickup."
      };
    case "external_device_control":
      return externalDeviceRouteFromText(trimmed, actions);
    case "dev_run_command": {
      const devRunAction = findDevRunAction(trimmed, actions);
      if (!devRunAction) {
        return null;
      }
      return {
        intent,
        targetModule: "dev",
        actionId: devRunAction.id,
        params: { confirmedDangerous: devRunAction.dangerLevel === "danger" || devRunAction.dangerLevel === "critical" },
        confidence: "medium",
        requiresConfirmation: true,
        sensitivity: "none",
        explanation: `Runs the registered Dev action "${devRunAction.title}" after confirmation.`
      };
    }
    case "journal_open_today":
      return {
        intent,
        targetModule: "journal",
        actionId: "journal.open_today",
        params: {},
        confidence: "high",
        requiresConfirmation: false,
        sensitivity: "personal",
        explanation: "Opens today's local DexNest Journal view."
      };
    case "open_module": {
      const target = detectModuleAliasFromText(trimmed);
      if (!target) {
        return null;
      }
      return {
        intent,
        targetModule: target.module,
        actionId: target.actionId,
        params: {},
        confidence: "high",
        requiresConfirmation: false,
        sensitivity: "none",
        explanation: `Opens DexNest ${target.module}.`
      };
    }
    case "capture_note": {
      return {
        intent,
        targetModule: "capture",
        actionId: "voice.workflow.start",
        params: { workflowMode: "capture_note", targetModule: "capture" },
        confidence: "high",
        requiresConfirmation: false,
        sensitivity: "personal",
        explanation: "Starts DexNest Capture voice mode using the shared local Speech Service."
      };
    }
    default:
      return null;
  }
}

function maxSensitivity(a: VoiceSensitivity, b: VoiceSensitivity): VoiceSensitivity {
  const order: VoiceSensitivity[] = ["none", "personal", "sensitive"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

// Validate a raw LLM intent object against the registered action list and the
// allowed intent enum. The LLM's actionId/params are intentionally discarded;
// only the intent category (plus a sensitivity hint) is trusted.
function validateLlmIntent(raw: Record<string, unknown> | undefined, text: string, actions: ActionDefinition[], workflowSettings = defaultVoiceWorkflowSettings): VoiceRouteResult | null {
  if (!raw) {
    return null;
  }
  const intentValue = typeof raw.intent === "string" ? raw.intent : "unknown";
  const allowed: VoiceIntentName[] = ["smart_lookup", "search_query", "finder_search", "finder_add", "finder_reverse_lookup", "calendar_create_candidate", "calendar_show_today", "calendar_show_upcoming", "drop_send_clipboard", "open_module", "dev_run_command", "journal_open_today", "capture_note", "external_device_control", "unknown"];
  if (!allowed.includes(intentValue as VoiceIntentName) || intentValue === "unknown") {
    return null;
  }
  const built = buildRouteForIntent(intentValue as VoiceIntentName, text, actions, workflowSettings);
  if (!built || !built.actionId) {
    return null;
  }
  // Guard: only run actions that are actually registered.
  if (!actions.some((action) => action.id === built.actionId)) {
    return null;
  }
  const llmSensitivity = raw.sensitivity === "sensitive" || raw.sensitivity === "personal" || raw.sensitivity === "none" ? raw.sensitivity : "none";
  const llmConfidence = raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low" ? raw.confidence : built.confidence;
  return {
    ...built,
    confidence: llmConfidence,
    sensitivity: maxSensitivity(built.sensitivity, llmSensitivity),
    explanation: built.explanation
  };
}

function createClientId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sourceOpenActionId(sourceModule: string): string | null {
  const map: Record<string, string> = {
    capture: "capture.open",
    clipboard: "clipboard.open",
    dev: "dev.open_dashboard",
    drop: "drop.open",
    finance: "finance.open",
    finder: "finder.open",
    tools: "tools.open",
    tools_ocr: "tools.open",
    vault: "vault.open"
  };
  return map[sourceModule] ?? null;
}

// Friendly, user-facing chat copy per intent (no routing internals).
function assistantPendingText(route: VoiceRouteResult): string {
  switch (route.intent) {
    case "drop_send_clipboard":
      return "Send your current clipboard to your phone via DexNest Drop?";
    case "dev_run_command":
      return `Run this Dev command for DexNest? (${route.actionId ?? "dev"})`;
    case "calendar_create_candidate":
      return "I found an event candidate. Review and add it to your Calendar?";
    case "capture_note":
      return "Start DexNest Capture voice mode?";
    case "finder_add":
      return `Save this Finder memory?`;
    case "external_device_control":
      return "Run this External Devices action?";
    case "performance_mode":
      return "Change DexNest Performance Mode?";
    default:
      return "Ready to run. Confirm?";
  }
}

// --- Alexa-style spoken responses (Phase 23.11) ----------------------------
type DexNestErrorCode =
  | "provider_unavailable"
  | "device_not_found"
  | "credential_missing"
  | "credential_unavailable"
  | "confirmation_required"
  | "performance_mode_paused"
  | "speech_unavailable"
  | "action_failed"
  | "permission_denied"
  | "unknown";

// Normalize a raw action error into a safe code + short spoken sentence. Never
// exposes API keys, stack traces, or raw provider responses.
function normalizeActionError(message: string): { code: DexNestErrorCode; spoken: string } {
  const t = (message || "").toLowerCase();
  if (/credential is unavailable|could not decrypt|reconnect govee/.test(t)) {
    return { code: "credential_unavailable", spoken: "Govee is not connected." };
  }
  if (/not configured|api key|unlock secure vault|not connected|integration keychain/.test(t)) {
    return { code: "credential_missing", spoken: "Govee is not connected." };
  }
  if (/no .*device matched|device .*not found|no govee device|empty/.test(t)) {
    return { code: "device_not_found", spoken: "I couldn't find that light." };
  }
  if (/timed out|network|unreachable|http \d|could not reach|developer-api/.test(t)) {
    return { code: "provider_unavailable", spoken: "I couldn't reach Govee." };
  }
  if (/performance mode/.test(t)) {
    return { code: "performance_mode_paused", spoken: "Speech is paused by Performance Mode." };
  }
  if (/confirm/.test(t)) {
    return { code: "confirmation_required", spoken: "Open DexNest to confirm." };
  }
  if (/permission|denied|disabled in settings/.test(t)) {
    return { code: "permission_denied", spoken: "That is disabled in Settings." };
  }
  return { code: "action_failed", spoken: "Sorry, that didn't work." };
}


function assistantSuccessText(route: VoiceRouteResult, resultCount: number): string {
  switch (route.intent) {
    case "smart_lookup":
      return resultCount > 0
        ? "I found a likely answer in your Vault/OCR documents. It is masked for safety."
        : "I could not find a confident answer in your indexed documents.";
    case "finder_search":
      return resultCount > 0 ? "I found this in Finder." : "Finder search ran. Open Finder to see matches.";
    case "finder_reverse_lookup":
      return resultCount > 0 ? "I found items in that Finder location." : "No Finder items matched that location.";
    case "search_query":
      return resultCount > 0 ? `I found ${resultCount} matching document${resultCount === 1 ? "" : "s"}.` : "Search ran. No strong matches in the current index.";
    case "calendar_create_candidate":
      return "Added the event to your Calendar.";
    case "calendar_show_today":
      return "Opened today's Calendar.";
    case "calendar_show_upcoming":
      return "Opened upcoming Calendar events.";
    case "drop_send_clipboard":
      return "Sent your clipboard to DexNest Drop.";
    case "dev_run_command":
      return "Dev command finished. Check the Dev dashboard for output.";
    case "journal_open_today":
      return "Opened today's Journal.";
    case "open_module":
      return `Opened DexNest ${route.targetModule}.`;
    case "capture_note":
      return "Capture voice mode started.";
    case "finder_add":
      return "Saved to Finder.";
    case "external_device_control":
      return "External Devices action completed.";
    case "performance_mode":
      if (route.actionId === "system.performance.enable") {
        return "Performance Mode is on.";
      }
      if (route.actionId === "system.performance.disable") {
        return "Performance Mode is off.";
      }
      return "Performance Mode toggled.";
    case "security_action":
      if (route.actionId === "assistant.lock_session") {
        return "Sensitive session locked.";
      }
      if (route.actionId === "vault.secure.lock") {
        return "Secure Vault locked.";
      }
      return "Opened the Vault.";
    default:
      return "Done.";
  }
}

// Builds the assistant's answer line. For Smart Lookup it states the value only
// when it is non-sensitive or the trusted session auto-revealed it; otherwise it
// keeps the value masked and just names the source document.
function assistantAnswerText(route: VoiceRouteResult, smartResults: SmartLookupResult[], resultCount: number): string {
  if (route.intent === "smart_lookup") {
    const top = smartResults[0];
    if (!top) {
      return "I couldn't find a confident answer in your indexed documents.";
    }
    const field = top.fieldType.replace(/_/g, " ");
    if (!top.sensitive || top.autoRevealed) {
      return `Your ${field} from ${top.sourceDocumentTitle} is ${top.answer}.`;
    }
    return `I found it in ${top.sourceDocumentTitle}. It is masked for safety.`;
  }
  return assistantSuccessText(route, resultCount);
}

function finderItemLookupAnswer(query: string, results: FinderItem[]): string {
  const top = results[0];
  if (!top) {
    return `I could not find ${query || "that item"} in Finder. Want to add it?`;
  }
  return `${top.itemName} is in ${top.location}${top.container ? ` / ${top.container}` : ""}${top.room ? ` / ${top.room}` : ""}.`;
}

function finderReverseLookupAnswer(query: string, results: FinderItem[]): string {
  if (results.length === 0) {
    return `I could not find anything in ${query || "that location"} yet.`;
  }
  const names = results.slice(0, 5).map((item) => item.itemName).join(", ");
  const suffix = results.length > 5 ? `, and ${results.length - 5} more` : "";
  return `I found ${results.length} item${results.length === 1 ? "" : "s"} in ${query}: ${names}${suffix}.`;
}

// Redacts the user's question from debug routing details for sensitive intents,
// so sensitive transcripts/values never surface in the debug panel.
function assistantDebugParams(route: VoiceRouteResult): Record<string, unknown> {
  const params: Record<string, unknown> = { ...route.params };
  if (route.sensitivity === "sensitive" && "question" in params) {
    params.question = "[hidden]";
  }
  return params;
}

// State-changing or sensitive intents must be confirmed in chat before running.
function assistantNeedsConfirm(route: VoiceRouteResult, actions: ActionDefinition[]): boolean {
  if (["drop_send_clipboard", "dev_run_command"].includes(route.intent)) {
    return true;
  }
  if (route.intent === "finder_add" && route.confidence !== "high") {
    return true;
  }
  if (route.targetModule.toLowerCase() === "dev") {
    return true;
  }
  const action = route.actionId ? actions.find((item) => item.id === route.actionId) : undefined;
  if (action && (action.dangerLevel === "danger" || action.dangerLevel === "critical")) {
    return true;
  }
  return false;
}

function DexNestApp() {
  const [activeView, setActiveView] = useState<ViewId>("command");
  const activeViewRef = useRef<ViewId>("command");
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);
  // Load heavy, view-specific state once when entering its view (covers every
  // navigation path). While on the view, refreshShellData keeps it fresh.
  useEffect(() => {
    if (activeView === "search") { void getBridge().getSearchState().then(setSearchState).catch(() => undefined); }
    else if (activeView === "vault") { void getBridge().getVaultState().then(setVaultState).catch(() => undefined); }
    else if (activeView === "finder") { void getBridge().getFinderState().then(setFinderState).catch(() => undefined); }
    else if (activeView === "finance") { void getBridge().getFinanceState().then(setFinanceState).catch(() => undefined); }
    else if (activeView === "capture") { void getBridge().getCaptureState().then(setCaptureState).catch(() => undefined); }
    else if (activeView === "heatmap") { void getBridge().getHeatmapState().then(setHeatmapState).catch(() => undefined); }
    if (activeView === "settings") {
      void getBridge().getHeatmapState().then(setHeatmapState).catch(() => undefined);
      void getBridge().getBackupState().then(setBackupState).catch(() => undefined);
    }
  }, [activeView]);
  // Coalesce concurrent shell refreshes so bursts (clipboard listener + hotkey +
  // UI action) collapse into a single pass instead of stacking heavy reloads.
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [bootReady, setBootReady] = useState(false);
  const [bootStatus, setBootStatus] = useState("Loading DexNest…");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [actions, setActions] = useState<ActionDefinition[]>([]);
  const [projects, setProjects] = useState<DexNestProject[]>([]);
  const [commandResults, setCommandResults] = useState<Record<string, ProjectCommandResult>>({});
  const [pinnedActionIds, setPinnedActionIds] = useState<string[]>([]);
  const [clipboardState, setClipboardState] = useState<ClipboardState>({
    history: [],
    snippets: [],
    settings: {
      listenerEnabled: false,
      listenerIntervalMs: 2000,
      historyRetentionDays: 1,
      lastHistoryCleanupAt: null,
      multiCopyHotkeyEnabled: true,
      multiCopyHotkey: "CommandOrControl+Shift+C",
      multiCopyHotkeyStatus: "disabled",
      multiCopyHotkeyLastError: null,
      multiCopyHotkeyRegistered: false,
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
      secretProtectionEnabled: true
    },
    multiGroups: [],
    slots: Array.from({ length: 5 }, (_item, index) => ({ slot: index + 1, text: "", preview: "", byteLength: 0, updatedAt: "" })),
    snippetsPath: "",
    historyPath: "",
    settingsPath: "",
    multiGroupsPath: "",
    activeMultiCopyPath: "",
    slotsPath: ""
  });
  const [dropState, setDropState] = useState<DropState>({
    shelf: [],
    outgoing: [],
    outgoingText: [],
    outgoingFiles: [],
    incoming: [],
    shelfPath: "",
    incomingPath: "",
    receiveFolderPath: "",
    defaultReceiveFolderPath: "",
    customReceiveFolderPath: null,
    outgoingFolderPath: "",
    tempFolderPath: "",
    localUrl: "",
    phoneUrl: "",
    lanIp: null
  });
  const [toolsState, setToolsState] = useState<ToolsState>({
    selectedFiles: [],
    outputs: [],
    inputFolderPath: "",
    outputFolderPath: "",
    defaultOutputFolderPath: "",
    customOutputFolderPath: null,
    ffmpegPath: null,
    detectedFfmpegPath: null,
    libreOfficePath: null,
    detectedLibreOfficePath: null,
    tesseractPath: null,
    detectedTesseractPath: null,
    pythonPath: null,
    detectedPythonPath: null,
    ocrEngine: "paddleocr",
    ocrDevice: "gpu",
    ocrLanguage: "eng",
    tempFolderPath: "",
    outputsPath: ""
  });
  const [vaultState, setVaultState] = useState<VaultState>({
    documents: [],
    categories: [],
    documentsPath: "",
    importsPath: "",
    versionsPath: "",
    tempPath: "",
    metadataPath: "",
    documentCount: 0,
    totalSizeBytes: 0,
    ocrJobs: [],
    ocrSettings: { autoOcrOnImport: true, engine: "paddleocr", device: "gpu", pythonPath: null },
    ocrOutputPath: "",
    ocrJobsPath: "",
    ocrQueueRunning: false,
    ocrQueuePaused: false,
    paddleGpuStatus: { ok: false, message: "Loading.", pythonPath: null, paddleVersion: null, deviceCount: 0 },
    secure: {
      isSetup: false,
      isUnlocked: false,
      filePath: "",
      autoLockMinutes: 5,
      itemTypes: ["password", "api_key", "token", "recovery_code", "private_note", "server", "other"],
      items: []
    }
  });
  const [searchState, setSearchState] = useState<SearchState>({
    index: [],
    savedSearches: [],
    indexPath: "",
    indexFolderPath: "",
    indexStatusPath: "",
    indexStatus: { staleDueToPerformanceMode: false, staleReason: null, staleSince: null, lastSkippedAutoIndexAt: null },
    savedSearchesPath: "",
    resultCount: 0,
    ocrTextFileCount: 0,
    sources: [],
    fileTypes: []
  });
  const [journalState, setJournalState] = useState<JournalState>({
    entries: [],
    todayEntry: null,
    entriesPath: "",
    today: getLocalTodayDateString()
  });
  const [calendarState, setCalendarState] = useState<CalendarState>({
    events: [],
    today: getLocalTodayDateString(),
    todayEvents: [],
    upcomingEvents: [],
    eventsPath: "",
    nudges: [],
    todayNudges: [],
    upcomingNudges: [],
    urgentNudges: [],
    nudgesPath: "",
    nudgeSettingsPath: "",
    nudgeSettings: {
      enabled: true,
      vaultExpiryReminderDays: [90, 30, 7],
      returnReminderDays: [7, 3, 1],
      dailyJournalReminderEnabled: true,
      backupReminderAfterDays: 7
    }
  });
  const [finderState, setFinderState] = useState<FinderState>({
    items: [],
    itemsPath: "",
    statusCounts: { at_home: 0, lent_out: 0, missing: 0, archived: 0 }
  });
  const [financeState, setFinanceState] = useState<FinanceState>({
    transactions: [],
    recurring: [],
    settings: { defaultCurrency: "CAD", receiptsPath: "" },
    transactionsPath: "",
    recurringPath: "",
    settingsPath: "",
    receiptsPath: "",
    summary: {
      currentMonth: getLocalTodayDateString().slice(0, 7),
      previousMonth: "",
      currentMonthTotal: 0,
      previousMonthTotal: 0,
      categoryTotals: {},
      paymentTypeTotals: {},
      cashTotal: 0,
      cardTotal: 0,
      transactionCount: 0
    },
    deadlines: { returns7: [], returns30: [], warranties90: [], expiredReturns: [] }
  });
  const [captureState, setCaptureState] = useState<CaptureState>({
    items: [],
    inbox: [],
    routed: [],
    archived: [],
    itemsPath: "",
    capturesPath: ""
  });
  const [heatmapState, setHeatmapState] = useState<HeatmapState>({
    settings: {
      enabled: false,
      paused: true,
      sampleIntervalSeconds: 60,
      aggregationIntervalHours: 3,
      pauseDuringFullscreen: true,
      privateApps: [],
      privateTitleKeywords: [],
      lastAggregatedAt: null
    },
    events: [],
    goals: [],
    goalProgress: [],
    summary: {
      todayByApp: [],
      weekByApp: [],
      activeHours: [],
      projectUsage: [],
      activeSecondsToday: 0,
      idleSecondsToday: 0,
      topAppToday: "none"
    },
    eventsPath: "",
    settingsPath: "",
    goalsPath: "",
    trackingStatus: "disabled",
    detectionNote: ""
  });
  const [routinesState, setRoutinesState] = useState<RoutinesState>({
    routines: [],
    routinesPath: ""
  });
  const [backupState, setBackupState] = useState<BackupState>({
    backupFolderPath: "",
    restoreStagingPath: "",
    defaultOptions: {
      includeSettings: true,
      includeFiles: true,
      includeVaultDocuments: true,
      includeSecureVault: true,
      includeReceipts: true,
      includeDropFiles: true,
      includeIndex: false
    },
    backups: []
  });
  const [commandStats, setCommandStats] = useState<CommandStats>(emptyCommandStats);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [performanceModeState, setPerformanceModeState] = useState<PerformanceModeState>(defaultPerformanceModeState);
  const [performanceModeSettings, setPerformanceModeSettings] = useState<PerformanceModeSettings>(defaultPerformanceModeSettings);
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>({
    localIntentEngineEnabled: false,
    ollamaUrl: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5:3b",
    fallbackToRules: true
  });
  const [assistantSecurityState, setAssistantSecurityState] = useState<AssistantSecurityState>({
    settings: { trustedSessionEnabled: true, autoRevealWhileUnlocked: true, sessionTimeoutMinutes: 10, speakSensitiveAnswers: false, lockOnAppClose: true },
    sessionUnlocked: false,
    sessionExpiresAt: null,
    secureVaultUnlocked: false,
    secureVaultSetup: false
  });
  const [assistantFocusSignal, setAssistantFocusSignal] = useState(0);
  const [assistantListenSignal, setAssistantListenSignal] = useState(0);
  const [assistantListenSource, setAssistantListenSource] = useState("voice");
  const [assistantQueuedCommand, setAssistantQueuedCommand] = useState<QueuedAssistantCommand | null>(null);
  const [assistantQueuedCommandSignal, setAssistantQueuedCommandSignal] = useState(0);
  const [ambientVoiceState, setAmbientVoiceState] = useState<AmbientVoiceState>(defaultAmbientVoiceState);
  const [speechState, setSpeechState] = useState<SpeechServiceState>(defaultSpeechState);
  const [ttsDiagnostics, setTtsDiagnostics] = useState<TtsDiagnostics>(defaultTtsDiagnostics);
  const [voiceWorkflowSettings, setVoiceWorkflowSettings] = useState<VoiceWorkflowSettings>(defaultVoiceWorkflowSettings);
  const [voiceWorkflow, setVoiceWorkflow] = useState<VoiceWorkflowState>(defaultVoiceWorkflowState);
  const [journalVoice, setJournalVoice] = useState<JournalVoiceState>(defaultJournalVoiceState);
  const [wakeWordState, setWakeWordState] = useState<WakeWordServiceState>({
    status: "disabled",
    engine: "placeholder",
    engineInstalled: false,
    lastError: "",
    metrics: { wakeDetectedAt: null, commandRecordingStartLatencyMs: null, totalWakeToActionMs: null }
  });
  const wakeDetectedAtRef = useRef<number | null>(null);
  const ambientCommandCaptureActiveRef = useRef(false);
  const [wakeEngineState, setWakeEngineState] = useState<WakeEngineState>(defaultWakeEngineState);
  const journalLoopActiveRef = useRef(false);
  const captureLoopActiveRef = useRef(false);
  const captureVoiceDraftRef = useRef("");
  const journalDraftRef = useRef<{ id: string; rawText: string; title: string }>({ id: "", rawText: "", title: "" });
  const speechStateRef = useRef(speechState);
  useEffect(() => { speechStateRef.current = speechState; }, [speechState]);

  const activeLabel = useMemo(
    () => views.find((view) => view.id === activeView)?.label ?? "Command",
    [activeView]
  );

  async function refreshAssistantSettings(): Promise<void> {
    const state = await getBridge().getAssistantState();
    setAssistantSettings(state.settings);
  }

  async function refreshAssistantSecurity(): Promise<void> {
    const state = await getBridge().getAssistantSecurityState();
    setAssistantSecurityState(state);
  }

  async function refreshAmbientVoice(): Promise<void> {
    const state = await getBridge().getAmbientVoiceState();
    setAmbientVoiceState(state);
  }

  async function refreshSpeechState(): Promise<void> {
    const state = await getBridge().getSpeechState();
    setSpeechState(state);
  }

  function openAssistantFromCommand(): void {
    setActiveView("search");
    setAssistantFocusSignal((value) => value + 1);
    void refreshAssistantSecurity();
  }

  // --- Journal continuous voice mode (Phase 23.4) --------------------------
  function journalSpeechBlocked(): boolean {
    return Boolean(speechStateRef.current.performancePaused);
  }

  function logJournalVoiceMeta(summary: string): void {
    // Metadata-only audit — never the transcript or journal text.
    void getBridge().logUiEvent({ view: "journal", target: "journal_voice_mode", summary });
  }

  async function startJournalVoice(source = "voice"): Promise<void> {
    if (journalSpeechBlocked()) {
      setJournalVoice({ ...defaultJournalVoiceState, status: "error", error: "Speech is paused by Performance Mode." });
      return;
    }
    setActiveView("journal");
    setJournalVoice({ ...defaultJournalVoiceState, mode: "journal_dictation", status: "starting", startedAt: Date.now(), source });

    // Open or create today's entry.
    let entryId = journalState.todayEntry?.id ?? "";
    let rawText = journalState.todayEntry?.rawText ?? "";
    let title = journalState.todayEntry?.title ?? "";
    if (!entryId) {
      const result = await runAction("journal.create_entry", source, { date: journalState.today, title: "", rawText: "" }) as { ok?: boolean; entry?: { id: string } };
      entryId = result.entry?.id ?? "";
      if (!entryId) {
        setJournalVoice({ ...defaultJournalVoiceState, status: "error", error: "Could not open today's journal entry." });
        return;
      }
    }
    journalDraftRef.current = { id: entryId, rawText, title };
    setJournalVoice((current) => ({ ...current, status: "listening", activeEntryId: entryId }));
    journalLoopActiveRef.current = true;
    logJournalVoiceMeta("Journal voice mode started.");
    void runJournalVoiceLoop(source);
  }

  async function runJournalVoiceLoop(source: string): Promise<void> {
    while (journalLoopActiveRef.current) {
      if (journalSpeechBlocked()) {
        journalLoopActiveRef.current = false;
        setJournalVoice((current) => ({ ...current, status: "paused", error: "Speech is paused by Performance Mode." }));
        return;
      }
      setJournalVoice((current) => (current.status === "listening" ? current : { ...current, status: "listening" }));
      let result: (SpeechTranscriptionResult & { metrics?: SpeechCaptureMetrics }) | null = null;
      try {
        result = await runSharedSpeechCapture({ speechState: speechStateRef.current, source, sourceModule: "journal_dictation" });
      } catch {
        result = null;
      }
      if (!journalLoopActiveRef.current) {
        return;
      }
      // No speech this chunk — keep listening.
      if (!result || result.status !== "success" || !result.transcript.trim()) {
        continue;
      }
      const transcript = result.transcript.trim();
      const control = matchJournalControl(transcript);
      if (control === "save") {
        await saveAndStopJournalVoice();
        return;
      }
      if (control === "cancel") {
        await cancelJournalVoice(true);
        return;
      }
      if (control === "pause") {
        pauseJournalVoice();
        return;
      }
      if (control === "resume") {
        continue;
      }

      // Append the chunk to today's entry and auto-save.
      setJournalVoice((current) => ({ ...current, status: "appending" }));
      const draft = journalDraftRef.current;
      const nextRaw = draft.rawText ? `${draft.rawText}\n${transcript}` : transcript;
      const nextTitle = draft.title.trim() ? draft.title : autoTitleFromChunk(transcript);
      await runAction("journal.update_entry", source, { id: draft.id, rawText: nextRaw, title: nextTitle });
      journalDraftRef.current = { id: draft.id, rawText: nextRaw, title: nextTitle };
      const sensitive = assistantSensitiveRegex.test(transcript);
      setJournalVoice((current) => ({
        ...current,
        status: "saved",
        chunksCount: current.chunksCount + 1,
        lastSavedAt: Date.now(),
        sensitivity: sensitive ? "sensitive" : "none",
        // Never store a preview of sensitive content.
        lastTranscriptPreview: sensitive ? "" : transcript.replace(/\s+/g, " ").slice(0, 80)
      }));
      logJournalVoiceMeta("Journal chunk appended and saved.");
    }
  }

  function pauseJournalVoice(): void {
    journalLoopActiveRef.current = false;
    setJournalVoice((current) => ({ ...current, status: "paused" }));
    logJournalVoiceMeta("Journal voice mode paused.");
  }

  function resumeJournalVoice(): void {
    if (journalVoice.mode !== "journal_dictation") {
      return;
    }
    if (journalSpeechBlocked()) {
      setJournalVoice((current) => ({ ...current, status: "paused", error: "Speech is paused by Performance Mode." }));
      return;
    }
    journalLoopActiveRef.current = true;
    setJournalVoice((current) => ({ ...current, status: "listening", error: "" }));
    logJournalVoiceMeta("Journal voice mode resumed.");
    void runJournalVoiceLoop(journalVoice.source);
  }

  async function saveAndStopJournalVoice(): Promise<void> {
    journalLoopActiveRef.current = false;
    // Each chunk is already saved; just finalize state.
    setJournalVoice((current) => ({ ...current, mode: "none", status: "saved", lastSavedAt: Date.now() }));
    logJournalVoiceMeta("Journal voice mode saved and stopped.");
    await refreshShellData();
  }

  async function cancelJournalVoice(skipConfirm = false): Promise<void> {
    if (!skipConfirm && !window.confirm("Stop journal voice mode? Chunks already saved are kept.")) {
      return;
    }
    journalLoopActiveRef.current = false;
    setJournalVoice((current) => ({ ...current, mode: "none", status: "cancelled" }));
    logJournalVoiceMeta("Journal voice mode cancelled.");
    await refreshShellData();
  }

  function handleJournalControl(control: JournalVoiceControl): void {
    if (control === "save") {
      void saveAndStopJournalVoice();
    } else if (control === "pause") {
      pauseJournalVoice();
    } else if (control === "resume") {
      resumeJournalVoice();
    } else if (control === "cancel") {
      void cancelJournalVoice();
    }
  }

  function logVoiceWorkflowMeta(actionId: string, source: string, metadata: Record<string, unknown> = {}): void {
    void runAction(actionId, source, metadata);
  }

  function captureSpeechBlocked(): boolean {
    return Boolean(speechStateRef.current.performancePaused);
  }

  async function startCaptureVoice(source = "voice"): Promise<void> {
    if (captureSpeechBlocked()) {
      setVoiceWorkflow({ ...defaultVoiceWorkflowState, mode: "capture_note", targetModule: "capture", status: "error", error: "Speech is paused by Performance Mode.", source });
      return;
    }
    setActiveView("capture");
    captureVoiceDraftRef.current = "";
    captureLoopActiveRef.current = true;
    setVoiceWorkflow({
      ...defaultVoiceWorkflowState,
      mode: "capture_note",
      status: "starting",
      startedAt: Date.now(),
      source,
      targetModule: "capture"
    });
    logVoiceWorkflowMeta("voice.workflow.start", source, { workflowMode: "capture_note", targetModule: "capture", status: "started" });
    void runCaptureVoiceLoop(source);
  }

  async function runCaptureVoiceLoop(source: string): Promise<void> {
    while (captureLoopActiveRef.current) {
      if (captureSpeechBlocked()) {
        captureLoopActiveRef.current = false;
        setVoiceWorkflow((current) => ({ ...current, status: "paused", error: "Speech is paused by Performance Mode." }));
        logVoiceWorkflowMeta("voice.workflow.stop", source, { workflowMode: "capture_note", status: "paused", sensitivityCategory: "none" });
        return;
      }
      setVoiceWorkflow((current) => ({ ...current, status: "listening", error: "" }));
      let result: (SpeechTranscriptionResult & { metrics?: SpeechCaptureMetrics }) | null = null;
      try {
        result = await runSharedSpeechCapture({ speechState: speechStateRef.current, source, sourceModule: "capture_voice" });
      } catch {
        result = null;
      }
      if (!captureLoopActiveRef.current) {
        return;
      }
      if (!result || result.status !== "success" || !result.transcript.trim()) {
        setVoiceWorkflow((current) => ({ ...current, status: "error", error: result?.error ?? "No speech captured." }));
        if (!voiceWorkflowSettings.continueCaptureMode) {
          captureLoopActiveRef.current = false;
          return;
        }
        continue;
      }
      const transcript = result.transcript.trim();
      const control = matchCaptureControl(transcript);
      if (control === "cancel") {
        cancelCaptureVoice();
        return;
      }
      if (control === "stop") {
        stopCaptureVoice();
        return;
      }
      if (control === "save") {
        await saveCaptureVoiceDraft(source);
        return;
      }

      const sensitive = isSensitiveCaptureText(transcript);
      captureVoiceDraftRef.current = captureVoiceDraftRef.current ? `${captureVoiceDraftRef.current}\n${transcript}` : transcript;
      setVoiceWorkflow((current) => ({
        ...current,
        status: "transcribing",
        chunksCount: current.chunksCount + 1,
        lastTranscriptPreview: sensitive ? "" : transcript.replace(/\s+/g, " ").slice(0, 100),
        error: sensitive ? "Sensitive capture detected. Review before saving." : ""
      }));

      const needsReview = !voiceWorkflowSettings.autoSaveCaptureVoiceNotes
        || voiceWorkflowSettings.confirmBeforeSavingCapture
        || (sensitive && voiceWorkflowSettings.confirmSensitiveCapture);
      if (needsReview) {
        captureLoopActiveRef.current = false;
        setVoiceWorkflow((current) => ({ ...current, status: "candidate" }));
        logVoiceWorkflowMeta("voice.workflow.start", source, {
          workflowMode: "capture_note",
          status: "candidate",
          chunksCount: 1,
          sensitivityCategory: sensitive ? "sensitive" : "personal"
        });
        return;
      }

      await saveCaptureVoiceDraft(source);
      if (!voiceWorkflowSettings.continueCaptureMode) {
        captureLoopActiveRef.current = false;
        return;
      }
      captureVoiceDraftRef.current = "";
      setVoiceWorkflow((current) => ({ ...current, status: "listening" }));
    }
  }

  async function saveCaptureVoiceDraft(source = voiceWorkflow.source || "voice"): Promise<void> {
    const text = captureVoiceDraftRef.current.trim();
    if (!text) {
      setVoiceWorkflow((current) => ({ ...current, status: "error", error: "No Capture voice draft to save." }));
      return;
    }
    setVoiceWorkflow((current) => ({ ...current, status: "saving" }));
    const result = await runAction("capture.create_note", source, {
      title: titleFromVoiceText(text, "Voice capture"),
      text,
      type: "note",
      source: "command",
      tags: "voice,capture"
    }) as { ok?: boolean; item?: CaptureItem; error?: string };
    if (result.ok === false) {
      setVoiceWorkflow((current) => ({ ...current, status: "error", error: result.error ?? "Capture save failed." }));
      return;
    }
    const savedAt = Date.now();
    setVoiceWorkflow((current) => ({
      ...current,
      status: "saved",
      activeEntityId: result.item?.id ?? current.activeEntityId,
      lastSavedAt: savedAt,
      error: ""
    }));
    logVoiceWorkflowMeta("voice.workflow.capture_saved", source, {
      workflowMode: "capture_note",
      targetModule: "capture",
      chunksCount: voiceWorkflow.chunksCount || 1,
      sensitivityCategory: isSensitiveCaptureText(text) ? "sensitive" : "personal"
    });
    captureVoiceDraftRef.current = "";
    await refreshShellData();
  }

  function stopCaptureVoice(): void {
    captureLoopActiveRef.current = false;
    setVoiceWorkflow((current) => ({ ...current, mode: "none", status: "cancelled", error: "" }));
    logVoiceWorkflowMeta("voice.workflow.stop", voiceWorkflow.source || "voice", { workflowMode: "capture_note", status: "stopped" });
  }

  function cancelCaptureVoice(): void {
    captureLoopActiveRef.current = false;
    captureVoiceDraftRef.current = "";
    setVoiceWorkflow((current) => ({ ...current, mode: "none", status: "cancelled", lastTranscriptPreview: "", error: "" }));
    logVoiceWorkflowMeta("voice.workflow.stop", voiceWorkflow.source || "voice", { workflowMode: "capture_note", status: "cancelled" });
  }

  async function saveVoiceWorkflowOptions(input: Partial<VoiceWorkflowSettings>): Promise<void> {
    const saved = await getBridge().saveVoiceWorkflowSettings(input);
    setVoiceWorkflowSettings(saved);
  }

  function setFinderVoiceCandidate(candidate: FinderVoiceCandidate, source = "voice"): void {
    setActiveView("finder");
    setVoiceWorkflow({
      ...defaultVoiceWorkflowState,
      mode: "finder_add",
      status: "candidate",
      startedAt: Date.now(),
      source,
      targetModule: "finder",
      chunksCount: 1,
      lastTranscriptPreview: candidate.sourceText.replace(/\s+/g, " ").slice(0, 100),
      candidate
    });
    logVoiceWorkflowMeta("voice.workflow.finder_candidate", source, {
      workflowMode: "finder_add",
      targetModule: "finder",
      confidence: candidate.confidence,
      sensitivityCategory: "personal"
    });
  }

  async function saveFinderVoiceCandidate(): Promise<void> {
    const candidate = voiceWorkflow.candidate;
    if (!candidate) {
      return;
    }
    const result = await runAction("finder.create_item", voiceWorkflow.source || "voice", {
      itemName: candidate.itemName,
      location: candidate.location,
      room: candidate.room,
      container: candidate.container,
      notes: candidate.notes,
      confidence: candidate.confidence === "high" ? "sure" : "maybe",
      updateExisting: true
    }) as { ok?: boolean; item?: FinderItem; error?: string };
    setVoiceWorkflow((current) => ({
      ...current,
      status: result.ok === false ? "error" : "saved",
      activeEntityId: result.item?.id ?? null,
      lastSavedAt: result.ok === false ? current.lastSavedAt : Date.now(),
      error: result.ok === false ? (result.error ?? "Finder save failed.") : ""
    }));
    await refreshShellData();
  }

  function cancelFinderVoiceCandidate(): void {
    setVoiceWorkflow({ ...defaultVoiceWorkflowState, status: "cancelled" });
    logVoiceWorkflowMeta("voice.workflow.stop", voiceWorkflow.source || "voice", { workflowMode: "finder_add", status: "cancelled" });
  }

  function setCalendarVoiceCandidate(candidate: CalendarVoiceCandidate, source = "voice"): void {
    setActiveView("calendar");
    setVoiceWorkflow({
      ...defaultVoiceWorkflowState,
      mode: "calendar_create",
      status: "candidate",
      startedAt: Date.now(),
      source,
      targetModule: "calendar",
      chunksCount: 1,
      lastTranscriptPreview: candidate.sensitivity === "sensitive" ? "" : candidate.sourcePhrasePreview,
      confidence: candidate.confidence,
      missingFields: candidate.missingFields,
      calendarCandidate: candidate
    });
    logVoiceWorkflowMeta("voice.workflow.calendar_candidate", source, {
      workflowMode: "calendar_create",
      targetModule: "calendar",
      confidence: candidate.confidence,
      missingFieldCount: candidate.missingFields.length,
      eventType: candidate.eventType,
      sensitivityCategory: candidate.sensitivity,
      parsedDate: Boolean(candidate.date),
      parsedTime: Boolean(candidate.startTime)
    });
  }

  function updateCalendarVoiceCandidate(patch: Partial<CalendarVoiceCandidate>): void {
    setVoiceWorkflow((current) => {
      if (!current.calendarCandidate) {
        return current;
      }
      const candidate = updatedCalendarCandidate(current.calendarCandidate, patch, voiceWorkflowSettings);
      return {
        ...current,
        calendarCandidate: candidate,
        confidence: candidate.confidence,
        missingFields: candidate.missingFields,
        error: ""
      };
    });
  }

  async function confirmCalendarVoiceCandidate(): Promise<void> {
    const candidate = voiceWorkflow.calendarCandidate;
    if (!candidate) {
      return;
    }
    if (candidate.missingFields.length > 0 && !window.confirm(`This Calendar candidate is missing: ${candidate.missingFields.join(", ")}. Add it anyway?`)) {
      return;
    }
    setVoiceWorkflow((current) => ({ ...current, status: "saving" }));
    const result = await runAction("calendar.create_event", voiceWorkflow.source || "voice", calendarCandidateToActionParams(candidate)) as { ok?: boolean; event?: CalendarEvent; error?: string };
    if (result.ok === false) {
      setVoiceWorkflow((current) => ({ ...current, status: "error", error: result.error ?? "Calendar event save failed." }));
      logVoiceWorkflowMeta("voice.workflow.calendar_confirmed", voiceWorkflow.source || "voice", {
        workflowMode: "calendar_create",
        status: "failed",
        confidence: candidate.confidence,
        missingFieldCount: candidate.missingFields.length,
        eventType: candidate.eventType,
        sensitivityCategory: candidate.sensitivity
      });
      return;
    }
    setVoiceWorkflow((current) => ({
      ...current,
      status: "saved",
      activeEntityId: result.event?.id ?? current.activeEntityId,
      lastSavedAt: Date.now(),
      error: ""
    }));
    logVoiceWorkflowMeta("voice.workflow.calendar_confirmed", voiceWorkflow.source || "voice", {
      workflowMode: "calendar_create",
      status: "saved",
      confidence: candidate.confidence,
      missingFieldCount: candidate.missingFields.length,
      eventType: candidate.eventType,
      sensitivityCategory: candidate.sensitivity
    });
    await refreshShellData();
  }

  function cancelCalendarVoiceCandidate(): void {
    const candidate = voiceWorkflow.calendarCandidate;
    setVoiceWorkflow({ ...defaultVoiceWorkflowState, mode: "calendar_create", status: "cancelled" });
    logVoiceWorkflowMeta("voice.workflow.calendar_cancelled", voiceWorkflow.source || "voice", {
      workflowMode: "calendar_create",
      status: "cancelled",
      confidence: candidate?.confidence ?? "low",
      missingFieldCount: candidate?.missingFields.length ?? 0,
      eventType: candidate?.eventType ?? "reminder",
      sensitivityCategory: candidate?.sensitivity ?? "personal"
    });
  }

  // Pause journal dictation if Performance Mode blocks speech while active.
  useEffect(() => {
    if (journalVoice.mode === "journal_dictation" && journalVoice.status !== "paused" && speechState.performancePaused) {
      pauseJournalVoice();
      setJournalVoice((current) => ({ ...current, error: "Speech is paused by Performance Mode." }));
    }
  }, [speechState.performancePaused, journalVoice.mode, journalVoice.status]);

  // --- Wake word "Nest" MVP (Phase 23.8) ----------------------------------
  function wakePerfPaused(): boolean {
    return Boolean(speechStateRef.current.performancePaused) && (ambientVoiceState.settings.pauseWakeWordInPerformanceMode ?? true);
  }

  // Passive desktop voice-overlay signal. Never controls capture; only displays
  // state. Suppressed when the overlay is disabled or speech is perf-paused.
  function signalVoiceOverlay(payload: { type?: string; state?: string; level?: number }): void {
    if (!(ambientVoiceState.settings.voiceOverlayEnabled ?? true)) {
      return;
    }
    if (payload.type !== "hide" && wakePerfPaused()) {
      return;
    }
    getBridge().voiceOverlay(payload);
  }

  async function refreshWakeEngine(): Promise<void> {
    setWakeEngineState(await getBridge().getWakeEngineState());
  }

  async function checkWakeEngine(): Promise<void> {
    const result = await getBridge().checkWakeEngine();
    setWakeEngineState(result.state);
  }

  function startWakeService(): void {
    const settings = ambientVoiceState.settings;
    if (!settings.wakeWordEnabled) {
      setWakeWordState((current) => ({ ...current, status: "disabled" }));
      return;
    }
    // Drive the REAL main-process wake engine (openWakeWord sidecar). It reports
    // engine_missing honestly when deps/model are absent — no fake detection.
    void getBridge().startWakeEngine().then((result) => {
      setWakeEngineState(result.state);
      setWakeWordState((current) => ({
        ...current,
        engine: settings.wakeWordEngine ?? "openwakeword",
        engineInstalled: result.state.installStatus === "ready",
        status: result.state.status === "engine_missing" ? "error" : result.state.status === "listening_for_nest" || result.state.status === "starting" ? "listening_for_nest" : current.status,
        lastError: result.state.lastError
      }));
    });
  }

  function stopWakeService(): void {
    void getBridge().stopWakeEngine().then((result) => setWakeEngineState(result.state));
    setWakeWordState((current) => ({ ...current, status: "disabled" }));
  }

  // Wake detected → START RECORDING IMMEDIATELY. The chime, navigation and
  // indicator update happen asynchronously afterwards so none of them delay the
  // command capture (Phase 23.10). The mic is kept pre-warmed while listening so
  // recorder.start() fires in well under 150ms.
  function updateWakeMetrics(patch: Partial<SpeechCaptureMetrics>): void {
    if (lastSpeechCaptureMetrics) {
      lastSpeechCaptureMetrics = { ...lastSpeechCaptureMetrics, ...patch };
    }
    setWakeWordState((current) => ({
      ...current,
      metrics: {
        ...current.metrics,
        commandRecordingStartLatencyMs: patch.wakeToRecordingStartMs ?? current.metrics.commandRecordingStartLatencyMs,
        totalWakeToActionMs: current.metrics.wakeDetectedAt ? Date.now() - current.metrics.wakeDetectedAt : current.metrics.totalWakeToActionMs
      }
    }));
  }

  async function startAmbientCommandCapture(source: string, wakeAt: number): Promise<void> {
    if (ambientCommandCaptureActiveRef.current) {
      return;
    }
    ambientCommandCaptureActiveRef.current = true;
    let wakeToSearchNavigationMs: number | null = null;
    let overlayLevelTimer: number | null = null;
    try {
      void getBridge().updateAmbientVoiceState({
        currentState: "listening",
        lastActionResult: "Recording wake command.",
        lastSource: source
      });
      // Desktop overlay: switch to live listening + stream normalized mic level.
      signalVoiceOverlay({ type: "state", state: "listening" });
      overlayLevelTimer = window.setInterval(() => {
        signalVoiceOverlay({ type: "level", level: Math.min(1, getVadLiveMeter().level * 4) });
      }, 90);
      const capturePromise = runSharedSpeechCapture({
        speechState: speechStateRef.current,
        source,
        sourceModule: "ambient_wake_word"
      });
      wakeToSearchNavigationMs = Date.now() - wakeAt;
      setActiveView("search");
      setAssistantFocusSignal((value) => value + 1);
      if ((ambientVoiceState.settings.wakeChimeEnabled ?? ambientVoiceState.settings.playWakeSound ?? true)) {
        const chimeVolume = ambientVoiceState.settings.wakeChimeVolume ?? 0.35;
        window.setTimeout(() => playWakeChime(chimeVolume), 0);
      }

      const result = await capturePromise;
      if (overlayLevelTimer) { window.clearInterval(overlayLevelTimer); overlayLevelTimer = null; }
      if (result.speechState) {
        setSpeechState(result.speechState);
      }
      const metrics = { ...(result.metrics ?? {}), wakeToSearchNavigationMs };
      updateWakeMetrics(metrics);
      if (result.status === "success" && result.transcript.trim()) {
        // Overlay → processing pulse while routing; speak/done is signalled by the route.
        signalVoiceOverlay({ type: "state", state: "transcribing" });
        setAssistantQueuedCommand({
          id: createClientId("ambient-command"),
          text: result.transcript.trim(),
          source,
          metrics
        });
        setAssistantQueuedCommandSignal((value) => value + 1);
        void getBridge().updateAmbientVoiceState({
          currentState: "processing",
          lastRecognizedCommand: result.transcript.trim().replace(/\s+/g, " ").slice(0, 120),
          lastActionResult: "Routing wake command.",
          lastSource: source
        });
        return;
      }
      // No speech captured → fade the overlay out.
      signalVoiceOverlay({ type: "hide" });
      await getBridge().updateAmbientVoiceState({
        currentState: "idle",
        lastActionResult: result.error ?? "No wake command captured.",
        lastSource: source
      });
      setWakeWordState((current) => ({
        ...current,
        status: ambientVoiceState.settings.wakeWordEnabled && !wakePerfPaused() ? "listening_for_nest" : "disabled",
        lastError: result.error ?? ""
      }));
      void refreshAmbientVoice();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wake command capture failed.";
      signalVoiceOverlay({ type: "error", state: "error" });
      window.setTimeout(() => signalVoiceOverlay({ type: "hide" }), 1600);
      setWakeWordState((current) => ({ ...current, status: "error", lastError: message }));
      await getBridge().updateAmbientVoiceState({
        currentState: "idle",
        lastActionResult: message,
        lastSource: source
      });
      void refreshAmbientVoice();
    } finally {
      if (overlayLevelTimer) { window.clearInterval(overlayLevelTimer); }
      ambientCommandCaptureActiveRef.current = false;
    }
  }

  function onWakeDetected(source = "ambient_wake_word"): void {
    if (wakePerfPaused()) {
      setWakeWordState((current) => ({ ...current, status: "paused_by_performance_mode" }));
      return;
    }
    const wakeAt = Date.now();
    wakeDetectedAtRef.current = wakeAt;
    lastWakeDetectedAtForMetric = wakeAt;
    setWakeWordState((current) => ({
      ...current,
      status: "recording_command",
      metrics: { ...current.metrics, wakeDetectedAt: wakeAt, commandRecordingStartLatencyMs: null, totalWakeToActionMs: null }
    }));
    // Desktop overlay: quick bright wake pulse (does not block capture).
    signalVoiceOverlay({ type: "state", state: "wake_detected" });
    void startAmbientCommandCapture(source, wakeAt);
    void getBridge().logUiEvent({ view: "ambient_voice", target: "wake_word", summary: "Wake detected; recording command." });
  }

  function testWakeTrigger(): void {
    onWakeDetected("ambient_wake_word");
  }

  // Register the wake callback once (placeholder/Test trigger + real engine event).
  useEffect(() => {
    wakeWordService.onWake(onWakeDetected);
    const unsubscribe = getBridge().onWakeDetected?.((payload) => onWakeDetected(payload.source || "ambient_wake_word"));
    void refreshWakeEngine();
    return () => {
      wakeWordService.dispose();
      unsubscribe?.();
    };
  }, []);

  // Start/stop the wake service to match the enabled setting + Performance Mode.
  useEffect(() => {
    if (ambientVoiceState.settings.wakeWordEnabled && !wakePerfPaused()) {
      startWakeService();
    } else if (wakePerfPaused() && ambientVoiceState.settings.wakeWordEnabled) {
      wakeWordService.stop();
      setWakeWordState((current) => ({ ...current, status: "paused_by_performance_mode" }));
    } else {
      wakeWordService.stop();
      setWakeWordState((current) => ({ ...current, status: "disabled" }));
    }
  }, [ambientVoiceState.settings.wakeWordEnabled, ambientVoiceState.settings.pauseWakeWordInPerformanceMode, speechState.performancePaused]);

  // Keep the renderer microphone pre-warmed the WHOLE time the wake engine is
  // listening (regardless of which view is open), so a wake event records in
  // <150ms instead of paying a cold getUserMedia. The Python wake sidecar and
  // this renderer stream coexist in Windows shared-capture mode.
  useEffect(() => {
    const wakeListening = ambientVoiceState.settings.wakeWordEnabled && !wakePerfPaused();
    if (wakeListening && speechState.settings.micPrewarmEnabled !== false && speechState.settings.speechEngine === "faster_whisper") {
      void prewarmMic(speechState.settings);
      // Warm the transcription engine too so the first wake command is not a cold start.
      if (speechState.settings.keepSpeechModelWarm !== false && (speechState.engineState === undefined || speechState.engineState === "unavailable")) {
        void getBridge().warmSpeechEngine().then((result) => setSpeechState(result.speechState)).catch(() => undefined);
      }
    }
  }, [ambientVoiceState.settings.wakeWordEnabled, speechState.performancePaused, speechState.settings.micPrewarmEnabled, speechState.settings.speechEngine, speechState.settings.selectedInputDeviceId]);

  // After a wake command finishes, the listen pipeline returns control; reset to
  // listening_for_nest if still enabled (respecting cooldown is best-effort here).
  useEffect(() => {
    if (wakeWordState.status === "recording_command") {
      const cooldown = ambientVoiceState.settings.wakeCooldownMs ?? 1500;
      const timer = window.setTimeout(() => {
        setWakeWordState((current) => {
          if (current.status !== "recording_command") {
            return current;
          }
          return {
            ...current,
            status: ambientVoiceState.settings.wakeWordEnabled && !wakePerfPaused() ? "listening_for_nest" : "disabled",
            metrics: { ...current.metrics, totalWakeToActionMs: current.metrics.wakeDetectedAt ? Date.now() - current.metrics.wakeDetectedAt : null }
          };
        });
      }, (ambientVoiceState.settings.maxListeningSeconds + 2) * 1000 + cooldown);
      return () => window.clearTimeout(timer);
    }
  }, [wakeWordState.status]);

  useEffect(() => {
    if (voiceWorkflow.mode === "capture_note" && !["paused", "saved", "cancelled", "error"].includes(voiceWorkflow.status) && speechState.performancePaused) {
      captureLoopActiveRef.current = false;
      setVoiceWorkflow((current) => ({ ...current, status: "paused", error: "Speech is paused by Performance Mode." }));
    }
  }, [speechState.performancePaused, voiceWorkflow.mode, voiceWorkflow.status]);

  // Tracks any user-initiated async work so the global loading indicator can reflect it.
  // Note: background refreshes (e.g. Drop's 3s auto-poll) intentionally bypass this so the
  // indicator does not flicker constantly.
  async function track<T>(work: Promise<T>): Promise<T> {
    setBusyCount((count) => count + 1);
    try {
      return await work;
    } finally {
      setBusyCount((count) => Math.max(0, count - 1));
    }
  }

  // Boot warm-up: load data, then auto-warm the local speech model, microphone,
  // and (if enabled) the wake listener — behind a "Getting DexNest ready" splash.
  // Each step is gated by its setting so users who disable voice pay nothing, and
  // the splash is capped so a slow first model download never hangs startup.
  async function runBootWarmup(): Promise<void> {
    setBootStatus("Loading DexNest…");
    await track(refreshShellData());
    setInitialLoadDone(true);
    await Promise.all([refreshAssistantSettings(), refreshAssistantSecurity(), refreshAmbientVoice()]);
    const speech = await getBridge().getSpeechState();
    setSpeechState(speech);
    const blocked = speech.performancePaused;

    if (!blocked && speech.settings.speechEngine === "faster_whisper" && speech.settings.keepSpeechModelWarm !== false) {
      setBootStatus("Warming local speech model…");
      await getBridge().warmSpeechEngine().then((result) => setSpeechState(result.speechState)).catch(() => undefined);
    }

    if (!blocked && speech.settings.micPrewarmEnabled !== false) {
      setBootStatus("Preparing microphone…");
      await refreshMicPermission();
      // Only pre-warm when permission is already granted — never prompt at boot.
      if (getMicWarmState().permission === "granted") {
        await prewarmMic(speech.settings).catch(() => undefined);
      }
    }
    // The wake engine is started by its own effect when wakeWordEnabled.
    setBootStatus("DexNest ready");
    setBootReady(true);
  }

  useEffect(() => {
    // Safety cap: reveal the app even if a first-time model download is slow
    // (warming continues in the background).
    const cap = window.setTimeout(() => {
      setInitialLoadDone(true);
      setBootReady(true);
    }, 9000);
    void runBootWarmup().finally(() => window.clearTimeout(cap));
  }, []);

  useEffect(() => {
    const unsubscribe = getBridge().onOpenView?.((payload) => {
      const view = payload.view as ViewId;
      if (!views.some((item) => item.id === view)) {
        return;
      }
      setActiveView(view);
      if (payload.focusAssistant) {
        setAssistantFocusSignal((value) => value + 1);
        void refreshAssistantSecurity();
      }
      if (payload.startListening) {
        setAssistantListenSource(payload.source ?? "push_to_talk");
        setAssistantListenSignal((value) => value + 1);
        void refreshAmbientVoice();
      }
      void refreshShellData();
    });
    getBridge().rendererReady?.();

    return () => {
      unsubscribe?.();
    };
  }, []);

  async function refreshShellData(): Promise<void> {
    // Coalesce: if a refresh is already running, mark one more pass and return.
    if (refreshInFlightRef.current) {
      refreshPendingRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    try {
      const view = activeViewRef.current;
      // Always-needed lightweight/global states (sidebar, dashboard, indicators).
      const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextToolsState, nextJournalState, nextCalendarState, nextRoutinesState, nextPerformanceState, nextPerformanceSettings, nextCommandStats, nextEvents, nextAmbientVoiceState, nextSpeechState, nextVoiceWorkflowSettings] = await Promise.all([
        getBridge().getAppInfo(),
        getBridge().listActions(),
        getBridge().listProjects(),
        getBridge().listCommandResults(),
        getBridge().listPinnedActions(),
        getBridge().getClipboardState(),
        getBridge().getDropState(),
        getBridge().getToolsState(),
        getBridge().getJournalState(),
        getBridge().getCalendarState(),
        getBridge().getRoutinesState(),
        getBridge().getPerformanceModeState(),
        getBridge().getPerformanceModeSettings(),
        getBridge().getCommandStats(),
        getBridge().listEvents(),
        getBridge().getAmbientVoiceState(),
        getBridge().getSpeechState(),
        getBridge().getVoiceWorkflowSettings()
      ]);

      setAppInfo(info);
      setActions(nextActions);
      setProjects(nextProjects);
      setCommandResults(nextCommandResults);
      setPinnedActionIds(nextPinnedActionIds);
      setClipboardState(nextClipboardState);
      setDropState(nextDropState);
      setToolsState(nextToolsState);
      setJournalState(nextJournalState);
      setCalendarState(nextCalendarState);
      setRoutinesState(nextRoutinesState);
      setPerformanceModeState(nextPerformanceState);
      setPerformanceModeSettings(nextPerformanceSettings);
      setCommandStats(nextCommandStats);
      setEvents(nextEvents);
      setAmbientVoiceState(nextAmbientVoiceState);
      setSpeechState(nextSpeechState);
      setVoiceWorkflowSettings(nextVoiceWorkflowSettings);

      // Heavy, view-specific states (large arrays / disk reads / aggregation):
      // fetch only when their view is active so a normal action never reloads
      // the entire search index, vault, finance, etc. (the main cause of the
      // per-action freeze). Navigating to a view always refreshes it.
      if (view === "search") { setSearchState(await getBridge().getSearchState()); }
      if (view === "vault") { setVaultState(await getBridge().getVaultState()); }
      if (view === "finder") { setFinderState(await getBridge().getFinderState()); }
      if (view === "finance") { setFinanceState(await getBridge().getFinanceState()); }
      if (view === "capture") { setCaptureState(await getBridge().getCaptureState()); }
      if (view === "heatmap" || view === "settings") { setHeatmapState(await getBridge().getHeatmapState()); }
      if (view === "settings") { setBackupState(await getBridge().getBackupState()); }
    } finally {
      refreshInFlightRef.current = false;
      if (refreshPendingRef.current) {
        refreshPendingRef.current = false;
        void refreshShellData();
      }
    }
  }

  async function refreshEvents(): Promise<void> {
    const recentEvents = await getBridge().listEvents();
    setEvents(recentEvents);
  }

  async function refreshProjectsAndActions(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextToolsState, nextVaultState, nextSearchState, nextJournalState, nextCalendarState, nextFinderState, nextFinanceState, nextCaptureState, nextHeatmapState, nextRoutinesState, nextPerformanceState, nextPerformanceSettings, nextCommandStats, nextEvents, nextAmbientVoiceState, nextSpeechState] = await Promise.all([
      getBridge().getAppInfo(),
      getBridge().listActions(),
      getBridge().listProjects(),
      getBridge().listCommandResults(),
      getBridge().listPinnedActions(),
      getBridge().getClipboardState(),
      getBridge().getDropState(),
      getBridge().getToolsState(),
      getBridge().getVaultState(),
      getBridge().getSearchState(),
      getBridge().getJournalState(),
      getBridge().getCalendarState(),
      getBridge().getFinderState(),
      getBridge().getFinanceState(),
      getBridge().getCaptureState(),
      getBridge().getHeatmapState(),
      getBridge().getRoutinesState(),
      getBridge().getPerformanceModeState(),
      getBridge().getPerformanceModeSettings(),
      getBridge().getCommandStats(),
      getBridge().listEvents(),
      getBridge().getAmbientVoiceState(),
      getBridge().getSpeechState()
    ]);

    setAppInfo(info);
    setActions(nextActions);
    setProjects(nextProjects);
    setCommandResults(nextCommandResults);
    setPinnedActionIds(nextPinnedActionIds);
    setClipboardState(nextClipboardState);
    setDropState(nextDropState);
    setToolsState(nextToolsState);
    setVaultState(nextVaultState);
    setSearchState(nextSearchState);
    setJournalState(nextJournalState);
    setCalendarState(nextCalendarState);
    setFinderState(nextFinderState);
    setFinanceState(nextFinanceState);
    setCaptureState(nextCaptureState);
    setHeatmapState(nextHeatmapState);
    setRoutinesState(nextRoutinesState);
    setPerformanceModeState(nextPerformanceState);
    setPerformanceModeSettings(nextPerformanceSettings);
    setCommandStats(nextCommandStats);
    setEvents(nextEvents);
    setAmbientVoiceState(nextAmbientVoiceState);
    setSpeechState(nextSpeechState);
  }

  async function runAction(actionId: string, source = "module_ui", params: unknown = {}) {
    return track(
      (async () => {
        const result = await getBridge().runAction({ actionId, source, params });
        await refreshShellData();
        return result;
      })()
    );
  }

  // Lightweight runner for the voice/assistant pipeline. The assistant renders
  // results from the returned value and manages its own chat state, so it does
  // not need the heavy 25-state shell reload (or the blocking "Working" pill)
  // after every — often logging-only — call. This is the main reason a spoken
  // command used to take several seconds after the action itself completed.
  // Only the event log is refreshed (cheap, in the background) for the audit view.
  async function runAssistantAction(actionId: string, source = "module_ui", params: unknown = {}) {
    const result = await getBridge().runAction({ actionId, source, params });
    void getBridge().listEvents().then(setEvents).catch(() => undefined);
    return result;
  }

  async function runUiAction(actionId: string, source = "module_ui", params: unknown = {}) {
    const action = actions.find((item) => item.id === actionId);
    const result = await runAction(actionId, source, params);
    const targetView = viewFromAction(action);

    if (targetView) {
      setActiveView(targetView);
    }

    return result;
  }

  async function navigate(view: ViewId): Promise<void> {
    // Switch instantly — the view renders from already-loaded state. The view's
    // open-action is logged and shell data refreshed in the BACKGROUND (no busy
    // spinner), so opening Dev/Deck/Clipboard/Settings never feels hung.
    const actionId = views.find((item) => item.id === view)?.actionId;
    const switchStartedAt = performance.now();
    setActiveView(view);
    // Measure time from switch request to the next painted frame.
    requestAnimationFrame(() => requestAnimationFrame(() => recordModuleSwitch(view, performance.now() - switchStartedAt)));
    if (actionId) {
      void getBridge().runAction({ actionId, source: "module_ui", params: {} }).catch(() => undefined);
    }
    void refreshShellData().catch(() => undefined);
  }

  async function handleAction(actionId: string): Promise<void> {
    await runUiAction(actionId);
  }

  async function savePinnedActionIds(actionIds: string[]): Promise<void> {
    const savedActionIds = await getBridge().savePinnedActions(actionIds);
    setPinnedActionIds(savedActionIds);
    await refreshShellData();
  }

  const isBusy = busyCount > 0;
  // Only show the centered overlay once an operation runs longer than a moment,
  // so fast actions/navigation never flash a blocking spinner.
  const [showBusyOverlay, setShowBusyOverlay] = useState(false);
  useEffect(() => {
    if (!isBusy) {
      setShowBusyOverlay(false);
      return;
    }
    const timer = window.setTimeout(() => setShowBusyOverlay(true), 350);
    return () => window.clearTimeout(timer);
  }, [isBusy]);

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      {isBusy && <div className="app-loading-bar" aria-hidden="true" />}
      {showBusyOverlay && (
        <div className="app-busy-overlay" role="status" aria-live="polite">
          <div className="app-busy-overlay__inner">
            <Spinner size="lg" />
            <span>Working…</span>
          </div>
        </div>
      )}
      {!bootReady && (
        <div className="app-initial-overlay" role="status" aria-live="polite">
          <div className="app-initial-overlay__inner">
            <span className="brand__mark app-initial-overlay__logo" aria-hidden="true" />
            <strong>Getting DexNest ready</strong>
            <Spinner size="lg" />
            <span>{bootStatus}</span>
          </div>
        </div>
      )}
      <aside className="sidebar" aria-label="DexNest navigation">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div className="brand__text">
            <p>DexNest</p>
            <strong>Command Center</strong>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? ">" : "<"}
          </button>
        </div>

        <nav className="sidebar__nav">
          {views.map((view) => (
            <button
              className={`nav-button ${view.accentClass}`}
              data-active={activeView === view.id}
              key={view.id}
              title={view.label}
              type="button"
              onClick={() => void navigate(view.id)}
            >
              <span className="nav-button__dot" aria-hidden="true" />
              <span className="nav-button__label">{view.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p>DexNest / {activeLabel}</p>
            <h1>{activeLabel}</h1>
          </div>
          <div className="endpoint-pill">{appInfo?.actionEndpoint ?? "Loading endpoint"}</div>
        </header>

        <main className="content">
          {journalVoice.mode === "journal_dictation" && (
            <div className="ambient-indicator" data-state={journalVoice.status === "paused" ? "paused" : journalVoice.status === "appending" || journalVoice.status === "saved" ? "processing" : "listening"}>
              <span>
                {speechState.performancePaused
                  ? "Journal mode paused by Performance Mode"
                  : journalVoice.status === "paused"
                    ? "Journal mode paused"
                    : journalVoice.status === "appending" || journalVoice.status === "saved"
                      ? "Saving journal…"
                      : "Journal mode listening"}
              </span>
              <strong>{journalVoice.chunksCount} chunk{journalVoice.chunksCount === 1 ? "" : "s"}</strong>
            </div>
          )}
          {journalVoice.mode !== "journal_dictation" && voiceWorkflow.mode !== "none" && (
            <div className="ambient-indicator" data-state={voiceWorkflow.status === "paused" ? "paused" : voiceWorkflow.status === "saved" || voiceWorkflow.status === "lookup_complete" ? "processing" : voiceWorkflow.status === "error" ? "paused" : "listening"}>
              <span>
                {voiceWorkflow.mode === "capture_note"
                  ? voiceWorkflow.status === "saved" ? "Saved to Capture inbox" : voiceWorkflow.status === "paused" ? "Capture mode paused" : "Capture mode listening"
                  : voiceWorkflow.status === "saved" ? "Finder memory saved" : voiceWorkflow.status === "lookup_complete" ? "Finder lookup complete" : "Finder memory candidate"}
              </span>
              <strong>{voiceWorkflow.error || voiceWorkflow.lastTranscriptPreview || `${voiceWorkflow.chunksCount} chunk${voiceWorkflow.chunksCount === 1 ? "" : "s"}`}</strong>
            </div>
          )}
          {journalVoice.mode !== "journal_dictation" && voiceWorkflow.mode === "none" && ambientVoiceState.settings.wakeWordEnabled && wakeWordState.status !== "disabled" && (
            <div className="ambient-indicator" data-state={wakeWordState.status === "paused_by_performance_mode" ? "paused" : wakeWordState.status === "recording_command" ? "listening" : wakeWordState.status === "transcribing" || wakeWordState.status === "routing" ? "processing" : wakeWordState.status === "wake_detected" ? "listening" : "idle"}>
              <span>
                {wakeWordState.status === "paused_by_performance_mode" ? "Wake word paused by Performance Mode"
                  : wakeWordState.status === "wake_detected" ? "Nest heard"
                  : wakeWordState.status === "recording_command" ? "Listening…"
                  : wakeWordState.status === "transcribing" || wakeWordState.status === "routing" ? "Processing…"
                  : `Listening for ${ambientVoiceState.settings.wakeWord || "Nest"}`}
              </span>
            </div>
          )}
          {journalVoice.mode !== "journal_dictation" && voiceWorkflow.mode === "none" && !(ambientVoiceState.settings.wakeWordEnabled && wakeWordState.status !== "disabled") && ambientVoiceState.settings.visibleListeningIndicator && (
            <div className="ambient-indicator" data-state={ambientVoiceState.currentState}>
              <span>{ambientVoiceState.pausedByPerformanceMode ? "Nest paused by Performance Mode" : `Nest ${ambientVoiceState.currentState}`}</span>
              {ambientVoiceState.lastRecognizedCommand && <strong>{ambientVoiceState.lastRecognizedCommand}</strong>}
            </div>
          )}

          {activeView === "command" && (
            <CommandView
              appInfo={appInfo}
              actions={actions}
              clipboardState={clipboardState}
              pinnedActionIds={pinnedActionIds}
              calendarState={calendarState}
              commandStats={commandStats}
              events={events}
              performanceModeState={performanceModeState}
              performanceModeSettings={performanceModeSettings}
              onOpenAssistant={openAssistantFromCommand}
              onAction={runUiAction}
              onPerformanceToggle={async (enabled) => {
                await getBridge().setPerformanceModeEnabled({ enabled, reason: "manual" });
                await refreshShellData();
              }}
              onPinnedActionsChange={savePinnedActionIds}
            />
          )}
          {activeView === "dev" && (
            <DevView
              projects={projects}
              commandResults={commandResults}
              onAction={runAction}
              onProjectsChanged={refreshProjectsAndActions}
            />
          )}
          {activeView === "deck" && (
            <DeckView
              actions={actions}
              projects={projects}
              routinesState={routinesState}
              pinnedActionIds={pinnedActionIds}
              appInfo={appInfo}
              endpoint={appInfo?.actionEndpoint}
              onAction={runAction}
              onRefresh={refreshShellData}
              refreshEvents={refreshEvents}
            />
          )}
          {activeView === "clipboard" && (
            <ClipboardView
              clipboardState={clipboardState}
              onAction={runAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "drop" && (
            <DropView
              dropState={dropState}
              endpoint={appInfo?.actionEndpoint}
              onAction={runAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "tools" && (
            <ToolsView
              toolsState={toolsState}
              onAction={runAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "vault" && (
            <VaultView
              vaultState={vaultState}
              onAction={runAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "search" && (
            <SearchView
              searchState={searchState}
              actions={actions}
              assistantSettings={assistantSettings}
              onAssistantSettingsChange={refreshAssistantSettings}
              securityState={assistantSecurityState}
              onSecurityChange={refreshAssistantSecurity}
              ambientVoiceState={ambientVoiceState}
              onAmbientVoiceChange={refreshAmbientVoice}
              speechState={speechState}
              voiceWorkflowSettings={voiceWorkflowSettings}
              onSpeechStateChange={setSpeechState}
              assistantFocusSignal={assistantFocusSignal}
              assistantListenSignal={assistantListenSignal}
              assistantListenSource={assistantListenSource}
              assistantQueuedCommand={assistantQueuedCommand}
              assistantQueuedCommandSignal={assistantQueuedCommandSignal}
              onTtsDiagnosticsChange={setTtsDiagnostics}
              onWakeMetricsUpdate={updateWakeMetrics}
              journalVoiceActive={journalVoice.mode === "journal_dictation"}
              onStartJournalVoice={startJournalVoice}
              onJournalControl={handleJournalControl}
              onStartCaptureVoice={startCaptureVoice}
              onFinderVoiceCandidate={setFinderVoiceCandidate}
              onCalendarVoiceCandidate={setCalendarVoiceCandidate}
              onFinderLookupComplete={(summary, source) => setVoiceWorkflow({
                ...defaultVoiceWorkflowState,
                mode: "finder_add",
                status: "lookup_complete",
                source,
                targetModule: "finder",
                chunksCount: 1,
                lastSavedAt: Date.now(),
                lastTranscriptPreview: summary.slice(0, 100)
              })}
              onFinderMemorySaved={(source) => setVoiceWorkflow((current) => ({
                ...current,
                mode: "finder_add",
                status: "saved",
                source,
                targetModule: "finder",
                lastSavedAt: Date.now(),
                error: ""
              }))}
              onAction={runUiAction}
              assistantAction={runAssistantAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "capture" && (
            <CaptureView
              captureState={captureState}
              speechState={speechState}
              voiceWorkflow={voiceWorkflow}
              voiceWorkflowSettings={voiceWorkflowSettings}
              onSpeechStateChange={setSpeechState}
              onStartVoiceCapture={startCaptureVoice}
              onSaveVoiceCapture={() => saveCaptureVoiceDraft("module_ui")}
              onStopVoiceCapture={stopCaptureVoice}
              onCancelVoiceCapture={cancelCaptureVoice}
              onVoiceWorkflowSettingsChange={saveVoiceWorkflowOptions}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "journal" && (
            <JournalView
              journalState={journalState}
              calendarState={calendarState}
              speechState={speechState}
              onSpeechStateChange={setSpeechState}
              journalVoice={journalVoice}
              onStartJournalVoice={startJournalVoice}
              onPauseJournalVoice={pauseJournalVoice}
              onResumeJournalVoice={resumeJournalVoice}
              onSaveStopJournalVoice={saveAndStopJournalVoice}
              onCancelJournalVoice={cancelJournalVoice}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "calendar" && (
            <CalendarView
              calendarState={calendarState}
              speechState={speechState}
              voiceWorkflow={voiceWorkflow}
              voiceWorkflowSettings={voiceWorkflowSettings}
              onSpeechStateChange={setSpeechState}
              onCalendarCandidateChange={updateCalendarVoiceCandidate}
              onConfirmCalendarCandidate={confirmCalendarVoiceCandidate}
              onCancelCalendarCandidate={cancelCalendarVoiceCandidate}
              onVoiceWorkflowSettingsChange={saveVoiceWorkflowOptions}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "finder" && (
            <FinderView
              finderState={finderState}
              speechState={speechState}
              voiceWorkflow={voiceWorkflow}
              onSpeechStateChange={setSpeechState}
              onSaveVoiceCandidate={saveFinderVoiceCandidate}
              onCancelVoiceCandidate={cancelFinderVoiceCandidate}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "finance" && (
            <FinanceView
              financeState={financeState}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "heatmap" && (
            <HeatmapView
              heatmapState={heatmapState}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "audit" && <AuditView events={events} onRefresh={handleAction} refreshEvents={refreshEvents} />}
          {activeView === "settings" && (
            <SettingsView
              appInfo={appInfo}
              backupState={backupState}
              calendarState={calendarState}
              performanceModeState={performanceModeState}
              performanceModeSettings={performanceModeSettings}
              ambientVoiceState={ambientVoiceState}
              speechState={speechState}
              ttsDiagnostics={ttsDiagnostics}
              wakeWordState={wakeWordState}
              wakeEngineState={wakeEngineState}
              onTestWake={testWakeTrigger}
              onStartWake={startWakeService}
              onStopWake={stopWakeService}
              onCheckWake={checkWakeEngine}
              onSpeechStateChanged={setSpeechState}
              onTtsDiagnosticsChange={setTtsDiagnostics}
              onAmbientVoiceChanged={async (settings) => {
                await getBridge().saveAmbientVoiceSettings(settings);
                await refreshAmbientVoice();
                await refreshShellData();
              }}
              onAction={runUiAction}
              onPerformanceChanged={async (settings, enabled) => {
                if (settings) {
                  await getBridge().savePerformanceModeSettings(settings);
                }
                if (typeof enabled === "boolean") {
                  await getBridge().setPerformanceModeEnabled({ enabled, reason: "manual" });
                }
                await refreshShellData();
              }}
              onRefresh={refreshShellData}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function formatSessionRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// DexNest Assistant ("Ask DexNest"). Lives inside Search. Routes natural language
// to existing Search/Smart Lookup/Vault/Finder/Calendar/Drop/Dev actions, and
// honors the trusted sensitive-access session for auto-revealing answers.
function AskDexNest({
  actions,
  assistantSettings,
  onAssistantSettingsChange,
  securityState,
  onSecurityChange,
  ambientVoiceState,
  onAmbientVoiceChange,
  speechState,
  voiceWorkflowSettings,
  onSpeechStateChange,
  onAction,
  focusSignal,
  listenSignal,
  listenSource,
  queuedCommand,
  queuedCommandSignal,
  onTtsDiagnosticsChange,
  onWakeMetricsUpdate,
  journalVoiceActive,
  onStartJournalVoice,
  onJournalControl,
  onStartCaptureVoice,
  onFinderVoiceCandidate,
  onCalendarVoiceCandidate,
  onFinderLookupComplete,
  onFinderMemorySaved
}: {
  actions: ActionDefinition[];
  assistantSettings: AssistantSettings;
  onAssistantSettingsChange: () => Promise<void>;
  securityState: AssistantSecurityState;
  onSecurityChange: () => Promise<void>;
  ambientVoiceState: AmbientVoiceState;
  onAmbientVoiceChange: () => Promise<void>;
  speechState: SpeechServiceState;
  voiceWorkflowSettings: VoiceWorkflowSettings;
  onSpeechStateChange: (state: SpeechServiceState) => void;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  focusSignal: number;
  listenSignal: number;
  listenSource: string;
  queuedCommand: QueuedAssistantCommand | null;
  queuedCommandSignal: number;
  onTtsDiagnosticsChange: (diagnostics: TtsDiagnostics) => void;
  onWakeMetricsUpdate: (patch: Partial<SpeechCaptureMetrics>) => void;
  journalVoiceActive: boolean;
  onStartJournalVoice: (source?: string) => Promise<void>;
  onJournalControl: (control: JournalVoiceControl) => void;
  onStartCaptureVoice: (source?: string) => Promise<void>;
  onFinderVoiceCandidate: (candidate: FinderVoiceCandidate, source?: string) => void;
  onCalendarVoiceCandidate: (candidate: CalendarVoiceCandidate, source?: string) => void;
  onFinderLookupComplete: (summary: string, source: string) => void;
  onFinderMemorySaved: (source: string) => void;
}) {
  const [voiceInput, setVoiceInput] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [micStatus, setMicStatus] = useState("");
  const voiceInputRef = useRef<HTMLInputElement | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantChatMessage[]>([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantDebug, setAssistantDebug] = useState(false);
  const [revealedAssistantIds, setRevealedAssistantIds] = useState<string[]>([]);
  const [pendingCalendarCandidate, setPendingCalendarCandidate] = useState<CalendarVoiceCandidate | null>(null);
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [assistantEngineEnabled, setAssistantEngineEnabled] = useState(assistantSettings.localIntentEngineEnabled);
  const [assistantOllamaUrl, setAssistantOllamaUrl] = useState(assistantSettings.ollamaUrl);
  const [assistantOllamaModel, setAssistantOllamaModel] = useState(assistantSettings.ollamaModel);
  const [assistantFallback, setAssistantFallback] = useState(assistantSettings.fallbackToRules);
  const [assistantTestStatus, setAssistantTestStatus] = useState("");
  const assistantScrollRef = useRef<HTMLDivElement | null>(null);
  // Trusted-session UI state.
  const [unlockPassword, setUnlockPassword] = useState("");
  const [sessionStatus, setSessionStatus] = useState("");
  const [securityOpen, setSecurityOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [secTimeout, setSecTimeout] = useState(securityState.settings.sessionTimeoutMinutes);
  const [secAutoReveal, setSecAutoReveal] = useState(securityState.settings.autoRevealWhileUnlocked);
  const [secEnabled, setSecEnabled] = useState(securityState.settings.trustedSessionEnabled);
  const [secSpeak, setSecSpeak] = useState(securityState.settings.speakSensitiveAnswers);
  const [secLockOnClose, setSecLockOnClose] = useState(securityState.settings.lockOnAppClose);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setAssistantEngineEnabled(assistantSettings.localIntentEngineEnabled);
    setAssistantOllamaUrl(assistantSettings.ollamaUrl);
    setAssistantOllamaModel(assistantSettings.ollamaModel);
    setAssistantFallback(assistantSettings.fallbackToRules);
  }, [assistantSettings.localIntentEngineEnabled, assistantSettings.ollamaUrl, assistantSettings.ollamaModel, assistantSettings.fallbackToRules]);

  useEffect(() => {
    setSecTimeout(securityState.settings.sessionTimeoutMinutes);
    setSecAutoReveal(securityState.settings.autoRevealWhileUnlocked);
    setSecEnabled(securityState.settings.trustedSessionEnabled);
    setSecSpeak(securityState.settings.speakSensitiveAnswers);
    setSecLockOnClose(securityState.settings.lockOnAppClose);
  }, [securityState.settings.sessionTimeoutMinutes, securityState.settings.autoRevealWhileUnlocked, securityState.settings.trustedSessionEnabled, securityState.settings.speakSensitiveAnswers, securityState.settings.lockOnAppClose]);

  useEffect(() => {
    const node = assistantScrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [assistantMessages]);

  // Focus the input when Command's launcher opens the assistant.
  useEffect(() => {
    if (focusSignal > 0) {
      voiceInputRef.current?.focus();
    }
  }, [focusSignal]);

  useEffect(() => {
    if (listenSignal > 0) {
      void startVoiceListening(listenSource);
    }
  }, [listenSignal]);

  useEffect(() => {
    if (queuedCommandSignal > 0 && queuedCommand?.text.trim()) {
      if (queuedCommand.metrics) {
        onWakeMetricsUpdate(queuedCommand.metrics);
      }
      void sendAssistant(queuedCommand.text, queuedCommand.source);
    }
  }, [queuedCommandSignal]);

  // Pre-warm the mic AND the faster-whisper engine while Ask DexNest is open so
  // the first mic click records instantly with the configured noise constraints
  // and the first transcription is not a cold-start. Gated by the setting,
  // faster-whisper, and Performance Mode; released when Performance Mode blocks.
  useEffect(() => {
    const blocked = speechState.performancePaused || ambientVoiceState.pausedByPerformanceMode;
    if (blocked) {
      releaseMic(true);
      return;
    }
    if (speechState.settings.micPrewarmEnabled !== false && speechState.settings.speechEngine === "faster_whisper") {
      // Pass settings so the warm stream uses the selected device + noise
      // suppression and matches the capture constraints (no re-acquire = instant).
      void prewarmMic(speechState.settings);
      if (speechState.settings.keepSpeechModelWarm !== false && (speechState.engineState === undefined || speechState.engineState === "unavailable")) {
        void getBridge().warmSpeechEngine().then((result) => onSpeechStateChange(result.speechState)).catch(() => undefined);
      }
    }
  }, [speechState.performancePaused, ambientVoiceState.pausedByPerformanceMode, speechState.settings.micPrewarmEnabled, speechState.settings.speechEngine, speechState.settings.selectedInputDeviceId, speechState.settings.noiseSuppression, speechState.settings.echoCancellation, speechState.settings.autoGainControl]);

  // Tick the session countdown; refresh state when it expires so the UI re-locks.
  useEffect(() => {
    if (!securityState.sessionUnlocked || !securityState.sessionExpiresAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
      if (securityState.sessionExpiresAt && Date.now() >= securityState.sessionExpiresAt) {
        void onSecurityChange();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [securityState.sessionUnlocked, securityState.sessionExpiresAt, onSecurityChange]);

  const remainingMs = securityState.sessionExpiresAt ? Math.max(0, securityState.sessionExpiresAt - nowTick) : 0;

  function appendAssistantMessage(message: AssistantChatMessage): void {
    setAssistantMessages((current) => [...current, message]);
  }

  function updateAssistantMessage(id: string, patch: Partial<AssistantChatMessage>): void {
    setAssistantMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }

  function spokenTemplate(route: VoiceRouteResult, ok: boolean, resultCount: number, fallback: string): string {
    if (!ok) {
      // Normalize the raw error into a short, safe spoken sentence.
      return normalizeActionError(fallback).spoken;
    }
    if (route.actionId?.startsWith("external.govee.")) {
      if (route.actionId.endsWith(".turn_on")) return "Lights are on.";
      if (route.actionId.endsWith(".turn_off")) return "Lights are off.";
      if (route.actionId.endsWith(".set_brightness")) return `Lights set to ${Number(route.params.brightness ?? 0)} percent.`;
      if (route.actionId.endsWith(".set_color")) return `Lights set to ${String(route.params.color ?? "the colour")}.`;
      if (route.actionId.endsWith(".set_color_temperature")) return "Lights set.";
      if (route.actionId.endsWith(".toggle")) return "Lights toggled.";
      return "Device updated.";
    }
    if (route.actionId === "system.performance.enable") return "Performance Mode is on.";
    if (route.actionId === "system.performance.disable") return "Performance Mode is off.";
    if (route.actionId === "system.performance.toggle") return "Performance Mode toggled.";
    if (route.intent === "smart_lookup") return resultCount > 0 ? "I found it, but it is hidden for safety." : "I could not find it.";
    if (route.intent === "search_query") return resultCount > 0 ? "I found results." : "I could not find it.";
    if (route.intent === "finder_search" || route.intent === "finder_reverse_lookup") return resultCount > 0 ? "I found it." : "I could not find it.";
    if (route.intent === "finder_add") return "Saved in Finder.";
    if (route.intent === "calendar_create_candidate") return "Review the calendar event in DexNest.";
    if (route.intent === "calendar_show_today" || route.intent === "calendar_show_upcoming") return "Calendar opened.";
    if (route.intent === "drop_send_clipboard") return "Sent to Drop.";
    if (route.intent === "dev_run_command") return "Command finished.";
    if (route.intent === "capture_note") return "Capture started.";
    if (route.intent === "journal_open_today") return "Journal opened.";
    if (route.intent === "open_module") return "Opened.";
    return fallback.replace(/\s+/g, " ").slice(0, 120);
  }

  async function speakDexNestResponse(text: string, context: { sensitivity: VoiceSensitivity; source: string; actionId?: string; allowSpeakSensitive?: boolean; kind?: "success" | "error" | "confirmation" | "workflow" }): Promise<void> {
    const settings = ambientVoiceState.settings;
    const speakableSources = ["ambient_wake_word", "push_to_talk", "assistant", "voice"];
    let blockedReason = "";
    let spoken = false;
    let ttsError = "";
    if (!settings.speakResponses) {
      blockedReason = "disabled";
    } else if (!speakableSources.includes(context.source)) {
      blockedReason = "source_not_spoken";
    } else if (context.kind === "error" && settings.speakErrors === false) {
      blockedReason = "speak_errors_off";
    } else if (context.kind === "confirmation" && settings.speakConfirmations === false) {
      blockedReason = "speak_confirmations_off";
    } else if (context.kind === "workflow" && settings.speakWorkflowStatus === false) {
      blockedReason = "speak_workflow_off";
    } else if (settings.muteInPerformanceMode && (speechState.performancePaused || ambientVoiceState.pausedByPerformanceMode)) {
      blockedReason = "performance_mode";
    } else if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      blockedReason = "speech_synthesis_unavailable";
    }

    const sensitive = context.sensitivity === "sensitive";
    const canSpeakSensitive = sensitive
      && Boolean(context.allowSpeakSensitive)
      && securityState.sessionUnlocked
      && settings.speakSensitiveAnswers
      && securityState.settings.speakSensitiveAnswers;
    const spokenText = sensitive && !canSpeakSensitive
      ? "I found it, but it is hidden for safety."
      : settings.shortResponsesOnly
        ? text.replace(/\s+/g, " ").slice(0, 90)
        : text.replace(/\s+/g, " ").slice(0, 180);
    const ttsAttempted = Boolean(!blockedReason && spokenText.trim());
    const diagnosticsBase = {
      ...defaultTtsDiagnostics,
      ...getTtsDiagnosticsSnapshot(settings.voiceName),
      lastAttemptedAt: new Date().toISOString(),
      lastSource: context.source,
      lastActionId: context.actionId ?? "",
      lastTextPreview: spokenText.replace(/\s+/g, " ").slice(0, 80)
    };

    if (!blockedReason && spokenText.trim()) {
      try {
        const utterance = new SpeechSynthesisUtterance(spokenText);
        utterance.rate = clampTtsRate(settings.voiceRate);
        utterance.volume = clampTtsVolume(settings.voiceVolume);
        const voices = window.speechSynthesis.getVoices();
        const selectedVoice = settings.voiceName ? voices.find((voice) => voice.name === settings.voiceName) : undefined;
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
        ttsUtteranceRef.current = utterance;
        utterance.onstart = () => {
          spoken = true;
          onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: true, blockedReason: "", error: "" });
        };
        const overlayAmbient = (context.source === "ambient_wake_word" || context.source === "push_to_talk") && (ambientVoiceState.settings.voiceOverlayEnabled ?? true);
        utterance.onend = () => {
          ttsUtteranceRef.current = null;
          onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: true, blockedReason: "", error: "" });
          if (overlayAmbient) { getBridge().voiceOverlay({ type: "hide" }); }
          void getBridge().updateAmbientVoiceState({ currentState: "idle", lastSource: context.source });
          void onAmbientVoiceChange();
        };
        utterance.onerror = (event) => {
          ttsUtteranceRef.current = null;
          ttsError = event.error || "speech_synthesis_error";
          blockedReason = ttsError;
          onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: false, blockedReason, error: ttsError });
          if (overlayAmbient) { getBridge().voiceOverlay({ type: "hide" }); }
          void getBridge().updateAmbientVoiceState({ currentState: "idle", lastActionResult: `TTS failed: ${ttsError}`, lastSource: context.source });
          void onAmbientVoiceChange();
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        spoken = true;
        onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: true, blockedReason: "", error: "" });
        if (overlayAmbient) { getBridge().voiceOverlay({ type: "state", state: "speaking" }); }
        void getBridge().updateAmbientVoiceState({ currentState: "speaking", lastActionResult: sensitive && !canSpeakSensitive ? "Sensitive answer hidden for speech." : "Speaking response.", lastSource: context.source });
        window.setTimeout(() => {
          void getBridge().updateAmbientVoiceState({ currentState: "idle", lastSource: context.source });
          void onAmbientVoiceChange();
        }, Math.min(4000, Math.max(1000, spokenText.length * 45)));
      } catch (error) {
        blockedReason = "speak_failed";
        ttsError = error instanceof Error ? error.message : "speak_failed";
        ttsUtteranceRef.current = null;
        onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: false, blockedReason, error: ttsError });
      }
    } else {
      onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: false, blockedReason: blockedReason || (sensitive && !canSpeakSensitive ? "sensitive_blocked" : ""), error: "" });
      // Nothing spoken (disabled/blocked) — fade the desktop overlay out.
      if ((context.source === "ambient_wake_word" || context.source === "push_to_talk") && (ambientVoiceState.settings.voiceOverlayEnabled ?? true)) {
        getBridge().voiceOverlay({ type: "hide" });
      }
    }
    if (context.source === "ambient_wake_word") {
      onWakeMetricsUpdate({ ttsAttempted, ttsSpoken: spoken, ttsBlockedReason: blockedReason || (sensitive && !canSpeakSensitive ? "sensitive_blocked" : "") });
    }

    await onAction("voice.tts_response", context.source, {
      actionId: context.actionId,
      sensitivity: context.sensitivity,
      ttsAttempted,
      ttsSpoken: spoken,
      blockedReason: blockedReason || (sensitive && !canSpeakSensitive ? "sensitive_blocked" : ""),
      error: ttsError
    });
  }

  async function executeAssistantRoute(messageId: string, route: VoiceRouteResult, routerUsed: AssistantRouterUsed, commandSource = "voice"): Promise<void> {
    if (!route.actionId) {
      return;
    }
    await onAction("assistant.confirmed", commandSource, {
      router: routerUsed,
      intent: route.intent,
      targetModule: route.targetModule,
      actionId: route.actionId,
      confidence: route.confidence,
      sensitivity: route.sensitivity
    });
    const actionStartedAt = Date.now();
    const result = await onAction(route.actionId, commandSource, route.params) as {
      ok?: boolean;
      error?: string;
      smartResults?: SmartLookupResult[];
      results?: SearchResult[] | FinderItem[];
    };
    const actionLatencyMs = Date.now() - actionStartedAt;
    if (commandSource === "ambient_wake_word") {
      onWakeMetricsUpdate({ actionLatencyMs });
    }
    // External device actions return one entry per device (e.g. a 2-lamp group).
    // Those are not search results — never render them as cards.
    const isDeviceAction = route.intent === "external_device_control";
    const smartResults = isDeviceAction ? [] : (result.smartResults ?? []);
    const finderResults = route.targetModule === "finder" ? (result.results ?? []) as FinderItem[] : [];
    const searchResults = (route.targetModule === "finder" || isDeviceAction) ? [] : (result.results ?? []) as SearchResult[];
    const resultCount = smartResults.length + searchResults.length + finderResults.length;
    await onAction("assistant.routed", commandSource, {
      router: routerUsed,
      intent: route.intent,
      targetModule: route.targetModule,
      sensitivity: route.sensitivity,
      status: result.ok === false ? "failed" : "completed",
      resultCount,
      actionLatencyMs
    });
    // If a trusted session unlocked auto-reveal, the session may have changed; refresh.
    if (smartResults.some((item) => item.sensitive)) {
      void onSecurityChange();
    }
    const answerText = result.ok === false
      ? (result.error ?? "DexNest could not complete that.")
      : route.intent === "finder_search"
        ? finderItemLookupAnswer(String(route.params.query ?? ""), finderResults)
        : route.intent === "finder_reverse_lookup"
          ? finderReverseLookupAnswer(String(route.params.query ?? ""), finderResults)
          : assistantAnswerText(route, smartResults, resultCount);
    // Phase 23.11: show the short spoken line in chat for device/system/error
    // replies so the visible text matches what DexNest says aloud.
    const shortReply = spokenTemplate(route, result.ok !== false, resultCount, answerText);
    const useSpokenInChat = Boolean(route.actionId?.startsWith("external.govee.")) || Boolean(route.actionId?.startsWith("system.performance.")) || result.ok === false;
    updateAssistantMessage(messageId, {
      awaitingConfirm: false,
      resolved: result.ok === false ? "failed" : "ran",
      smartResults,
      searchResults,
      finderResults,
      text: useSpokenInChat ? shortReply : answerText
    });
    if (route.intent === "finder_search" || route.intent === "finder_reverse_lookup") {
      onFinderLookupComplete(answerText, commandSource);
      void onAction("voice.workflow.finder_lookup", commandSource, {
        workflowMode: "finder_add",
        targetModule: "finder",
        status: result.ok === false ? "failed" : "completed",
        resultCount,
        sensitivityCategory: "personal"
      });
    }
    if (route.intent === "calendar_show_today" || route.intent === "calendar_show_upcoming") {
      void onAction("voice.workflow.calendar_lookup", commandSource, {
        workflowMode: "calendar_create",
        targetModule: "calendar",
        status: result.ok === false ? "failed" : "completed",
        confidence: route.confidence,
        sensitivityCategory: route.sensitivity
      });
    }
    if (route.intent === "finder_add" && result.ok !== false) {
      onFinderMemorySaved(commandSource);
    }
    await getBridge().updateAmbientVoiceState({
      currentState: "idle",
      lastActionResult: result.ok === false ? "Command failed." : answerText,
      lastSource: commandSource
    });
    void onAmbientVoiceChange();
    await speakDexNestResponse(spokenTemplate(route, result.ok !== false, resultCount, answerText), {
      sensitivity: route.sensitivity,
      source: commandSource,
      actionId: route.actionId,
      allowSpeakSensitive: Boolean(route.intent === "smart_lookup"),
      kind: result.ok === false ? "error" : "success"
    });
  }

  function ambientRouteBlockedMessage(route: VoiceRouteResult, commandSource: string): string | null {
    // Wake-word commands (Phase 23.8) have their own allow-list + safer copy.
    if (commandSource === "ambient_wake_word") {
      if (route.intent === "external_device_control" && !(ambientVoiceState.settings.allowWakeWordDeviceControl ?? true)) {
        return "Wake-word device control is disabled in Settings.";
      }
      if (route.intent === "smart_lookup" || route.sensitivity === "sensitive") {
        if (!(ambientVoiceState.settings.allowWakeWordSensitiveLookup ?? false)) {
          return "Open DexNest to ask sensitive questions.";
        }
      }
      return null;
    }
    if (commandSource !== "ambient_voice" && commandSource !== "push_to_talk") {
      return null;
    }
    if (route.intent === "external_device_control" && !ambientVoiceState.settings.allowDeviceControl) {
      return "Ambient Voice device control is disabled in Settings.";
    }
    if ((route.intent === "drop_send_clipboard" || route.targetModule === "clipboard") && !ambientVoiceState.settings.allowClipboardActions) {
      return "Ambient Voice Clipboard and Drop routes are disabled in Settings.";
    }
    if (route.intent === "dev_run_command" && !ambientVoiceState.settings.allowDevActions) {
      return "Ambient Voice Dev actions are disabled in Settings.";
    }
    if (route.sensitivity === "sensitive" && !ambientVoiceState.settings.allowSensitiveLookups) {
      return "Ambient Voice sensitive lookups are disabled in Settings.";
    }
    return null;
  }

  async function sendAssistant(rawText = voiceInput, commandSource = "voice"): Promise<void> {
    // Strip the leading wake phrase from wake-triggered commands ("Hey Jarvis,
    // turn off lights" → "turn off lights"). The phrase depends on the engine mode.
    const wakePhraseText = ambientVoiceState.settings.wakePhraseMode === "hey_jarvis"
      ? "hey jarvis"
      : ambientVoiceState.settings.wakePhraseMode === "alexa"
        ? "alexa"
        : (ambientVoiceState.settings.wakeWord || "Nest");
    const text = (commandSource === "ambient_wake_word" ? stripWakeWord(rawText, wakePhraseText) : rawText).trim();
    if (!text || assistantBusy) {
      return;
    }
    setVoiceInput("");
    appendAssistantMessage({ id: createClientId("assistant-user"), role: "user", text });

    // Phase 23.4: journal continuous voice workflow takes priority over normal
    // routing. "start today's journal" enters journal mode; while active, control
    // words route to journal controls instead of being treated as commands.
    if (isStartJournalCommand(text)) {
      appendAssistantMessage({
        id: createClientId("assistant-reply"),
        role: "assistant",
        text: speechState.performancePaused
          ? "Speech is paused by Performance Mode."
          : "Journal mode started. Speak freely. Say “save journal” or “stop journal” when done.",
        routerUsed: "fast_path",
        resolved: "info"
      });
      if (!speechState.performancePaused) {
        await speakDexNestResponse("Journal started.", { sensitivity: "none", source: commandSource, actionId: "voice.workflow.journal_start", kind: "workflow" });
      }
      await onStartJournalVoice(commandSource);
      return;
    }
    if (journalVoiceActive) {
      const control = matchJournalControl(text);
      if (control) {
        onJournalControl(control);
        appendAssistantMessage({
          id: createClientId("assistant-reply"),
          role: "assistant",
          text: control === "save" ? "Journal saved. Journal mode stopped."
            : control === "pause" ? "Journal mode paused. Say “resume journal” to continue."
            : control === "resume" ? "Journal mode resumed."
            : "Journal mode stopped. Saved chunks were kept.",
          routerUsed: "fast_path",
          resolved: "info"
        });
        await speakDexNestResponse(
          control === "save" ? "Journal saved." : control === "pause" ? "Journal paused." : control === "resume" ? "Journal resumed." : "Journal saved.",
          { sensitivity: "none", source: commandSource, actionId: `voice.workflow.journal_${control}`, kind: "workflow" }
        );
        return;
      }
    }
    if (pendingCalendarCandidate?.missingFields.length) {
      const patch = parseCalendarFollowUpPatch(text, pendingCalendarCandidate, voiceWorkflowSettings);
      if (patch) {
        const nextCandidate = updatedCalendarCandidate(pendingCalendarCandidate, patch, voiceWorkflowSettings);
        setPendingCalendarCandidate(nextCandidate.missingFields.length ? nextCandidate : null);
        onCalendarVoiceCandidate(nextCandidate, commandSource);
        appendAssistantMessage({
          id: createClientId("assistant-reply"),
          role: "assistant",
          text: nextCandidate.missingFields.length > 0
            ? `Updated the Calendar candidate. Still missing ${nextCandidate.missingFields.join(", ")}.`
            : `Updated the Calendar candidate. Add ${nextCandidate.title} on ${formatLocalDate(nextCandidate.date)}${nextCandidate.startTime ? ` at ${nextCandidate.startTime}` : ""}?`,
          routerUsed: "fast_path",
          resolved: "info"
        });
        await onAction("voice.workflow.calendar_candidate", commandSource, {
          workflowMode: "calendar_create",
          targetModule: "calendar",
          status: "follow_up_updated",
          confidence: nextCandidate.confidence,
          missingFieldCount: nextCandidate.missingFields.length,
          eventType: nextCandidate.eventType,
          sensitivityCategory: nextCandidate.sensitivity
        });
        return;
      }
    }
    setAssistantBusy(true);
    const routingStartedAt = Date.now();

    // Fast deterministic router runs first; obvious commands never reach Ollama.
    const fastRoute = fastCommandRouter(text, actions, voiceWorkflowSettings);
    const ruleRoute = fastRoute ?? routeVoiceCommand(text, actions, voiceWorkflowSettings);
    const initialRoutingLatencyMs = Date.now() - routingStartedAt;
    if (commandSource === "ambient_wake_word") {
      onWakeMetricsUpdate({ routingLatencyMs: initialRoutingLatencyMs });
    }
    await getBridge().updateAmbientVoiceState({
      currentState: "processing",
      lastRecognizedCommand: text,
      lastActionResult: "Routing command.",
      lastSource: commandSource
    });
    void onAmbientVoiceChange();
    await onAction("assistant.command_received", commandSource, {
      router: fastRoute ? "fast_path" : "rules",
      intent: ruleRoute.intent,
      sensitivity: ruleRoute.sensitivity,
      status: "received",
      routingLatencyMs: initialRoutingLatencyMs
    });

    try {
      let route = ruleRoute;
      let routerUsed: AssistantRouterUsed = fastRoute ? "fast_path" : "rules";

      // Obvious system/light commands hit registered DexNest actions directly;
      // Ollama is only useful when DexNest cannot classify the phrasing.
      const engineEligible = !fastRoute
        && assistantSettings.localIntentEngineEnabled
        && ruleRoute.intent !== "external_device_control"
        && (ruleRoute.intent === "unknown" || ruleRoute.confidence !== "high");
      if (engineEligible) {
        const llm = await getBridge().assistantLlmIntent({ query: text });
        if (llm.ok) {
          const validated = validateLlmIntent(llm.intent, text, actions, voiceWorkflowSettings);
          if (validated) {
            route = validated;
            routerUsed = "local-llm";
          }
        } else if ((llm.error ?? "").includes("Performance Mode")) {
          appendAssistantMessage({
            id: createClientId("assistant-reply"),
            role: "assistant",
            text: llm.error ?? "Assistant local LLM paused by Performance Mode.",
            resolved: "info"
          });
          return;
        }
      }

      const blockedMessage = ambientRouteBlockedMessage(route, commandSource);
      if (blockedMessage) {
        appendAssistantMessage({
          id: createClientId("assistant-reply"),
          role: "assistant",
          text: blockedMessage,
          route,
          routerUsed,
          resolved: "blocked"
        });
        await onAction("assistant.routed", commandSource, {
          router: routerUsed,
          intent: route.intent,
          targetModule: route.targetModule,
          sensitivity: route.sensitivity,
          confidence: route.confidence,
          status: "blocked"
        });
        await getBridge().updateAmbientVoiceState({
          currentState: "idle",
          lastActionResult: blockedMessage,
          lastSource: commandSource
        });
        // Speak the safe blocked message (e.g. "Open DexNest to ask sensitive questions.").
        if (ambientVoiceState.settings.speakConfirmations !== false) {
          await speakDexNestResponse(blockedMessage, { sensitivity: "none", source: commandSource, actionId: route.actionId });
        }
        void onAmbientVoiceChange();
        return;
      }

      if (route.intent === "capture_note" && route.actionId === "voice.workflow.start") {
        const assistantId = createClientId("assistant-reply");
        appendAssistantMessage({
          id: assistantId,
          role: "assistant",
          text: speechState.performancePaused
            ? "Speech is paused by Performance Mode."
            : "Capture mode listening. Speak the note, then pause.",
          route,
          routerUsed,
          awaitingConfirm: false,
          resolved: speechState.performancePaused ? "blocked" : "info"
        });
        await onAction("assistant.routed", commandSource, {
          router: routerUsed,
          intent: route.intent,
          targetModule: route.targetModule,
          sensitivity: route.sensitivity,
          confidence: route.confidence,
          status: speechState.performancePaused ? "blocked" : "workflow_started"
        });
        if (!speechState.performancePaused) {
          await onStartCaptureVoice(commandSource);
        }
        return;
      }

      if (route.intent === "calendar_create_candidate") {
        const candidate = (route.params.candidate as CalendarVoiceCandidate | undefined) ?? parseCalendarVoiceCandidate(text, voiceWorkflowSettings);
        if (!candidate) {
          appendAssistantMessage({
            id: createClientId("assistant-reply"),
            role: "assistant",
            text: "I could not build a Calendar candidate from that. Try adding a date like tomorrow or next Friday.",
            route,
            routerUsed,
            resolved: "failed"
          });
          return;
        }
        const shouldAutoCreate = shouldAutoCreateCalendarCandidate(candidate, voiceWorkflowSettings);
        if (!shouldAutoCreate) {
          setPendingCalendarCandidate(candidate.missingFields.length ? candidate : null);
          onCalendarVoiceCandidate(candidate, commandSource);
          appendAssistantMessage({
            id: createClientId("assistant-reply"),
            role: "assistant",
            text: candidate.missingFields.length > 0
              ? candidate.missingFields.includes("time")
                ? "Calendar candidate ready. What time should I use? You can also edit it on the Calendar page."
                : `Calendar candidate ready. Please provide missing ${candidate.missingFields.join(", ")} or edit it on the Calendar page.`
              : "Calendar candidate ready. Review it on the Calendar page, then Add event.",
            route,
            routerUsed,
            awaitingConfirm: false,
            resolved: "info"
          });
          await onAction("assistant.routed", commandSource, {
            router: routerUsed,
            intent: route.intent,
            targetModule: route.targetModule,
            sensitivity: route.sensitivity,
            confidence: route.confidence,
            status: "candidate_created",
            missingFieldCount: candidate.missingFields.length
          });
        await getBridge().updateAmbientVoiceState({
          currentState: "idle",
          lastActionResult: "Calendar candidate ready in DexNest.",
          lastSource: commandSource
        });
        void onAmbientVoiceChange();
        await speakDexNestResponse(candidate.missingFields.length > 0 ? "I need a time or date." : "Review the calendar event in DexNest.", {
          sensitivity: candidate.sensitivity,
          source: commandSource,
          actionId: "voice.workflow.calendar_candidate",
          kind: "workflow"
        });
        return;
      }
        setPendingCalendarCandidate(null);
        route = {
          ...route,
          actionId: "calendar.create_event",
          params: calendarCandidateToActionParams(candidate),
          requiresConfirmation: false
        };
      }

      const assistantId = createClientId("assistant-reply");
      const needsConfirm = route.intent !== "unknown" && Boolean(route.actionId) && assistantNeedsConfirm(route, actions);
      if (route.intent === "finder_add") {
        const candidate = parseFinderAddPhrase(text);
        if (candidate) {
          onFinderVoiceCandidate(candidate, commandSource);
        } else {
          await onAction("finder.open", commandSource, {});
        }
      }
      const initialText = route.intent === "unknown"
        ? "I’m not sure what to do yet. Here are some things you can ask."
        : needsConfirm
          ? assistantPendingText(route)
          : "Working on it…";

      appendAssistantMessage({
        id: assistantId,
        role: "assistant",
        text: initialText,
        route,
        routerUsed,
        awaitingConfirm: needsConfirm,
        resolved: route.intent === "unknown" ? "info" : undefined
      });

      await onAction("assistant.routed", commandSource, {
        router: routerUsed,
        intent: route.intent,
        targetModule: route.targetModule,
        sensitivity: route.sensitivity,
        confidence: route.confidence,
        status: route.intent === "unknown" ? "unknown" : (needsConfirm ? "awaiting_confirm" : "detected")
      });

      if (route.intent !== "unknown" && route.actionId && !needsConfirm) {
        await executeAssistantRoute(assistantId, route, routerUsed, commandSource);
      } else {
        if (needsConfirm) {
          await speakDexNestResponse("Open DexNest to confirm.", {
            sensitivity: route.sensitivity,
            source: commandSource,
            actionId: route.actionId,
            kind: "confirmation"
          });
        }
        await getBridge().updateAmbientVoiceState({
          currentState: "idle",
          lastActionResult: needsConfirm ? "Confirmation required in DexNest." : "No matching action.",
          lastSource: commandSource
        });
        void onAmbientVoiceChange();
      }
    } finally {
      setAssistantBusy(false);
    }
  }

  async function confirmAssistant(message: AssistantChatMessage): Promise<void> {
    if (!message.route || !message.awaitingConfirm) {
      return;
    }
    setAssistantBusy(true);
    try {
      await executeAssistantRoute(message.id, message.route, message.routerUsed ?? "rules", "voice");
    } finally {
      setAssistantBusy(false);
    }
  }

  async function cancelAssistant(message: AssistantChatMessage): Promise<void> {
    if (!message.route) {
      return;
    }
    await onAction("assistant.cancelled", "voice", {
      router: message.routerUsed ?? "rules",
      intent: message.route.intent,
      targetModule: message.route.targetModule,
      sensitivity: message.route.sensitivity,
      status: "cancelled"
    });
    updateAssistantMessage(message.id, { awaitingConfirm: false, resolved: "cancelled", text: "Cancelled. Nothing was run." });
  }

  function isSmartResultRevealed(result: SmartLookupResult): boolean {
    return !result.sensitive || Boolean(result.autoRevealed) || revealedAssistantIds.includes(result.id);
  }

  async function revealAssistantSmart(result: SmartLookupResult): Promise<void> {
    if (result.sensitive && !securityState.sessionUnlocked && !window.confirm(`Reveal sensitive ${result.fieldType.replace(/_/g, " ")} value?`)) {
      return;
    }
    const actionResult = await onAction("search.smart_lookup_reveal", "voice", { fieldType: result.fieldType, confirmedDangerous: true }) as { ok?: boolean };
    if (actionResult.ok !== false) {
      setRevealedAssistantIds((current) => [...new Set([...current, result.id])]);
    }
  }

  async function copyAssistantSmart(result: SmartLookupResult): Promise<void> {
    if (result.sensitive && !securityState.sessionUnlocked && !window.confirm(`Copy sensitive ${result.fieldType.replace(/_/g, " ")} value? Clipboard clears automatically.`)) {
      return;
    }
    await onAction("search.smart_lookup_copy_answer", "voice", { answerValue: result.answer, fieldType: result.fieldType, confirmedDangerous: true });
  }

  async function saveAssistantSettings(): Promise<void> {
    await getBridge().saveAssistantSettings({
      localIntentEngineEnabled: assistantEngineEnabled,
      ollamaUrl: assistantOllamaUrl,
      ollamaModel: assistantOllamaModel,
      fallbackToRules: assistantFallback
    });
    await onAssistantSettingsChange();
    setAssistantTestStatus("Assistant settings saved.");
  }

  async function testAssistantOllama(): Promise<void> {
    setAssistantTestStatus("Testing Ollama connection…");
    const result = await getBridge().testOllama({ ollamaUrl: assistantOllamaUrl, ollamaModel: assistantOllamaModel });
    if (!result.ok) {
      setAssistantTestStatus(`Connection failed: ${result.error ?? "unknown error"}`);
      return;
    }
    const modelNote = result.modelAvailable ? `Model "${assistantOllamaModel}" is available.` : `Model "${assistantOllamaModel}" not found. Pull it with: ollama pull ${assistantOllamaModel}`;
    setAssistantTestStatus(`Connected. ${result.models?.length ?? 0} model(s) installed. ${modelNote}`);
  }

  async function unlockSensitiveSession(): Promise<void> {
    const needsPassword = !securityState.secureVaultUnlocked && securityState.secureVaultSetup;
    const result = await getBridge().unlockTrustedSession({ masterPassword: needsPassword ? unlockPassword : undefined });
    setUnlockPassword("");
    setSessionStatus(result.ok ? "" : (result.error ?? "Unlock failed."));
    await onSecurityChange();
  }

  async function lockSensitiveSession(): Promise<void> {
    await getBridge().lockTrustedSession();
    setSessionStatus("");
    await onSecurityChange();
  }

  async function saveSecuritySettings(): Promise<void> {
    await getBridge().saveAssistantSecuritySettings({
      trustedSessionEnabled: secEnabled,
      autoRevealWhileUnlocked: secAutoReveal,
      sessionTimeoutMinutes: secTimeout,
      speakSensitiveAnswers: secSpeak,
      lockOnAppClose: secLockOnClose
    });
    await onSecurityChange();
    setSessionStatus("Trusted session settings saved.");
  }

  async function startVoiceListening(commandSource = "voice"): Promise<void> {
    if (voiceListening) {
      return;
    }
    if (speechState.performancePaused || ambientVoiceState.pausedByPerformanceMode) {
      setMicStatus("Speech is paused by Performance Mode.");
      await getBridge().updateAmbientVoiceState({
        currentState: "paused",
        lastActionResult: "Speech paused by Performance Mode.",
        lastSource: commandSource
      });
      await onAmbientVoiceChange();
      return;
    }
    voiceInputRef.current?.focus();
    setVoiceListening(true);
    await getBridge().updateAmbientVoiceState({
      currentState: "listening",
      lastActionResult: "Recording with DexNest local speech service.",
      lastSource: commandSource
    });
    void onAmbientVoiceChange();
    setMicStatus("Listening locally. Speak, then pause.");
    await onAction("voice.start_listening", commandSource, {
      speechRecognitionAvailable: true,
      provider: speechState.settings.speechEngine,
      status: "started"
    });
    try {
      const result = await runSharedSpeechCapture({ speechState, source: commandSource, sourceModule: "ask_dexnest" });
      if (result.speechState) {
        onSpeechStateChange(result.speechState);
      }
      if (result.status === "success" && result.transcript.trim()) {
        const transcript = result.transcript.trim();
        setMicStatus(`Captured with ${result.engine}${result.metrics ? ` · mic→rec ${result.metrics.micClickToRecordingMs}ms · transcribe ${result.metrics.transcriptionLatencyMs ?? result.durationMs}ms` : ` in ${result.durationMs} ms`}.`);
        await getBridge().updateAmbientVoiceState({
          currentState: "processing",
          lastRecognizedCommand: transcript,
          lastActionResult: "Speech captured.",
          lastSource: commandSource
        });
        void onAmbientVoiceChange();
        if (speechState.settings.showTranscriptBeforeSend || !speechState.settings.autoSendAfterSpeech) {
          setVoiceInput(transcript);
        } else {
          void sendAssistant(transcript, commandSource);
        }
        return;
      }
      throw new Error(result.error ?? "No new speech captured.");
    } catch (error) {
      if (speechState.settings.fallbackToWindows) {
        const windowsResult = await getBridge().startWindowsDictation();
        setMicStatus(windowsResult.ok ? "Windows fallback started. Speak now." : (windowsResult.error ?? "Speech failed. Type your question instead."));
        await onAction("voice.start_dictation_placeholder", commandSource, {
          provider: "windows_dictation",
          status: windowsResult.ok ? "started" : "failed"
        });
      } else {
        setMicStatus(error instanceof Error ? error.message : "Speech failed. Type your question instead.");
      }
      await getBridge().updateAmbientVoiceState({
        currentState: "idle",
        lastActionResult: error instanceof Error ? error.message : "Speech failed.",
        lastSource: commandSource
      });
      void onAmbientVoiceChange();
    } finally {
      setVoiceListening(false);
    }
  }

  const sessionEnabled = securityState.settings.trustedSessionEnabled;
  const canUnlockWithVault = securityState.secureVaultUnlocked;
  const needsPasswordToUnlock = !securityState.secureVaultUnlocked && securityState.secureVaultSetup;

  return (
    <div className="assistant accent-search">
      <div className="section-heading section-heading--row">
        <div>
          <p>Ask DexNest in plain language across your documents, Vault, OCR, notes, and local memory.</p>
          <p className="technical">Local-only · no cloud · sensitive answers stay masked{assistantSettings.localIntentEngineEnabled ? " · local LLM on" : " · rules only"}</p>
        </div>
        <label className="assistant__debug-toggle">
          <input type="checkbox" checked={assistantDebug} onChange={(event) => setAssistantDebug(event.target.checked)} />
          <span>Debug</span>
        </label>
      </div>

      <div className="assistant__session" data-unlocked={securityState.sessionUnlocked}>
        {!sessionEnabled ? (
          <span className="technical">Trusted session disabled. Sensitive answers always require Reveal.</span>
        ) : securityState.sessionUnlocked ? (
          <>
            <span className="assistant__session-state">🔓 Sensitive session unlocked · {formatSessionRemaining(remainingMs)} left</span>
            <button type="button" onClick={() => void lockSensitiveSession()}>Lock now</button>
          </>
        ) : (
          <>
            <span className="assistant__session-state">🔒 Sensitive answers locked</span>
            {needsPasswordToUnlock && (
              <input
                type="password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void unlockSensitiveSession(); } }}
                placeholder="Secure Vault master password"
                aria-label="Secure Vault master password"
              />
            )}
            {securityState.secureVaultSetup ? (
              <button type="button" onClick={() => void unlockSensitiveSession()}>
                {canUnlockWithVault ? "Unlock sensitive session" : "Unlock"}
              </button>
            ) : (
              <span className="technical">Set up Secure Vault to enable trusted unlock.</span>
            )}
          </>
        )}
      </div>
      {sessionStatus && <p className="inline-status">{sessionStatus}</p>}

      <div className="assistant__transcript" ref={assistantScrollRef}>
        {assistantMessages.length === 0 ? (
          <div className="assistant__empty">
            <p>Try one of these:</p>
            <div className="assistant__examples">
              {[
                "What is my work permit number?",
                "Where did I put my passport?",
                "Find my passport document",
                "Search work permit",
                "Add meeting with Tim tomorrow at 3",
                "Run typecheck"
              ].map((example) => (
                <button type="button" key={example} disabled={assistantBusy} onClick={() => void sendAssistant(example)}>{example}</button>
              ))}
            </div>
          </div>
        ) : (
          assistantMessages.map((message) => (
            <div className={`assistant__msg assistant__msg--${message.role}`} key={message.id}>
              <div className="assistant__bubble">
                <p>{message.text}</p>

                {message.smartResults && message.smartResults.length > 0 && (
                  <div className="assistant__results">
                    {message.smartResults.slice(0, 5).map((result) => {
                      const revealed = isSmartResultRevealed(result);
                      return (
                        <article className="assistant__card accent-search" key={result.id}>
                          <strong>{result.fieldType.replace(/_/g, " ")}</strong>
                          <span className="technical">{revealed ? result.answer : result.maskedAnswer}</span>
                          <span>{result.confidence} · {result.sourceType ?? "Vault"} · {result.sourceDocumentTitle}</span>
                          <div className="button-row">
                            {result.sensitive && !revealed && <button type="button" onClick={() => void revealAssistantSmart(result)}>Reveal</button>}
                            <button type="button" onClick={() => void copyAssistantSmart(result)}>Copy (auto-clear)</button>
                            {sourceOpenActionId(result.sourceModule) && (
                              <button type="button" onClick={() => void onAction(sourceOpenActionId(result.sourceModule) as string, "voice")}>Open source</button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                {message.searchResults && message.searchResults.length > 0 && (
                  <div className="assistant__results">
                    {message.searchResults.slice(0, 5).map((result) => (
                      <article className="assistant__card accent-search" key={result.id}>
                        <strong>{result.title}</strong>
                        <span>{result.sourceModule} · {result.matchReason}</span>
                        {result.textPreview && <span>{result.textPreview}</span>}
                      </article>
                    ))}
                  </div>
                )}

                {message.finderResults && message.finderResults.length > 0 && (
                  <div className="assistant__results">
                    {message.finderResults.slice(0, 5).map((result) => (
                      <article className="assistant__card accent-finder" key={result.id}>
                        <strong>{result.itemName}</strong>
                        <span>{result.location}{result.container ? ` / ${result.container}` : ""}{result.room ? ` / ${result.room}` : ""}</span>
                        <span>{result.status}</span>
                      </article>
                    ))}
                  </div>
                )}

                {message.route?.intent === "unknown" && (message.route.suggestions ?? []).length > 0 && (
                  <div className="assistant__suggestions">
                    {(message.route.suggestions ?? []).map((suggestion) => (
                      <button type="button" key={suggestion} disabled={assistantBusy} onClick={() => void sendAssistant(suggestion.replace(/^Try:\s*/i, ""))}>{suggestion}</button>
                    ))}
                  </div>
                )}

                {message.awaitingConfirm && (
                  <div className="button-row">
                    <button type="button" disabled={assistantBusy} onClick={() => void confirmAssistant(message)}>Confirm</button>
                    <button type="button" disabled={assistantBusy} onClick={() => void cancelAssistant(message)}>Cancel</button>
                  </div>
                )}

                {assistantDebug && message.route && (
                  <div className="assistant__debug technical">
                    <span>router: {message.routerUsed ?? "rules"}</span>
                    <span>intent: {message.route.intent}</span>
                    <span>module: {message.route.targetModule}</span>
                    <span>action: {message.route.actionId ?? "none"}</span>
                    <span>confidence: {message.route.confidence}</span>
                    <span>sensitivity: {message.route.sensitivity}</span>
                    <pre>{JSON.stringify(assistantDebugParams(message.route), null, 2)}</pre>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="assistant__inputbar">
        <button type="button" className={voiceListening ? "is-busy" : undefined} disabled={voiceListening} onClick={() => void startVoiceListening()} title="Click to speak (no always-on mic)">
          {voiceListening ? "Listening…" : "Mic"}
        </button>
        <input
          ref={voiceInputRef}
          value={voiceInput}
          onChange={(event) => setVoiceInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void sendAssistant();
            }
          }}
          placeholder="Ask DexNest… e.g. What is my work permit number?"
          aria-label="Ask DexNest"
        />
        <button type="button" disabled={assistantBusy || !voiceInput.trim()} onClick={() => void sendAssistant()}>Send</button>
      </div>
      {assistantBusy && <p className="inline-status"><Spinner size="sm" /> Thinking…</p>}
      {!assistantBusy && micStatus && <p className="inline-status">{voiceListening && <Spinner size="sm" />} {micStatus}</p>}

      <div className="assistant__toggles">
        <button type="button" className="assistant__settings-toggle" aria-expanded={securityOpen} onClick={() => setSecurityOpen((open) => !open)}>
          {securityOpen ? "Hide" : "Show"} sensitive session settings
        </button>
        <button type="button" className="assistant__settings-toggle" aria-expanded={assistantSettingsOpen} onClick={() => setAssistantSettingsOpen((open) => !open)}>
          {assistantSettingsOpen ? "Hide" : "Show"} local intent engine settings
        </button>
      </div>

      {securityOpen && (
        <div className="assistant__settings">
          <label className="assistant__check">
            <input type="checkbox" checked={secEnabled} onChange={(event) => setSecEnabled(event.target.checked)} />
            <span>Enable trusted sensitive session (reuses Secure Vault unlock).</span>
          </label>
          <label className="assistant__check">
            <input type="checkbox" checked={secAutoReveal} onChange={(event) => setSecAutoReveal(event.target.checked)} />
            <span>Auto-reveal sensitive answers while the session is unlocked.</span>
          </label>
          <label>
            Session timeout
            <select value={secTimeout} onChange={(event) => setSecTimeout(Number(event.target.value))}>
              {[5, 10, 15, 30].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
            </select>
          </label>
          <label className="assistant__check">
            <input type="checkbox" checked={secSpeak} onChange={(event) => setSecSpeak(event.target.checked)} />
            <span>Speak sensitive answers aloud (future voice output). Off by default.</span>
          </label>
          <label className="assistant__check">
            <input type="checkbox" checked={secLockOnClose} onChange={(event) => setSecLockOnClose(event.target.checked)} />
            <span>Lock sensitive session when DexNest closes.</span>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void saveSecuritySettings()}>Save session settings</button>
            {securityState.sessionUnlocked && <button type="button" onClick={() => void lockSensitiveSession()}>Lock sensitive session</button>}
          </div>
        </div>
      )}

      {assistantSettingsOpen && (
        <div className="assistant__settings">
          <label className="assistant__check">
            <input type="checkbox" checked={assistantEngineEnabled} onChange={(event) => setAssistantEngineEnabled(event.target.checked)} />
            <span>Enable local intent engine (Ollama). When off, DexNest uses the rule router only.</span>
          </label>
          <label>
            Ollama URL
            <input value={assistantOllamaUrl} onChange={(event) => setAssistantOllamaUrl(event.target.value)} placeholder="http://127.0.0.1:11434" />
          </label>
          <label>
            Model name
            <input value={assistantOllamaModel} onChange={(event) => setAssistantOllamaModel(event.target.value)} placeholder="qwen2.5:3b" />
          </label>
          <label className="assistant__check">
            <input type="checkbox" checked={assistantFallback} onChange={(event) => setAssistantFallback(event.target.checked)} />
            <span>Fall back to the rule router if Ollama fails or is unavailable.</span>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void testAssistantOllama()}>Test Ollama connection</button>
            <button type="button" onClick={() => void saveAssistantSettings()}>Save settings</button>
          </div>
          {assistantTestStatus && <p className="inline-status">{assistantTestStatus}</p>}
        </div>
      )}
    </div>
  );
}

function CommandView({
  appInfo,
  actions,
  clipboardState,
  pinnedActionIds,
  calendarState,
  commandStats,
  events,
  performanceModeState,
  performanceModeSettings,
  onOpenAssistant,
  onAction,
  onPerformanceToggle,
  onPinnedActionsChange
}: {
  appInfo: AppInfo | null;
  actions: ActionDefinition[];
  clipboardState: ClipboardState;
  pinnedActionIds: string[];
  calendarState: CalendarState;
  commandStats: CommandStats;
  events: EventEntry[];
  performanceModeState: PerformanceModeState;
  performanceModeSettings: PerformanceModeSettings;
  onOpenAssistant: () => void;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onPerformanceToggle: (enabled: boolean) => Promise<void>;
  onPinnedActionsChange: (actionIds: string[]) => Promise<void>;
}) {
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionSearch, setActionSearch] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteMessage, setPaletteMessage] = useState("");
  const [performanceBusy, setPerformanceBusy] = useState(false);
  const modules = [...new Set(actions.map((action) => action.module).filter(Boolean))].sort();
  const pinnedActions = pinnedActionIds
    .map((actionId) => actions.find((action) => action.id === actionId))
    .filter((action): action is ActionDefinition => Boolean(action));
  const filteredActions = actions.filter((action) => {
    const query = actionSearch.trim().toLowerCase();
    const matchesModule = moduleFilter === "all" || action.module === moduleFilter;
    const matchesSearch = !query || action.id.toLowerCase().includes(query) || action.title.toLowerCase().includes(query);
    return matchesModule && matchesSearch;
  });
  const recentActionIds = events
    .map((event) => event.actionId)
    .filter((actionId): actionId is string => Boolean(actionId));
  const paletteQueryText = paletteQuery.trim().toLowerCase();
  const paletteActions = actions
    .filter((action) => {
      if (!paletteQueryText) {
        return true;
      }
      return action.id.toLowerCase().includes(paletteQueryText)
        || action.title.toLowerCase().includes(paletteQueryText)
        || action.module.toLowerCase().includes(paletteQueryText);
    })
    .sort((left, right) => {
      const leftPinned = pinnedActionIds.includes(left.id) ? 0 : 1;
      const rightPinned = pinnedActionIds.includes(right.id) ? 0 : 1;
      if (leftPinned !== rightPinned) {
        return leftPinned - rightPinned;
      }
      const leftRecent = recentActionIds.indexOf(left.id);
      const rightRecent = recentActionIds.indexOf(right.id);
      if (leftRecent !== rightRecent) {
        return (leftRecent === -1 ? Number.MAX_SAFE_INTEGER : leftRecent) - (rightRecent === -1 ? Number.MAX_SAFE_INTEGER : rightRecent);
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, 12);
  const commandChainRequested = paletteQuery.includes("->");
  const topNudges = [
    ...calendarState.urgentNudges,
    ...calendarState.todayNudges.filter((nudge) => !calendarState.urgentNudges.some((urgent) => urgent.id === nudge.id))
  ].slice(0, 5);

  function canRunWithoutConfirmation(action: ActionDefinition): boolean {
    return action.dangerLevel === "safe" || action.dangerLevel === "caution";
  }

  async function runPaletteAction(action: ActionDefinition | undefined): Promise<void> {
    if (!action) {
      return;
    }

    await runRegistryActionFromSource(action, "command");
    setPaletteMessage(`${viewFromAction(action) ? "Opened" : "Ran"} ${action.title}.`);
  }

  async function runRegistryActionFromSource(action: ActionDefinition, source: string): Promise<void> {
    if (!canRunWithoutConfirmation(action)) {
      const confirmed = window.confirm(`Run ${action.title}? Danger level: ${action.dangerLevel}.`);
      if (!confirmed) {
        return;
      }
    }

    await onAction(action.id, source, { confirmedDangerous: !canRunWithoutConfirmation(action) });
  }

  function handlePaletteKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPaletteIndex((current) => Math.min(current + 1, Math.max(0, paletteActions.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setPaletteIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Escape") {
      setPaletteQuery("");
      setPaletteIndex(0);
      setPaletteMessage("");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (commandChainRequested) {
        setPaletteMessage("Command chaining coming soon.");
        return;
      }
      void runPaletteAction(paletteActions[paletteIndex] ?? paletteActions[0]);
    }
  }

  async function togglePinnedAction(actionId: string): Promise<void> {
    const nextPinnedActionIds = pinnedActionIds.includes(actionId)
      ? pinnedActionIds.filter((id) => id !== actionId)
      : [...pinnedActionIds, actionId];

    await onPinnedActionsChange(nextPinnedActionIds);
  }

  async function movePinnedAction(actionId: string, direction: -1 | 1): Promise<void> {
    const currentIndex = pinnedActionIds.indexOf(actionId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= pinnedActionIds.length) {
      return;
    }

    const nextPinnedActionIds = [...pinnedActionIds];
    [nextPinnedActionIds[currentIndex], nextPinnedActionIds[nextIndex]] = [nextPinnedActionIds[nextIndex], nextPinnedActionIds[currentIndex]];
    await onPinnedActionsChange(nextPinnedActionIds);
  }

  async function toggleCommandPerformanceMode(): Promise<void> {
    setPerformanceBusy(true);
    try {
      await onPerformanceToggle(!performanceModeState.enabled);
    } finally {
      setPerformanceBusy(false);
    }
  }

  const statCards = [
    ["Journal week", commandStats.journalEntriesThisWeek],
    ["Calendar upcoming", commandStats.calendarUpcoming],
    ["Nudges today", commandStats.todayNudges],
    ["Urgent nudges", commandStats.urgentNudges],
    ["Active nudges", commandStats.activeNudges],
    ["Transactions month", commandStats.transactionsThisMonth],
    ["Receipts month", commandStats.receiptsThisMonth],
    ["Vault documents", commandStats.vaultDocuments],
    ["Drop in/out", `${commandStats.dropIncoming}/${commandStats.dropOutgoing}`],
    ["Capture inbox", commandStats.capturesInbox],
    ["Finder items", commandStats.finderItems],
    ["Dev projects", commandStats.devProjects],
    ["Actions today", commandStats.actionsRunToday],
    ["Failures today", commandStats.failedActionsToday],
    ["Routines today", commandStats.routinesRunToday],
    ["Active time today", formatDuration(commandStats.heatmapActiveSecondsToday)],
    ["Top app today", commandStats.heatmapTopAppToday],
    ["Heatmap", commandStats.heatmapStatus]
  ] as const;

  return (
    <section className="view-stack" aria-labelledby="command-title">
      <PageHeader eyebrow="Offline-first spine" title="Command Home" titleId="command-title" />

      <Panel title="Performance Mode">
        <div className="performance-card">
          <div>
            <div className="status-row">
              <StatusBadge tone={performanceModeState.enabled ? "warning" : "success"}>
                {performanceModeState.enabled ? "ON" : "OFF"}
              </StatusBadge>
              <StatusBadge tone="info">Gaming Mode</StatusBadge>
            </div>
            <p>{performanceModeState.enabled ? `Reason: ${performanceModeState.reason}` : "Heavy DexNest workers are available when you start them."}</p>
            <p className="technical">
              {performanceModeState.pausedWorkers.length ? `Paused: ${performanceModeState.pausedWorkers.join(", ")}` : "No workers paused."}
            </p>
            {performanceModeSettings.autoEnableWhenFullscreen && <p>Fullscreen auto-enable is a safe placeholder for later.</p>}
          </div>
          <button
            type="button"
            className={performanceBusy ? "is-busy" : undefined}
            disabled={performanceBusy}
            onClick={() => void toggleCommandPerformanceMode()}
          >
            {performanceBusy && <Spinner size="sm" />}
            {performanceBusy ? "Updating..." : performanceModeState.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </Panel>

      <Panel title="Command Palette">
        <div className="command-palette">
          <label>
            Search and run
            <input
              autoComplete="off"
              value={paletteQuery}
              onChange={(event) => {
                setPaletteQuery(event.target.value);
                setPaletteIndex(0);
                setPaletteMessage("");
              }}
              onKeyDown={handlePaletteKeyDown}
              placeholder="Search action title, ID, or module"
            />
          </label>
          <p>Select an action with Up/Down, press Enter to run. Type <span className="technical">compress PDF -&gt; send to phone</span> to see the chaining placeholder.</p>
          {commandChainRequested && <StatusBadge tone="info">Command chaining coming soon</StatusBadge>}
          <div className="command-palette__results" role="listbox" aria-label="Command palette actions">
            {paletteActions.length === 0 ? (
              <EmptyState>No actions match this command.</EmptyState>
            ) : (
              paletteActions.map((action, index) => (
                <button
                  className={`command-palette__row accent-${action.moduleId}`}
                  data-active={index === paletteIndex}
                  key={action.id}
                  type="button"
                  onMouseEnter={() => setPaletteIndex(index)}
                  onClick={() => void runPaletteAction(action)}
                >
                  <span className="command-palette__label">
                    <strong>{action.title}</strong>
                    <span className="technical">{action.id}</span>
                  </span>
                  <span className="command-palette__meta">
                    {pinnedActionIds.includes(action.id) && <StatusBadge tone="success">pinned</StatusBadge>}
                    <StatusBadge tone={action.dangerLevel === "safe" ? "success" : action.dangerLevel === "caution" ? "warning" : "error"}>{action.dangerLevel}</StatusBadge>
                    <span className="technical">{action.module}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          {paletteMessage && <p className="inline-status">{paletteMessage}</p>}
        </div>
      </Panel>

      <Panel title="Ask DexNest">
        <div className="ask-launcher accent-search">
          <div>
            <h3>Ask DexNest</h3>
            <p>Search documents, Vault, OCR, notes, and local memory.</p>
          </div>
          <button type="button" onClick={() => onOpenAssistant()}>Open Ask DexNest</button>
        </div>
      </Panel>

      <Panel title="Nudges">
        <div className="section-heading section-heading--row">
          <p>Urgent and today nudges from local DexNest data.</p>
          <button type="button" onClick={() => void onAction("calendar.nudge.refresh", "module_ui")}>Refresh nudges</button>
        </div>
        <div className="action-list action-list--compact">
          {topNudges.length === 0 ? (
            <EmptyState>No active nudges for today.</EmptyState>
          ) : (
            topNudges.map((nudge) => (
              <article className="data-item data-item--stacked accent-calendar" key={nudge.id}>
                <div className="section-heading section-heading--row">
                  <strong>{nudge.title}</strong>
                  <StatusBadge tone={nudge.priority === "urgent" ? "error" : nudge.priority === "normal" ? "warning" : "info"}>{nudge.priority}</StatusBadge>
                </div>
                <span>{nudge.message}</span>
                <span className="technical">{formatLocalDate(nudge.date)} / {nudge.sourceModule}</span>
              </article>
            ))
          )}
        </div>
      </Panel>

      <div className="module-grid">
        {moduleCards.map(([id, title, description, status]) => (
          <article className={`module-card accent-${id}`} key={id}>
            <div>
              <div className="module-card__header">
                <h3>{title}</h3>
                <span
                  className="module-card__status"
                  data-status={status}
                  aria-label={status === "available" ? "Available" : "Placeholder"}
                  title={status === "available" ? "Available" : "Placeholder"}
                >
                  {status === "available" ? "✓" : "×"}
                </span>
              </div>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <Panel title="Pinned Actions">
          <div className="action-list action-list--compact">
            {pinnedActions.length === 0 ? (
              <EmptyState>No pinned actions yet.</EmptyState>
            ) : (
              pinnedActions.map((action) => (
                <article className={`action-row accent-${action.moduleId}`} key={action.id}>
                  <div>
                    <h3>{action.title}</h3>
                    <p className="technical">{action.id}</p>
                  </div>
                  <div>
                    <button type="button" onClick={() => void movePinnedAction(action.id, -1)}>
                      Up
                    </button>
                    <button type="button" onClick={() => void movePinnedAction(action.id, 1)}>
                      Down
                    </button>
                    <button type="button" onClick={() => void runRegistryActionFromSource(action, "module_ui")}>
                      {viewFromAction(action) ? "Open" : "Run"}
                    </button>
                    <button type="button" onClick={() => void togglePinnedAction(action.id)}>
                      Unpin
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>
        <Panel title="Stats">
          <div className="section-heading section-heading--row">
            <p>Updated {formatLocalDateTime(commandStats.updatedAt)}</p>
            <button type="button" onClick={() => void onAction("command.refresh_stats")}>
              Refresh stats
            </button>
          </div>
          <div className="stats-grid">
            {statCards.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title="Today">
          <div className="action-list action-list--compact">
            {calendarState.todayEvents.length === 0 ? (
              <EmptyState>No Calendar events today.</EmptyState>
            ) : (
              calendarState.todayEvents.slice(0, 4).map((event) => (
                <article className="data-item accent-calendar" key={event.id}>
                  <strong>{event.title}</strong>
                  <span>{event.allDay ? "All-day" : event.startTime || "No time"} / {event.reminderLevel}</span>
                </article>
              ))
            )}
          </div>
        </Panel>
        <Panel title="Shortcuts">
          <div className="shortcut-list">
            <article>
              <div>
                <strong>Open Command</strong>
                <span>{appInfo?.commandShortcutStatus ?? "loading"}</span>
              </div>
              <kbd>{shortcutLabel(appInfo?.commandShortcut ?? "CommandOrControl+Space")}</kbd>
            </article>
            <article>
              <div>
                <strong>Multi-copy</strong>
                <span>{clipboardState.settings.multiCopyHotkeyStatus}</span>
              </div>
              <kbd>{shortcutLabel(clipboardState.settings.multiCopyHotkey)}</kbd>
            </article>
            <article>
              <div>
                <strong>Voice dictation</strong>
                <span>Windows fallback</span>
              </div>
              <kbd>Win + H</kbd>
            </article>
            <article>
              <div>
                <strong>Tray access</strong>
                <span>{appInfo?.trayStatus ?? "loading"}</span>
              </div>
              <kbd>Tray</kbd>
            </article>
          </div>
        </Panel>
      </div>

      <Panel title="Recent Activity">
        <div className="action-list action-list--compact">
          {events.length === 0 ? (
            <EmptyState>No recent events yet.</EmptyState>
          ) : (
            events.slice(0, 10).map((event) => (
              <article className="data-item data-item--stacked accent-command" key={event.id}>
                <strong>{event.summary}</strong>
                <span>{event.module} / {event.status} / {event.source}</span>
                <span className="technical">{formatLocalDateTime(event.timestamp)} / {event.actionId ?? "no action"}</span>
              </article>
            ))
          )}
        </div>
      </Panel>

      <details className="collapsible-panel">
        <summary>Action Registry ({actions.length})</summary>
        <div className="collapsible-panel__body">
          <div className="registry-controls">
            <label>
              Module
              <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
                <option value="all">All modules</option>
                {modules.map((module) => (
                  <option value={module} key={module}>{module}</option>
                ))}
              </select>
            </label>
            <label>
              Search
              <input
                value={actionSearch}
                onChange={(event) => setActionSearch(event.target.value)}
                placeholder="Action ID or title"
              />
            </label>
          </div>
          <div className="action-list">
            {filteredActions.length === 0 ? (
              <p>No registered actions found.</p>
            ) : (
              filteredActions.map((action) => (
                <article className={`action-row accent-${action.moduleId}`} key={action.id}>
                  <div>
                    <h3>{action.title}</h3>
                    <p>{action.description}</p>
                    <p className="technical">{action.id}</p>
                  </div>
                  <div>
                    <span>{action.module}</span>
                    <span>{action.dangerLevel}</span>
                    <span>{action.reversible ? "reversible" : "not reversible"}</span>
                    <button type="button" onClick={() => void runRegistryActionFromSource(action, "module_ui")}>
                      {viewFromAction(action) ? "Open" : "Run"}
                    </button>
                    <button type="button" onClick={() => void togglePinnedAction(action.id)}>
                      {pinnedActionIds.includes(action.id) ? "Unpin" : "Pin"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </details>
    </section>
  );
}

const emptyProjectForm: ProjectFormState = {
  name: "",
  path: "",
  description: "",
  accent: "dev",
  start: "",
  build: "",
  test: "",
  typecheck: "",
  custom: "",
  urls: "",
  notes: ""
};

function projectToForm(project: DexNestProject): ProjectFormState {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    description: project.description,
    accent: project.accent,
    start: project.commands.start,
    build: project.commands.build,
    test: project.commands.test,
    typecheck: project.commands.typecheck,
    custom: project.commands.custom,
    urls: project.urls.join("\n"),
    notes: project.notes
  };
}

function formToProjectInput(form: ProjectFormState) {
  return {
    id: form.id,
    name: form.name,
    path: form.path,
    description: form.description,
    accent: form.accent,
    commands: {
      start: form.start,
      build: form.build,
      test: form.test,
      typecheck: form.typecheck,
      custom: form.custom
    },
    urls: form.urls.split(/\r?\n|,/).map((url) => url.trim()).filter(Boolean),
    notes: form.notes
  };
}

function isDangerousCommand(command: string): boolean {
  return /\b(rm\s+-rf|del\s+\/|rmdir\s+\/s|format\b|diskpart\b|Remove-Item\b.*-Recurse|git\s+reset\s+--hard|git\s+clean\s+-fd)\b/i.test(
    command
  );
}

function stripAnsiForDisplay(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function DevView({
  projects,
  commandResults,
  onAction,
  onProjectsChanged
}: {
  projects: DexNestProject[];
  commandResults: Record<string, ProjectCommandResult>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    output?: string | ToolsOutputItem;
    stdout?: string;
    stderr?: string;
    summary?: string;
    status?: "success" | "failed";
    durationMs?: number | null;
  }>;
  onProjectsChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProjectFormState>(emptyProjectForm);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});
  const [commandRunResults, setCommandRunResults] = useState<Record<string, ProjectCommandResult>>(commandResults);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setCommandRunResults((current) => ({ ...commandResults, ...current }));
  }, [commandResults]);

  function updateForm(field: keyof ProjectFormState, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveProject(): Promise<void> {
    if (!form.name.trim() || !form.path.trim()) {
      setSaveStatus({ tone: "error", message: "Project name and path are required." });
      return;
    }

    try {
      setSaveStatus(null);
      const savedProject = await getBridge().saveProject(formToProjectInput(form));

      if (!savedProject?.id) {
        throw new Error("DexNest desktop bridge did not return a saved project.");
      }

      setForm(emptyProjectForm);
      setActiveProjectId(null);
      setSaveStatus({ tone: "success", message: `Saved ${savedProject.name}.` });
      await onProjectsChanged();
    } catch (error) {
      setSaveStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "DexNest could not save this project."
      });
    }
  }

  async function deleteProject(project: DexNestProject): Promise<void> {
    if (!window.confirm(`Delete ${project.name} from DexNest Dev? This does not delete files.`)) {
      return;
    }

    await getBridge().deleteProject(project.id);
    await onProjectsChanged();
  }

  async function runProjectAction(project: DexNestProject, actionId: string, command?: string): Promise<void> {
    const confirmedDangerous = command && isDangerousCommand(command)
      ? window.confirm("This command looks destructive. Run it anyway?")
      : false;

    if (command && isDangerousCommand(command) && !confirmedDangerous) {
      return;
    }

    const commandKey = actionId.split(".").at(-1)?.replace("run_", "") ?? "custom";
    const previousResult = commandRunResults[actionId];

    setCommandRunResults((current) => ({
      ...current,
      [actionId]: {
        actionId,
        projectId: project.id,
        projectName: project.name,
        commandKey,
        command: command ?? "",
        status: "running",
        stdout: previousResult?.stdout ?? "",
        stderr: previousResult?.stderr ?? "",
        summary: "Running command.",
        durationMs: null,
        finishedAt: null,
        errorMessage: null
      }
    }));

    const result = await onAction(actionId, "module_ui", { confirmedDangerous });

    setCommandRunResults((current) => ({
      ...current,
      [actionId]: {
        actionId,
        projectId: project.id,
        projectName: project.name,
        commandKey,
        command: command ?? "",
        status: result.ok ? "success" : "failed",
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        summary: result.summary ?? (result.ok ? "Command completed." : result.error ?? "Command failed."),
        durationMs: result.durationMs ?? null,
        finishedAt: new Date().toISOString(),
        errorMessage: result.ok ? null : result.error ?? null
      }
    }));
  }

  async function copyCommandOutput(actionId: string): Promise<void> {
    const result = commandRunResults[actionId];
    const output = [result?.stdout, result?.stderr].filter(Boolean).map(stripAnsiForDisplay).join("\n\n").trim();

    if (output) {
      await navigator.clipboard.writeText(output);
    }
  }

  async function clearCommandOutput(actionId: string): Promise<void> {
    await getBridge().clearCommandResult(actionId);
    setCommandRunResults((current) => {
      const next = { ...current };
      delete next[actionId];
      return next;
    });
  }

  function toggleCommandLog(actionId: string): void {
    setExpandedLogIds((current) => ({
      ...current,
      [actionId]: !current[actionId]
    }));
  }

  function toggleProject(projectId: string): void {
    setExpandedProjectIds((current) => ({
      ...current,
      [projectId]: !current[projectId]
    }));
  }

  return (
    <section className="view-stack" aria-labelledby="dev-title">
      <PageHeader eyebrow="DexNest Dev" title="Project Dashboard" titleId="dev-title" />

      <Panel title={form.id ? "Edit Project" : "Add Project"}>
        <div className="project-form">
          <label>
            Name
            <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
          </label>
          <label>
            Path
            <input className="technical" value={form.path} onChange={(event) => updateForm("path", event.target.value)} />
          </label>
          <label>
            Description
            <input value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
          </label>
          <label>
            Local URLs
            <textarea className="technical" value={form.urls} onChange={(event) => updateForm("urls", event.target.value)} />
          </label>
          {(["start", "build", "test", "typecheck", "custom"] as const).map((key) => (
            <label key={key}>
              {key} command
              <input className="technical" value={form[key]} onChange={(event) => updateForm(key, event.target.value)} />
            </label>
          ))}
          <label>
            Notes
            <textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void saveProject()}>
            {form.id ? "Save Project" : "Add Project"}
          </button>
          {form.id && (
            <button type="button" onClick={() => { setForm(emptyProjectForm); setActiveProjectId(null); }}>
              Cancel Edit
            </button>
          )}
        </div>
        {saveStatus && <p className={`form-status form-status--${saveStatus.tone}`}>{saveStatus.message}</p>}
      </Panel>

      <div className="project-grid">
        {projects.length === 0 ? (
          <EmptyState>No Dev projects yet. Add a local project path to generate Dev and Deck actions.</EmptyState>
        ) : (
          projects.map((project) => {
            const base = `dev.project.${project.id}`;
            const commandEntries = Object.entries(project.commands).filter(([, command]) => command.trim());
            const isExpanded = Boolean(expandedProjectIds[project.id]);

            return (
              <article className={`project-card accent-dev ${isExpanded ? "project-card--expanded" : ""}`} key={project.id}>
                <div className="project-card__header">
                  <button
                    type="button"
                    className="project-toggle"
                    aria-expanded={isExpanded}
                    aria-controls={`project-details-${project.id}`}
                    onClick={() => toggleProject(project.id)}
                  >
                    <span className="project-toggle__arrow" aria-hidden="true">
                      {isExpanded ? "v" : ">"}
                    </span>
                    <span>
                      <strong>{project.name}</strong>
                      <span>{project.description || "No description yet."}</span>
                      <span className="technical">{project.path}</span>
                    </span>
                  </button>
                  <div className="button-row project-card__tools">
                    <button type="button" onClick={() => { setForm(projectToForm(project)); setActiveProjectId(project.id); }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deleteProject(project)}>
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="project-card__details" id={`project-details-${project.id}`}>
                    <div className="button-row">
                      <button type="button" onClick={() => void runProjectAction(project, `${base}.open_folder`)}>
                        Open Folder
                      </button>
                      <button type="button" onClick={() => void runProjectAction(project, `${base}.open_vscode`)}>
                        VS Code
                      </button>
                      <button type="button" onClick={() => void runProjectAction(project, `${base}.open_terminal`)}>
                        Terminal
                      </button>
                      {project.urls.length > 0 && (
                        <button type="button" onClick={() => void runProjectAction(project, `${base}.open_url`)}>
                          Open URL
                        </button>
                      )}
                    </div>

                    {commandEntries.length > 0 && (
                      <div className="command-list">
                        {commandEntries.map(([key, command]) => {
                          const actionId = `${base}.run_${key}`;
                          const result = commandRunResults[actionId];
                          const status = result?.status ?? "idle";
                          const hasOutput = Boolean(result?.stdout || result?.stderr || result?.summary || result?.errorMessage);
                          const isLogExpanded = Boolean(expandedLogIds[actionId]);
                          return (
                            <div className="command-row" key={key}>
                              <div className="command-row__main">
                                <div className="command-row__summary">
                                  <div>
                                    <strong>{key}</strong>
                                    <p className="technical">{command}</p>
                                  </div>
                                  <span className={`command-status command-status--${status}`}>{status}</span>
                                </div>
                                {result?.durationMs !== null && result?.durationMs !== undefined && (
                                  <p className="command-meta">Last run: {result.durationMs}ms</p>
                                )}
                              </div>
                              <div className="command-row__actions">
                                {hasOutput && (
                                  <button type="button" onClick={() => toggleCommandLog(actionId)}>
                                    {isLogExpanded ? "Hide Log" : "Show Log"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={status === "running"}
                                  onClick={() => void runProjectAction(project, actionId, command)}
                                >
                                  {status === "running" ? "Running" : "Run"}
                                </button>
                              </div>
                              {hasOutput && isLogExpanded && (
                                <div className="command-log">
                                  <div className="button-row">
                                    <button type="button" onClick={() => void copyCommandOutput(actionId)}>
                                      Copy output
                                    </button>
                                    <button type="button" onClick={() => void clearCommandOutput(actionId)}>
                                      Clear output
                                    </button>
                                  </div>
                                  <pre className="technical">{[
                                    result?.summary,
                                    result?.errorMessage,
                                    result?.stdout ? `stdout:\n${stripAnsiForDisplay(result.stdout)}` : "",
                                    result?.stderr ? `stderr:\n${stripAnsiForDisplay(result.stderr)}` : ""
                                  ].filter(Boolean).join("\n\n")}</pre>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="notes-box">
                      <strong>Notes</strong>
                      <p>{project.notes || "No notes saved."}</p>
                    </div>
                    {activeProjectId === project.id && <p className="technical">Editing {project.id}</p>}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

const emptySnippetForm = {
  id: "",
  title: "",
  text: ""
};

function ClipboardView({
  clipboardState,
  onAction,
  onRefresh
}: {
  clipboardState: ClipboardState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"history" | "multi" | "slots" | "snippets" | "settings">("history");
  const [snippetForm, setSnippetForm] = useState(emptySnippetForm);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historySource, setHistorySource] = useState("all");
  const [groupName, setGroupName] = useState("");
  const [separatorMode, setSeparatorMode] = useState<"blank" | "newline" | "comma" | "custom">("blank");
  const [customSeparator, setCustomSeparator] = useState("");
  const [autoClearMinutes, setAutoClearMinutes] = useState(String(clipboardState.settings.multiCopyAutoClearMinutes));
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!clipboardState.settings.listenerEnabled) {
      return;
    }

    const refreshTimer = window.setInterval(() => {
      void onRefresh();
    }, Math.max(1000, clipboardState.settings.listenerIntervalMs));

    return () => window.clearInterval(refreshTimer);
  }, [clipboardState.settings.listenerEnabled, clipboardState.settings.listenerIntervalMs, onRefresh]);

  useEffect(() => {
    const unsubscribe = window.dexNest?.onClipboardHotkeyResult?.((payload) => {
      showStatus(payload.message, payload.tone);
      void onRefresh();
    });

    return () => {
      unsubscribe?.();
    };
  }, [onRefresh]);

  useEffect(() => {
    const separator = clipboardState.settings.combinedSeparator;
    if (separator === "\n\n") {
      setSeparatorMode("blank");
      setCustomSeparator("");
    } else if (separator === "\n") {
      setSeparatorMode("newline");
      setCustomSeparator("");
    } else if (separator === ", ") {
      setSeparatorMode("comma");
      setCustomSeparator("");
    } else {
      setSeparatorMode("custom");
      setCustomSeparator(separator);
    }
    setAutoClearMinutes(String(clipboardState.settings.multiCopyAutoClearMinutes));
  }, [clipboardState.settings.combinedSeparator, clipboardState.settings.multiCopyAutoClearMinutes]);

  function showStatus(message: string, tone: "success" | "error" = "success"): void {
    setStatus({ tone, message });
    window.setTimeout(() => setStatus((current) => current?.message === message ? null : current), 3000);
  }

  async function saveCurrentClipboard(): Promise<void> {
    const result = await onAction("clipboard.save_current") as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Clipboard saved." : result.error ?? "Clipboard save failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function pasteAsPlainText(): Promise<void> {
    const result = await onAction("clipboard.copy_plain_text") as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Clipboard normalized as plain text." : result.error ?? "Plain text copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function saveSnippet(): Promise<void> {
    const result = await onAction("clipboard.create_snippet", "module_ui", snippetForm) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Snippet saved." : result.error ?? "Snippet save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setSnippetForm(emptySnippetForm);
      await onRefresh();
    }
  }

  async function deleteSnippet(snippetId: string): Promise<void> {
    const confirmed = window.confirm("Delete this DexNest Clipboard snippet?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("clipboard.delete_snippet", "module_ui", { id: snippetId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Snippet deleted." : result.error ?? "Snippet delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function toggleListener(): Promise<void> {
    const enabled = !clipboardState.settings.listenerEnabled;
    const result = await onAction("clipboard.toggle_listener", "module_ui", { enabled }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? `Clipboard listener ${enabled ? "enabled" : "disabled"}.` : result.error ?? "Listener toggle failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function testReadClipboard(): Promise<void> {
    const result = await onAction("clipboard.test_read_current", "module_ui", {}) as { ok?: boolean; error?: string; preview?: string; byteLength?: number };
    showStatus(result.ok ? `Current clipboard: ${result.preview || "empty"} (${formatBytes(result.byteLength ?? 0)})` : result.error ?? "Clipboard read failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function startMultiCopy(): Promise<void> {
    const result = await onAction("clipboard.start_multi_copy", "module_ui", {}) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy started." : result.error ?? "Multi-copy start failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function stopMultiCopy(): Promise<void> {
    const result = await onAction("clipboard.stop_multi_copy", "module_ui", { name: groupName }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy stopped." : result.error ?? "Multi-copy stop failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function saveMultiCopyGroup(): Promise<void> {
    const result = await onAction("clipboard.save_multi_copy_group", "module_ui", { name: groupName }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy group saved." : result.error ?? "Multi-copy save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setGroupName("");
    }
    await onRefresh();
  }

  async function clearMultiCopySession(): Promise<void> {
    if (!window.confirm("Clear the active multi-copy session?")) {
      return;
    }
    const result = await onAction("clipboard.clear_multi_copy_session", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy session cleared." : result.error ?? "Multi-copy clear failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copyCombinedGroup(groupId?: string): Promise<void> {
    const result = await onAction("clipboard.copy_combined_group", "module_ui", { groupId }) as { ok?: boolean; error?: string; itemCount?: number };
    showStatus(result.ok ? `Combined ${result.itemCount ?? 0} items onto Clipboard.` : result.error ?? "Combined copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function deleteMultiCopyGroup(groupId: string): Promise<void> {
    if (!window.confirm("Delete this saved multi-copy group?")) {
      return;
    }
    const result = await onAction("clipboard.delete_multi_copy_group", "module_ui", { groupId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy group deleted." : result.error ?? "Multi-copy group delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copyHistoryItem(itemId: string): Promise<void> {
    const result = await onAction("clipboard.copy_history_item", "module_ui", { id: itemId }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Copied item to clipboard." : result.error ?? "Copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function assignSlot(slot: number): Promise<void> {
    const actionId = slot >= 1 && slot <= 3 ? `clipboard.slot${slot}.save_current` : "clipboard.assign_slot";
    let result = await onAction(actionId, "module_ui", { slot }) as { ok?: boolean; status?: string; error?: string };
    if (!result.ok && result.status === "sensitive_confirmation_required") {
      const confirmed = window.confirm("This clipboard text looks sensitive. Save it to this DexNest slot anyway?");
      if (confirmed) {
        result = await onAction(actionId, "module_ui", { slot, confirmedSensitive: true }) as { ok?: boolean; error?: string };
      }
    }
    showStatus(result.ok ? `Saved to Slot ${slot}.` : result.error ?? "Slot assignment failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copySlot(slot: number): Promise<void> {
    const actionId = slot >= 1 && slot <= 3 ? `clipboard.slot${slot}.paste` : "clipboard.copy_slot";
    const result = await onAction(actionId, "module_ui", { slot }) as { ok?: boolean; error?: string; pasteMode?: string };
    showStatus(result.ok ? `Slot ${slot} copied. Press Ctrl+V.` : result.error ?? "Slot copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function clearSlot(slot: number): Promise<void> {
    if (!window.confirm(`Clear DexNest Clipboard Slot ${slot}?`)) {
      return;
    }
    const result = await onAction("clipboard.clear_slot", "module_ui", { slot }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? `Cleared Slot ${slot}.` : result.error ?? "Slot clear failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function clearHistory(): Promise<void> {
    if (!window.confirm("Clear DexNest Clipboard history? Snippets, slots, and multi-copy groups stay.")) {
      return;
    }
    const result = await onAction("clipboard.clear_history", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Clipboard history cleared." : result.error ?? "Clear history failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function cleanupHistoryNow(): Promise<void> {
    const result = await onAction("clipboard.cleanup_history", "module_ui", { force: true }) as { ok?: boolean; error?: string; removedCount?: number };
    showStatus(result.ok ? `Clipboard cleanup removed ${result.removedCount ?? 0} item${result.removedCount === 1 ? "" : "s"}.` : result.error ?? "Clipboard cleanup failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function updateClipboardSettings(params: Record<string, unknown>, successMessage: string): Promise<void> {
    const result = await onAction("clipboard.update_settings", "module_ui", params) as { ok?: boolean; error?: string };
    showStatus(result.ok ? successMessage : result.error ?? "Clipboard settings update failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  function separatorFromMode(mode: typeof separatorMode, customValue = customSeparator): string {
    if (mode === "newline") {
      return "\n";
    }
    if (mode === "comma") {
      return ", ";
    }
    if (mode === "custom") {
      return customValue;
    }
    return "\n\n";
  }

  const activeSession = clipboardState.settings.activeMultiCopySession;
  const activeCombinedPreview = activeSession ? activeSession.items.map((item) => item.preview).join(" / ") : "";
  const activeArmedForPaste = Boolean(activeSession?.items.length && activeSession.armedForPasteAt);
  const activeTimeoutAt = activeSession
    ? new Date(new Date(activeSession.updatedAt).getTime() + clipboardState.settings.multiCopyAutoClearMinutes * 60 * 1000)
    : null;
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase();
  const filteredHistory = clipboardState.history.filter((item) => {
    const matchesQuery = !normalizedHistoryQuery || item.preview.toLowerCase().includes(normalizedHistoryQuery) || item.id.toLowerCase().includes(normalizedHistoryQuery);
    const matchesSource = historySource === "all" || (item.source ?? "manual") === historySource;
    return matchesQuery && matchesSource;
  });
  const quickSlots = clipboardState.slots.filter((slot) => slot.slot >= 1 && slot.slot <= 3);
  const extendedSlots = clipboardState.slots.filter((slot) => slot.slot > 3);
  const quickSlotShortcutText = (slot: number) => `Save: Ctrl+Shift+${slot} / Paste: Ctrl+Alt+${slot}`;

  return (
    <section className="view-stack accent-clipboard" aria-labelledby="clipboard-title">
      {status && <ToastStack toasts={[{ id: status.message, message: status.message, tone: status.tone }]} />}
      <PageHeader eyebrow="Local clipboard history" title="Clipboard" titleId="clipboard-title" />

      <Panel title="Clipboard Listener and Multi-Copy">
        <div className="stats-grid">
          <article><span>Listener</span><strong>{clipboardState.settings.listenerEnabled ? "ON" : "OFF"}</strong><p>Default off. Runs only when enabled.</p></article>
          <article><span>Interval</span><strong>{clipboardState.settings.listenerIntervalMs}ms</strong><p>Light text checks.</p></article>
          <article><span>Hotkey</span><strong>{clipboardState.settings.multiCopyHotkeyStatus}</strong><p className="technical">{clipboardState.settings.multiCopyHotkey}</p></article>
          <article><span>Secret protection</span><strong>{clipboardState.settings.secretProtectionEnabled ? "ON" : "ON"}</strong><p>Secure Vault values skipped.</p></article>
          <article><span>Multi-copy</span><strong>{activeArmedForPaste ? "armed" : activeSession?.items.length ? "active" : "idle"}</strong><p>{activeArmedForPaste ? `${activeSession?.items.length ?? 0} items armed for paste` : activeSession?.items.length ? `${activeSession.items.length} captured` : "Select text, then press Ctrl+Shift+C."}</p></article>
          <article><span>Last capture</span><strong>{clipboardState.settings.lastCaptureAt ? formatLocalDateTime(clipboardState.settings.lastCaptureAt) : "none"}</strong><p>{clipboardState.settings.lastCapturedPreview || "No captured preview."}</p></article>
          <article><span>Last read</span><strong>{clipboardState.settings.lastReadAt ? formatLocalDateTime(clipboardState.settings.lastReadAt) : "none"}</strong><p>{clipboardState.settings.lastReadError || clipboardState.settings.lastReadPreview || "No read preview."}</p></article>
        </div>
        <div className="data-item data-item--stacked accent-clipboard">
          <div className="section-heading">
            <div>
              <strong>{"Ctrl+Shift+C adds. Ctrl+V pastes and clears."}</strong>
              <p>Normal Ctrl+C stays unchanged. The first Ctrl+Shift+C creates the current group automatically.</p>
            </div>
            <StatusBadge tone={activeArmedForPaste ? "success" : "neutral"}>{activeArmedForPaste ? `${activeSession?.items.length ?? 0} items armed for paste` : "No active multi-copy group"}</StatusBadge>
          </div>
          {activeSession?.items.length ? (
            <>
              <p className="clipboard-combined-preview">{activeCombinedPreview || "Combined text ready on the Windows clipboard."}</p>
              <p className="technical">
                {activeSession.id} / updated {formatLocalDateTime(activeSession.updatedAt)}
                {activeSession.armedForPasteAt ? ` / armed ${formatLocalDateTime(activeSession.armedForPasteAt)}` : ""}
                {activeTimeoutAt ? ` / clears after ${formatLocalDateTime(activeTimeoutAt)}` : ""}
              </p>
            </>
          ) : (
            <p className="technical">{clipboardState.activeMultiCopyPath}</p>
          )}
        </div>
        <div className="button-row">
          <button
            className={clipboardState.settings.multiCopyHotkeyEnabled ? "button-danger" : "button-primary"}
            type="button"
            onClick={() => void updateClipboardSettings({ multiCopyHotkeyEnabled: !clipboardState.settings.multiCopyHotkeyEnabled }, clipboardState.settings.multiCopyHotkeyEnabled ? "Multi-copy hotkey disabled." : "Multi-copy hotkey enabled.")}
          >
            {clipboardState.settings.multiCopyHotkeyEnabled ? "Disable multi-copy hotkey" : "Enable multi-copy hotkey"}
          </button>
          <button className={clipboardState.settings.listenerEnabled ? "button-danger" : "button-primary"} type="button" onClick={() => void toggleListener()}>
            {clipboardState.settings.listenerEnabled ? "Disable listener" : "Enable listener"}
          </button>
          <button type="button" onClick={() => void saveCurrentClipboard()}>
            Save current clipboard
          </button>
          <button type="button" onClick={() => void pasteAsPlainText()}>
            Paste as plain text
          </button>
          <button type="button" onClick={() => void testReadClipboard()}>
            Test read clipboard
          </button>
          <button className="danger-button" type="button" onClick={() => void clearHistory()}>
            Clear history
          </button>
        </div>
        <div className="registry-controls">
          <label>
            Separator
            <select
              value={separatorMode}
              onChange={(event) => {
                const nextMode = event.target.value as typeof separatorMode;
                setSeparatorMode(nextMode);
                void updateClipboardSettings({ combinedSeparator: separatorFromMode(nextMode) }, "Multi-copy separator updated.");
              }}
            >
              <option value="blank">Blank line</option>
              <option value="newline">Single newline</option>
              <option value="comma">Comma</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {separatorMode === "custom" && (
            <label>
              Custom separator
              <input
                value={customSeparator}
                onChange={(event) => setCustomSeparator(event.target.value)}
                onBlur={() => void updateClipboardSettings({ combinedSeparator: customSeparator }, "Custom separator saved.")}
                placeholder="Separator text"
              />
            </label>
          )}
          <label>
            Auto-clear minutes
            <input
              type="number"
              min="1"
              max="240"
              value={autoClearMinutes}
              onChange={(event) => setAutoClearMinutes(event.target.value)}
              onBlur={() => void updateClipboardSettings({ multiCopyAutoClearMinutes: Number(autoClearMinutes) }, "Multi-copy auto-clear updated.")}
            />
          </label>
        </div>
        <p>Automatic history captures text only and excludes current Secure Vault copied secrets. Audit records metadata only.</p>
        {clipboardState.settings.multiCopyLastHotkeyMessage && (
          <p className="technical">
            Last hotkey: {clipboardState.settings.multiCopyLastHotkeyStatus} / {clipboardState.settings.multiCopyLastHotkeyMessage}
            {clipboardState.settings.multiCopyLastHotkeyAt ? ` / ${formatLocalDateTime(clipboardState.settings.multiCopyLastHotkeyAt)}` : ""}
          </p>
        )}
        <p className="technical">{clipboardState.settingsPath}</p>
      </Panel>

      <div className="tabs" role="tablist" aria-label="Clipboard sections">
        <button type="button" data-active={activeTab === "history"} onClick={() => setActiveTab("history")}>
          Normal History
        </button>
        <button type="button" data-active={activeTab === "multi"} onClick={() => setActiveTab("multi")}>
          Active Multi-Copy Group
        </button>
        <button type="button" data-active={activeTab === "slots"} onClick={() => setActiveTab("slots")}>
          Slots
        </button>
        <button type="button" data-active={activeTab === "snippets"} onClick={() => setActiveTab("snippets")}>
          Snippets
        </button>
        <button type="button" data-active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
          Settings
        </button>
      </div>

      {activeTab === "history" && (
        <Panel title="Normal Clipboard History">
          <div className="registry-controls">
            <label>
              Search timeline
              <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Preview or history ID" />
            </label>
            <label>
              Source
              <select value={historySource} onChange={(event) => setHistorySource(event.target.value)}>
                <option value="all">All sources</option>
                <option value="manual">Manual</option>
                <option value="listener">Listener</option>
              </select>
            </label>
          </div>
          <p>{filteredHistory.length} matching item{filteredHistory.length === 1 ? "" : "s"}. Normal history is independent from active and saved multi-copy groups.</p>
          <p className="technical">{clipboardState.historyPath}</p>
          <div className="clipboard-history-list">
            {filteredHistory.length === 0 ? (
              <EmptyState>No Clipboard history matches this filter.</EmptyState>
            ) : (
              <LimitedList items={filteredHistory} step={50}>
                {(item) => (
                  <article
                    className="clipboard-history-row accent-clipboard"
                    key={item.id}
                    title={`${item.source ?? "manual"} / ${formatBytes(item.byteLength)} / ${formatLocalDateTime(item.createdAt)}`}
                  >
                    <strong className="clipboard-history-text">{item.preview || "Saved clipboard text"}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Copy clipboard item"
                      title="Copy"
                      onClick={() => void copyHistoryItem(item.id)}
                    >
                      <span className="copy-icon" aria-hidden="true" />
                      <span className="sr-only">Copy</span>
                    </button>
                  </article>
                )}
              </LimitedList>
            )}
          </div>
        </Panel>
      )}

      {activeTab === "multi" && (
        <Panel title="Active Temporary Multi-Copy Group">
          <div className="button-row">
            <button type="button" disabled={Boolean(activeSession)} onClick={() => void startMultiCopy()}>
              Start empty group
            </button>
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Saved group name" />
            <button type="button" disabled={!activeSession?.items.length} onClick={() => void copyCombinedGroup()}>
              Copy combined
            </button>
            <button type="button" disabled={!activeSession?.items.length} onClick={() => void saveMultiCopyGroup()}>
              Save group
            </button>
            <button className="danger-button" type="button" disabled={!activeSession?.items.length} onClick={() => void clearMultiCopySession()}>
              Clear current group
            </button>
            <button type="button" disabled={!activeSession} onClick={() => void stopMultiCopy()}>
              Stop/Reset group
            </button>
          </div>
          <p>Select text anywhere and press Ctrl+Shift+C. DexNest appends the text here and keeps the combined group on the Windows clipboard for normal Ctrl+V.</p>
          <p className="technical">Separator: {JSON.stringify(clipboardState.settings.combinedSeparator)}</p>
          {activeSession && (
            <div className="action-list action-list--compact">
              <p className="technical">{activeSession.id} / started {formatLocalDateTime(activeSession.startedAt)} / updated {formatLocalDateTime(activeSession.updatedAt)}</p>
              {activeSession.items.length === 0 ? (
                <EmptyState>Press Ctrl+Shift+C after selecting text anywhere in Windows.</EmptyState>
              ) : (
                activeSession.items.map((item) => (
                  <article className="data-item data-item--compact accent-clipboard" key={item.id}>
                    <strong>{item.preview || "Clipboard item"}</strong>
                    <span>{formatBytes(item.byteLength)} / {formatLocalDateTime(item.createdAt)}</span>
                    <button type="button" onClick={() => void copyHistoryItem(item.id)}>Copy</button>
                  </article>
                ))
              )}
            </div>
          )}
          <h3>Saved Multi-Copy Groups</h3>
          <div className="action-list action-list--compact">
            {clipboardState.multiGroups.length === 0 ? (
              <EmptyState>No saved multi-copy groups yet.</EmptyState>
            ) : (
              clipboardState.multiGroups.map((group) => (
                <CollapsibleListItem
                  accentClass="accent-clipboard"
                  key={group.id}
                  title={group.name}
                  meta={`${group.items.length} items / ${formatLocalDateTime(group.updatedAt)}`}
                  actions={(
                    <>
                    <button type="button" onClick={() => void copyCombinedGroup(group.id)}>Copy combined group</button>
                    <button className="danger-button" type="button" onClick={() => void deleteMultiCopyGroup(group.id)}>Delete group</button>
                    </>
                  )}
                >
                  <div className="action-list action-list--compact">
                    {group.items.map((item) => (
                      <article className="data-item data-item--compact accent-clipboard" key={item.id}>
                        <strong>{item.preview || "Clipboard item"}</strong>
                        <span>{formatBytes(item.byteLength)}</span>
                        <button type="button" onClick={() => void copyHistoryItem(item.id)}>Copy</button>
                      </article>
                    ))}
                  </div>
                </CollapsibleListItem>
              ))
            )}
          </div>
          <p className="technical">{clipboardState.multiGroupsPath}</p>
        </Panel>
      )}

      {activeTab === "slots" && (
        <Panel title="Quick Slots">
          <p>Persistent text slots stay available until you overwrite or clear them. Copy text normally, then press the save shortcut. Paste uses the slot shortcut and falls back to copying the slot so normal Ctrl+V works.</p>
          <div className="clipboard-slot-grid">
            {quickSlots.map((slot) => (
              <article className="clipboard-slot accent-clipboard" key={slot.slot}>
                <div>
                  <strong>Slot {slot.slot}</strong>
                  <p className="clipboard-slot-preview" title={slot.preview || "Empty slot"}>{slot.preview || "Empty slot"}</p>
                  <p className="technical">{quickSlotShortcutText(slot.slot)}</p>
                  {slot.updatedAt && <p className="technical">{formatLocalDateTime(slot.updatedAt)} / {formatBytes(slot.byteLength)} / {slot.source ?? "clipboard_ui"}</p>}
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => void assignSlot(slot.slot)}>Save current clipboard</button>
                  <button type="button" disabled={!(slot.value || slot.text)} onClick={() => void copySlot(slot.slot)}>Copy/Paste slot</button>
                  <button className="danger-button" type="button" disabled={!(slot.value || slot.text)} onClick={() => void clearSlot(slot.slot)}>Clear</button>
                </div>
              </article>
            ))}
          </div>
          {extendedSlots.length > 0 && (
            <>
              <h3>Extended Slots</h3>
              <div className="clipboard-slot-grid">
                {extendedSlots.map((slot) => (
                  <article className="clipboard-slot accent-clipboard" key={slot.slot}>
                    <div>
                      <strong>Slot {slot.slot}</strong>
                      <p className="clipboard-slot-preview" title={slot.preview || "Empty slot"}>{slot.preview || "Empty slot"}</p>
                      {slot.updatedAt && <p className="technical">{formatLocalDateTime(slot.updatedAt)} / {formatBytes(slot.byteLength)}</p>}
                    </div>
                    <div className="button-row">
                      <button type="button" onClick={() => void assignSlot(slot.slot)}>Save current clipboard</button>
                      <button type="button" disabled={!(slot.value || slot.text)} onClick={() => void copySlot(slot.slot)}>Copy slot</button>
                      <button className="danger-button" type="button" disabled={!(slot.value || slot.text)} onClick={() => void clearSlot(slot.slot)}>Clear</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          <p className="technical">{clipboardState.slotsPath}</p>
        </Panel>
      )}

      {activeTab === "snippets" && (
        <Panel title="Snippets and Templates">
          <p className="technical">{clipboardState.snippetsPath}</p>
          <div className="project-form">
            <label>
              Title
              <input value={snippetForm.title} onChange={(event) => setSnippetForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              Snippet text
              <textarea className="technical" value={snippetForm.text} onChange={(event) => setSnippetForm((current) => ({ ...current, text: event.target.value }))} />
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void saveSnippet()}>
              {snippetForm.id ? "Save snippet" : "Create snippet"}
            </button>
            {snippetForm.id && (
              <button type="button" onClick={() => setSnippetForm(emptySnippetForm)}>
                Cancel edit
              </button>
            )}
          </div>
          <div className="item-list">
            {clipboardState.snippets.length === 0 ? (
              <p>No snippets yet.</p>
            ) : (
              clipboardState.snippets.map((snippet) => (
                <CollapsibleListItem
                  accentClass="accent-clipboard"
                  key={snippet.id}
                  title={snippet.title}
                  meta={previewForUi(snippet.text)}
                  actions={(
                    <>
                    <button type="button" onClick={() => setSnippetForm({ id: snippet.id, title: snippet.title, text: snippet.text })}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deleteSnippet(snippet.id)}>
                      Delete
                    </button>
                    </>
                  )}
                >
                  <p className="technical">{snippet.id}</p>
                </CollapsibleListItem>
              ))
            )}
          </div>
        </Panel>
      )}

      {activeTab === "settings" && (
        <div className="dashboard-grid">
          <Panel title="Clipboard Settings">
            <div className="stats-grid">
              <article><span>Listener</span><strong>{clipboardState.settings.listenerEnabled ? "ON" : "OFF"}</strong><p>Normal Ctrl+C history capture when enabled.</p></article>
              <article><span>Multi-copy hotkey</span><strong>{clipboardState.settings.multiCopyHotkeyEnabled ? "ON" : "OFF"}</strong><p className="technical">{clipboardState.settings.multiCopyHotkey}</p></article>
              <article><span>Registration</span><strong>{clipboardState.settings.multiCopyHotkeyStatus}</strong><p>{clipboardState.settings.multiCopyHotkeyLastError || "Ready for multi-copy capture."}</p></article>
              <article><span>Retention</span><strong>{clipboardState.settings.historyRetentionDays === "never" ? "never" : `${clipboardState.settings.historyRetentionDays} day${clipboardState.settings.historyRetentionDays === 1 ? "" : "s"}`}</strong><p>Normal history only.</p></article>
              <article><span>Last cleanup</span><strong>{clipboardState.settings.lastHistoryCleanupAt ? formatLocalDateTime(clipboardState.settings.lastHistoryCleanupAt) : "never"}</strong><p>Runs once per app start and at most once per day.</p></article>
            </div>
            <div className="registry-controls">
              <label>
                Multi-copy hotkey
                <select
                  value={clipboardState.settings.multiCopyHotkey}
                  onChange={(event) => void updateClipboardSettings({ multiCopyHotkey: event.target.value }, "Multi-copy hotkey updated.")}
                >
                  <option value="CommandOrControl+Shift+C">Ctrl+Shift+C</option>
                  <option value="CommandOrControl+Alt+C">Ctrl+Alt+C</option>
                  <option value="CommandOrControl+Shift+X">Ctrl+Shift+X</option>
                </select>
              </label>
              <label>
                History retention
                <select
                  value={String(clipboardState.settings.historyRetentionDays)}
                  onChange={(event) => void updateClipboardSettings({ historyRetentionDays: event.target.value === "never" ? "never" : Number(event.target.value) }, "Clipboard history retention updated.")}
                >
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="never">Never</option>
                </select>
              </label>
              <label>
                Separator
                <select
                  value={separatorMode}
                  onChange={(event) => {
                    const nextMode = event.target.value as typeof separatorMode;
                    setSeparatorMode(nextMode);
                    void updateClipboardSettings({ combinedSeparator: separatorFromMode(nextMode) }, "Multi-copy separator updated.");
                  }}
                >
                  <option value="blank">Blank line</option>
                  <option value="newline">Single newline</option>
                  <option value="comma">Comma</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {separatorMode === "custom" && (
                <label>
                  Custom separator
                  <input
                    value={customSeparator}
                    onChange={(event) => setCustomSeparator(event.target.value)}
                    onBlur={() => void updateClipboardSettings({ combinedSeparator: customSeparator }, "Custom separator saved.")}
                    placeholder="Separator text"
                  />
                </label>
              )}
              <label>
                Active group auto-clear minutes
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={autoClearMinutes}
                  onChange={(event) => setAutoClearMinutes(event.target.value)}
                  onBlur={() => void updateClipboardSettings({ multiCopyAutoClearMinutes: Number(autoClearMinutes) }, "Multi-copy auto-clear updated.")}
                />
              </label>
            </div>
            <div className="button-row">
              <button className={clipboardState.settings.listenerEnabled ? "button-danger" : "button-primary"} type="button" onClick={() => void toggleListener()}>
                {clipboardState.settings.listenerEnabled ? "Disable listener" : "Enable listener"}
              </button>
              <button
                className={clipboardState.settings.multiCopyHotkeyEnabled ? "button-danger" : "button-primary"}
                type="button"
                onClick={() => void updateClipboardSettings({ multiCopyHotkeyEnabled: !clipboardState.settings.multiCopyHotkeyEnabled }, clipboardState.settings.multiCopyHotkeyEnabled ? "Multi-copy hotkey disabled." : "Multi-copy hotkey enabled.")}
              >
                {clipboardState.settings.multiCopyHotkeyEnabled ? "Disable multi-copy hotkey" : "Enable multi-copy hotkey"}
              </button>
              <button type="button" onClick={() => void cleanupHistoryNow()}>
                Cleanup history now
              </button>
            </div>
            <p>Some apps may reserve shortcuts. Use Ctrl+Alt+C or Ctrl+Shift+X if Ctrl+Shift+C is intercepted.</p>
            <p className="technical">Manual custom shortcut string placeholder: future DexNest setting.</p>
            <p className="technical">{clipboardState.settingsPath}</p>
          </Panel>
          <Panel title="Per-App Rules">
            <p>Placeholder. DexNest does not yet attach active-app detection to Clipboard, so per-app exclusions are not enforced.</p>
            <p className="technical">{clipboardState.settings.appExclusionRules.length} configured rules</p>
          </Panel>
          <Panel title="Secret Protection">
            <p>Secure Vault copy actions mark copied secrets as protected. The listener, manual history save, multi-copy, and slots skip that protected value.</p>
            <p>Audit stores byte counts and IDs only, never full clipboard text.</p>
          </Panel>
        </div>
      )}
    </section>
  );
}

function ToolsView({
  toolsState,
  onAction,
  onRefresh
}: {
  toolsState: ToolsState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    outputs?: ToolsOutputItem[];
    output?: string | ToolsOutputItem;
    info?: PdfInfoItem[];
    ocrPreview?: string;
    ocrMetadata?: { engine: string; averageConfidence: number | null };
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [selectedFiles, setSelectedFiles] = useState<ToolsSelectedFile[]>([]);
  const [pdfInfo, setPdfInfo] = useState<PdfInfoItem[]>([]);
  const [pageRange, setPageRange] = useState("1");
  const [imageFormat, setImageFormat] = useState("jpg");
  const [imageQuality, setImageQuality] = useState("80");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [resizeWidth, setResizeWidth] = useState("");
  const [resizeHeight, setResizeHeight] = useState("");
  const [activeTab, setActiveTab] = useState<"pdf" | "images" | "ocr" | "media" | "office" | "outputs" | "settings">("pdf");
  const [ffmpegPath, setFfmpegPath] = useState(toolsState.ffmpegPath ?? "");
  const [libreOfficePath, setLibreOfficePath] = useState(toolsState.libreOfficePath ?? "");
  const [tesseractPath, setTesseractPath] = useState(toolsState.tesseractPath ?? "");
  const [pythonPath, setPythonPath] = useState(toolsState.pythonPath ?? "");
  const [ocrEngine, setOcrEngine] = useState<"tesseract" | "paddleocr" | "easyocr_placeholder">(toolsState.ocrEngine ?? "paddleocr");
  const [ocrDevice, setOcrDevice] = useState<"gpu" | "cpu">(toolsState.ocrDevice ?? "gpu");
  const [ocrLanguage, setOcrLanguage] = useState(toolsState.ocrLanguage ?? "eng");
  const [ocrPreview, setOcrPreview] = useState("");
  const [ocrMetadata, setOcrMetadata] = useState<{ engine: string; averageConfidence: number | null } | null>(null);
  const [ocrUpscale, setOcrUpscale] = useState(true);
  const [ocrThreshold, setOcrThreshold] = useState(false);
  const [scanGrayscale, setScanGrayscale] = useState(true);
  const [scanSharpen, setScanSharpen] = useState(true);
  const [scanContrast, setScanContrast] = useState("0.28");
  const [scanRotate, setScanRotate] = useState("0");
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [draggedFileIndex, setDraggedFileIndex] = useState<number | null>(null);

  const selectedPaths = selectedFiles.map((file) => file.path);

  useEffect(() => {
    setFfmpegPath(toolsState.ffmpegPath ?? "");
    setLibreOfficePath(toolsState.libreOfficePath ?? "");
    setTesseractPath(toolsState.tesseractPath ?? "");
    setPythonPath(toolsState.pythonPath ?? "");
    setOcrEngine(toolsState.ocrEngine ?? "paddleocr");
    setOcrDevice(toolsState.ocrDevice ?? "gpu");
    setOcrLanguage(toolsState.ocrLanguage ?? "eng");
  }, [toolsState.ffmpegPath, toolsState.libreOfficePath, toolsState.tesseractPath, toolsState.pythonPath, toolsState.ocrEngine, toolsState.ocrDevice, toolsState.ocrLanguage]);

  function showStatus(message: string, tone: "success" | "error" = "success"): void {
    setStatus({ tone, message });
    window.setTimeout(() => {
      setStatus((current) => current?.message === message ? null : current);
    }, 3000);
  }

  async function selectFiles(kind: "pdf" | "image" | "any"): Promise<void> {
    const files = await getBridge().selectToolsFiles(kind);
    setSelectedFiles(files);
    if (kind === "pdf" || files.some((file) => file.extension === ".pdf")) {
      setPdfInfo(await getBridge().getPdfInfo(files.filter((file) => file.extension === ".pdf").map((file) => file.path)));
    } else {
      setPdfInfo([]);
    }
  }

  function onDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (draggedFileIndex !== null || event.dataTransfer.types.includes("application/x-dexnest-tools-reorder")) {
      return;
    }
    if (event.dataTransfer.files.length === 0) {
      return;
    }

    const files = Array.from(event.dataTransfer.files).map((file) => ({
      path: (file as File & { path?: string }).path ?? "",
      name: file.name,
      byteLength: file.size,
      extension: `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    })).filter((file) => file.path);
    setSelectedFiles(files);
    void getBridge().getPdfInfo(files.filter((file) => file.extension === ".pdf").map((file) => file.path)).then(setPdfInfo);
  }

  async function updateFileOrder(files: ToolsSelectedFile[]): Promise<void> {
    setSelectedFiles(files);
    setPdfInfo(await getBridge().getPdfInfo(files.filter((file) => file.extension === ".pdf").map((file) => file.path)));
  }

  function reorderSelectedFile(targetIndex: number): void {
    if (draggedFileIndex === null || draggedFileIndex === targetIndex) {
      return;
    }

    const nextFiles = [...selectedFiles];
    const [file] = nextFiles.splice(draggedFileIndex, 1);
    nextFiles.splice(targetIndex, 0, file);
    setDraggedFileIndex(targetIndex);
    void updateFileOrder(nextFiles);
  }

  async function runTool(actionId: string, params: Record<string, unknown> = {}): Promise<void> {
    setRunningActionId(actionId);
    try {
      const result = await onAction(actionId, "module_ui", { paths: selectedPaths, ...params });

      if (result.ok) {
        const count = result.outputs?.length ?? (result.output ? 1 : 0);
        if (result.ocrPreview !== undefined) {
          setOcrPreview(result.ocrPreview || "OCR completed but no preview text was extracted.");
          setOcrMetadata(result.ocrMetadata ?? null);
        }
        showStatus(count ? `Created ${count} output file${count === 1 ? "" : "s"}.` : "Tools action completed.");
        await onRefresh();
      } else {
        showStatus(result.error ?? "Tools action failed.", "error");
      }
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Tools action failed.", "error");
    } finally {
      setRunningActionId(null);
    }
  }

  async function chooseOutputFolder(): Promise<void> {
    const result = await getBridge().chooseToolsOutputFolder();
    if (result.ok) {
      showStatus("Output folder changed.");
      await onRefresh();
    } else {
      showStatus(result.error ?? "Output folder change cancelled.", "error");
    }
  }

  async function resetOutputFolder(): Promise<void> {
    const result = await getBridge().resetToolsOutputFolder();
    showStatus(result.ok ? "Output folder reset." : "Output folder reset failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function saveDependencySettings(): Promise<void> {
    try {
      await getBridge().saveToolsSettings({
        ffmpegPath,
        libreOfficePath,
        tesseractPath,
        pythonPath,
        ocrEngine,
        ocrDevice,
        ocrLanguage
      });
      showStatus("Tools dependency settings saved.");
      await onRefresh();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Tools settings save failed.", "error");
    }
  }

  async function sendOutputToDrop(output: ToolsOutputItem): Promise<void> {
    const result = await onAction("tools.send_output_to_drop", "module_ui", { path: output.path });
    showStatus(result.ok ? "Output sent to phone." : result.error ?? "Send to phone failed.", result.ok ? "success" : "error");
  }

  async function saveOutputToVault(output: ToolsOutputItem): Promise<void> {
    const result = await onAction("tools.save_output_to_vault", "module_ui", {
      path: output.path,
      category: "Other",
      tags: "tools",
      sourceModule: "DexNest Tools",
      title: output.fileName
    });
    showStatus(result.ok ? "Output saved to Vault." : result.error ?? "Save to Vault failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  return (
    <section className="view-stack accent-tools" aria-labelledby="tools-title">
      {status && (
        <ToastStack toasts={[{ id: status.message, message: status.message, tone: status.tone }]} />
      )}
      <PageHeader eyebrow="Local PDF and media utilities" title="Tools" titleId="tools-title" />

      <section
        className="drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        aria-label="DexNest Tools file drop zone"
      >
        <div>
          <h3>Select Files</h3>
          <p>Drag files here or use the local file picker. Reorder files before merging PDFs or creating a PDF from images.</p>
        </div>
        <div className="button-row">
          <button type="button" className="button-primary" onClick={() => void selectFiles("pdf")}>Select PDFs</button>
          <button type="button" className="button-secondary" onClick={() => void selectFiles("image")}>Select Images</button>
          <button type="button" className="button-secondary" onClick={() => void selectFiles("any")}>Select Any</button>
        </div>
        <div className="file-list">
          {selectedFiles.length === 0 ? (
            <p className="empty-inline">No files selected.</p>
          ) : (
            selectedFiles.map((file, index) => (
              <div
                className="file-row"
                data-dragging={draggedFileIndex === index}
                draggable
                key={file.path}
                onDragStart={(event) => {
                  event.stopPropagation();
                  setDraggedFileIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-dexnest-tools-reorder", String(index));
                  event.dataTransfer.setData("text/plain", file.path);
                }}
                onDragOver={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  reorderSelectedFile(index);
                }}
                onDragEnd={(event) => {
                  event.stopPropagation();
                  setDraggedFileIndex(null);
                }}
              >
                <button className="drag-handle" type="button" aria-label={`Drag ${file.name} to reorder`} title="Drag to reorder">
                  <span className="drag-handle__chevron drag-handle__chevron--up" aria-hidden="true" />
                  <span className="drag-handle__bar" aria-hidden="true" />
                  <span className="drag-handle__bar" aria-hidden="true" />
                  <span className="drag-handle__chevron drag-handle__chevron--down" aria-hidden="true" />
                </button>
                <span>{index + 1}. {file.name}</span>
                <strong className="technical">{formatBytes(file.byteLength)}</strong>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="tab-row" role="tablist" aria-label="DexNest Tools sections">
        {[
          ["pdf", "PDF"],
          ["images", "Images"],
          ["ocr", "OCR / Scan Cleanup"],
          ["media", "Media"],
          ["office", "Office"],
          ["outputs", "Recent Outputs"],
          ["settings", "Settings"]
        ].map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={activeTab === id ? "button-primary" : "button-secondary"}
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "pdf" && (
        <div className="tools-grid">
          <Panel title="PDF Tools">
            <div className="button-row">
              <button type="button" disabled={runningActionId === "tools.merge_pdfs"} onClick={() => void runTool("tools.merge_pdfs")}>Merge PDFs</button>
              <button type="button" disabled={runningActionId === "tools.images_to_pdf"} onClick={() => void runTool("tools.images_to_pdf")}>Images to PDF</button>
            </div>
            <label>
              Split page range
              <input className="technical" value={pageRange} onChange={(event) => setPageRange(event.target.value)} placeholder="1-3 or 1,3,5" />
            </label>
            <button type="button" disabled={runningActionId === "tools.split_pdf"} onClick={() => void runTool("tools.split_pdf", { range: pageRange })}>Split PDF</button>
            <div className="file-list">
              {pdfInfo.length === 0 ? (
                <p className="empty-inline">Select PDFs to view basic info.</p>
              ) : (
                pdfInfo.map((item) => (
                  <div className="file-row" key={item.fileName}>
                    <span>{item.fileName}</span>
                    <strong className="technical">{formatBytes(item.byteLength)} / {item.pageCount ?? "?"} pages</strong>
                  </div>
                ))
              )}
            </div>
          </Panel>
          <Panel title="PDF Export">
            <div className="button-row">
              <button type="button" disabled={runningActionId === "tools.pdf_to_images"} onClick={() => void runTool("tools.pdf_to_images")}>PDF to images</button>
              <button type="button" disabled={runningActionId === "tools.pdf_to_text"} onClick={() => void runTool("tools.pdf_to_text")}>PDF to text</button>
              <button type="button" disabled={runningActionId === "tools.pdf_to_docx_experimental"} onClick={() => void runTool("tools.pdf_to_docx_experimental")}>PDF to DOCX</button>
            </div>
            <p>PDF to DOCX is experimental and quality may vary. PDF image/text export requires local Poppler tools on PATH.</p>
          </Panel>
        </div>
      )}

      {activeTab === "images" && (
        <Panel title="Image Tools">
          <div className="tools-form-grid">
            <label>
              Format
              <select value={imageFormat} onChange={(event) => setImageFormat(event.target.value)}>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <label>
              Quality
              <input className="technical" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)} />
            </label>
            <label>
              Width
              <input className="technical" value={resizeWidth} onChange={(event) => setResizeWidth(event.target.value)} placeholder="optional" />
            </label>
            <label>
              Height
              <input className="technical" value={resizeHeight} onChange={(event) => setResizeHeight(event.target.value)} placeholder="optional" />
            </label>
          </div>
          <div className="button-row">
            <button type="button" disabled={runningActionId === "tools.convert_image"} onClick={() => void runTool("tools.convert_image", { format: imageFormat, quality: imageQuality })}>Convert</button>
            <button type="button" disabled={runningActionId === "tools.compress_image"} onClick={() => void runTool("tools.compress_image", { format: "jpg", quality: imageQuality })}>Compress</button>
            <button type="button" disabled={runningActionId === "tools.resize_image"} onClick={() => void runTool("tools.resize_image", { format: imageFormat, quality: imageQuality, width: resizeWidth, height: resizeHeight })}>Resize</button>
          </div>
          <p>WebP input can be selected if Electron can decode it locally. Outputs are PNG or JPG in this MVP.</p>
        </Panel>
      )}

      {activeTab === "ocr" && (
        <div className="tools-grid">
          <Panel title="OCR">
            <p>PaddleOCR is the advanced local engine. Tesseract remains available as a fallback. EasyOCR is a placeholder for later.</p>
            <div className="tools-form-grid">
              <label>
                OCR engine
                <select value={ocrEngine} onChange={(event) => setOcrEngine(event.target.value as typeof ocrEngine)}>
                  <option value="paddleocr">PaddleOCR</option>
                  <option value="tesseract">Tesseract</option>
                  <option value="easyocr_placeholder">EasyOCR placeholder</option>
                </select>
              </label>
              <label>
                PaddleOCR device
                <select value={ocrDevice} onChange={(event) => setOcrDevice(event.target.value as typeof ocrDevice)} disabled={ocrEngine !== "paddleocr"}>
                  <option value="gpu">GPU</option>
                  <option value="cpu">CPU</option>
                </select>
              </label>
              <label>
                OCR language
                <input className="technical" value={ocrLanguage} onChange={(event) => setOcrLanguage(event.target.value)} placeholder="eng" />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={ocrUpscale} onChange={(event) => setOcrUpscale(event.target.checked)} />
                <span>Upscale 2x before OCR</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={scanGrayscale} onChange={(event) => setScanGrayscale(event.target.checked)} />
                <span>Grayscale before OCR</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={scanSharpen} onChange={(event) => setScanSharpen(event.target.checked)} />
                <span>Sharpen before OCR</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={ocrThreshold} onChange={(event) => setOcrThreshold(event.target.checked)} />
                <span>Threshold/binarize before OCR</span>
              </label>
            </div>
            <div className="button-row">
              <button type="button" className={runningActionId === "tools.ocr_image" ? "is-busy" : undefined} disabled={runningActionId === "tools.ocr_image"} onClick={() => void runTool("tools.ocr_image", { engine: ocrEngine, device: ocrDevice, language: ocrLanguage, upscale: ocrUpscale, grayscale: scanGrayscale, contrastBoost: true, sharpen: scanSharpen, threshold: ocrThreshold, rotateDegrees: scanRotate })}>{runningActionId === "tools.ocr_image" && <Spinner size="sm" />}{runningActionId === "tools.ocr_image" ? "Running OCR…" : "OCR images"}</button>
              <button type="button" className={runningActionId === "tools.ocr_pdf" ? "is-busy" : undefined} disabled={runningActionId === "tools.ocr_pdf"} onClick={() => void runTool("tools.ocr_pdf", { engine: ocrEngine, device: ocrDevice, language: ocrLanguage, upscale: ocrUpscale, grayscale: scanGrayscale, contrastBoost: true, sharpen: scanSharpen, threshold: ocrThreshold, rotateDegrees: scanRotate })}>{runningActionId === "tools.ocr_pdf" && <Spinner size="sm" />}{runningActionId === "tools.ocr_pdf" ? "Running OCR…" : "OCR PDFs"}</button>
              <button type="button" onClick={() => setActiveTab("settings")}>OCR settings</button>
            </div>
            {ocrEngine === "paddleocr" && <p>GPU is the DexNest default for PaddleOCR, but it requires a GPU-enabled PaddlePaddle install. A CPU-only PaddlePaddle package cannot use GPU OCR.</p>}
            {ocrEngine === "tesseract" && <p>Tesseract OCR is required. Install it and set <span className="technical">tesseract.exe</span> in Tools Settings if auto-detect fails.</p>}
            {ocrMetadata && <p className="technical">Engine: {ocrMetadata.engine} / confidence: {ocrMetadata.averageConfidence === null ? "not available" : `${Math.round(ocrMetadata.averageConfidence * 100)}%`}</p>}
            <label>
              OCR preview
              <textarea readOnly value={ocrPreview} placeholder="Extracted text preview appears here after OCR runs." />
            </label>
          </Panel>

          <Panel title="Scan Cleanup">
            <div className="tools-form-grid">
              <label className="checkbox-row">
                <input type="checkbox" checked={scanGrayscale} onChange={(event) => setScanGrayscale(event.target.checked)} />
                <span>Grayscale</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={scanSharpen} onChange={(event) => setScanSharpen(event.target.checked)} />
                <span>Sharpen text</span>
              </label>
              <label>
                Contrast
                <input className="technical" value={scanContrast} onChange={(event) => setScanContrast(event.target.value)} placeholder="0.28" />
              </label>
              <label>
                Rotate
                <select value={scanRotate} onChange={(event) => setScanRotate(event.target.value)}>
                  <option value="0">No rotation</option>
                  <option value="90">Rotate right</option>
                  <option value="-90">Rotate left</option>
                  <option value="180">Rotate 180</option>
                </select>
              </label>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={runningActionId === "tools.clean_scan"}
                onClick={() => void runTool("tools.clean_scan", { grayscale: scanGrayscale, sharpen: scanSharpen, contrast: scanContrast, rotateDegrees: scanRotate })}
              >
                Clean scan images
              </button>
              <button
                type="button"
                disabled={runningActionId === "tools.cleaned_image_to_pdf"}
                onClick={() => void runTool("tools.cleaned_image_to_pdf", { grayscale: scanGrayscale, sharpen: scanSharpen, contrast: scanContrast, rotateDegrees: scanRotate })}
              >
                Cleaned images to PDF
              </button>
            </div>
            <p>Crop is a placeholder for a later visual crop tool. This MVP applies non-destructive copied outputs only.</p>
          </Panel>
        </div>
      )}

      {activeTab === "media" && (
        <Panel title="Media Converters">
          <div className="tools-form-grid">
            <label>
              Audio output
              <select value={audioFormat} onChange={(event) => setAudioFormat(event.target.value)}>
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
                <option value="m4a">M4A</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button type="button" disabled={runningActionId === "tools.mp4_to_mp3"} onClick={() => void runTool("tools.mp4_to_mp3", { format: "mp3" })}>MP4 to MP3</button>
            <button type="button" disabled={runningActionId === "tools.extract_audio"} onClick={() => void runTool("tools.extract_audio", { format: audioFormat })}>Extract audio</button>
            <button type="button" disabled={runningActionId === "tools.convert_audio"} onClick={() => void runTool("tools.convert_audio", { format: audioFormat })}>Convert audio</button>
          </div>
          <p>Media conversion requires local ffmpeg. DexNest does not bundle large binaries yet.</p>
        </Panel>
      )}

      {activeTab === "office" && (
        <Panel title="Office Converters">
          <div className="button-row">
            <button type="button" disabled={runningActionId === "tools.docx_to_pdf"} onClick={() => void runTool("tools.docx_to_pdf")}>DOCX to PDF</button>
            <button type="button" disabled={runningActionId === "tools.pptx_to_pdf"} onClick={() => void runTool("tools.pptx_to_pdf")}>PPTX to PDF</button>
            <button type="button" disabled={runningActionId === "tools.pptx_to_images"} onClick={() => void runTool("tools.pptx_to_images")}>PPTX to images</button>
          </div>
          <p>Office conversions require local LibreOffice. PPTX to images also requires Poppler on PATH.</p>
        </Panel>
      )}

      {activeTab === "settings" && (
        <div className="tools-grid">
          <Panel title="Output Settings">
            <p>Current output folder:</p>
            <p className="technical">{toolsState.outputFolderPath}</p>
            <p>Default:</p>
            <p className="technical">{toolsState.defaultOutputFolderPath}</p>
            <div className="button-row">
              <button type="button" onClick={() => void chooseOutputFolder()}>Choose output folder</button>
              <button type="button" onClick={() => void resetOutputFolder()}>Reset default</button>
              <button type="button" onClick={() => void onAction("tools.open_output_folder")}>Open output folder</button>
            </div>
            <p className="technical">{toolsState.tempFolderPath}</p>
          </Panel>
          <Panel title="Local Dependency Settings">
            <label>
              ffmpeg path
              <input className="technical" value={ffmpegPath} onChange={(event) => setFfmpegPath(event.target.value)} placeholder={toolsState.detectedFfmpegPath ?? "ffmpeg from PATH"} />
            </label>
            <p>Detected: <span className="technical">{toolsState.detectedFfmpegPath ?? "not found"}</span></p>
            <label>
              LibreOffice soffice.exe path
              <input className="technical" value={libreOfficePath} onChange={(event) => setLibreOfficePath(event.target.value)} placeholder={toolsState.detectedLibreOfficePath ?? "LibreOffice soffice.exe"} />
            </label>
            <p>Detected: <span className="technical">{toolsState.detectedLibreOfficePath ?? "not found"}</span></p>
            <label>
              Tesseract OCR path
              <input className="technical" value={tesseractPath} onChange={(event) => setTesseractPath(event.target.value)} placeholder={toolsState.detectedTesseractPath ?? "Tesseract tesseract.exe"} />
            </label>
            <p>Detected: <span className="technical">{toolsState.detectedTesseractPath ?? "not found"}</span></p>
            <label>
              Python path for PaddleOCR
              <input className="technical" value={pythonPath} onChange={(event) => setPythonPath(event.target.value)} placeholder={toolsState.detectedPythonPath ?? "python from PATH"} />
            </label>
            <p>Detected: <span className="technical">{toolsState.detectedPythonPath ?? "not found"}</span></p>
            <label>
              Default OCR engine
              <select value={ocrEngine} onChange={(event) => setOcrEngine(event.target.value as typeof ocrEngine)}>
                <option value="paddleocr">PaddleOCR</option>
                <option value="tesseract">Tesseract</option>
                <option value="easyocr_placeholder">EasyOCR placeholder</option>
              </select>
            </label>
            <label>
              Default PaddleOCR device
              <select value={ocrDevice} onChange={(event) => setOcrDevice(event.target.value as typeof ocrDevice)}>
                <option value="gpu">GPU</option>
                <option value="cpu">CPU</option>
              </select>
            </label>
            <label>
              OCR language
              <input className="technical" value={ocrLanguage} onChange={(event) => setOcrLanguage(event.target.value)} placeholder="eng" />
            </label>
            <div className="button-row">
              <button type="button" onClick={() => void saveDependencySettings()}>Save paths</button>
              <button type="button" onClick={() => { setFfmpegPath(""); setLibreOfficePath(""); setTesseractPath(""); setPythonPath(""); setOcrEngine("paddleocr"); setOcrDevice("gpu"); setOcrLanguage("eng"); }}>Clear fields</button>
            </div>
            <p>PaddleOCR setup: GPU mode requires a GPU-enabled local PaddlePaddle install for Python 3.12. CPU-only PaddlePaddle will be blocked before OCR starts.</p>
            <p className="technical">local-data/settings/tools-settings.json</p>
          </Panel>
        </div>
      )}

      {(activeTab === "outputs" || activeTab !== "settings") && (
        <Panel title="Recent Outputs">
          <div className="item-list">
            {toolsState.outputs.length === 0 ? (
              <p className="empty-inline">No Tools outputs yet.</p>
            ) : (
              toolsState.outputs.map((output) => (
                <CollapsibleListItem
                  accentClass="accent-tools"
                  key={output.id}
                  title={output.fileName}
                  meta={`${output.operation} / ${formatBytes(output.byteLength)} / ${formatDate(output.createdAt)}`}
                  actions={(
                    <>
                    <button type="button" onClick={() => void getBridge().openToolsFile(output.path)}>Open file</button>
                    <button type="button" onClick={() => void onAction("tools.open_output_folder")}>Open folder</button>
                    <button type="button" onClick={() => void sendOutputToDrop(output)}>Send to phone</button>
                    <button type="button" onClick={() => void saveOutputToVault(output)}>Save to Vault</button>
                    </>
                  )}
                >
                  <p className="technical">{output.path}</p>
                </CollapsibleListItem>
              ))
            )}
          </div>
        </Panel>
      )}
    </section>
  );
}

function VaultView({
  vaultState,
  onAction,
  onRefresh
}: {
  vaultState: VaultState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [selectedFiles, setSelectedFiles] = useState<ToolsSelectedFile[]>([]);
  const [category, setCategory] = useState("Other");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("Other");
  const [editTags, setEditTags] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editExpiryDate, setEditExpiryDate] = useState("");
  const [expandedDocumentIds, setExpandedDocumentIds] = useState<string[]>([]);
  const [activeVaultTab, setActiveVaultTab] = useState<"documents" | "secure">("documents");
  const [autoOcrOnImport, setAutoOcrOnImport] = useState(vaultState.ocrSettings.autoOcrOnImport);
  const [vaultOcrPythonPath, setVaultOcrPythonPath] = useState(vaultState.ocrSettings.pythonPath ?? "");
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setAutoOcrOnImport(vaultState.ocrSettings.autoOcrOnImport);
    setVaultOcrPythonPath(vaultState.ocrSettings.pythonPath ?? "");
  }, [vaultState.ocrSettings.autoOcrOnImport, vaultState.ocrSettings.pythonPath]);

  const recentImports = vaultState.documents.slice(0, 5);
  const categoryCounts = vaultState.categories.map((item) => ({
    category: item,
    count: vaultState.documents.filter((document) => document.category === item).length
  }));
  const expiring = useMemo(() => {
    const now = parseLocalDateInput(getLocalTodayDateString());
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in90 = new Date(now);
    in90.setDate(in90.getDate() + 90);
    const withExpiry = vaultState.documents.filter((document) => document.expiryDate);
    return {
      expired: withExpiry.filter((document) => parseLocalDateInput(String(document.expiryDate)) < now),
      next30: withExpiry.filter((document) => {
        const date = parseLocalDateInput(String(document.expiryDate));
        return date >= now && date <= in30;
      }),
      next90: withExpiry.filter((document) => {
        const date = parseLocalDateInput(String(document.expiryDate));
        return date > in30 && date <= in90;
      })
    };
  }, [vaultState.documents]);

  function showStatus(message: string, tone: "success" | "error" = "success"): void {
    setStatus({ tone, message });
    window.setTimeout(() => {
      setStatus((current) => current?.message === message ? null : current);
    }, 3000);
  }

  function toggleDocument(documentId: string): void {
    setExpandedDocumentIds((current) => (
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    ));
  }

  async function chooseFiles(): Promise<void> {
    const files = await getBridge().selectVaultFiles();
    setSelectedFiles(files);
  }

  function onDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).map((file) => ({
      path: (file as File & { path?: string }).path ?? "",
      name: file.name,
      byteLength: file.size,
      extension: `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    })).filter((file) => file.path);
    setSelectedFiles(files);
  }

  async function importDocuments(): Promise<void> {
    const result = await onAction("vault.import_documents", "module_ui", {
      paths: selectedFiles.map((file) => file.path),
      category,
      tags,
      notes,
      expiryDate: expiryDate || null,
      sourceModule: "DexNest Vault"
    });
    showStatus(result.ok ? "Documents imported to Vault." : result.error ?? "Vault import failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setSelectedFiles([]);
      setNotes("");
      await onRefresh();
    }
  }

  function startEdit(document: VaultDocumentRecord): void {
    setEditingDocumentId(document.id);
    setEditTitle(document.title);
    setEditCategory(document.category);
    setEditTags(document.tags.join(", "));
    setEditNotes(document.notes);
    setEditExpiryDate(document.expiryDate ?? "");
  }

  async function saveMetadata(): Promise<void> {
    if (!editingDocumentId) {
      return;
    }
    const result = await onAction("vault.edit_document_metadata", "module_ui", {
      documentId: editingDocumentId,
      title: editTitle,
      category: editCategory,
      tags: editTags,
      notes: editNotes,
      expiryDate: editExpiryDate || null
    });
    showStatus(result.ok ? "Vault metadata saved." : result.error ?? "Metadata update failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setEditingDocumentId(null);
      await onRefresh();
    }
  }

  async function deleteDocument(document: VaultDocumentRecord): Promise<void> {
    if (!window.confirm(`Delete "${document.title}" from DexNest Vault metadata?`)) {
      return;
    }
    const deleteFile = window.confirm("Also delete the copied Vault file? Originals outside Vault are never deleted.");
    const result = await onAction("vault.delete_document", "module_ui", { documentId: document.id, deleteFile, confirmedDangerous: true });
    showStatus(result.ok ? "Vault document deleted." : result.error ?? "Delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function addVersion(document: VaultDocumentRecord): Promise<void> {
    const files = await getBridge().selectVaultFiles();
    if (files.length !== 1) {
      showStatus("Select exactly one file for a new version.", "error");
      return;
    }
    const result = await onAction("vault.add_document_version", "module_ui", { documentId: document.id, paths: [files[0].path] });
    showStatus(result.ok ? "New Vault version added." : result.error ?? "Version add failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function runDocumentAction(actionId: string, document: VaultDocumentRecord): Promise<void> {
    const result = await onAction(actionId, "module_ui", { documentId: document.id });
    showStatus(result.ok ? "Vault action completed." : result.error ?? "Vault action failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function runVaultOcrAction(actionId: string, params: Record<string, unknown> = {}): Promise<void> {
    const result = await onAction(actionId, "module_ui", params);
    showStatus(result.ok ? "Vault OCR action queued." : result.error ?? "Vault OCR action failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function saveVaultOcrSettings(): Promise<void> {
    const result = await onAction("vault.ocr.update_settings", "module_ui", {
      autoOcrOnImport,
      pythonPath: vaultOcrPythonPath || null
    });
    showStatus(result.ok ? "Vault OCR settings saved." : result.error ?? "Vault OCR settings failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  function documentOcrStatus(document: VaultDocumentRecord): string {
    return document.ocrStatus ?? ([".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(document.fileType) ? "not_ocred" : "unsupported");
  }

  return (
    <section className="view-stack accent-vault" aria-labelledby="vault-title">
      {status && (
        <ToastStack toasts={[{ id: status.message, message: status.message, tone: status.tone }]} />
      )}
      <PageHeader eyebrow="Local document vault" title="Vault" titleId="vault-title" />

      <div className="tab-row" role="tablist" aria-label="DexNest Vault sections">
        <button type="button" role="tab" aria-selected={activeVaultTab === "documents"} className={activeVaultTab === "documents" ? "button-primary" : "button-secondary"} onClick={() => setActiveVaultTab("documents")}>Documents</button>
        <button type="button" role="tab" aria-selected={activeVaultTab === "secure"} className={activeVaultTab === "secure" ? "button-primary" : "button-secondary"} onClick={() => setActiveVaultTab("secure")}>Secure Vault</button>
      </div>

      {activeVaultTab === "documents" && (
        <>
      <div className="tools-grid">
        <Panel title="Import Document">
          <section className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <div>
              <h3>Copy files into Vault</h3>
              <p>Original files are never moved or deleted.</p>
            </div>
            <button type="button" className="button-primary" onClick={() => void chooseFiles()}>Select documents</button>
            <div className="file-list">
              {selectedFiles.length === 0 ? (
                <p className="empty-inline">No documents selected.</p>
              ) : (
                selectedFiles.map((file) => (
                  <div className="file-row" key={file.path}>
                    <span>{file.name}</span>
                    <strong className="technical">{formatBytes(file.byteLength)}</strong>
                  </div>
                ))
              )}
            </div>
          </section>
          <div className="tools-form-grid">
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {vaultState.categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              Expiry date
              <input className="technical" type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
            </label>
          </div>
          <label>
            Tags
            <input className="technical" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="resume, contract, receipt" />
          </label>
          <label>
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Private notes stay local. Audit stores metadata only." />
          </label>
          <button type="button" className="button-primary" onClick={() => void importDocuments()}>Import to Vault</button>
        </Panel>

        <Panel title="Vault Settings">
          <p>Documents path</p>
          <p className="technical">{vaultState.documentsPath}</p>
          <p>Imports path</p>
          <p className="technical">{vaultState.importsPath}</p>
          <p>Versions path</p>
          <p className="technical">{vaultState.versionsPath}</p>
          <p>OCR output path</p>
          <p className="technical">{vaultState.ocrOutputPath}</p>
          <p>OCR jobs</p>
          <p className="technical">{vaultState.ocrJobsPath}</p>
          <p>Metadata path</p>
          <p className="technical">{vaultState.metadataPath}</p>
          <p>{vaultState.documentCount} documents / {formatBytes(vaultState.totalSizeBytes)}</p>
          <p>Secure Vault is encrypted separately. Document Vault OCR is local PaddleOCR GPU only.</p>
        </Panel>
      </div>

      <Panel title="GPU OCR Queue">
        <div className="settings-grid">
          <article>
            <span>Queue</span>
            <strong>{vaultState.ocrQueueRunning ? "Running" : vaultState.ocrQueuePaused ? "Paused" : "Idle"}</strong>
            <p>{vaultState.ocrJobs.filter((job) => job.status === "queued").length} queued / {vaultState.ocrJobs.filter((job) => job.status === "failed").length} failed</p>
          </article>
          <article>
            <span>PaddleOCR GPU</span>
            <strong>{vaultState.paddleGpuStatus.ok ? "Ready" : "Needs setup"}</strong>
            <p>{vaultState.paddleGpuStatus.message}</p>
          </article>
          <article>
            <span>Runtime</span>
            <strong>{vaultState.paddleGpuStatus.paddleVersion ?? "unknown"}</strong>
            <p className="technical">{vaultState.paddleGpuStatus.pythonPath ?? "No Python path"}</p>
          </article>
        </div>
        <div className="registry-controls">
          <label className="checkbox-row">
            <input type="checkbox" checked={autoOcrOnImport} onChange={(event) => setAutoOcrOnImport(event.target.checked)} />
            <span>Auto OCR supported Vault imports</span>
          </label>
          <label>
            Python path
            <input className="technical" value={vaultOcrPythonPath} onChange={(event) => setVaultOcrPythonPath(event.target.value)} placeholder="Use detected Tools Python if empty" />
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void runVaultOcrAction("vault.ocr.run_queue")}>Run OCR queue now</button>
          <button type="button" onClick={() => void runVaultOcrAction("vault.ocr.pause_queue")}>Pause OCR queue</button>
          <button type="button" onClick={() => void runVaultOcrAction("vault.ocr.retry_failed")}>Retry failed OCR</button>
          <button type="button" onClick={() => void saveVaultOcrSettings()}>Save OCR settings</button>
        </div>
        <div className="action-list action-list--compact">
          {vaultState.ocrJobs.slice(0, 8).map((job) => (
            <article className="data-item data-item--stacked accent-vault" key={job.id}>
              <strong>{job.status} / {job.fileType} / {job.engine} {job.device}</strong>
              <span className="technical">{job.documentId}</span>
              {job.error && <span>{job.error}</span>}
            </article>
          ))}
        </div>
      </Panel>

      <div className="tools-grid">
        <Panel title="Categories">
          <div className="pill-grid">
            {categoryCounts.map((item) => (
              <span className="status-pill" key={item.category}>{item.category}: {item.count}</span>
            ))}
          </div>
        </Panel>
        <Panel title="Expiring Soon">
          <p>Expired: {expiring.expired.length}</p>
          <p>Next 30 days: {expiring.next30.length}</p>
          <p>Next 90 days: {expiring.next90.length}</p>
          {[...expiring.expired, ...expiring.next30, ...expiring.next90].slice(0, 6).map((document) => (
            <p className="technical" key={document.id}>{document.title} / {document.expiryDate ? formatLocalDate(document.expiryDate) : ""}</p>
          ))}
        </Panel>
      </div>

      {editingDocumentId && (
        <Panel title="Edit Metadata">
          <div className="tools-form-grid">
            <label>
              Title
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
            </label>
            <label>
              Category
              <select value={editCategory} onChange={(event) => setEditCategory(event.target.value)}>
                {vaultState.categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              Tags
              <input className="technical" value={editTags} onChange={(event) => setEditTags(event.target.value)} />
            </label>
            <label>
              Expiry date
              <input className="technical" type="date" value={editExpiryDate} onChange={(event) => setEditExpiryDate(event.target.value)} />
            </label>
          </div>
          <label>
            Notes
            <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} />
          </label>
          <div className="button-row">
            <button type="button" className="button-primary" onClick={() => void saveMetadata()}>Save metadata</button>
            <button type="button" onClick={() => setEditingDocumentId(null)}>Cancel</button>
          </div>
        </Panel>
      )}

      <Panel title="Document Library">
        <div className="item-list">
          {vaultState.documents.length === 0 ? (
            <p className="empty-inline">No Vault documents yet.</p>
          ) : (
            <LimitedList items={vaultState.documents} step={50}>{(document) => {
              const expanded = expandedDocumentIds.includes(document.id);
              return (
                <article className="vault-document accent-vault" data-expanded={expanded} key={document.id}>
                  <button
                    type="button"
                    className="vault-document__summary"
                    aria-expanded={expanded}
                    onClick={() => toggleDocument(document.id)}
                  >
                      <span className="vault-document__chevron" aria-hidden="true" />
                      <span>
                        <strong>{document.title}</strong>
                        <small>{document.category} / {document.fileType} / {formatBytes(document.sizeBytes)} / Version {document.versionNumber ?? 1}</small>
                      </span>
                    <span className="status-pill">{documentOcrStatus(document)}</span>
                  </button>
                  {expanded && (
                    <div className="vault-document__details">
                      <div>
                        <p>{document.tags.length ? document.tags.join(", ") : "No tags"}{document.expiryDate ? ` / expires ${formatLocalDate(document.expiryDate)}` : ""}</p>
                        <p>OCR: {documentOcrStatus(document)}{document.ocrUpdatedAt ? ` / ${formatLocalDateTime(document.ocrUpdatedAt)}` : ""}</p>
                        {document.ocrError && <p>{document.ocrError}</p>}
                        <p>{formatDate(document.createdAt)}</p>
                        <p className="technical">{document.id}</p>
                        <p className="technical">{document.filePath}</p>
                        {document.ocrTextPath && <p className="technical">{document.ocrTextPath}</p>}
                      </div>
                      <div className="button-row">
                        <button type="button" onClick={() => void runDocumentAction("vault.open_document", document)}>Open file</button>
                        <button type="button" onClick={() => void runDocumentAction("vault.open_document_folder", document)}>Open folder</button>
                        <button type="button" onClick={() => startEdit(document)}>Edit metadata</button>
                        <button type="button" onClick={() => void addVersion(document)}>New version</button>
                        <button type="button" onClick={() => void runVaultOcrAction("vault.ocr.rerun_document", { documentId: document.id })}>{document.ocrStatus === "completed" ? "Re-run OCR" : "Run OCR"}</button>
                        <button type="button" disabled={!document.ocrTextPath} onClick={() => void runDocumentAction("vault.ocr.open_text", document)}>Open OCR text</button>
                        <button type="button" disabled={!document.ocrTextPath} onClick={() => void runDocumentAction("vault.ocr.copy_text", document)}>Copy OCR text</button>
                        <button type="button" onClick={() => void runDocumentAction("vault.send_document_to_drop", document)}>Send to Drop</button>
                        <button type="button" className="button-danger" onClick={() => void deleteDocument(document)}>Delete</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            }}</LimitedList>
          )}
        </div>
      </Panel>

      <Panel title="Recent Imports">
        {recentImports.length === 0 ? (
          <p className="empty-inline">No recent imports.</p>
        ) : (
          recentImports.map((document) => (
            <p className="technical" key={document.id}>{document.title} / {formatDate(document.createdAt)}</p>
          ))
        )}
      </Panel>
        </>
      )}

      {activeVaultTab === "secure" && (
        <SecureVaultView secure={vaultState.secure} onAction={onAction} onRefresh={onRefresh} showStatus={showStatus} />
      )}
    </section>
  );
}

function SecureVaultView({
  secure,
  onAction,
  onRefresh,
  showStatus
}: {
  secure: SecureVaultState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{ ok: boolean; error?: string }>;
  onRefresh: () => Promise<void>;
  showStatus: (message: string, tone?: "success" | "error") => void;
}) {
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [setupAutoLockMinutes, setSetupAutoLockMinutes] = useState("5");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [itemType, setItemType] = useState<SecureVaultItemType>("password");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [query, setQuery] = useState("");
  const [revealedIds, setRevealedIds] = useState<string[]>([]);

  const filteredItems = secure.items.filter((item) => {
    const haystack = `${item.title} ${item.type} ${item.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase().trim());
  });

  function resetForm(): void {
    setEditingItemId(null);
    setTitle("");
    setItemType("password");
    setUsername("");
    setUrl("");
    setSecret("");
    setNotes("");
    setTags("");
    setFavorite(false);
  }

  function startEdit(item: SecureVaultItem): void {
    setEditingItemId(item.id);
    setTitle(item.title);
    setItemType(item.type);
    setUsername(item.username ?? "");
    setUrl(item.url ?? "");
    setSecret(item.secret);
    setNotes(item.notes);
    setTags(item.tags.join(", "));
    setFavorite(Boolean(item.favorite));
  }

  async function setupSecureVault(): Promise<void> {
    const result = await onAction("vault.secure.setup", "module_ui", { masterPassword, confirmPassword, autoLockMinutes: setupAutoLockMinutes });
    showStatus(result.ok ? "Secure Vault set up and unlocked." : result.error ?? "Secure Vault setup failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setMasterPassword("");
      setConfirmPassword("");
      await onRefresh();
    }
  }

  async function unlockSecureVault(): Promise<void> {
    const result = await onAction("vault.secure.unlock", "module_ui", { masterPassword: unlockPassword });
    showStatus(result.ok ? "Secure Vault unlocked." : result.error ?? "Unlock failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setUnlockPassword("");
      await onRefresh();
    }
  }

  async function lockSecureVault(): Promise<void> {
    const result = await onAction("vault.secure.lock", "module_ui", {});
    showStatus(result.ok ? "Secure Vault locked." : result.error ?? "Lock failed.", result.ok ? "success" : "error");
    resetForm();
    await onRefresh();
  }

  async function saveItem(): Promise<void> {
    const actionId = editingItemId ? "vault.secure.edit_item" : "vault.secure.create_item";
    const result = await onAction(actionId, "module_ui", {
      itemId: editingItemId ?? undefined,
      title,
      type: itemType,
      username,
      url,
      secret,
      notes,
      tags,
      favorite
    });
    showStatus(result.ok ? "Secure item saved." : result.error ?? "Secure item save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      resetForm();
      await onRefresh();
    }
  }

  async function deleteItem(item: SecureVaultItem): Promise<void> {
    if (!window.confirm(`Delete secure item "${item.title}"? This cannot be undone.`)) {
      return;
    }
    const result = await onAction("vault.secure.delete_item", "module_ui", { itemId: item.id, confirmedDangerous: true });
    showStatus(result.ok ? "Secure item deleted." : result.error ?? "Delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copyField(actionId: "vault.secure.copy_secret" | "vault.secure.copy_username", item: SecureVaultItem): Promise<void> {
    const result = await onAction(actionId, "module_ui", { itemId: item.id });
    showStatus(result.ok ? (actionId === "vault.secure.copy_secret" ? "Secret copied. Clipboard clears in 30 seconds." : "Username copied.") : result.error ?? "Copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function exportEncrypted(): Promise<void> {
    const result = await onAction("vault.secure.export_encrypted", "module_ui", {});
    showStatus(result.ok ? "Encrypted Secure Vault file location opened." : result.error ?? "Export failed.", result.ok ? "success" : "error");
  }

  async function importPlaceholder(): Promise<void> {
    const result = await onAction("vault.secure.import_encrypted_placeholder", "module_ui", {});
    showStatus(result.error ?? "Encrypted import is a future placeholder.", "error");
  }

  function toggleReveal(itemId: string): void {
    setRevealedIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  if (!secure.isSetup) {
    return (
      <Panel title="Secure Vault Setup">
        <p>Encrypted local storage for passwords, tokens, API keys, recovery codes, and private notes.</p>
        <p className="form-status--error">If this password is lost, Secure Vault data cannot be recovered.</p>
        <p className="technical">{secure.filePath}</p>
        <label>
          Master password
          <input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} />
        </label>
        <label>
          Confirm master password
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        <label>
          Auto-lock minutes
          <input className="technical" value={setupAutoLockMinutes} onChange={(event) => setSetupAutoLockMinutes(event.target.value)} />
        </label>
        <button type="button" className="button-primary" onClick={() => void setupSecureVault()}>Create Secure Vault</button>
      </Panel>
    );
  }

  if (!secure.isUnlocked) {
    return (
      <Panel title="Secure Vault Locked">
        <p>Secure Vault is encrypted at rest. Enter the master password to unlock it locally.</p>
        <p className="technical">{secure.filePath}</p>
        <label>
          Master password
          <input type="password" value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)} />
        </label>
        <button type="button" className="button-primary" onClick={() => void unlockSecureVault()}>Unlock Secure Vault</button>
      </Panel>
    );
  }

  return (
    <div className="view-stack">
      <Panel title="Secure Vault Status">
        <div className="button-row">
          <span className="status-pill">Unlocked</span>
          <span className="status-pill">Auto-lock: {secure.autoLockMinutes} min</span>
          <span className="status-pill">Local encrypted file</span>
        </div>
        <p className="technical">{secure.filePath}</p>
        <div className="button-row">
          <button type="button" onClick={() => void lockSecureVault()}>Lock now</button>
          <button type="button" onClick={() => void exportEncrypted()}>Export encrypted file</button>
          <button type="button" onClick={() => void importPlaceholder()}>Import encrypted file</button>
        </div>
      </Panel>

      <div className="tools-grid">
        <Panel title={editingItemId ? "Edit Secure Item" : "Create Secure Item"}>
          <div className="tools-form-grid">
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Type
              <select value={itemType} onChange={(event) => setItemType(event.target.value as SecureVaultItemType)}>
                {secure.itemTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label>
              Username
              <input className="technical" value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              URL
              <input className="technical" value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
          </div>
          <label>
            Secret
            <input className="technical" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
          </label>
          <label>
            Tags
            <input className="technical" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="work, github, server" />
          </label>
          <label>
            Private notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />
            Favorite
          </label>
          <div className="button-row">
            <button type="button" className="button-primary" onClick={() => void saveItem()}>{editingItemId ? "Save item" : "Create item"}</button>
            {editingItemId && <button type="button" onClick={() => resetForm()}>Cancel</button>}
          </div>
        </Panel>

        <Panel title="Secure Search">
          <p>Search checks title, type, and tags only. Secret and note contents are not logged.</p>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter secure items" />
          <p>{filteredItems.length} visible / {secure.items.length} total</p>
        </Panel>
      </div>

      <Panel title="Secure Items">
        <div className="item-list">
          {filteredItems.length === 0 ? (
            <p className="empty-inline">No secure items yet.</p>
          ) : (
            <LimitedList items={filteredItems} step={50}>{(item) => {
              const revealed = revealedIds.includes(item.id);
              return (
                <article className="data-item accent-vault" key={item.id}>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.type} / {item.tags.length ? item.tags.join(", ") : "No tags"}{item.favorite ? " / favorite" : ""}</p>
                    <p className="technical">{item.id}</p>
                    {item.username && <p className="technical">username: {item.username}</p>}
                    {item.url && <p className="technical">url: {item.url}</p>}
                    <p className="technical">secret: {revealed ? item.secret : "************"}</p>
                    {revealed && item.notes && <p>{item.notes}</p>}
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => void copyField("vault.secure.copy_secret", item)}>Copy secret</button>
                    <button type="button" onClick={() => void copyField("vault.secure.copy_username", item)}>Copy username</button>
                    <button type="button" onClick={() => toggleReveal(item.id)}>{revealed ? "Hide" : "Reveal"}</button>
                    <button type="button" onClick={() => startEdit(item)}>Edit</button>
                    <button type="button" className="button-danger" onClick={() => void deleteItem(item)}>Delete</button>
                  </div>
                </article>
              );
            }}</LimitedList>
          )}
        </div>
      </Panel>
    </div>
  );
}

function DropView({
  dropState,
  endpoint,
  onAction,
  onRefresh
}: {
  dropState: DropState;
  endpoint?: string;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [dropText, setDropText] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; tone: "success" | "error" }>>([]);

  useEffect(() => {
    if (!dropState.phoneUrl) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(dropState.phoneUrl, { margin: 1, width: 180 }).then(setQrDataUrl);
  }, [dropState.phoneUrl]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    let fallbackTimer: number | null = null;
    const eventsUrl = dropState.localUrl
      ? dropState.localUrl.replace(/\/drop$/, "/drop/api/events")
      : `${endpoint ?? "http://127.0.0.1:43217"}/drop/api/events`;
    let eventSource: EventSource;

    try {
      eventSource = new EventSource(eventsUrl);
    } catch {
      fallbackTimer = window.setInterval(() => {
        void onRefresh();
      }, 3000);
      return () => {
        if (fallbackTimer !== null) {
          window.clearInterval(fallbackTimer);
        }
      };
    }

    eventSource.onmessage = (event) => {
      let payload: { eventType?: string; message?: string } = {};
      try {
        payload = JSON.parse(event.data) as { eventType?: string; message?: string };
      } catch {
        return;
      }
      void onRefresh();
      if (payload.eventType && payload.eventType !== "drop.connected" && payload.message) {
        showToast(payload.message);
      }
    };

    eventSource.onerror = () => {
      if (fallbackTimer === null) {
        fallbackTimer = window.setInterval(() => {
          void onRefresh();
        }, 3000);
      }
    };

    return () => {
      eventSource.close();
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
      }
    };
  }, [autoRefresh, dropState.localUrl, endpoint, onRefresh]);

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }

  async function toggleAutoRefresh(enabled: boolean): Promise<void> {
    setAutoRefresh(enabled);
    await getBridge().logDropAutoRefresh(enabled);
    showToast(`Auto-refresh ${enabled ? "enabled" : "disabled"}`);
  }

  async function copyTextToClipboard(value: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      showToast(message);
    } catch {
      showToast("Copy failed", "error");
    }
  }

  async function createTextDrop(): Promise<void> {
    const result = await onAction("drop.create_text_drop", "module_ui", { text: dropText }) as { ok?: boolean; error?: string };
    if (result?.ok === false) {
      showToast(result.error ?? "Text send failed", "error");
      return;
    }
    setDropText("");
    showToast("Text sent");
    await onRefresh();
  }

  async function sendClipboardToDrop(): Promise<void> {
    const result = await onAction("drop.send_clipboard_to_drop") as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clipboard send failed" : "Text sent", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function addOutgoingFile(): Promise<void> {
    const result = await onAction("drop.add_outgoing_file") as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "File add failed" : "File added", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function removeOutgoingFile(fileId: string): Promise<void> {
    const confirmed = window.confirm("Remove this outgoing Drop file copy?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.remove_outgoing_file", "module_ui", { id: fileId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "File remove failed" : "File removed", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function clearOutgoing(): Promise<void> {
    const confirmed = window.confirm("Clear outgoing DexNest Drop text and file items?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_outgoing", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear outgoing failed" : "Outgoing cleared", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function clearIncoming(): Promise<void> {
    const confirmed = window.confirm("Clear incoming DexNest Drop metadata? Received files stay on disk.");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_incoming", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear incoming failed" : "Incoming list cleared", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function copyIncomingText(itemId: string): Promise<void> {
    const result = await getBridge().copyDropIncomingText(itemId);
    showToast(result.ok ? "Copied incoming text" : result.error ?? "Copy failed", result.ok ? "success" : "error");
  }

  async function chooseReceiveFolder(): Promise<void> {
    try {
      const result = await getBridge().chooseDropReceiveFolder();
      if (result.ok) {
        await onRefresh();
        showToast("Receive folder changed");
      } else {
        showToast(result.error ?? "Receive folder change cancelled", "error");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Receive folder change failed", "error");
    }
  }

  async function resetReceiveFolder(): Promise<void> {
    const result = await getBridge().resetDropReceiveFolder();
    await onRefresh();
    showToast(result.ok ? "Receive folder changed" : "Receive folder reset failed", result.ok ? "success" : "error");
  }

  const outgoingCount = dropState.outgoingText.length + dropState.outgoingFiles.length;
  const incomingText = dropState.incoming.filter((item) => item.type === "text");
  const incomingFiles = dropState.incoming.filter((item) => item.type === "file");

  return (
    <section className="view-stack drop-view accent-drop" aria-labelledby="drop-title">
      <ToastStack toasts={toasts} />

      <section className="drop-hero" aria-labelledby="drop-title">
        <div className="drop-hero__main">
          <div className="section-heading">
            <p>Two-way local Wi-Fi transfer</p>
            <h2 id="drop-title">DexNest Drop</h2>
          </div>
          <div className="status-pills" aria-label="Drop status">
            <span>Local only</span>
            <span>Same Wi-Fi required</span>
            <span>Server running</span>
            <span>Auto-refresh {autoRefresh ? "on" : "off"}</span>
          </div>
          <div className="drop-connection">
            <div>
              <span>LAN IP</span>
              <strong className="technical">{dropState.lanIp ?? "not detected"}</strong>
            </div>
            <div>
              <span>Phone URL</span>
              <strong className="technical">{dropState.phoneUrl || "Loading"}</strong>
            </div>
            <div>
              <span>Local URL</span>
              <strong className="technical">{dropState.localUrl || endpoint || "Loading"}</strong>
            </div>
          </div>
          <div className="button-row">
            <button className="button-secondary" type="button" onClick={() => void onRefresh().then(() => showToast("Drop refreshed"))}>
              Refresh
            </button>
            <button className="button-secondary" type="button" onClick={() => void toggleAutoRefresh(!autoRefresh)}>
              Auto-refresh {autoRefresh ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div className="drop-hero__qr">
          {qrDataUrl ? <img className="qr-code" src={qrDataUrl} alt="DexNest Drop phone URL QR code" /> : <div className="qr-code qr-code--empty" />}
        </div>
      </section>

      <section className="drop-transfer-grid" aria-label="Drop transfer directions">
        <article className="drop-panel">
          <div className="drop-panel__header">
            <div>
              <p>PC to Phone</p>
              <h3>Send to phone</h3>
            </div>
            <span>{outgoingCount} ready</span>
          </div>
          <textarea
            className="technical"
            placeholder="Write text to make available on your phone"
            value={dropText}
            onChange={(event) => setDropText(event.target.value)}
          />
          <div className="button-row">
            <button className="button-primary" type="button" onClick={() => void createTextDrop()}>
              Send text
            </button>
            <button className="button-secondary" type="button" onClick={() => void sendClipboardToDrop()}>
              Send clipboard
            </button>
            <button className="button-secondary" type="button" onClick={() => void addOutgoingFile()}>
              Add file
            </button>
            <button className="button-danger" type="button" onClick={() => void clearOutgoing()}>
              Clear outgoing
            </button>
          </div>
          <p>Text drops include expiry metadata. Files are copied into the outgoing shelf.</p>
          <p className="technical">{dropState.outgoingFolderPath}</p>
        </article>

        <article className="drop-panel">
          <div className="drop-panel__header">
            <div>
              <p>Phone to PC</p>
              <h3>Receive from phone</h3>
            </div>
            <span>{dropState.incoming.length} incoming</span>
          </div>
          <div className="drop-folder-card">
            <span>Current receive folder</span>
            <strong className="technical">{dropState.receiveFolderPath}</strong>
          </div>
          <div className="button-row">
            <button className="button-primary" type="button" onClick={() => void chooseReceiveFolder()}>
              Choose receive folder
            </button>
            <button className="button-secondary" type="button" onClick={() => void onAction("drop.open_incoming_folder")}>
              Open folder
            </button>
            <button className="button-secondary" type="button" onClick={() => void resetReceiveFolder()}>
              Reset default
            </button>
            <button className="button-danger" type="button" onClick={() => void clearIncoming()}>
              Clear incoming list
            </button>
          </div>
          <p>Default folder:</p>
          <p className="technical">{dropState.defaultReceiveFolderPath}</p>
          {dropState.customReceiveFolderPath && (
            <>
              <p>Custom folder:</p>
              <p className="technical">{dropState.customReceiveFolderPath}</p>
            </>
          )}
          <p>PIN placeholder: not enforced in this MVP.</p>
        </article>
      </section>

      <section className="drop-shelf-grid" aria-label="Drop shelves">
        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Outgoing text</h3>
            <span>{dropState.outgoingText.length}</span>
          </div>
          {dropState.outgoingText.length === 0 ? (
            <p className="empty-inline">No outgoing text drops yet.</p>
          ) : (
            dropState.outgoingText.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Send to phone</p>
                  <h4>{item.preview || "Text drop"}</h4>
                  <p>{formatBytes(item.byteLength)} from {item.source}</p>
                  <p>Expires: {item.expiresAt ? formatDate(item.expiresAt) : "not set"}</p>
                  <p className="technical">{item.id}</p>
                </div>
                <button className="button-secondary" type="button" onClick={() => void copyTextToClipboard(item.id, "Drop ID copied")}>
                  Copy ID
                </button>
              </div>
            ))
          )}
        </article>

        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Outgoing files</h3>
            <span>{dropState.outgoingFiles.length}</span>
          </div>
          {dropState.outgoingFiles.length === 0 ? (
            <p className="empty-inline">No outgoing files yet.</p>
          ) : (
            dropState.outgoingFiles.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Send to phone</p>
                  <h4>{item.originalName ?? item.fileName ?? "Outgoing file"}</h4>
                  <p>{formatBytes(item.byteLength)}. Phone can download this file.</p>
                  <p className="technical">{item.id}</p>
                </div>
                <button className="button-danger" type="button" onClick={() => void removeOutgoingFile(item.id)}>
                  Remove
                </button>
              </div>
            ))
          )}
        </article>

        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Incoming text</h3>
            <span>{incomingText.length}</span>
          </div>
          {incomingText.length === 0 ? (
            <p className="empty-inline">No incoming phone text yet.</p>
          ) : (
            incomingText.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Receive from phone</p>
                  <h4>{item.preview ?? "Incoming text"}</h4>
                  <p>{formatBytes(item.byteLength)} from phone</p>
                  <p>{formatDate(item.createdAt)}</p>
                  <p className="technical">{item.path ?? item.id}</p>
                </div>
                <button className="button-secondary" type="button" onClick={() => void copyIncomingText(item.id)}>
                  Copy
                </button>
              </div>
            ))
          )}
        </article>

        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Incoming files</h3>
            <span>{incomingFiles.length}</span>
          </div>
          {incomingFiles.length === 0 ? (
            <p className="empty-inline">No incoming phone files yet.</p>
          ) : (
            incomingFiles.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Receive from phone</p>
                  <h4>{item.originalName ?? item.fileName ?? "Incoming file"}</h4>
                  <p>{formatBytes(item.byteLength)} from phone</p>
                  <p>{formatDate(item.createdAt)}</p>
                  <p className="technical">{item.path ?? item.id}</p>
                </div>
                <button className="button-secondary" type="button" onClick={() => void onAction("drop.open_incoming_folder")}>
                  Open folder
                </button>
              </div>
            ))
          )}
        </article>
      </section>
    </section>
  );
}

function previewForUi(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return formatLocalDateTime(value);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function shortcutLabel(value: string): string {
  return value
    .replaceAll("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

function CollapsibleListItem({
  accentClass,
  title,
  meta,
  children,
  actions
}: {
  accentClass: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <details className={`library-item ${accentClass}`}>
      <summary>
        <span className="library-item__chevron" aria-hidden="true" />
        <span className="library-item__summary">
          <strong>{title}</strong>
          {meta && <span>{meta}</span>}
        </span>
      </summary>
      <div className="library-item__body">
        <div className="library-item__details">{children}</div>
        {actions && <div className="library-item__actions">{actions}</div>}
      </div>
    </details>
  );
}

function PageHeader({
  eyebrow,
  title,
  titleId,
  actions
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`section-heading page-header ${actions ? "section-heading--row" : ""}`}>
      <div>
        <p>{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>
      {actions && <div className="button-row page-header__actions">{actions}</div>}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

// Renders a long list capped to `step` rows with a "Show more" button, so views
// like Audit / Clipboard / Finder never paint thousands of DOM nodes at once.
function LimitedList<T>({
  items,
  step = 50,
  children
}: {
  items: T[];
  step?: number;
  children: (item: T, index: number) => React.ReactNode;
}) {
  const [limit, setLimit] = useState(step);
  const visible = limit >= items.length ? items : items.slice(0, limit);
  return (
    <>
      {visible.map((item, index) => children(item, index))}
      {items.length > limit && (
        <button type="button" className="show-more-row" onClick={() => setLimit((value) => value + step)}>
          Show {Math.min(step, items.length - limit)} more ({items.length - limit} remaining)
        </button>
      )}
    </>
  );
}

function PathText({ children }: { children: React.ReactNode }) {
  return <span className="technical technical--truncate">{children}</span>;
}

function StatusBadge({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "error" | "warning" | "info";
}) {
  return <span className="status-badge" data-tone={tone}>{children}</span>;
}

function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" data-tone={toast.tone} key={toast.id}>{toast.message}</div>
      ))}
    </div>
  );
}

function Spinner({ size = "md", label }: { size?: "sm" | "md" | "lg"; label?: string }) {
  return (
    <span
      className={`spinner${size === "sm" ? " spinner--sm" : size === "lg" ? " spinner--lg" : ""}`}
      role="status"
      aria-label={label ?? "Loading"}
    />
  );
}

let lastSpeechCaptureMetrics: SpeechCaptureMetrics | null = null;

function getLastSpeechMetrics(): SpeechCaptureMetrics | null {
  return lastSpeechCaptureMetrics;
}

async function recordSpeechAudio(settings: SpeechSettings): Promise<{ audioBytes: number[]; mimeType: string; durationMs: number; metrics: SpeechCaptureMetrics }> {
  const clickAt = Date.now();
  // Use the pre-warmed stream when available so recording starts instantly.
  const ready = await prewarmMic(settings);
  if (!ready || !micWarm.stream) {
    throw new Error(micWarm.state.error ?? "Microphone is not available.");
  }
  const stream = micWarm.stream;
  const audioContext = micWarm.audioContext ?? new AudioContext();
  micWarm.audioContext = audioContext;
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }

  const chunks: Blob[] = [];
  const preferredMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });

  const vadEnabled = settings.vadEnabled !== false && settings.autoStopOnSilence !== false && settings.silenceStopEnabled !== false;
  const initialSilenceMs = settings.initialSilenceTimeoutMs ?? 4000;
  const endSilenceMs = settings.endSilenceTimeoutMs ?? 900;
  const minSpeechMs = settings.minSpeechMs ?? 300;
  const maxRecordingMs = Math.max(3, settings.maxRecordingSeconds) * 1000;
  const maxPostSpeechMs = settings.maxPostSpeechListenMs ?? 2500;
  const requireSpeechStart = settings.requireSpeechStart !== false;
  const margin = settings.speechThresholdMargin ?? 0.018;

  let stopTimer: number | null = null;
  let vadTimer: number | null = null;
  let speechDetectedAt: number | null = null;
  let silenceStopDelayMs: number | null = null;
  let vadOutcome: SpeechCaptureMetrics["vadOutcome"] = "speech";
  let stopReason: VadStopReason = "stopped_by_silence";
  let measuredNoiseFloor = 0;
  let usedThreshold = 0.03;
  let recordingStartedAt = clickAt;

  setMicWarmState({ streamStatus: "recording" });
  try {
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => reject(new Error("Microphone recording failed."));
      recorder.onstop = () => resolve();
    });

    recorder.start();
    recordingStartedAt = Date.now();

    // Hard safety cap (not the normal stop).
    stopTimer = window.setTimeout(() => {
      if (recorder.state !== "inactive") {
        vadOutcome = speechDetectedAt === null ? "no_speech" : "max_recording";
        stopReason = speechDetectedAt === null ? "no_speech" : "stopped_by_max_recording";
        recorder.stop();
      }
    }, maxRecordingMs);

    if (vadEnabled) {
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      // Baseline noise floor: calibrated value (vadMode manual / adaptive off) or
      // measured from the first ~6 frames of ambient noise.
      const configuredThreshold = (settings.vadMode === "manual" && typeof settings.silenceThreshold === "number") ? settings.silenceThreshold : null;
      const presetFloor = (settings.vadMode === "manual" || settings.adaptiveSilenceThreshold === false) ? (settings.noiseFloor ?? 0) : 0;
      let autoFloor = presetFloor;
      let autoFrames = presetFloor > 0 ? 6 : 0;

      let speechMsAccum = 0;
      let quietSince: number | null = null;
      // Last frame with clearly loud/close speech (the "main speaker"). Used to
      // stop even when quieter background voices keep the level above threshold.
      let lastStrongSpeechAt: number | null = null;
      const frameMs = 60;

      const finishVad = () => {
        try { source.disconnect(); } catch { /* ignore */ }
        setVadLiveMeter({ state: vadOutcome === "no_speech" ? "stopped_by_silence" : stopReason === "stopped_by_silence" ? "stopped_by_silence" : "stopped_by_timeout" });
      };

      vadTimer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((total, value) => {
          const normalized = (value - 128) / 128;
          return total + normalized * normalized;
        }, 0) / data.length);

        if (autoFrames < 6) {
          autoFloor += rms;
          autoFrames += 1;
        }
        measuredNoiseFloor = autoFloor / Math.max(1, autoFrames);
        const threshold = configuredThreshold ?? Math.max(0.012, measuredNoiseFloor + margin);
        // "Strong"/close speech threshold (relative to the floor) — your speaking
        // voice resets the post-speech window each frame, so it only counts down
        // once you actually stop; quiet background voices stay under it.
        const strongThreshold = threshold + Math.max(0.02, threshold * (settings.mainSpeakerMode ? 1.4 : 0.6));
        usedThreshold = threshold;

        const now = Date.now();
        const elapsed = now - recordingStartedAt;
        // Live meter for diagnostics.
        setVadLiveMeter({ level: Number(rms.toFixed(4)), noiseFloor: Number(measuredNoiseFloor.toFixed(4)), speechThreshold: Number(threshold.toFixed(4)), state: speechDetectedAt === null ? "waiting" : (rms > threshold ? "speech_detected" : "silence") });

        if (rms > threshold) {
          speechMsAccum += frameMs;
          quietSince = null;
          if (rms > strongThreshold) {
            lastStrongSpeechAt = now;
          }
          if (speechDetectedAt === null && speechMsAccum >= minSpeechMs) {
            speechDetectedAt = now - recordingStartedAt;
            lastStrongSpeechAt = lastStrongSpeechAt ?? now;
          }
          // After the user's main speech, if only weak/background level remains
          // for longer than the post-speech window, stop (don't listen forever).
          if (speechDetectedAt !== null && lastStrongSpeechAt !== null && now - lastStrongSpeechAt > maxPostSpeechMs && recorder.state !== "inactive") {
            vadOutcome = "speech";
            stopReason = "stopped_by_post_speech_window";
            finishVad();
            recorder.stop();
          }
          return;
        }

        // Silence frame.
        if (speechDetectedAt === null) {
          // requireSpeechStart: cancel cleanly if no real speech began in time.
          if ((requireSpeechStart ? elapsed > initialSilenceMs : elapsed > initialSilenceMs) && recorder.state !== "inactive") {
            vadOutcome = "no_speech";
            stopReason = "no_speech";
            finishVad();
            recorder.stop();
          }
          return;
        }
        // Speech happened — stop after the end-silence window.
        quietSince ??= now;
        if (now - quietSince > endSilenceMs && recorder.state !== "inactive") {
          silenceStopDelayMs = now - quietSince;
          vadOutcome = "speech";
          stopReason = "stopped_by_silence";
          finishVad();
          recorder.stop();
        }
      }, frameMs);
    }

    await stopped;
  } finally {
    if (stopTimer !== null) {
      window.clearTimeout(stopTimer);
    }
    if (vadTimer !== null) {
      window.clearInterval(vadTimer);
    }
    setVadLiveMeter({ state: "idle" });
    // Keep the stream + AudioContext warm for the next mic click.
    setMicWarmState({ streamStatus: micWarm.stream ? "ready" : "unavailable" });
  }

  const blob = new Blob(chunks, { type: preferredMimeType });
  const buffer = await blob.arrayBuffer();
  // wake→recording-start latency when this capture was triggered by a wake word.
  const wakeToRecordingStartMs = lastWakeDetectedAtForMetric && (recordingStartedAt - lastWakeDetectedAtForMetric) >= 0 && (recordingStartedAt - lastWakeDetectedAtForMetric) < 10000
    ? recordingStartedAt - lastWakeDetectedAtForMetric
    : null;
  lastWakeDetectedAtForMetric = 0;
  const metrics: SpeechCaptureMetrics = {
    micClickToRecordingMs: recordingStartedAt - clickAt,
    recordingDurationMs: Date.now() - recordingStartedAt,
    speechDetectedAtMs: speechDetectedAt,
    silenceStopDelayMs,
    vadOutcome,
    stopReason,
    noiseFloor: Number(measuredNoiseFloor.toFixed(4)),
    speechThreshold: Number(usedThreshold.toFixed(4)),
    wakeToRecordingStartMs
  };
  lastSpeechCaptureMetrics = metrics;
  return {
    audioBytes: Array.from(new Uint8Array(buffer)),
    mimeType: blob.type || preferredMimeType,
    durationMs: metrics.recordingDurationMs,
    metrics
  };
}

async function runSharedSpeechCapture(options: {
  speechState: SpeechServiceState;
  source: string;
  sourceModule: string;
  manualOverride?: boolean;
}): Promise<SpeechTranscriptionResult & { metrics?: SpeechCaptureMetrics }> {
  if (options.speechState.performancePaused && options.manualOverride !== true) {
    return {
      transcript: "",
      engine: options.speechState.settings.speechEngine,
      model: options.speechState.settings.modelName,
      language: "en",
      durationMs: 0,
      status: "failed",
      error: "Speech paused by Performance Mode."
    };
  }
  const recorded = await recordSpeechAudio(options.speechState.settings);
  // Clean cancel when the user said nothing — never transcribe empty audio.
  if (recorded.metrics.vadOutcome === "no_speech") {
    return {
      transcript: "",
      engine: options.speechState.settings.speechEngine,
      model: options.speechState.settings.modelName,
      language: "en",
      durationMs: recorded.durationMs,
      status: "cancelled",
      error: "No speech detected.",
      metrics: recorded.metrics
    };
  }
  const transcriptionStartedAt = Date.now();
  const result = await getBridge().transcribeSpeech({
    audioBytes: recorded.audioBytes,
    mimeType: recorded.mimeType,
    source: options.source,
    sourceModule: options.sourceModule,
    language: "en",
    manualOverride: options.manualOverride
  });
  return {
    ...result,
    metrics: { ...recorded.metrics, transcriptionLatencyMs: Date.now() - transcriptionStartedAt }
  };
}

function VoiceInput({
  targetLabel,
  speechState,
  onTranscript,
  onAction,
  onBeforeDictation,
  onSpeechStateChanged
}: {
  targetLabel: string;
  speechState: SpeechServiceState;
  onTranscript: (text: string) => void;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onBeforeDictation?: () => void;
  onSpeechStateChanged?: (state: SpeechServiceState) => void;
}) {
  const [status, setStatus] = useState("Click mic to start DexNest local speech.");
  const [isListening, setIsListening] = useState(false);

  async function startDictation(): Promise<void> {
    onBeforeDictation?.();
    setIsListening(true);
    setStatus(speechState.performancePaused ? "Speech paused by Performance Mode." : "Recording locally...");

    try {
      const result = await runSharedSpeechCapture({ speechState, source: "module_ui", sourceModule: targetLabel });
      if (result.speechState) {
        onSpeechStateChanged?.(result.speechState);
      }
      if (result.status === "success" && result.transcript.trim()) {
        onTranscript(result.transcript.trim());
        setStatus(`Captured with ${result.engine} in ${result.durationMs} ms.`);
        void onAction("speech.transcribe", "module_ui", {
          targetLabel,
          engine: result.engine,
          model: result.model,
          transcriptLength: result.transcript.length,
          status: "success"
        });
        return;
      }
      throw new Error(result.error ?? "No speech was transcribed.");
    } catch (error) {
      if (!speechState.settings.fallbackToWindows) {
        setStatus(error instanceof Error ? error.message : "Voice input failed.");
        void onAction("speech.transcribe", "module_ui", { targetLabel, status: "failed" });
        return;
      }

      setStatus("Local speech failed. Starting Windows fallback...");
      const windowsResult = await getBridge().startWindowsDictation();
      if (windowsResult.ok) {
        setStatus("Windows dictation started. Speak now.");
        void onAction("voice.start_dictation_placeholder", "module_ui", { targetLabel, provider: "windows_dictation", result: "started" });
        window.setTimeout(() => {
          setIsListening(false);
          setStatus("Click mic to start DexNest local speech.");
        }, 2500);
        return;
      }
      setStatus(windowsResult.error ?? "Voice input failed.");
      void onAction("voice.start_dictation_placeholder", "module_ui", {
        targetLabel,
        supported: false,
        result: "failed",
        windowsError: windowsResult.error
      });
    } finally {
      setIsListening(false);
    }
  }

  return (
    <div className="voice-input accent-voice">
      <button type="button" disabled={isListening} onClick={() => void startDictation()}>{isListening ? "Listening" : "Mic"}</button>
      <span>{status}</span>
    </div>
  );
}

function JournalView({
  journalState,
  calendarState,
  speechState,
  onSpeechStateChange,
  journalVoice,
  onStartJournalVoice,
  onPauseJournalVoice,
  onResumeJournalVoice,
  onSaveStopJournalVoice,
  onCancelJournalVoice,
  onAction,
  onRefresh
}: {
  journalState: JournalState;
  calendarState: CalendarState;
  speechState: SpeechServiceState;
  onSpeechStateChange: (state: SpeechServiceState) => void;
  journalVoice: JournalVoiceState;
  onStartJournalVoice: (source?: string) => Promise<void>;
  onPauseJournalVoice: () => void;
  onResumeJournalVoice: () => void;
  onSaveStopJournalVoice: () => Promise<void>;
  onCancelJournalVoice: (skipConfirm?: boolean) => Promise<void>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    entry?: JournalEntry;
    candidates?: ExtractedCalendarCandidate[];
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [entryId, setEntryId] = useState<string | undefined>(journalState.todayEntry?.id);
  const [date, setDate] = useState(journalState.today);
  const [title, setTitle] = useState(journalState.todayEntry?.title ?? "");
  const [rawText, setRawText] = useState(journalState.todayEntry?.rawText ?? "");
  const [mood, setMood] = useState(journalState.todayEntry?.mood ?? "");
  const [productivity, setProductivity] = useState(journalState.todayEntry?.productivity ?? "");
  const [tags, setTags] = useState(journalState.todayEntry?.tags.join(", ") ?? "");
  const [peopleTags, setPeopleTags] = useState(journalState.todayEntry?.peopleTags.join(", ") ?? "");
  const [mode, setMode] = useState<"one-line" | "full">("full");
  const [candidates, setCandidates] = useState<ExtractedCalendarCandidate[]>(journalState.todayEntry?.extractedItems ?? []);
  const [status, setStatus] = useState("");
  const journalTextRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!entryId && journalState.todayEntry) {
      loadEntry(journalState.todayEntry);
    }
  }, [journalState.todayEntry]);

  // While journal voice mode is active, mirror each auto-saved chunk into the editor.
  useEffect(() => {
    if (journalVoice.mode === "journal_dictation" && journalState.todayEntry) {
      loadEntry(journalState.todayEntry);
    }
  }, [journalVoice.lastSavedAt, journalVoice.mode]);

  function loadEntry(entry: JournalEntry): void {
    setEntryId(entry.id);
    setDate(entry.date);
    setTitle(entry.title ?? "");
    setRawText(entry.rawText);
    setMood(entry.mood ?? "");
    setProductivity(entry.productivity ?? "");
    setTags(entry.tags.join(", "));
    setPeopleTags(entry.peopleTags.join(", "));
    setCandidates(entry.extractedItems);
  }

  function entryPayload() {
    return { id: entryId, date, title, rawText, mood, productivity, tags, peopleTags };
  }

  async function saveEntry(): Promise<void> {
    const result = await onAction(entryId ? "journal.update_entry" : "journal.create_entry", "module_ui", entryPayload());
    if (result.ok && result.entry) {
      setEntryId(result.entry.id);
      setCandidates(result.entry.extractedItems);
      setStatus("Journal entry saved. Review extracted Calendar candidates before adding.");
      await onRefresh();
    } else {
      setStatus(result.error ?? "Journal save failed.");
    }
  }

  async function extractEvents(): Promise<void> {
    const result = await onAction("journal.extract_events", "module_ui", { entryId, date, rawText });
    if (result.ok) {
      setCandidates(result.candidates ?? []);
      setStatus(`${result.candidates?.length ?? 0} candidates extracted.`);
    } else {
      setStatus(result.error ?? "Event extraction failed.");
    }
  }

  async function addCandidate(candidate: ExtractedCalendarCandidate): Promise<void> {
    const result = await getBridge().runAction({
      actionId: "calendar.create_event",
      source: "module_ui",
      params: {
        title: candidate.title,
        date: candidate.date,
        allDay: candidate.allDay,
        sourceModule: "journal",
        sourceId: entryId ?? null,
        recurrence: candidate.recurrence,
        reminderLevel: candidate.type === "reminder" ? "normal" : "soft",
        notes: `From Journal candidate: ${candidate.type}`
      }
    });
    setStatus(result.ok ? "Calendar event added." : result.error ?? "Could not add event.");
    await onRefresh();
  }

  function candidateAlreadyAdded(candidate: ExtractedCalendarCandidate): boolean {
    return calendarState.events.some((event) =>
      event.sourceModule === "journal"
      && event.sourceId === entryId
      && event.date === candidate.date
      && event.title.trim().toLowerCase() === candidate.title.trim().toLowerCase()
    );
  }

  async function deleteEntry(entry: JournalEntry): Promise<void> {
    if (!window.confirm("Delete this Journal entry?")) {
      return;
    }
    const result = await onAction("journal.delete_entry", "module_ui", { entryId: entry.id, confirmedDangerous: true });
    setStatus(result.ok ? "Journal entry deleted." : result.error ?? "Delete failed.");
    if (entryId === entry.id) {
      setEntryId(undefined);
      setRawText("");
      setTitle("");
      setCandidates([]);
    }
    await onRefresh();
  }

  const journalVoiceActive = journalVoice.mode === "journal_dictation";
  return (
    <section className="view-stack accent-journal" aria-labelledby="journal-title">
      <PageHeader eyebrow="Private local capture" title="Journal" titleId="journal-title" />

      <Panel title="Journal Voice Mode">
        <div className="journal-voice" data-active={journalVoiceActive} data-status={journalVoice.status}>
          <div className="section-heading section-heading--row">
            <div>
              <p>
                {speechState.performancePaused
                  ? "Speech is paused by Performance Mode."
                  : journalVoiceActive
                    ? (journalVoice.status === "paused" ? "Journal mode paused." : "Journal mode listening. Say “save journal” to finish.")
                    : "Dictate your journal continuously. DexNest appends each chunk and auto-saves."}
              </p>
              <p className="technical">
                status: {journalVoice.status} · chunks: {journalVoice.chunksCount}
                {journalVoice.lastSavedAt ? ` · saved ${formatLocalDateTime(new Date(journalVoice.lastSavedAt).toISOString())}` : ""}
                {journalVoice.error ? ` · ${journalVoice.error}` : ""}
              </p>
            </div>
          </div>
          <div className="button-row">
            {!journalVoiceActive ? (
              <button type="button" disabled={speechState.performancePaused} onClick={() => void onStartJournalVoice("module_ui")}>Start Journal Mode</button>
            ) : (
              <>
                {journalVoice.status === "paused"
                  ? <button type="button" disabled={speechState.performancePaused} onClick={() => onResumeJournalVoice()}>Resume</button>
                  : <button type="button" onClick={() => onPauseJournalVoice()}>Pause</button>}
                <button type="button" onClick={() => void onSaveStopJournalVoice()}>Save &amp; Stop</button>
                <button type="button" onClick={() => void onCancelJournalVoice()}>Cancel</button>
              </>
            )}
          </div>
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel title="Today's Entry">
          <div className="registry-controls">
            <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional title" /></label>
            <label>Mode<select value={mode} onChange={(event) => setMode(event.target.value as "one-line" | "full")}><option value="full">Full entry</option><option value="one-line">One-line mode</option></select></label>
          </div>
          <VoiceInput
            targetLabel="Journal entry"
            speechState={speechState}
            onSpeechStateChanged={onSpeechStateChange}
            onAction={onAction}
            onBeforeDictation={() => journalTextRef.current?.focus()}
            onTranscript={(text) => setRawText((current) => `${current}${current ? " " : ""}${text}`)}
          />
          <textarea
            ref={journalTextRef}
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder={mode === "one-line" ? "One line about today" : "Brain dump, shutdown notes, reminders, meetings, birthdays"}
            rows={mode === "one-line" ? 3 : 9}
          />
          <div className="registry-controls">
            <label>Mood<input value={mood} onChange={(event) => setMood(event.target.value)} placeholder="calm, stressed, focused" /></label>
            <label>Productivity<input value={productivity} onChange={(event) => setProductivity(event.target.value)} placeholder="low, medium, high" /></label>
            <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="work, school" /></label>
            <label>People tags<input value={peopleTags} onChange={(event) => setPeopleTags(event.target.value)} placeholder="Arjun, Maya" /></label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void saveEntry()}>Save entry</button>
            <button type="button" onClick={() => void extractEvents()}>Extract events</button>
          </div>
          {status && <p>{status}</p>}
        </Panel>

        <Panel title="Daily Shutdown Assistant">
          <p>Rule-based prompts only for v1.</p>
          <div className="data-list">
            <article className="data-item data-item--stacked"><strong>Close loops</strong><span>Write what changed, what is pending, and what needs a Calendar reminder.</span></article>
            <article className="data-item data-item--stacked"><strong>Tomorrow</strong><span>Use phrases like tomorrow, in 3 days, next Friday, on July 8.</span></article>
            <article className="data-item data-item--stacked"><strong>Calendar today</strong><span>{calendarState.todayEvents.length} local event{calendarState.todayEvents.length === 1 ? "" : "s"} today.</span></article>
          </div>
        </Panel>
      </div>

      <Panel title="Extracted Calendar Candidates">
        <div className="action-list">
          {candidates.length === 0 ? (
            <p>No candidates yet. Save or extract from text with meeting, appointment, call, birthday, or remind me.</p>
          ) : (
            candidates.map((candidate) => (
              <article className="action-row accent-calendar" key={candidate.id}>
                <div>
                  <h3>{candidate.title}</h3>
                  <p>{formatLocalDate(candidate.date)} / {candidate.type} / {candidate.allDay ? "all-day" : "timed later"}</p>
                  <p>{candidate.sourceSentence}</p>
                </div>
                <div>
                  <button
                    type="button"
                    disabled={candidateAlreadyAdded(candidate)}
                    onClick={() => void addCandidate(candidate)}
                  >
                    {candidateAlreadyAdded(candidate) ? "Added" : "Add"}
                  </button>
                  <button type="button" onClick={() => setCandidates((current) => current.filter((item) => item.id !== candidate.id))}>Skip</button>
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>

      <Panel title="Entry List">
        <div className="action-list">
          {journalState.entries.length === 0 ? (
            <p>No Journal entries yet.</p>
          ) : (
            journalState.entries.map((entry) => (
              <CollapsibleListItem
                accentClass="accent-journal"
                key={entry.id}
                title={entry.title || formatLocalDate(entry.date)}
                meta={`${formatLocalDate(entry.date)} / mood: ${entry.mood || "unset"} / productivity: ${entry.productivity || "unset"}`}
                actions={(
                  <>
                  <button type="button" onClick={() => loadEntry(entry)}>Edit</button>
                  <button className="danger-button" type="button" onClick={() => void deleteEntry(entry)}>Delete</button>
                  </>
                )}
              >
                <p>{entry.cleanedText?.slice(0, 280) || "No text"}</p>
                <p className="technical">{entry.id}</p>
              </CollapsibleListItem>
            ))
          )}
        </div>
      </Panel>

      <Panel title="On this day">
        <p>Placeholder for future local memory recall. No background indexing or AI is running.</p>
      </Panel>
    </section>
  );
}

function CalendarView({
  calendarState,
  speechState,
  voiceWorkflow,
  voiceWorkflowSettings,
  onSpeechStateChange,
  onCalendarCandidateChange,
  onConfirmCalendarCandidate,
  onCancelCalendarCandidate,
  onVoiceWorkflowSettingsChange,
  onAction,
  onRefresh
}: {
  calendarState: CalendarState;
  speechState: SpeechServiceState;
  voiceWorkflow: VoiceWorkflowState;
  voiceWorkflowSettings: VoiceWorkflowSettings;
  onSpeechStateChange: (state: SpeechServiceState) => void;
  onCalendarCandidateChange: (patch: Partial<CalendarVoiceCandidate>) => void;
  onConfirmCalendarCandidate: () => Promise<void>;
  onCancelCalendarCandidate: () => void;
  onVoiceWorkflowSettingsChange: (settings: Partial<VoiceWorkflowSettings>) => Promise<void>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{ ok: boolean; error?: string; event?: CalendarEvent; calendarState?: CalendarState }>;
  onRefresh: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(calendarState.today);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [reminderLevel, setReminderLevel] = useState<"soft" | "normal" | "urgent">("normal");
  const [recurrence, setRecurrence] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => calendarState.today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(calendarState.today);
  const [nudgeSettingsForm, setNudgeSettingsForm] = useState({
    enabled: calendarState.nudgeSettings.enabled,
    vaultExpiryReminderDays: calendarState.nudgeSettings.vaultExpiryReminderDays.join(", "),
    returnReminderDays: calendarState.nudgeSettings.returnReminderDays.join(", "),
    dailyJournalReminderEnabled: calendarState.nudgeSettings.dailyJournalReminderEnabled,
    backupReminderAfterDays: String(calendarState.nudgeSettings.backupReminderAfterDays)
  });
  const calendarTitleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setNudgeSettingsForm({
      enabled: calendarState.nudgeSettings.enabled,
      vaultExpiryReminderDays: calendarState.nudgeSettings.vaultExpiryReminderDays.join(", "),
      returnReminderDays: calendarState.nudgeSettings.returnReminderDays.join(", "),
      dailyJournalReminderEnabled: calendarState.nudgeSettings.dailyJournalReminderEnabled,
      backupReminderAfterDays: String(calendarState.nudgeSettings.backupReminderAfterDays)
    });
  }, [calendarState.nudgeSettings]);

  const monthDate = parseLocalDateInput(`${visibleMonth}-01`);
  const monthLabel = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const calendarVoiceCandidate = voiceWorkflow.mode === "calendar_create" ? voiceWorkflow.calendarCandidate : null;
  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(monthDate);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      const value = toLocalDateInputValue(day);
      return {
        value,
        label: String(day.getDate()),
        inMonth: value.startsWith(visibleMonth),
        isToday: value === calendarState.today,
        events: calendarState.events.filter((event) => event.date === value)
      };
    });
  }, [calendarState.events, calendarState.today, visibleMonth]);
  const selectedDateEvents = calendarState.events.filter((event) => event.date === selectedDate);

  function shiftMonth(offset: number): void {
    const next = new Date(monthDate);
    next.setMonth(next.getMonth() + offset);
    setVisibleMonth(toLocalDateInputValue(next).slice(0, 7));
  }

  function goToToday(): void {
    setVisibleMonth(calendarState.today.slice(0, 7));
    setSelectedDate(calendarState.today);
    setDate(calendarState.today);
  }

  function selectCalendarDate(value: string): void {
    setSelectedDate(value);
    setDate(value);
  }

  function loadEvent(event: CalendarEvent): void {
    setEditingId(event.id);
    setTitle(event.title);
    setDate(event.date);
    setSelectedDate(event.date);
    setVisibleMonth(event.date.slice(0, 7));
    setStartTime(event.startTime ?? "");
    setEndTime(event.endTime ?? "");
    setAllDay(event.allDay);
    setReminderLevel(event.reminderLevel);
    setRecurrence(event.recurrence ?? "");
    setNotes(event.notes ?? "");
  }

  function loadVoiceCandidateForEdit(candidate: CalendarVoiceCandidate): void {
    setEditingId(undefined);
    setTitle(candidate.title);
    setDate(candidate.date);
    setSelectedDate(candidate.date);
    setVisibleMonth(candidate.date.slice(0, 7));
    setStartTime(candidate.startTime ?? "");
    setEndTime(candidate.endTime ?? "");
    setAllDay(candidate.allDay);
    setReminderLevel(candidate.reminderLevel);
    setRecurrence(candidate.recurrence ?? "");
    setNotes(candidate.notes);
  }

  function resetForm(): void {
    setEditingId(undefined);
    setTitle("");
    setDate(calendarState.today);
    setStartTime("");
    setEndTime("");
    setAllDay(false);
    setReminderLevel("normal");
    setRecurrence("");
    setNotes("");
  }

  async function saveEvent(): Promise<void> {
    const result = await onAction(editingId ? "calendar.update_event" : "calendar.create_event", "module_ui", {
      id: editingId,
      title,
      date,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      allDay,
      sourceModule: "calendar",
      recurrence: recurrence || null,
      reminderLevel,
      notes
    });
    setStatus(result.ok ? "Calendar event saved." : result.error ?? "Calendar save failed.");
    if (result.ok) {
      resetForm();
      await onRefresh();
    }
  }

  async function deleteEvent(event: CalendarEvent): Promise<void> {
    if (!window.confirm("Delete this Calendar event?")) {
      return;
    }
    const result = await onAction("calendar.delete_event", "module_ui", { eventId: event.id, confirmedDangerous: true });
    setStatus(result.ok ? "Calendar event deleted." : result.error ?? "Delete failed.");
    await onRefresh();
  }

  async function runNudgeAction(actionId: string, nudge: Nudge, params: Record<string, unknown> = {}): Promise<void> {
    const result = await onAction(actionId, "module_ui", { nudgeId: nudge.id, ...params });
    setStatus(result.ok ? "Nudge updated." : result.error ?? "Nudge action failed.");
    await onRefresh();
  }

  async function refreshNudgeList(): Promise<void> {
    const result = await onAction("calendar.nudge.refresh", "module_ui");
    setStatus(result.ok ? "Nudges refreshed." : result.error ?? "Nudge refresh failed.");
    await onRefresh();
  }

  function parseDayList(value: string): number[] {
    return value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0)
      .sort((left, right) => right - left);
  }

  async function saveNudgeSettings(): Promise<void> {
    const result = await onAction("calendar.nudge.update_settings", "module_ui", {
      nudgeSettings: {
        enabled: nudgeSettingsForm.enabled,
        vaultExpiryReminderDays: parseDayList(nudgeSettingsForm.vaultExpiryReminderDays),
        returnReminderDays: parseDayList(nudgeSettingsForm.returnReminderDays),
        dailyJournalReminderEnabled: nudgeSettingsForm.dailyJournalReminderEnabled,
        backupReminderAfterDays: Number(nudgeSettingsForm.backupReminderAfterDays) || 7
      }
    });
    setStatus(result.ok ? "Nudge settings saved." : result.error ?? "Nudge settings failed.");
    await onRefresh();
  }

  function renderNudge(nudge: Nudge) {
    return (
      <CollapsibleListItem
        accentClass="accent-calendar"
        key={nudge.id}
        title={nudge.title}
        meta={`${formatLocalDate(nudge.date)}${nudge.time ? ` / ${nudge.time}` : ""} / ${nudge.priority} / ${nudge.sourceModule}`}
        actions={(
          <>
          <button type="button" onClick={() => void runNudgeAction("calendar.nudge.open_source", nudge)}>Open source</button>
          <button type="button" onClick={() => void runNudgeAction("calendar.nudge.snooze", nudge, { snoozeMinutes: 60 })}>Snooze</button>
          <button type="button" onClick={() => void runNudgeAction("calendar.nudge.complete", nudge)}>Done</button>
          <button type="button" onClick={() => void runNudgeAction("calendar.nudge.dismiss", nudge)}>Dismiss</button>
          </>
        )}
      >
        <p>{nudge.message}</p>
        <p className="technical">{nudge.id}</p>
        {nudge.snoozeUntil && <p>Snoozed until {formatLocalDateTime(nudge.snoozeUntil)}</p>}
      </CollapsibleListItem>
    );
  }

  function renderEvent(event: CalendarEvent) {
    return (
      <CollapsibleListItem
        accentClass="accent-calendar"
        key={event.id}
        title={event.title}
        meta={`${formatLocalDate(event.date)} / ${event.allDay ? "all-day" : `${event.startTime || "no start"} ${event.endTime ? `to ${event.endTime}` : ""}`} / ${event.reminderLevel}`}
        actions={(
          <>
          <button type="button" onClick={() => loadEvent(event)}>Edit</button>
          <button className="danger-button" type="button" onClick={() => void deleteEvent(event)}>Delete</button>
          </>
        )}
      >
        <p>{event.sourceModule}{event.recurrence ? ` / ${event.recurrence}` : ""}</p>
        <p className="technical">{event.id}</p>
      </CollapsibleListItem>
    );
  }

  return (
    <section className="view-stack accent-calendar" aria-labelledby="calendar-title">
      <PageHeader
        eyebrow="Local schedule"
        title="Calendar"
        titleId="calendar-title"
        actions={(
          <>
          <button type="button" onClick={() => shiftMonth(-1)}>Previous</button>
          <button type="button" onClick={goToToday}>Today</button>
          <button type="button" onClick={() => shiftMonth(1)}>Next</button>
          <button type="button" onClick={() => void refreshNudgeList()}>Refresh nudges</button>
          </>
        )}
      />

      {calendarVoiceCandidate && (
        <Panel title="Voice Calendar Candidate">
          <div className="status-grid">
            <article>
              <span>Status</span>
              <strong>{voiceWorkflow.status === "saving" ? "Saving" : voiceWorkflow.status === "saved" ? "Saved" : "Review"}</strong>
              <p>{voiceWorkflow.error || "Ctrl/typed/push-to-talk calendar command routed locally."}</p>
            </article>
            <article>
              <span>Confidence</span>
              <strong>{calendarVoiceCandidate.confidence}</strong>
              <p>{calendarVoiceCandidate.missingFields.length ? `Missing ${calendarVoiceCandidate.missingFields.join(", ")}` : "Ready to add."}</p>
            </article>
            <article>
              <span>Type</span>
              <strong>{calendarVoiceCandidate.eventType}</strong>
              <p>{calendarVoiceCandidate.sensitivity === "sensitive" ? "Source phrase hidden for privacy." : calendarVoiceCandidate.sourcePhrasePreview || "No source preview."}</p>
            </article>
          </div>
          <div className="registry-controls">
            <label>Title<input value={calendarVoiceCandidate.title} onChange={(event) => onCalendarCandidateChange({ title: event.target.value })} /></label>
            <label>Date<input type="date" value={calendarVoiceCandidate.date} onChange={(event) => onCalendarCandidateChange({ date: event.target.value })} /></label>
            <label>Start<input type="time" value={calendarVoiceCandidate.startTime ?? ""} disabled={calendarVoiceCandidate.allDay} onChange={(event) => onCalendarCandidateChange({ startTime: event.target.value || null, endTime: event.target.value ? addMinutesToTime(event.target.value, voiceWorkflowSettings.defaultMeetingDurationMinutes || 30) : null })} /></label>
            <label>End<input type="time" value={calendarVoiceCandidate.endTime ?? ""} disabled={calendarVoiceCandidate.allDay} onChange={(event) => onCalendarCandidateChange({ endTime: event.target.value || null })} /></label>
            <label>Reminder<select value={calendarVoiceCandidate.reminderLevel} onChange={(event) => onCalendarCandidateChange({ reminderLevel: event.target.value as "soft" | "normal" | "urgent" })}><option value="soft">soft</option><option value="normal">normal</option><option value="urgent">urgent</option></select></label>
            <label>Recurrence<input value={calendarVoiceCandidate.recurrence ?? ""} onChange={(event) => onCalendarCandidateChange({ recurrence: event.target.value || null })} placeholder="yearly-placeholder" /></label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={calendarVoiceCandidate.allDay} onChange={(event) => onCalendarCandidateChange({ allDay: event.target.checked })} />
            <span>All-day event or birthday</span>
          </label>
          <textarea value={calendarVoiceCandidate.notes} onChange={(event) => onCalendarCandidateChange({ notes: event.target.value })} placeholder="Calendar notes" />
          <div className="button-row">
            <button type="button" className="button-primary" disabled={voiceWorkflow.status === "saving"} onClick={() => void onConfirmCalendarCandidate()}>{voiceWorkflow.status === "saving" ? "Saving..." : "Add event"}</button>
            <button type="button" onClick={() => loadVoiceCandidateForEdit(calendarVoiceCandidate)}>Edit in form</button>
            <button type="button" className="danger-button" onClick={onCancelCalendarCandidate}>Cancel</button>
          </div>
        </Panel>
      )}

      <div className="calendar-shell">
        <Panel title={monthLabel}>
          <div className="calendar-grid" aria-label={`${monthLabel} calendar`}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div className="calendar-weekday" key={day}>{day}</div>
            ))}
            {calendarDays.map((day) => (
              <button
                className="calendar-day"
                data-current-month={day.inMonth}
                data-selected={day.value === selectedDate}
                data-today={day.isToday}
                key={day.value}
                type="button"
                onClick={() => selectCalendarDate(day.value)}
              >
                <span>{day.label}</span>
                <div>
                  {day.events.slice(0, 3).map((event) => (
                    <small key={event.id}>{event.allDay ? "" : event.startTime ? `${event.startTime} ` : ""}{event.title}</small>
                  ))}
                  {day.events.length > 3 && <small>+{day.events.length - 3} more</small>}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Create Event">
          <VoiceInput
            targetLabel="Calendar event"
            speechState={speechState}
            onSpeechStateChanged={onSpeechStateChange}
            onAction={onAction}
            onBeforeDictation={() => calendarTitleRef.current?.focus()}
            onTranscript={(text) => setTitle((current) => `${current}${current ? " " : ""}${text}`)}
          />
          <div className="registry-controls">
            <label>Title<input ref={calendarTitleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Birthday, meeting, call" /></label>
            <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>Start<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={allDay} /></label>
            <label>End<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={allDay} /></label>
            <label>Reminder<select value={reminderLevel} onChange={(event) => setReminderLevel(event.target.value as "soft" | "normal" | "urgent")}><option value="soft">soft</option><option value="normal">normal</option><option value="urgent">urgent</option></select></label>
            <label>Recurrence<input value={recurrence} onChange={(event) => setRecurrence(event.target.value)} placeholder="yearly placeholder" /></label>
          </div>
          <label className="checkbox-row"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /> All-day event or birthday</label>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" />
          <div className="button-row">
            <button type="button" onClick={() => void saveEvent()}>{editingId ? "Update event" : "Create event"}</button>
            <button type="button" onClick={resetForm}>Reset</button>
          </div>
          {status && <p>{status}</p>}
        </Panel>
      </div>

      <Panel title="Voice Calendar Settings">
        <div className="registry-controls">
          <label className="checkbox-row">
            <input type="checkbox" checked={voiceWorkflowSettings.autoCreateHighConfidenceCalendarVoiceEvents} onChange={(event) => void onVoiceWorkflowSettingsChange({ autoCreateHighConfidenceCalendarVoiceEvents: event.target.checked })} />
            <span>Auto-create high-confidence voice calendar events</span>
          </label>
          <label>
            Default duration
            <input type="number" min="5" step="5" value={voiceWorkflowSettings.defaultMeetingDurationMinutes} onChange={(event) => void onVoiceWorkflowSettingsChange({ defaultMeetingDurationMinutes: Number(event.target.value) || 30 })} />
          </label>
          <label>
            Default reminder time
            <input type="time" value={voiceWorkflowSettings.defaultReminderTime} onChange={(event) => void onVoiceWorkflowSettingsChange({ defaultReminderTime: event.target.value || "09:00" })} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={voiceWorkflowSettings.askBeforeRecurringEvents} onChange={(event) => void onVoiceWorkflowSettingsChange({ askBeforeRecurringEvents: event.target.checked })} />
            <span>Ask before recurring events like birthdays</span>
          </label>
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel title={`Selected Day: ${formatLocalDate(selectedDate)}`}>
            <div className="action-list action-list--compact">
              {selectedDateEvents.length === 0 ? <p>No events on this day.</p> : selectedDateEvents.map(renderEvent)}
            </div>
          </Panel>
          <Panel title="Today">
            <div className="action-list action-list--compact">
              {calendarState.todayEvents.length === 0 ? <p>No local events today.</p> : calendarState.todayEvents.map(renderEvent)}
            </div>
          </Panel>
        </div>

      <div className="dashboard-grid">
        <Panel title="Today Nudges">
          <div className="action-list action-list--compact">
            {calendarState.todayNudges.length === 0 ? <EmptyState>No nudges due today.</EmptyState> : calendarState.todayNudges.map(renderNudge)}
          </div>
        </Panel>
        <Panel title="Urgent Nudges">
          <div className="action-list action-list--compact">
            {calendarState.urgentNudges.length === 0 ? <EmptyState>No urgent nudges.</EmptyState> : calendarState.urgentNudges.map(renderNudge)}
          </div>
        </Panel>
      </div>

      <Panel title="Upcoming Nudges">
        <div className="action-list">
          {calendarState.upcomingNudges.length === 0 ? <EmptyState>No upcoming nudges.</EmptyState> : calendarState.upcomingNudges.map(renderNudge)}
        </div>
      </Panel>

      <Panel title="Upcoming">
        <div className="action-list">
          {calendarState.upcomingEvents.length === 0 ? <p>No upcoming local events.</p> : calendarState.upcomingEvents.map(renderEvent)}
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel title="Free Time Finder">
          <p>Placeholder for a future local-only availability helper.</p>
        </Panel>
        <Panel title="Travel Buffer">
          <p>Placeholder. No external maps or cloud calls.</p>
        </Panel>
        <Panel title="Nudge Settings">
          <div className="registry-controls">
            <label className="checkbox-row">
              <input type="checkbox" checked={nudgeSettingsForm.enabled} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>Enable nudges</span>
            </label>
            <label>
              Vault expiry days
              <input value={nudgeSettingsForm.vaultExpiryReminderDays} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, vaultExpiryReminderDays: event.target.value }))} placeholder="90, 30, 7" />
            </label>
            <label>
              Return reminder days
              <input value={nudgeSettingsForm.returnReminderDays} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, returnReminderDays: event.target.value }))} placeholder="7, 3, 1" />
            </label>
            <label>
              Backup reminder after days
              <input type="number" min="1" value={nudgeSettingsForm.backupReminderAfterDays} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, backupReminderAfterDays: event.target.value }))} />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={nudgeSettingsForm.dailyJournalReminderEnabled} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, dailyJournalReminderEnabled: event.target.checked }))} />
            <span>Daily Journal reminder</span>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void saveNudgeSettings()}>Save nudge settings</button>
            <button type="button" onClick={() => void refreshNudgeList()}>Refresh nudges</button>
          </div>
          <p className="technical">{calendarState.nudgesPath}</p>
        </Panel>
      </div>
    </section>
  );
}

const emptyFinderForm = {
  id: "",
  itemName: "",
  location: "",
  room: "",
  container: "",
  notes: "",
  tags: "",
  status: "at_home" as FinderItemStatus,
  lentTo: "",
  confidence: "sure" as FinderItemConfidence
};

function FinderView({
  finderState,
  speechState,
  voiceWorkflow,
  onSpeechStateChange,
  onSaveVoiceCandidate,
  onCancelVoiceCandidate,
  onAction,
  onRefresh
}: {
  finderState: FinderState;
  speechState: SpeechServiceState;
  voiceWorkflow: VoiceWorkflowState;
  onSpeechStateChange: (state: SpeechServiceState) => void;
  onSaveVoiceCandidate: () => Promise<void>;
  onCancelVoiceCandidate: () => void;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState(emptyFinderForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FinderItemStatus | "all">("all");
  const [reverseQuery, setReverseQuery] = useState("");
  const [moveItemId, setMoveItemId] = useState("");
  const [moveLocation, setMoveLocation] = useState("");
  const [moveRoom, setMoveRoom] = useState("");
  const [moveContainer, setMoveContainer] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const visibleItems = finderState.items.filter((item) => {
    const query = searchQuery.trim().toLowerCase();
    const statusMatches = statusFilter === "all" || item.status === statusFilter;
    const textMatches = !query || [
      item.itemName,
      item.location,
      item.room ?? "",
      item.container ?? "",
      item.tags.join(" ")
    ].join(" ").toLowerCase().includes(query);
    return statusMatches && textMatches;
  });
  const reverseItems = finderState.items.filter((item) => {
    const query = reverseQuery.trim().toLowerCase();
    return Boolean(query) && [item.location, item.room ?? "", item.container ?? ""].join(" ").toLowerCase().includes(query);
  });
  const lentOutItems = finderState.items.filter((item) => item.status === "lent_out");

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    setToast({ message, tone });
    window.setTimeout(() => {
      setToast((current) => current?.message === message ? null : current);
    }, 3000);
  }

  function loadItem(item: FinderItem): void {
    setForm({
      id: item.id,
      itemName: item.itemName,
      location: item.location,
      room: item.room ?? "",
      container: item.container ?? "",
      notes: item.notes ?? "",
      tags: item.tags.join(", "),
      status: item.status,
      lentTo: item.lentTo ?? "",
      confidence: item.confidence ?? "sure"
    });
  }

  function editVoiceCandidate(): void {
    const candidate = voiceWorkflow.candidate;
    if (!candidate) {
      return;
    }
    setForm({
      ...emptyFinderForm,
      itemName: candidate.itemName,
      location: candidate.location,
      room: candidate.room,
      container: candidate.container,
      notes: candidate.notes,
      confidence: candidate.confidence === "high" ? "sure" : "maybe"
    });
  }

  function formPayload() {
    return {
      id: form.id || undefined,
      itemName: form.itemName,
      location: form.location,
      room: form.room,
      container: form.container,
      notes: form.notes,
      tags: form.tags,
      status: form.status,
      lentTo: form.status === "lent_out" ? form.lentTo : null,
      confidence: form.confidence
    };
  }

  async function saveItem(): Promise<void> {
    const result = await onAction(form.id ? "finder.update_item" : "finder.create_item", "module_ui", formPayload());
    if (result.ok) {
      setForm(emptyFinderForm);
      showToast("Finder item saved.");
      await onRefresh();
    } else {
      showToast(result.error ?? "Finder save failed.", "error");
    }
  }

  async function deleteItem(item: FinderItem): Promise<void> {
    if (!window.confirm(`Delete ${item.itemName} from Finder?`)) {
      return;
    }
    const result = await onAction("finder.delete_item", "module_ui", { itemId: item.id, confirmedDangerous: true });
    showToast(result.ok ? "Finder item deleted." : result.error ?? "Delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function simpleItemAction(actionId: string, item: FinderItem, extra: Record<string, unknown> = {}): Promise<void> {
    const result = await onAction(actionId, "module_ui", { itemId: item.id, ...extra });
    showToast(result.ok ? "Finder item updated." : result.error ?? "Update failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function markLentOut(item: FinderItem): Promise<void> {
    const lentTo = window.prompt(`Who did you lend ${item.itemName} to?`, item.lentTo ?? "");
    if (lentTo === null) {
      return;
    }
    await simpleItemAction("finder.mark_lent_out", item, { lentTo });
  }

  async function markMoved(): Promise<void> {
    const item = finderState.items.find((entry) => entry.id === moveItemId);
    if (!item) {
      showToast("Choose an item to move.", "error");
      return;
    }
    const result = await onAction("finder.mark_moved", "module_ui", {
      itemId: item.id,
      newLocation: moveLocation,
      room: moveRoom,
      container: moveContainer
    });
    if (result.ok) {
      setMoveItemId("");
      setMoveLocation("");
      setMoveRoom("");
      setMoveContainer("");
    }
    showToast(result.ok ? "Finder item moved." : result.error ?? "Move failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function runSearchAudit(): Promise<void> {
    const result = await onAction("finder.search_items", "module_ui", { query: searchQuery, statusFilter });
    showToast(result.ok ? "Finder search logged." : result.error ?? "Search failed.", result.ok ? "success" : "error");
  }

  async function runReverseLookupAudit(): Promise<void> {
    const result = await onAction("finder.reverse_lookup", "module_ui", { query: reverseQuery });
    showToast(result.ok ? "Reverse lookup logged." : result.error ?? "Reverse lookup failed.", result.ok ? "success" : "error");
  }

  function renderItemCard(item: FinderItem) {
    return (
      <CollapsibleListItem
        accentClass="accent-finder"
        key={item.id}
        title={item.itemName}
        meta={`${item.location}${item.room ? ` / ${item.room}` : ""}${item.container ? ` / ${item.container}` : ""} / ${item.status}`}
        actions={(
          <>
          <button type="button" onClick={() => loadItem(item)}>Edit</button>
          <button type="button" onClick={() => {
            setMoveItemId(item.id);
            setMoveLocation(item.location);
            setMoveRoom(item.room ?? "");
            setMoveContainer(item.container ?? "");
          }}>Mark moved</button>
          <button type="button" onClick={() => void markLentOut(item)}>Mark lent out</button>
          <button type="button" onClick={() => void simpleItemAction("finder.mark_returned", item)}>Mark returned</button>
          <button type="button" onClick={() => void simpleItemAction("finder.archive_item", item)}>Archive</button>
          <button className="danger-button" type="button" onClick={() => void deleteItem(item)}>Delete</button>
          </>
        )}
      >
        <p>{item.tags.length ? item.tags.join(", ") : "No tags"}{item.lentTo ? ` / lent to ${item.lentTo}` : ""}</p>
        {item.notes && <p>{item.notes}</p>}
        <p>Updated {formatLocalDateTime(item.updatedAt)}</p>
        <p className="technical">{item.id}</p>
      </CollapsibleListItem>
    );
  }

  return (
    <section className="view-stack accent-finder" aria-labelledby="finder-title">
      <PageHeader eyebrow="Local item-location memory" title="Finder" titleId="finder-title" />

      <Panel title="Voice Add">
        <div className="status-grid">
          <article><span>Mode</span><strong>{voiceWorkflow.mode === "finder_add" ? "Finder add" : "Ready"}</strong><p>Say "passport is in black drawer" or "where is my passport" in Ask DexNest.</p></article>
          <article><span>Status</span><strong>{voiceWorkflow.mode === "finder_add" ? voiceWorkflow.status : "idle"}</strong><p>{voiceWorkflow.error || "High-confidence memories save automatically; uncertain ones appear here."}</p></article>
          <article><span>Confidence</span><strong>{voiceWorkflow.candidate?.confidence ?? "none"}</strong><p>{voiceWorkflow.lastTranscriptPreview || "No active Finder candidate."}</p></article>
        </div>
        {voiceWorkflow.candidate ? (
          <div className="data-item data-item--stacked accent-finder">
            <strong>Save {voiceWorkflow.candidate.itemName} in {voiceWorkflow.candidate.location}?</strong>
            <span>{voiceWorkflow.candidate.room || "no room"} / {voiceWorkflow.candidate.container || "no container"}</span>
            <div className="button-row">
              <button type="button" className="button-primary" onClick={() => void onSaveVoiceCandidate()}>Save</button>
              <button type="button" onClick={editVoiceCandidate}>Edit</button>
              <button type="button" className="danger-button" onClick={onCancelVoiceCandidate}>Cancel</button>
            </div>
          </div>
        ) : (
          <p>No Finder voice candidate waiting.</p>
        )}
      </Panel>

      <div className="dashboard-grid">
        <Panel title="Quick Add">
          <div className="project-form">
            <label>Item name<input value={form.itemName} onChange={(event) => setForm({ ...form, itemName: event.target.value })} placeholder="Passport" /></label>
            <label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="black drawer" /></label>
            <label>Room<input value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} placeholder="office" /></label>
            <label>Container<input value={form.container} onChange={(event) => setForm({ ...form, container: event.target.value })} placeholder="blue box" /></label>
            <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FinderItemStatus })}><option value="at_home">at_home</option><option value="lent_out">lent_out</option><option value="missing">missing</option><option value="archived">archived</option></select></label>
            <label>Confidence<select value={form.confidence} onChange={(event) => setForm({ ...form, confidence: event.target.value as FinderItemConfidence })}><option value="sure">sure</option><option value="maybe">maybe</option><option value="old">old</option></select></label>
            <label>Lent to<input value={form.lentTo} onChange={(event) => setForm({ ...form, lentTo: event.target.value })} placeholder="Raj" /></label>
            <label>Tags<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="travel, documents" /></label>
            <label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional private note" /></label>
          </div>
          <VoiceInput
            targetLabel="Finder"
            speechState={speechState}
            onSpeechStateChanged={onSpeechStateChange}
            onTranscript={(text) => setForm((current) => ({ ...current, notes: current.notes ? `${current.notes}\n${text}` : text }))}
            onAction={onAction}
          />
          <div className="button-row">
            <button type="button" onClick={() => void saveItem()}>{form.id ? "Update item" : "Save item"}</button>
            <button type="button" onClick={() => setForm(emptyFinderForm)}>Reset</button>
          </div>
        </Panel>

        <Panel title="I moved it">
          <div className="project-form">
            <label>Item<select value={moveItemId} onChange={(event) => setMoveItemId(event.target.value)}><option value="">Choose item</option>{finderState.items.map((item) => <option value={item.id} key={item.id}>{item.itemName}</option>)}</select></label>
            <label>New location<input value={moveLocation} onChange={(event) => setMoveLocation(event.target.value)} placeholder="suitcase" /></label>
            <label>Room<input value={moveRoom} onChange={(event) => setMoveRoom(event.target.value)} /></label>
            <label>Container<input value={moveContainer} onChange={(event) => setMoveContainer(event.target.value)} /></label>
          </div>
          <button type="button" onClick={() => void markMoved()}>Save move</button>
        </Panel>
      </div>

      <div className="dashboard-grid">
        <Panel title="Search Items">
          <div className="registry-controls">
            <label>Search<input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="passport, black drawer, blue box" /></label>
            <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FinderItemStatus | "all")}><option value="all">all</option><option value="at_home">at_home</option><option value="lent_out">lent_out</option><option value="missing">missing</option><option value="archived">archived</option></select></label>
          </div>
          <button type="button" onClick={() => void runSearchAudit()}>Log search</button>
          <p>{visibleItems.length} result{visibleItems.length === 1 ? "" : "s"}.</p>
        </Panel>

        <Panel title="Reverse Lookup">
          <label>
            Container or location
            <input value={reverseQuery} onChange={(event) => setReverseQuery(event.target.value)} placeholder="black drawer" />
          </label>
          <button type="button" onClick={() => void runReverseLookupAudit()}>Log reverse lookup</button>
          <div className="action-list action-list--compact">
            {reverseItems.length === 0 ? <p>No matching items yet.</p> : reverseItems.map((item) => (
              <article className="data-item data-item--stacked accent-finder" key={item.id}>
                <strong>{item.itemName}</strong>
                <span>{item.location}{item.container ? ` / ${item.container}` : ""}</span>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Item Library">
        <div className="action-list">
          {visibleItems.length === 0 ? <p>No Finder items match this search.</p> : visibleItems.map(renderItemCard)}
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel title="Lent Out">
          <div className="action-list action-list--compact">
            {lentOutItems.length === 0 ? <p>No lent-out items.</p> : lentOutItems.map((item) => (
              <article className="data-item data-item--stacked accent-finder" key={item.id}>
                <strong>{item.itemName}</strong>
                <span>{item.lentTo ? `Lent to ${item.lentTo}` : "Lent out"}</span>
                <button type="button" onClick={() => void simpleItemAction("finder.mark_returned", item)}>Mark returned</button>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title="Settings">
          <p className="technical">{finderState.itemsPath}</p>
          <p>{finderState.statusCounts.at_home} at home / {finderState.statusCounts.lent_out} lent out / {finderState.statusCounts.missing} missing / {finderState.statusCounts.archived} archived</p>
          <p>Photo path is a placeholder for a later local capture flow.</p>
        </Panel>
      </div>

      {toast && <ToastStack toasts={[{ id: toast.message, message: toast.message, tone: toast.tone }]} />}
    </section>
  );
}

const emptyFinanceTransactionForm = {
  id: "",
  date: getLocalTodayDateString(),
  store: "",
  amount: "",
  currency: "CAD",
  category: "Other",
  paymentType: "credit" as FinancePaymentType,
  cardName: "",
  notes: "",
  tags: "",
  receiptPath: "",
  returnDeadline: "",
  warrantyUntil: ""
};

const emptyFinanceRecurringForm = {
  id: "",
  name: "",
  amount: "",
  currency: "CAD",
  frequency: "monthly" as FinanceRecurringFrequency,
  nextDueDate: getLocalTodayDateString(),
  category: "Other",
  paymentType: "credit" as FinancePaymentType,
  notes: "",
  active: true
};

function FinanceView({
  financeState,
  onAction,
  onRefresh
}: {
  financeState: FinanceState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    financeState?: FinanceState;
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [transactionForm, setTransactionForm] = useState(emptyFinanceTransactionForm);
  const [recurringForm, setRecurringForm] = useState(emptyFinanceRecurringForm);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  }

  function money(amount: number, currency = "CAD"): string {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  }

  async function chooseReceipt(): Promise<void> {
    const files = await getBridge().selectFinanceReceipt();
    const receipt = files[0];
    if (receipt) {
      setTransactionForm((current) => ({ ...current, receiptPath: receipt.path }));
      showToast("Receipt selected.");
    }
  }

  function loadTransaction(transaction: FinanceTransaction): void {
    setTransactionForm({
      id: transaction.id,
      date: transaction.date,
      store: transaction.store,
      amount: String(transaction.amount),
      currency: transaction.currency,
      category: transaction.category,
      paymentType: transaction.paymentType,
      cardName: transaction.cardName ?? "",
      notes: transaction.notes ?? "",
      tags: transaction.tags.join(", "),
      receiptPath: "",
      returnDeadline: transaction.returnDeadline ?? "",
      warrantyUntil: transaction.warrantyUntil ?? ""
    });
  }

  async function saveTransaction(): Promise<void> {
    const result = await onAction(transactionForm.id ? "finance.update_transaction" : "finance.create_transaction", "module_ui", transactionForm);
    showToast(result.ok ? "Finance expense saved." : result.error ?? "Expense save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setTransactionForm(emptyFinanceTransactionForm);
      await onRefresh();
    }
  }

  async function deleteTransaction(transaction: FinanceTransaction): Promise<void> {
    if (!window.confirm(`Delete finance transaction for ${transaction.store}?`)) {
      return;
    }
    const result = await onAction("finance.delete_transaction", "module_ui", { transactionId: transaction.id, confirmedDangerous: true });
    showToast(result.ok ? "Finance transaction deleted." : result.error ?? "Delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function transactionAction(actionId: string, transaction: FinanceTransaction, successMessage: string): Promise<void> {
    const result = await onAction(actionId, "module_ui", { transactionId: transaction.id });
    showToast(result.ok ? successMessage : result.error ?? "Finance action failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  function loadRecurring(recurring: FinanceRecurringExpense): void {
    setRecurringForm({
      id: recurring.id,
      name: recurring.name,
      amount: String(recurring.amount),
      currency: recurring.currency,
      frequency: recurring.frequency,
      nextDueDate: recurring.nextDueDate,
      category: recurring.category,
      paymentType: recurring.paymentType,
      notes: recurring.notes ?? "",
      active: recurring.active
    });
  }

  async function saveRecurring(): Promise<void> {
    const result = await onAction(recurringForm.id ? "finance.update_recurring" : "finance.create_recurring", "module_ui", recurringForm);
    showToast(result.ok ? "Recurring expense saved." : result.error ?? "Recurring save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setRecurringForm(emptyFinanceRecurringForm);
      await onRefresh();
    }
  }

  async function deleteRecurring(recurring: FinanceRecurringExpense): Promise<void> {
    if (!window.confirm(`Delete recurring expense ${recurring.name}?`)) {
      return;
    }
    const result = await onAction("finance.delete_recurring", "module_ui", { recurringId: recurring.id, confirmedDangerous: true });
    showToast(result.ok ? "Recurring expense deleted." : result.error ?? "Delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function openReceipt(transaction: FinanceTransaction): Promise<void> {
    if (!transaction.receiptFilePath) {
      showToast("No receipt attached.", "error");
      return;
    }
    const result = await getBridge().openToolsFile(transaction.receiptFilePath);
    showToast(result.ok ? "Opened receipt." : result.error ?? "Open receipt failed.", result.ok ? "success" : "error");
  }

  const receiptTransactions = financeState.transactions.filter((transaction) => Boolean(transaction.receiptFilePath));

  return (
    <section className="view-stack accent-finance" aria-labelledby="finance-title">
      <PageHeader eyebrow="Manual local expenses and receipts" title="Finance" titleId="finance-title" />

      <div className="dashboard-grid">
        <Panel title="Add Expense">
          <div className="project-form">
            <label>Date<input type="date" value={transactionForm.date} onChange={(event) => setTransactionForm({ ...transactionForm, date: event.target.value })} /></label>
            <label>Store<input value={transactionForm.store} onChange={(event) => setTransactionForm({ ...transactionForm, store: event.target.value })} placeholder="Store or merchant" /></label>
            <label>Amount<input type="number" min="0" step="0.01" value={transactionForm.amount} onChange={(event) => setTransactionForm({ ...transactionForm, amount: event.target.value })} /></label>
            <label>Currency<input value={transactionForm.currency} onChange={(event) => setTransactionForm({ ...transactionForm, currency: event.target.value })} /></label>
            <label>Category<input value={transactionForm.category} onChange={(event) => setTransactionForm({ ...transactionForm, category: event.target.value })} placeholder="Groceries, tech, rent" /></label>
            <label>Payment type<select value={transactionForm.paymentType} onChange={(event) => setTransactionForm({ ...transactionForm, paymentType: event.target.value as FinancePaymentType })}><option value="cash">cash</option><option value="debit">debit</option><option value="credit">credit</option><option value="e_transfer">e_transfer</option><option value="other">other</option></select></label>
            <label>Card name<input value={transactionForm.cardName} onChange={(event) => setTransactionForm({ ...transactionForm, cardName: event.target.value })} placeholder="Optional" /></label>
            <label>Tags<input value={transactionForm.tags} onChange={(event) => setTransactionForm({ ...transactionForm, tags: event.target.value })} placeholder="returnable, warranty" /></label>
            <label>Return deadline<input type="date" value={transactionForm.returnDeadline} onChange={(event) => setTransactionForm({ ...transactionForm, returnDeadline: event.target.value })} /></label>
            <label>Warranty until<input type="date" value={transactionForm.warrantyUntil} onChange={(event) => setTransactionForm({ ...transactionForm, warrantyUntil: event.target.value })} /></label>
            <label>Notes<textarea value={transactionForm.notes} onChange={(event) => setTransactionForm({ ...transactionForm, notes: event.target.value })} placeholder="Private notes stay out of Audit." /></label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void chooseReceipt()}>{transactionForm.receiptPath ? "Receipt selected" : "Attach receipt"}</button>
            <button type="button" onClick={() => void saveTransaction()}>{transactionForm.id ? "Update expense" : "Save expense"}</button>
            <button type="button" onClick={() => setTransactionForm(emptyFinanceTransactionForm)}>Reset</button>
          </div>
          {transactionForm.receiptPath && <p className="technical">{transactionForm.receiptPath}</p>}
        </Panel>

        <Panel title="Monthly Summary">
          <div className="stats-grid">
            <article><span>{financeState.summary.currentMonth}</span><strong>{money(financeState.summary.currentMonthTotal)}</strong><p>Current month</p></article>
            <article><span>{financeState.summary.previousMonth}</span><strong>{money(financeState.summary.previousMonthTotal)}</strong><p>Previous month</p></article>
            <article><span>Cash</span><strong>{money(financeState.summary.cashTotal)}</strong><p>Cash total</p></article>
            <article><span>Card</span><strong>{money(financeState.summary.cardTotal)}</strong><p>Debit and credit</p></article>
          </div>
          <p>{financeState.summary.transactionCount} current-month transaction{financeState.summary.transactionCount === 1 ? "" : "s"}.</p>
          <div className="data-list">
            {Object.entries(financeState.summary.categoryTotals).map(([category, total]) => <article className="data-item data-item--compact accent-finance" key={category}><strong>{category}</strong><span>{money(total)}</span></article>)}
            {Object.entries(financeState.summary.paymentTypeTotals).map(([paymentType, total]) => <article className="data-item data-item--compact accent-finance" key={paymentType}><strong>{paymentType}</strong><span>{money(total)}</span></article>)}
          </div>
        </Panel>
      </div>

      <Panel title="Transactions">
        <div className="action-list">
          {financeState.transactions.length === 0 ? <p>No Finance transactions yet.</p> : <LimitedList items={financeState.transactions} step={50}>{(transaction) => (
            <CollapsibleListItem
              accentClass="accent-finance"
              key={transaction.id}
              title={`${transaction.store} / ${money(transaction.amount, transaction.currency)}`}
              meta={`${formatLocalDate(transaction.date)} / ${transaction.category} / ${transaction.paymentType}${transaction.receiptFilePath ? " / receipt" : ""}`}
              actions={(
                <>
                  <button type="button" onClick={() => loadTransaction(transaction)}>Edit</button>
                  {transaction.receiptFilePath && <button type="button" onClick={() => void openReceipt(transaction)}>Open receipt</button>}
                  {transaction.receiptFilePath && <button type="button" onClick={() => void transactionAction("finance.send_receipt_to_drop", transaction, "Receipt sent to phone.")}>Send receipt to phone</button>}
                  {transaction.receiptFilePath && <button type="button" onClick={() => void transactionAction("finance.save_receipt_to_vault", transaction, "Receipt saved to Vault.")}>Save receipt to Vault</button>}
                  <button className="danger-button" type="button" onClick={() => void deleteTransaction(transaction)}>Delete</button>
                </>
              )}
            >
              <p>{transaction.cardName ? `${transaction.cardName} / ` : ""}{transaction.tags.length ? transaction.tags.join(", ") : "No tags"}</p>
              {transaction.notes && <p>{transaction.notes}</p>}
              {transaction.returnDeadline && <p>Return by {formatLocalDate(transaction.returnDeadline)}</p>}
              {transaction.warrantyUntil && <p>Warranty until {formatLocalDate(transaction.warrantyUntil)}</p>}
              {transaction.receiptFilePath && <p className="technical">{transaction.receiptFilePath}</p>}
              <p className="technical">{transaction.id}</p>
            </CollapsibleListItem>
          )}</LimitedList>}
        </div>
      </Panel>

      <div className="finance-secondary-grid">
        <Panel title="Receipts">
          <div className="action-list action-list--compact">
            {receiptTransactions.length === 0 ? <p>No receipts attached yet.</p> : receiptTransactions.map((transaction) => (
              <CollapsibleListItem
                accentClass="accent-finance"
                key={transaction.id}
                title={transaction.receiptOriginalName ?? `${transaction.store} receipt`}
                meta={`${transaction.store} / ${money(transaction.amount, transaction.currency)}`}
                actions={(
                  <>
                    <button type="button" onClick={() => void openReceipt(transaction)}>Open</button>
                    <button type="button" onClick={() => void transactionAction("finance.send_receipt_to_drop", transaction, "Receipt sent to phone.")}>Send to phone</button>
                    <button type="button" onClick={() => void transactionAction("finance.save_receipt_to_vault", transaction, "Receipt saved to Vault.")}>Save to Vault</button>
                  </>
                )}
              >
                <p className="technical">{transaction.receiptFilePath}</p>
              </CollapsibleListItem>
            ))}
          </div>
        </Panel>

        <Panel title="Recurring Expenses">
          <div className="project-form">
            <label>Name<input value={recurringForm.name} onChange={(event) => setRecurringForm({ ...recurringForm, name: event.target.value })} placeholder="Rent, phone plan" /></label>
            <label>Amount<input type="number" min="0" step="0.01" value={recurringForm.amount} onChange={(event) => setRecurringForm({ ...recurringForm, amount: event.target.value })} /></label>
            <label>Currency<input value={recurringForm.currency} onChange={(event) => setRecurringForm({ ...recurringForm, currency: event.target.value })} /></label>
            <label>Frequency<select value={recurringForm.frequency} onChange={(event) => setRecurringForm({ ...recurringForm, frequency: event.target.value as FinanceRecurringFrequency })}><option value="monthly">monthly</option><option value="yearly">yearly</option><option value="weekly">weekly</option><option value="custom">custom</option></select></label>
            <label>Next due<input type="date" value={recurringForm.nextDueDate} onChange={(event) => setRecurringForm({ ...recurringForm, nextDueDate: event.target.value })} /></label>
            <label>Category<input value={recurringForm.category} onChange={(event) => setRecurringForm({ ...recurringForm, category: event.target.value })} /></label>
            <label>Payment type<select value={recurringForm.paymentType} onChange={(event) => setRecurringForm({ ...recurringForm, paymentType: event.target.value as FinancePaymentType })}><option value="cash">cash</option><option value="debit">debit</option><option value="credit">credit</option><option value="e_transfer">e_transfer</option><option value="other">other</option></select></label>
            <label>Notes<textarea value={recurringForm.notes} onChange={(event) => setRecurringForm({ ...recurringForm, notes: event.target.value })} /></label>
          </div>
          <label className="checkbox-row"><input type="checkbox" checked={recurringForm.active} onChange={(event) => setRecurringForm({ ...recurringForm, active: event.target.checked })} /> Active</label>
          <div className="button-row">
            <button type="button" onClick={() => void saveRecurring()}>{recurringForm.id ? "Update recurring" : "Add recurring"}</button>
            <button type="button" onClick={() => setRecurringForm(emptyFinanceRecurringForm)}>Reset</button>
          </div>
          <div className="action-list action-list--compact">
            {financeState.recurring.length === 0 ? <p>No recurring expenses yet.</p> : financeState.recurring.map((recurring) => (
              <CollapsibleListItem
                accentClass="accent-finance"
                key={recurring.id}
                title={`${recurring.name} / ${money(recurring.amount, recurring.currency)}`}
                meta={`${recurring.frequency} / due ${formatLocalDate(recurring.nextDueDate)} / ${recurring.active ? "active" : "inactive"}`}
                actions={(
                  <>
                    <button type="button" onClick={() => loadRecurring(recurring)}>Edit</button>
                    <button type="button" onClick={() => void onAction("finance.toggle_recurring", "module_ui", { recurringId: recurring.id }).then(() => onRefresh())}>{recurring.active ? "Mark inactive" : "Mark active"}</button>
                    <button className="danger-button" type="button" onClick={() => void deleteRecurring(recurring)}>Delete</button>
                  </>
                )}
              >
                <p>{recurring.category} / {recurring.paymentType}</p>
                {recurring.notes && <p>{recurring.notes}</p>}
                <p className="technical">{recurring.id}</p>
              </CollapsibleListItem>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Returns and Warranty">
        <div className="dashboard-grid">
          <DeadlineList title="Returns within 7 days" items={financeState.deadlines.returns7} onReminder={(transaction) => transactionAction("finance.create_return_reminder", transaction, "Return reminder added to Calendar.")} />
          <DeadlineList title="Returns within 30 days" items={financeState.deadlines.returns30} onReminder={(transaction) => transactionAction("finance.create_return_reminder", transaction, "Return reminder added to Calendar.")} />
          <DeadlineList title="Warranty within 90 days" items={financeState.deadlines.warranties90} onReminder={(transaction) => transactionAction("finance.create_warranty_reminder", transaction, "Warranty reminder added to Calendar.")} />
          <DeadlineList title="Expired returns" items={financeState.deadlines.expiredReturns} onReminder={(transaction) => transactionAction("finance.create_return_reminder", transaction, "Return reminder added to Calendar.")} />
        </div>
      </Panel>

      <Panel title="Settings">
        <div className="settings-list">
          <div className="settings-row"><span>Transactions</span><strong>{financeState.transactionsPath}</strong></div>
          <div className="settings-row"><span>Recurring</span><strong>{financeState.recurringPath}</strong></div>
          <div className="settings-row"><span>Settings</span><strong>{financeState.settingsPath}</strong></div>
          <div className="settings-row"><span>Receipts</span><strong>{financeState.receiptsPath}</strong></div>
        </div>
      </Panel>

      {toast && <ToastStack toasts={[{ id: toast.message, message: toast.message, tone: toast.tone }]} />}
    </section>
  );
}

function DeadlineList({
  title,
  items,
  onReminder
}: {
  title: string;
  items: FinanceTransaction[];
  onReminder: (transaction: FinanceTransaction) => Promise<void>;
}) {
  return (
    <div className="data-list">
      <h3>{title}</h3>
      {items.length === 0 ? <p>No matching transactions.</p> : items.map((transaction) => (
        <article className="data-item data-item--stacked accent-finance" key={`${title}-${transaction.id}`}>
          <strong>{transaction.store}</strong>
          <span>{formatLocalDate(transaction.returnDeadline ?? transaction.warrantyUntil ?? transaction.date)} / {transaction.category}</span>
          <button type="button" onClick={() => void onReminder(transaction)}>Create Calendar reminder</button>
        </article>
      ))}
    </div>
  );
}

function HeatmapView({
  heatmapState,
  onAction,
  onRefresh
}: {
  heatmapState: HeatmapState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    heatmapState?: HeatmapState;
    snapshot?: { detectionStatus?: string; error?: string };
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [trackingEnabled, setTrackingEnabled] = useState(heatmapState.settings.enabled);
  const [sampleIntervalSeconds, setSampleIntervalSeconds] = useState(String(heatmapState.settings.sampleIntervalSeconds));
  const [aggregationIntervalHours, setAggregationIntervalHours] = useState(String(heatmapState.settings.aggregationIntervalHours));
  const [pauseDuringFullscreen, setPauseDuringFullscreen] = useState(heatmapState.settings.pauseDuringFullscreen);
  const [privateApps, setPrivateApps] = useState(heatmapState.settings.privateApps.join("\n"));
  const [privateTitleKeywords, setPrivateTitleKeywords] = useState(heatmapState.settings.privateTitleKeywords.join("\n"));
  const [goalForm, setGoalForm] = useState({ id: "", name: "", targetHoursPerWeek: "5", keyword: "", active: true });
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  useEffect(() => {
    setTrackingEnabled(heatmapState.settings.enabled);
    setSampleIntervalSeconds(String(heatmapState.settings.sampleIntervalSeconds));
    setAggregationIntervalHours(String(heatmapState.settings.aggregationIntervalHours));
    setPauseDuringFullscreen(heatmapState.settings.pauseDuringFullscreen);
    setPrivateApps(heatmapState.settings.privateApps.join("\n"));
    setPrivateTitleKeywords(heatmapState.settings.privateTitleKeywords.join("\n"));
  }, [heatmapState.settings]);

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  }

  function listFromLines(value: string): string[] {
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }

  async function heatmapAction(actionId: string, params: Record<string, unknown> = {}, successMessage = "Heatmap updated."): Promise<void> {
    const result = await onAction(actionId, "module_ui", params);
    showToast(result.ok ? successMessage : result.error ?? "Heatmap action failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function startTracking(): Promise<void> {
    await heatmapAction("heatmap.start", {
      sampleIntervalSeconds: Number(sampleIntervalSeconds),
      aggregationIntervalHours: Number(aggregationIntervalHours),
      pauseDuringFullscreen,
      privateApps: listFromLines(privateApps),
      privateTitleKeywords: listFromLines(privateTitleKeywords)
    }, "Heatmap tracking started.");
  }

  async function saveSettings(): Promise<void> {
    if (trackingEnabled) {
      await startTracking();
      return;
    }

    await heatmapAction("heatmap.pause", { enabled: false }, "Heatmap settings saved and tracking disabled.");
  }

  async function logCurrentApp(): Promise<void> {
    const result = await onAction("heatmap.log_current_app", "module_ui", {});
    showToast(result.ok ? "Logged current app." : result.error ?? "Active window detection failed; placeholder sample logged.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function clearData(): Promise<void> {
    if (!window.confirm("Clear all Heatmap samples?")) {
      return;
    }
    await heatmapAction("heatmap.clear_data", { confirmedDangerous: true }, "Heatmap data cleared.");
  }

  function editGoal(goal: HeatmapGoal): void {
    setGoalForm({
      id: goal.id,
      name: goal.name,
      targetHoursPerWeek: String(goal.targetHoursPerWeek),
      keyword: goal.keyword,
      active: goal.active
    });
  }

  async function saveGoal(): Promise<void> {
    await heatmapAction(goalForm.id ? "heatmap.update_goal" : "heatmap.create_goal", goalForm, "Heatmap goal saved.");
    setGoalForm({ id: "", name: "", targetHoursPerWeek: "5", keyword: "", active: true });
  }

  async function deleteGoal(goal: HeatmapGoal): Promise<void> {
    if (!window.confirm(`Delete Heatmap goal "${goal.name}"?`)) {
      return;
    }
    await heatmapAction("heatmap.delete_goal", { goalId: goal.id, confirmedDangerous: true }, "Heatmap goal deleted.");
  }

  return (
    <section className="view-stack accent-heatmap" aria-labelledby="heatmap-title">
      <PageHeader
        eyebrow="Local app usage without content capture"
        title="Heatmap"
        titleId="heatmap-title"
        actions={<StatusBadge tone="info">{heatmapState.trackingStatus}</StatusBadge>}
      />

      <Panel title="Controls">
        <div className="stats-grid">
          <article><span>Active today</span><strong>{formatDuration(heatmapState.summary.activeSecondsToday)}</strong><p>Sample estimate</p></article>
          <article><span>Idle today</span><strong>{formatDuration(heatmapState.summary.idleSecondsToday)}</strong><p>Input inactivity estimate</p></article>
          <article><span>Top app</span><strong>{heatmapState.summary.topAppToday}</strong><p>Today</p></article>
          <article><span>Samples</span><strong>{heatmapState.events.length}</strong><p>Recent retained view</p></article>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void startTracking()}>Start tracking</button>
          <button type="button" onClick={() => void heatmapAction("heatmap.pause", {}, "Heatmap tracking paused.")}>Pause tracking</button>
          <button type="button" onClick={() => void logCurrentApp()}>Log current app once</button>
          <button type="button" onClick={() => void heatmapAction("heatmap.aggregate_now", {}, "Heatmap aggregated.")}>Aggregate now</button>
          <button className="danger-button" type="button" onClick={() => void clearData()}>Clear data</button>
        </div>
        <p>{heatmapState.detectionNote}</p>
      </Panel>

      <div className="dashboard-grid">
        <Panel title="Settings">
          <div className="project-form">
            <label>Tracking enabled<select value={trackingEnabled ? "true" : "false"} onChange={(event) => setTrackingEnabled(event.target.value === "true")}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
            <label>Sample interval seconds<input type="number" min="60" value={sampleIntervalSeconds} onChange={(event) => setSampleIntervalSeconds(event.target.value)} /></label>
            <label>Aggregation interval hours<input type="number" min="3" value={aggregationIntervalHours} onChange={(event) => setAggregationIntervalHours(event.target.value)} /></label>
            <label>Pause during fullscreen<select value={pauseDuringFullscreen ? "true" : "false"} onChange={(event) => setPauseDuringFullscreen(event.target.value === "true")}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
            <label>Private app exclusions<textarea value={privateApps} onChange={(event) => setPrivateApps(event.target.value)} placeholder="1Password&#10;bank&#10;Signal" /></label>
            <label>Private title keyword exclusions<textarea value={privateTitleKeywords} onChange={(event) => setPrivateTitleKeywords(event.target.value)} placeholder="password&#10;account&#10;private" /></label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void saveSettings()}>Save settings</button>
          </div>
          <p className="technical">{heatmapState.settingsPath}</p>
        </Panel>

        <Panel title="Goals">
          <div className="project-form">
            <label>Name<input value={goalForm.name} onChange={(event) => setGoalForm({ ...goalForm, name: event.target.value })} placeholder="Deep work" /></label>
            <label>Target hours/week<input type="number" min="0.25" step="0.25" value={goalForm.targetHoursPerWeek} onChange={(event) => setGoalForm({ ...goalForm, targetHoursPerWeek: event.target.value })} /></label>
            <label>App/project keyword<input value={goalForm.keyword} onChange={(event) => setGoalForm({ ...goalForm, keyword: event.target.value })} placeholder="Code, VS Code, DexNest" /></label>
            <label>Active<select value={goalForm.active ? "true" : "false"} onChange={(event) => setGoalForm({ ...goalForm, active: event.target.value === "true" })}><option value="true">Active</option><option value="false">Inactive</option></select></label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void saveGoal()}>{goalForm.id ? "Update goal" : "Create goal"}</button>
            <button type="button" onClick={() => setGoalForm({ id: "", name: "", targetHoursPerWeek: "5", keyword: "", active: true })}>Reset</button>
          </div>
          <div className="action-list action-list--compact">
            {heatmapState.goalProgress.length === 0 ? <p>No Heatmap goals yet.</p> : heatmapState.goalProgress.map((goal) => (
              <article className="data-item data-item--stacked accent-heatmap" key={goal.id}>
                <strong>{goal.name} / {goal.percent}%</strong>
                <span>{formatDuration(goal.progressSeconds)} of {formatDuration(goal.targetSeconds)} / {goal.keyword || "all Heatmap samples"}</span>
                <span className="technical">{goal.id}</span>
                <div className="button-row">
                  <button type="button" onClick={() => editGoal(goal)}>Edit</button>
                  <button className="danger-button" type="button" onClick={() => void deleteGoal(goal)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
          <p className="technical">{heatmapState.goalsPath}</p>
        </Panel>
      </div>

      <div className="dashboard-grid">
        <Panel title="Today App Usage">
          <div className="action-list action-list--compact">
            {heatmapState.summary.todayByApp.length === 0 ? <p>No Heatmap samples today.</p> : heatmapState.summary.todayByApp.slice(0, 8).map((item) => (
              <article className="data-item accent-heatmap" key={item.name}><strong>{item.name}</strong><span>{formatDuration(item.seconds)}</span></article>
            ))}
          </div>
        </Panel>

        <Panel title="This Week App Usage">
          <div className="action-list action-list--compact">
            {heatmapState.summary.weekByApp.length === 0 ? <p>No weekly Heatmap data yet.</p> : heatmapState.summary.weekByApp.slice(0, 8).map((item) => (
              <article className="data-item accent-heatmap" key={item.name}><strong>{item.name}</strong><span>{formatDuration(item.seconds)}</span></article>
            ))}
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid">
        <Panel title="Most Active Hours">
          <div className="action-list action-list--compact">
            {heatmapState.summary.activeHours.length === 0 ? <p>No hourly data yet.</p> : heatmapState.summary.activeHours.slice(0, 8).map((item) => (
              <article className="data-item accent-heatmap" key={item.hour}><strong>{String(item.hour).padStart(2, "0")}:00</strong><span>{formatDuration(item.seconds)}</span></article>
            ))}
          </div>
        </Panel>

        <Panel title="Project Usage">
          <div className="action-list action-list--compact">
            {heatmapState.summary.projectUsage.length === 0 ? <p>No Dev project matches in Heatmap samples yet.</p> : heatmapState.summary.projectUsage.slice(0, 8).map((item) => (
              <article className="data-item accent-heatmap" key={item.name}><strong className="technical">{item.name}</strong><span>{formatDuration(item.seconds)}</span></article>
            ))}
          </div>
        </Panel>

        <Panel title="Recent Samples">
          <div className="action-list action-list--compact">
            {heatmapState.events.length === 0 ? <p>No Heatmap samples logged yet.</p> : heatmapState.events.slice(0, 10).map((event) => (
              <CollapsibleListItem
                accentClass="accent-heatmap"
                key={event.id}
                title={event.appName}
                meta={`${formatLocalDateTime(event.timestamp)} / ${event.active ? "active" : "idle"} / ${formatDuration(event.durationSeconds)}`}
              >
                <p>{event.windowTitle}</p>
                <p>Idle: {event.idleSeconds === null || event.idleSeconds === undefined ? "unknown" : formatDuration(event.idleSeconds)}</p>
                {event.projectId && <p className="technical">{event.projectId}</p>}
                <p className="technical">{event.id}</p>
              </CollapsibleListItem>
            ))}
          </div>
          <p className="technical">{heatmapState.eventsPath}</p>
        </Panel>
      </div>

      <Panel title="Privacy Rules">
        <p>DexNest Heatmap stores app/window metadata only. It does not store keystrokes, screenshots, screen recording, or page/document contents.</p>
        <p>When an app or title keyword matches an exclusion, the sample is stored as Private app / Private window.</p>
      </Panel>

      {toast && <ToastStack toasts={[{ id: toast.message, message: toast.message, tone: toast.tone }]} />}
    </section>
  );
}

const emptyCaptureForm = {
  type: "note" as CaptureItemType,
  title: "",
  text: "",
  url: "",
  tags: "",
  filePath: ""
};

function CaptureView({
  captureState,
  speechState,
  voiceWorkflow,
  voiceWorkflowSettings,
  onSpeechStateChange,
  onStartVoiceCapture,
  onSaveVoiceCapture,
  onStopVoiceCapture,
  onCancelVoiceCapture,
  onVoiceWorkflowSettingsChange,
  onAction,
  onRefresh
}: {
  captureState: CaptureState;
  speechState: SpeechServiceState;
  voiceWorkflow: VoiceWorkflowState;
  voiceWorkflowSettings: VoiceWorkflowSettings;
  onSpeechStateChange: (state: SpeechServiceState) => void;
  onStartVoiceCapture: (source?: string) => Promise<void>;
  onSaveVoiceCapture: () => Promise<void>;
  onStopVoiceCapture: () => void;
  onCancelVoiceCapture: () => void;
  onVoiceWorkflowSettingsChange: (settings: Partial<VoiceWorkflowSettings>) => Promise<void>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{ ok: boolean; error?: string; captureState?: CaptureState }>;
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState(emptyCaptureForm);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  }

  async function chooseFile(): Promise<void> {
    const files = await getBridge().selectCaptureFile();
    const file = files[0];
    if (file) {
      setForm((current) => ({ ...current, filePath: file.path, type: file.extension.match(/\.(png|jpg|jpeg|webp|heic)$/i) ? "image" : "file" }));
      showToast("Capture file selected.");
    }
  }

  async function saveCapture(): Promise<void> {
    const actionId = form.filePath ? "capture.create_from_file" : "capture.create_note";
    const result = await onAction(actionId, "module_ui", { ...form, source: "manual" });
    showToast(result.ok ? "Capture saved to inbox." : result.error ?? "Capture failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setForm(emptyCaptureForm);
      await onRefresh();
    }
  }

  async function createFromClipboard(): Promise<void> {
    const result = await onAction("capture.create_from_clipboard", "module_ui", { title: form.title || "Clipboard capture", tags: form.tags });
    showToast(result.ok ? "Clipboard captured." : result.error ?? "Clipboard capture failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function routeCapture(actionId: string, item: CaptureItem, success: string): Promise<void> {
    const params: Record<string, unknown> = { captureId: item.id };
    if (actionId === "capture.route_to_finder") {
      const location = window.prompt("Where is this item located?", "");
      if (location === null) {
        return;
      }
      params.location = location;
    }
    if (actionId === "capture.route_to_finance") {
      const amount = window.prompt("Amount for Finance expense?", "");
      if (amount === null) {
        return;
      }
      params.amount = amount;
    }
    const result = await onAction(actionId, "module_ui", params);
    showToast(result.ok ? success : result.error ?? "Capture route failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function archiveCapture(item: CaptureItem): Promise<void> {
    const result = await onAction("capture.archive_item", "module_ui", { captureId: item.id });
    showToast(result.ok ? "Capture archived." : result.error ?? "Archive failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function deleteCapture(item: CaptureItem): Promise<void> {
    if (!window.confirm(`Delete capture "${item.title}"?`)) {
      return;
    }
    const result = await onAction("capture.delete_item", "module_ui", { captureId: item.id, confirmedDangerous: true });
    showToast(result.ok ? "Capture deleted." : result.error ?? "Delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  function renderCaptureItem(item: CaptureItem) {
    return (
      <CollapsibleListItem
        accentClass="accent-capture"
        key={item.id}
        title={`${item.title} / ${item.type}`}
        meta={`${formatLocalDateTime(item.createdAt)} / ${item.status}${item.filePath ? " / file" : ""}`}
        actions={(
          <>
            <button type="button" onClick={() => void routeCapture("capture.route_to_journal", item, "Sent to Journal.")}>Send to Journal</button>
            <button type="button" onClick={() => void routeCapture("capture.route_to_calendar", item, "Calendar event created.")}>Create Calendar event</button>
            <button type="button" disabled={!item.filePath} onClick={() => void routeCapture("capture.route_to_vault", item, "Saved to Vault.")}>Save to Vault</button>
            <button type="button" onClick={() => void routeCapture("capture.route_to_finance", item, "Added to Finance.")}>Add to Finance</button>
            <button type="button" onClick={() => void routeCapture("capture.route_to_finder", item, "Added to Finder.")}>Add to Finder</button>
            <button type="button" onClick={() => void routeCapture("capture.route_to_drop", item, "Sent to Drop.")}>Send to Drop</button>
            {item.status !== "archived" && <button type="button" onClick={() => void archiveCapture(item)}>Archive</button>}
            <button className="danger-button" type="button" onClick={() => void deleteCapture(item)}>Delete</button>
          </>
        )}
      >
        <p>{previewForUi(item.text || item.url || "No text")}</p>
        {item.tags.length > 0 && <p>{item.tags.join(", ")}</p>}
        {item.filePath && <p className="technical">{item.filePath}</p>}
        <p className="technical">{item.id}</p>
      </CollapsibleListItem>
    );
  }

  return (
    <section className="view-stack accent-capture" aria-labelledby="capture-title">
      <PageHeader eyebrow="Universal local inbox" title="Capture" titleId="capture-title" />

      <Panel title="Voice Capture">
        <div className="status-grid">
          <article><span>Mode</span><strong>{voiceWorkflow.mode === "capture_note" ? "Capture voice" : "Ready"}</strong><p>{speechState.performancePaused ? "Speech is paused by Performance Mode." : "Select Ask DexNest or start here."}</p></article>
          <article><span>Status</span><strong>{voiceWorkflow.mode === "capture_note" ? voiceWorkflow.status : "idle"}</strong><p>{voiceWorkflow.error || "Select text mentally, speak the note, then DexNest saves locally."}</p></article>
          <article><span>Latest</span><strong>{voiceWorkflow.mode === "capture_note" ? `${voiceWorkflow.chunksCount} chunk${voiceWorkflow.chunksCount === 1 ? "" : "s"}` : "0 chunks"}</strong><p>{voiceWorkflow.lastTranscriptPreview || "No preview stored for sensitive text."}</p></article>
        </div>
        <p>Select Ask DexNest: "capture this" → speak your note. Or start a local Capture voice note here.</p>
        <div className="button-row">
          <button type="button" className="button-primary" disabled={speechState.performancePaused || voiceWorkflow.mode === "capture_note" && voiceWorkflow.status === "listening"} onClick={() => void onStartVoiceCapture("module_ui")}>Start Voice Capture</button>
          <button type="button" disabled={voiceWorkflow.mode !== "capture_note"} onClick={() => void onSaveVoiceCapture()}>Save</button>
          <button type="button" disabled={voiceWorkflow.mode !== "capture_note"} onClick={onStopVoiceCapture}>Stop</button>
          <button type="button" className="danger-button" disabled={voiceWorkflow.mode !== "capture_note"} onClick={onCancelVoiceCapture}>Cancel</button>
        </div>
        <div className="settings-list">
          <label className="assistant__check">
            <input type="checkbox" checked={voiceWorkflowSettings.autoSaveCaptureVoiceNotes} onChange={(event) => void onVoiceWorkflowSettingsChange({ autoSaveCaptureVoiceNotes: event.target.checked })} />
            <span>Auto-save Capture voice notes</span>
          </label>
          <label className="assistant__check">
            <input type="checkbox" checked={voiceWorkflowSettings.continueCaptureMode} onChange={(event) => void onVoiceWorkflowSettingsChange({ continueCaptureMode: event.target.checked })} />
            <span>Continue listening after saving</span>
          </label>
          <label className="assistant__check">
            <input type="checkbox" checked={voiceWorkflowSettings.confirmSensitiveCapture} onChange={(event) => void onVoiceWorkflowSettingsChange({ confirmSensitiveCapture: event.target.checked })} />
            <span>Require review for sensitive capture text</span>
          </label>
        </div>
      </Panel>

      <Panel title="Quick Capture">
        <div className="project-form">
          <label>Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as CaptureItemType })}><option value="note">note</option><option value="link">link</option><option value="task">task</option><option value="expense">expense</option><option value="file">file</option><option value="image">image</option><option value="document">document</option><option value="other">other</option></select></label>
          <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Quick title" /></label>
          <label>URL<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="Optional link" /></label>
          <label>Tags<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="inbox, later" /></label>
          <label>Text<textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} placeholder="Note, task, thought, expense, or routing context" /></label>
        </div>
        <VoiceInput
          targetLabel="Capture"
          speechState={speechState}
          onSpeechStateChanged={onSpeechStateChange}
          onTranscript={(text) => setForm((current) => ({ ...current, text: current.text ? `${current.text}\n${text}` : text }))}
          onAction={onAction}
        />
        <div className="button-row">
          <button type="button" onClick={() => void chooseFile()}>{form.filePath ? "File selected" : "Attach file"}</button>
          <button type="button" onClick={() => void saveCapture()}>Save to inbox</button>
          <button type="button" onClick={() => void createFromClipboard()}>Capture clipboard</button>
          <button type="button" onClick={() => setForm(emptyCaptureForm)}>Reset</button>
        </div>
        {form.filePath && <p className="technical">{form.filePath}</p>}
      </Panel>

      <Panel title={`Shared Inbox (${captureState.inbox.length})`}>
        <div className="action-list">
          {captureState.inbox.length === 0 ? <p>No Capture inbox items yet.</p> : <LimitedList items={captureState.inbox} step={50}>{renderCaptureItem}</LimitedList>}
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel title={`Routed Items (${captureState.routed.length})`}>
          <div className="action-list action-list--compact">
            {captureState.routed.length === 0 ? <p>No routed items yet.</p> : <LimitedList items={captureState.routed} step={50}>{renderCaptureItem}</LimitedList>}
          </div>
        </Panel>
        <Panel title={`Archived (${captureState.archived.length})`}>
          <div className="action-list action-list--compact">
            {captureState.archived.length === 0 ? <p>No archived captures.</p> : <LimitedList items={captureState.archived} step={50}>{renderCaptureItem}</LimitedList>}
          </div>
        </Panel>
      </div>

      <Panel title="Settings">
        <div className="settings-list">
          <div className="settings-row"><span>Capture items</span><strong>{captureState.itemsPath}</strong></div>
          <div className="settings-row"><span>Capture files</span><strong>{captureState.capturesPath}</strong></div>
        </div>
      </Panel>

      {toast && <ToastStack toasts={[{ id: toast.message, message: toast.message, tone: toast.tone }]} />}
    </section>
  );
}

function SearchView({
  searchState,
  actions,
  assistantSettings,
  onAssistantSettingsChange,
  securityState,
  onSecurityChange,
  ambientVoiceState,
  onAmbientVoiceChange,
  speechState,
  voiceWorkflowSettings,
  onSpeechStateChange,
  assistantFocusSignal,
  assistantListenSignal,
  assistantListenSource,
  assistantQueuedCommand,
  assistantQueuedCommandSignal,
  onTtsDiagnosticsChange,
  onWakeMetricsUpdate,
  journalVoiceActive,
  onStartJournalVoice,
  onJournalControl,
  onStartCaptureVoice,
  onFinderVoiceCandidate,
  onCalendarVoiceCandidate,
  onFinderLookupComplete,
  onFinderMemorySaved,
  onAction,
  assistantAction,
  onRefresh
}: {
  searchState: SearchState;
  actions: ActionDefinition[];
  assistantSettings: AssistantSettings;
  onAssistantSettingsChange: () => Promise<void>;
  securityState: AssistantSecurityState;
  onSecurityChange: () => Promise<void>;
  ambientVoiceState: AmbientVoiceState;
  onAmbientVoiceChange: () => Promise<void>;
  speechState: SpeechServiceState;
  voiceWorkflowSettings: VoiceWorkflowSettings;
  onSpeechStateChange: (state: SpeechServiceState) => void;
  assistantFocusSignal: number;
  assistantListenSignal: number;
  assistantListenSource: string;
  assistantQueuedCommand: QueuedAssistantCommand | null;
  assistantQueuedCommandSignal: number;
  onTtsDiagnosticsChange: (diagnostics: TtsDiagnostics) => void;
  onWakeMetricsUpdate: (patch: Partial<SpeechCaptureMetrics>) => void;
  journalVoiceActive: boolean;
  onStartJournalVoice: (source?: string) => Promise<void>;
  onJournalControl: (control: JournalVoiceControl) => void;
  onStartCaptureVoice: (source?: string) => Promise<void>;
  onFinderVoiceCandidate: (candidate: FinderVoiceCandidate, source?: string) => void;
  onCalendarVoiceCandidate: (candidate: CalendarVoiceCandidate, source?: string) => void;
  onFinderLookupComplete: (summary: string, source: string) => void;
  onFinderMemorySaved: (source: string) => void;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    results?: SearchResult[] | FinderItem[];
    secureResults?: SecureSearchResult[];
    smartResults?: SmartLookupResult[];
    searchState?: SearchState;
    savedSearch?: SavedSearch;
  }>;
  assistantAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [sourceModule, setSourceModule] = useState("all");
  const [fileType, setFileType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [secureQuery, setSecureQuery] = useState("");
  const [securePassword, setSecurePassword] = useState("");
  const [secureIncludeSecrets, setSecureIncludeSecrets] = useState(false);
  const [secureResults, setSecureResults] = useState<SecureSearchResult[]>([]);
  const [secureStatus, setSecureStatus] = useState("");
  const [smartQuestion, setSmartQuestion] = useState("");
  const [smartResults, setSmartResults] = useState<SmartLookupResult[]>([]);
  const [revealedSmartIds, setRevealedSmartIds] = useState<string[]>([]);
  const [smartStatus, setSmartStatus] = useState("");
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);

  const currentParams = { query, sourceModule, fileType, dateFrom, dateTo };
  // Memoize so typing in the query box does not re-sort the whole index each keystroke.
  const recentRecovery = useMemo(() => searchState.index
    .filter((item) => Boolean(item.filePath))
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6), [searchState.index]);

  async function rebuildIndex(): Promise<void> {
    if (!window.confirm("Rebuild the local DexNest Search index now? This is user-triggered and allowed during Performance Mode.")) {
      return;
    }
    setStatus("Rebuilding index...");
    const result = await onAction("search.rebuild_index", "module_ui", currentParams);
    if (result.ok) {
      setStatus("Index rebuilt.");
      await onRefresh();
      await runQuery();
    } else {
      setStatus(result.error ?? "Index rebuild failed.");
    }
  }

  async function clearIndex(): Promise<void> {
    const confirmed = window.confirm("Clear the local DexNest Search index?");
    if (!confirmed) {
      return;
    }
    const result = await onAction("search.clear_index", "module_ui", { confirmedDangerous: true });
    setResults([]);
    setStatus(result.ok ? "Index cleared." : result.error ?? "Clear failed.");
    await onRefresh();
  }

  async function runQuery(nextParams = currentParams): Promise<void> {
    setSearching(true);
    try {
      const result = await onAction("search.run_query", "module_ui", nextParams);
      if (result.ok) {
        setResults((result.results ?? []) as SearchResult[]);
        setStatus(`${result.results?.length ?? 0} results.`);
      } else {
        setStatus(result.error ?? "Search failed.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function saveQuery(): Promise<void> {
    const result = await onAction("search.save_query", "module_ui", {
      ...currentParams,
      title: query || `${sourceModule} ${fileType}`.trim() || "Saved DexNest Search"
    });
    setStatus(result.ok ? "Saved search." : result.error ?? "Save failed.");
    await onRefresh();
  }

  async function rerunSavedSearch(savedSearch: SavedSearch): Promise<void> {
    setQuery(savedSearch.query);
    setSourceModule(savedSearch.sourceModule);
    setFileType(savedSearch.fileType);
    setDateFrom(savedSearch.dateFrom);
    setDateTo(savedSearch.dateTo);
    await runQuery(savedSearch);
  }

  async function deleteSavedSearch(savedSearchId: string): Promise<void> {
    const confirmed = window.confirm("Delete this saved Search query?");
    if (!confirmed) {
      return;
    }
    const result = await onAction("search.delete_saved_query", "module_ui", { savedSearchId, confirmedDangerous: true });
    setStatus(result.ok ? "Deleted saved search." : result.error ?? "Delete failed.");
    await onRefresh();
  }

  async function resultAction(actionId: string, resultId: string): Promise<void> {
    const result = await onAction(actionId, "module_ui", { resultId });
    setStatus(result.ok ? "Search result action completed." : result.error ?? "Result action failed.");
    await onRefresh();
  }

  async function openIndexFolder(): Promise<void> {
    const result = await onAction("search.open_result_folder", "module_ui", { indexFolder: true });
    setStatus(result.ok ? "Opened index folder." : result.error ?? "Open folder failed.");
  }

  async function runSecureSearch(): Promise<void> {
    setSecureStatus("Running Secure Vault search in memory...");
    const result = await onAction("search.secure.run", "module_ui", {
      query: secureQuery,
      masterPassword: securePassword,
      includeSecretValues: secureIncludeSecrets
    });
    if (result.ok) {
      setSecureResults(result.secureResults ?? []);
      setSecureStatus(`${result.secureResults?.length ?? 0} secure results. Contents remain masked and are not indexed.`);
      setSecurePassword("");
    } else {
      setSecureResults([]);
      setSecureStatus(result.error ?? "Secure Search failed.");
    }
  }

  async function runSmartLookup(question = smartQuestion): Promise<void> {
    setSmartStatus("Running local Smart Lookup...");
    setRevealedSmartIds([]);
    const result = await onAction("search.smart_lookup", "module_ui", { question });
    if (result.ok) {
      setSmartResults(result.smartResults ?? []);
      setSmartStatus(`${result.smartResults?.length ?? 0} answer candidates.`);
    } else {
      setSmartResults([]);
      setSmartStatus(result.error ?? "Smart Lookup failed.");
    }
  }

  async function revealSmartAnswer(result: SmartLookupResult): Promise<void> {
    if (result.sensitive && !window.confirm(`Reveal sensitive ${result.fieldType.replace(/_/g, " ")} value?`)) {
      return;
    }
    const actionResult = await onAction("search.smart_lookup_reveal", "module_ui", {
      fieldType: result.fieldType,
      confirmedDangerous: true
    });
    if (actionResult.ok) {
      setRevealedSmartIds((current) => [...new Set([...current, result.id])]);
      setSmartStatus("Answer revealed locally.");
    } else {
      setSmartStatus(actionResult.error ?? "Reveal failed.");
    }
  }

  async function copySmartAnswer(result: SmartLookupResult): Promise<void> {
    if (result.sensitive && !window.confirm(`Copy sensitive ${result.fieldType.replace(/_/g, " ")} value? Clipboard clears after 30 seconds.`)) {
      return;
    }
    const actionResult = await onAction("search.smart_lookup_copy_answer", "module_ui", {
      answerValue: result.answer,
      fieldType: result.fieldType,
      confirmedDangerous: true
    });
    setSmartStatus(actionResult.ok ? "Answer copied. Clipboard clears after 30 seconds." : actionResult.error ?? "Copy failed.");
  }

  function sourceOpenAction(sourceModule: string): string | null {
    const actionMap: Record<string, string> = {
      capture: "capture.open",
      clipboard: "clipboard.open",
      dev: "dev.open_dashboard",
      drop: "drop.open",
      finance: "finance.open",
      finder: "finder.open",
      tools: "tools.open",
      tools_ocr: "tools.open",
      vault: "vault.open"
    };
    return actionMap[sourceModule] ?? null;
  }

  return (
    <section className="view-stack view-stack--search accent-search" aria-labelledby="search-title">
      <PageHeader
        eyebrow="Manual local index"
        title="Search"
        titleId="search-title"
        actions={(
          <>
          <button type="button" onClick={() => void rebuildIndex()}>Rebuild DexNest index</button>
          <button type="button" onClick={() => void runQuery()}>Refresh results</button>
          </>
        )}
      />

      <Panel title="Ask DexNest">
        <AskDexNest
          actions={actions}
          assistantSettings={assistantSettings}
          onAssistantSettingsChange={onAssistantSettingsChange}
          securityState={securityState}
          onSecurityChange={onSecurityChange}
          ambientVoiceState={ambientVoiceState}
          onAmbientVoiceChange={onAmbientVoiceChange}
          speechState={speechState}
          voiceWorkflowSettings={voiceWorkflowSettings}
          onSpeechStateChange={onSpeechStateChange}
          onAction={assistantAction}
          focusSignal={assistantFocusSignal}
          listenSignal={assistantListenSignal}
          listenSource={assistantListenSource}
          queuedCommand={assistantQueuedCommand}
          queuedCommandSignal={assistantQueuedCommandSignal}
          onTtsDiagnosticsChange={onTtsDiagnosticsChange}
          onWakeMetricsUpdate={onWakeMetricsUpdate}
          journalVoiceActive={journalVoiceActive}
          onStartJournalVoice={onStartJournalVoice}
          onJournalControl={onJournalControl}
          onStartCaptureVoice={onStartCaptureVoice}
          onFinderVoiceCandidate={onFinderVoiceCandidate}
          onCalendarVoiceCandidate={onCalendarVoiceCandidate}
          onFinderLookupComplete={onFinderLookupComplete}
          onFinderMemorySaved={onFinderMemorySaved}
        />
      </Panel>

      <Panel title="Run Search">
        <div className="search-controls">
          <label className="search-controls__query">
            Query
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filename, title, tag, category, metadata" />
          </label>
          <label>
            Source
            <select value={sourceModule} onChange={(event) => setSourceModule(event.target.value)}>
              <option value="all">All sources</option>
              {searchState.sources.map((source) => (
                <option value={source} key={source}>{source}</option>
              ))}
            </select>
          </label>
          <label>
            File type
            <select value={fileType} onChange={(event) => setFileType(event.target.value)}>
              <option value="all">All types</option>
              {searchState.fileTypes.map((type) => (
                <option value={type} key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button type="button" className={searching ? "is-busy" : undefined} disabled={searching} onClick={() => void runQuery()}>{searching && <Spinner size="sm" />}{searching ? "Searching…" : "Search"}</button>
          <button type="button" onClick={() => void saveQuery()}>Save search</button>
          {status && <span className="inline-status">{status}</span>}
        </div>
      </Panel>

      <Panel title="Smart Lookup / Answer Mode">
        <p>Ask local questions against indexed Vault OCR and Tools OCR text. Sensitive answers are masked until you confirm reveal.</p>
        <div className="search-controls">
          <label className="search-controls__query">
            Question
            <input
              value={smartQuestion}
              onChange={(event) => setSmartQuestion(event.target.value)}
              placeholder="What is my work permit number?"
            />
          </label>
        </div>
        <div className="button-row">
          {[
            "What is my work permit number?",
            "When does my work permit expire?",
            "What is my SIN number?",
            "What is my passport number?",
            "Show my health card number."
          ].map((example) => (
            <button type="button" key={example} onClick={() => { setSmartQuestion(example); void runSmartLookup(example); }}>{example}</button>
          ))}
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void runSmartLookup()}>Run Smart Lookup</button>
          <button type="button" onClick={() => { setSmartResults([]); setRevealedSmartIds([]); setSmartStatus(""); }}>Clear answers</button>
          {smartStatus && <span className="inline-status">{smartStatus}</span>}
        </div>
        <div className="action-list">
          {smartResults.length === 0 ? (
            <EmptyState>No Smart Lookup answers yet. If this was just OCRed, rebuild the Search index first. Local LLM answer refinement can come later.</EmptyState>
          ) : (
            smartResults.map((result) => {
              const revealed = revealedSmartIds.includes(result.id) || !result.sensitive;
              return (
                <CollapsibleListItem
                  accentClass="accent-search"
                  key={result.id}
                  title={`${result.fieldType.replace(/_/g, " ")} / ${result.confidence}`}
                  meta={`${result.sourceDocumentTitle} / ${result.sourceType ?? result.sourceModule}`}
                  actions={(
                    <>
                      {result.sensitive && <button type="button" onClick={() => void revealSmartAnswer(result)}>Reveal</button>}
                      <button type="button" onClick={() => void copySmartAnswer(result)}>Copy answer</button>
                      <button type="button" onClick={() => void onAction("search.smart_lookup_open_source", "module_ui", { sourceId: result.sourceRecordId })}>Open source</button>
                      {result.ocrTextPath && result.sourceModule === "vault" && <button type="button" onClick={() => void onAction("vault.ocr.open_text", "module_ui", { documentId: result.sourceRecordId.replace(/^vault-/, "") })}>Open OCR text</button>}
                    </>
                  )}
                >
                  <div className="section-heading section-heading--row">
                    <strong className="technical">{revealed ? result.answer : result.maskedAnswer}</strong>
                    <StatusBadge tone={result.sensitive ? "warning" : "success"}>{result.sensitive ? "sensitive" : "safe"}</StatusBadge>
                  </div>
                  <p>{result.preview}</p>
                  <p className="technical">{result.sourceRecordId}</p>
                  {result.sourceFilePath && <PathText>{result.sourceFilePath}</PathText>}
                </CollapsibleListItem>
              );
            })
          )}
        </div>
      </Panel>

      <Panel title="Secure Vault Admin Search">
        <p>Secure Search decrypts in memory for this request only. Results are masked and are never saved to the Search index.</p>
        <div className="search-controls">
          <label className="search-controls__query">
            Secure query
            <input value={secureQuery} onChange={(event) => setSecureQuery(event.target.value)} placeholder="Title, username, URL, notes" />
          </label>
          <label>
            Master password
            <input type="password" value={securePassword} onChange={(event) => setSecurePassword(event.target.value)} placeholder="Required" />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={secureIncludeSecrets} onChange={(event) => setSecureIncludeSecrets(event.target.checked)} />
            <span>Include secret values</span>
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void runSecureSearch()}>Secure Search</button>
          <button type="button" onClick={() => { setSecureResults([]); setSecureStatus(""); setSecurePassword(""); }}>Clear secure results</button>
          {secureStatus && <span className="inline-status">{secureStatus}</span>}
        </div>
        <div className="action-list action-list--compact">
          {secureResults.length === 0 ? (
            <EmptyState>No secure results in memory.</EmptyState>
          ) : (
            secureResults.map((result) => (
              <article className="data-item data-item--stacked accent-vault" key={result.id}>
                <div className="section-heading section-heading--row">
                  <strong>{result.title}</strong>
                  <StatusBadge tone="warning">Secure Vault</StatusBadge>
                </div>
                <span>{result.type}{result.username ? ` / ${result.username}` : ""}{result.url ? ` / ${result.url}` : ""}</span>
                <span>Matched: {result.matchedFields.join(", ")}. Values are masked.</span>
                <span className="technical">{result.itemId}</span>
              </article>
            ))
          )}
        </div>
      </Panel>

      <div className="search-meta-grid">
        <Panel title="Index">
          <div className="action-list action-list--compact">
            <p>{searchState.index.length} indexed records. Manual rebuild only. Secure Vault contents are skipped.</p>
            <p>{searchState.ocrTextFileCount} OCR-backed records indexed.</p>
            {searchState.indexStatus.staleDueToPerformanceMode && (
              <p>
                <StatusBadge tone="warning">stale</StatusBadge>{" "}
                Auto-index was skipped by Performance Mode{searchState.indexStatus.staleSince ? ` since ${formatLocalDateTime(searchState.indexStatus.staleSince)}` : ""}. Rebuild manually when ready.
              </p>
            )}
            <p><PathText>{searchState.indexPath}</PathText></p>
            <div className="button-row">
              <button type="button" onClick={() => void openIndexFolder()}>Open index folder</button>
              <button className="danger-button" type="button" onClick={() => void clearIndex()}>Clear index</button>
            </div>
          </div>
        </Panel>
        <Panel title="Recently opened">
          <div className="search-recovery-list">
            {recentRecovery.length === 0 ? (
              <EmptyState>No recent file metadata in the index yet.</EmptyState>
            ) : (
              recentRecovery.slice(0, 4).map((item) => (
                <article className={`data-item data-item--compact accent-${item.sourceModule}`} key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.sourceModule} / {item.entityType}</span>
                  {item.filePath && <PathText>{item.filePath}</PathText>}
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Saved Searches">
        <div className="action-list action-list--compact">
          {searchState.savedSearches.length === 0 ? (
            <EmptyState>No saved searches yet.</EmptyState>
          ) : (
            searchState.savedSearches.map((savedSearch) => (
              <CollapsibleListItem
                accentClass="accent-search"
                key={savedSearch.id}
                title={savedSearch.title}
                meta={`${savedSearch.sourceModule} / ${savedSearch.fileType}`}
                actions={(
                  <>
                  <button type="button" onClick={() => void rerunSavedSearch(savedSearch)}>Run</button>
                  <button className="danger-button" type="button" onClick={() => void deleteSavedSearch(savedSearch.id)}>Delete</button>
                  </>
                )}
              >
                <p className="technical">{savedSearch.query || "empty query"}</p>
              </CollapsibleListItem>
            ))
          )}
        </div>
      </Panel>

      <Panel title={`Results (${results.length})`}>
        <div className="action-list">
          {results.length === 0 ? (
            <EmptyState>No results yet. If this was just OCRed, rebuild the Search index, then run the search again.</EmptyState>
          ) : (
            results.map((result) => (
              <CollapsibleListItem
                accentClass={`accent-${result.sourceModule}`}
                key={result.id}
                title={result.title}
                meta={`${result.sourceModule} / ${result.entityType} / ${result.matchReason}`}
                actions={(
                  <>
                  {result.filePath && (
                    <>
                      <button type="button" onClick={() => void resultAction("search.open_result", result.id)}>Open file</button>
                      <button type="button" onClick={() => void resultAction("search.open_result_folder", result.id)}>Open folder</button>
                      <button type="button" onClick={() => void resultAction("search.send_result_to_drop", result.id)}>Send to phone</button>
                      {result.entityType === "vault_document_ocr" && <button type="button" onClick={() => void onAction("vault.ocr.open_text", "module_ui", { documentId: result.entityId })}>Open OCR text</button>}
                    </>
                  )}
                  {sourceOpenAction(result.sourceModule) && (
                    <button type="button" onClick={() => void onAction(sourceOpenAction(result.sourceModule) ?? "search.open")}>
                      Open source
                    </button>
                  )}
                  </>
                )}
              >
                <p>{result.category ?? "uncategorized"} {result.fileType ? `/ ${result.fileType}` : ""} {result.sizeBytes ? `/ ${formatBytes(result.sizeBytes)}` : ""}</p>
                {result.tags && result.tags.length > 0 && <p>{result.tags.slice(0, 6).join(", ")}</p>}
                {result.textPreview && <p>{result.textPreview}</p>}
                {result.filePath && <p><PathText>{result.filePath}</PathText></p>}
                <p className="technical">{result.id}</p>
              </CollapsibleListItem>
            ))
          )}
        </div>
      </Panel>
    </section>
  );
}

function DeckView({
  actions,
  projects,
  routinesState,
  pinnedActionIds,
  appInfo,
  endpoint,
  onAction,
  onRefresh,
  refreshEvents
}: {
  actions: ActionDefinition[];
  projects: DexNestProject[];
  routinesState: RoutinesState;
  pinnedActionIds: string[];
  appInfo: AppInfo | null;
  endpoint?: string;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    routinesState?: RoutinesState;
  }>;
  onRefresh: () => Promise<void>;
  refreshEvents: () => Promise<void>;
}) {
  const projectActions = actions.filter((action) => action.id.startsWith("dev.project."));
  const [endpointStatuses, setEndpointStatuses] = useState<Record<string, string>>({});
  const [visibleEndpoints, setVisibleEndpoints] = useState<Record<string, boolean>>({});
  const [lastResponse, setLastResponse] = useState("");
  const [deckToasts, setDeckToasts] = useState<ToastMessage[]>([]);
  const [actionSearch, setActionSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [dangerFilter, setDangerFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [routineOnly, setRoutineOnly] = useState(false);
  const [routineStatus, setRoutineStatus] = useState("");
  const [routineForm, setRoutineForm] = useState<{
    id?: string;
    name: string;
    description: string;
    enabled: boolean;
    steps: RoutineStep[];
    selectedActionId: string;
  }>({
    name: "",
    description: "",
    enabled: true,
    steps: [],
    selectedActionId: ""
  });
  const routineSelectableActions = actions
    .filter((action) => action.enabled && action.id !== "deck.routine.run")
    .sort((a, b) => a.id.localeCompare(b.id));
  const moduleOptions = useMemo(() => Array.from(new Set(actions.map((action) => action.module))).sort(), [actions]);
  const dangerOptions = useMemo(() => Array.from(new Set(actions.map((action) => action.dangerLevel))).sort(), [actions]);
  const actionSearchTerm = actionSearch.trim().toLowerCase();
  const filteredActions = useMemo(() => actions.filter((action) => {
    const projectMatch = action.id.match(/^dev\.project\.([a-z0-9-]+)\./);
    const matchesSearch = !actionSearchTerm
      || action.id.toLowerCase().includes(actionSearchTerm)
      || action.title.toLowerCase().includes(actionSearchTerm);
    const matchesModule = moduleFilter === "all" || action.module === moduleFilter;
    const matchesDanger = dangerFilter === "all" || action.dangerLevel === dangerFilter;
    const matchesProject = projectFilter === "all" || projectMatch?.[1] === projectFilter;
    const matchesPinned = !pinnedOnly || pinnedActionIds.includes(action.id);
    const matchesRoutine = !routineOnly || action.id.startsWith("deck.routine.");
    return matchesSearch && matchesModule && matchesDanger && matchesProject && matchesPinned && matchesRoutine;
  }).sort((a, b) => a.id.localeCompare(b.id)), [actions, actionSearchTerm, dangerFilter, moduleFilter, pinnedActionIds, pinnedOnly, projectFilter, routineOnly]);
  const projectActionGroups = useMemo(() => projects.map((project) => ({
    project,
    actions: filteredActions.filter((action) => action.id.startsWith(`dev.project.${project.id}.`))
  })).filter((group) => group.actions.length > 0), [filteredActions, projects]);
  const browserActions = filteredActions.filter((action) => !action.id.startsWith("dev.project."));

  function showDeckToast(message: string, tone: ToastTone): void {
    const id = `deck-toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setDeckToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setDeckToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }

  function dangerTone(action: ActionDefinition): "neutral" | "success" | "error" | "warning" | "info" {
    if (action.dangerLevel === "critical" || action.dangerLevel === "danger") {
      return "error";
    }
    if (action.dangerLevel === "caution") {
      return "warning";
    }
    return "success";
  }

  function endpointForAction(actionId: string): string {
    return `${endpoint ?? "http://127.0.0.1:43217"}/actions/${actionId}`;
  }

  function controlEndpoint(path: string): string {
    return `${endpoint ?? "http://127.0.0.1:43217"}${path}`;
  }

  async function copyText(value: string, message = "Copied."): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      showDeckToast(message, "success");
    } catch {
      showDeckToast("Copy failed.", "error");
    }
  }

  async function testControlEndpoint(path: string, init?: RequestInit): Promise<void> {
    try {
      const response = await fetch(controlEndpoint(path), init);
      const text = await response.text();
      setLastResponse(`${response.status} ${text.slice(0, 600)}`);
      showDeckToast(response.ok ? "Endpoint responded." : "Endpoint failed.", response.ok ? "success" : "error");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Endpoint failed.";
      setLastResponse(message);
      showDeckToast(message, "error");
    }
  }

  async function runEndpointAction(actionId: string): Promise<void> {
    const action = actions.find((item) => item.id === actionId);
    const needsConfirmation = action?.dangerLevel === "danger" || action?.dangerLevel === "critical";
    const confirmedDangerous = needsConfirmation
      ? window.confirm(`Run ${action?.title ?? actionId}? Danger level: ${action?.dangerLevel}.`)
      : false;

    if (needsConfirmation && !confirmedDangerous) {
      return;
    }

    setEndpointStatuses((current) => ({ ...current, [actionId]: "Running..." }));

    try {
      const response = await fetch(endpointForAction(actionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, confirmedDangerous })
      });

      if (!response.ok) {
        await getBridge().logActionResult({
          actionId,
          status: "failed",
          source: "module_ui",
          summary: `${actionId} endpoint test failed.`,
          errorMessage: `HTTP ${response.status}`
        });
        setEndpointStatuses((current) => ({ ...current, [actionId]: `Failed: HTTP ${response.status}` }));
        showDeckToast(`${action?.title ?? actionId} failed.`, "error");
      } else {
        setLastResponse(await response.clone().text().catch(() => "Action completed."));
        setEndpointStatuses((current) => ({ ...current, [actionId]: "Success" }));
        showDeckToast(`${action?.title ?? actionId} ran successfully.`, "success");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown endpoint failure.";
      await getBridge().logActionResult({
        actionId,
        status: "failed",
        source: "module_ui",
        summary: `${actionId} endpoint test failed.`,
        errorMessage
      });
      setEndpointStatuses((current) => ({ ...current, [actionId]: `Failed: ${errorMessage}` }));
      showDeckToast(`${action?.title ?? actionId} failed.`, "error");
    }

    await refreshEvents();
  }

  async function copyEndpoint(actionId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(endpointForAction(actionId));
      setEndpointStatuses((current) => ({ ...current, [actionId]: "Endpoint copied" }));
      showDeckToast("Endpoint copied.", "success");
    } catch {
      showDeckToast("Endpoint copy failed.", "error");
    }
  }

  function actionTitle(actionId: string): string {
    return actions.find((action) => action.id === actionId)?.title ?? actionId;
  }

  function resetRoutineForm(): void {
    setRoutineForm({
      name: "",
      description: "",
      enabled: true,
      steps: [],
      selectedActionId: ""
    });
    setRoutineStatus("");
  }

  function editRoutine(routine: DexNestRoutine): void {
    setRoutineForm({
      id: routine.id,
      name: routine.name,
      description: routine.description,
      enabled: routine.enabled,
      steps: routine.steps,
      selectedActionId: routineSelectableActions[0]?.id ?? ""
    });
    setRoutineStatus(`Editing ${routine.name}`);
  }

  function addRoutineStep(): void {
    const actionId = routineForm.selectedActionId || routineSelectableActions[0]?.id;
    if (!actionId) {
      return;
    }

    setRoutineForm((current) => ({
      ...current,
      selectedActionId: actionId,
      steps: [
        ...current.steps,
        {
          id: `routine-step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          actionId,
          params: {}
        }
      ]
    }));
  }

  function moveRoutineStep(index: number, direction: -1 | 1): void {
    setRoutineForm((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.steps.length) {
        return current;
      }

      const steps = [...current.steps];
      [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
      return { ...current, steps };
    });
  }

  function removeRoutineStep(index: number): void {
    setRoutineForm((current) => ({
      ...current,
      steps: current.steps.filter((_step, stepIndex) => stepIndex !== index)
    }));
  }

  async function saveRoutine(): Promise<void> {
    if (!routineForm.name.trim()) {
      setRoutineStatus("Routine name is required.");
      return;
    }

    if (routineForm.steps.length === 0) {
      setRoutineStatus("Add at least one action step.");
      return;
    }

    const actionId = routineForm.id ? "deck.routine.update" : "deck.routine.create";
    const result = await onAction(actionId, "module_ui", {
      id: routineForm.id,
      routineId: routineForm.id,
      name: routineForm.name,
      description: routineForm.description,
      enabled: routineForm.enabled,
      steps: routineForm.steps.map((step) => ({ id: step.id, actionId: step.actionId, params: step.params ?? {} }))
    });

    setRoutineStatus(result.ok ? "Routine saved." : result.error ?? "Routine save failed.");
    showDeckToast(result.ok ? "Routine saved." : result.error ?? "Routine save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      resetRoutineForm();
      await onRefresh();
    }
  }

  async function deleteRoutine(routine: DexNestRoutine): Promise<void> {
    if (!window.confirm(`Delete routine "${routine.name}"?`)) {
      return;
    }

    const result = await onAction("deck.routine.delete", "module_ui", {
      routineId: routine.id,
      confirmedDangerous: true
    });
    setRoutineStatus(result.ok ? "Routine deleted." : result.error ?? "Routine delete failed.");
    showDeckToast(result.ok ? "Routine deleted." : result.error ?? "Routine delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function runRoutine(routine: DexNestRoutine): Promise<void> {
    const hasDangerousStep = routine.steps.some((step) => {
      const action = actions.find((item) => item.id === step.actionId);
      return action?.dangerLevel === "danger" || action?.dangerLevel === "critical" || action?.requiresConfirmation;
    });
    const confirmedDangerous = hasDangerousStep
      ? window.confirm(`Run "${routine.name}"? This routine includes an action that requires confirmation.`)
      : false;

    if (hasDangerousStep && !confirmedDangerous) {
      return;
    }

    setRoutineStatus(`Running ${routine.name}...`);
    const result = await onAction("deck.routine.run", "module_ui", {
      routineId: routine.id,
      confirmedDangerous
    });
    setRoutineStatus(result.ok ? "Routine completed." : result.error ?? "Routine failed.");
    showDeckToast(result.ok ? "Routine completed." : result.error ?? "Routine failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  function renderDeckActionRow(action: ActionDefinition, accentClass = `accent-${action.moduleId}`): React.ReactNode {
    return (
      <article className={`deck-action-row ${accentClass}`} key={action.id}>
        <div className="deck-action-row__main">
          <strong>{action.title}</strong>
          <span className="technical technical--truncate">{action.id}</span>
          {visibleEndpoints[action.id] && (
            <span className="technical technical--truncate">{endpointForAction(action.id)}</span>
          )}
          {endpointStatuses[action.id] && <span className="deck-action-row__status">{endpointStatuses[action.id]}</span>}
        </div>
        <div className="deck-action-row__meta">
          <StatusBadge tone={dangerTone(action)}>{action.dangerLevel}</StatusBadge>
          <button type="button" onClick={() => void runEndpointAction(action.id)}>Run/Test</button>
          <button type="button" onClick={() => void copyEndpoint(action.id)}>Copy endpoint</button>
          <button
            type="button"
            onClick={() => setVisibleEndpoints((current) => ({ ...current, [action.id]: !current[action.id] }))}
          >
            {visibleEndpoints[action.id] ? "Hide endpoint" : "Show endpoint"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <section className="view-stack view-stack--deck accent-deck" aria-labelledby="deck-title">
      <ToastStack toasts={deckToasts} />
      <PageHeader eyebrow="Local action surface" title="Deck" titleId="deck-title" />

      <div className="deck-top-grid">
        <Panel title="Deck endpoint">
          <div className="settings-grid">
            <article><span>Status</span><strong>{endpoint ? "running" : "loading"}</strong><p>Stream Deck control layer.</p></article>
            <article><span>Security</span><strong>{appInfo?.streamDeckSettings.lanEnabled ? "LAN enabled" : "local only"}</strong><p>PIN/token {appInfo?.streamDeckSettings.tokenEnabled ? "enabled" : "disabled"}.</p></article>
            <article><span>Base URL</span><strong className="technical">{endpoint ?? "Loading"}</strong><p>Use localhost by default.</p></article>
          </div>
          <div className="deck-endpoint-strip">
            <PathText>{endpoint ? `${endpoint}/health` : "Loading endpoint"}</PathText>
            <button type="button" onClick={() => void testControlEndpoint("/health")}>Test /health</button>
            <button type="button" onClick={() => void copyText(controlEndpoint("/actions"), "Actions endpoint copied.")}>Copy /actions</button>
            <button type="button" onClick={() => void copyText(controlEndpoint("/actions/pinned"), "Pinned endpoint copied.")}>Copy pinned</button>
            <button type="button" onClick={() => void copyText(controlEndpoint("/routines"), "Routines endpoint copied.")}>Copy routines</button>
            <button type="button" onClick={() => void runEndpointAction("deck.test_endpoint")}>Run test action</button>
          </div>
          {lastResponse && <p className="technical technical--truncate">Last response: {lastResponse}</p>}
        </Panel>
        <Panel title="Pinned Deck Buttons">
          <div className="deck-mini-list">
            {pinnedActionIds.length === 0 ? (
              <EmptyState>No pinned actions yet.</EmptyState>
            ) : (
              pinnedActionIds.map((actionId) => {
                const action = actions.find((item) => item.id === actionId);
                if (!action) return null;
                return (
                  <article className={`deck-step-row accent-${action.moduleId}`} key={action.id}>
                    <strong>{action.title}</strong>
                    <PathText>{action.id}</PathText>
                    <StatusBadge tone={dangerTone(action)}>{action.dangerLevel}</StatusBadge>
                    <button type="button" onClick={() => void runEndpointAction(action.id)}>Run</button>
                  </article>
                );
              })
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Routines">
        <div className="deck-routine-layout">
          <section className="deck-routine-builder">
            <div className="deck-compact-form">
              <label>
                Name
                <input
                  value={routineForm.name}
                  onChange={(event) => setRoutineForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Morning Review"
                />
              </label>
              <label>
                Enabled
                <select
                  value={routineForm.enabled ? "true" : "false"}
                  onChange={(event) => setRoutineForm((current) => ({ ...current, enabled: event.target.value === "true" }))}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              <label className="field-span-2">
                Description
                <input
                  value={routineForm.description}
                  onChange={(event) => setRoutineForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Open the local views I need first."
                />
              </label>
              <label className="field-span-2">
                Add step
                <select
                  value={routineForm.selectedActionId}
                  onChange={(event) => setRoutineForm((current) => ({ ...current, selectedActionId: event.target.value }))}
                >
                  {routineSelectableActions.map((action) => (
                    <option value={action.id} key={action.id}>{action.id}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="button-row">
              <button type="button" onClick={addRoutineStep}>Add step</button>
              <button type="button" onClick={() => void saveRoutine()}>{routineForm.id ? "Update routine" : "Create routine"}</button>
              <button type="button" onClick={resetRoutineForm}>Reset</button>
            </div>
            <div className="deck-mini-list">
              {routineForm.steps.length === 0 ? (
                <EmptyState>No steps added yet.</EmptyState>
              ) : (
                routineForm.steps.map((step, index) => (
                  <article className="deck-step-row" key={step.id}>
                    <span>{index + 1}</span>
                    <strong>{actionTitle(step.actionId)}</strong>
                    <PathText>{step.actionId}</PathText>
                    <div className="button-row">
                      <button type="button" onClick={() => moveRoutineStep(index, -1)}>Up</button>
                      <button type="button" onClick={() => moveRoutineStep(index, 1)}>Down</button>
                      <button type="button" onClick={() => removeRoutineStep(index)}>Remove</button>
                    </div>
                  </article>
                ))
              )}
            </div>
            {routineStatus && <p className="inline-status">{routineStatus}</p>}
            <PathText>{routinesState.routinesPath}</PathText>
          </section>

          <section className="deck-routine-list">
            {routinesState.routines.length === 0 ? (
              <EmptyState>No routines yet.</EmptyState>
            ) : (
              routinesState.routines.map((routine) => (
                <details className="deck-routine-row accent-deck" key={routine.id}>
                  <summary>
                    <span className="library-item__chevron" aria-hidden="true" />
                    <strong>{routine.name}</strong>
                    <StatusBadge tone={routine.enabled ? "success" : "neutral"}>{routine.enabled ? "enabled" : "disabled"}</StatusBadge>
                    <span>{routine.steps.length} steps</span>
                    <span>{routine.lastRunAt ? formatLocalDateTime(routine.lastRunAt) : "never run"}</span>
                  </summary>
                  <div className="deck-routine-row__body">
                    <p>{routine.description || "No description."}</p>
                    <PathText>{routine.id}</PathText>
                    <div className="deck-mini-list">
                      {routine.steps.map((step, index) => (
                        <article className="deck-step-row" key={step.id}>
                          <span>{index + 1}</span>
                          <strong>{actionTitle(step.actionId)}</strong>
                          <PathText>{step.actionId}</PathText>
                        </article>
                      ))}
                    </div>
                    <div className="button-row">
                      <button type="button" onClick={() => void runRoutine(routine)}>Run</button>
                      <button type="button" onClick={() => editRoutine(routine)}>Edit</button>
                      <button type="button" onClick={() => void copyEndpoint("deck.routine.run")}>Copy endpoint</button>
                      <button className="danger-button" type="button" onClick={() => void deleteRoutine(routine)}>Delete</button>
                    </div>
                  </div>
                </details>
              ))
            )}
          </section>
        </div>
      </Panel>

      <Panel title="Action Browser">
        <div className="deck-filter-grid">
          <label>
            Search
            <input value={actionSearch} onChange={(event) => setActionSearch(event.target.value)} placeholder="Action title or ID" />
          </label>
          <label>
            Module
            <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
              <option value="all">All modules</option>
              {moduleOptions.map((module) => <option value={module} key={module}>{module}</option>)}
            </select>
          </label>
          <label>
            Danger
            <select value={dangerFilter} onChange={(event) => setDangerFilter(event.target.value)}>
              <option value="all">All levels</option>
              {dangerOptions.map((danger) => <option value={danger} key={danger}>{danger}</option>)}
            </select>
          </label>
          <label>
            Project
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="all">All projects</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={pinnedOnly} onChange={(event) => setPinnedOnly(event.target.checked)} />
            <span>Pinned only</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={routineOnly} onChange={(event) => setRoutineOnly(event.target.checked)} />
            <span>Routine actions only</span>
          </label>
        </div>
        <div className="deck-panel-scroll">
          {browserActions.length === 0 ? (
            <EmptyState>No matching actions.</EmptyState>
          ) : (
            browserActions.map((action) => renderDeckActionRow(action))
          )}
        </div>
      </Panel>

      <Panel title="Dev Project Actions">
        <div className="deck-panel-scroll">
          {projectActionGroups.length === 0 ? (
            <EmptyState>No matching Dev project actions. Add a project in Dev or adjust filters.</EmptyState>
          ) : (
            projectActionGroups.map((group) => (
              <section className="deck-project-group" key={group.project.id}>
                <div className="deck-project-group__header">
                  <strong>{group.project.name}</strong>
                  <span>{group.actions.length} actions</span>
                  <PathText>{group.project.path}</PathText>
                </div>
                <div className="deck-action-table">
                  {group.actions.map((action) => renderDeckActionRow(action, "accent-dev"))}
                </div>
              </section>
            ))
          )}
        </div>
      </Panel>
    </section>
  );
}

function PlaceholderView({
  id,
  title,
  onAction
}: {
  id: "clipboard" | "drop";
  title: string;
  onAction: (actionId: string) => Promise<void>;
}) {
  const actionId = id === "clipboard" ? "clipboard.open_placeholder" : "drop.open_placeholder";

  return (
    <section className="view-stack" aria-labelledby={`${id}-title`}>
      <PageHeader eyebrow="Placeholder" title={title} titleId={`${id}-title`} />
      <Panel title={`${title} is reserved`}>
        <p>This module stays placeholder-only until the spine is stable.</p>
        <button type="button" onClick={() => void onAction(actionId)}>
          Record safe {title} click
        </button>
      </Panel>
    </section>
  );
}

function AuditView({
  events,
  onRefresh,
  refreshEvents
}: {
  events: EventEntry[];
  onRefresh: (actionId: string) => Promise<void>;
  refreshEvents: () => Promise<void>;
}) {
  async function refresh(): Promise<void> {
    await onRefresh("audit.open_history");
    await refreshEvents();
  }

  return (
    <section className="view-stack" aria-labelledby="audit-title">
      <PageHeader
        eyebrow="SQLite event log"
        title="Recent Events"
        titleId="audit-title"
        actions={(
          <button type="button" onClick={() => void refresh()}>
          Refresh
          </button>
        )}
      />

      <div className="event-list">
        {events.length === 0 ? (
          <p className="empty-state">No events yet. Run an action to populate Audit.</p>
        ) : (
          <LimitedList items={events} step={50}>
            {(event) => (
              <article className="event-row" key={event.id}>
                <p className="technical">{formatLocalDateTime(event.timestamp)}</p>
                <p>{event.module}</p>
                <p className="technical">{event.actionId ?? "none"}</p>
                <p>{event.status}</p>
                <p>{event.source}</p>
                <p>{event.summary}</p>
              </article>
            )}
          </LimitedList>
        )}
      </div>
    </section>
  );
}

function SettingsView({
  appInfo,
  backupState,
  calendarState,
  ambientVoiceState,
  speechState,
  ttsDiagnostics,
  performanceModeState,
  performanceModeSettings,
  wakeWordState,
  wakeEngineState,
  onTestWake,
  onStartWake,
  onStopWake,
  onCheckWake,
  onAction,
  onAmbientVoiceChanged,
  onSpeechStateChanged,
  onTtsDiagnosticsChange,
  onPerformanceChanged,
  onRefresh
}: {
  appInfo: AppInfo | null;
  backupState: BackupState;
  calendarState: CalendarState;
  ambientVoiceState: AmbientVoiceState;
  speechState: SpeechServiceState;
  ttsDiagnostics: TtsDiagnostics;
  performanceModeState: PerformanceModeState;
  performanceModeSettings: PerformanceModeSettings;
  wakeWordState: WakeWordServiceState;
  wakeEngineState: WakeEngineState;
  onTestWake: () => void;
  onStartWake: () => void;
  onStopWake: () => void;
  onCheckWake: () => Promise<void>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onAmbientVoiceChanged: (settings: Partial<AmbientVoiceSettings>) => Promise<void>;
  onSpeechStateChanged: (state: SpeechServiceState) => void;
  onTtsDiagnosticsChange: (diagnostics: TtsDiagnostics) => void;
  onPerformanceChanged: (settings?: Partial<PerformanceModeSettings>, enabled?: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const perf = useSyncExternalStore(subscribePerf, getPerfStats, getPerfStats);
  const [backupOptions, setBackupOptions] = useState<BackupOptions>(backupState.defaultOptions);
  const [restorePath, setRestorePath] = useState("");
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const [healthState, setHealthState] = useState<AppHealthState | null>(null);
  const [healthStatus, setHealthStatus] = useState("");
  const [performanceForm, setPerformanceForm] = useState<PerformanceModeSettings>(performanceModeSettings);
  const [performanceBusy, setPerformanceBusy] = useState(false);
  const [performanceSaving, setPerformanceSaving] = useState(false);
  const [ambientForm, setAmbientForm] = useState<AmbientVoiceSettings>(ambientVoiceState.settings);
  const [ambientSaving, setAmbientSaving] = useState(false);
  const [ambientStatus, setAmbientStatus] = useState("");
  const [speechForm, setSpeechForm] = useState<SpeechSettings>(speechState.settings);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const [micWarmUi, setMicWarmUi] = useState<MicWarmState>(getMicWarmState());
  const [speechMetrics, setSpeechMetrics] = useState<SpeechCaptureMetrics | null>(getLastSpeechMetrics());
  const [audioDevices, setAudioDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [vadMeter, setVadMeter] = useState<VadLiveMeter>(getVadLiveMeter());
  const settingsTtsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeMicWarm(() => setMicWarmUi(getMicWarmState()));
    const unsubscribeMeter = subscribeVadMeter(() => setVadMeter(getVadLiveMeter()));
    void refreshMicPermission();
    void listAudioInputDevices().then(setAudioDevices);
    return () => { unsubscribe(); unsubscribeMeter(); };
  }, []);

  useEffect(() => {
    const refresh = () => {
      onTtsDiagnosticsChange({
        ...ttsDiagnostics,
        ...getTtsDiagnosticsSnapshot(ambientForm.voiceName)
      });
    };
    refresh();
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", refresh);
  }, [ambientForm.voiceName]);

  useEffect(() => {
    // Pre-warm the mic while Speech settings are open, gated by the setting and
    // Performance Mode. Never warms silently elsewhere in the background.
    if (speechState.performancePaused) {
      releaseMic(true);
      return;
    }
    if (speechForm.micPrewarmEnabled !== false && speechForm.speechEngine === "faster_whisper") {
      void prewarmMic(speechForm);
    }
  }, [speechState.performancePaused, speechForm.micPrewarmEnabled, speechForm.speechEngine, speechForm.selectedInputDeviceId, speechForm.noiseSuppression, speechForm.echoCancellation, speechForm.autoGainControl]);

  async function refreshAudioDevices(): Promise<void> {
    setAudioDevices(await listAudioInputDevices());
  }

  async function calibrateRoomNoise(): Promise<void> {
    if (speechState.performancePaused) {
      setSpeechStatus("Speech is paused by Performance Mode — calibration unavailable.");
      return;
    }
    setSpeechBusy(true);
    setSpeechStatus("Calibrating room noise — stay silent for 2 seconds…");
    try {
      const floor = await calibrateNoiseFloor(speechForm, 2000);
      const next = { ...speechForm, noiseFloor: floor, vadMode: "auto" as const };
      setSpeechForm(next);
      await getBridge().saveSpeechSettings({ noiseFloor: floor, vadMode: "auto" });
      onSpeechStateChanged(await getBridge().getSpeechState());
      void onAction("speech.transcribe", "module_ui", { sourceModule: "settings_calibration", status: "success", noiseFloor: floor });
      setSpeechStatus(`Room noise floor: ${floor.toFixed(3)}. Speech threshold ≈ ${(floor + (speechForm.speechThresholdMargin ?? 0.018)).toFixed(3)}.`);
    } catch (error) {
      setSpeechStatus(error instanceof Error ? error.message : "Calibration failed.");
    } finally {
      setSpeechBusy(false);
    }
  }
  const [lifecycleForm, setLifecycleForm] = useState<AppLifecycleSettings>(appInfo?.appLifecycleSettings ?? defaultAppLifecycleSettings);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [keyboardForm, setKeyboardForm] = useState<KeyboardShortcutSettings>(appInfo?.keyboardShortcutSettings ?? defaultKeyboardShortcutSettings);
  const [streamDeckForm, setStreamDeckForm] = useState<StreamDeckSettings>(appInfo?.streamDeckSettings ?? defaultStreamDeckSettings);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [externalState, setExternalState] = useState<ExternalDevicesState>(appInfo?.externalDevicesState ?? defaultExternalDevicesState);
  const [externalForm, setExternalForm] = useState<ExternalDevicesSettings>(appInfo?.externalDevicesState.settings ?? defaultExternalDevicesState.settings);
  const [externalGroupForm, setExternalGroupForm] = useState({
    groupId: "",
    name: "Room lights",
    aliases: "lights, room lights, all lights",
    deviceIds: [] as string[]
  });
  const [goveeApiKeyInput, setGoveeApiKeyInput] = useState("");
  const [externalStatus, setExternalStatus] = useState("");
  const [externalBusy, setExternalBusy] = useState(false);
  const [nudgeSettingsForm, setNudgeSettingsForm] = useState({
    enabled: calendarState.nudgeSettings.enabled,
    vaultExpiryReminderDays: calendarState.nudgeSettings.vaultExpiryReminderDays.join(", "),
    returnReminderDays: calendarState.nudgeSettings.returnReminderDays.join(", "),
    dailyJournalReminderEnabled: calendarState.nudgeSettings.dailyJournalReminderEnabled,
    backupReminderAfterDays: String(calendarState.nudgeSettings.backupReminderAfterDays)
  });

  useEffect(() => {
    setBackupOptions(backupState.defaultOptions);
  }, [backupState.defaultOptions]);

  useEffect(() => {
    setPerformanceForm(performanceModeSettings);
  }, [performanceModeSettings]);

  useEffect(() => {
    setAmbientForm(ambientVoiceState.settings);
  }, [ambientVoiceState.settings]);

  useEffect(() => {
    setSpeechForm(speechState.settings);
  }, [speechState.settings]);

  useEffect(() => {
    if (appInfo?.appLifecycleSettings) {
      setLifecycleForm(appInfo.appLifecycleSettings);
    }
  }, [appInfo?.appLifecycleSettings]);

  useEffect(() => {
    if (appInfo?.keyboardShortcutSettings) {
      setKeyboardForm(appInfo.keyboardShortcutSettings);
    }
    if (appInfo?.streamDeckSettings) {
      setStreamDeckForm(appInfo.streamDeckSettings);
    }
    if (appInfo?.externalDevicesState) {
      setExternalState(appInfo.externalDevicesState);
      setExternalForm(appInfo.externalDevicesState.settings);
    }
  }, [appInfo?.keyboardShortcutSettings, appInfo?.streamDeckSettings, appInfo?.externalDevicesState]);

  useEffect(() => {
    setNudgeSettingsForm({
      enabled: calendarState.nudgeSettings.enabled,
      vaultExpiryReminderDays: calendarState.nudgeSettings.vaultExpiryReminderDays.join(", "),
      returnReminderDays: calendarState.nudgeSettings.returnReminderDays.join(", "),
      dailyJournalReminderEnabled: calendarState.nudgeSettings.dailyJournalReminderEnabled,
      backupReminderAfterDays: String(calendarState.nudgeSettings.backupReminderAfterDays)
    });
  }, [calendarState.nudgeSettings]);

  useEffect(() => {
    void runHealthCheck();
  }, []);

  const rows = [
    ["Data root", appInfo?.dataRoot ?? "Loading"],
    ["Database", appInfo?.dbPath ?? "Loading"],
    ["Local endpoint", appInfo?.actionEndpoint ?? "Loading"],
    ["Command settings", appInfo?.commandSettingsPath ?? "Loading"],
    ["Keyboard shortcuts", appInfo?.keyboardShortcutsPath ?? "Loading"],
    ["Stream Deck settings", appInfo?.streamDeckSettingsPath ?? "Loading"],
    ["Global Command shortcut", appInfo ? `${appInfo.commandShortcutEnabled ? "enabled" : "disabled"} / ${appInfo.commandShortcut}` : "Loading"],
    ["Command shortcut status", appInfo ? `${appInfo.commandShortcutStatus}${appInfo.commandShortcutLastError ? ` / ${appInfo.commandShortcutLastError}` : ""}` : "Loading"],
    ["Tray status", appInfo?.trayStatus ?? "Loading"],
    ["Speech settings", appInfo?.speechSettingsPath ?? speechState.settingsPath],
    ["Speech models", appInfo?.speechModelsRoot ?? speechState.modelRoot],
    ["Speech debug audio", appInfo?.speechDebugAudioRoot ?? speechState.debugAudioRoot],
    ["Speech engine", `${speechState.settings.speechEngine} / ${speechState.settings.modelName}`],
    ["Speech status", speechState.modelStatus.message],
    ["Ambient Voice settings", appInfo?.ambientVoiceSettingsPath ?? ambientVoiceState.settingsPath],
    ["Ambient Voice status", `${ambientVoiceState.settings.ambientVoiceEnabled ? "enabled" : "disabled"} / ${ambientVoiceState.currentState}`],
    ["Ambient push-to-talk", `${ambientVoiceState.settings.pushToTalkShortcut} / ${ambientVoiceState.settings.pushToTalkShortcutStatus}`],
    ["App lifecycle settings", appInfo?.appLifecycleSettingsPath ?? "Loading"],
    ["Close behavior", appInfo?.appLifecycleSettings.closeBehavior.replaceAll("_", " ") ?? "Loading"],
    ["Windows auto-start", appInfo ? `${appInfo.appLifecycleSettings.startDexNestWithWindows ? "enabled" : "disabled"} / ${appInfo.appLifecycleSettings.loginItemStatus}` : "Loading"],
    ["Tray window mode", appInfo?.appLifecycleSettings.trayModeActive ? "hidden in tray" : "normal window"],
    ["Performance mode", performanceModeState.enabled ? `ON / ${performanceModeState.reason}` : "OFF"],
    ["Performance settings", appInfo?.performanceModeSettingsPath ?? "Loading"],
    ["Backup folder", appInfo?.backupFolderPath ?? backupState.backupFolderPath ?? "Loading"],
    ["Restore staging", appInfo?.restoreStagingPath ?? backupState.restoreStagingPath ?? "Loading"],
    ["Package mode", appInfo?.packageMode ?? "Loading"],
    ["Current branch", appInfo?.currentBranch ?? "unknown"],
    ["Projects config", appInfo?.projectsConfigPath ?? "Loading"],
    ["Clipboard history", appInfo?.clipboardHistoryPath ?? "Loading"],
    ["Clipboard snippets", appInfo?.clipboardSnippetsPath ?? "Loading"],
    ["Drop shelf", appInfo?.dropShelfPath ?? "Loading"],
    ["Drop incoming metadata", appInfo?.dropIncomingPath ?? "Loading"],
    ["Drop receive folder", appInfo?.dropReceiveFolderPath ?? "Loading"],
    ["Drop outgoing folder", appInfo?.dropOutgoingFolderPath ?? "Loading"],
    ["Drop temp folder", appInfo?.dropTempFolderPath ?? "Loading"],
    ["Tools input folder", appInfo?.toolsInputFolderPath ?? "Loading"],
    ["Tools output folder", appInfo?.toolsOutputFolderPath ?? "Loading"],
    ["Tools default output", appInfo?.toolsDefaultOutputFolderPath ?? "Loading"],
    ["Tools temp folder", appInfo?.toolsTempFolderPath ?? "Loading"],
    ["Tools outputs metadata", appInfo?.toolsOutputsPath ?? "Loading"],
    ["Vault documents", appInfo?.vaultDocumentsPath ?? "Loading"],
    ["Vault OCR output", appInfo?.vaultOcrOutputPath ?? "Loading"],
    ["Vault OCR jobs", appInfo?.vaultOcrJobsPath ?? "Loading"],
    ["Vault OCR settings", appInfo?.vaultOcrSettingsPath ?? "Loading"],
    ["Search index", appInfo?.searchIndexPath ?? "Loading"],
    ["Search index folder", appInfo?.searchIndexFolderPath ?? "Loading"],
    ["Saved searches", appInfo?.savedSearchesPath ?? "Loading"],
    ["Journal entries", appInfo?.journalEntriesPath ?? "Loading"],
    ["Calendar events", appInfo?.calendarEventsPath ?? "Loading"],
    ["Nudges", appInfo?.nudgesPath ?? "Loading"],
    ["Nudge settings", appInfo?.nudgeSettingsPath ?? "Loading"],
    ["Finder items", appInfo?.finderItemsPath ?? "Loading"],
    ["Finance transactions", appInfo?.financeTransactionsPath ?? "Loading"],
    ["Finance recurring", appInfo?.financeRecurringPath ?? "Loading"],
    ["Finance settings", appInfo?.financeSettingsPath ?? "Loading"],
    ["Receipts folder", appInfo?.receiptsPath ?? "Loading"],
    ["Capture items", appInfo?.captureItemsPath ?? "Loading"],
    ["Capture files", appInfo?.capturesPath ?? "Loading"],
    ["Routines", appInfo?.routinesPath ?? "Loading"],
    ["Heatmap events", appInfo?.heatmapEventsPath ?? "Loading"],
    ["Heatmap settings", appInfo?.heatmapSettingsPath ?? "Loading"],
    ["Heatmap goals", appInfo?.heatmapGoalsPath ?? "Loading"],
    ["External Devices settings", appInfo?.externalDevicesSettingsPath ?? externalState.settingsPath],
    ["External Devices cache", appInfo?.externalDevicesCachePath ?? externalState.cachePath],
    ["External Devices groups", appInfo?.externalDevicesGroupsPath ?? externalState.groupsPath],
    ["Govee provider", `${externalState.settings.goveeEnabled ? "enabled" : "disabled"} / ${externalState.providerStatus}`],
    ["Detected local timezone", appInfo?.localTimeZone ?? "Loading"],
    ["Current local date/time", appInfo?.localDateTimePreview ?? formatLocalDateTime(new Date())],
    ["Current local date", appInfo?.localToday ? formatLocalDate(appInfo.localToday) : formatLocalDate(getLocalTodayDateString())],
    ["Drop phone URL", appInfo?.dropPhoneUrl ?? "Loading"],
    ["Detected LAN IP", appInfo?.lanIp ?? "Not detected"],
    ["Saved projects", String(appInfo?.projectCount ?? 0)],
    ["App version", "0.1.0"]
  ];

  function updateBackupOption(key: keyof BackupOptions, value: boolean): void {
    setBackupOptions((current) => ({ ...current, [key]: value }));
  }

  function updatePerformanceOption(key: keyof PerformanceModeSettings, value: boolean): void {
    setPerformanceForm((current) => ({ ...current, [key]: value }));
  }

  async function savePerformanceOptions(): Promise<void> {
    setPerformanceSaving(true);
    try {
      await onPerformanceChanged(performanceForm);
      setHealthStatus("Performance Mode settings saved.");
    } finally {
      setPerformanceSaving(false);
    }
  }

  async function togglePerformanceMode(): Promise<void> {
    const nextEnabled = !performanceModeState.enabled;
    setPerformanceBusy(true);
    try {
      await onPerformanceChanged(undefined, nextEnabled);
      setHealthStatus(`Performance Mode ${nextEnabled ? "enabled" : "disabled"}.`);
    } finally {
      setPerformanceBusy(false);
    }
  }

  function updateAmbientOption<K extends keyof AmbientVoiceSettings>(key: K, value: AmbientVoiceSettings[K]): void {
    setAmbientForm((current) => ({ ...current, [key]: value }));
  }

  async function saveAmbientVoiceOptions(): Promise<void> {
    setAmbientSaving(true);
    try {
      await onAmbientVoiceChanged(ambientForm);
      setAmbientStatus("Ambient Voice settings saved.");
      await runHealthCheck();
    } finally {
      setAmbientSaving(false);
    }
  }

  async function startAmbientVoiceTest(): Promise<void> {
    setAmbientStatus("Opening Ask DexNest for a visible push-to-talk test.");
    await getBridge().startAmbientListening({ source: "module_ui" });
    await onAction("voice.ambient.test_microphone", "module_ui", {
      currentState: ambientVoiceState.currentState,
      pushToTalkShortcut: ambientVoiceState.settings.pushToTalkShortcut
    });
    await onRefresh();
  }

  async function testAmbientCommandRoute(): Promise<void> {
    await onAction("voice.ambient.test_command", "module_ui", {
      route: "Ask DexNest",
      speakResponses: ambientForm.speakResponses,
      allowSensitiveLookups: ambientForm.allowSensitiveLookups
    });
    setAmbientStatus("Ambient test command recorded. Use Ask DexNest for the live routing path.");
  }

  function testVoiceOverlay(): void {
    // Scripted preview: wake pulse → listening → processing → speaking → fade.
    const bridge = getBridge();
    bridge.voiceOverlay({ type: "state", state: "wake_detected" });
    const levels = window.setInterval(() => bridge.voiceOverlay({ type: "level", level: 0.3 + Math.random() * 0.6 }), 100);
    window.setTimeout(() => bridge.voiceOverlay({ type: "state", state: "listening" }), 500);
    window.setTimeout(() => { window.clearInterval(levels); bridge.voiceOverlay({ type: "state", state: "transcribing" }); }, 2600);
    window.setTimeout(() => bridge.voiceOverlay({ type: "state", state: "speaking" }), 3800);
    window.setTimeout(() => bridge.voiceOverlay({ type: "hide" }), 5400);
    setAmbientStatus("Testing desktop voice overlay…");
  }

  async function testLocalTts(): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setAmbientStatus("Local OS speech synthesis is not available in this renderer.");
      onTtsDiagnosticsChange({
        ...defaultTtsDiagnostics,
        available: false,
        lastAttemptedAt: new Date().toISOString(),
        lastSpoken: false,
        blockedReason: "speech_synthesis_unavailable",
        lastSource: "module_ui",
        lastActionId: "voice.tts_response",
        lastTextPreview: "DexNest voice test."
      });
      await onAction("voice.tts_response", "module_ui", { ttsSpoken: false, blockedReason: "speech_synthesis_unavailable", sensitivity: "none" });
      return;
    }
    const phrase = "DexNest voice test.";
    const diagnosticsBase = {
      ...defaultTtsDiagnostics,
      ...getTtsDiagnosticsSnapshot(ambientForm.voiceName),
      lastAttemptedAt: new Date().toISOString(),
      lastSource: "module_ui",
      lastActionId: "voice.tts_response",
      lastTextPreview: phrase
    };
    try {
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.rate = clampTtsRate(ambientForm.voiceRate);
      utterance.volume = clampTtsVolume(ambientForm.voiceVolume);
      const voice = ambientForm.voiceName ? window.speechSynthesis.getVoices().find((item) => item.name === ambientForm.voiceName) : undefined;
      if (voice) {
        utterance.voice = voice;
      }
      settingsTtsUtteranceRef.current = utterance;
      utterance.onstart = () => onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: true, blockedReason: "", error: "" });
      utterance.onend = () => {
        settingsTtsUtteranceRef.current = null;
        onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: true, blockedReason: "", error: "" });
      };
      utterance.onerror = (event) => {
        settingsTtsUtteranceRef.current = null;
        const error = event.error || "speech_synthesis_error";
        onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: false, blockedReason: error, error });
        setAmbientStatus(`Voice test failed: ${error}`);
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: true, blockedReason: "", error: "" });
      setAmbientStatus("Speaking local test phrase.");
      await onAction("voice.tts_response", "module_ui", { ttsAttempted: true, ttsSpoken: true, sensitivity: "none", actionId: "voice.tts_response" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice test failed.";
      settingsTtsUtteranceRef.current = null;
      onTtsDiagnosticsChange({ ...diagnosticsBase, lastSpoken: false, blockedReason: "speak_failed", error: message });
      setAmbientStatus(message);
      await onAction("voice.tts_response", "module_ui", { ttsAttempted: true, ttsSpoken: false, blockedReason: "speak_failed", error: message, sensitivity: "none", actionId: "voice.tts_response" });
    }
  }

  function updateSpeechOption<K extends keyof SpeechSettings>(key: K, value: SpeechSettings[K]): void {
    setSpeechForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSpeechOptions(): Promise<void> {
    setSpeechBusy(true);
    try {
      const result = await getBridge().saveSpeechSettings(speechForm);
      onSpeechStateChanged(result.speechState);
      setSpeechStatus("Speech settings saved.");
      await onRefresh();
    } catch (error) {
      setSpeechStatus(error instanceof Error ? error.message : "Speech settings failed.");
    } finally {
      setSpeechBusy(false);
    }
  }

  async function checkSpeechModel(): Promise<void> {
    setSpeechBusy(true);
    setSpeechStatus("Checking local speech model...");
    try {
      const result = await getBridge().checkSpeechModel();
      onSpeechStateChanged(result.speechState);
      setSpeechStatus(result.status.message);
    } finally {
      setSpeechBusy(false);
    }
  }

  async function installSpeechModel(): Promise<void> {
    if (!window.confirm(`Download or verify ${speechForm.modelName} under local-data/models/speech?`)) {
      return;
    }
    setSpeechBusy(true);
    setSpeechStatus("Installing/verifying local speech model...");
    try {
      const result = await getBridge().installSpeechModel();
      onSpeechStateChanged(result.speechState);
      setSpeechStatus(result.status.message);
    } finally {
      setSpeechBusy(false);
    }
  }

  async function warmSpeechEngine(): Promise<void> {
    setSpeechBusy(true);
    setSpeechStatus("Warming faster-whisper engine (loads the model once)...");
    try {
      const result = await getBridge().warmSpeechEngine();
      onSpeechStateChanged(result.speechState);
      const diag = result.speechState.warmDiagnostics;
      setSpeechStatus(result.ok
        ? `Speech engine ready (${diag?.device ?? "cpu"}/${diag?.computeType ?? "int8"}, loaded in ${diag?.loadLatencyMs ?? "?"}ms).`
        : `Warm failed: ${result.error ?? "unknown error"}`);
    } finally {
      setSpeechBusy(false);
    }
  }

  async function testSpeechMic(): Promise<void> {
    setSpeechBusy(true);
    setSpeechStatus("Listening… speak now, DexNest stops when you pause.");
    try {
      const result = await runSharedSpeechCapture({ speechState: { ...speechState, settings: speechForm }, source: "module_ui", sourceModule: "settings_speech_test", manualOverride: true });
      if (result.speechState) {
        onSpeechStateChanged(result.speechState);
      }
      if (result.metrics) {
        setSpeechMetrics(result.metrics);
      }
      // Metadata-only audit of the mic test (no transcript/audio).
      void onAction("speech.transcribe", "module_ui", {
        sourceModule: "settings_speech_test",
        engine: result.engine,
        status: result.status,
        micClickToRecordingMs: result.metrics?.micClickToRecordingMs ?? null,
        speechDetectedAtMs: result.metrics?.speechDetectedAtMs ?? null,
        silenceStopDelayMs: result.metrics?.silenceStopDelayMs ?? null,
        stopReason: result.metrics?.stopReason ?? null,
        transcriptionLatencyMs: result.metrics?.transcriptionLatencyMs ?? null,
        vadOutcome: result.metrics?.vadOutcome ?? null
      });
      setSpeechStatus(result.status === "success"
        ? `Transcribed ${result.transcript.length} chars · ${result.engine} · mic→rec ${result.metrics?.micClickToRecordingMs ?? "?"}ms · transcribe ${result.metrics?.transcriptionLatencyMs ?? result.durationMs}ms.`
        : result.status === "cancelled"
          ? "No speech detected — cancelled cleanly."
          : result.error ?? "Speech test failed.");
    } catch (error) {
      setSpeechStatus(error instanceof Error ? error.message : "Speech test failed.");
    } finally {
      setSpeechBusy(false);
    }
  }

  function updateLifecycleOption<K extends keyof AppLifecycleSettings>(key: K, value: AppLifecycleSettings[K]): void {
    setLifecycleForm((current) => ({ ...current, [key]: value }));
  }

  async function saveLifecycleOptions(): Promise<void> {
    setLifecycleSaving(true);
    try {
      const result = await onAction("system.lifecycle.update_settings", "module_ui", lifecycleForm) as { ok?: boolean; error?: string };
      setHealthStatus(result.ok === false ? result.error ?? "Startup and tray settings saved with warnings." : "Startup and tray settings saved.");
      await onRefresh();
      await runHealthCheck();
    } finally {
      setLifecycleSaving(false);
    }
  }

  async function testTrayNotification(): Promise<void> {
    setLifecycleBusy(true);
    try {
      const result = await onAction("system.lifecycle.test_tray_notice", "module_ui", {}) as { ok?: boolean; error?: string };
      setHealthStatus(result.ok === false ? result.error ?? "Tray notification failed." : "Tray notification sent.");
      await onRefresh();
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function quitDexNestFromSettings(): Promise<void> {
    if (!window.confirm("Quit DexNest fully? This bypasses close-to-tray and exits the app.")) {
      return;
    }
    await onAction("system.lifecycle.quit_full", "module_ui", { confirmedDangerous: true });
  }

  function updateKeyboardMapping(id: string, patch: Partial<KeyboardShortcutMapping>): void {
    setKeyboardForm((current) => ({
      ...current,
      mappings: current.mappings.map((mapping) => mapping.id === id ? { ...mapping, ...patch } : mapping)
    }));
  }

  async function saveControlSettings(): Promise<void> {
    setControlsSaving(true);
    try {
      await onAction("system.keyboard_shortcuts.update_settings", "module_ui", keyboardForm);
      await onAction("system.stream_deck.update_settings", "module_ui", streamDeckForm);
      setHealthStatus("Controls and shortcuts saved.");
      await onRefresh();
      await runHealthCheck();
    } finally {
      setControlsSaving(false);
    }
  }

  async function resetKeyboardShortcuts(): Promise<void> {
    const result = await onAction("system.keyboard_shortcuts.reset_defaults", "module_ui", {}) as { ok?: boolean; keyboardShortcutSettings?: KeyboardShortcutSettings; error?: string };
    if (result.keyboardShortcutSettings) {
      setKeyboardForm(result.keyboardShortcutSettings);
    }
    setHealthStatus(result.ok === false ? result.error ?? "Shortcut reset failed." : "Keyboard shortcuts reset.");
    await onRefresh();
  }

  async function disableAllKeyboardShortcuts(): Promise<void> {
    const result = await onAction("system.keyboard_shortcuts.disable_all", "module_ui", {}) as { ok?: boolean; keyboardShortcutSettings?: KeyboardShortcutSettings; error?: string };
    if (result.keyboardShortcutSettings) {
      setKeyboardForm(result.keyboardShortcutSettings);
    }
    setHealthStatus(result.ok === false ? result.error ?? "Shortcut disable failed." : "Keyboard shortcuts disabled.");
    await onRefresh();
  }

  async function refreshExternalDevicesState(): Promise<void> {
    const next = await getBridge().getExternalDevicesState();
    setExternalState(next);
    setExternalForm(next.settings);
  }

  async function saveExternalDevicesSettings(): Promise<void> {
    setExternalBusy(true);
    try {
      const result = await onAction("external.govee.update_settings", "module_ui", {
        ...externalForm,
        apiKey: goveeApiKeyInput
      }) as { ok?: boolean; error?: string; externalDevicesState?: ExternalDevicesState; message?: string };
      setGoveeApiKeyInput("");
      if (result.externalDevicesState) {
        setExternalState(result.externalDevicesState);
        setExternalForm(result.externalDevicesState.settings);
      } else {
        await refreshExternalDevicesState();
      }
      setExternalStatus(result.ok === false ? result.error ?? "Govee settings failed." : result.message ?? "Govee settings saved.");
      await onRefresh();
    } finally {
      setExternalBusy(false);
    }
  }

  async function runExternalAction(actionId: string, params: Record<string, unknown> = {}): Promise<void> {
    setExternalBusy(true);
    try {
      const result = await onAction(actionId, "module_ui", params) as { ok?: boolean; error?: string; message?: string; externalDevicesState?: ExternalDevicesState };
      if (result.externalDevicesState) {
        setExternalState(result.externalDevicesState);
        setExternalForm(result.externalDevicesState.settings);
      } else {
        await refreshExternalDevicesState();
      }
      setExternalStatus(result.ok === false ? result.error ?? "Govee action failed." : result.message ?? "Govee action completed.");
      await onRefresh();
    } finally {
      setExternalBusy(false);
    }
  }

  function updateExternalOption<K extends keyof ExternalDevicesSettings>(key: K, value: ExternalDevicesSettings[K]): void {
    setExternalForm((current) => ({ ...current, [key]: value }));
  }

  function updateExternalDeviceAlias(deviceId: string, patch: Partial<Pick<ExternalDeviceCacheItem, "userAlias" | "roomAlias">>): void {
    setExternalState((current) => ({
      ...current,
      devices: current.devices.map((device) => device.deviceId === deviceId ? { ...device, ...patch } : device)
    }));
  }

  function toggleExternalGroupDevice(deviceId: string, checked: boolean): void {
    setExternalGroupForm((current) => ({
      ...current,
      deviceIds: checked
        ? [...new Set([...current.deviceIds, deviceId])]
        : current.deviceIds.filter((item) => item !== deviceId)
    }));
  }

  function editExternalGroup(group: ExternalDeviceGroup): void {
    setExternalGroupForm({
      groupId: group.id,
      name: group.name,
      aliases: group.aliases.join(", "),
      deviceIds: group.deviceIds
    });
  }

  function resetExternalGroupForm(): void {
    setExternalGroupForm({
      groupId: "",
      name: "Room lights",
      aliases: "lights, room lights, all lights",
      deviceIds: []
    });
  }

  async function saveExternalGroup(): Promise<void> {
    const result = await onAction("external.govee.update_group", "module_ui", externalGroupForm) as { ok?: boolean; error?: string; message?: string; externalDevicesState?: ExternalDevicesState };
    if (result.externalDevicesState) {
      setExternalState(result.externalDevicesState);
      setExternalForm(result.externalDevicesState.settings);
    } else {
      await refreshExternalDevicesState();
    }
    setExternalStatus(result.ok === false ? result.error ?? "Group save failed." : result.message ?? "Group saved.");
    if (result.ok !== false) {
      resetExternalGroupForm();
    }
    await onRefresh();
  }

  async function deleteExternalGroup(groupId: string): Promise<void> {
    if (!window.confirm("Delete this local Govee group? Devices and aliases stay intact.")) {
      return;
    }
    const result = await onAction("external.govee.delete_group", "module_ui", { groupId, confirmedDangerous: true }) as { ok?: boolean; error?: string; message?: string; externalDevicesState?: ExternalDevicesState };
    if (result.externalDevicesState) {
      setExternalState(result.externalDevicesState);
      setExternalForm(result.externalDevicesState.settings);
    } else {
      await refreshExternalDevicesState();
    }
    setExternalStatus(result.ok === false ? result.error ?? "Group delete failed." : result.message ?? "Group deleted.");
    await onRefresh();
  }

  async function createRoomLightsGroupFromAllDevices(): Promise<void> {
    setExternalGroupForm({
      groupId: "",
      name: "Room lights",
      aliases: "lights, room lights, all lights",
      deviceIds: externalState.devices.map((device) => device.deviceId)
    });
  }

  async function createBackupNow(): Promise<void> {
    setBackupMessage("Creating DexNest backup...");
    const result = await onAction("backup.create", "module_ui", backupOptions) as { ok?: boolean; path?: string; sizeBytes?: number; error?: string };
    setBackupMessage(result.ok ? `Backup created: ${result.path ?? ""} (${formatBytes(result.sizeBytes ?? 0)})` : result.error ?? "Backup failed.");
    await onRefresh();
  }

  async function chooseRestoreZip(): Promise<void> {
    const selected = await getBridge().selectBackupZip();
    if (!selected) {
      return;
    }
    setRestorePath(selected);
    setRestorePreview(null);
    setBackupMessage("Backup selected. Preview it before restoring.");
  }

  async function previewRestore(): Promise<void> {
    if (!restorePath) {
      setBackupMessage("Select a backup zip first.");
      return;
    }
    const result = await onAction("backup.preview_restore", "module_ui", { path: restorePath }) as { ok?: boolean; preview?: BackupPreview; error?: string };
    const preview = result.preview;
    setRestorePreview(preview ?? null);
    setBackupMessage(preview?.ok ? `Preview ready: ${preview.topLevel.join(", ") || "no restorable roots"}` : preview?.error ?? result.error ?? "Preview failed.");
    await onRefresh();
  }

  async function restoreConfirmed(): Promise<void> {
    if (!restorePath) {
      setBackupMessage("Select a backup zip first.");
      return;
    }
    if (!window.confirm("Restore will replace current DexNest local settings/files/data/index from this backup. DexNest will create a safety backup first. Continue?")) {
      setBackupMessage("Restore cancelled.");
      return;
    }
    const result = await onAction("backup.restore_confirmed", "module_ui", { path: restorePath, confirmedDangerous: true }) as { ok?: boolean; restored?: string[]; safetyBackupPath?: string; error?: string };
    setBackupMessage(result.ok ? `Restore completed: ${(result.restored ?? []).join(", ")}. Safety backup: ${result.safetyBackupPath ?? "created"}` : result.error ?? "Restore failed.");
    await onRefresh();
  }

  async function runHealthCheck(): Promise<void> {
    setHealthStatus("Running DexNest App Health checks...");
    const result = await onAction("system.health.run_checks", "module_ui", {}) as { ok?: boolean; health?: AppHealthState; error?: string };
    if (result.health) {
      setHealthState(result.health);
      setHealthStatus(`Checked ${formatLocalDateTime(result.health.checkedAt)}.`);
      return;
    }

    try {
      const health = await getBridge().getAppHealth();
      setHealthState(health);
      setHealthStatus(`Checked ${formatLocalDateTime(health.checkedAt)}.`);
    } catch (error) {
      setHealthStatus(error instanceof Error ? error.message : "DexNest App Health check failed.");
    }
  }

  async function updateCommandSettings(params: Record<string, unknown>): Promise<void> {
    await onAction("command.update_settings", "module_ui", params);
    await onRefresh();
    await runHealthCheck();
  }

  function parseNudgeDayList(value: string): number[] {
    return value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0)
      .sort((left, right) => right - left);
  }

  async function updateNudgeSettings(): Promise<void> {
    await onAction("calendar.nudge.update_settings", "module_ui", {
      nudgeSettings: {
        enabled: nudgeSettingsForm.enabled,
        vaultExpiryReminderDays: parseNudgeDayList(nudgeSettingsForm.vaultExpiryReminderDays),
        returnReminderDays: parseNudgeDayList(nudgeSettingsForm.returnReminderDays),
        dailyJournalReminderEnabled: nudgeSettingsForm.dailyJournalReminderEnabled,
        backupReminderAfterDays: Number(nudgeSettingsForm.backupReminderAfterDays) || 7
      }
    });
    await onRefresh();
  }

  function healthTone(status: HealthStatus): "success" | "warning" | "error" {
    if (status === "pass") {
      return "success";
    }
    return status === "warn" ? "warning" : "error";
  }

  return (
    <section className="view-stack" aria-labelledby="settings-title">
      <PageHeader eyebrow="Local-only configuration" title="Settings" titleId="settings-title" />

      <Panel title="Command Access">
        <div className="settings-grid">
          <article>
            <span>Global shortcut</span>
            <strong>{appInfo?.commandShortcutEnabled ? "Enabled" : "Disabled"}</strong>
            <p className="technical">{appInfo?.commandShortcut ?? "Loading"}</p>
          </article>
          <article>
            <span>Registration</span>
            <strong>{appInfo?.commandShortcutStatus ?? "Loading"}</strong>
            <p>{appInfo?.commandShortcutLastError ?? "Ctrl+Space opens DexNest Command when active."}</p>
          </article>
          <article>
            <span>Tray</span>
            <strong>{appInfo?.trayStatus ?? "Loading"}</strong>
            <p>Tray menu opens Command, Clipboard, Drop, Dev, Journal, and Settings.</p>
          </article>
        </div>
        <div className="registry-controls">
          <label>
            Shortcut
            <select
              value={appInfo?.commandShortcut ?? "CommandOrControl+Space"}
              onChange={(event) => void updateCommandSettings({ globalShortcut: event.target.value })}
            >
              <option value="CommandOrControl+Space">Ctrl+Space</option>
              <option value="CommandOrControl+Alt+Space">Ctrl+Alt+Space</option>
              <option value="CommandOrControl+Shift+Space">Ctrl+Shift+Space</option>
            </select>
          </label>
          <div className="button-row button-row--align-end">
            <button
              type="button"
              className={appInfo?.commandShortcutEnabled ? "button-danger" : "button-primary"}
              onClick={() => void updateCommandSettings({ globalShortcutEnabled: !appInfo?.commandShortcutEnabled })}
            >
              {appInfo?.commandShortcutEnabled ? "Disable shortcut" : "Enable shortcut"}
            </button>
            <button type="button" onClick={() => void updateCommandSettings({})}>
              Re-register shortcut
            </button>
          </div>
        </div>
        <p>Some apps may reserve shortcuts. Use a fallback if Ctrl+Space cannot register.</p>
      </Panel>

      <Panel title="Speech / Voice Engine">
        <div className="settings-grid">
          <article>
            <span>Engine</span>
            <strong>{speechState.settings.speechEngine}</strong>
            <p>{speechState.modelStatus.message}</p>
          </article>
          <article>
            <span>Model</span>
            <strong>{speechState.settings.modelName}</strong>
            <p className="technical">{speechState.modelRoot}</p>
          </article>
          <article>
            <span>Device</span>
            <strong>{speechState.modelStatus.deviceDetected}</strong>
            <p>{speechState.performancePaused ? "Paused by Performance Mode." : "Runs only when a mic button is clicked."}</p>
          </article>
        </div>
        <div className="registry-controls">
          <label>
            Engine
            <select value={speechForm.speechEngine} onChange={(event) => updateSpeechOption("speechEngine", event.target.value as SpeechEngine)}>
              <option value="faster_whisper">faster-whisper</option>
              <option value="whisper_cpp">whisper.cpp placeholder</option>
              <option value="windows_fallback">Windows fallback only</option>
            </select>
          </label>
          <label>
            Model
            <select value={speechForm.modelName} onChange={(event) => updateSpeechOption("modelName", event.target.value)}>
              {speechForm.modelSizeOptions.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
          </label>
          <label>
            Device
            <select value={speechForm.device} onChange={(event) => updateSpeechOption("device", event.target.value as SpeechDevice)}>
              <option value="auto">auto</option>
              <option value="cuda">cuda</option>
              <option value="cpu">cpu</option>
            </select>
          </label>
          <label>
            Compute
            <select value={speechForm.computeType} onChange={(event) => updateSpeechOption("computeType", event.target.value as SpeechComputeType)}>
              <option value="auto">auto</option>
              <option value="int8">int8</option>
              <option value="float16">float16</option>
            </select>
          </label>
          <label>
            Input microphone
            <select value={speechForm.selectedInputDeviceId ?? ""} onChange={(event) => updateSpeechOption("selectedInputDeviceId", event.target.value || null)}>
              <option value="">Default microphone</option>
              {audioDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
            </select>
          </label>
          <div className="button-row">
            <button type="button" disabled={speechBusy} onClick={() => void refreshAudioDevices()}>Refresh devices</button>
            <button type="button" disabled={speechBusy} onClick={() => void calibrateRoomNoise()}>Calibrate room noise (2s)</button>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.noiseSuppression !== false} onChange={(event) => updateSpeechOption("noiseSuppression", event.target.checked)} />
            <span>Noise suppression</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.echoCancellation !== false} onChange={(event) => updateSpeechOption("echoCancellation", event.target.checked)} />
            <span>Echo cancellation</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.autoGainControl !== false} onChange={(event) => updateSpeechOption("autoGainControl", event.target.checked)} />
            <span>Auto gain control</span>
          </label>
          <label>
            VAD mode
            <select value={speechForm.vadMode ?? "auto"} onChange={(event) => updateSpeechOption("vadMode", event.target.value as "auto" | "manual")}>
              <option value="auto">auto (adaptive)</option>
              <option value="manual">manual</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.mainSpeakerMode === true} onChange={(event) => updateSpeechOption("mainSpeakerMode", event.target.checked)} />
            <span>Main speaker mode (prefer closer/louder speech, ignore quiet background voices)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.requireSpeechStart !== false} onChange={(event) => updateSpeechOption("requireSpeechStart", event.target.checked)} />
            <span>Require real speech to start (ignore background noise)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.adaptiveSilenceThreshold !== false} onChange={(event) => updateSpeechOption("adaptiveSilenceThreshold", event.target.checked)} />
            <span>Adaptive silence threshold (uses noise floor)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.speakerVerificationEnabled === true} disabled onChange={() => undefined} />
            <span>Speaker verification — not implemented (placeholder)</span>
          </label>
          <label>
            Max background continuation (ms)
            <input type="number" min="800" max="8000" step="100" value={speechForm.maxPostSpeechListenMs ?? 2500} onChange={(event) => updateSpeechOption("maxPostSpeechListenMs", Number(event.target.value) || 2500)} />
          </label>
          <label>
            Speech threshold margin
            <input type="number" min="0.002" max="0.2" step="0.002" value={speechForm.speechThresholdMargin ?? 0.018} onChange={(event) => updateSpeechOption("speechThresholdMargin", Number(event.target.value) || 0.018)} />
          </label>
          <label>
            Max recording seconds (safety cap)
            <input type="number" min="3" max="30" value={speechForm.maxRecordingSeconds} onChange={(event) => updateSpeechOption("maxRecordingSeconds", Number(event.target.value) || 30)} />
          </label>
          <label>
            Initial silence timeout (ms) — cancel if no speech
            <input type="number" min="1000" max="15000" step="100" value={speechForm.initialSilenceTimeoutMs ?? 4000} onChange={(event) => updateSpeechOption("initialSilenceTimeoutMs", Number(event.target.value) || 4000)} />
          </label>
          <label>
            End silence timeout (ms) — stop after you pause
            <input type="number" min="300" max="4000" step="100" value={speechForm.endSilenceTimeoutMs ?? 900} onChange={(event) => updateSpeechOption("endSilenceTimeoutMs", Number(event.target.value) || 900)} />
          </label>
          <label>
            Min speech (ms)
            <input type="number" min="100" max="2000" step="50" value={speechForm.minSpeechMs ?? 300} onChange={(event) => updateSpeechOption("minSpeechMs", Number(event.target.value) || 300)} />
          </label>
          <label>
            Silence threshold
            <input value={speechForm.silenceThreshold === undefined ? "auto" : String(speechForm.silenceThreshold)} onChange={(event) => updateSpeechOption("silenceThreshold", event.target.value.trim().toLowerCase() === "auto" ? "auto" : (Number(event.target.value) || "auto"))} placeholder="auto or 0.02" />
          </label>
          <label>
            Python path
            <input value={speechForm.pythonPath ?? ""} onChange={(event) => updateSpeechOption("pythonPath", event.target.value || null)} placeholder="Auto-detect from PATH" />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.silenceStopEnabled} onChange={(event) => updateSpeechOption("silenceStopEnabled", event.target.checked)} />
            <span>Stop recording after silence</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.vadEnabled} onChange={(event) => updateSpeechOption("vadEnabled", event.target.checked)} />
            <span>Use local VAD during transcription</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.autoStopOnSilence !== false} onChange={(event) => updateSpeechOption("autoStopOnSilence", event.target.checked)} />
            <span>Auto-stop when you stop speaking</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.micPrewarmEnabled !== false} onChange={(event) => updateSpeechOption("micPrewarmEnabled", event.target.checked)} />
            <span>Pre-warm microphone while DexNest is open (instant mic)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.fallbackToWindows} onChange={(event) => updateSpeechOption("fallbackToWindows", event.target.checked)} />
            <span>Use Windows dictation only as fallback</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.pauseInPerformanceMode} onChange={(event) => updateSpeechOption("pauseInPerformanceMode", event.target.checked)} />
            <span>Pause speech capture in Performance Mode</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.autoSendAfterSpeech} onChange={(event) => updateSpeechOption("autoSendAfterSpeech", event.target.checked)} />
            <span>Auto-send Ask DexNest transcript</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.showTranscriptBeforeSend} onChange={(event) => updateSpeechOption("showTranscriptBeforeSend", event.target.checked)} />
            <span>Show transcript before sending</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={speechForm.keepAudioForDebug} onChange={(event) => updateSpeechOption("keepAudioForDebug", event.target.checked)} />
            <span>Keep debug audio under local-data/debug/audio</span>
          </label>
        </div>
        <div className="button-row">
          <button type="button" className="button-primary" disabled={speechBusy} onClick={() => void saveSpeechOptions()}>
            {speechBusy && <Spinner size="sm" />}
            Save Speech settings
          </button>
          <button type="button" disabled={speechBusy} onClick={() => void warmSpeechEngine()}>Warm speech engine</button>
          <button type="button" disabled={speechBusy} onClick={() => void prewarmMic()}>Pre-warm mic</button>
          <button type="button" disabled={speechBusy} onClick={() => void checkSpeechModel()}>Check local model</button>
          <button type="button" disabled={speechBusy} onClick={() => void installSpeechModel()}>Install selected model</button>
          <button type="button" disabled={speechBusy} onClick={() => void testSpeechMic()}>Test mic</button>
          <button type="button" onClick={() => void getBridge().openSpeechModelFolder()}>Open model folder</button>
        </div>
        {speechStatus && <p className="inline-status">{speechStatus}</p>}
        <div className="settings-list">
          <div className="settings-row"><span>Mic permission</span><strong className="technical">{micWarmUi.permission}</strong></div>
          <div className="settings-row"><span>Mic stream</span><strong className="technical">{speechState.performancePaused ? "blocked (performance mode)" : micWarmUi.streamStatus}{micWarmUi.error ? ` · ${micWarmUi.error}` : ""}</strong></div>
          <div className="settings-row"><span>Audio context</span><strong className="technical">{micWarmUi.audioContextStatus}</strong></div>
          <div className="settings-row">
            <span>Mic level (VAD)</span>
            <strong className="technical">
              <span className="vad-meter" aria-hidden="true"><span className="vad-meter__fill" style={{ width: `${Math.min(100, Math.round(vadMeter.level * 600))}%` }} /><span className="vad-meter__threshold" style={{ left: `${Math.min(100, Math.round(vadMeter.speechThreshold * 600))}%` }} /></span>
              {" "}{vadMeter.state} · level {vadMeter.level.toFixed(3)} · floor {vadMeter.noiseFloor.toFixed(3)} · thr {vadMeter.speechThreshold.toFixed(3)}
            </strong>
          </div>
          {speechMetrics && (
            <div className="settings-row"><span>Last capture metrics</span><strong className="technical">{speechMetrics.wakeToRecordingStartMs != null ? `wake→rec ${speechMetrics.wakeToRecordingStartMs}ms · ` : ""}mic→rec {speechMetrics.micClickToRecordingMs}ms · speech@{speechMetrics.speechDetectedAtMs ?? "—"}ms · silence-stop {speechMetrics.silenceStopDelayMs ?? "—"}ms · rec {speechMetrics.recordingDurationMs}ms · transcribe {speechMetrics.transcriptionLatencyMs ?? "—"}ms · stop: {speechMetrics.stopReason ?? speechMetrics.vadOutcome} · floor {speechMetrics.noiseFloor ?? "—"} · thr {speechMetrics.speechThreshold ?? "—"}</strong></div>
          )}
          {speechMetrics && (
            <div className="settings-row"><span>Wake command metrics</span><strong className="technical">wake-&gt;Search {speechMetrics.wakeToSearchNavigationMs ?? "-"}ms / route {speechMetrics.routingLatencyMs ?? "-"}ms / action {speechMetrics.actionLatencyMs ?? "-"}ms / TTS {speechMetrics.ttsAttempted ? (speechMetrics.ttsSpoken ? "spoken" : `blocked ${speechMetrics.ttsBlockedReason ?? ""}`) : "not attempted"}</strong></div>
          )}
          {speechState.engineState && (
            <div className="settings-row"><span>Engine state</span><strong className="technical">{speechState.engineState}</strong></div>
          )}
          {speechState.warmDiagnostics && (
            <div className="settings-row"><span>Engine diagnostics</span><strong className="technical">{speechState.warmDiagnostics.engine} · {speechState.warmDiagnostics.device}/{speechState.warmDiagnostics.computeType} · load {speechState.warmDiagnostics.loadLatencyMs ?? "—"}ms · last {speechState.warmDiagnostics.lastTranscriptionMs ?? "—"}ms{speechState.warmDiagnostics.lastError ? ` · error: ${speechState.warmDiagnostics.lastError}` : ""}</strong></div>
          )}
          <div className="settings-row"><span>Settings</span><strong className="technical">{speechState.settingsPath}</strong></div>
          <div className="settings-row"><span>Models</span><strong className="technical">{speechState.modelRoot}</strong></div>
          <div className="settings-row"><span>Debug audio</span><strong className="technical">{speechState.debugAudioRoot}</strong></div>
          <div className="settings-row"><span>Python</span><strong className="technical">{speechState.modelStatus.pythonPath ?? "Auto-detect, preferred: sidecars/speech/.venv"}</strong></div>
          <div className="settings-row"><span>Last latency</span><strong>{speechState.modelStatus.lastLatencyMs === null || speechState.modelStatus.lastLatencyMs === undefined ? "not measured" : `${speechState.modelStatus.lastLatencyMs} ms`}</strong></div>
        </div>
      </Panel>

      <Panel title="Ambient Voice">
        <div className="settings-grid">
          <article>
            <span>Ambient mode</span>
            <strong>{ambientVoiceState.settings.ambientVoiceEnabled ? "Enabled" : "Disabled"}</strong>
            <p>{ambientVoiceState.pausedByPerformanceMode ? "Paused by Performance Mode." : `State: ${ambientVoiceState.currentState}`}</p>
          </article>
          <article>
            <span>Push-to-talk</span>
            <strong>{ambientVoiceState.settings.pushToTalkShortcutStatus}</strong>
            <p className="technical">{ambientVoiceState.settings.pushToTalkShortcut}</p>
          </article>
          <article>
            <span>Wake word state</span>
            <strong>{speechState.performancePaused && (ambientForm.pauseWakeWordInPerformanceMode ?? true) ? "paused_by_performance_mode" : wakeWordState.status}</strong>
            <p className="technical">engine: {ambientForm.wakeWordEngine ?? "placeholder"} · {wakeWordState.engineInstalled ? "installed" : "wake engine not installed"}</p>
          </article>
          <article>
            <span>TTS diagnostics</span>
            <strong>{ttsDiagnostics.available ? "available" : "unavailable"} / {ttsDiagnostics.lastSpoken ? "spoken" : "not spoken"}</strong>
            <p className="technical">{ttsDiagnostics.voicesCount} voices / {ttsDiagnostics.selectedVoice}{ttsDiagnostics.blockedReason ? ` / blocked: ${ttsDiagnostics.blockedReason}` : ""}{ttsDiagnostics.error ? ` / error: ${ttsDiagnostics.error}` : ""}</p>
          </article>
          <article>
            <span>Module switch render</span>
            <strong>{perf.lastModuleSwitchMs != null ? `${perf.lastModuleSwitchMs}ms` : "—"}</strong>
            <p className="technical">last: {perf.lastModule || "—"} · worst: {perf.worstModuleSwitchMs != null ? `${perf.worstModuleSwitchMs}ms` : "—"}</p>
          </article>
        </div>

        <div className="journal-voice" data-active={ambientForm.wakeWordEnabled} data-status={wakeWordState.status}>
          <div className="section-heading">
            <p>Local wake phrase “{ambientForm.wakePhraseMode === "hey_jarvis" ? "Hey Jarvis" : ambientForm.wakePhraseMode === "alexa" ? "Alexa" : ambientForm.wakePhraseMode === "custom_path" ? "Custom model" : (ambientForm.wakeWord || "Nest")}” (openWakeWord). Wake phrase is local and visible. Whisper only starts after wake.</p>
            <p className="technical">
              engine: {wakeEngineState.status} · install: {wakeEngineState.installStatus} · detections: {wakeEngineState.detectionsCount}
              {wakeEngineState.lastDetectedAt ? ` · last ${formatLocalDateTime(new Date(wakeEngineState.lastDetectedAt).toISOString())}` : ""}
              {wakeWordState.metrics.totalWakeToActionMs ? ` · wake→done ${wakeWordState.metrics.totalWakeToActionMs}ms` : ""}
            </p>
            {wakeEngineState.lastError && wakeEngineState.status !== "listening_for_nest" && (
              <p className="technical">blocker: {wakeEngineState.lastError}</p>
            )}
            {wakeEngineState.installStatus === "missing_dependencies" && (
              <p className="technical">Install: <span className="technical">{`"${wakeEngineState.scriptPath ? "sidecars/speech/.venv/Scripts/python.exe" : "python"}" -m pip install openwakeword sounddevice numpy`}</span>, then add a “Nest” model at sidecars/wake-word/models/nest.onnx.</p>
            )}
          </div>
          <label>
            Wake phrase
            <select value={ambientForm.wakePhraseMode ?? "hey_jarvis"} onChange={(event) => updateAmbientOption("wakePhraseMode", event.target.value as "custom_nest" | "hey_jarvis" | "alexa" | "custom_path")}>
              <option value="hey_jarvis">Hey Jarvis (built-in, works now)</option>
              <option value="alexa">Alexa (built-in, if available)</option>
              <option value="custom_nest">Nest (custom model — sidecars/wake-word/models/nest.onnx)</option>
              <option value="custom_path">Custom model path…</option>
            </select>
          </label>
          {ambientForm.wakePhraseMode === "custom_path" && (
            <label>
              Custom wake model path
              <input value={ambientForm.wakeCustomModelPath ?? ""} onChange={(event) => updateAmbientOption("wakeCustomModelPath", event.target.value || null)} placeholder="C:\\path\\to\\model.onnx" />
            </label>
          )}
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.wakeWordEnabled} onChange={(event) => updateAmbientOption("wakeWordEnabled", event.target.checked)} />
            <span>Enable wake word (off by default). Uses the local openWakeWord engine; Test trigger always works.</span>
          </label>
          <label>
            Wake sensitivity ({(ambientForm.wakeWordSensitivity ?? 0.5).toFixed(2)})
            <input type="range" min="0" max="1" step="0.05" value={ambientForm.wakeWordSensitivity ?? 0.5} onChange={(event) => updateAmbientOption("wakeWordSensitivity", Number(event.target.value))} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.allowWakeWordDeviceControl ?? true} onChange={(event) => updateAmbientOption("allowWakeWordDeviceControl", event.target.checked)} />
            <span>Allow wake-word device control (lights)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.allowWakeWordSensitiveLookup ?? false} onChange={(event) => updateAmbientOption("allowWakeWordSensitiveLookup", event.target.checked)} />
            <span>Allow wake-word sensitive lookups (off by default)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.pauseWakeWordInPerformanceMode ?? true} onChange={(event) => updateAmbientOption("pauseWakeWordInPerformanceMode", event.target.checked)} />
            <span>Pause wake word in Performance Mode</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.playWakeSound ?? true} onChange={(event) => updateAmbientOption("playWakeSound", event.target.checked)} />
            <span>Play wake chime</span>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void onCheckWake()}>Check wake engine</button>
            <button type="button" onClick={() => onTestWake()} disabled={speechState.performancePaused && (ambientForm.pauseWakeWordInPerformanceMode ?? true)}>Test wake trigger</button>
            <button type="button" onClick={() => onStartWake()}>Start wake service</button>
            <button type="button" onClick={() => onStopWake()}>Stop wake service</button>
          </div>
        </div>

        <div className="registry-controls">
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.ambientVoiceEnabled} onChange={(event) => updateAmbientOption("ambientVoiceEnabled", event.target.checked)} />
            <span>Enable Ambient Voice controls</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.pushToTalkEnabled} onChange={(event) => updateAmbientOption("pushToTalkEnabled", event.target.checked)} />
            <span>Enable push-to-talk shortcut</span>
          </label>
          <label>
            Push-to-talk shortcut
            <select value={ambientForm.pushToTalkShortcut} onChange={(event) => updateAmbientOption("pushToTalkShortcut", event.target.value as AmbientVoiceSettings["pushToTalkShortcut"])}>
              <option value="CommandOrControl+Alt+N">Ctrl+Alt+N</option>
              <option value="CommandOrControl+Shift+N">Ctrl+Shift+N</option>
              <option value="CommandOrControl+Alt+M">Ctrl+Alt+M</option>
            </select>
          </label>
          <label>
            Listen window seconds
            <input type="number" min="3" max="30" value={ambientForm.maxListeningSeconds} onChange={(event) => updateAmbientOption("maxListeningSeconds", Number(event.target.value) || 8)} />
          </label>
          <label>
            Cooldown milliseconds
            <input type="number" min="500" max="10000" step="100" value={ambientForm.commandCooldownMs} onChange={(event) => updateAmbientOption("commandCooldownMs", Number(event.target.value) || 1200)} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.visibleListeningIndicator} onChange={(event) => updateAmbientOption("visibleListeningIndicator", event.target.checked)} />
            <span>Show global listening indicator</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.pauseInPerformanceMode} onChange={(event) => updateAmbientOption("pauseInPerformanceMode", event.target.checked)} />
            <span>Pause Ambient Voice in Performance Mode</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.speakResponses} onChange={(event) => updateAmbientOption("speakResponses", event.target.checked)} />
            <span>Speak responses with local OS speech synthesis (Alexa-style)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.speakErrors !== false} onChange={(event) => updateAmbientOption("speakErrors", event.target.checked)} />
            <span>Speak errors (e.g. “I couldn’t reach Govee.”)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.speakConfirmations !== false} onChange={(event) => updateAmbientOption("speakConfirmations", event.target.checked)} />
            <span>Speak confirmations (e.g. “Open DexNest to confirm.”)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.speakWorkflowStatus !== false} onChange={(event) => updateAmbientOption("speakWorkflowStatus", event.target.checked)} />
            <span>Speak workflow status (journal started/saved, calendar)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.speakSensitiveAnswers} onChange={(event) => updateAmbientOption("speakSensitiveAnswers", event.target.checked)} />
            <span>⚠️ Speak sensitive answers aloud — only while the trusted session is unlocked. Off by default; spoken values like SIN or passport numbers can be overheard.</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.shortResponsesOnly} onChange={(event) => updateAmbientOption("shortResponsesOnly", event.target.checked)} />
            <span>Keep spoken responses short</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.muteInPerformanceMode} onChange={(event) => updateAmbientOption("muteInPerformanceMode", event.target.checked)} />
            <span>Mute spoken responses in Performance Mode</span>
          </label>
          <label>
            Voice
            <select value={ambientForm.voiceName ?? ""} onChange={(event) => updateAmbientOption("voiceName", event.target.value || null)}>
              <option value="">System default</option>
              {typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.getVoices().map((voice) => (
                <option key={voice.name} value={voice.name}>{voice.name}</option>
              ))}
            </select>
          </label>
          <label>
            Voice rate
            <input type="number" min="0.5" max="2" step="0.1" value={ambientForm.voiceRate} onChange={(event) => updateAmbientOption("voiceRate", Number(event.target.value) || 1)} />
          </label>
          <label>
            Voice volume
            <input type="number" min="0" max="1" step="0.1" value={ambientForm.voiceVolume} onChange={(event) => updateAmbientOption("voiceVolume", Number(event.target.value))} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.allowDeviceControl} onChange={(event) => updateAmbientOption("allowDeviceControl", event.target.checked)} />
            <span>Allow local device control routes such as Govee</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.allowSensitiveLookups} onChange={(event) => updateAmbientOption("allowSensitiveLookups", event.target.checked)} />
            <span>Allow sensitive lookup routes with masking and trusted-session rules</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.allowClipboardActions} onChange={(event) => updateAmbientOption("allowClipboardActions", event.target.checked)} />
            <span>Allow Clipboard routes</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.allowDevActions} onChange={(event) => updateAmbientOption("allowDevActions", event.target.checked)} />
            <span>Allow Dev routes with existing action safety rules</span>
          </label>
        </div>
        <div className="section-heading"><p>Desktop Voice Overlay</p></div>
        <div className="settings-grid">
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.voiceOverlayEnabled !== false} onChange={(event) => updateAmbientOption("voiceOverlayEnabled", event.target.checked)} />
            <span>Show a glowing voice wave on the desktop (bottom-center) while listening/speaking</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.voiceOverlayAnimations !== false} onChange={(event) => updateAmbientOption("voiceOverlayAnimations", event.target.checked)} />
            <span>Animations enabled (off shows a simple glowing ring; respects reduced motion)</span>
          </label>
          <label>
            Overlay size
            <select value={ambientForm.voiceOverlaySize ?? "compact"} onChange={(event) => updateAmbientOption("voiceOverlaySize", event.target.value === "normal" ? "normal" : "compact")}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ambientForm.wakeChimeEnabled !== false} onChange={(event) => updateAmbientOption("wakeChimeEnabled", event.target.checked)} />
            <span>Play a short soft wake chime</span>
          </label>
          <label>
            Wake chime volume ({((ambientForm.wakeChimeVolume ?? 0.35)).toFixed(2)})
            <input type="range" min="0" max="1" step="0.05" value={ambientForm.wakeChimeVolume ?? 0.35} onChange={(event) => updateAmbientOption("wakeChimeVolume", Number(event.target.value))} />
          </label>
          <div className="settings-row"><span>Overlay position</span><strong>Bottom center · primary display</strong></div>
        </div>
        <p className="ambient-note">
          Ambient Nest uses visible push-to-talk speech capture and the existing Ask DexNest route. No raw mic audio is stored, and sensitive answers stay masked unless the trusted session and spoken-sensitive settings are both enabled. The desktop overlay is click-through, never steals focus, and only shows visual state — never transcript content.
        </p>
        <div className="button-row">
          <button type="button" className="button-primary" onClick={() => void saveAmbientVoiceOptions()} disabled={ambientSaving}>
            {ambientSaving ? "Saving..." : "Save Ambient Voice"}
          </button>
          <button type="button" onClick={() => void startAmbientVoiceTest()}>
            Start listening test
          </button>
          <button type="button" onClick={() => void testAmbientCommandRoute()}>
            Test command route
          </button>
          <button type="button" onClick={() => void testLocalTts()}>
            Test voice
          </button>
          <button type="button" onClick={() => testVoiceOverlay()}>
            Test overlay
          </button>
        </div>
        {ambientVoiceState.settings.pushToTalkShortcutLastError && <p className="status-text status-text--error">{ambientVoiceState.settings.pushToTalkShortcutLastError}</p>}
        {ambientStatus && <p className="status-text">{ambientStatus}</p>}
      </Panel>

      <Panel title="Controls and Shortcuts">
        <div className="settings-grid">
          <article>
            <span>Keyboard shortcuts</span>
            <strong>{keyboardForm.enabled ? "Enabled" : "Disabled"}</strong>
            <p>{keyboardForm.mappings.filter((mapping) => mapping.status === "active").length} active mapping(s).</p>
          </article>
          <article>
            <span>Stream Deck endpoint</span>
            <strong>{appInfo?.actionEndpoint ?? "Loading"}</strong>
            <p>Localhost-only by default.</p>
          </article>
          <article>
            <span>Security</span>
            <strong>{streamDeckForm.lanEnabled ? "LAN enabled" : "Local only"}</strong>
            <p>PIN/token {streamDeckForm.tokenEnabled ? "enabled" : "disabled"}.</p>
          </article>
        </div>
        <div className="registry-controls">
          <label className="checkbox-row">
            <input type="checkbox" checked={keyboardForm.enabled} onChange={(event) => setKeyboardForm((current) => ({ ...current, enabled: event.target.checked }))} />
            <span>Enable configurable keyboard shortcuts</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={streamDeckForm.tokenEnabled} onChange={(event) => setStreamDeckForm((current) => ({ ...current, tokenEnabled: event.target.checked }))} />
            <span>Require local PIN/token for Stream Deck endpoint</span>
          </label>
          <label>
            Local token
            <input
              value={streamDeckForm.token === "set" ? "" : streamDeckForm.token}
              onChange={(event) => setStreamDeckForm((current) => ({ ...current, token: event.target.value }))}
              placeholder={appInfo?.streamDeckSettings.token === "set" ? "Token already set; enter replacement" : "Optional local token"}
            />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={streamDeckForm.lanEnabled} onChange={(event) => setStreamDeckForm((current) => ({ ...current, lanEnabled: event.target.checked }))} />
            <span>Allow LAN control endpoint exposure</span>
          </label>
        </div>
        <div className="deck-panel-scroll">
          {keyboardForm.mappings.length === 0 ? (
            <EmptyState>No keyboard shortcuts configured.</EmptyState>
          ) : (
            keyboardForm.mappings.map((mapping) => (
              <article className="deck-action-row accent-command" key={mapping.id}>
                <div className="deck-action-row__main">
                  <strong>{mapping.label}</strong>
                  <span className="technical">{mapping.targetType === "routine" ? mapping.routineId : mapping.actionId}</span>
                  {mapping.lastError && <span>{mapping.lastError}</span>}
                </div>
                <div className="deck-action-row__meta">
                  <StatusBadge tone={mapping.status === "active" ? "success" : mapping.status === "blocked" || mapping.status === "failed" || mapping.status === "conflict" ? "warning" : "neutral"}>{mapping.status}</StatusBadge>
                  <label>
                    Shortcut
                    <input value={mapping.shortcut} onChange={(event) => updateKeyboardMapping(mapping.id, { shortcut: event.target.value })} />
                  </label>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={mapping.enabled} onChange={(event) => updateKeyboardMapping(mapping.id, { enabled: event.target.checked })} />
                    <span>Enabled</span>
                  </label>
                  <button type="button" onClick={() => updateKeyboardMapping(mapping.id, { shortcut: "", enabled: false })}>Clear</button>
                </div>
              </article>
            ))
          )}
        </div>
        {appInfo?.keyboardShortcutConflicts && appInfo.keyboardShortcutConflicts.length > 0 && (
          <p className="inline-status">{appInfo.keyboardShortcutConflicts.join(" ")}</p>
        )}
        <div className="button-row">
          <button type="button" className={controlsSaving ? "is-busy" : undefined} disabled={controlsSaving} onClick={() => void saveControlSettings()}>
            {controlsSaving && <Spinner size="sm" />}
            {controlsSaving ? "Saving..." : "Save controls and shortcuts"}
          </button>
          <button type="button" onClick={() => void resetKeyboardShortcuts()}>Reset shortcuts</button>
          <button type="button" onClick={() => void disableAllKeyboardShortcuts()}>Disable all shortcuts</button>
        </div>
        <div className="settings-list">
          <div className="settings-row"><span>Health</span><strong className="technical">{appInfo?.actionEndpoint ? `${appInfo.actionEndpoint}/health` : "Loading"}</strong></div>
          <div className="settings-row"><span>Run action</span><strong className="technical">{appInfo?.actionEndpoint ? `${appInfo.actionEndpoint}/actions/run` : "Loading"}</strong></div>
          <div className="settings-row"><span>Run routine</span><strong className="technical">{appInfo?.actionEndpoint ? `${appInfo.actionEndpoint}/routines/run` : "Loading"}</strong></div>
        </div>
      </Panel>

      <Panel title="External Devices">
        <div className="settings-grid">
          <article>
            <span>Govee provider</span>
            <strong>{externalState.settings.goveeEnabled ? "Enabled" : "Disabled"}</strong>
            <p>{externalState.providerMessage}</p>
          </article>
          <article>
            <span>API key</span>
            <strong>{externalState.apiKeyStored ? "Stored securely" : "Not saved"}</strong>
            <p>{externalState.secureVaultUnlocked ? "Secure Vault is unlocked." : externalState.secureVaultSetup ? "Unlock Secure Vault to use Govee." : "Set up Secure Vault first."}</p>
          </article>
          <article>
            <span>Cached devices</span>
            <strong>{externalState.devices.length}</strong>
            <p className="technical">{externalState.cachePath}</p>
          </article>
        </div>

        <div className="registry-controls">
          <label className="checkbox-row">
            <input type="checkbox" checked={externalForm.goveeEnabled} onChange={(event) => updateExternalOption("goveeEnabled", event.target.checked)} />
            <span>Enable Govee provider</span>
          </label>
          <label>
            Govee API key
            <input
              type="password"
              value={goveeApiKeyInput}
              onChange={(event) => setGoveeApiKeyInput(event.target.value)}
              placeholder={externalState.apiKeyInKeychain ? "Stored in Integration Keychain; enter replacement" : "Paste Govee API key"}
            />
          </label>
          <p className="technical">
            {externalState.apiKeyInKeychain
              ? `API key stored in Integration Keychain (${externalState.keychainStorageMethod ?? "encrypted"}). Works without unlocking Secure Vault.`
              : externalState.hasLegacyVaultKey
                ? "Govee key is still in Secure Vault — use “Move Govee key to Integration Keychain” so lights work without unlocking."
                : externalState.keychainAvailable === false
                  ? "Secure local encryption (safeStorage) is unavailable on this system."
                  : "Paste your Govee API key and Save — it is encrypted into the local Integration Keychain (never stored in plaintext)."}
          </p>
          <label>
            Default alias
            <input value={externalForm.defaultDeviceAlias ?? ""} onChange={(event) => updateExternalOption("defaultDeviceAlias", event.target.value || null)} placeholder="room lights" />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={externalForm.allowVoiceControl} onChange={(event) => updateExternalOption("allowVoiceControl", event.target.checked)} />
            <span>Allow Ask DexNest and Voice control</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={externalForm.allowStreamDeckControl} onChange={(event) => updateExternalOption("allowStreamDeckControl", event.target.checked)} />
            <span>Allow Stream Deck endpoint control</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={externalForm.allowKeyboardShortcutControl} onChange={(event) => updateExternalOption("allowKeyboardShortcutControl", event.target.checked)} />
            <span>Allow keyboard shortcut control</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={externalForm.requireConfirmationForPowerOff} onChange={(event) => updateExternalOption("requireConfirmationForPowerOff", event.target.checked)} />
            <span>Require confirmation for power off</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={externalForm.requireConfirmationForBrightnessBelow10} onChange={(event) => updateExternalOption("requireConfirmationForBrightnessBelow10", event.target.checked)} />
            <span>Require confirmation below 10% brightness</span>
          </label>
        </div>

        <div className="button-row">
          <button type="button" className={externalBusy ? "is-busy" : undefined} disabled={externalBusy} onClick={() => void saveExternalDevicesSettings()}>
            {externalBusy && <Spinner size="sm" />}
            Save Govee settings
          </button>
          <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.test_connection")}>Test connection</button>
          <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.refresh_devices")}>Refresh devices</button>
          {externalState.hasLegacyVaultKey && (
            <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.migrate_key")}>Move Govee key to Integration Keychain</button>
          )}
          <button
            type="button"
            className="button-danger"
            disabled={externalBusy || !externalState.apiKeyStored}
            onClick={() => {
              if (window.confirm("Remove the Govee API key from DexNest?")) {
                void runExternalAction("external.govee.remove_api_key", { confirmedDangerous: true });
              }
            }}
          >
            Remove API key
          </button>
          {externalStatus && <span className="inline-status">{externalStatus}</span>}
        </div>

        <div className="data-item data-item--stacked accent-tools">
          <div className="section-heading section-heading--row">
            <div>
              <h3>Groups</h3>
              <p>Use groups for aliases like lights, room lights, and all lights.</p>
            </div>
            {externalState.groups.length === 0 && externalState.devices.length >= 2 && (
              <button type="button" onClick={() => void createRoomLightsGroupFromAllDevices()}>
                Create Room Lights group from cached devices
              </button>
            )}
          </div>
          <div className="registry-controls">
            <label>
              Group name
              <input value={externalGroupForm.name} onChange={(event) => setExternalGroupForm((current) => ({ ...current, name: event.target.value }))} placeholder="Room lights" />
            </label>
            <label>
              Aliases
              <input value={externalGroupForm.aliases} onChange={(event) => setExternalGroupForm((current) => ({ ...current, aliases: event.target.value }))} placeholder="lights, room lights, all lights" />
            </label>
          </div>
          <div className="shortcut-list">
            {externalState.devices.length === 0 ? (
              <EmptyState>Refresh Govee devices before creating a group.</EmptyState>
            ) : (
              externalState.devices.map((device) => (
                <article key={`group-${device.deviceId}`}>
                  <div>
                    <strong>{device.userAlias || device.roomAlias || device.deviceName}</strong>
                    <span>{device.deviceName} / {device.model}</span>
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={externalGroupForm.deviceIds.includes(device.deviceId)}
                      onChange={(event) => toggleExternalGroupDevice(device.deviceId, event.target.checked)}
                    />
                    <span>In group</span>
                  </label>
                </article>
              ))
            )}
          </div>
          <div className="button-row">
            <button type="button" className="button-primary" disabled={externalBusy || externalGroupForm.deviceIds.length === 0} onClick={() => void saveExternalGroup()}>
              {externalGroupForm.groupId ? "Update group" : "Save group"}
            </button>
            <button type="button" onClick={resetExternalGroupForm}>Reset group form</button>
          </div>
          <div className="action-list action-list--compact">
            {externalState.groups.length === 0 ? (
              <p>No Govee groups yet. Create Room lights to make "turn off lights" control multiple lamps.</p>
            ) : (
              externalState.groups.map((group) => (
                <article className="deck-action-row accent-tools" key={group.id}>
                  <div className="deck-action-row__main">
                    <strong>{group.name}</strong>
                    <span>{group.deviceIds.length} device(s) / aliases: {group.aliases.join(", ") || "none"}</span>
                    <span className="technical">{group.id}</span>
                  </div>
                  <div className="deck-action-row__meta">
                    <button type="button" onClick={() => editExternalGroup(group)}>Edit</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.turn_on", { alias: group.name })}>On</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.turn_off", { alias: group.name, confirmedDangerous: true })}>Off</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.set_brightness", { alias: group.name, brightness: 40 })}>40%</button>
                    <button type="button" className="button-danger" onClick={() => void deleteExternalGroup(group.id)}>Delete</button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="deck-panel-scroll">
          {externalState.devices.length === 0 ? (
            <EmptyState>No Govee devices cached yet. Save an API key, then refresh devices.</EmptyState>
          ) : (
            externalState.devices.map((device) => (
              <article className="deck-action-row accent-tools" key={device.deviceId}>
                <div className="deck-action-row__main">
                  <strong>{device.userAlias || device.roomAlias || device.deviceName}</strong>
                  <span>{device.deviceName} / {device.model}</span>
                  <span className="technical">{device.deviceId}</span>
                  <span>Last seen {formatLocalDateTime(device.lastSeen)}</span>
                </div>
                <div className="deck-action-row__meta">
                  <StatusBadge tone={device.controllable ? "success" : "warning"}>{device.controllable ? "controllable" : "limited"}</StatusBadge>
                  <label>
                    User alias
                    <input
                      value={device.userAlias}
                      onChange={(event) => updateExternalDeviceAlias(device.deviceId, { userAlias: event.target.value })}
                      onBlur={() => void runExternalAction("external.govee.update_alias", { deviceId: device.deviceId, userAlias: device.userAlias, roomAlias: device.roomAlias })}
                      placeholder="room lights"
                    />
                  </label>
                  <label>
                    Room alias
                    <input
                      value={device.roomAlias}
                      onChange={(event) => updateExternalDeviceAlias(device.deviceId, { roomAlias: event.target.value })}
                      onBlur={() => void runExternalAction("external.govee.update_alias", { deviceId: device.deviceId, userAlias: device.userAlias, roomAlias: device.roomAlias })}
                      placeholder="bedroom"
                    />
                  </label>
                  <div className="button-row">
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.turn_on", { deviceId: device.deviceId })}>On</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.turn_off", { deviceId: device.deviceId, confirmedDangerous: true })}>Off</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.toggle", { deviceId: device.deviceId, confirmedDangerous: true })}>Toggle</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.set_brightness", { deviceId: device.deviceId, brightness: 40 })}>40%</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.set_color", { deviceId: device.deviceId, color: "blue" })}>Blue</button>
                    <button type="button" disabled={externalBusy} onClick={() => void runExternalAction("external.govee.set_color_temperature", { deviceId: device.deviceId, kelvin: 2700 })}>Warm</button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
        <div className="settings-list">
          <div className="settings-row"><span>Settings</span><strong className="technical">{externalState.settingsPath}</strong></div>
          <div className="settings-row"><span>Cache</span><strong className="technical">{externalState.cachePath}</strong></div>
          <div className="settings-row"><span>Groups</span><strong className="technical">{externalState.groupsPath}</strong></div>
          <div className="settings-row"><span>Action example</span><strong className="technical">external.govee.turn_on {"{ alias: \"room lights\" }"}</strong></div>
        </div>
      </Panel>

      <Panel title="Startup and Tray">
        <div className="settings-grid">
          <article>
            <span>Close button</span>
            <strong>{lifecycleForm.closeBehavior.replaceAll("_", " ")}</strong>
            <p>Controls what happens when you click X.</p>
          </article>
          <article>
            <span>Windows startup</span>
            <strong>{lifecycleForm.startDexNestWithWindows ? "Enabled" : "Disabled"}</strong>
            <p>{lifecycleForm.loginItemLastError ?? `Registration: ${lifecycleForm.loginItemStatus}`}</p>
          </article>
          <article>
            <span>Tray mode</span>
            <strong>{appInfo?.appLifecycleSettings.trayModeActive ? "Hidden" : "Window"}</strong>
            <p>{appInfo?.appLifecycleSettings.trayAvailable ? "Tray is available." : "Tray is not active."}</p>
          </article>
        </div>
        <div className="registry-controls">
          <label>
            Close button behavior
            <select
              value={lifecycleForm.closeBehavior}
              onChange={(event) => updateLifecycleOption("closeBehavior", event.target.value as AppCloseBehavior)}
            >
              <option value="ask">Ask every time</option>
              <option value="minimize_to_tray">Minimize to tray</option>
              <option value="exit">Exit app</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={lifecycleForm.startDexNestWithWindows}
              onChange={(event) => updateLifecycleOption("startDexNestWithWindows", event.target.checked)}
            />
            <span>Start DexNest when Windows starts</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={lifecycleForm.startMinimizedToTray}
              disabled={!lifecycleForm.startDexNestWithWindows}
              onChange={(event) => updateLifecycleOption("startMinimizedToTray", event.target.checked)}
            />
            <span>Start minimized to tray</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={lifecycleForm.minimizeToTrayOnStartup}
              onChange={(event) => updateLifecycleOption("minimizeToTrayOnStartup", event.target.checked)}
            />
            <span>Always start DexNest hidden in tray</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={lifecycleForm.showTrayCloseNotice}
              onChange={(event) => updateLifecycleOption("showTrayCloseNotice", event.target.checked)}
            />
            <span>Show tray notice when DexNest keeps running</span>
          </label>
        </div>
        <div className="button-row">
          <button type="button" className={lifecycleSaving ? "is-busy" : undefined} disabled={lifecycleSaving} onClick={() => void saveLifecycleOptions()}>
            {lifecycleSaving && <Spinner size="sm" />}
            {lifecycleSaving ? "Saving..." : "Save startup and tray settings"}
          </button>
          <button type="button" disabled={lifecycleBusy} onClick={() => void testTrayNotification()}>
            {lifecycleBusy && <Spinner size="sm" />}
            Test tray notification
          </button>
          <button type="button" className="button-danger" onClick={() => void quitDexNestFromSettings()}>
            Quit DexNest fully
          </button>
        </div>
        <p className="technical">{appInfo?.appLifecycleSettingsPath ?? "./local-data/settings/app-lifecycle-settings.json"}</p>
      </Panel>

      <Panel title="Performance Mode">
        <div className="performance-card">
          <div>
            <div className="status-row">
              <StatusBadge tone={performanceModeState.enabled ? "warning" : "success"}>
                {performanceModeState.enabled ? "ON" : "OFF"}
              </StatusBadge>
              <StatusBadge tone="info">Gaming Mode</StatusBadge>
            </div>
            <p>{performanceModeState.enabled ? `Reason: ${performanceModeState.reason}` : "DexNest workers are available when user-triggered."}</p>
            <p className="technical">{performanceModeState.pausedWorkers.length ? performanceModeState.pausedWorkers.join(", ") : "No workers paused."}</p>
          </div>
          <button
            type="button"
            className={`${performanceModeState.enabled ? "button-danger" : "button-primary"}${performanceBusy ? " is-busy" : ""}`}
            disabled={performanceBusy}
            onClick={() => void togglePerformanceMode()}
          >
            {performanceBusy && <Spinner size="sm" />}
            {performanceBusy ? "Updating..." : performanceModeState.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
        <div className="settings-grid">
          {([
            ["pauseHeatmap", "Pause Heatmap tracking"],
            ["pauseOcrJobs", "Pause OCR queues"],
            ["pauseSearchAutoIndex", "Pause automatic Search reindex"],
            ["pauseBackups", "Pause scheduled backups"],
            ["suppressNonUrgentNudges", "Suppress non-urgent nudges"],
            ["allowDropWhenOpen", "Allow Drop when explicitly opened"],
            ["allowUserTriggeredAssistant", "Allow user-triggered Ask DexNest/Ollama"],
            ["showTrayStatus", "Show tray status"]
          ] as Array<[keyof PerformanceModeSettings, string]>).map(([key, label]) => (
            <label className="checkbox-row" key={key}>
              <input type="checkbox" checked={Boolean(performanceForm[key])} onChange={(event) => updatePerformanceOption(key, event.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
          <label className="checkbox-row">
            <input type="checkbox" checked={performanceForm.autoEnableWhenFullscreen} onChange={(event) => updatePerformanceOption("autoEnableWhenFullscreen", event.target.checked)} />
            <span>Auto-enable when fullscreen (coming soon)</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={performanceForm.autoEnableWhenGameDetected} onChange={(event) => updatePerformanceOption("autoEnableWhenGameDetected", event.target.checked)} />
            <span>Auto-enable when game detected (coming soon)</span>
          </label>
        </div>
        <div className="button-row">
          <button type="button" className={performanceSaving ? "is-busy" : undefined} disabled={performanceSaving} onClick={() => void savePerformanceOptions()}>
            {performanceSaving && <Spinner size="sm" />}
            {performanceSaving ? "Saving..." : "Save Performance settings"}
          </button>
        </div>
        <p className="technical">{appInfo?.performanceModeSettingsPath ?? "./local-data/settings/performance-mode-settings.json"}</p>
      </Panel>

      <Panel title="App Health">
        <div className="health-summary">
          <div>
            <span>Overall</span>
            <StatusBadge tone={healthState ? healthTone(healthState.overallStatus) : "info"}>{healthState?.overallStatus ?? "not checked"}</StatusBadge>
          </div>
          <div>
            <span>Pass</span>
            <strong className="technical">{healthState?.summary.pass ?? 0}</strong>
          </div>
          <div>
            <span>Warn</span>
            <strong className="technical">{healthState?.summary.warn ?? 0}</strong>
          </div>
          <div>
            <span>Fail</span>
            <strong className="technical">{healthState?.summary.fail ?? 0}</strong>
          </div>
        </div>
        <div className="button-row">
          <button type="button" className="button-primary" onClick={() => void runHealthCheck()}>Run health check</button>
          {healthStatus && <span className="inline-status">{healthStatus}</span>}
        </div>
        <div className="health-groups">
          {healthState ? (
            healthState.groups.map((group) => (
              <section className="health-group" key={group.id}>
                <h4>{group.title}</h4>
                <div className="health-check-list">
                  {group.checks.map((item) => (
                    <article className="health-check" data-status={item.status} key={item.id}>
                      <div>
                        <StatusBadge tone={healthTone(item.status)}>{item.status}</StatusBadge>
                      </div>
                      <div>
                        <strong>{item.label}</strong>
                        <p className="technical technical--truncate">{item.detail}</p>
                        {item.suggestion && <p>{item.suggestion}</p>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <EmptyState>Run App Health to check DexNest configuration.</EmptyState>
          )}
        </div>
      </Panel>

      <Panel title="Nudge Settings">
        <div className="settings-grid">
          <article>
            <span>Active nudges</span>
            <strong>{calendarState.nudges.length}</strong>
            <p className="technical">{calendarState.nudgesPath}</p>
          </article>
          <article>
            <span>Nudge settings</span>
            <strong>{calendarState.nudgeSettings.enabled ? "Enabled" : "Disabled"}</strong>
            <p className="technical">{calendarState.nudgeSettingsPath}</p>
          </article>
        </div>
        <div className="registry-controls">
          <label className="checkbox-row">
            <input type="checkbox" checked={nudgeSettingsForm.enabled} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, enabled: event.target.checked }))} />
            <span>Enable nudges</span>
          </label>
          <label>
            Vault expiry days
            <input value={nudgeSettingsForm.vaultExpiryReminderDays} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, vaultExpiryReminderDays: event.target.value }))} />
          </label>
          <label>
            Return reminder days
            <input value={nudgeSettingsForm.returnReminderDays} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, returnReminderDays: event.target.value }))} />
          </label>
          <label>
            Backup reminder after days
            <input type="number" min="1" value={nudgeSettingsForm.backupReminderAfterDays} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, backupReminderAfterDays: event.target.value }))} />
          </label>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={nudgeSettingsForm.dailyJournalReminderEnabled} onChange={(event) => setNudgeSettingsForm((current) => ({ ...current, dailyJournalReminderEnabled: event.target.checked }))} />
          <span>Daily Journal reminder</span>
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void updateNudgeSettings()}>Save nudge settings</button>
          <button type="button" onClick={() => void onAction("calendar.nudge.refresh", "module_ui")}>Refresh nudges</button>
        </div>
      </Panel>

      <Panel title="Backup and Restore">
        <div className="backup-grid">
          <div className="backup-card">
            <h4>Create backup</h4>
            <p>Creates a local zip under <span className="technical">{backupState.backupFolderPath}</span>.</p>
            <div className="backup-options">
              {([
                ["includeSettings", "Settings"],
                ["includeFiles", "Files"],
                ["includeVaultDocuments", "Vault documents"],
                ["includeSecureVault", "Secure Vault encrypted file"],
                ["includeReceipts", "Receipts"],
                ["includeDropFiles", "Drop files"],
                ["includeIndex", "Search index"]
              ] as Array<[keyof BackupOptions, string]>).map(([key, label]) => (
                <label className="checkbox-row" key={key}>
                  <input
                    type="checkbox"
                    checked={backupOptions[key]}
                    onChange={(event) => updateBackupOption(key, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="button-row">
              <button type="button" onClick={() => void createBackupNow()}>Create backup now</button>
              <button type="button" onClick={() => void onAction("backup.open_folder", "module_ui")}>Open backup folder</button>
            </div>
          </div>

          <div className="backup-card">
            <h4>Restore backup</h4>
            <p>DexNest restores to staging first and creates a safety backup before replacing current local data.</p>
            <div className="button-row">
              <button type="button" onClick={() => void chooseRestoreZip()}>Select backup zip</button>
              <button type="button" disabled={!restorePath} onClick={() => void previewRestore()}>Preview restore</button>
              <button className="button-danger" type="button" disabled={!restorePreview?.ok} onClick={() => void restoreConfirmed()}>Restore confirmed</button>
            </div>
            {restorePath && <p className="technical technical--truncate">{restorePath}</p>}
            {restorePreview && (
              <div className="backup-preview">
                <p>{restorePreview.ok ? "Preview valid" : "Preview failed"} / {formatBytes(restorePreview.sizeBytes)}</p>
                <p>Roots: <span className="technical">{restorePreview.topLevel.join(", ") || "none"}</span></p>
                {restorePreview.error && <p className="error-text">{restorePreview.error}</p>}
              </div>
            )}
          </div>
        </div>

        {backupMessage && <p className="technical">{backupMessage}</p>}
        <div className="backup-list">
          <h4>Recent backups</h4>
          {backupState.backups.length === 0 ? (
            <p className="empty-state">No local DexNest backups yet.</p>
          ) : (
            backupState.backups.slice(0, 5).map((backup) => (
              <div className="settings-row" key={backup.path}>
                <span>{backup.fileName}</span>
                <strong className="technical">{formatBytes(backup.sizeBytes)} / {formatLocalDateTime(backup.createdAt)}</strong>
              </div>
            ))
          )}
        </div>
      </Panel>

      <div className="settings-list">
        {rows.map(([label, value]) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <strong className="technical">{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="panel">
      <h3>{title}</h3>
      <div className="panel__body">{children}</div>
    </article>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("DexNest root element was not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <DexNestApp />
  </React.StrictMode>
);
