// ObjectOS view model: pure functions the view renders from, tested on their own.
//
// Only type imports from @dexnest/object-os: the renderer must not bundle the
// store or the engine. The lists and formatters below mirror the package's,
// and a test keeps them equal.

import type {
  AttentionItem,
  AttentionView,
  Category,
  DueStatus,
  FileRole,
  IntervalUnit,
  Modification,
  ObjectDetail,
  ObjectOsStatus,
  ObjectRecord,
  ObjectStatus,
  Money,
  SettingsSnapshot,
  TimelineItem,
  TimelineKind
} from "@dexnest/object-os";

// --- lists and labels ---------------------------------------------------------

export const CATEGORY_LIST: readonly Category[] = ["printer", "computer", "appliance", "tool", "vehicle", "other"];
export const CATEGORY_LABELS: Record<Category, string> = {
  printer: "Printer",
  computer: "Computer",
  appliance: "Appliance",
  tool: "Tool",
  vehicle: "Vehicle",
  other: "Other"
};

export const STATUS_LIST: readonly ObjectStatus[] = ["active", "stored", "broken", "lent_out", "sold", "disposed"];
export const STATUS_LABELS: Record<ObjectStatus, string> = {
  active: "Active",
  stored: "Stored",
  broken: "Broken",
  lent_out: "Lent out",
  sold: "Sold",
  disposed: "Disposed"
};

export const ROLE_LIST: readonly FileRole[] = ["manual", "photo", "receipt", "model", "config", "other"];
export const ROLE_LABELS: Record<FileRole, string> = {
  manual: "Manual",
  photo: "Photo",
  receipt: "Receipt",
  model: "3D model",
  config: "Config",
  other: "Other"
};

export const UNIT_LIST: readonly IntervalUnit[] = ["days", "weeks", "months", "years"];

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  created: "Added",
  change: "Changed",
  state: "State",
  schedule: "Schedule",
  maintenance: "Maintenance",
  modification: "Modification",
  settings: "Settings",
  measurement: "Measurement",
  file: "File",
  purchase: "Purchase"
};

export const TABS = ["overview", "maintenance", "parts", "modifications", "settings", "measurements", "files", "purchase", "history"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  maintenance: "Maintenance",
  parts: "Parts",
  modifications: "Modifications",
  settings: "Settings",
  measurements: "Measurements",
  files: "Files",
  purchase: "Purchase",
  history: "History"
};

/** Roving focus across the tabs: arrows wrap, Home and End jump. */
export function nextTab(current: Tab, key: string): Tab | null {
  const i = TABS.indexOf(current);
  if (key === "ArrowRight") return TABS[(i + 1) % TABS.length] as Tab;
  if (key === "ArrowLeft") return TABS[(i - 1 + TABS.length) % TABS.length] as Tab;
  if (key === "Home") return TABS[0] as Tab;
  if (key === "End") return TABS[TABS.length - 1] as Tab;
  return null;
}

/** The most objects one list read returns (the store's default page). */
export const LIST_LIMIT = 500;

// --- view state -----------------------------------------------------------------

export type ViewState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "empty" } | { kind: "ready" };

export function viewState(input: { loading: boolean; error: string | null; status: ObjectOsStatus | null }): ViewState {
  if (input.error) return { kind: "error", message: input.error };
  if (input.loading || !input.status) return { kind: "loading" };
  return input.status.objects === 0 ? { kind: "empty" } : { kind: "ready" };
}

/** What an action returned, for the notice line. */
export function actionMessage(result: unknown): { ok: boolean; text: string | null } {
  if (typeof result !== "object" || result === null) return { ok: false, text: "ObjectOS did not answer." };
  const r = result as { ok?: unknown; message?: unknown; error?: unknown; cancelled?: unknown };
  if (r.cancelled === true) return { ok: true, text: null };
  if (r.ok === true) return { ok: true, text: typeof r.message === "string" ? r.message : null };
  return { ok: false, text: typeof r.error === "string" ? r.error : "ObjectOS did not make the change." };
}

// --- formatting --------------------------------------------------------------------

/** 7K3F9QXM -> 7K3F-9QXM, as on a label. */
export function formatObjectId(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4)}`;
}

// Mirrors the package's money.ts (a test compares them).
const ZERO_DECIMALS = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "XOF", "XAF", "UGX", "PYG"]);
const THREE_DECIMALS = new Set(["BHD", "KWD", "OMR", "JOD", "TND", "LYD", "IQD"]);
export const decimalsOf = (currency: string) => (ZERO_DECIMALS.has(currency) ? 0 : THREE_DECIMALS.has(currency) ? 3 : 2);

export function formatMoney(m: Money): string {
  const decimals = decimalsOf(m.currency);
  if (decimals === 0) return `${m.amount} ${m.currency}`;
  const s = String(m.amount).padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)} ${m.currency}`;
}

/** The amount as typed in a form (minor units back to "12.50"). */
export function moneyAmountText(m: Money | null): string {
  if (!m) return "";
  return formatMoney(m).split(" ")[0] ?? "";
}

export const shortDate = (iso: string) => iso.slice(0, 10);
export const shortDateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const trimNumber = (n: number) => String(Math.round(n * 1000) / 1000);

export function ruleLabel(rule: ObjectDetail["schedules"][number]["schedule"]["rule"]): string {
  if (rule.kind === "time") return `every ${rule.every} ${rule.every === 1 ? rule.unit.replace(/s$/, "") : rule.unit}`;
  return `every ${trimNumber(rule.every)} ${rule.measurementKey}`;
}

/** "Overdue by 3 days", "Due in 10 days", "OK - next in 40 print hours". */
export function dueLabel(status: DueStatus): string {
  if (status.state === "inactive") return "Paused";
  if (status.state === "no_reading") return `Waiting for a ${status.measurementKey} reading`;
  if (status.kind === "time") {
    const d = status.daysLeft;
    if (status.state === "overdue") return d === 0 ? "Due today" : `Overdue by ${plural(-d, "day")}`;
    if (status.state === "due_soon") return d === 0 ? "Due today" : `Due in ${plural(d, "day")}`;
    return `OK, next ${shortDate(status.dueAt)}`;
  }
  const left = trimNumber(Math.abs(status.left));
  if (status.state === "overdue") return `Overdue by ${left}`;
  if (status.state === "due_soon") return `Due in ${left}`;
  return `OK, next at ${trimNumber(status.dueAtReading)}`;
}

export const dueTone = (status: DueStatus): "bad" | "warn" | "ok" | "quiet" =>
  status.state === "overdue" ? "bad" : status.state === "due_soon" ? "warn" : status.state === "ok" ? "ok" : "quiet";

export function warrantyLabel(state: ObjectDetail["warranty"]): string {
  if (state.state === "none" || state.daysLeft === null) return "No warranty recorded";
  if (state.state === "expired") return `Warranty ended ${plural(-state.daysLeft, "day")} ago`;
  if (state.state === "ending") return state.daysLeft === 0 ? "Warranty ends today" : `Warranty ends in ${plural(state.daysLeft, "day")}`;
  return `Under warranty for ${plural(state.daysLeft, "more day")}`;
}

/** One "needs attention" line: names come from the view's own read, never from the event log. */
export function attentionLabel(item: AttentionItem, names: AttentionView["names"]): { objectId: string | null; title: string; detail: string; tone: "bad" | "warn" } {
  if (item.kind === "maintenance") {
    return { objectId: item.objectId, title: names[item.objectId] || formatObjectId(item.objectId), detail: `${names[item.scheduleId] || "Maintenance"}: ${dueLabel(item.status)}`, tone: item.status.state === "overdue" ? "bad" : "warn" };
  }
  if (item.kind === "warranty") {
    return { objectId: item.objectId, title: names[item.objectId] || formatObjectId(item.objectId), detail: warrantyLabel({ state: item.state, daysLeft: item.daysLeft }), tone: item.state === "expired" ? "bad" : "warn" };
  }
  return { objectId: null, title: names[item.partId] || "A part", detail: `Low stock: ${trimNumber(item.quantity)} left (restock at ${trimNumber(item.lowStockAt)})`, tone: item.quantity === 0 ? "bad" : "warn" };
}

export function attentionSummaryText(counts: AttentionView["summary"]["counts"]): string {
  const parts: string[] = [];
  if (counts.overdue) parts.push(`${counts.overdue} overdue`);
  if (counts.dueSoon) parts.push(`${counts.dueSoon} due soon`);
  if (counts.warrantyEnding) parts.push(`${counts.warrantyEnding} ${counts.warrantyEnding === 1 ? "warranty" : "warranties"} ending`);
  if (counts.lowStock) parts.push(`${counts.lowStock} low on stock`);
  return parts.length ? parts.join(", ") : "Nothing needs attention.";
}

export function timelineLabel(item: TimelineItem): string {
  return item.detail ? `${item.title}: ${item.detail}` : item.title;
}

export function modificationLabel(m: Modification): string {
  if (m.revertedAt) return `Reverted ${shortDate(m.revertedAt)}`;
  return m.reversible ? "Reversible" : "Permanent";
}

/** Snapshots grouped by name, newest version first. */
export function settingsGroups(snapshots: readonly SettingsSnapshot[]): { name: string; versions: SettingsSnapshot[] }[] {
  const groups = new Map<string, SettingsSnapshot[]>();
  for (const s of snapshots) groups.set(s.name, [...(groups.get(s.name) ?? []), s]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, versions]) => ({ name, versions: [...versions].sort((a, b) => b.version - a.version) }));
}

/** Readings grouped by key, newest first. */
export function measurementGroups(detail: Pick<ObjectDetail, "measurements">): { key: string; unit: string; readings: ObjectDetail["measurements"] }[] {
  const groups = new Map<string, ObjectDetail["measurements"]>();
  for (const m of detail.measurements) groups.set(m.key, [...(groups.get(m.key) ?? []), m]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, readings]) => {
      const sorted = [...readings].sort((a, b) => (a.measuredAt === b.measuredAt ? b.id.localeCompare(a.id) : b.measuredAt.localeCompare(a.measuredAt)));
      return { key, unit: sorted[0]?.unit ?? "", readings: sorted };
    });
}

// --- dates from forms ---------------------------------------------------------------

/** Today's local date as YYYY-MM-DD. */
export function localToday(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * A date picked in a form, as the timestamp ObjectOS stores. Today (or a
 * later day) is "now", so it is never in the future; an earlier day is noon
 * UTC, so it reads as that day everywhere. Empty stays empty (ObjectOS then
 * uses now).
 */
export function dateToStamp(date: string, now: Date): string | undefined {
  const d = date.trim();
  if (!d) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return d >= localToday(now) ? now.toISOString() : `${d}T12:00:00.000Z`;
}

// --- forms ------------------------------------------------------------------------------

export interface ObjectForm {
  id: string | null;
  name: string;
  category: Category;
  make: string;
  model: string;
  serial: string;
  location: string;
  status: ObjectStatus;
  parentId: string;
  tags: string;
  notes: string;
}

export const EMPTY_OBJECT_FORM: ObjectForm = { id: null, name: "", category: "other", make: "", model: "", serial: "", location: "", status: "active", parentId: "", tags: "", notes: "" };

export function objectFromForm(f: ObjectForm): Record<string, unknown> {
  return {
    ...(f.id ? { id: f.id } : {}),
    name: f.name,
    category: f.category,
    make: f.make,
    model: f.model,
    serial: f.serial,
    location: f.location,
    status: f.status,
    parentId: f.parentId.trim() ? f.parentId.trim() : null,
    tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
    notes: f.notes
  };
}

export function formFromObject(o: ObjectRecord): ObjectForm {
  return { id: o.id, name: o.name, category: o.category, make: o.make, model: o.model, serial: o.serial, location: o.location, status: o.status, parentId: o.parentId ?? "", tags: o.tags.join(", "), notes: o.notes };
}

/** "key = value" per line, for a settings snapshot. Later lines win; blank lines and lines without "=" are reported. */
export function parseSettingsText(text: string): { values: Record<string, string>; problems: number[] } {
  const values: Record<string, string> = {};
  const problems: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const at = line.indexOf("=");
    if (at <= 0) {
      problems.push(i + 1);
      return;
    }
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  });
  return { values, problems };
}

export function settingsText(values: Record<string, string>): string {
  return Object.keys(values).sort().map((k) => `${k} = ${values[k]}`).join("\n");
}

/** Detail rows the overview shows, in order, skipping empty ones. */
export function overviewRows(o: ObjectRecord): { label: string; value: string; technical: boolean }[] {
  const rows: { label: string; value: string; technical: boolean }[] = [
    { label: "Category", value: CATEGORY_LABELS[o.category], technical: false },
    { label: "Status", value: STATUS_LABELS[o.status], technical: false },
    { label: "Make", value: o.make, technical: false },
    { label: "Model", value: o.model, technical: false },
    { label: "Serial", value: o.serial, technical: true },
    { label: "Location", value: o.location, technical: false }
  ];
  return rows.filter((r) => r.value);
}
