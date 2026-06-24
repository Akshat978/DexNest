import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { exec, execFile, execFileSync } from "node:child_process";
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import AdmZip from "adm-zip";
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
const receiptsRoot = join(localDataRoot, "files", "receipts");
const capturesRoot = join(localDataRoot, "files", "captures");
const projectsConfigPath = join(settingsRoot, "projects.json");
const commandSettingsPath = join(settingsRoot, "command-settings.json");
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
const captureItemsPath = join(settingsRoot, "capture-items.json");
const routinesPath = join(settingsRoot, "routines.json");
const heatmapEventsPath = join(settingsRoot, "heatmap-events.json");
const heatmapSettingsPath = join(settingsRoot, "heatmap-settings.json");
const heatmapGoalsPath = join(settingsRoot, "heatmap-goals.json");
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
let tray: Tray | null = null;
let actionServer: ReturnType<typeof createServer> | null = null;
let secureVaultKey: Buffer | null = null;
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
let vaultOcrQueueRunning = false;
let vaultOcrQueuePaused = false;

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

interface ProjectInput {
  id?: string;
  name: string;
  path: string;
  description?: string;
  accent?: string;
  commands?: Partial<DexNestProject["commands"]>;
  urls?: string[];
  notes?: string;
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
  performanceModePlaceholder: boolean;
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
  text: string;
  preview: string;
  byteLength: number;
  updatedAt: string;
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
  itemTypes: SecureVaultItemType[];
  items: SecureVaultUnlockedItem[];
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
  sourceDocumentTitle: string;
  sourceFilePath?: string | null;
  ocrTextPath?: string | null;
  preview: string;
  score: number;
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

interface FinanceTransactionInput {
  id?: string;
  transactionId?: string;
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
  const latestBackup = listBackups()[0] ?? null;
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
        check("backup-folder-exists", "Backup folder exists", existsSync(backupsRoot) ? "pass" : "fail", backupsRoot, "Open Settings Backup or create a backup.")
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
        check("secure-vault-lock", "Secure Vault lock state", secureState.isSetup && !secureState.isUnlocked ? "pass" : secureState.isSetup ? "warn" : "warn", secureState.isSetup ? (secureState.isUnlocked ? "Secure Vault is currently unlocked." : "Secure Vault is locked.") : "Not configured.", secureState.isUnlocked ? "Lock Secure Vault when not actively using secrets." : undefined),
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
        check("performance-mode", "Performance mode", "warn", "Performance mode is a placeholder."),
        check("command-shortcut", "Command global shortcut", !commandSettings.globalShortcutEnabled ? "warn" : commandSettings.globalShortcutStatus === "active" ? "pass" : "warn", `${commandSettings.globalShortcut} / ${commandSettings.globalShortcutStatus}${commandSettings.globalShortcutLastError ? ` / ${commandSettings.globalShortcutLastError}` : ""}`, commandSettings.globalShortcutStatus === "failed" ? "Switch DexNest Command shortcut to Ctrl+Alt+Space or Ctrl+Shift+Space." : undefined),
        check("tray-status", "Tray status", tray && commandSettings.trayStatus === "active" ? "pass" : "warn", tray && commandSettings.trayStatus === "active" ? "DexNest tray is active." : "DexNest tray is not active.", "Restart DexNest if the tray icon is missing."),
        check("heatmap-state", "Heatmap status", heatmap.settings.enabled && !heatmap.settings.paused ? "warn" : "pass", heatmap.trackingStatus, heatmap.settings.enabled && !heatmap.settings.paused ? "Heatmap samples only at configured interval." : undefined),
        check("polling-sources", "Active polling sources", "pass", "No global polling. Drop auto-refresh runs only while Drop page is open."),
        check("heavy-workers", "No OCR/Search/AI workers", "pass", "No background OCR, Search indexing, AI, embeddings, or local LLM workers are running.")
      ]
    },
    {
      id: "integrations",
      title: "Integrations",
      checks: [
        check("drop-server", "Drop server status", actionServer ? "pass" : "fail", actionServer ? "Local action/Drop server is running." : "Local server is not running."),
        check("drop-lan-url", "Drop LAN URL", getLanIp() ? "pass" : "warn", dropPhoneUrl(), "LAN IP may be unavailable when offline or blocked by adapter settings."),
        check("ffmpeg", "ffmpeg", tools.detectedFfmpegPath || tools.ffmpegPath ? "pass" : "warn", tools.ffmpegPath || tools.detectedFfmpegPath || "Missing.", "Install ffmpeg or set the path in Tools settings for media conversions."),
        check("libreoffice", "LibreOffice", tools.detectedLibreOfficePath || tools.libreOfficePath ? "pass" : "warn", tools.libreOfficePath || tools.detectedLibreOfficePath || "Missing.", "Install LibreOffice or set soffice.exe path for Office conversions."),
        check("tesseract", "Tesseract OCR", tools.detectedTesseractPath || tools.tesseractPath ? "pass" : "warn", tools.tesseractPath || tools.detectedTesseractPath || "Missing.", "Install Tesseract OCR or set tesseract.exe path in Tools settings for OCR."),
        check("python-paddleocr", "Python/PaddleOCR", tools.detectedPythonPath || tools.pythonPath ? "pass" : "warn", tools.pythonPath || tools.detectedPythonPath || "Python missing.", "Use Python 3.12 for PaddleOCR, then run: py -3.12 -m pip install paddleocr paddlepaddle, or switch OCR engine to Tesseract."),
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

  return state;
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
      autoLockMinutes: Math.min(60, Math.max(1, Math.floor(autoLockMinutes)))
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

function scheduleSecureVaultAutoLock(minutes: number): void {
  if (secureVaultAutoLockTimer) {
    clearTimeout(secureVaultAutoLockTimer);
    secureVaultAutoLockTimer = null;
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
    itemTypes: secureVaultItemTypes,
    items: file && secureVaultKey ? secureVaultUnlockedItems() : []
  };
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

function defaultCommandSettings(): CommandSettings {
  return {
    globalShortcutEnabled: true,
    globalShortcut: "CommandOrControl+Space",
    globalShortcutStatus: "disabled",
    globalShortcutLastError: null,
    trayEnabled: true,
    trayStatus: "failed",
    performanceModePlaceholder: false
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
    secretProtectionEnabled: true
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
    text: "",
    preview: "",
    byteLength: 0,
    updatedAt: ""
  }));
}

function loadClipboardSlots(): ClipboardSlot[] {
  const savedSlots = readJsonFile<ClipboardSlot[]>(clipboardSlotsPath, defaultClipboardSlots());
  const savedSlotByNumber = new Map(savedSlots.map((slot) => [slot.slot, slot]));
  return defaultClipboardSlots().map((slot) => savedSlotByNumber.get(slot.slot) ?? slot);
}

function saveClipboardSlots(slots: ClipboardSlot[]): ClipboardSlot[] {
  const normalized = defaultClipboardSlots().map((slot) => slots.find((item) => item.slot === slot.slot) ?? slot);
  return writeJsonFile(clipboardSlotsPath, normalized);
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

function focusDexNestWindow(view: string = "command", source: DexNestActionTrigger | "tray" | "system" = "system"): void {
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
  mainWindow.focus();
  const sendView = () => mainWindow?.webContents.send("dexnest:open-view", { view });
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", sendView);
  } else {
    sendView();
  }

  localDb.appendActionEvent({
    module: "DexNest Command",
    actionId: view === "command" ? "command.open_palette" : `tray.open_${view}`,
    eventType: source === "tray" ? "tray_action_used" : "command_shortcut_opened",
    status: "success",
    source: source === "tray" ? "system" : source,
    summary: source === "tray" ? `Opened DexNest ${view} from tray.` : "Opened DexNest Command from global shortcut.",
    metadataJson: { view }
  });
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

function createTrayIcon(): Electron.NativeImage {
  const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#000000"/><circle cx="16" cy="16" r="9" fill="none" stroke="#22D3EE" stroke-width="3"/><circle cx="16" cy="16" r="3" fill="#22D3EE"/></svg>`);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function togglePerformancePlaceholder(): void {
  const settings = loadCommandSettings();
  const next = saveCommandSettings({ ...settings, performanceModePlaceholder: !settings.performanceModePlaceholder });
  localDb.appendActionEvent({
    module: "DexNest Command",
    actionId: "command.performance_mode_placeholder",
    eventType: "tray_action_used",
    status: "success",
    source: "system",
    summary: `Performance Mode placeholder ${next.performanceModePlaceholder ? "enabled" : "disabled"}.`,
    metadataJson: { enabled: next.performanceModePlaceholder }
  });
  createDexNestTray();
}

function createDexNestTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  try {
    tray = new Tray(createTrayIcon());
    tray.setToolTip("DexNest");
    const nudgeCount = currentNudges().length;
    const menu = Menu.buildFromTemplate([
      { label: mainWindow?.isVisible() ? "Hide DexNest" : "Show DexNest", click: () => mainWindow?.isVisible() ? mainWindow.hide() : focusDexNestWindow("command", "tray") },
      { type: "separator" },
      { label: `${nudgeCount} active nudge${nudgeCount === 1 ? "" : "s"}`, enabled: false },
      { type: "separator" },
      { label: "Open Command", click: () => focusDexNestWindow("command", "tray") },
      { label: "Open Clipboard", click: () => focusDexNestWindow("clipboard", "tray") },
      { label: "Open Drop", click: () => focusDexNestWindow("drop", "tray") },
      { label: "Open Dev", click: () => focusDexNestWindow("dev", "tray") },
      { label: "Open Journal", click: () => focusDexNestWindow("journal", "tray") },
      { label: "Open Settings", click: () => focusDexNestWindow("settings", "tray") },
      { type: "separator" },
      { label: `${loadCommandSettings().performanceModePlaceholder ? "Disable" : "Enable"} Performance Mode placeholder`, click: () => togglePerformancePlaceholder() },
      { type: "separator" },
      { label: "Quit DexNest", click: () => app.quit() }
    ]);
    tray.setContextMenu(menu);
    tray.on("click", () => focusDexNestWindow("command", "tray"));
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
      const settings = loadClipboardSettings();
      saveClipboardSettings({
        ...settings,
        lastReadAt: new Date().toISOString(),
        lastReadPreview: previewText(text),
        lastReadError: null
      });
    } catch (error) {
      const settings = loadClipboardSettings();
      saveClipboardSettings({
        ...settings,
        lastReadAt: new Date().toISOString(),
        lastReadError: error instanceof Error ? error.message : "Clipboard read failed."
      });
      return;
    }
    if (!text || text === lastClipboardListenerText) {
      return;
    }

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

function loadFinanceTransactions(): FinanceTransaction[] {
  ensureFinanceRoot();
  return readJsonFile<FinanceTransaction[]>(financeTransactionsPath, []);
}

function saveFinanceTransactions(items: FinanceTransaction[]): FinanceTransaction[] {
  ensureFinanceRoot();
  return writeJsonFile(financeTransactionsPath, items);
}

function loadFinanceRecurring(): FinanceRecurringExpense[] {
  ensureFinanceRoot();
  return readJsonFile<FinanceRecurringExpense[]>(financeRecurringPath, []);
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
  if (!settings.enabled || settings.paused) {
    return;
  }

  heatmapSampleTimer = setInterval(() => {
    void logHeatmapSample("system");
  }, Math.max(60, settings.sampleIntervalSeconds) * 1000);
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

function execFileAsync(file: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(file, args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
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
      }
    ];

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
    records.push({
      id: `vault-${document.id}`,
      sourceModule: "vault",
      entityType: ocrText ? "vault_document_ocr" : "vault_document",
      entityId: document.id,
      title: document.title || document.originalFileName,
      filePath: document.filePath,
      fileType: document.fileType || fileTypeForPath(document.filePath),
      sizeBytes: document.sizeBytes,
      textPreview: previewText(textBucket(document.originalFileName, document.notes, ocrText)),
      searchableText: normalizeSearchText(textBucket(document.title, document.originalFileName, document.notes, document.category, document.tags.join(" "), ocrText, String(ocrMetadata?.engine ?? ""), String(ocrMetadata?.device ?? ""))),
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

function smartLookupTextForRecord(record: SearchIndexRecord): { text: string; ocrTextPath: string | null } {
  if (record.sourceModule === "vault") {
    const document = findVaultDocument(record.entityId);
    if (document?.ocrTextPath && existsSync(document.ocrTextPath) && isPathInside(vaultOcrRoot, document.ocrTextPath)) {
      return { text: readTextFileForSearch(document.ocrTextPath, 5 * 1024 * 1024), ocrTextPath: document.ocrTextPath };
    }
  }
  if ((record.entityType === "tools_ocr_text" || record.fileType === ".txt") && record.filePath && existsSync(record.filePath)) {
    return { text: readTextFileForSearch(record.filePath, 5 * 1024 * 1024), ocrTextPath: record.filePath };
  }
  return { text: textBucket(record.title, record.textPreview, record.searchableText), ocrTextPath: null };
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

function smartPatternsForField(fieldType: string): RegExp[] {
  switch (fieldType) {
    case "sin":
      return [/\b(?:sin|social insurance number)?\s*[:#-]?\s*(\d{3}[-\s]?\d{3}[-\s]?\d{3})\b/gi];
    case "passport_number":
      return [/\b(?:passport(?:\s*(?:no|number|#))?)\s*[:#-]?\s*([A-Z]{1,2}\d{6,8}|[A-Z0-9]{6,9})\b/gi];
    case "permit_number":
      return [/\b(?:document number|document no|permit number|permit no|work permit(?:\s*(?:no|number|#))?)\s*[:#-]?\s*([A-Z]{1,4}\d{6,10}|[A-Z0-9-]{7,14})\b/gi];
    case "uci":
      return [/\b(?:uci|client id|unique client identifier)\s*[:#-]?\s*(\d{4}[-\s]?\d{4}|\d{8,10})\b/gi];
    case "expiry_date":
      return [/\b(?:expiry date|expires|valid until|valid to|valid thru)\s*[:#-]?\s*([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/gi];
    case "issue_date":
      return [/\b(?:issue date|issued|date of issue)\s*[:#-]?\s*([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/gi];
    case "health_card":
      return [/\b(?:health card|health number|ohip|phn)\s*[:#-]?\s*([A-Z0-9 -]{8,16})\b/gi];
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
  const records = loadSearchIndex().filter((record) => (
    record.sourceModule === "vault"
    || record.sourceModule === "tools_ocr"
    || record.entityType === "vault_document_ocr"
    || record.entityType === "tools_ocr_text"
  ));
  const results: SmartLookupResult[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const { text, ocrTextPath } = smartLookupTextForRecord(record);
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
            sourceDocumentTitle: record.title,
            sourceFilePath: record.filePath ?? null,
            ocrTextPath,
            preview,
            score
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
  const transactions = loadFinanceTransactions().sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const recurring = loadFinanceRecurring().sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
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
    trackingStatus: settings.enabled && !settings.paused && heatmapSampleTimer ? "running" : settings.enabled ? "paused" : "disabled",
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
      logVaultEvent(action.id, "success", source, "Updated Vault document metadata.", {
        documentId,
        category: updated.category,
        fileType: updated.fileType,
        sizeBytes: updated.sizeBytes
      }, startedAt);
      return { ok: true, actionId: action.id, document: updated };
    }

    if (action.id === "vault.ocr.run_queue") {
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
      vaultOcrQueuePaused = false;
      void processVaultOcrQueue(source);
      logVaultEvent(action.id, "success", source, "Retried failed Vault OCR jobs.", { retriedCount: failed.length, engine: "paddleocr", device: "gpu" }, startedAt);
      return { ok: true, actionId: action.id, vaultState: vaultState() };
    }

    if (action.id === "vault.ocr.rerun_document") {
      const document = verifiedVaultDocument(String(params.documentId ?? ""));
      const job = queueVaultOcrJob(document, true);
      if (job) {
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
  if (loadCommandSettings().performanceModePlaceholder) {
    vaultOcrQueuePaused = true;
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
      combinedSeparator: typeof params.combinedSeparator === "string" ? params.combinedSeparator : currentSettings.combinedSeparator
    };
    saveClipboardSettings(nextSettings);
    registerClipboardHotkey();
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

  if (action.id === "clipboard.assign_slot") {
    const slotNumber = Number(params.slot);
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
      return { ok: false, actionId: action.id, error: clipboardProtectedError() };
    }
    const slots = loadClipboardSlots();
    const nextSlot: ClipboardSlot = {
      slot: slotNumber,
      text,
      preview: previewText(text),
      byteLength: byteLength(text),
      updatedAt: now
    };
    saveClipboardSlots(slots.map((slot) => slot.slot === slotNumber ? nextSlot : slot));
    logActionEvent(action, "success", source, `Assigned current clipboard to slot ${slotNumber}, ${nextSlot.byteLength} bytes.`, {
      slot: slotNumber,
      byteLength: nextSlot.byteLength
    });
    return { ok: true, actionId: action.id, slot: nextSlot };
  }

  if (action.id === "clipboard.copy_slot") {
    const slotNumber = Number(params.slot);
    const slot = loadClipboardSlots().find((item) => item.slot === slotNumber);
    if (!slot?.text) {
      logActionEvent(action, "failed", source, "Clipboard slot copy failed because the slot was empty.", { slot: slotNumber });
      return { ok: false, actionId: action.id, error: "Clipboard slot is empty." };
    }
    clipboard.writeText(slot.text);
    lastClipboardListenerText = slot.text;
    logActionEvent(action, "success", source, `Copied Clipboard slot ${slotNumber}, ${slot.byteLength} bytes.`, {
      slot: slotNumber,
      byteLength: slot.byteLength
    });
    return { ok: true, actionId: action.id };
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
    const text = clipboard.readText();
    if (!text.trim()) {
      logActionEvent(action, "skipped", source, "Clipboard-to-Drop skipped because clipboard text was empty.", { byteLength: 0 });
      return { ok: false, actionId: action.id, error: "Clipboard text is empty." };
    }

    const item = createDropTextItem(text, "clipboard", "outgoing");
    saveDropShelf([item, ...loadDropShelf()]);
    logActionEvent(action, "success", source, `Sent clipboard text to outgoing Drop, ${item.byteLength} bytes.`, {
      dropId: item.id,
      byteLength: item.byteLength,
      expiresAt: item.expiresAt
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
      --font-ui: Inter, system-ui, sans-serif;
      --font-tech: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
      --radius: 8px;
      --gap: 12px;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: var(--font-ui); background: var(--bg); color: var(--text); }
    main { display: grid; gap: var(--gap); max-width: 760px; margin: 0 auto; padding: max(16px, env(safe-area-inset-top)) 16px max(96px, env(safe-area-inset-bottom)); }
    header, section { display: grid; gap: var(--gap); padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    header { border-color: var(--accent); }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 1.8rem; }
    h2 { font-size: 1.1rem; }
    p { line-height: 1.45; }
    button, input, textarea, a { width: 100%; min-height: 46px; padding: 12px; font: inherit; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); background: var(--surface-2); }
    button, a { text-align: center; text-decoration: none; }
    button:active, a:active { background: var(--surface-hover); }
    button.primary, a.primary { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
    textarea { min-height: 120px; resize: vertical; text-align: left; }
    label { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; color: var(--text-muted); }
    label input { width: auto; min-height: auto; }
    .item { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .item button, .item a { border-color: var(--accent); }
    .mono { font-family: var(--font-tech); overflow-wrap: anywhere; }
    .notice, .meta, .file-count { color: var(--text-muted); }
    .meta, .file-count { font-family: var(--font-tech); font-size: 0.84rem; }
    .empty { padding: 12px; color: var(--text-muted); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .toast-stack { position: fixed; left: 14px; right: 14px; bottom: max(14px, env(safe-area-inset-bottom)); display: grid; gap: 8px; z-index: 10; }
    .toast { padding: 12px; border: 1px solid var(--success); border-radius: var(--radius); background: var(--surface-2); color: var(--text); }
    .toast[data-tone="error"] { border-color: var(--error); }
    @media (display-mode: standalone) {
      header { position: sticky; top: 0; z-index: 2; }
      body { overscroll-behavior-y: contain; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>DexNest Drop</h1>
    </header>
    <section>
      <h2>From PC: text</h2>
      <div id="texts"></div>
    </section>
    <section>
      <h2>From PC: files</h2>
      <div id="files"></div>
    </section>
    <section>
      <h2>Send to PC: text</h2>
      <textarea id="note" placeholder="Write a note to save on the PC"></textarea>
      <p id="textStatus" class="notice"></p>
    </section>
    <section>
      <h2>Send to PC: files</h2>
      <p class="notice">Photos/gallery</p>
      <input id="uploadGallery" type="file" accept="image/*" multiple />
      <p id="gallerySelectedCount" class="file-count">No photos selected</p>
      <p class="notice">Files/docs</p>
      <input id="uploadFiles" type="file" multiple />
      <p id="selectedCount" class="file-count">No files selected</p>
      <p id="fileStatus" class="notice"></p>
      <p>PC receive folder:</p>
      <p id="receivePath" class="mono"></p>
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
  const input = typeof payload === "object" && payload !== null ? (payload as FinderItemInput & { statusFilter?: string; newLocation?: string }) : {};

  try {
    if (action.id === "finder.open") {
      logFinderEvent(action.id, "success", source, "Opened DexNest Finder.", {}, startedAt);
      return { ok: true, actionId: action.id, finderState: finderState() };
    }

    if (action.id === "finder.create_item" || action.id === "finder.update_item") {
      const items = loadFinderItems();
      const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
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
        tags: [...transaction.tags, "finance", "receipt"],
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
      const routines = loadRoutines();
      const routine = routines.find((item) => item.id === routineId);
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
      const records = saveSearchIndex(buildSearchIndexRecords());
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
          requestedFieldTypes: requestedSmartFields(String(input.question ?? input.query ?? "")),
          resultFieldTypes: fieldTypes,
          resultCount: smartResults.length,
          sourceModules: [...new Set(smartResults.map((result) => result.sourceModule))]
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
      error: `${action.title} requires confirmation.`
    };
  }

  const projectMatch = actionId.match(/^dev\.project\.([a-z0-9-]+)\.(.+)$/);
  if (projectMatch) {
    return runProjectAction(actionId, projectMatch[1], projectMatch[2], source, payload);
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

  if (action.module === "capture") {
    const result = runCaptureAction(action, source, payload);
    if (result) {
      return result;
    }
  }

  if (action.module === "voice") {
    localDb.appendActionEvent({
      module: "DexNest Voice",
      actionId,
      eventType: "voice_dictation_started",
      status: "success",
      source,
      summary: "Started DexNest click-to-speak dictation placeholder.",
      metadataJson: payloadMetadata(payload),
      durationMs: Date.now() - startedAt
    });
    return { ok: true, actionId, message: "Voice dictation placeholder started." };
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

    const match = request.url?.match(/^\/actions\/([^/?#]+)$/);

    if (request.method !== "POST" || !match) {
      sendJson(response, 404, { ok: false, error: "DexNest action endpoint not found." });
      return;
    }

    const actionId = decodeURIComponent(match[1]);
    const action = findAction(actionId);

    if (!action) {
      const result = await runRegisteredAction(actionId, "deck");
      sendJson(response, 404, result);
      return;
    }

    try {
      const payload = await readBody(request);
      const result = await runRegisteredAction(actionId, "deck", payload);
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

function registerIpcHandlers(): void {
  ipcMain.handle("dexnest:get-app-info", () => {
    const commandSettings = loadCommandSettings();
    return {
    appName: "DexNest",
    dataRoot: localDataRoot,
    dbPath: localDb.dbPath,
    actionEndpoint: `http://127.0.0.1:${actionPort}`,
    projectsConfigPath,
    commandSettingsPath,
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
    performanceMode: commandSettings.performanceModePlaceholder ? "Enabled placeholder" : "Not enabled"
    };
  });

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

  ipcMain.handle("dexnest:select-backup-zip", () => selectBackupZip());

  ipcMain.handle("dexnest:get-app-health", () => appHealthState("module_ui", true));

  ipcMain.handle("dexnest:get-command-stats", () => commandStats());

  ipcMain.handle("dexnest:select-tools-files", (_event, kind: "pdf" | "image" | "any") => selectToolsFiles(kind));

  ipcMain.handle("dexnest:select-vault-files", () => selectVaultFiles());

  ipcMain.handle("dexnest:select-finance-receipt", () => selectFinanceReceipt());

  ipcMain.handle("dexnest:select-capture-file", () => selectCaptureFile());

  ipcMain.handle("dexnest:get-pdf-info", (_event, paths: string[]) => getPdfInfo(paths));

  ipcMain.handle("dexnest:choose-tools-output-folder", () => chooseToolsOutputFolder());

  ipcMain.handle("dexnest:reset-tools-output-folder", () => resetToolsOutputFolder());

  ipcMain.handle("dexnest:save-tools-settings", (_event, input: Partial<ToolsSettings>) => updateToolsSettings(input));

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "DexNest",
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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  localDb.initialize();
  ensureDropRoot();
  ensureToolsRoot();
  ensureVaultRoot();
  ensureFinanceRoot();
  ensureCaptureRoot();
  ensureSearchRoot();
  ensureBackupRoot();
  registerIpcHandlers();
  cleanupClipboardHistory(false, "system");
  startActionEndpoint();
  refreshNudges("system", false);
  startHeatmapTimer();
  startClipboardListener();
  registerClipboardHotkey();
  scheduleActiveMultiCopyAutoClear();
  createWindow();
  registerCommandShortcut();
  createDexNestTray();

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
  stopHeatmapTimer();
  stopClipboardListener();
  unregisterClipboardHotkey();
  unregisterCommandShortcut();
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
