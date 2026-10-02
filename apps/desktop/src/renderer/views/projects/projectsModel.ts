// The Projects view's decisions, without React: filtering, ordering, which
// quick actions are available (and why not), keyboard movement, and the
// project form. Every git rule comes from @dexnest/projects' own planners, so
// a button is disabled for exactly the reason the operation would be refused.

import {
  attentionReasons,
  currentBranch,
  fetchedAgoText,
  groupForHome,
  isDirty,
  planOperation,
  projectBadge,
  ACCENTS,
  COMMAND_SLOTS,
  PROJECT_TYPES,
  type Badge,
  type CommandSlot,
  type HomeEntry,
  type HomeGroup,
  type HomeSort,
  type Project,
  type ProjectInput,
  type RepoState
} from "@dexnest/projects/domain";

export type StatusFilter = "all" | "attention" | "to_push" | "to_pull" | "uncommitted" | "all_pushed" | "not_git" | "favourites" | "archived";

export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Any status" },
  { value: "attention", label: "Needs attention" },
  { value: "to_push", label: "To push" },
  { value: "to_pull", label: "To pull" },
  { value: "uncommitted", label: "Uncommitted" },
  { value: "all_pushed", label: "All pushed" },
  { value: "not_git", label: "Not a git repo" },
  { value: "favourites", label: "Favourites" },
  { value: "archived", label: "Archived" }
];

export interface HomeFilters {
  query: string;
  group: string;
  tag: string;
  status: StatusFilter;
  sort: HomeSort;
}

export const DEFAULT_FILTERS: HomeFilters = { query: "", group: "all", tag: "all", status: "all", sort: "activity" };

/** A row as the view holds it: the project, its git state (or why it couldn't be read), whether an operation runs. */
export interface ViewEntry extends HomeEntry {
  readError?: string;
  busy?: boolean;
}

function matchesQuery(entry: ViewEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const p = entry.project;
  const branch = entry.state?.isRepo ? entry.state.head.branch ?? "" : "";
  return [p.name, p.path, p.description, branch, ...p.tags, p.git.remoteUrl ?? ""].some((field) => field.toLowerCase().includes(q));
}

function matchesStatus(entry: ViewEntry, status: StatusFilter, now: string, staleDays: number): boolean {
  // Archived projects appear only under "Archived", and nowhere else.
  if (status === "archived") return entry.project.archivedAt !== null;
  if (entry.project.archivedAt !== null) return false;
  if (status === "all") return true;
  if (status === "favourites") return entry.project.favourite || entry.project.pinned;
  if (status === "attention") return attentionReasons(entry, now, staleDays).length > 0;
  const badge = projectBadge(entry.state);
  if (status === "uncommitted") return entry.state?.isRepo === true && isDirty(entry.state.workingTree);
  return badge.kind === status;
}

export function filterEntries(entries: readonly ViewEntry[], filters: HomeFilters, now: string, staleDays: number): ViewEntry[] {
  return entries.filter(
    (entry) =>
      matchesQuery(entry, filters.query) &&
      (filters.group === "all" || (filters.group === "none" ? entry.project.groupId === null : entry.project.groupId === filters.group)) &&
      (filters.tag === "all" || entry.project.tags.includes(filters.tag)) &&
      matchesStatus(entry, filters.status, now, staleDays)
  );
}

export function homeSections(entries: readonly ViewEntry[], filters: HomeFilters, now: string, staleDays: number): HomeGroup[] {
  const filtered = filterEntries(entries, filters, now, staleDays);
  if (filters.status === "archived") {
    const sorted = [...filtered].sort((a, b) => a.project.name.localeCompare(b.project.name));
    return sorted.length > 0 ? [{ section: "all", entries: sorted }] : [];
  }
  return groupForHome(filtered, { now, staleDays, sort: filters.sort });
}

export const SECTION_TITLES: Record<HomeGroup["section"], string> = {
  attention: "Needs attention",
  favourites: "Favourites",
  all: "All projects"
};

export function allTags(projects: readonly Project[]): string[] {
  const seen = new Map<string, string>();
  for (const p of projects) for (const tag of p.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export type QuickActionId = "vscode" | "terminal" | "fetch" | "pull" | "push";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  /** null when available; otherwise the reason, shown as the tooltip. */
  disabledReason: string | null;
}

/** The five buttons on every card, each with the exact reason it can't be used right now. */
export function quickActions(entry: ViewEntry): QuickAction[] {
  const state = entry.state;
  const folderGone = state && !state.isRepo && state.reason === "Folder not found." ? "The project folder doesn't exist." : null;
  const busy = entry.busy ? "An operation is running in this project." : null;
  const notRead = state === null ? (entry.readError ? `Git couldn't be read: ${entry.readError}` : "Reading git state…") : null;
  const notGit = state && !state.isRepo ? state.reason : null;
  const git = (kind: "pull" | "push"): string | null => {
    if (busy || notRead || notGit) return busy ?? notRead ?? notGit;
    const result = planOperation(state as RepoState, { kind });
    return result.refused ? result.reason : null;
  };
  const fetchReason = busy ?? notRead ?? notGit ?? (state?.isRepo && state.remotes.length === 0 ? "This repository has no remote." : null);
  return [
    { id: "vscode", label: "VS Code", disabledReason: folderGone },
    { id: "terminal", label: "Terminal", disabledReason: folderGone },
    { id: "fetch", label: "Fetch", disabledReason: fetchReason },
    { id: "pull", label: "Pull", disabledReason: git("pull") },
    { id: "push", label: "Push", disabledReason: git("push") }
  ];
}

export function badgeFor(entry: ViewEntry): Badge {
  if (entry.state === null && entry.readError) return { kind: "unknown", text: "can't read git", tone: "error", attention: false };
  return projectBadge(entry.state);
}

/** "main · 3 changed" - the second line of a card. */
export function branchLine(state: RepoState | null): string {
  if (!state) return "";
  if (!state.isRepo) return "";
  const branch = state.head.detached ? `detached at ${(state.head.sha ?? "").slice(0, 7)}` : state.head.branch ?? "(no branch)";
  const c = state.workingTree.counts;
  const changed = c.staged + c.unstaged + c.untracked;
  const bits = [branch];
  if (changed > 0) bits.push(`${changed} changed`);
  if (state.stashes.length > 0) bits.push(`${state.stashes.length} stashed`);
  const autopilot = state.worktrees.filter((w) => w.owner === "autopilot").length;
  if (autopilot > 0) bits.push(`${autopilot} Autopilot worktree${autopilot === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

export function relativeTime(iso: string | null | undefined, now: string): string {
  if (!iso) return "";
  const ms = Date.parse(now) - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} mo ago` : `${Math.round(months / 12)} y ago`;
}

/** The most recent fetch across all projects, for the header. */
export function headerSummary(entries: readonly ViewEntry[], now: string, staleDays: number): string {
  const live = entries.filter((e) => e.project.archivedAt === null);
  const attention = live.filter((e) => attentionReasons(e, now, staleDays).length > 0).length;
  const fetches = live.map((e) => (e.state?.isRepo ? e.state.lastFetchAt : null)).filter((f): f is string => Boolean(f)).sort();
  const parts = [`${live.length} project${live.length === 1 ? "" : "s"}`];
  if (attention > 0) parts.push(`${attention} need${attention === 1 ? "s" : ""} attention`);
  if (live.length > 0) parts.push(fetches.length > 0 ? fetchedAgoText(fetches[fetches.length - 1], now) : "never fetched");
  return parts.join(" · ");
}

/** Arrow keys over a grid (or a list: columns = 1); Home/End jump. */
export function moveFocus(index: number, key: string, count: number, columns: number): number | null {
  if (count === 0) return null;
  const cols = Math.max(1, columns);
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, index + 1);
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowDown":
      return Math.min(count - 1, index + cols);
    case "ArrowUp":
      return Math.max(0, index - cols);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** "/" focuses search - unless the owner is already typing somewhere. */
export function isSearchShortcut(key: string, targetTag: string | undefined, editable: boolean): boolean {
  return key === "/" && !editable && !["INPUT", "TEXTAREA", "SELECT"].includes((targetTag ?? "").toUpperCase());
}

// --- the project form (wizard step 3, and the Settings tab in Phase 8) --------------

export interface CommandRow {
  id?: string;
  label: string;
  command: string;
  requiresConfirmation: boolean;
}

export interface ProjectForm {
  name: string;
  path: string;
  description: string;
  accent: string;
  projectType: string;
  groupId: string;
  tags: string;
  favourite: boolean;
  commands: Record<CommandSlot, string>;
  commandList: CommandRow[];
  ports: string;
  localUrls: string;
  links: string;
  folders: string;
  healthUrl: string;
  stopCommand: string;
  logCommand: string;
  logPath: string;
  dockerCompose: boolean;
  notes: string;
}

export const ACCENT_OPTIONS = ACCENTS;
export const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Not set" },
  ...PROJECT_TYPES.map((t) => ({ value: t, label: { local_app: "Local app", live_website: "Live website", mobile_app: "Mobile app", external_server: "External server" }[t] }))
];

/** "local_app" -> "Local app"; null when the project has no type. */
export function projectTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return TYPE_OPTIONS.find((t) => t.value === type)?.label ?? null;
}

const lines = (items: readonly string[]) => items.join("\n");
const splitLines = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

/** "Label | value" per line; a line without "|" is its own label. */
function pairs(text: string, key: "url" | "path"): Array<{ label: string; url?: string; path?: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.indexOf("|");
      const label = bar >= 0 ? line.slice(0, bar).trim() : "";
      const value = (bar >= 0 ? line.slice(bar + 1) : line).trim();
      return key === "url" ? { label: label || value, url: value } : { label: label || value, path: value };
    });
}

export function formFromInput(input: ProjectInput): ProjectForm {
  const commands = {} as Record<CommandSlot, string>;
  for (const slot of COMMAND_SLOTS) commands[slot] = input.commands?.[slot] ?? "";
  return {
    name: input.name ?? "",
    path: input.path ?? "",
    description: input.description ?? "",
    accent: input.accent ?? "dev",
    projectType: input.projectType ?? "",
    groupId: input.groupId ?? "",
    tags: (input.tags ?? []).join(", "),
    favourite: input.favourite ?? false,
    commands,
    commandList: (input.commandList ?? []).map((c) => ({ id: c.id, label: c.label ?? "", command: c.command ?? "", requiresConfirmation: c.requiresConfirmation === true })),
    ports: (input.ports ?? []).join(", "),
    localUrls: lines(input.localUrls ?? []),
    links: lines((input.links ?? []).map((l) => (l.label && l.label !== l.url ? `${l.label} | ${l.url ?? ""}` : l.url ?? ""))),
    folders: lines((input.folders ?? []).map((f) => (f.label && f.label !== f.path ? `${f.label} | ${f.path ?? ""}` : f.path ?? ""))),
    healthUrl: input.healthUrl ?? "",
    stopCommand: input.stopCommand ?? "",
    logCommand: input.logCommand ?? "",
    logPath: input.logPath ?? "",
    dockerCompose: input.dockerCompose ?? false,
    notes: input.notes ?? ""
  };
}

export function formFromProject(p: Project): ProjectForm {
  return formFromInput({ ...p, projectType: p.projectType, groupId: p.groupId });
}

export function inputFromForm(form: ProjectForm): ProjectInput {
  return {
    name: form.name.trim(),
    path: form.path.trim(),
    description: form.description.trim(),
    accent: form.accent,
    projectType: form.projectType || null,
    groupId: form.groupId || null,
    tags: splitLines(form.tags),
    favourite: form.favourite,
    commands: { ...form.commands },
    commandList: form.commandList.filter((c) => c.label.trim() && c.command.trim()).map((c) => ({ ...c, label: c.label.trim(), command: c.command.trim() })),
    ports: splitLines(form.ports),
    localUrls: splitLines(form.localUrls),
    links: pairs(form.links, "url").map((l) => ({ label: l.label, url: l.url ?? "" })),
    folders: pairs(form.folders, "path").map((f) => ({ label: f.label, path: f.path ?? "" })),
    healthUrl: form.healthUrl.trim(),
    stopCommand: form.stopCommand.trim(),
    logCommand: form.logCommand.trim(),
    logPath: form.logPath.trim(),
    dockerCompose: form.dockerCompose,
    notes: form.notes
  };
}

/** Problems that stop Save, in plain words; an empty list means the form can be saved. */
export function formProblems(form: ProjectForm): string[] {
  const problems: string[] = [];
  if (!form.name.trim()) problems.push("Give the project a name.");
  if (!form.path.trim()) problems.push("Choose the project's folder.");
  const badPorts = splitLines(form.ports).filter((p) => !/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 65535);
  if (badPorts.length > 0) problems.push(`Ports must be numbers from 1 to 65535 (${badPorts.join(", ")}).`);
  for (const url of splitLines(form.localUrls)) if (!/^https?:\/\//i.test(url)) problems.push(`${url} isn't an http(s) URL.`);
  return problems;
}

export function currentBranchName(state: RepoState | null): string | null {
  return state?.isRepo ? currentBranch(state)?.name ?? state.head.branch : null;
}

// --- project detail (Phase 8) -----------------------------------------------------

export const DETAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "branches", label: "Branches" },
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "run", label: "Run" },
  { id: "links", label: "Links" },
  { id: "settings", label: "Settings" }
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number]["id"];

export type DetailShortcut = { kind: "op"; request: { kind: "fetch" | "pull" | "push" } } | { kind: "tab"; tab: DetailTab } | { kind: "back" } | null;

/** F fetch, P pull, U push (each opens the operation dialog), 1-7 tabs, Esc back - never while typing. */
export function detailShortcut(key: string, targetTag: string | undefined, editable: boolean, modifiers = false): DetailShortcut {
  if (modifiers || editable || ["INPUT", "TEXTAREA", "SELECT"].includes((targetTag ?? "").toUpperCase())) return null;
  const k = key.toLowerCase();
  if (k === "f") return { kind: "op", request: { kind: "fetch" } };
  if (k === "p") return { kind: "op", request: { kind: "pull" } };
  if (k === "u") return { kind: "op", request: { kind: "push" } };
  if (k === "escape") return { kind: "back" };
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= DETAIL_TABS.length) return { kind: "tab", tab: DETAIL_TABS[n - 1].id };
  return null;
}

/**
 * Whether a button for this request should be enabled, and if not, why. A
 * refusal that comes with an offer the dialog can act on (stash and switch,
 * push and set upstream) still opens the dialog.
 */
export function availability(state: RepoState | null, request: OperationRequestLike): string | null {
  if (!state) return "Reading git state…";
  if (!state.isRepo) return state.reason;
  const result = planOperation(state, request as Parameters<typeof planOperation>[1]);
  if (!result.refused) return null;
  return result.offers.some((o) => o === "stash_and_switch" || o === "push_set_upstream") ? null : result.reason;
}

export type OperationRequestLike = { kind: string } & Record<string, unknown>;

export interface BranchRowView {
  key: string;
  kind: "local" | "remote";
  name: string;
  current: boolean;
  upstream: string | null;
  vsUpstream: string;
  vsDefault: string;
  merged: boolean | null;
  lastCommitAt: string | null;
  subject: string | null;
  stale: boolean;
  elsewhere: "autopilot" | "other" | null;
  remote: string | null;
}

function counts(c: { ahead: number; behind: number } | null): string {
  if (!c) return "-";
  if (c.ahead === 0 && c.behind === 0) return "in sync";
  return [c.ahead > 0 ? `${c.ahead} ahead` : "", c.behind > 0 ? `${c.behind} behind` : ""].filter(Boolean).join(" · ");
}

/** Local branches (current first, then by recency), then remote branches no local branch tracks. */
export function branchRows(state: RepoState | null, now: string, staleDays: number): BranchRowView[] {
  if (!state?.isRepo) return [];
  const stale = (at: string | null) => Boolean(at) && Date.parse(now) - Date.parse(at as string) > staleDays * 86_400_000;
  const locals: BranchRowView[] = state.branches.map((b) => ({
    key: `l:${b.name}`,
    kind: "local",
    name: b.name,
    current: b.isCurrent,
    upstream: b.upstream ? (b.upstream.gone ? `${b.upstream.ref} (gone)` : b.upstream.ref) : null,
    vsUpstream: !b.upstream ? "local only" : b.upstream.gone ? "upstream gone" : counts(b.upstream.counts),
    vsDefault: b.name === state.defaultBranch ? "default" : counts(b.vsDefault),
    merged: b.mergedIntoDefault,
    lastCommitAt: b.lastCommitAt,
    subject: b.lastSubject,
    stale: stale(b.lastCommitAt),
    elsewhere: b.checkedOutElsewhere ? (b.checkedOutElsewhere.owner === "autopilot" ? "autopilot" : "other") : null,
    remote: b.upstream?.remote ?? null
  }));
  locals.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""));
  const remotes: BranchRowView[] = state.remoteBranches
    .filter((r) => r.trackedBy === null)
    .map((r) => ({
      key: `r:${r.ref}`,
      kind: "remote",
      name: r.name,
      current: false,
      upstream: r.ref,
      vsUpstream: "remote only",
      vsDefault: r.name === state.defaultBranch ? "default" : counts(r.vsDefault),
      merged: r.mergedIntoDefault,
      lastCommitAt: r.lastCommitAt,
      subject: r.lastSubject,
      stale: stale(r.lastCommitAt),
      elsewhere: null,
      remote: r.remote
    }));
  remotes.sort((a, b) => (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""));
  return [...locals, ...remotes];
}

export interface ChangeRowView {
  path: string;
  from?: string;
  group: "conflicted" | "staged" | "unstaged" | "untracked";
  status: string;
  added: number | null;
  deleted: number | null;
}

const STATUS_LETTER: Record<string, string> = { added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C", type_changed: "T" };

export function changeRows(state: RepoState | null, stat: { staged: Array<{ path: string; added: number | null; deleted: number | null }>; unstaged: Array<{ path: string; added: number | null; deleted: number | null }> } | null): ChangeRowView[] {
  if (!state?.isRepo) return [];
  const t = state.workingTree;
  const find = (list: Array<{ path: string; added: number | null; deleted: number | null }> | undefined, path: string) => list?.find((r) => r.path === path);
  return [
    ...t.conflicted.map((path) => ({ path, group: "conflicted" as const, status: "U", added: null, deleted: null })),
    ...t.staged.map((f) => ({ path: f.path, from: f.from, group: "staged" as const, status: STATUS_LETTER[f.status] ?? "M", added: find(stat?.staged, f.path)?.added ?? null, deleted: find(stat?.staged, f.path)?.deleted ?? null })),
    ...t.unstaged.map((f) => ({ path: f.path, group: "unstaged" as const, status: STATUS_LETTER[f.status] ?? "M", added: find(stat?.unstaged, f.path)?.added ?? null, deleted: find(stat?.unstaged, f.path)?.deleted ?? null })),
    ...t.untracked.map((path) => ({ path, group: "untracked" as const, status: "?", added: null, deleted: null }))
  ];
}

/** The Dev dashboard's rule, kept identical (main.ts isDangerousCommand): such a command always asks first. */
export function isDangerousCommand(command: string): boolean {
  return /\b(rm\s+-rf|del\s+\/|rmdir\s+\/s|format\b|diskpart\b|Remove-Item\b.*-Recurse|git\s+reset\s+--hard|git\s+clean\s+-fd)\b/i.test(command);
}

export function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export interface RunCommand {
  actionId: string;
  label: string;
  command: string;
  /** Asks before running: marked by the owner, or the command looks destructive. */
  confirm: boolean;
}

/** The Run tab's command buttons - the same action ids the Dev dashboard and Stream Deck cards use. */
export function runCommands(project: Project): RunCommand[] {
  const out: RunCommand[] = [];
  const slots: Array<[CommandSlot, string]> = [["start", "dev"], ["build", "build"], ["typecheck", "typecheck"], ["test", "test"], ["custom", "custom"]];
  for (const [slot, label] of slots) {
    const command = project.commands[slot].trim();
    if (command) out.push({ actionId: `dev.project.${project.id}.run_${slot}`, label, command, confirm: isDangerousCommand(command) });
  }
  for (const entry of project.commandList) {
    out.push({ actionId: `dev.project.${project.id}.run_cmd_${entry.id}`, label: entry.label, command: entry.command, confirm: entry.requiresConfirmation || isDangerousCommand(entry.command) });
  }
  return out;
}

export interface LifecycleAction {
  op: "stop" | "restart" | "check_health" | "kill_ports" | "show_processes" | "docker_down" | "open_logs" | "open_urls";
  label: string;
  /** Stops or kills something: asks first. */
  dangerous: boolean;
}

/** The Dev dashboard's lifecycle card, with the same conditions for each button. */
export function lifecycleActions(project: Project): LifecycleAction[] {
  const hasPorts = project.ports.length > 0;
  const any = hasPorts || project.commands.start.trim() !== "" || project.stopCommand.trim() !== "" || project.dockerCompose || project.logPath.trim() !== "" || project.logCommand.trim() !== "";
  if (!any) return [];
  const out: LifecycleAction[] = [
    { op: "stop", label: "Stop", dangerous: true },
    { op: "restart", label: "Restart", dangerous: true },
    { op: "check_health", label: "Health", dangerous: false }
  ];
  if (hasPorts) out.push({ op: "kill_ports", label: "Kill ports", dangerous: true }, { op: "show_processes", label: "Processes", dangerous: false });
  if (project.dockerCompose) out.push({ op: "docker_down", label: "Docker down", dangerous: true });
  if (project.logPath.trim() || project.logCommand.trim()) out.push({ op: "open_logs", label: "Logs", dangerous: false });
  if (project.localUrls.length > 0) out.push({ op: "open_urls", label: "Open URLs", dangerous: false });
  return out;
}

export interface OperationLine {
  id: string;
  verb: string;
  outcome: string | null;
  state: string;
  startedAt: string;
  undoable: boolean;
  undone: boolean;
}

/** The journal, newest first; only the latest finished operation can be undone, and only once. */
export function operationLines(records: ReadonlyArray<{ id: string; verb: string; outcome: string | null; state: string; startedAt: string; undo: unknown; undoneBy: string | null }>): OperationLine[] {
  const latestFinished = records.find((r) => r.state === "succeeded" || r.state === "failed" || r.state === "interrupted");
  return records.map((r) => ({
    id: r.id,
    verb: r.verb,
    outcome: r.outcome,
    state: r.state,
    startedAt: r.startedAt,
    undone: r.undoneBy !== null,
    undoable: r === latestFinished && r.state === "succeeded" && r.undo !== null && r.undoneBy === null
  }));
}

/** "delete_remote_branch" -> "Delete remote branch": an operation kind or verb in plain words. */
export function operationLabel(kind: string): string {
  const words = kind.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Operation";
}
