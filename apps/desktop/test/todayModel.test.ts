/** Today's reading of a Standup report, without React. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Repository, StandupItem, StandupReport } from "@dexnest/dev-intelligence-contracts";
import {
  attentionTitle,
  changeKind,
  changeTitle,
  continuations,
  emptyWatchedFolders,
  lifecycleTone,
  parseRepoState,
  projectIdForPath,
  repoLabels,
  repoName,
  repoStateBadge,
  repoStateLine,
  sectionItems,
  sectionOmitted,
  sectionTotal,
  settingsWithFolders,
  setupFolders,
  todayStats,
  viewState,
  whenLabel,
  windowLine,
  type TodaySettings
} from "../src/renderer/views/todayModel.ts";

const T = "2026-06-30T08:40:00.000Z";
const item = (id: string, section: StandupItem["section"], extra: Partial<StandupItem> = {}): StandupItem => ({ id, section, title: id, evidence: [], ...extra });

function report(sections: Partial<Record<StandupItem["section"], StandupItem[]>>, extra: Partial<StandupReport> = {}): StandupReport {
  const kinds = ["Continue", "Changed", "NeedsAttention", "RepositoryState", "History"] as const;
  return {
    id: "r1",
    occurrenceId: "o1",
    triggerKind: "scheduled",
    generatedAt: T,
    timeWindow: { kind: "since_last_standup", from: "2026-06-29T09:12:00.000Z", to: T, timezone: "UTC" },
    schemaVersion: 1,
    sections: kinds.map((kind) => ({ kind, items: sections[kind] ?? [] })),
    items: [],
    ...extra
  };
}

const repo = (id: string, path: string, displayName?: string): Repository => ({ schemaVersion: 1, id, roots: [{ path, domain: "windows" }], ...(displayName ? { displayName } : {}), discoveredAt: T, lastSeenAt: T });
const status = { enabled: true, scanning: false, repositories: 3 };

test("the state follows what is on, and whether a report exists", () => {
  assert.equal(viewState({ loading: true, error: null, status: null, report: null }), "loading");
  assert.equal(viewState({ loading: false, error: "locked", status, report: null }), "error");
  assert.equal(viewState({ loading: false, error: null, status: { ...status, enabled: false }, report: report({}) }), "off");
  assert.equal(viewState({ loading: false, error: null, status, report: null }), "waiting");
  assert.equal(viewState({ loading: false, error: null, status, report: report({}) }), "ready");
  assert.equal(viewState({ loading: true, error: null, status, report: report({}) }), "ready", "a reload keeps the report on screen");
});

test("a repository is named by its display name, then its folder, then its id", () => {
  const labels = repoLabels([repo("a", "D:\\code\\zephyr", "Zephyr"), repo("b", "D:\\code\\api-gateway\\"), { ...repo("c", ""), roots: [] }]);
  assert.equal(repoName(labels, "a"), "Zephyr");
  assert.equal(repoName(labels, "b"), "api-gateway");
  assert.equal(repoName(labels, "c"), "c");
  assert.equal(repoName(labels, "unknown"), "unknown");
  assert.equal(repoName(labels, undefined), null);
});

test("a repository's Projects entry is found by folder, whatever the slashes or case", () => {
  const projects = [{ id: "p1", path: "d:/Code/Zephyr/" }];
  assert.equal(projectIdForPath(projects, "D:\\code\\zephyr"), "p1");
  assert.equal(projectIdForPath(projects, "D:\\code\\zephyr-2"), null);
  assert.equal(projectIdForPath(projects, null), null);
});

test("the engine's placeholder items are left out, so a section can be empty", () => {
  const r = report({
    Changed: [item("changed:no-activity", "Changed")],
    NeedsAttention: [item("attention:none", "NeedsAttention")],
    RepositoryState: [item("state:no-repos", "RepositoryState")],
    History: [item("history:empty", "History")]
  });
  for (const kind of ["Changed", "NeedsAttention", "RepositoryState", "History"] as const) assert.deepEqual(sectionItems(r, kind), [], kind);
  assert.equal(sectionItems(report({ Changed: [item("changed:commit:1", "Changed")] }), "Changed").length, 1);
});

test("continuations keep the engine's ranking and carry names and folders", () => {
  const labels = repoLabels([repo("a", "D:\\code\\zephyr"), repo("b", "D:\\code\\notes")]);
  const r = report({}, { continuationCandidates: [{ repositoryId: "b", rank: 1, reason: "second", evidence: [] }, { repositoryId: "a", rank: 0, reason: "first", evidence: [] }] });
  assert.deepEqual(continuations(r, labels), [
    { repositoryId: "a", name: "zephyr", path: "D:\\code\\zephyr", reason: "first" },
    { repositoryId: "b", name: "notes", path: "D:\\code\\notes", reason: "second" }
  ]);
  assert.deepEqual(continuations(report({}), labels), []);
});

test("a change's kind comes from its id; an issue's title loses its bracket", () => {
  assert.equal(changeKind(item("changed:commit:1", "Changed")), "commit");
  assert.equal(changeKind(item("changed:push:1", "Changed")), "push");
  assert.equal(changeKind(item("changed:pull:1", "Changed")), "pull");
  assert.equal(changeKind(item("changed:branch:1", "Changed")), "branch");
  assert.equal(changeKind(item("changed:todo-new:1", "Changed")), "todo-new");
  assert.equal(changeKind(item("changed:todo-resolved:1", "Changed")), "todo-resolved");
  assert.equal(changeKind(item("changed:overflow", "Changed")), "other");
  assert.equal(changeTitle(item("x", "Changed", { title: "Branch ? → main" })), "First seen on main", "a first sighting is not a switch");
  assert.equal(changeTitle(item("x", "Changed", { title: "Branch main → feat/sync" })), "Branch main → feat/sync");
  assert.equal(attentionTitle(item("x", "NeedsAttention", { title: "[ONGOING] Merge in progress" })), "Merge in progress");
  assert.equal(attentionTitle(item("x", "NeedsAttention", { title: "[draft] note" })), "[draft] note");
  assert.deepEqual(["NEW", "ONGOING", "RESOLVED", undefined].map(lifecycleTone), ["error", "warning", "success", "neutral"]);
});

test("working-tree state is read from the engine's line, and shown as written when it is something else", () => {
  assert.deepEqual(parseRepoState("dirty=3, staged=1, conflicts=0, clean=false"), { dirty: 3, staged: 1, conflicts: 0, clean: false });
  assert.equal(parseRepoState("Load failure"), null);
  assert.equal(repoStateLine("dirty=0, staged=0, conflicts=0, clean=true"), "Nothing uncommitted");
  assert.equal(repoStateLine("dirty=3, staged=1, conflicts=0, clean=false"), "3 uncommitted · 1 staged");
  assert.equal(repoStateLine("dirty=1, staged=0, conflicts=2, clean=false"), "2 conflicts · 1 uncommitted");
  assert.equal(repoStateLine("Load failure"), "Load failure");
  const badge = (summary: string) => repoStateBadge(item("s", "RepositoryState", { summary })).label;
  assert.equal(badge("dirty=0, staged=0, conflicts=0, clean=true"), "Clean");
  assert.equal(badge("dirty=0, staged=2, conflicts=0, clean=false"), "Changes");
  assert.equal(badge("dirty=1, staged=0, conflicts=1, clean=false"), "Conflicts");
  assert.equal(badge("Load failure"), "Unavailable");
});

test("the numbers: resolved issues and overflow lines are not counted", () => {
  const r = report({
    Changed: [item("changed:commit:1", "Changed"), item("changed:branch:2", "Changed"), item("changed:overflow", "Changed")],
    NeedsAttention: [
      item("attention:NEW:a", "NeedsAttention", { lifecycle: "NEW" }),
      item("attention:ONGOING:b", "NeedsAttention", { lifecycle: "ONGOING" }),
      item("attention:RESOLVED:c", "NeedsAttention", { lifecycle: "RESOLVED" })
    ],
    RepositoryState: [
      item("state:a", "RepositoryState", { summary: "dirty=3, staged=0, conflicts=0, clean=false" }),
      item("state:b", "RepositoryState", { summary: "dirty=0, staged=0, conflicts=0, clean=true" }),
      item("state:c:error", "RepositoryState", { summary: "Load failure" })
    ]
  });
  assert.deepEqual(todayStats(r, status), { repositories: 3, changes: 2, attention: 2, newIssues: 1, uncommitted: 1, clean: 1 });
  assert.equal(todayStats(r, null).repositories, 2, "without a status, the repositories the report could read");
});

test("a capped section: the overflow line is a count, not a row, and the total includes it", () => {
  const shown = Array.from({ length: 50 }, (_, i) => item(`changed:commit:${i}`, "Changed"));
  const capped = report({ Changed: [...shown, item("changed:overflow", "Changed", { title: "37 more not shown" })] });
  assert.equal(sectionItems(capped, "Changed").length, 50, "the overflow line is not an item");
  assert.equal(sectionOmitted(capped, "Changed"), 37);
  assert.equal(sectionTotal(capped, "Changed"), 87);
  assert.equal(todayStats(capped, status).changes, 87, "the tile and the heading show the same, real number");
  // The wording older reports used.
  assert.equal(sectionOmitted(report({ Changed: [item("changed:overflow", "Changed", { title: "4 more item(s) omitted" })] }), "Changed"), 4);
  assert.equal(sectionOmitted(report({ Changed: shown }), "Changed"), 0);
  assert.equal(sectionTotal(report({ Changed: [item("changed:no-activity", "Changed")] }), "Changed"), 0);
});

test("a watched folder that yielded no repository is named", () => {
  const repos = [repo("a", "D:\\code\\zephyr"), repo("b", "E:\\work\\portal")];
  const watched = {
    roots: [{ path: "D:\\code", domain: "windows" as const }, { path: "F:\\empty", domain: "windows" as const }],
    // Found whatever the slashes or case; a folder merely sharing a prefix ("D:\code" vs "D:\codex") is not a match.
    manualRepositories: [{ path: "e:/work/portal/", domain: "windows" as const }, { path: "D:\\codex", domain: "windows" as const }]
  };
  assert.deepEqual(emptyWatchedFolders(watched, repos), ["F:\\empty", "D:\\codex"]);
  assert.deepEqual(emptyWatchedFolders(null, repos), []);
  assert.deepEqual(emptyWatchedFolders({ roots: [], manualRepositories: [] }, []), []);
});

test("times are shown in the report's own timezone", () => {
  assert.equal(whenLabel("2026-06-30T08:40:00.000Z", "UTC"), "30 Jun, 08:40");
  assert.equal(whenLabel("2026-06-30T08:40:00.000Z", "Asia/Kolkata"), "30 Jun, 14:10");
  assert.equal(whenLabel("not a date", "UTC"), "");
  assert.equal(whenLabel(null), "");
  assert.equal(windowLine(report({})), "Since 29 Jun, 09:12 · written 30 Jun, 08:40");
});

test("setup offers Projects' import folders, and any project outside them, once each", () => {
  const folders = setupFolders(["D:\\code"], [{ path: "D:\\code\\zephyr" }, { path: "E:\\work\\portal" }, { path: "e:/work/portal/" }, { path: "D:\\codex" }]);
  assert.deepEqual(folders, [
    { path: "D:\\code", kind: "root" },
    { path: "E:\\work\\portal", kind: "repository" },
    { path: "D:\\codex", kind: "repository" }
  ]);
  assert.deepEqual(setupFolders([], []), []);
});

test("turning on adds the chosen folders and keeps everything already configured", () => {
  const current: TodaySettings = { schemaVersion: 1, enabled: false, roots: [{ path: "D:\\code", domain: "windows" }], manualRepositories: [], excludedRoots: ["D:\\code\\tmp"], scanIntervalMinutes: 45, runHealthChecks: false };
  const next = settingsWithFolders(current, [{ path: "d:/code/", kind: "root" }, { path: "F:\\src", kind: "root" }, { path: "E:\\work\\portal", kind: "repository" }]);
  assert.equal(next.enabled, true);
  assert.deepEqual(next.roots, [{ path: "D:\\code", domain: "windows" }, { path: "F:\\src", domain: "windows" }]);
  assert.deepEqual(next.manualRepositories, [{ path: "E:\\work\\portal", domain: "windows" }]);
  assert.deepEqual([next.excludedRoots, next.scanIntervalMinutes, next.runHealthChecks], [["D:\\code\\tmp"], 45, false]);
  assert.equal(current.enabled, false, "the settings read from disk are not changed in place");
});
