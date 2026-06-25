import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { formatLocalDate, formatLocalDateTime, getLocalTodayDateString, parseLocalDateInput, resolveRelativeLocalDate, toLocalDateInputValue } from "@dexnest/shared-types";
import "@dexnest/shared-ui/tokens.css";
import "./styles.css";

type ViewId = "command" | "dev" | "deck" | "clipboard" | "drop" | "tools" | "vault" | "search" | "capture" | "journal" | "calendar" | "finder" | "finance" | "heatmap" | "audit" | "settings";
type ActionStatus = "success" | "failed" | "skipped" | "cancelled" | "pending";
type ToastTone = "success" | "error";
type AppCloseBehavior = "minimize_to_tray" | "ask" | "exit";

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
  externalDevicesSettingsPath: string;
  externalDevicesCachePath: string;
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

interface ExternalDevicesState {
  settingsPath: string;
  cachePath: string;
  settings: ExternalDevicesSettings;
  secureVaultSetup: boolean;
  secureVaultUnlocked: boolean;
  apiKeyStored: boolean;
  providerStatus: "disabled" | "ready" | "needs_secure_vault" | "locked" | "missing_api_key";
  providerMessage: string;
  devices: ExternalDeviceCacheItem[];
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
    text: string;
    preview: string;
    byteLength: number;
    updatedAt: string;
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
  | "finder_search"
  | "drop_send_clipboard"
  | "open_module"
  | "dev_run_command"
  | "journal_open_today"
  | "search_query"
  | "capture_note"
  | "external_device_control"
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

type AssistantRouterUsed = "rules" | "local-llm";

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
  resolved?: "ran" | "cancelled" | "failed" | "info";
  smartResults?: SmartLookupResult[];
  searchResults?: SearchResult[];
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
    results?: SearchResult[];
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
  onOpenView?: (callback: (payload: { view: string; focusAssistant?: boolean }) => void) => () => void;
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
  devices: []
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
    externalDevicesSettingsPath: "./local-data/settings/external-devices-settings.json",
    externalDevicesCachePath: "./local-data/settings/external-devices-cache.json",
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
  const match = input.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridian = match[3]?.toLowerCase();
  if (meridian === "pm" && hour < 12) {
    hour += 12;
  }
  if (meridian === "am" && hour === 12) {
    hour = 0;
  }
  if (hour > 23 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function cleanVoiceCalendarTitle(input: string): string {
  return input
    .replace(/\b(add|create|schedule)\b/gi, "")
    .replace(/\b(remind me to|remind me|please)\b/gi, "")
    .replace(/\b(today|tomorrow|in\s+\d{1,3}\s+days?|next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/gi, "")
    .replace(/\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/gi, "")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildVoiceCalendarParams(input: string): Record<string, unknown> {
  const date = resolveRelativeLocalDate(input) ?? getLocalTodayDateString();
  const startTime = extractVoiceTime(input);
  const title = cleanVoiceCalendarTitle(input) || "Voice Calendar event";
  const lower = input.toLowerCase();
  const type = lower.includes("birthday") ? "birthday" : lower.includes("call") ? "call" : lower.includes("appointment") ? "appointment" : lower.includes("meeting") ? "meeting" : "reminder";

  return {
    title,
    date,
    startTime,
    allDay: !startTime || type === "birthday",
    sourceModule: "voice",
    sourceId: `voice-${Date.now()}`,
    recurrence: type === "birthday" ? "yearly-placeholder" : null,
    reminderLevel: lower.includes("urgent") ? "urgent" : "normal",
    notes: "Created from DexNest Voice command candidate."
  };
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
  } else if (/\b(dim|brightness|percent|%)\b/i.test(normalized)) {
    actionId = "external.govee.set_brightness";
    const percent = normalized.match(/\b(\d{1,3})\s*(?:percent|%)?\b/);
    params.brightness = percent ? Number(percent[1]) : /\bdim\b/i.test(normalized) ? 25 : 60;
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
  const aliasMatch = normalized.match(/\b(?:turn|switch|toggle|set|make|dim|brighten)\s+(?:the\s+)?(.+?)(?:\s+(?:on|off|to|blue|red|green|purple|pink|yellow|orange|warm|cool|white|\d|percent|%|brightness)|$)/i);
  const alias = aliasMatch?.[1]?.replace(/\b(govee|device|devices)\b/gi, "").trim() || "room lights";
  params.alias = alias || "room lights";
  params.confirmedDangerous = true;
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

function routeVoiceCommand(input: string, actions: ActionDefinition[]): VoiceRouteResult {
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

  if (/\b(add|create|schedule|remind me|meeting|appointment|call|birthday)\b/i.test(trimmed) && /\b(today|tomorrow|in\s+\d{1,3}\s+days?|next\s+\w+|at\s+\d{1,2}|birthday|meeting|appointment|call)\b/i.test(trimmed)) {
    return {
      intent: "calendar_create_candidate",
      targetModule: "calendar",
      actionId: "calendar.create_event",
      params: buildVoiceCalendarParams(trimmed),
      confidence: "medium",
      requiresConfirmation: true,
      sensitivity: "personal",
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

const assistantSensitiveRegex = /\b(sin|social insurance|passport|health card|work permit|permit number|document number|uci|expiry|expires|valid until)\b/i;

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
function buildRouteForIntent(intent: VoiceIntentName, text: string, actions: ActionDefinition[]): VoiceRouteResult | null {
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
      const query = extractFinderQuery(trimmed) || trimmed;
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
    case "calendar_create_candidate":
      return {
        intent,
        targetModule: "calendar",
        actionId: "calendar.create_event",
        params: buildVoiceCalendarParams(trimmed),
        confidence: "medium",
        requiresConfirmation: true,
        sensitivity: "personal",
        explanation: "Creates an editable Calendar event candidate. DexNest will not add it until you confirm."
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
      const note = extractCaptureNote(trimmed) || trimmed;
      return {
        intent,
        targetModule: "capture",
        actionId: "capture.create_note",
        params: { title: note.slice(0, 60) || "Assistant capture", text: note, type: "note", source: "command" },
        confidence: "medium",
        requiresConfirmation: true,
        sensitivity: "personal",
        explanation: "Creates a Capture inbox item after confirmation."
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
function validateLlmIntent(raw: Record<string, unknown> | undefined, text: string, actions: ActionDefinition[]): VoiceRouteResult | null {
  if (!raw) {
    return null;
  }
  const intentValue = typeof raw.intent === "string" ? raw.intent : "unknown";
  const allowed: VoiceIntentName[] = ["smart_lookup", "search_query", "finder_search", "calendar_create_candidate", "drop_send_clipboard", "open_module", "dev_run_command", "journal_open_today", "capture_note", "external_device_control", "unknown"];
  if (!allowed.includes(intentValue as VoiceIntentName) || intentValue === "unknown") {
    return null;
  }
  const built = buildRouteForIntent(intentValue as VoiceIntentName, text, actions);
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
      return "Save this note to your DexNest Capture inbox?";
    case "external_device_control":
      return "Run this External Devices action?";
    default:
      return "Ready to run. Confirm?";
  }
}

function assistantSuccessText(route: VoiceRouteResult, resultCount: number): string {
  switch (route.intent) {
    case "smart_lookup":
      return resultCount > 0
        ? "I found a likely answer in your Vault/OCR documents. It is masked for safety."
        : "I could not find a confident answer in your indexed documents.";
    case "finder_search":
      return resultCount > 0 ? "I found this in Finder." : "Finder search ran. Open Finder to see matches.";
    case "search_query":
      return resultCount > 0 ? `I found ${resultCount} matching document${resultCount === 1 ? "" : "s"}.` : "Search ran. No strong matches in the current index.";
    case "calendar_create_candidate":
      return "Added the event to your Calendar.";
    case "drop_send_clipboard":
      return "Sent your clipboard to DexNest Drop.";
    case "dev_run_command":
      return "Dev command finished. Check the Dev dashboard for output.";
    case "journal_open_today":
      return "Opened today's Journal.";
    case "open_module":
      return `Opened DexNest ${route.targetModule}.`;
    case "capture_note":
      return "Saved to your Capture inbox.";
    case "external_device_control":
      return "External Devices action completed.";
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
  if (["drop_send_clipboard", "dev_run_command", "calendar_create_candidate", "capture_note"].includes(route.intent)) {
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
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

  function openAssistantFromCommand(): void {
    setActiveView("search");
    setAssistantFocusSignal((value) => value + 1);
    void refreshAssistantSecurity();
  }

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

  useEffect(() => {
    void track(refreshShellData()).finally(() => setInitialLoadDone(true));
    void refreshAssistantSettings();
    void refreshAssistantSecurity();
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
      void refreshShellData();
    });
    getBridge().rendererReady?.();

    return () => {
      unsubscribe?.();
    };
  }, []);

  async function refreshShellData(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextToolsState, nextVaultState, nextSearchState, nextJournalState, nextCalendarState, nextFinderState, nextFinanceState, nextCaptureState, nextHeatmapState, nextRoutinesState, nextBackupState, nextPerformanceState, nextPerformanceSettings, nextCommandStats, nextEvents] = await Promise.all([
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
      getBridge().getBackupState(),
      getBridge().getPerformanceModeState(),
      getBridge().getPerformanceModeSettings(),
      getBridge().getCommandStats(),
      getBridge().listEvents()
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
    setBackupState(nextBackupState);
    setPerformanceModeState(nextPerformanceState);
    setPerformanceModeSettings(nextPerformanceSettings);
    setCommandStats(nextCommandStats);
    setEvents(nextEvents);
  }

  async function refreshEvents(): Promise<void> {
    const recentEvents = await getBridge().listEvents();
    setEvents(recentEvents);
  }

  async function refreshProjectsAndActions(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextToolsState, nextVaultState, nextSearchState, nextJournalState, nextCalendarState, nextFinderState, nextFinanceState, nextCaptureState, nextHeatmapState, nextRoutinesState, nextPerformanceState, nextPerformanceSettings, nextCommandStats, nextEvents] = await Promise.all([
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
      getBridge().listEvents()
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
    const actionId = views.find((item) => item.id === view)?.actionId;
    setActiveView(view);
    if (actionId) {
      await runAction(actionId);
    }
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

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      {isBusy && <div className="app-loading-bar" aria-hidden="true" />}
      {isBusy && (
        <div className="app-busy-pill" role="status" aria-live="polite">
          <Spinner size="sm" />
          <span>Working…</span>
        </div>
      )}
      {!initialLoadDone && (
        <div className="app-initial-overlay" role="status" aria-live="polite">
          <div className="app-initial-overlay__inner">
            <Spinner size="lg" />
            <span>Loading DexNest…</span>
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
              assistantFocusSignal={assistantFocusSignal}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "capture" && (
            <CaptureView
              captureState={captureState}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "journal" && (
            <JournalView
              journalState={journalState}
              calendarState={calendarState}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "calendar" && (
            <CalendarView
              calendarState={calendarState}
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
          {activeView === "finder" && (
            <FinderView
              finderState={finderState}
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
  onAction,
  focusSignal
}: {
  actions: ActionDefinition[];
  assistantSettings: AssistantSettings;
  onAssistantSettingsChange: () => Promise<void>;
  securityState: AssistantSecurityState;
  onSecurityChange: () => Promise<void>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  focusSignal: number;
}) {
  const [voiceInput, setVoiceInput] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [micStatus, setMicStatus] = useState("");
  const voiceInputRef = useRef<HTMLInputElement | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantChatMessage[]>([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantDebug, setAssistantDebug] = useState(false);
  const [revealedAssistantIds, setRevealedAssistantIds] = useState<string[]>([]);
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

  async function executeAssistantRoute(messageId: string, route: VoiceRouteResult, routerUsed: AssistantRouterUsed): Promise<void> {
    if (!route.actionId) {
      return;
    }
    await onAction("assistant.confirmed", "voice", {
      router: routerUsed,
      intent: route.intent,
      targetModule: route.targetModule,
      actionId: route.actionId,
      confidence: route.confidence,
      sensitivity: route.sensitivity
    });
    const result = await onAction(route.actionId, "voice", route.params) as {
      ok?: boolean;
      error?: string;
      smartResults?: SmartLookupResult[];
      results?: SearchResult[];
    };
    const smartResults = result.smartResults ?? [];
    const searchResults = result.results ?? [];
    const resultCount = smartResults.length + searchResults.length;
    await onAction("assistant.routed", "voice", {
      router: routerUsed,
      intent: route.intent,
      targetModule: route.targetModule,
      sensitivity: route.sensitivity,
      status: result.ok === false ? "failed" : "completed",
      resultCount
    });
    // If a trusted session unlocked auto-reveal, the session may have changed; refresh.
    if (smartResults.some((item) => item.sensitive)) {
      void onSecurityChange();
    }
    updateAssistantMessage(messageId, {
      awaitingConfirm: false,
      resolved: result.ok === false ? "failed" : "ran",
      smartResults,
      searchResults,
      text: result.ok === false
        ? (result.error ?? "DexNest could not complete that.")
        : assistantAnswerText(route, smartResults, resultCount)
    });
  }

  async function sendAssistant(rawText = voiceInput): Promise<void> {
    const text = rawText.trim();
    if (!text || assistantBusy) {
      return;
    }
    setVoiceInput("");
    appendAssistantMessage({ id: createClientId("assistant-user"), role: "user", text });
    setAssistantBusy(true);

    const ruleRoute = routeVoiceCommand(text, actions);
    await onAction("assistant.command_received", "voice", {
      router: "rules",
      intent: ruleRoute.intent,
      sensitivity: ruleRoute.sensitivity,
      status: "received"
    });

    try {
      let route = ruleRoute;
      let routerUsed: AssistantRouterUsed = "rules";

      // Obvious light commands should hit the registered Govee action directly;
      // Ollama is only useful when DexNest cannot classify the phrasing.
      const engineEligible = assistantSettings.localIntentEngineEnabled
        && ruleRoute.intent !== "external_device_control"
        && (ruleRoute.intent === "unknown" || ruleRoute.confidence !== "high");
      if (engineEligible) {
        const llm = await getBridge().assistantLlmIntent({ query: text });
        if (llm.ok) {
          const validated = validateLlmIntent(llm.intent, text, actions);
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

      const assistantId = createClientId("assistant-reply");
      const needsConfirm = route.intent !== "unknown" && Boolean(route.actionId) && assistantNeedsConfirm(route, actions);
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

      await onAction("assistant.routed", "voice", {
        router: routerUsed,
        intent: route.intent,
        targetModule: route.targetModule,
        sensitivity: route.sensitivity,
        confidence: route.confidence,
        status: route.intent === "unknown" ? "unknown" : (needsConfirm ? "awaiting_confirm" : "detected")
      });

      if (route.intent !== "unknown" && route.actionId && !needsConfirm) {
        await executeAssistantRoute(assistantId, route, routerUsed);
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
      await executeAssistantRoute(message.id, message.route, message.routerUsed ?? "rules");
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

  async function startVoiceListening(): Promise<void> {
    if (voiceListening) {
      return;
    }
    const inputBefore = voiceInputRef.current?.value ?? "";
    voiceInputRef.current?.focus();
    setVoiceListening(true);
    setMicStatus("Opening Windows voice typing…");
    const windowsResult = await getBridge().startWindowsDictation();
    await onAction("voice.start_listening", "voice", {
      speechRecognitionAvailable: false,
      provider: "windows_dictation",
      status: windowsResult.ok ? "started" : "failed"
    });

    if (windowsResult.ok) {
      voiceInputRef.current?.focus();
      setMicStatus("Listening… speak now, then pause.");
      const startedAt = Date.now();
      let lastValue = inputBefore;
      let lastChangeAt = Date.now();
      const poll = window.setInterval(() => {
        const current = voiceInputRef.current?.value ?? "";
        if (current !== lastValue) {
          lastValue = current;
          lastChangeAt = Date.now();
          setMicStatus("Heard you… finishing up.");
        }
        const captured = current.trim() && current.trim() !== inputBefore.trim();
        const settled = captured && Date.now() - lastChangeAt > 1500;
        const timedOut = Date.now() - startedAt > 12000;
        if (settled || timedOut) {
          window.clearInterval(poll);
          setVoiceListening(false);
          const dictatedText = (voiceInputRef.current?.value ?? "").trim();
          if (dictatedText && dictatedText !== inputBefore.trim()) {
            setMicStatus("");
            void sendAssistant(dictatedText);
          } else {
            setMicStatus("No speech captured. Enable Windows voice typing (Win+H): Settings → Time & language → Speech, or just type your question.");
          }
        }
      }, 400);
      return;
    }

    setMicStatus(windowsResult.error ? `Mic unavailable: ${windowsResult.error}` : "Mic unavailable on this system. Type your question instead.");
    setVoiceListening(false);
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
    const result = await onAction("clipboard.assign_slot", "module_ui", { slot }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? `Assigned slot ${slot}.` : result.error ?? "Slot assignment failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copySlot(slot: number): Promise<void> {
    const result = await onAction("clipboard.copy_slot", "module_ui", { slot }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? `Copied slot ${slot}.` : result.error ?? "Slot copy failed.", result.ok ? "success" : "error");
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
              filteredHistory.map((item) => (
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
              ))
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
        <Panel title="Clipboard Slots">
          <div className="clipboard-slot-grid">
            {clipboardState.slots.map((slot) => (
              <article className="clipboard-slot accent-clipboard" key={slot.slot}>
                <div>
                  <strong>Slot {slot.slot}</strong>
                  <p>{slot.preview || "Empty slot"}</p>
                  {slot.updatedAt && <p className="technical">{formatLocalDateTime(slot.updatedAt)} / {formatBytes(slot.byteLength)}</p>}
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => void assignSlot(slot.slot)}>Assign current</button>
                  <button type="button" disabled={!slot.text} onClick={() => void copySlot(slot.slot)}>Copy slot</button>
                </div>
              </article>
            ))}
          </div>
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
            vaultState.documents.map((document) => {
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
            })
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
            filteredItems.map((item) => {
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
            })
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

function VoiceInput({
  targetLabel,
  onTranscript,
  onAction,
  onBeforeDictation
}: {
  targetLabel: string;
  onTranscript: (text: string) => void;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onBeforeDictation?: () => void;
}) {
  const [status, setStatus] = useState("Click mic to start local dictation.");
  const [isListening, setIsListening] = useState(false);

  async function startDictation(): Promise<void> {
    onBeforeDictation?.();
    setIsListening(true);
    setStatus("Starting Windows dictation...");

    const windowsResult = await getBridge().startWindowsDictation();
    if (windowsResult.ok) {
      setStatus("Windows dictation started. Speak now.");
      void onAction("voice.start_dictation_placeholder", "module_ui", { targetLabel, provider: "windows_dictation", result: "started" });
      window.setTimeout(() => {
        setIsListening(false);
        setStatus("Click mic to start local dictation.");
      }, 2500);
      return;
    }

    const SpeechCtor = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!SpeechCtor) {
      setIsListening(false);
      setStatus("Windows dictation could not start. Click the text box and press Windows + H, or type manually.");
      void onAction("voice.start_dictation_placeholder", "module_ui", {
        targetLabel,
        supported: false,
        windowsError: windowsResult.error
      });
      return;
    }

    const recognition = new (SpeechCtor as new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      start: () => void;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
    })();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      onTranscript(transcript);
      setStatus("Voice text captured.");
      void onAction("voice.start_dictation_placeholder", "module_ui", { targetLabel, supported: true, result: "success" });
    };
    recognition.onerror = () => {
      setIsListening(false);
      setStatus("Voice input failed. Click the text box and press Windows + H, or type manually.");
      void onAction("voice.start_dictation_placeholder", "module_ui", {
        targetLabel,
        supported: true,
        result: "failed",
        windowsError: windowsResult.error
      });
    };
    recognition.onend = () => {
      setIsListening(false);
      setStatus((current) => current === "Listening..." ? "Voice input ended." : current);
    };

    try {
      setStatus("Listening...");
      recognition.start();
      void onAction("voice.start_dictation_placeholder", "module_ui", {
        targetLabel,
        supported: true,
        result: "started",
        windowsFallbackError: windowsResult.error
      });
    } catch {
      setIsListening(false);
      setStatus("Voice input could not start. Click the text box and press Windows + H, or type manually.");
      void onAction("voice.start_dictation_placeholder", "module_ui", {
        targetLabel,
        supported: true,
        result: "start_failed",
        windowsError: windowsResult.error
      });
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
  onAction,
  onRefresh
}: {
  journalState: JournalState;
  calendarState: CalendarState;
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

  return (
    <section className="view-stack accent-journal" aria-labelledby="journal-title">
      <PageHeader eyebrow="Private local capture" title="Journal" titleId="journal-title" />

      <div className="dashboard-grid">
        <Panel title="Today's Entry">
          <div className="registry-controls">
            <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional title" /></label>
            <label>Mode<select value={mode} onChange={(event) => setMode(event.target.value as "one-line" | "full")}><option value="full">Full entry</option><option value="one-line">One-line mode</option></select></label>
          </div>
          <VoiceInput
            targetLabel="Journal entry"
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
  onAction,
  onRefresh
}: {
  calendarState: CalendarState;
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
  onAction,
  onRefresh
}: {
  finderState: FinderState;
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
          {financeState.transactions.length === 0 ? <p>No Finance transactions yet.</p> : financeState.transactions.map((transaction) => (
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
          ))}
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
  onAction,
  onRefresh
}: {
  captureState: CaptureState;
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

      <Panel title="Quick Capture">
        <div className="project-form">
          <label>Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as CaptureItemType })}><option value="note">note</option><option value="link">link</option><option value="task">task</option><option value="expense">expense</option><option value="file">file</option><option value="image">image</option><option value="document">document</option><option value="other">other</option></select></label>
          <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Quick title" /></label>
          <label>URL<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="Optional link" /></label>
          <label>Tags<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="inbox, later" /></label>
          <label>Text<textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} placeholder="Note, task, thought, expense, or routing context" /></label>
        </div>
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
          {captureState.inbox.length === 0 ? <p>No Capture inbox items yet.</p> : captureState.inbox.map(renderCaptureItem)}
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel title={`Routed Items (${captureState.routed.length})`}>
          <div className="action-list action-list--compact">
            {captureState.routed.length === 0 ? <p>No routed items yet.</p> : captureState.routed.map(renderCaptureItem)}
          </div>
        </Panel>
        <Panel title={`Archived (${captureState.archived.length})`}>
          <div className="action-list action-list--compact">
            {captureState.archived.length === 0 ? <p>No archived captures.</p> : captureState.archived.map(renderCaptureItem)}
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
  assistantFocusSignal,
  onAction,
  onRefresh
}: {
  searchState: SearchState;
  actions: ActionDefinition[];
  assistantSettings: AssistantSettings;
  onAssistantSettingsChange: () => Promise<void>;
  securityState: AssistantSecurityState;
  onSecurityChange: () => Promise<void>;
  assistantFocusSignal: number;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    results?: SearchResult[];
    secureResults?: SecureSearchResult[];
    smartResults?: SmartLookupResult[];
    searchState?: SearchState;
    savedSearch?: SavedSearch;
  }>;
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
  const recentRecovery = searchState.index
    .filter((item) => Boolean(item.filePath))
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);

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
        setResults(result.results ?? []);
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
          onAction={onAction}
          focusSignal={assistantFocusSignal}
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
          events.map((event) => (
            <article className="event-row" key={event.id}>
              <p className="technical">{formatLocalDateTime(event.timestamp)}</p>
              <p>{event.module}</p>
              <p className="technical">{event.actionId ?? "none"}</p>
              <p>{event.status}</p>
              <p>{event.source}</p>
              <p>{event.summary}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function SettingsView({
  appInfo,
  backupState,
  calendarState,
  performanceModeState,
  performanceModeSettings,
  onAction,
  onPerformanceChanged,
  onRefresh
}: {
  appInfo: AppInfo | null;
  backupState: BackupState;
  calendarState: CalendarState;
  performanceModeState: PerformanceModeState;
  performanceModeSettings: PerformanceModeSettings;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onPerformanceChanged: (settings?: Partial<PerformanceModeSettings>, enabled?: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [backupOptions, setBackupOptions] = useState<BackupOptions>(backupState.defaultOptions);
  const [restorePath, setRestorePath] = useState("");
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const [healthState, setHealthState] = useState<AppHealthState | null>(null);
  const [healthStatus, setHealthStatus] = useState("");
  const [performanceForm, setPerformanceForm] = useState<PerformanceModeSettings>(performanceModeSettings);
  const [performanceBusy, setPerformanceBusy] = useState(false);
  const [performanceSaving, setPerformanceSaving] = useState(false);
  const [lifecycleForm, setLifecycleForm] = useState<AppLifecycleSettings>(appInfo?.appLifecycleSettings ?? defaultAppLifecycleSettings);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [keyboardForm, setKeyboardForm] = useState<KeyboardShortcutSettings>(appInfo?.keyboardShortcutSettings ?? defaultKeyboardShortcutSettings);
  const [streamDeckForm, setStreamDeckForm] = useState<StreamDeckSettings>(appInfo?.streamDeckSettings ?? defaultStreamDeckSettings);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [externalState, setExternalState] = useState<ExternalDevicesState>(appInfo?.externalDevicesState ?? defaultExternalDevicesState);
  const [externalForm, setExternalForm] = useState<ExternalDevicesSettings>(appInfo?.externalDevicesState.settings ?? defaultExternalDevicesState.settings);
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
              placeholder={externalState.apiKeyStored ? "Stored securely; enter replacement" : "Paste Govee API key"}
            />
          </label>
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
          <button
            type="button"
            className="button-danger"
            disabled={externalBusy || !externalState.apiKeyStored}
            onClick={() => {
              if (window.confirm("Remove the Govee API key reference from DexNest External Devices settings?")) {
                void runExternalAction("external.govee.remove_api_key", { confirmedDangerous: true });
              }
            }}
          >
            Remove API key
          </button>
          {externalStatus && <span className="inline-status">{externalStatus}</span>}
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
