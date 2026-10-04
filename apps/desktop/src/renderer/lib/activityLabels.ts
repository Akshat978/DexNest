// The activity log, in words: one name per module however a row spelled it,
// and a readable line for the events newer modules write to their own streams
// (which have no summary of their own). Pure.

/** A row as the main process returns it: the envelope, and for audit rows the fields they carry. */
export interface ActivityRow {
  id: string;
  at: string;
  stream: string;
  type: string;
  module: string | null;
  actionId: string | null;
  status: string | null;
  source: string;
  /** Only audit rows have one: the line the action wrote. */
  summary: string | null;
}

const MODULE_NAMES: Record<string, string> = {
  system: "DexNest",
  command: "Command",
  clipboard: "Clipboard",
  drop: "Drop",
  tools: "Tools",
  vault: "Vault",
  search: "Search",
  journal: "Journal",
  calendar: "Calendar",
  timetable: "Timetable",
  utilities: "Utilities",
  news: "News",
  weather: "Weather",
  capture: "Capture",
  finance: "Finance",
  finder: "ObjectOS",
  dev: "Projects",
  projects: "Projects",
  deck: "Deck",
  heatmap: "Heatmap",
  backup: "Backup",
  settings: "Settings",
  voice: "Voice",
  audit: "Activity log",
  autopilot: "Autopilot",
  developer_intelligence: "Repository scan",
  dev_intelligence: "Repository scan",
  standup: "Today",
  skill_constellation: "Skills",
  reality_rpg: "Reality RPG",
  ghost_os: "GhostOS",
  object_os: "ObjectOS",
  external_devices: "External Devices"
};

/**
 * One name per module. Rows have said "clipboard", "Clipboard",
 * "DexNest Finance" and "finance" for the same things; they all come out the
 * way the sidebar spells it.
 */
export function moduleName(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "DexNest";
  const key = text.toLowerCase().replace(/^dexnest\s+/, "").replace(/[\s-]+/g, "_");
  return MODULE_NAMES[key] ?? MODULE_NAMES[key.replace(/_/g, "")] ?? text.replace(/^DexNest\s+/i, "");
}

export const STREAMS: readonly { id: string; label: string }[] = [
  { id: "", label: "Everything" },
  { id: "audit", label: "Actions" },
  { id: "dev", label: "Repository scan" },
  { id: "projects", label: "Projects" },
  { id: "skill", label: "Skills" },
  { id: "rpg", label: "Reality RPG" },
  { id: "ghost", label: "GhostOS" },
  { id: "object", label: "ObjectOS" }
];

const STREAM_MODULE: Record<string, string> = { dev: "developer_intelligence", projects: "projects", skill: "skill_constellation", rpg: "reality_rpg", ghost: "ghost_os", object: "object_os" };

/** "dev.commit.observed" -> "Commit observed"; "object.maintenance_logged" -> "Maintenance logged". */
export function typeWords(type: string): string {
  const parts = type.split(".");
  const rest = (parts.length > 1 ? parts.slice(1) : parts).join(" ").replace(/_/g, " ").trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : type;
}

export interface ActivityLine {
  id: string;
  at: string;
  module: string;
  /** The action id for an action; the event type for a module's own event. */
  what: string;
  status: string;
  source: string;
  summary: string;
}

export function activityLine(row: ActivityRow): ActivityLine {
  const own = row.stream !== "audit";
  return {
    id: row.id,
    at: row.at,
    module: moduleName(row.module ?? STREAM_MODULE[row.stream] ?? null),
    what: row.actionId ?? row.type,
    status: row.status ?? (own ? "recorded" : "success"),
    source: row.source,
    summary: row.summary ?? typeWords(row.type)
  };
}
