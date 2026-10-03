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

/**
 * Repository ids are opaque; a person reads a name. A repository that is a
 * project is called what Projects calls it - the same name on every screen -
 * and otherwise by what the scan recorded, then by its folder.
 */
export function repoLabels(repositories: readonly Repository[], projects: readonly { name: string; path: string }[] = []): Map<string, RepoLabel> {
  const labels = new Map<string, RepoLabel>();
  for (const repo of repositories) {
    const path = repo.roots[0]?.path ?? null;
    const project = path ? projects.find((p) => samePath(p.path, path)) : undefined;
    labels.set(repo.id, { name: project?.name?.trim() || repo.displayName?.trim() || (path ? baseName(path) : repo.id), path });
  }
  return labels;
}

/** A repository-state row's "name @ branch", with the name every other screen uses. */
export function repoStateTitle(item: StandupItem, labels: ReadonlyMap<string, RepoLabel>): string {
  const name = item.repositoryId ? labels.get(item.repositoryId)?.name : undefined;
  const at = item.title.lastIndexOf(" @ ");
  return name && at > 0 ? `${name}${item.title.slice(at)}` : item.title;
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

/** The engine's "N more not shown" line at the end of a capped section. A count, not an item. */
const isOverflow = (item: StandupItem) => item.id.endsWith(":overflow");

/** A section's real items: no placeholders, and not the overflow line. */
export function sectionItems(report: StandupReport, kind: StandupSectionKind): StandupItem[] {
  const section = report.sections.find((s) => s.kind === kind);
  return (section?.items ?? []).filter((item) => !PLACEHOLDER_IDS.has(item.id) && !isOverflow(item));
}

/** How many items a capped section left out, read from its overflow line. */
export function sectionOmitted(report: StandupReport, kind: StandupSectionKind): number {
  const overflow = report.sections.find((s) => s.kind === kind)?.items.find(isOverflow);
  const count = overflow ? Number(/^(\d+) more/.exec(overflow.title)?.[1]) : 0;
  return Number.isFinite(count) ? count : 0;
}

/** Everything the section found, shown or not: the number its heading and its tile carry. */
export function sectionTotal(report: StandupReport, kind: StandupSectionKind): number {
  return sectionItems(report, kind).length + sectionOmitted(report, kind);
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

export type ChangeKind = "commit" | "push" | "pull" | "branch" | "todo-new" | "todo-resolved" | "other";

export function changeKind(item: StandupItem): ChangeKind {
  if (item.id.startsWith("changed:commit:")) return "commit";
  if (item.id.startsWith("changed:push:")) return "push";
  if (item.id.startsWith("changed:pull:")) return "pull";
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
  const attention = sectionItems(report, "NeedsAttention").filter((i) => i.lifecycle !== "RESOLVED");
  const states = sectionItems(report, "RepositoryState").map((i) => parseRepoState(i.summary)).filter((s): s is RepoState => s !== null);
  const isClean = (s: RepoState) => s.clean && s.dirty === 0 && s.staged === 0 && s.conflicts === 0;
  return {
    repositories: status?.repositories ?? states.length,
    changes: sectionTotal(report, "Changed"),
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

// --- What is watched ---------------------------------------------------------------------------
//
// Projects is the one list of projects. The scan follows it without being
// told: turning Today on needs no folders chosen, and adding, archiving or
// removing a project is how what is watched changes. Folders configured
// before that was so are still scanned; they are shown as extras that can be
// dropped.

function within(path: string, root: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return p === r || p.startsWith(`${r}/`);
}

export interface WatchedProject {
  id: string;
  name: string;
  path: string;
}

/** The projects the scan reads: those that are Git repositories. */
export function watchedProjects(projects: readonly { id: string; name: string; path: string; isRepo: boolean | null }[]): WatchedProject[] {
  return projects.filter((p) => p.isRepo !== false && p.path.trim().length > 0).map(({ id, name, path }) => ({ id, name, path }));
}

export interface ExtraFolder {
  path: string;
  /** A folder looked inside for repositories, or one repository. */
  kind: "root" | "repository";
}

/** Folders watched by their own setting, not because they are projects. A folder that is a project is not an extra. */
export function extraFolders(settings: Pick<TodaySettings, "roots" | "manualRepositories"> | null, projects: readonly { path: string }[]): ExtraFolder[] {
  if (!settings) return [];
  const isProject = (path: string) => projects.some((project) => samePath(project.path, path));
  const seen = new Set<string>();
  const out: ExtraFolder[] = [];
  const add = (path: string, kind: ExtraFolder["kind"]) => {
    const key = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (!path.trim() || isProject(path) || seen.has(key)) return;
    seen.add(key);
    out.push({ path, kind });
  };
  for (const root of settings.roots) add(root.path, "root");
  for (const repo of settings.manualRepositories) add(repo.path, "repository");
  return out;
}

/** What an extra folder contributes, in words. */
export function extraFolderKind(folder: ExtraFolder): string {
  return folder.kind === "root" ? "every repository inside" : "this repository";
}

/** Extra folders in which the last scan found no repository: named, instead of quietly contributing nothing. */
export function emptyWatchedFolders(extras: readonly ExtraFolder[], repositories: readonly Repository[]): string[] {
  const found = repositories.flatMap((repo) => repo.roots.map((root) => root.path));
  return extras.map((folder) => folder.path).filter((folder) => !found.some((path) => within(path, folder)));
}

/** Settings with one folder no longer watched, wherever it was listed. Nothing else changes. */
export function settingsWithout(current: TodaySettings, path: string): TodaySettings {
  const keep = (root: TodayRoot) => !samePath(root.path, path);
  return { ...current, roots: current.roots.filter(keep), manualRepositories: current.manualRepositories.filter(keep) };
}

/** "8 projects", "1 project and 2 other folders". */
export function watchingLine(projects: number, extras: number): string {
  const count = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (projects > 0 || extras === 0) parts.push(count(projects, "project", "projects"));
  if (extras > 0) parts.push(count(extras, projects > 0 ? "other folder" : "folder", projects > 0 ? "other folders" : "folders"));
  return parts.join(" and ");
}

/** How many rows a long section shows before "Show all". */
export const SECTION_PREVIEW = 8;
