// GhostOS view model: pure functions the view renders from, tested on their own.
//
// Only type imports from @dexnest/ghost-os: the renderer must not bundle the
// store or the engine. The lists below mirror the package's and a test keeps
// them equal.

import type { EntityDetail, EntityType, Evidence, GhostOsStatus, Provenance, TimelineItem } from "@dexnest/ghost-os";

export const ENTITY_TYPE_LIST: readonly EntityType[] = [
  "person", "project", "skill", "knowledge", "memory", "event", "habit", "decision", "file", "conversation", "place"
];

export const RELATION_TYPE_LIST = ["worked_on", "uses", "about", "involves", "at", "part_of", "related_to", "learned_from", "led_to"] as const;

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
  "adapter:developer_intelligence": "Developer Intelligence",
  "detector:time_of_day": "GhostOS habit detection (time of day)",
  "detector:weekly_rhythm": "GhostOS habit detection (weekly rhythm)"
};

export function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** Where a fact came from and how sure GhostOS is - shown with every fact. */
export function sourceLabel(p: Pick<Provenance, "origin" | "sourceId" | "confidence">): string {
  if (p.origin === "manual") return p.confidence < 1 ? `Entered by you · you said ${percent(p.confidence)} sure` : "Entered by you";
  const name = (p.sourceId && SOURCE_NAMES[p.sourceId]) ?? p.sourceId ?? "an unknown source";
  return `${p.origin === "derived" ? "Derived by" : "From"} ${name} · ${percent(p.confidence)} sure`;
}

/** A timeline row's short provenance: the detail view shows the full source and evidence. */
export function originLabel(origin: Provenance["origin"], confidence: number): string {
  if (origin === "manual") return "entered by you";
  return `${origin === "derived" ? "derived" : "from a source"}, ${percent(confidence)} sure`;
}

export function evidenceLabel(e: Evidence): string {
  switch (e.kind) {
    case "manual":
      return "Entered by you";
    case "repository":
      return `Repository record ${e.repositoryId}`;
    case "technology":
      return `Technology fact in ${e.repositoryId}: ${e.evidencePath} (${e.evidenceKind})`;
    case "commit":
      return `Commit ${e.sha.slice(0, 7)} in ${e.repositoryId} at ${shortDateTime(e.at)}`;
    case "observation":
      return `Observation ${e.observationId}`;
  }
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function shortDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
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
  id: null, type: "person", title: "", notes: "", tags: "", when: "", endedAt: "", text: "", choice: "", alternatives: "",
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
      return { ...base, details: { occurredAt: toIso(f.when), endedAt: toIso(f.endedAt) } };
    case "decision":
      return { ...base, details: { decidedAt: toIso(f.when), choice: f.choice, alternatives: lines(f.alternatives), rationale: f.rationale } };
    case "habit":
      return { ...base, details: { cadence: f.cadence } };
    case "file":
      return { ...base, details: { path: f.path, label: f.label } };
    case "conversation":
      return { ...base, details: { text: f.text, participants: commaList(f.participants) } };
    default:
      return { ...base, startedAt: toIso(f.when), endedAt: toIso(f.endedAt) };
  }
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
    when: str(d.occurredAt ?? d.decidedAt ?? e.startedAt).slice(0, 10),
    endedAt: str(d.endedAt ?? e.endedAt).slice(0, 10),
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

/** The message an action returned, or its error. */
export function actionMessage(result: unknown): { ok: boolean; text: string | null } {
  if (typeof result !== "object" || result === null) return { ok: false, text: "No answer from DexNest." };
  const r = result as { ok?: unknown; message?: unknown; error?: unknown; cancelled?: unknown };
  if (r.cancelled === true) return { ok: true, text: null };
  if (r.ok === true) return { ok: true, text: typeof r.message === "string" ? r.message : null };
  return { ok: false, text: typeof r.error === "string" ? r.error : "That did not work." };
}
