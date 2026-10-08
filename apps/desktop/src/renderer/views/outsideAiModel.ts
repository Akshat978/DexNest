// What the Outside AI settings card shows, without the card: kept apart so it can be tested on its own.

export const OUTSIDE_AI_USES = ["voice", "typed", "capture", "rpg_rule", "skills", "standup", "commit", "todos", "answer"] as const;
export type OutsideAiUse = (typeof OUTSIDE_AI_USES)[number];

export const OUTSIDE_AI_DATA = ["words", "notes", "packages", "commits", "code", "records"] as const;
export type OutsideAiData = (typeof OUTSIDE_AI_DATA)[number];

/** What each use needs to see. The main process holds the same table and is the one that enforces it. */
export const USE_NEEDS: Record<OutsideAiUse, readonly OutsideAiData[]> = {
  voice: ["words"],
  typed: ["words"],
  capture: ["notes"],
  rpg_rule: ["words"],
  skills: ["packages"],
  standup: ["commits"],
  commit: ["code"],
  todos: ["code"],
  answer: ["words", "records"]
};

/** Each kind of data, said exactly: the switch's label and what turning it on lets leave the computer. */
export const DATA_LABELS: Record<OutsideAiData, { name: string; detail: string }> = {
  words: { name: "What you say or type to DexNest", detail: "A command the rules cannot place, a question you ask in Search, a sentence describing a rule. 300 characters at most." },
  notes: { name: "Capture notes", detail: "The title and text of one note, when you click Suggest on it. Never an attached file." },
  packages: { name: "Package and tool names", detail: "The names of the packages and tools found in your projects, as Skills lists them. Names only." },
  commits: { name: "Project names and commit subjects", detail: "The lines of the Standup on Today: which project, and what changed in it." },
  code: { name: "Lines of your code", detail: "The diff of a change you are about to commit, with the names of the files in it, and the words of TODO comments. Files that hold secrets, and lines that look like one, are left out." },
  records: { name: "Search results from the newer screens", detail: "Titles and short previews from Today, Skills, Reality RPG, GhostOS, ObjectOS, the Timetable and reminders. Up to eight per question." }
};

/** Each use: its switch's label, and how it reads in the one-line summary. */
export const USE_LABELS: Record<OutsideAiUse, { name: string; short: string }> = {
  voice: { name: "For commands you speak", short: "spoken commands" },
  typed: { name: "For commands you type into Ask DexNest", short: "typed commands" },
  capture: { name: "For Capture: a Suggest button on each note, which asks where it belongs", short: "Capture" },
  rpg_rule: { name: "In Reality RPG: describe a rule in a sentence and have the form filled in", short: "Reality RPG rules from a sentence" },
  skills: { name: "In Skills: ask which entries are really tooling, so you can hide them", short: "sorting skills from tooling" },
  standup: { name: "On Today: the Standup in a few plain sentences", short: "the Standup in words" },
  commit: { name: "In Projects: draft a commit message from the change", short: "commit message drafts" },
  todos: { name: "On Today: check which open TODOs are real", short: "checking TODOs" },
  answer: { name: "In Search: a short answer written from the results", short: "answers in Search" }
};

export interface OutsideAiSettingsValue {
  enabled: boolean;
  surfaces: Record<OutsideAiUse, boolean>;
  data: Record<OutsideAiData, boolean>;
  minConfidence: number;
  writingModel: string;
}

export interface OutsideAiState {
  settings: OutsideAiSettingsValue;
  hasKey: boolean;
  keySavedAt: string | null;
  canStoreKey: boolean;
  model: string;
}

/** The kinds of data a use needs that are not switched on. */
export function missingData(settings: Pick<OutsideAiSettingsValue, "data">, use: OutsideAiUse): OutsideAiData[] {
  return USE_NEEDS[use].filter((kind) => settings.data?.[kind] !== true);
}

/** Whether a use can send anything as things stand: the main switch, a key, its own switch, and the data it needs. */
export function canUse(state: Pick<OutsideAiState, "settings" | "hasKey"> | null | undefined, use: OutsideAiUse): boolean {
  return Boolean(state && state.settings.enabled && state.hasKey && state.settings.surfaces?.[use] === true && missingData(state.settings, use).length === 0);
}

/** Whether anything can be sent as things stand, in words. */
export function sendingSummary(state: Pick<OutsideAiState, "settings" | "hasKey">): string {
  const { enabled } = state.settings;
  if (!enabled) return "Off. Nothing is sent anywhere.";
  if (!state.hasKey) return "On, but no key is saved, so nothing is sent.";
  const on = (use: OutsideAiUse) => canUse(state, use);
  const commands = [on("voice") ? "spoken commands" : "", on("typed") ? "typed commands" : ""].filter(Boolean);
  const parts = [
    commands.length > 0 ? `${commands.join(" and ")}, only when DexNest's own rules cannot tell what a command means` : "",
    on("capture") ? "Capture, only when you click Suggest on a note" : "",
    ...OUTSIDE_AI_USES.slice(3).filter(on).map((use) => `${USE_LABELS[use].short}, only when you click for it`)
  ].filter(Boolean);
  if (parts.length === 0) return "On, but not allowed anywhere yet, so nothing is sent.";
  return `On for ${parts.join("; and for ")}.`;
}

/** A percentage the user typed, as the 0.5 to 0.99 the setting holds. */
export function confidenceFromPercent(text: string, fallback: number): number {
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.99, Math.max(0.5, Math.round(n) / 100));
}
