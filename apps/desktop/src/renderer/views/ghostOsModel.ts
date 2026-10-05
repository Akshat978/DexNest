// GhostOS view model: pure functions the view renders from, tested on their own.
//
// Only type imports from @dexnest/ghost-os: the renderer must not bundle the
// store or the engine. The lists below mirror the package's and a test keeps
// them equal.

import type { EntityDetail, EntityType, Evidence, GhostOsStatus, Provenance, SearchHit, TimelineItem } from "@dexnest/ghost-os";
import { dayKey, dayLabel, momentLabel } from "../lib/dates.ts";

export const ENTITY_TYPE_LIST: readonly EntityType[] = [
  "person", "project", "skill", "knowledge", "memory", "event", "habit", "decision", "file", "conversation", "place"
];

export const RELATION_TYPE_LIST = ["worked_on", "uses", "about", "involves", "at", "part_of", "related_to", "learned_from", "led_to"] as const;

/** "related_to" as people read it: "related to". */
export const relationTypeText = (type: string): string => type.replace(/_/g, " ");

/** What the owner typed ("Related to", "learned-from") as the stored type ("related_to"). */
export function relationTypeFromText(text: string): string {
  return text.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export const TYPE_LABELS: Record<EntityType, string> = {
  person: "Person",
  project: "Project",
  skill: "Skill",
  knowledge: "Knowledge",
  memory: "Memory",
  event: "Event",
  habit: "Habit",
  decision: "Decision",
  file: "File",
  conversation: "Conversation",
  place: "Place"
};

export const TABS = ["timeline", "add", "sources"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABELS: Record<Tab, string> = { timeline: "Timeline", add: "Add", sources: "Sources" };

/** Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern). */
export function nextTab(current: Tab, key: string): Tab | null {
  const i = TABS.indexOf(current);
  if (key === "ArrowRight") return TABS[(i + 1) % TABS.length] ?? null;
  if (key === "ArrowLeft") return TABS[(i - 1 + TABS.length) % TABS.length] ?? null;
  if (key === "Home") return TABS[0] ?? null;
  if (key === "End") return TABS[TABS.length - 1] ?? null;
  return null;
}

export type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready" };

export function viewState(input: { loading: boolean; error: string | null; status: GhostOsStatus | null }): ViewState {
  if (input.error) return { kind: "error", message: input.error };
  if (input.loading || !input.status) return { kind: "loading" };
  const c = input.status.counts;
  return c.entity + c.relation + c.observation === 0 ? { kind: "empty" } : { kind: "ready" };
}

const SOURCE_NAMES: Record<string, string> = {
  "adapter:developer_intelligence": "your repositories",
  "detector:time_of_day": "your commit times",
  "detector:weekly_rhythm": "your commit days"
};

export function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * How sure, in a word. A fact read straight from a repository is certain and
 * says nothing; anything less says how much less, and why when there is one
 * reason (a day's commits in a repository may include other people's).
 */
export function sureness(confidence: number): string | null {
  if (confidence >= 0.99) return null;
  const word = confidence >= 0.8 ? "very likely" : confidence >= 0.5 ? "likely" : "a guess";
  return `${word} (${percent(confidence)} sure)`;
}

/** Why a fact is less than certain, when the evidence says. */
export function surenessReason(p: Pick<Provenance, "origin" | "confidence" | "evidence">): string | null {
  if (p.confidence >= 0.99) return null;
  if (p.origin === "adapter" && p.evidence.some((e) => e.kind === "commit")) return "Commits in a repository are counted whoever wrote them, so some may not be yours.";
  if (p.origin === "derived") return "Worked out from a pattern in your commits; more weeks of the same pattern make it surer.";
  return null;
}

/** Where a fact came from and how sure GhostOS is - shown with every fact. */
export function sourceLabel(p: Pick<Provenance, "origin" | "sourceId" | "confidence">): string {
  if (p.origin === "manual") return p.confidence < 1 ? `Entered by you · you said ${percent(p.confidence)} sure` : "Entered by you";
  const name = (p.sourceId && SOURCE_NAMES[p.sourceId]) ?? "another source";
  const sure = sureness(p.confidence);
  return `${p.origin === "derived" ? "Worked out from" : "From"} ${name}${sure ? ` · ${sure}` : ""}`;
}

/** A timeline row's short provenance: the detail view shows the full source and evidence. */
export function originLabel(origin: Provenance["origin"], confidence: number): string {
  if (origin === "manual") return "entered by you";
  const sure = sureness(confidence);
  return `${origin === "derived" ? "worked out from your commits" : "from your repositories"}${sure ? `, ${sure}` : ""}`;
}

/**
 * One piece of evidence in plain words, with the project's name where the
 * record only holds its id. `names` is the detail's repositoryNames.
 */
export function evidenceLabel(e: Evidence, names: Record<string, string> = {}, subject: "project" | "other" = "other"): string {
  const project = (repositoryId: string) => names[repositoryId] ?? "a repository GhostOS no longer holds";
  switch (e.kind) {
    case "manual":
      return "Entered by you";
    case "repository":
      return subject === "project" ? "A repository found by the repository scan" : `Used in ${project(e.repositoryId)}`;
    case "technology": {
      const file = e.evidencePath.split("/").pop() || e.evidencePath;
      if (e.evidenceKind === "file-extension") return `${project(e.repositoryId)} has files in this language (such as ${e.evidencePath})`;
      if (/#packageManager$/.test(e.evidenceKind)) return `Listed as the package manager in ${project(e.repositoryId)}'s ${file}`;
      if (/#(dev|peer|optional)?[dD]ependencies$/.test(e.evidenceKind)) return `Listed as a dependency in ${project(e.repositoryId)}'s ${file}`;
      return `Named in ${project(e.repositoryId)}'s ${file}`;
    }
    case "commit":
      return `Commit ${e.sha.slice(0, 7)} in ${project(e.repositoryId)}, ${shortDateTime(e.at)}`;
    case "observation":
      return "A day of commits it was worked out from";
  }
}

/** A connection as read from the entry that is open: "Uses TypeScript", and from the other side "Used by DeskNest". */
const INCOMING: Record<string, string> = {
  uses: "Used by",
  worked_on: "Worked on by",
  about: "The subject of",
  involves: "Involved in",
  at: "The place of",
  part_of: "Includes",
  related_to: "Related to",
  learned_from: "Taught",
  led_to: "Came from"
};

export function connectionPhrase(type: string, direction: "out" | "in"): string {
  const words = relationTypeText(type);
  if (direction === "out") return words.charAt(0).toUpperCase() + words.slice(1);
  return INCOMING[type] ?? `On the other end of “${words}” from`;
}

/** "from 3 Oct 2026 · ongoing", "3 Oct 2025 – 1 Mar 2026", or nothing when undated. */
export function spanLabel(from: string | null, to: string | null): string | null {
  if (from && to) return `${shortDate(from)} – ${shortDate(to)}`;
  if (from) return `since ${shortDate(from)} · ongoing`;
  if (to) return `until ${shortDate(to)}`;
  return null;
}

/** A date as every screen writes it: "3 Oct 2026". */
export function shortDate(iso: string): string {
  return dayLabel(iso);
}

/** For commits and syncs, which are always moments. */
export function shortDateTime(iso: string): string {
  return momentLabel(iso);
}

export function timelineLabel(item: TimelineItem): string {
  if (item.kind === "observation") return `${item.title}: ${item.statement ?? ""}`;
  if (item.kind === "relation") return `${item.title} stopped: ${item.statement ?? ""}`;
  return item.title;
}

/** What kind of row a timeline item is. */
export function timelineKind(item: TimelineItem): string {
  if (item.kind === "observation") return "Observation";
  if (item.kind === "relation") return "Connection ended";
  return TYPE_LABELS[item.entityType];
}

// --- forms ----------------------------------------------------------------------

export interface EntityForm {
  id: string | null;
  type: EntityType;
  title: string;
  notes: string;
  tags: string;
  /** Point-in-time (memory, event, decision) or start date, as YYYY-MM-DD or a datetime-local value. */
  when: string;
  endedAt: string;
  /** Still going: no end date is saved, whatever the field holds. */
  ongoing: boolean;
  text: string;
  choice: string;
  alternatives: string;
  rationale: string;
  cadence: "daily" | "weekly" | "monthly" | "irregular";
  path: string;
  label: string;
  participants: string;
}

export const EMPTY_ENTITY_FORM: EntityForm = {
  id: null, type: "person", title: "", notes: "", tags: "", when: "", endedAt: "", ongoing: true, text: "", choice: "", alternatives: "",
  rationale: "", cadence: "weekly", path: "", label: "", participants: ""
};

/** A date or datetime-local value as ISO; empty stays empty (the module then uses now or refuses). */
export function toIso(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : v;
}

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);
const commaList = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

/** The ghost_os.entity.save input. Validation is the module's; this only shapes. */
export function entityFromForm(f: EntityForm): Record<string, unknown> {
  const base: Record<string, unknown> = { type: f.type, title: f.title, notes: f.notes, tags: commaList(f.tags) };
  if (f.id) base.id = f.id;
  switch (f.type) {
    case "memory":
      return { ...base, details: { text: f.text, occurredAt: toIso(f.when) } };
    case "event":
      return { ...base, details: { occurredAt: toIso(f.when), endedAt: f.ongoing ? undefined : toIso(f.endedAt) } };
    case "decision":
      return { ...base, details: { decidedAt: toIso(f.when), choice: f.choice, alternatives: lines(f.alternatives), rationale: f.rationale } };
    case "habit":
      return { ...base, details: { cadence: f.cadence } };
    case "file":
      return { ...base, details: { path: f.path, label: f.label } };
    case "conversation":
      return { ...base, details: { text: f.text, participants: commaList(f.participants) } };
    default:
      return { ...base, startedAt: toIso(f.when), endedAt: f.ongoing ? undefined : toIso(f.endedAt) };
  }
}

/** The ghost_os.relation.save dates: a start, and an end unless it is still going. */
export function relationDates(from: string, until: string, ongoing: boolean): { validFrom?: string; validTo?: string } {
  const validFrom = toIso(from);
  const validTo = ongoing ? undefined : toIso(until);
  return { ...(validFrom ? { validFrom } : {}), ...(validTo ? { validTo } : {}) };
}

/** The form to edit an entry the owner made. */
export function formFromDetail(detail: EntityDetail): EntityForm {
  const e = detail.entity;
  const d = e.details as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    ...EMPTY_ENTITY_FORM,
    id: e.id,
    type: e.type,
    title: e.title,
    notes: e.notes,
    tags: e.tags.join(", "),
    // The day it was where you are, so saving an entry unchanged does not move it.
    when: dayKey(str(d.occurredAt ?? d.decidedAt ?? e.startedAt)) ?? "",
    endedAt: dayKey(str(d.endedAt ?? e.endedAt)) ?? "",
    ongoing: !str(d.endedAt ?? e.endedAt),
    text: str(d.text),
    choice: str(d.choice),
    alternatives: Array.isArray(d.alternatives) ? d.alternatives.join("\n") : "",
    rationale: str(d.rationale),
    cadence: (["daily", "weekly", "monthly", "irregular"].includes(str(d.cadence)) ? d.cadence : "weekly") as EntityForm["cadence"],
    path: str(d.path),
    label: str(d.label),
    participants: Array.isArray(d.participants) ? d.participants.join(", ") : ""
  };
}

/** What the form shows for a type: the fields it has. */
export function fieldsFor(type: EntityType): readonly ("when" | "endedAt" | "text" | "choice" | "alternatives" | "rationale" | "cadence" | "path" | "label" | "participants")[] {
  switch (type) {
    case "memory": return ["when", "text"];
    case "event": return ["when", "endedAt"];
    case "decision": return ["when", "choice", "alternatives", "rationale"];
    case "habit": return ["cadence"];
    case "file": return ["path", "label"];
    case "conversation": return ["text", "participants"];
    default: return ["when", "endedAt"];
  }
}

export function whenLabel(type: EntityType): string {
  if (type === "memory" || type === "event") return "When";
  if (type === "decision") return "Decided on";
  return "Started";
}

/**
 * Params for an action the user has just confirmed in the view. Danger-level
 * and requires-confirmation actions (forget, turning a source off) are refused
 * by the main process without this flag; send it only after the confirm box.
 */
export function confirmed(params: Record<string, unknown>): Record<string, unknown> {
  return { ...params, confirmedDangerous: true };
}

/** The message an action returned, or its error. */
export function actionMessage(result: unknown): { ok: boolean; text: string | null } {
  if (typeof result !== "object" || result === null) return { ok: false, text: "No answer from DexNest." };
  const r = result as { ok?: unknown; message?: unknown; error?: unknown; cancelled?: unknown };
  if (r.cancelled === true) return { ok: true, text: null };
  if (r.ok === true) return { ok: true, text: typeof r.message === "string" ? r.message : null };
  return { ok: false, text: typeof r.error === "string" ? r.error : "That did not work." };
}

// --- connection picker ----------------------------------------------------------
// Choose a connection's target by searching all of GhostOS (the same search as
// the timeline), as a WAI-ARIA combobox: type, move with the arrow keys, Enter
// to choose, Escape to close.

export interface PickerOption {
  id: string;
  title: string;
  typeLabel: string;
}

export type PickerState =
  | { kind: "empty" }
  | { kind: "searching" }
  | { kind: "error"; message: string }
  | { kind: "no-results"; query: string }
  | { kind: "results"; options: PickerOption[] };

/** Most options shown at once; the search itself caps at 200. */
export const PICKER_LIMIT = 20;

export function pickerState(input: { query: string; results: SearchHit[] | null; searching: boolean; error: string | null; excludeId: string }): PickerState {
  if (!input.query.trim()) return { kind: "empty" };
  if (input.error) return { kind: "error", message: input.error };
  if (input.searching || input.results === null) return { kind: "searching" };
  // An entry is never connected to itself.
  const options = input.results
    .filter((hit) => hit.id !== input.excludeId)
    .slice(0, PICKER_LIMIT)
    .map((hit) => ({ id: hit.id, title: hit.title, typeLabel: TYPE_LABELS[hit.type] }));
  return options.length === 0 ? { kind: "no-results", query: input.query.trim() } : { kind: "results", options };
}

/** What the picker's live region says. */
export function pickerMessage(state: PickerState): string {
  switch (state.kind) {
    case "empty":
      return "Type to search your entries.";
    case "searching":
      return "Searching…";
    case "error":
      return `Search failed: ${state.message}`;
    case "no-results":
      return `Nothing matches “${state.query}”.`;
    case "results":
      return `${state.options.length} ${state.options.length === 1 ? "entry" : "entries"} found. Use the arrow keys to choose.`;
  }
}

export type PickerKeyResult = { active: number; action: "move" | "choose" | "close" } | null;

/**
 * The combobox keys. `active` is -1 when no option is highlighted. Returns
 * null for keys the picker does not handle (typing goes to the input).
 */
export function pickerKey(key: string, active: number, count: number): PickerKeyResult {
  if (key === "Escape") return { active: -1, action: "close" };
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return { active: active < 0 ? 0 : (active + 1) % count, action: "move" };
    case "ArrowUp":
      return { active: active <= 0 ? count - 1 : active - 1, action: "move" };
    case "Home":
      return { active: 0, action: "move" };
    case "End":
      return { active: count - 1, action: "move" };
    case "Enter":
      return active >= 0 && active < count ? { active, action: "choose" } : null;
    default:
      return null;
  }
}

export const pickerOptionId = (id: string) => `ghost-pick-${id}`;

// --- Presentation (docs/DESIGN_LANGUAGE.md, GhostOS) ---------------------------------

export interface TimelineGroup<T extends Pick<TimelineItem, "at">> {
  /** The day as a key, YYYY-MM-DD. `dayHeading` writes it for people. */
  day: string;
  items: T[];
}

/** Timeline rows under a heading per day, in the order they came (newest first). */
export function groupByDay<T extends Pick<TimelineItem, "at">>(items: readonly T[]): TimelineGroup<T>[] {
  const groups: TimelineGroup<T>[] = [];
  for (const item of items) {
    const day = dayKey(item.at) ?? item.at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/** "Today", "Yesterday", or the date in words. `day` and `today` are YYYY-MM-DD keys. */
export function dayHeading(day: string, today: string): string {
  if (day === today) return "Today";
  const yesterday = new Date(Date.parse(`${today}T12:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  return day === yesterday ? "Yesterday" : dayLabel(day);
}

/** How many sources are on, for the stat tile. */
export function sourcesOn(status: Pick<GhostOsStatus, "adapters">): { on: number; installed: number } {
  return { on: status.adapters.filter((a) => a.enabled).length, installed: status.adapters.filter((a) => a.installed).length };
}
