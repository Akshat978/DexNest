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
  extraFolderKind,
  extraFolders,
  lifecycleTone,
  parseRepoState,
  projectIdForPath,
  repoLabels,
  repoName,
  repoStateBadge,
  repoStateLine,
  repoStateTitle,
  sectionItems,
  sectionOmitted,
  sectionTotal,
  settingsWithout,
  todayStats,
  viewState,
  watchedProjects,
  watchingLine,
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

test("a repository that is a project is called what Projects calls it, on every row", () => {
  const repos = [repo("a", "D:\\DeskNest", "DeskNest"), repo("b", "D:\\code\\notes")];
  const labels = repoLabels(repos, [{ name: "dexnest", path: "d:/desknest/" }]);
  assert.equal(repoName(labels, "a"), "dexnest", "the project's name, not the folder's");
  assert.equal(repoName(labels, "b"), "notes", "not a project: the scan's name");
  assert.equal(repoStateTitle(item("state:a", "RepositoryState", { title: "DeskNest @ feat/x", repositoryId: "a" }), labels), "dexnest @ feat/x");
  assert.equal(repoStateTitle(item("state:b", "RepositoryState", { title: "notes @ main", repositoryId: "b" }), labels), "notes @ main");
  assert.equal(repoStateTitle(item("state:c:error", "RepositoryState", { title: "gone: facts unavailable", repositoryId: "zzz" }), labels), "gone: facts unavailable");
  // A project record without a name (older data) falls back instead of throwing.
  assert.equal(repoName(repoLabels(repos, [{ path: "D:\\DeskNest" } as { name: string; path: string }]), "a"), "DeskNest");
});

test("what is watched: Projects' repositories, and any folder set by hand that is not one of them", () => {
  const projects = [
    { id: "p1", name: "dexnest", path: "D:\\DeskNest", isRepo: true },
    { id: "p2", name: "notes", path: "D:\\code\\notes", isRepo: null },
    { id: "p3", name: "docs", path: "D:\\docs", isRepo: false },
    { id: "p4", name: "blank", path: " ", isRepo: true }
  ];
  assert.deepEqual(watchedProjects(projects), [
    { id: "p1", name: "dexnest", path: "D:\\DeskNest" },
    { id: "p2", name: "notes", path: "D:\\code\\notes" }
  ], "a folder that is not a Git repository is not scanned; one not yet checked is");

  const settings = {
    roots: [{ path: "d:/desknest/", domain: "windows" as const }, { path: "F:\\src", domain: "windows" as const }],
    manualRepositories: [{ path: "D:\\code\\notes", domain: "windows" as const }, { path: "E:\\old\\tool", domain: "windows" as const }, { path: "f:/src", domain: "windows" as const }]
  };
  const extras = extraFolders(settings, projects);
  assert.deepEqual(extras, [
    { path: "F:\\src", kind: "root" },
    { path: "E:\\old\\tool", kind: "repository" }
  ], "a folder that is a project is not an extra, and one listed twice appears once");
  assert.deepEqual(extras.map(extraFolderKind), ["every repository inside", "this repository"]);
  assert.deepEqual(extraFolders(null, projects), []);
});

test("an extra folder that yielded no repository is named", () => {
  const repos = [repo("a", "F:\\src\\tool"), repo("b", "E:\\work\\portal")];
  const extras = [
    { path: "F:\\src", kind: "root" as const },
    { path: "e:/work/portal/", kind: "repository" as const },
    { path: "F:\\srcx", kind: "root" as const }
  ];
  assert.deepEqual(emptyWatchedFolders(extras, repos), ["F:\\srcx"], "a folder merely sharing a prefix is not a match");
  assert.deepEqual(emptyWatchedFolders([], repos), []);
});

test("stop watching removes the folder wherever it is listed, and nothing else", () => {
  const current: TodaySettings = {
    schemaVersion: 1,
    enabled: true,
    roots: [{ path: "F:\\src", domain: "windows" }, { path: "D:\\code", domain: "windows" }],
    manualRepositories: [{ path: "f:/src/", domain: "windows" }, { path: "E:\\old", domain: "windows" }],
    excludedRoots: ["D:\\code\\tmp"],
    scanIntervalMinutes: 45,
    runHealthChecks: false
  };
  const next = settingsWithout(current, "F:/src");
  assert.deepEqual(next.roots, [{ path: "D:\\code", domain: "windows" }]);
  assert.deepEqual(next.manualRepositories, [{ path: "E:\\old", domain: "windows" }]);
  assert.deepEqual([next.enabled, next.excludedRoots, next.scanIntervalMinutes, next.runHealthChecks], [true, ["D:\\code\\tmp"], 45, false]);
  assert.equal(current.roots.length, 2, "the settings read from disk are not changed in place");
});

test("the watching line counts projects and other folders in words", () => {
  assert.equal(watchingLine(8, 0), "8 projects");
  assert.equal(watchingLine(1, 0), "1 project");
  assert.equal(watchingLine(1, 2), "1 project and 2 other folders");
  assert.equal(watchingLine(3, 1), "3 projects and 1 other folder");
  assert.equal(watchingLine(0, 2), "2 folders");
  assert.equal(watchingLine(0, 0), "0 projects");
});

test("times are shown in the report's own timezone", () => {
  assert.equal(whenLabel("2026-06-30T08:40:00.000Z", "UTC"), "30 Jun, 08:40");
  assert.equal(whenLabel("2026-06-30T08:40:00.000Z", "Asia/Kolkata"), "30 Jun, 14:10");
  assert.equal(whenLabel("not a date", "UTC"), "");
  assert.equal(whenLabel(null), "");
  assert.equal(windowLine(report({})), "Since 29 Jun, 09:12 · written 30 Jun, 08:40");
});

// --- the day: one agenda, one list of what needs you ------------------------------------

test("the day: events and timetable blocks in one list, each saying when and from where", async () => {
  const { dayLine, dayRows } = await import("../src/renderer/views/todayDayModel.ts");
  const item = (extra: Record<string, unknown>) => ({ id: "x", kind: "event", title: "x", startTime: null, endTime: null, allDay: false, source: { id: "dexnest.calendar", label: "Calendar" }, detail: null, needsAction: false, status: null, accent: null, ...extra });
  const agenda = {
    items: [
      item({ id: "event:1", title: "Birthday", allDay: true }),
      item({ id: "block:1", kind: "block", title: "Deep work", startTime: "09:00", endTime: "11:00", source: { id: "dexnest.timetable", label: "Timetable" }, status: "done" }),
      item({ id: "event:2", title: "Dentist", startTime: "15:00" }),
      item({ id: "block:2", kind: "block", title: "Gym", startTime: "18:00", endTime: "19:00", source: { id: "dexnest.timetable", label: "Timetable" }, status: "planned" }),
      item({ id: "nudge:1", kind: "nudge", title: "Back up", needsAction: true })
    ],
    counts: { events: 2, blocks: 2, nudges: 1, needsAction: 1 }
  } as never;
  assert.deepEqual(dayRows(agenda).map((r) => [r.title, r.time, r.meta, r.done]), [
    ["Birthday", "all day", "Calendar", false],
    ["Deep work", "09:00 – 11:00", "Timetable · done", true],
    ["Dentist", "15:00", "Calendar", false],
    ["Gym", "18:00 – 19:00", "Timetable", false]
  ]);
  assert.equal(dayLine(agenda), "2 events and 2 timetable blocks today");
  assert.equal(dayLine({ counts: { events: 1, blocks: 0, nudges: 0, needsAction: 0 } }), "1 event today");
  assert.equal(dayLine(null), "Nothing planned today");
  assert.deepEqual(dayRows(null), []);
});

test("needs you: reminders, ObjectOS and Autopilot in one list, most pressing first", async () => {
  const { bellBadge, needsYou } = await import("../src/renderer/views/todayDayModel.ts");
  const nudge = (id: string, title: string, needsAction: boolean) => ({ id, kind: "nudge", title, startTime: null, endTime: null, allDay: false, source: { id: "dexnest.nudges", label: "Nudge" }, detail: "since March", needsAction, status: "open", accent: null });
  const list = needsYou({
    agenda: { items: [nudge("nudge:1", "Still lent out", true), nudge("nudge:2", "Snoozed thing", false)] } as never,
    objects: {
      summary: {
        items: [
          { kind: "stock", partId: "prt_1", quantity: 1, lowStockAt: 2 },
          { kind: "warranty", objectId: "OBJ00001", state: "ending", daysLeft: 12 },
          { kind: "maintenance", objectId: "OBJ00001", scheduleId: "sch_1", status: { state: "overdue" } },
          { kind: "maintenance", objectId: "OBJ00001", scheduleId: "sch_2", status: { state: "due_soon" } }
        ]
      },
      names: { OBJ00001: "Workshop printer", sch_1: "Replace nozzle", sch_2: "Oil rails", prt_1: "0.4 nozzle" }
    },
    autopilot: { deliver: [{ id: "a1", title: "A run is waiting for an answer", detail: "dermassist" }], hold: [{ id: "a2", title: "held, not shown", detail: "" }] }
  });
  assert.deepEqual(list.map((i) => [i.source, i.title, i.detail, i.tone, i.view]), [
    ["Autopilot", "A run is waiting for an answer", "dermassist", "error", "autopilot"],
    ["ObjectOS", "Replace nozzle is overdue", "Workshop printer", "error", "object"],
    ["ObjectOS", "Warranty ends in 12 days", "Workshop printer", "warning", "object"],
    ["ObjectOS", "Oil rails is due soon", "Workshop printer", "warning", "object"],
    ["ObjectOS", "0.4 nozzle is low", "1 left", "info", "object"],
    ["Reminder", "Still lent out", "since March", "info", "calendar"]
  ]);
  assert.deepEqual(needsYou({ agenda: null, objects: null, autopilot: null }), []);
  assert.deepEqual([0, 1, 9, 10, 42].map(bellBadge), [null, "1", "9", "9+", "9+"]);
});

test("open TODOs by project, and earlier Standups", async () => {
  const { earlierStandups, resolvedSince, todoGroups, todoPlace } = await import("../src/renderer/views/todayDayModel.ts");
  const todo = (repositoryId: string, filePath: string, line: number | undefined, text: string) => ({ repositoryId, kind: "TODO", filePath, ...(line !== undefined ? { line } : {}), text });
  const groups = todoGroups([todo("r1", "src/b.ts", 9, "later"), todo("r2", "x.py", 1, "one"), todo("r1", "src/a.ts", 40, "split"), todo("r1", "src/a.ts", 3, "rename")], (id) => (id === "r1" ? "DexNest" : "calc"));
  assert.deepEqual(groups.map((g) => [g.name, g.todos.map(todoPlace)]), [["DexNest", ["src/a.ts:3", "src/a.ts:40", "src/b.ts:9"]], ["calc", ["x.py:1"]]]);
  assert.equal(todoPlace({ filePath: "README.md" }), "README.md");
  assert.deepEqual(todoGroups([], () => ""), []);

  const report = (id: string, generatedAt: string, changed: number, attention: number, history: unknown[] = []) => ({
    id, generatedAt,
    sections: [
      { kind: "Changed", items: Array.from({ length: changed }, (_, i) => ({ id: `c${i}`, section: "Changed", title: "c" })) },
      { kind: "NeedsAttention", items: Array.from({ length: attention }, (_, i) => ({ id: `n${i}`, section: "NeedsAttention", title: "n" })) },
      { kind: "History", items: history }
    ]
  }) as never;
  const now = report("r3", "2026-10-03T08:00:00.000Z", 4, 0, [
    { id: "history:resolved:x", section: "History", title: "Resolved failing check", summary: "lint passes again", lifecycle: "RESOLVED" },
    { id: "history:prev:r2", section: "History", title: "Previous report r2", summary: "..." }
  ]);
  assert.deepEqual(earlierStandups([report("r1", "2026-10-01T08:00:00.000Z", 1, 2), now, report("r2", "2026-10-02T08:00:00.000Z", 12, 0)], "r3").map((s) => [s.id, s.line]), [
    ["r2", "12 changes · nothing needed attention"],
    ["r1", "1 change · 2 needed attention"]
  ]);
  assert.deepEqual(resolvedSince(now), [{ id: "history:resolved:x", title: "Resolved failing check", summary: "lint passes again" }]);
  assert.deepEqual(resolvedSince(null), []);
});
