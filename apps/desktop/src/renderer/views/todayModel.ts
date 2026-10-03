// Today: the morning screen's reading of a Standup report.
//
// Pure functions over what Developer Intelligence and Standup already store.
// Nothing here scans, ranks or decides: the report's own sections are shown,
// with repository ids turned into names and the engine's placeholder items
// ("No activity in window") turned into empty states.

import type { Repository, StandupItem, StandupReport, StandupSectionKind } from "@dexnest/dev-intelligence-contracts";

/** Mirrors DevIntelligenceStatus; the renderer imports no runtime code. */
export interface TodayStatus {
  enabled: boolean;
  scanning: boolean;
  lastError?: string;
  repositories: number;
}

export interface TodayRoot {
  path: string;
  domain: "windows" | "wsl";
}

/** Mirrors DevIntelligenceSettings. */
export interface TodaySettings {
  schemaVersion: 1;
  enabled: boolean;
  roots: TodayRoot[];
  manualRepositories: TodayRoot[];
  excludedRoots: string[];
  scanIntervalMinutes: number;
  runHealthChecks: boolean;
}

export type TodayState = "loading" | "error" | "off" | "waiting" | "ready";

export function viewState(input: { loading: boolean; error: string | null; status: TodayStatus | null; report: StandupReport | null }): TodayState {
  if (input.error) return "error";
  if (input.loading && !input.status) return "loading";
  if (!input.status?.enabled) return "off";
  return input.report ? "ready" : "waiting";
}

export function actionMessage(result: unknown): { ok: boolean; text: string | null } {
  if (!result || typeof result !== "object") return { ok: true, text: null };
  const r = result as { ok?: unknown; message?: unknown; error?: unknown };
  if (r.ok === false) return { ok: false, text: typeof r.error === "string" ? r.error : "That did not work." };
  return { ok: true, text: typeof r.message === "string" ? r.message : null };
}

// --- Repositories ------------------------------------------------------------------------------

export interface RepoLabel {
  name: string;
  path: string | null;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Repository ids are opaque; a person reads the folder's name. */
export function repoLabels(repositories: readonly Repository[]): Map<string, RepoLabel> {
  const labels = new Map<string, RepoLabel>();
  for (const repo of repositories) {
    const path = repo.roots[0]?.path ?? null;
    labels.set(repo.id, { name: repo.displayName?.trim() || (path ? baseName(path) : repo.id), path });
  }
  return labels;
}

export function repoName(labels: ReadonlyMap<string, RepoLabel>, repositoryId: string | undefined): string | null {
  if (!repositoryId) return null;
  return labels.get(repositoryId)?.name ?? repositoryId;
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase() === b.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();

/** The Projects entry for a repository's folder, so "Open in VS Code" can go through Projects' own action. */
export function projectIdForPath(projects: readonly { id: string; path: string }[], path: string | null): string | null {
  if (!path) return null;
  return projects.find((p) => samePath(p.path, path))?.id ?? null;
}

// --- Sections ------------------------------------------------------------------------------------

/** Items the engine adds so a section is never empty; the screen shows an empty state instead. */
const PLACEHOLDER_IDS = new Set(["changed:no-activity", "attention:none", "state:no-repos", "history:empty"]);

export function sectionItems(report: StandupReport, kind: StandupSectionKind): StandupItem[] {
  const section = report.sections.find((s) => s.kind === kind);
  return (section?.items ?? []).filter((item) => !PLACEHOLDER_IDS.has(item.id));
}

export interface Continuation {
  repositoryId: string;
  name: string;
  path: string | null;
  reason: string;
}

/** Where to pick up, best first: the engine's ranking, untouched. */
export function continuations(report: StandupReport, labels: ReadonlyMap<string, RepoLabel>): Continuation[] {
  const candidates = report.continuationCandidates ?? report.sections.find((s) => s.kind === "Continue")?.continuationCandidates ?? [];
  return [...candidates]
    .sort((a, b) => a.rank - b.rank || a.repositoryId.localeCompare(b.repositoryId))
    .map((c) => ({ repositoryId: c.repositoryId, name: repoName(labels, c.repositoryId) ?? c.repositoryId, path: labels.get(c.repositoryId)?.path ?? null, reason: c.reason }));
}

export type ChangeKind = "commit" | "branch" | "todo-new" | "todo-resolved" | "other";

export function changeKind(item: StandupItem): ChangeKind {
  if (item.id.startsWith("changed:commit:")) return "commit";
  if (item.id.startsWith("changed:branch:")) return "branch";
  if (item.id.startsWith("changed:todo-new:")) return "todo-new";
  if (item.id.startsWith("changed:todo-resolved:")) return "todo-resolved";
  return "other";
}

/**
 * A change in words. The engine writes an unknown earlier branch as "?": the
 * first time a repository is seen, that is not a switch, it is where it was found.
 */
export function changeTitle(item: StandupItem): string {
  const first = /^Branch \? → (.+)$/.exec(item.title);
  return first ? `First seen on ${first[1]}` : item.title;
}

/** "[NEW] Health check failing" without the bracket: the lifecycle is shown as a badge. */
export function attentionTitle(item: StandupItem): string {
  return item.title.replace(/^\[(?:NEW|ONGOING|RESOLVED)\]\s*/, "");
}

export type Tone = "accent" | "neutral" | "success" | "warning" | "error" | "info";

export function lifecycleTone(lifecycle: string | undefined): Tone {
  if (lifecycle === "NEW") return "error";
  if (lifecycle === "ONGOING") return "warning";
  if (lifecycle === "RESOLVED") return "success";
  return "neutral";
}

export function severityTone(severity: StandupItem["severity"]): Tone {
  return severity === "critical" ? "error" : severity === "warning" ? "warning" : "info";
}

/** When the thing an item is about was observed, if the report says. */
export function observedAt(item: StandupItem): string | null {
  return item.evidence.find((e) => e.observedAt)?.observedAt ?? null;
}

// --- Repository state --------------------------------------------------------------------------

export interface RepoState {
  dirty: number;
  staged: number;
  conflicts: number;
  clean: boolean;
}

/** The engine writes working-tree state as "dirty=3, staged=1, conflicts=0, clean=false". */
export function parseRepoState(summary: string | undefined): RepoState | null {
  const m = /^dirty=(\d+), staged=(\d+), conflicts=(\d+), clean=(true|false)$/.exec(summary ?? "");
  if (!m) return null;
  return { dirty: Number(m[1]), staged: Number(m[2]), conflicts: Number(m[3]), clean: m[4] === "true" };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** The same facts in words. Anything the parser does not recognise is shown as written. */
export function repoStateLine(summary: string | undefined): string {
  const state = parseRepoState(summary);
  if (!state) return summary ?? "";
  if (state.clean && state.dirty === 0 && state.staged === 0 && state.conflicts === 0) return "Nothing uncommitted";
  const parts: string[] = [];
  if (state.conflicts > 0) parts.push(plural(state.conflicts, "conflict"));
  if (state.dirty > 0) parts.push(`${state.dirty.toLocaleString("en")} uncommitted`);
  if (state.staged > 0) parts.push(`${state.staged.toLocaleString("en")} staged`);
  return parts.length > 0 ? parts.join(" · ") : "Uncommitted changes";
}

export function repoStateBadge(item: StandupItem): { label: string; tone: Tone } {
  const state = parseRepoState(item.summary);
  if (!state) return { label: "Unavailable", tone: "warning" };
  if (state.conflicts > 0) return { label: "Conflicts", tone: "error" };
  if (!state.clean || state.dirty > 0 || state.staged > 0) return { label: "Changes", tone: "warning" };
  return { label: "Clean", tone: "success" };
}

// --- Numbers -----------------------------------------------------------------------------------

export interface TodayStats {
  repositories: number;
  changes: number;
  attention: number;
  newIssues: number;
  uncommitted: number;
  clean: number;
}

export function todayStats(report: StandupReport, status: TodayStatus | null): TodayStats {
  const attention = sectionItems(report, "NeedsAttention").filter((i) => i.lifecycle !== "RESOLVED" && i.id !== "needsattention:overflow");
  const states = sectionItems(report, "RepositoryState").map((i) => parseRepoState(i.summary)).filter((s): s is RepoState => s !== null);
  const isClean = (s: RepoState) => s.clean && s.dirty === 0 && s.staged === 0 && s.conflicts === 0;
  return {
    repositories: status?.repositories ?? states.length,
    changes: sectionItems(report, "Changed").filter((i) => i.id !== "changed:overflow").length,
    attention: attention.length,
    newIssues: attention.filter((i) => i.lifecycle === "NEW").length,
    uncommitted: states.filter((s) => !isClean(s)).length,
    clean: states.filter(isClean).length
  };
}

// --- Time ----------------------------------------------------------------------------------------

/** "2 Oct, 09:12" in the report's own timezone, or the machine's. */
export function whenLabel(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const format = (zone?: string) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, ...(zone ? { timeZone: zone } : {}) }).format(date);
  try {
    return format(timeZone);
  } catch {
    return format();
  }
}

export function windowLine(report: StandupReport): string {
  const zone = report.timeWindow.timezone;
  return `Since ${whenLabel(report.timeWindow.from, zone)} · written ${whenLabel(report.generatedAt, zone)}`;
}

// --- Setup ---------------------------------------------------------------------------------------

export interface SetupFolder {
  path: string;
  /** A folder to look inside for repositories, or one repository. */
  kind: "root" | "repository";
}

const within = (path: string, root: string) => {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return p === r || p.startsWith(`${r}/`);
};

/**
 * What Projects already knows about, offered as places to watch: its import
 * folders, and any project that sits outside all of them.
 */
export function setupFolders(importRoots: readonly string[], projects: readonly { path: string }[]): SetupFolder[] {
  const folders: SetupFolder[] = [];
  const seen = new Set<string>();
  const add = (path: string, kind: SetupFolder["kind"]) => {
    const key = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (!path.trim() || seen.has(key)) return;
    seen.add(key);
    folders.push({ path, kind });
  };
  for (const root of importRoots) add(root, "root");
  for (const project of projects) if (!importRoots.some((root) => within(project.path, root))) add(project.path, "repository");
  return folders;
}

/** Settings with the module on and the chosen folders added; everything already there is kept. */
export function settingsWithFolders(current: TodaySettings, chosen: readonly SetupFolder[]): TodaySettings {
  const merge = (existing: TodayRoot[], kind: SetupFolder["kind"]): TodayRoot[] => {
    const out = [...existing];
    for (const folder of chosen) {
      if (folder.kind !== kind || out.some((r) => samePath(r.path, folder.path))) continue;
      out.push({ path: folder.path, domain: "windows" });
    }
    return out;
  };
  return { ...current, enabled: true, roots: merge(current.roots, "root"), manualRepositories: merge(current.manualRepositories, "repository") };
}

/** How many rows a long section shows before "Show all". */
export const SECTION_PREVIEW = 8;
