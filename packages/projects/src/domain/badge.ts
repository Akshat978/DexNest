// The one badge each project shows, "Needs attention", home ordering and the
// "fetched N minutes ago" line. Remote state is only as fresh as the last
// fetch, so the freshness text goes everywhere a badge does.

import type { Project } from "./project.ts";
import { currentBranch, isStale, type RepoState } from "./repoState.ts";

export type BadgeKind =
  | "conflict"
  | "in_progress"
  | "diverged"
  | "to_pull"
  | "to_push"
  | "uncommitted"
  | "no_upstream"
  | "detached"
  | "all_pushed"
  | "not_git"
  | "unknown";

export type BadgeTone = "error" | "warning" | "info" | "success" | "neutral";

export interface Badge {
  kind: BadgeKind;
  text: string;
  tone: BadgeTone;
  /** Counts as "needs attention" on the home screen. */
  attention: boolean;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const IN_PROGRESS_TEXT = {
  merge: "merge in progress",
  rebase: "rebase in progress",
  cherry_pick: "cherry-pick in progress",
  revert: "revert in progress",
  bisect: "bisect in progress"
} as const;

/** Highest priority first: conflict > in progress > diverged > to pull > to push > uncommitted > ... > all pushed. */
export function projectBadge(state: RepoState | null): Badge {
  if (!state) return { kind: "unknown", text: "not read yet", tone: "neutral", attention: false };
  if (!state.isRepo) return { kind: "not_git", text: "not a git repo", tone: "neutral", attention: false };
  const tree = state.workingTree;
  if (tree.counts.conflicted > 0) return { kind: "conflict", text: plural(tree.counts.conflicted, "conflict"), tone: "error", attention: true };
  if (state.inProgress) return { kind: "in_progress", text: IN_PROGRESS_TEXT[state.inProgress], tone: "error", attention: true };
  if (state.head.detached) return { kind: "detached", text: "detached HEAD", tone: "warning", attention: true };
  const branch = currentBranch(state);
  const counts = branch?.upstream?.counts ?? null;
  if (counts && counts.ahead > 0 && counts.behind > 0) return { kind: "diverged", text: "diverged", tone: "error", attention: true };
  if (counts && counts.behind > 0) return { kind: "to_pull", text: `${counts.behind} to pull`, tone: "warning", attention: true };
  if (counts && counts.ahead > 0) return { kind: "to_push", text: `${counts.ahead} to push`, tone: "warning", attention: true };
  const dirty = tree.counts.staged + tree.counts.unstaged + tree.counts.untracked;
  if (dirty > 0) return { kind: "uncommitted", text: "uncommitted changes", tone: "info", attention: false };
  if (state.remotes.length === 0) return { kind: "no_upstream", text: "local only", tone: "neutral", attention: false };
  if (!state.head.unborn && branch && (!branch.upstream || branch.upstream.gone)) {
    return { kind: "no_upstream", text: branch.upstream?.gone ? "upstream gone" : "not pushed yet", tone: "info", attention: false };
  }
  return { kind: "all_pushed", text: "all pushed", tone: "success", attention: false };
}

export function fetchedAgoText(lastFetchAt: string | null, now: string): string {
  if (!lastFetchAt) return "never fetched";
  const ms = Date.parse(now) - Date.parse(lastFetchAt);
  if (!Number.isFinite(ms)) return "never fetched";
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "fetched just now";
  if (minutes < 60) return `fetched ${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `fetched ${plural(hours, "hour")} ago`;
  return `fetched ${plural(Math.floor(hours / 24), "day")} ago`;
}

export interface HomeEntry {
  project: Project;
  state: RepoState | null;
  /** From the Run tab's last health check, when there was one. */
  healthFailing?: boolean;
}

export interface AttentionReason {
  kind: BadgeKind | "stale" | "health";
  text: string;
}

/** Why a project is in "Needs attention", or an empty list when it isn't. */
export function attentionReasons(entry: HomeEntry, now: string, staleDays: number): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const badge = projectBadge(entry.state);
  if (badge.attention) reasons.push({ kind: badge.kind, text: badge.text });
  if (entry.state?.isRepo) {
    const branch = currentBranch(entry.state);
    if (branch && isStale(branch.lastCommitAt, now, staleDays) && badge.kind !== "all_pushed") {
      reasons.push({ kind: "stale", text: `no commits for ${staleDays}+ days` });
    }
  }
  if (entry.healthFailing) reasons.push({ kind: "health", text: "health check failing" });
  return reasons;
}

export type HomeSection = "attention" | "favourites" | "all";

export interface HomeGroup {
  section: HomeSection;
  entries: HomeEntry[];
}

export type HomeSort = "activity" | "name";

function activityOf(project: Project): number {
  const t = Date.parse(project.lastActivityAt ?? project.lastOpenedAt ?? project.updatedAt);
  return Number.isFinite(t) ? t : 0;
}

/** Needs attention first, then favourites and pinned, then the rest; archived projects never appear. */
export function groupForHome(entries: readonly HomeEntry[], options: { now: string; staleDays: number; sort: HomeSort }): HomeGroup[] {
  const live = entries.filter((e) => e.project.archivedAt === null);
  const compare = (a: HomeEntry, b: HomeEntry): number =>
    options.sort === "name"
      ? a.project.name.localeCompare(b.project.name, undefined, { sensitivity: "base" })
      : activityOf(b.project) - activityOf(a.project) || a.project.name.localeCompare(b.project.name);
  const attention: HomeEntry[] = [];
  const favourites: HomeEntry[] = [];
  const rest: HomeEntry[] = [];
  for (const entry of live) {
    if (attentionReasons(entry, options.now, options.staleDays).length > 0) attention.push(entry);
    else if (entry.project.favourite || entry.project.pinned) favourites.push(entry);
    else rest.push(entry);
  }
  // Within each section, pinned projects lead.
  const sorted = (list: HomeEntry[]) =>
    list.sort((a, b) => Number(b.project.pinned) - Number(a.project.pinned) || compare(a, b));
  return [
    { section: "attention" as const, entries: sorted(attention) },
    { section: "favourites" as const, entries: sorted(favourites) },
    { section: "all" as const, entries: sorted(rest) }
  ].filter((group) => group.entries.length > 0);
}
