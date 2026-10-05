// Today, rendered.
//
// The real TodayView.tsx is bundled with the app's own Vite (SSR build, React
// external) and rendered with react-dom/server, once per state, from synthetic
// data. No Electron, no main process, no data root. Effects do not run under
// server rendering, which lets the `initial` prop pin each state.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const readSource = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
let scratch = "";
let View;

before(async () => {
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "today-view-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: join(desktop, "src/renderer/views/TodayView.tsx"),
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"], output: { format: "es", entryFileNames: "view.mjs" } }
    }
  });
  ({ TodayView: View } = await import(pathToFileURL(join(scratch, "view.mjs")).href));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const never = () => new Promise(() => {});
const bridge = { devIntelligenceStatus: never, devIntelligenceSettings: never, devIntelligenceUpdateSettings: never, devIntelligenceRepositories: never, standupLatest: never };
const onAction = async () => ({ ok: true });
const render = (initial) => renderToStaticMarkup(createElement(View, { bridge, onAction, ...(initial ? { initial } : {}) }));

const T = "2026-06-30T08:40:00.000Z";
const on = { enabled: true, scanning: false, repositories: 2 };
const repositories = [
  { schemaVersion: 1, id: "a", roots: [{ path: "D:/code/zephyr", domain: "windows" }], discoveredAt: T, lastSeenAt: T },
  { schemaVersion: 1, id: "b", roots: [{ path: "D:/code/api-gateway", domain: "windows" }], discoveredAt: T, lastSeenAt: T }
];
const candidates = [
  { repositoryId: "a", rank: 0, reason: "Most recently active repository with six uncommitted changes.", evidence: [] },
  { repositoryId: "b", rank: 1, reason: "Two commits yesterday.", evidence: [] }
];
const report = (overrides = {}) => ({
  id: "r1",
  occurrenceId: "o1",
  triggerKind: "scheduled",
  generatedAt: T,
  schemaVersion: 1,
  timeWindow: { kind: "since_last_standup", from: "2026-06-29T09:12:00.000Z", to: T, timezone: "UTC" },
  continuationCandidates: candidates,
  items: [],
  sections: [
    { kind: "Continue", items: [], continuationCandidates: candidates },
    {
      kind: "Changed",
      items: [
        { id: "changed:commit:1", section: "Changed", title: "Fix token refresh race", repositoryId: "b", evidence: [{ kind: "commit", id: "1", observedAt: "2026-06-30T06:00:00.000Z" }] },
        { id: "changed:todo-resolved:2", section: "Changed", title: "Resolved FIXME: rounding", repositoryId: "a", evidence: [] }
      ]
    },
    {
      kind: "NeedsAttention",
      items: [{ id: "attention:NEW:x", section: "NeedsAttention", title: "[NEW] Health check failing: pnpm test", summary: "3 tests failed.", repositoryId: "b", lifecycle: "NEW", severity: "critical", evidence: [] }]
    },
    {
      kind: "RepositoryState",
      items: [
        { id: "state:a", section: "RepositoryState", title: "zephyr @ feat/sync", summary: "dirty=6, staged=0, conflicts=0, clean=false", repositoryId: "a", evidence: [] },
        { id: "state:b", section: "RepositoryState", title: "api-gateway @ main", summary: "dirty=0, staged=0, conflicts=0, clean=true", repositoryId: "b", evidence: [] }
      ]
    },
    { kind: "History", items: [{ id: "history:empty", section: "History", title: "No prior history", evidence: [] }] }
  ],
  ...overrides
});
const ready = { status: on, report: report(), repositories, projects: [{ id: "p1", name: "zephyr", path: "d:/code/zephyr", isRepo: true }] };

test("loading: the kit header in the Today accent, and a labelled loading state", () => {
  const html = render();
  assert.match(html, /<section class="view-stack today" style="--kit-accent:var\(--accent-today\)" aria-labelledby="today-title" aria-busy="true">/);
  assert.match(html, /<h1 id="today-title" class="kit-header__title">Today<\/h1>/);
  assert.match(html, /role="status"[^>]*>.*Reading your Standup/s);
  assert.doesNotMatch(html, /Scan now/, "no actions before it is known whether the module is on");
});

test("error: what failed, the raw reason, and a way to try again", () => {
  const html = render({ error: "database is locked" });
  assert.match(html, /role="alert"/);
  assert.match(html, /Today could not be read/);
  assert.match(html, /database is locked/);
  assert.match(html, /Try again/);
});

test("off: says what turning it on does, and lists the projects it will read - nothing to choose", () => {
  const projects = [
    { id: "p1", name: "Zephyr app", path: "D:/code/zephyr", isRepo: true },
    { id: "p2", name: "Portal", path: "E:/work/portal", isRepo: null },
    { id: "p3", name: "Docs", path: "D:/docs", isRepo: false }
  ];
  const html = render({ status: { enabled: false, scanning: false, repositories: 0 }, projects });
  assert.match(html, /Start your mornings here/);
  assert.match(html, /stays on this\s+computer/);
  assert.match(html, /never looks inside DexNest&#x27;s own data/);
  assert.match(html, /It reads your projects, from Projects/);
  assert.match(html, /<span class="today-setup__name">Zephyr app<\/span><span class="kit-tech">D:\/code\/zephyr<\/span>/);
  assert.match(html, /<span class="today-setup__name">Portal<\/span>/);
  assert.doesNotMatch(html, /today-setup__name">Docs</, "a folder that is not a repository is not read");
  assert.doesNotMatch(html, /type="checkbox"/, "Projects is the list; there is no second one to tick");
  assert.match(html, /Turn on and scan 2 projects/);
  assert.doesNotMatch(html, /kit-stat|kit-hero/);
});

test("off with no projects: points at Projects", () => {
  const html = render({ status: { enabled: false, scanning: false, repositories: 0 } });
  assert.match(html, /Add your projects first/);
  assert.match(html, />Open Projects<\/button>/);
  assert.doesNotMatch(html, /today-setup__name/);
});

test("on, no report yet: offers the scan, and shows why the last one failed", () => {
  const html = render({ status: { ...on, lastError: "git is not installed" } });
  assert.match(html, /No Standup yet/);
  assert.match(html, /Scan now/);
  assert.match(html, /role="alert"[^>]*>The last scan failed: git is not installed/);
  assert.match(render({ status: { ...on, scanning: true } }), /Reading your repositories…/);
});

test("ready: the hero is the top continuation, with its reason, folder and VS Code through Projects", () => {
  const html = render(ready);
  assert.match(html, /Since 29 Jun, 09:12 · written 30 Jun, 08:40/);
  assert.match(html, /<p class="kit-hero__eyebrow">Where you left off<\/p><h2 class="kit-hero__title">zephyr<\/h2>/);
  assert.match(html, /<p class="today-reason">Most recently active repository with six uncommitted changes\.<\/p>/);
  assert.match(html, /D:\/code\/zephyr/);
  assert.match(html, /Open in VS Code<\/button>/);
  // The second candidate is "also in motion", not a second hero.
  assert.equal((html.match(/class="kit-hero"/g) ?? []).length, 1);
  assert.match(html, /Also in motion[\s\S]*api-gateway[\s\S]*Two commits yesterday\./);
});

test("ready: without a matching project there is no VS Code button, only the way to Projects", () => {
  const html = render({ ...ready, projects: [] });
  assert.doesNotMatch(html, /Open in VS Code/);
  assert.match(html, />Open Projects<\/button>/);
});

test("ready: numbers first, then the report's sections with names, badges and plain words", () => {
  const html = render(ready);
  assert.match(html, /kit-stat__label">Repositories<\/p><\/div><p class="kit-stat__value">2</);
  assert.match(html, /kit-stat__label">Changes<\/p><\/div><p class="kit-stat__value">2</);
  assert.match(html, /kit-stat__label">Needs attention<\/p><\/div><p class="kit-stat__value">1<\/p><p class="kit-stat__foot"><span class="kit-stat__hint">1 new</);
  assert.match(html, /kit-stat__label">Uncommitted<\/p><\/div><p class="kit-stat__value">1<\/p><p class="kit-stat__foot"><span class="kit-stat__hint">1 clean</);
  // The lifecycle is a badge; the bracket is gone from the title.
  assert.match(html, /kit-row__title">Health check failing: pnpm test</);
  assert.doesNotMatch(html, /\[NEW\]/);
  assert.match(html, /kit-badge--error[^>]*>.*?NEW<\/span>/s);
  assert.match(html, /3 tests failed\. · api-gateway/);
  // A change says where and when.
  assert.match(html, /Fix token refresh race<\/span><span class="kit-row__meta">api-gateway · 30 Jun, 06:00</);
  // Repository state in words, never the engine's key=value line.
  assert.match(html, /zephyr @ feat\/sync<\/span><span class="kit-row__meta">6 uncommitted</);
  assert.match(html, /Nothing uncommitted/);
  assert.doesNotMatch(html, /dirty=/);
  assert.doesNotMatch(html, /No prior history/, "placeholder items are not rows");
});

test("ready with a quiet report: each section says so in its own words", () => {
  const quiet = report({
    continuationCandidates: [],
    sections: [
      { kind: "Continue", items: [] },
      { kind: "Changed", items: [{ id: "changed:no-activity", section: "Changed", title: "No activity in window", evidence: [] }] },
      { kind: "NeedsAttention", items: [{ id: "attention:none", section: "NeedsAttention", title: "No issues needing attention", evidence: [] }] },
      { kind: "RepositoryState", items: [{ id: "state:no-repos", section: "RepositoryState", title: "No repositories", evidence: [] }] },
      { kind: "History", items: [] }
    ]
  });
  const html = render({ status: { ...on, repositories: 0 }, report: quiet });
  assert.match(html, /kit-hero__title">Nothing in motion</);
  assert.match(html, /No commits, branch changes or TODO changes in this window\./);
  assert.match(html, /No failing health checks, conflicts or unfinished git operations\./);
  assert.match(html, /No repositories were found in the folders being watched\./);
  assert.match(html, /kit-stat__hint">all clear</);
});

test("ready: a long section shows its first rows and offers the rest", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `changed:commit:${i}`, section: "Changed", title: `Commit number ${i}`, evidence: [] }));
  const r = report();
  const html = render({ ...ready, report: { ...r, sections: r.sections.map((s) => (s.kind === "Changed" ? { ...s, items: many } : s)) } });
  assert.match(html, /Commit number 7</);
  assert.doesNotMatch(html, /Commit number 8</);
  assert.match(html, /aria-expanded="false"[^>]*>Show all 30 changes<\/button>/);
});

test("ready: a capped section shows its real total, and says what is not listed", () => {
  const shown = Array.from({ length: 5 }, (_, i) => ({ id: `changed:commit:${i}`, section: "Changed", title: `Commit number ${i}`, evidence: [] }));
  const r = report();
  const capped = { ...r, sections: r.sections.map((s) => (s.kind === "Changed" ? { ...s, items: [...shown, { id: "changed:overflow", section: "Changed", title: "37 more not shown", evidence: [] }] } : s)) };
  const html = render({ ...ready, report: capped });
  assert.match(html, /Changed since the last Standup<span class="kit-section-title__count">42<\/span>/);
  assert.match(html, /kit-stat__label">Changes<\/p><\/div><p class="kit-stat__value">42</, "the tile agrees with the heading");
  assert.match(html, /37 more changes are not listed: a Standup keeps the first 5\./);
  assert.doesNotMatch(html, /kit-row__title">37 more not shown/, "the overflow line is not a row");
});

test("ready: a push and a pull are rows of their own", () => {
  const r = report();
  const items = [
    { id: "changed:push:1", section: "Changed", title: "Pushed to origin/main", repositoryId: "a", evidence: [{ kind: "event", id: "1", observedAt: "2026-06-30T07:15:00.000Z" }] },
    { id: "changed:pull:2", section: "Changed", title: "Pulled into main", repositoryId: "b", evidence: [] }
  ];
  const html = render({ ...ready, report: { ...r, sections: r.sections.map((s) => (s.kind === "Changed" ? { ...s, items } : s)) } });
  assert.match(html, /lucide-arrow-up-from-line[\s\S]*?Pushed to origin\/main<\/span><span class="kit-row__meta">zephyr · 30 Jun, 07:15</);
  assert.match(html, /lucide-arrow-down-to-line[\s\S]*?Pulled into main</);
});

test("ready: names come from Projects, in the hero and on the repository rows", () => {
  const html = render({ ...ready, projects: [{ id: "p1", name: "Zephyr app", path: "D:/code/zephyr", isRepo: true }] });
  assert.match(html, /<h2 class="kit-hero__title">Zephyr app<\/h2>/);
  assert.match(html, /kit-row__title">Zephyr app @ feat\/sync</);
  assert.match(html, /kit-row__title">api-gateway @ main</, "not a project: the scan's own name");
});

test("ready: says what is watched; a folder set by hand can be dropped, a project is managed in Projects", () => {
  const watched = { roots: [{ path: "D:/code/zephyr", domain: "windows" }, { path: "F:/empty", domain: "windows" }], manualRepositories: [{ path: "D:/code/api-gateway", domain: "windows" }] };
  const html = render({ ...ready, watched });
  assert.match(html, /<h2 id="today-watching">Watching<\/h2>/);
  assert.match(html, /1 project and 2 other folders\. Projects are followed automatically/);
  assert.match(html, />Manage in Projects<\/button>/);
  // The project's own folder is not offered for removal; the two others are.
  assert.equal((html.match(/>Stop watching<\/button>/g) ?? []).length, 2);
  assert.match(html, /<span class="kit-tech">F:\/empty<\/span><\/span><span class="kit-row__meta">every repository inside</);
  assert.match(html, /<span class="kit-tech">D:\/code\/api-gateway<\/span><\/span><span class="kit-row__meta">this repository</);
  // And the one that found nothing is named.
  assert.match(html, /No repository was found in this watched folder: <span class="kit-tech">F:\/empty<\/span>/);

  const plain = render(ready);
  assert.match(plain, /1 project\. Projects are followed automatically/);
  assert.doesNotMatch(plain, /Stop watching|No repository was found/);
});

test("a stale report says so when the last scan failed", () => {
  assert.match(render({ ...ready, status: { ...on, lastError: "git timed out" } }), /role="alert"[^>]*>The last scan failed, so this may be out of date: git timed out/);
});

test("Today is routed, registered and opened by a logged action", () => {
  const meta = readSource(join(desktop, "src/renderer/lib/moduleMeta.ts"));
  assert.match(meta, /\{ id: "command"[^\n]*\n\s*\{ id: "today", label: "Today", accentClass: "accent-today", actionId: "standup\.open" \}/, "second in the rail: the morning screen sits under Command");
  assert.match(meta, /today: \{ icon: Sunrise, accent: "var\(--accent-today\)" \}/);
  const shell = readSource(join(desktop, "src/renderer/main.tsx"));
  assert.match(shell, /activeView === "today" && <TodayView bridge=\{getBridge\(\)\} onAction=\{\(actionId, params\) => runUiAction\(actionId, "module_ui", params \?\? \{\}\)\} \/>/);
  const registry = readSource(join(desktop, "../../packages/action-registry/src/index.ts"));
  assert.match(registry, /id: "standup\.open",[\s\S]{0,700}?handlerRef: "desktop\.view\.today",\n\s*allowedTriggers: \["command", "module_ui"\]/, "not phone- or Deck-exposed");
  assert.match(readSource(join(desktop, "src/main/main.ts")), /"standup\.open": \{ view: "today"/);
});

test("the view changes settings through the bridge and everything else through registered actions; tokens only, no timers", () => {
  const view = readSource(join(desktop, "src/renderer/views/TodayView.tsx"));
  const ids = [...view.matchAll(/run\("([a-z_.]+)"/g)].map((m) => m[1]);
  const registry = readSource(join(desktop, "../../packages/action-registry/src/index.ts"));
  assert.ok(ids.length >= 4);
  for (const id of new Set(ids)) assert.match(registry, new RegExp(`id: "${id.replace(/\./g, "\\.")}"`), `${id} is a registered action`);
  assert.doesNotMatch(view, /setInterval|setTimeout/, "nothing polls: idle CPU stays at zero");
  const css = readSource(join(desktop, "src/renderer/views/Today.css"));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "tokens only");
  assert.match(readSource(join(desktop, "src/main/devIntelligenceHost.ts")), /dev-intelligence-update-settings[\s\S]{0,300}?options\.audit\?\.\("Repository scan settings updated"/);
});

// --- the day on Today ---------------------------------------------------------------------

const agendaItem = (extra) => ({ id: "x", kind: "event", title: "x", startTime: null, endTime: null, allDay: false, source: { id: "dexnest.calendar", label: "Calendar" }, detail: null, needsAction: false, status: null, accent: null, ...extra });
const day = {
  agenda: {
    date: "2026-06-30",
    items: [
      agendaItem({ id: "event:1", title: "Dentist", startTime: "15:00" }),
      agendaItem({ id: "block:1", kind: "block", title: "Deep work", startTime: "09:00", endTime: "11:00", source: { id: "dexnest.timetable", label: "Timetable" }, status: "done" }),
      agendaItem({ id: "nudge:1", kind: "nudge", title: "Still lent out", detail: "Power bank is with Alex", needsAction: true, source: { id: "dexnest.nudges", label: "Nudge" } })
    ],
    counts: { events: 1, blocks: 1, nudges: 1, needsAction: 1 },
    generatedAt: T
  },
  objects: { summary: { items: [{ kind: "maintenance", objectId: "OBJ00001", scheduleId: "sch_1", status: { state: "overdue" } }], counts: { overdue: 1, dueSoon: 0, warrantyEnding: 0, lowStock: 0 } }, names: { OBJ00001: "Workshop printer", sch_1: "Replace nozzle" } },
  autopilot: { deliver: [], hold: [] },
  todos: [
    { repositoryId: "repo_zephyr", kind: "TODO", filePath: "src/router.ts", line: 12, text: "tidy the router" },
    { repositoryId: "repo_zephyr", kind: "FIXME", filePath: "src/api.ts", line: 3, text: "retry on 429" }
  ],
  standups: []
};

test("the day: what is planned and what needs you sit above the Standup, in one list each", () => {
  const html = render({ ...ready, day });
  assert.match(html, /<h[23][^>]*id="today-day-title"[^>]*>Your day</);
  assert.match(html, /1 event and 1 timetable block today/);
  assert.match(html, /Deep work/);
  assert.match(html, /Timetable · done/);
  assert.match(html, /<span class="technical">09:00 – 11:00<\/span>/);
  assert.match(html, /<h[23][^>]*id="today-needs-title"[^>]*>Needs you/);
  // ObjectOS's overdue maintenance and the reminder are in the same list, the more pressing first.
  assert.ok(html.indexOf("Replace nozzle is overdue") < html.indexOf("Still lent out"));
  assert.match(html, /Workshop printer/);
  assert.match(html, />ObjectOS<\/span>/);
  assert.match(html, />Reminder<\/span>/);
  assert.match(html, />Activity log<\/button>/, "the activity log is still one click away");
  assert.ok(html.indexOf("Your day") < html.indexOf("Where you left off"), "the day comes first");
});

test("the day: a quiet one says so, and is shown before the scan is even on", () => {
  const quiet = render({ ...ready, day: { agenda: null, objects: null, autopilot: null, todos: [], standups: [] } });
  assert.match(quiet, /Nothing planned today/);
  assert.match(quiet, /Nothing is waiting on you: no reminders due, no maintenance overdue, no Autopilot run asking\./);
  assert.doesNotMatch(quiet, /id="today-todos"|id="today-history"/, "no empty TODO or history cards");
  const off = render({ status: { enabled: false, scanning: false, repositories: 0 }, report: null, repositories: [], projects: [], day });
  assert.match(off, /Your day/);
  assert.match(off, /Replace nozzle is overdue/);
});

test("open TODOs can be seen: by project, each with its file and line", () => {
  const html = render({ ...ready, day });
  assert.match(html, /id="today-todos"/);
  assert.match(html, /<details class="today-todos"><summary>/);
  assert.match(html, /<span class="technical today-todos__place">src\/api\.ts:3<\/span><span>retry on 429<\/span>/);
  assert.ok(html.indexOf("src/api.ts:3") < html.indexOf("src/router.ts:12"), "by file, then line");
});

test("history: what was put right, and the Standups before this one", () => {
  const resolved = { id: "history:resolved:x", section: "History", title: "Resolved failing check", summary: "lint passes again", lifecycle: "RESOLVED", evidence: [], sortKey: "a" };
  const current = report({ sections: [...report().sections.filter((s) => s.kind !== "History"), { kind: "History", items: [resolved] }] });
  const earlier = report({ id: "rpt_earlier", generatedAt: "2026-06-29T08:00:00.000Z" });
  const html = render({ ...ready, report: current, day: { ...day, standups: [current, earlier] } });
  assert.match(html, /id="today-history"/);
  assert.match(html, /Resolved failing check/);
  assert.match(html, /lint passes again/);
  assert.match(html, /Earlier Standups/);
  assert.match(html, /29 Jun 2026, 08:00/);
});

test("the bell counts what needs you and opens Today; Calendar shows the day's timetable; a bill can go to the Calendar", () => {
  const shell = readSource(join(desktop, "src/renderer/main.tsx"));
  assert.match(shell, /setNeedsCount\(needsYou\(\{ agenda, objects, autopilot \}\)\.length\)/);
  assert.match(shell, /onClick=\{\(\) => void navigate\("today"\)\}/);
  assert.match(shell, /\}, \[activeView\]\);/, "read when the view changes, not on a timer");
  assert.match(shell, /timetableBlocksOn\(timetableBlocks, parseLocalDateInput\(selectedDate\)\)/);
  assert.match(shell, /onAction\("calendar\.create_event", "module_ui", recurringCalendarEvent\(r\)\)/);
  const preload = readSource(join(desktop, "src/main/preload.ts"));
  assert.match(preload, /getTodayAgenda: \(\) => ipcRenderer\.invoke\("dexnest:get-today-agenda"\)/);
});
