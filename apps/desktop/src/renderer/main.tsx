import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { formatLocalDate, formatLocalDateTime, getLocalTodayDateString, parseLocalDateInput, toLocalDateInputValue } from "@dexnest/shared-types";
import "@dexnest/shared-ui/tokens.css";
import "./styles.css";

type ViewId = "command" | "dev" | "deck" | "clipboard" | "drop" | "tools" | "vault" | "search" | "capture" | "journal" | "calendar" | "finder" | "finance" | "heatmap" | "audit" | "settings";
type ActionStatus = "success" | "failed" | "skipped" | "cancelled" | "pending";
type ToastTone = "success" | "error";

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
  commandResultsPath: string;
  pinnedActionsPath: string;
  clipboardHistoryPath: string;
  clipboardSnippetsPath: string;
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
  vaultMetadataPath: string;
  searchIndexPath: string;
  searchIndexFolderPath: string;
  savedSearchesPath: string;
  journalEntriesPath: string;
  calendarEventsPath: string;
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
  snippetsPath: string;
  historyPath: string;
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
  savedSearchesPath: string;
  resultCount: number;
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

interface CalendarState {
  events: CalendarEvent[];
  today: string;
  todayEvents: CalendarEvent[];
  upcomingEvents: CalendarEvent[];
  eventsPath: string;
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
  getAppHealth: () => Promise<AppHealthState>;
  getCommandStats: () => Promise<CommandStats>;
  selectToolsFiles: (kind: "pdf" | "image" | "any") => Promise<ToolsSelectedFile[]>;
  selectVaultFiles: () => Promise<ToolsSelectedFile[]>;
  selectFinanceReceipt: () => Promise<ToolsSelectedFile[]>;
  selectCaptureFile: () => Promise<ToolsSelectedFile[]>;
  getPdfInfo: (paths: string[]) => Promise<PdfInfoItem[]>;
  chooseToolsOutputFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  resetToolsOutputFolder: () => Promise<{ ok: boolean; path: string }>;
  saveToolsSettings: (payload: { ffmpegPath?: string | null; libreOfficePath?: string | null }) => Promise<unknown>;
  openToolsFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
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
    health?: AppHealthState;
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
}

declare global {
  interface Window {
    dexNest?: DexNestBridge;
  }
}

const fallbackBridge: DexNestBridge = {
  getAppInfo: async () => ({
    appName: "DexNest",
    dataRoot: "./local-data",
    dbPath: "./local-data/data/dexnest.sqlite",
    actionEndpoint: "http://127.0.0.1:43217",
    projectsConfigPath: "./local-data/settings/projects.json",
    commandResultsPath: "./local-data/settings/project-command-results.json",
    pinnedActionsPath: "./local-data/settings/pinned-actions.json",
    clipboardHistoryPath: "./local-data/settings/clipboard-history.json",
    clipboardSnippetsPath: "./local-data/settings/clipboard-snippets.json",
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
    vaultMetadataPath: "./local-data/settings/vault-documents.json",
    searchIndexPath: "./local-data/index/search-index.json",
    searchIndexFolderPath: "./local-data/index",
    savedSearchesPath: "./local-data/settings/saved-searches.json",
    journalEntriesPath: "./local-data/settings/journal-entries.json",
    calendarEventsPath: "./local-data/settings/calendar-events.json",
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
  getClipboardState: async () => ({ history: [], snippets: [], snippetsPath: "./local-data/settings/clipboard-snippets.json", historyPath: "./local-data/settings/clipboard-history.json" }),
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
    savedSearchesPath: "./local-data/settings/saved-searches.json",
    resultCount: 0,
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
    eventsPath: "./local-data/settings/calendar-events.json"
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
  logUiEvent: async () => undefined
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

function DexNestApp() {
  const [activeView, setActiveView] = useState<ViewId>("command");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [actions, setActions] = useState<ActionDefinition[]>([]);
  const [projects, setProjects] = useState<DexNestProject[]>([]);
  const [commandResults, setCommandResults] = useState<Record<string, ProjectCommandResult>>({});
  const [pinnedActionIds, setPinnedActionIds] = useState<string[]>([]);
  const [clipboardState, setClipboardState] = useState<ClipboardState>({ history: [], snippets: [], snippetsPath: "", historyPath: "" });
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
    savedSearchesPath: "",
    resultCount: 0,
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
    eventsPath: ""
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

  const activeLabel = useMemo(
    () => views.find((view) => view.id === activeView)?.label ?? "Command",
    [activeView]
  );

  useEffect(() => {
    void refreshShellData();
  }, []);

  async function refreshShellData(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextToolsState, nextVaultState, nextSearchState, nextJournalState, nextCalendarState, nextFinderState, nextFinanceState, nextCaptureState, nextHeatmapState, nextRoutinesState, nextBackupState, nextCommandStats, nextEvents] = await Promise.all([
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
    setCommandStats(nextCommandStats);
    setEvents(nextEvents);
  }

  async function refreshEvents(): Promise<void> {
    const recentEvents = await getBridge().listEvents();
    setEvents(recentEvents);
  }

  async function refreshProjectsAndActions(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextToolsState, nextVaultState, nextSearchState, nextJournalState, nextCalendarState, nextFinderState, nextFinanceState, nextCaptureState, nextHeatmapState, nextRoutinesState, nextCommandStats, nextEvents] = await Promise.all([
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
    setCommandStats(nextCommandStats);
    setEvents(nextEvents);
  }

  async function runAction(actionId: string, source = "module_ui", params: unknown = {}) {
    const result = await getBridge().runAction({ actionId, source, params });
    await refreshShellData();
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

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
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
              actions={actions}
              pinnedActionIds={pinnedActionIds}
              calendarState={calendarState}
              commandStats={commandStats}
              events={events}
              onAction={runUiAction}
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
              onAction={runUiAction}
              onRefresh={refreshShellData}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function CommandView({
  actions,
  pinnedActionIds,
  calendarState,
  commandStats,
  events,
  onAction,
  onPinnedActionsChange
}: {
  actions: ActionDefinition[];
  pinnedActionIds: string[];
  calendarState: CalendarState;
  commandStats: CommandStats;
  events: EventEntry[];
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onPinnedActionsChange: (actionIds: string[]) => Promise<void>;
}) {
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionSearch, setActionSearch] = useState("");
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

  function canRunWithoutConfirmation(action: ActionDefinition): boolean {
    return action.dangerLevel === "safe" || action.dangerLevel === "caution";
  }

  async function runRegistryAction(action: ActionDefinition): Promise<void> {
    if (!canRunWithoutConfirmation(action)) {
      const confirmed = window.confirm(`Run ${action.title}? Danger level: ${action.dangerLevel}.`);
      if (!confirmed) {
        return;
      }
    }

    await onAction(action.id, "module_ui", { confirmedDangerous: !canRunWithoutConfirmation(action) });
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

  const statCards = [
    ["Journal week", commandStats.journalEntriesThisWeek],
    ["Calendar upcoming", commandStats.calendarUpcoming],
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
                    <button type="button" onClick={() => void runRegistryAction(action)}>
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
                    <button type="button" onClick={() => void runRegistryAction(action)}>
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
  onAction
}: {
  clipboardState: ClipboardState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
}) {
  const [activeTab, setActiveTab] = useState<"history" | "snippets" | "rules">("history");
  const [snippetForm, setSnippetForm] = useState(emptySnippetForm);

  async function saveCurrentClipboard(): Promise<void> {
    await onAction("clipboard.save_current");
  }

  async function pasteAsPlainText(): Promise<void> {
    await onAction("clipboard.copy_plain_text");
  }

  async function saveSnippet(): Promise<void> {
    await onAction("clipboard.create_snippet", "module_ui", snippetForm);
    setSnippetForm(emptySnippetForm);
  }

  async function deleteSnippet(snippetId: string): Promise<void> {
    const confirmed = window.confirm("Delete this DexNest Clipboard snippet?");
    if (!confirmed) {
      return;
    }

    await onAction("clipboard.delete_snippet", "module_ui", { id: snippetId, confirmedDangerous: true });
  }

  return (
    <section className="view-stack" aria-labelledby="clipboard-title">
      <PageHeader eyebrow="Manual local clipboard" title="Clipboard" titleId="clipboard-title" />

      <Panel title="Manual Clipboard Actions">
        <div className="button-row">
          <button type="button" onClick={() => void saveCurrentClipboard()}>
            Save current clipboard
          </button>
          <button type="button" onClick={() => void pasteAsPlainText()}>
            Paste as plain text
          </button>
        </div>
        <p>No listener is running. Clipboard entries are saved only when you click.</p>
      </Panel>

      <div className="tabs" role="tablist" aria-label="Clipboard sections">
        <button type="button" data-active={activeTab === "history"} onClick={() => setActiveTab("history")}>
          History
        </button>
        <button type="button" data-active={activeTab === "snippets"} onClick={() => setActiveTab("snippets")}>
          Snippets
        </button>
        <button type="button" data-active={activeTab === "rules"} onClick={() => setActiveTab("rules")}>
          Rules
        </button>
      </div>

      {activeTab === "history" && (
        <Panel title="Clipboard History">
          <p className="technical">{clipboardState.historyPath}</p>
          <div className="item-list">
            {clipboardState.history.length === 0 ? (
              <p>No clipboard history yet.</p>
            ) : (
              clipboardState.history.map((item) => (
                <CollapsibleListItem
                  accentClass="accent-clipboard"
                  key={item.id}
                  title={item.preview || "Saved clipboard text"}
                  meta={`${item.byteLength} bytes / ${formatLocalDateTime(item.createdAt)}`}
                >
                  <p className="technical">{item.id}</p>
                </CollapsibleListItem>
              ))
            )}
          </div>
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

      {activeTab === "rules" && (
        <div className="dashboard-grid">
          <Panel title="Per-App Rules">
            <p>Placeholder only. No app monitoring or clipboard listener is active yet.</p>
          </Panel>
          <Panel title="Secret Protection">
            <p>Placeholder only. Future rules can flag passwords, tokens, and sensitive snippets before saving.</p>
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
  const [activeTab, setActiveTab] = useState<"pdf" | "images" | "media" | "office" | "outputs" | "settings">("pdf");
  const [ffmpegPath, setFfmpegPath] = useState(toolsState.ffmpegPath ?? "");
  const [libreOfficePath, setLibreOfficePath] = useState(toolsState.libreOfficePath ?? "");
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [draggedFileIndex, setDraggedFileIndex] = useState<number | null>(null);

  const selectedPaths = selectedFiles.map((file) => file.path);

  useEffect(() => {
    setFfmpegPath(toolsState.ffmpegPath ?? "");
    setLibreOfficePath(toolsState.libreOfficePath ?? "");
  }, [toolsState.ffmpegPath, toolsState.libreOfficePath]);

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
    const result = await onAction(actionId, "module_ui", { paths: selectedPaths, ...params });
    setRunningActionId(null);

    if (result.ok) {
      const count = result.outputs?.length ?? (result.output ? 1 : 0);
      showStatus(count ? `Created ${count} output file${count === 1 ? "" : "s"}.` : "Tools action completed.");
      await onRefresh();
    } else {
      showStatus(result.error ?? "Tools action failed.", "error");
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
        libreOfficePath
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
            <div className="button-row">
              <button type="button" onClick={() => void saveDependencySettings()}>Save paths</button>
              <button type="button" onClick={() => { setFfmpegPath(""); setLibreOfficePath(""); }}>Clear fields</button>
            </div>
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
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

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
          <p>Metadata path</p>
          <p className="technical">{vaultState.metadataPath}</p>
          <p>{vaultState.documentCount} documents / {formatBytes(vaultState.totalSizeBytes)}</p>
          <p>Sensitive encrypted Vault is a future layer. Encryption is not enabled yet.</p>
        </Panel>
      </div>

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
                    <span className="status-pill">{document.tags.length ? document.tags[0] : "No tags"}</span>
                  </button>
                  {expanded && (
                    <div className="vault-document__details">
                      <div>
                        <p>{document.tags.length ? document.tags.join(", ") : "No tags"}{document.expiryDate ? ` / expires ${formatLocalDate(document.expiryDate)}` : ""}</p>
                        <p>{formatDate(document.createdAt)}</p>
                        <p className="technical">{document.id}</p>
                        <p className="technical">{document.filePath}</p>
                      </div>
                      <div className="button-row">
                        <button type="button" onClick={() => void runDocumentAction("vault.open_document", document)}>Open file</button>
                        <button type="button" onClick={() => void runDocumentAction("vault.open_document_folder", document)}>Open folder</button>
                        <button type="button" onClick={() => startEdit(document)}>Edit metadata</button>
                        <button type="button" onClick={() => void addVersion(document)}>New version</button>
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
    const eventSource = new EventSource(eventsUrl);

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { eventType?: string; message?: string };
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
  }

  async function sendClipboardToDrop(): Promise<void> {
    const result = await onAction("drop.send_clipboard_to_drop") as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clipboard send failed" : "Text sent", result?.ok === false ? "error" : "success");
  }

  async function addOutgoingFile(): Promise<void> {
    const result = await onAction("drop.add_outgoing_file") as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "File add failed" : "File added", result?.ok === false ? "error" : "success");
  }

  async function removeOutgoingFile(fileId: string): Promise<void> {
    const confirmed = window.confirm("Remove this outgoing Drop file copy?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.remove_outgoing_file", "module_ui", { id: fileId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "File remove failed" : "File removed", result?.ok === false ? "error" : "success");
  }

  async function clearOutgoing(): Promise<void> {
    const confirmed = window.confirm("Clear outgoing DexNest Drop text and file items?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_outgoing", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear outgoing failed" : "Outgoing cleared", result?.ok === false ? "error" : "success");
  }

  async function clearIncoming(): Promise<void> {
    const confirmed = window.confirm("Clear incoming DexNest Drop metadata? Received files stay on disk.");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_incoming", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear incoming failed" : "Incoming list cleared", result?.ok === false ? "error" : "success");
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
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{ ok: boolean; error?: string; event?: CalendarEvent }>;
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
  const calendarTitleRef = useRef<HTMLInputElement | null>(null);

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
        <Panel title="Nudge">
          <p>Placeholder for light local reminders. No background worker added in this phase.</p>
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
  onAction,
  onRefresh
}: {
  searchState: SearchState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    results?: SearchResult[];
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
  const [status, setStatus] = useState("");

  const currentParams = { query, sourceModule, fileType, dateFrom, dateTo };
  const recentRecovery = searchState.index
    .filter((item) => Boolean(item.filePath))
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);

  async function rebuildIndex(): Promise<void> {
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
    const result = await onAction("search.run_query", "module_ui", nextParams);
    if (result.ok) {
      setResults(result.results ?? []);
      setStatus(`${result.results?.length ?? 0} results.`);
    } else {
      setStatus(result.error ?? "Search failed.");
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

  function sourceOpenAction(sourceModule: string): string | null {
    const actionMap: Record<string, string> = {
      capture: "capture.open",
      clipboard: "clipboard.open",
      dev: "dev.open_dashboard",
      drop: "drop.open",
      finance: "finance.open",
      finder: "finder.open",
      tools: "tools.open",
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
          <button type="button" onClick={() => void runQuery()}>Search</button>
          <button type="button" onClick={() => void saveQuery()}>Save search</button>
          {status && <span className="inline-status">{status}</span>}
        </div>
      </Panel>

      <div className="search-meta-grid">
        <Panel title="Index">
          <div className="action-list action-list--compact">
            <p>{searchState.index.length} indexed records. Manual rebuild only. Secure Vault contents are skipped.</p>
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
            <EmptyState>No results yet. Rebuild the index, then run a search.</EmptyState>
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
  endpoint,
  onAction,
  onRefresh,
  refreshEvents
}: {
  actions: ActionDefinition[];
  projects: DexNestProject[];
  routinesState: RoutinesState;
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
  const [deckToasts, setDeckToasts] = useState<ToastMessage[]>([]);
  const [actionSearch, setActionSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [dangerFilter, setDangerFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
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
    return matchesSearch && matchesModule && matchesDanger && matchesProject;
  }).sort((a, b) => a.id.localeCompare(b.id)), [actions, actionSearchTerm, dangerFilter, moduleFilter, projectFilter]);
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
          <div className="deck-endpoint-strip">
            <PathText>{endpoint ? `${endpoint}/actions/deck.test_endpoint` : "Loading endpoint"}</PathText>
            <button type="button" onClick={() => void runEndpointAction("deck.test_endpoint")}>
              Run test action
            </button>
          </div>
        </Panel>
        <Panel title="Pinned Deck Buttons">
          <EmptyState>Pinned Stream Deck-style buttons will live here.</EmptyState>
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
  onAction,
  onRefresh
}: {
  appInfo: AppInfo | null;
  backupState: BackupState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [backupOptions, setBackupOptions] = useState<BackupOptions>(backupState.defaultOptions);
  const [restorePath, setRestorePath] = useState("");
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const [healthState, setHealthState] = useState<AppHealthState | null>(null);
  const [healthStatus, setHealthStatus] = useState("");

  useEffect(() => {
    setBackupOptions(backupState.defaultOptions);
  }, [backupState.defaultOptions]);

  useEffect(() => {
    void runHealthCheck();
  }, []);

  const rows = [
    ["Data root", appInfo?.dataRoot ?? "Loading"],
    ["Database", appInfo?.dbPath ?? "Loading"],
    ["Local endpoint", appInfo?.actionEndpoint ?? "Loading"],
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
    ["Search index", appInfo?.searchIndexPath ?? "Loading"],
    ["Search index folder", appInfo?.searchIndexFolderPath ?? "Loading"],
    ["Saved searches", appInfo?.savedSearchesPath ?? "Loading"],
    ["Journal entries", appInfo?.journalEntriesPath ?? "Loading"],
    ["Calendar events", appInfo?.calendarEventsPath ?? "Loading"],
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
    ["Detected local timezone", appInfo?.localTimeZone ?? "Loading"],
    ["Current local date/time", appInfo?.localDateTimePreview ?? formatLocalDateTime(new Date())],
    ["Current local date", appInfo?.localToday ? formatLocalDate(appInfo.localToday) : formatLocalDate(getLocalTodayDateString())],
    ["Drop phone URL", appInfo?.dropPhoneUrl ?? "Loading"],
    ["Detected LAN IP", appInfo?.lanIp ?? "Not detected"],
    ["Saved projects", String(appInfo?.projectCount ?? 0)],
    ["App version", "0.1.0"],
    ["Performance mode", appInfo?.performanceMode ?? "Loading"]
  ];

  function updateBackupOption(key: keyof BackupOptions, value: boolean): void {
    setBackupOptions((current) => ({ ...current, [key]: value }));
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

  function healthTone(status: HealthStatus): "success" | "warning" | "error" {
    if (status === "pass") {
      return "success";
    }
    return status === "warn" ? "warning" : "error";
  }

  return (
    <section className="view-stack" aria-labelledby="settings-title">
      <PageHeader eyebrow="Local-only configuration" title="Settings" titleId="settings-title" />

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

