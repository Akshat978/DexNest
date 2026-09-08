export type DexNestModuleId =
  | "command"
  | "dev"
  | "deck"
  | "clipboard"
  | "drop"
  | "tools"
  | "vault"
  | "search"
  | "capture"
  | "journal"
  | "calendar"
  | "timetable"
  | "utilities"
  | "weather"
  | "news"
  | "finder"
  | "finance"
  | "heatmap"
  | "backup"
  | "external_devices"
  | "system"
  | "voice"
  | "assistant"
  | "autopilot";

export type DexNestActionStatus = "available" | "placeholder";
export type DexNestActionDangerLevel = "safe" | "caution" | "danger" | "critical";
export type DexNestActionHandlerType =
  | "internal_function"
  | "local_command"
  | "http_endpoint"
  | "file_operation"
  | "routine";
export type DexNestActionTrigger =
  | "command"
  | "deck"
  | "stream_deck_http"
  | "keyboard_shortcut"
  | "tray"
  | "assistant"
  | "ambient_voice"
  | "ambient_wake_word"
  | "push_to_talk"
  | "voice"
  | "routine"
  | "module_ui"
  | "phone";
export type DexNestEventStatus = "success" | "failed" | "skipped" | "cancelled" | "pending";
export type DexNestEventSource = DexNestActionTrigger | "system" | "phone_pwa";

// Shared pin (favorite) across DexNest modules. Stored in
// local-data/settings/pins.json. Metadata only — never store sensitive values
// (no Secure Vault secrets, no clipboard/journal/receipt body content).
export type DexNestPinType =
  | "action"
  | "module"
  | "document"
  | "item"
  | "routine"
  | "project"
  | "event"
  | "result";

export interface DexNestPin {
  id: string;
  type: DexNestPinType;
  module: string;
  entityId: string;
  title: string;
  subtitle?: string;
  actionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DexNestActionDefinition {
  id: string;
  title: string;
  moduleId: DexNestModuleId;
  module: DexNestModuleId;
  description: string;
  category: string;
  paramsSchema?: Record<string, unknown>;
  defaultParams?: Record<string, unknown>;
  dangerLevel: DexNestActionDangerLevel;
  requiresConfirmation: boolean;
  confirmationRule?: string | null;
  reversible: boolean;
  undoActionId?: string | null;
  handlerType: DexNestActionHandlerType;
  handlerRef: string;
  allowedTriggers: DexNestActionTrigger[];
  enabled: boolean;
  status: DexNestActionStatus;
  /**
   * Whether a paired phone may run this, and what it must hold to do so.
   *
   * ABSENT MEANS UNREACHABLE. Not hidden, not filtered from a list — refused.
   * This is an allowlist because the alternatives have all been tried and all
   * fail the same way: `dangerLevel: "safe"` includes `vault.secure.copy_username`
   * and `finance.open`, so risk level does not describe phone-appropriateness,
   * and a denylist means every action added in future is exposed by default by
   * whoever forgot this file existed.
   *
   * "read" means it returns something and changes nothing the operator would
   * mind. "control" means it acts, and the device needs that capability
   * granted separately at the desktop.
   */
  phone?: DexNestPhoneExposure;
}

/** What a paired phone must hold to reach an action. */
export type DexNestPhoneExposure = "read" | "control";

export interface DexNestActionInvocation {
  actionId: string;
  payload: unknown;
  requestedAt: string;
}

export interface DexNestModuleCard {
  id: DexNestModuleId;
  title: string;
  description: string;
  status: DexNestActionStatus;
}

export interface DexNestEventLogEntry {
  id: string;
  type: string;
  source: string;
  payload: unknown;
  createdAt: string;
  timestamp: string;
  module: string;
  actionId?: string;
  eventType: string;
  status: DexNestEventStatus;
  summary: string;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function toLocalDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function getLocalTodayDateString(): string {
  return toLocalDateInputValue(new Date());
}

export function parseLocalDateInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return new Date(value);
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dateFromLocalInputOrTimestamp(dateOrString: Date | string): Date {
  if (dateOrString instanceof Date) {
    return dateOrString;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(dateOrString)
    ? parseLocalDateInput(dateOrString)
    : new Date(dateOrString);
}

export function formatLocalDate(dateOrString: Date | string): string {
  return dateFromLocalInputOrTimestamp(dateOrString).toLocaleDateString();
}

export function formatLocalDateTime(dateOrString: Date | string): string {
  return dateFromLocalInputOrTimestamp(dateOrString).toLocaleString();
}

function addLocalDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export function resolveRelativeLocalDate(phrase: string, baseDate: Date = new Date()): string | null {
  const normalized = phrase.toLowerCase();
  const localBaseDate = parseLocalDateInput(toLocalDateInputValue(baseDate));

  if (/\btoday\b/.test(normalized)) {
    return toLocalDateInputValue(localBaseDate);
  }

  if (/\btomorrow\b/.test(normalized)) {
    return toLocalDateInputValue(addLocalDays(localBaseDate, 1));
  }

  const inDaysMatch = normalized.match(/\bin\s+(\d{1,3})\s+days?\b/);
  if (inDaysMatch) {
    return toLocalDateInputValue(addLocalDays(localBaseDate, Number(inDaysMatch[1])));
  }

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekdayMatch = normalized.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const targetDay = weekdays.indexOf(weekdayMatch[1]);
    const currentDay = localBaseDate.getDay();
    const daysUntil = ((targetDay - currentDay + 7) % 7) || 7;
    return toLocalDateInputValue(addLocalDays(localBaseDate, daysUntil));
  }

  const monthMatch = normalized.match(/\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/);
  if (monthMatch) {
    const monthIndex = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december"
    ].indexOf(monthMatch[1]);
    const candidate = new Date(localBaseDate.getFullYear(), monthIndex, Number(monthMatch[2]), 12, 0, 0, 0);
    if (candidate < localBaseDate) {
      candidate.setFullYear(candidate.getFullYear() + 1);
    }
    return toLocalDateInputValue(candidate);
  }

  return null;
}

// --- provider plan limits (Claude / Codex), read from local logs ---------------

export type ProviderLimitsProviderId = "claude" | "codex";
export type ProviderLimitConfidence = "calibrated" | "rolled" | "uncalibrated" | "none";

export interface ProviderLimitBucket {
  id: string;
  label: string;
  /** The provider's own figure, as last read by its official client. */
  measuredPercent: number;
  /** Spend since that reading, as a share of the solved budget. */
  deltaPercent: number;
  /** What the bar shows: measured + delta, clamped. */
  estimatedPercent: number;
  confidence: ProviderLimitConfidence;
  anchorFetchedAt: string;
  anchorAgeMs: number;
  anchorStale: boolean;
  idle: boolean;
  /** False once the anchor is too old for its delta to be sound; the estimate
   *  then equals the measured figure. */
  deltaTrusted: boolean;
  /** Turns this machine logged since the anchor — shown when the delta is not. */
  turnsSinceAnchor: number;
  resetsAt: string;
  resetsInMs: number;
  windowMinutes: number;
  severity: string | null;
  budget: number | null;
}

export interface ProviderLimitsProvider {
  provider: ProviderLimitsProviderId;
  plan: string | null;
  notices: string[];
  anchorFetchedAt: string | null;
  lastSampleAt: string | null;
  sampleCount: number;
  buckets: ProviderLimitBucket[];
  error: string | null;
}

export interface ProviderLimitsSnapshot {
  generatedAt: string;
  providers: ProviderLimitsProvider[];
}
