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
const ready = { status: on, report: report(), repositories, projects: [{ id: "p1", path: "d:/code/zephyr" }], importRoots: [] };

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

test("off: says what turning it on does, and offers Projects' folders as a checklist", () => {
  const html = render({ status: { enabled: false, scanning: false, repositories: 0 }, importRoots: ["D:/code"], projects: [{ id: "p1", path: "D:/code/zephyr" }, { id: "p2", path: "E:/work/portal" }] });
  assert.match(html, /Start your mornings here/);
  assert.match(html, /stays on this\s+computer/);
  assert.match(html, /never looks inside DexNest&#x27;s own data/);
  assert.match(html, /<legend>Folders to watch, from Projects<\/legend>/);
  assert.equal((html.match(/<input type="checkbox" checked=""/g) ?? []).length, 2, "the import folder, and the one project outside it");
  assert.match(html, /D:\/code<\/span><span class="today-setup__kind">every repository inside/);
  assert.match(html, /E:\/work\/portal<\/span><span class="today-setup__kind">this repository/);
  assert.match(html, /Turn on and scan 2 folders/);
  assert.doesNotMatch(html, /kit-stat|kit-hero/);
});

test("off with no projects: points at Projects instead of offering nothing to tick", () => {
  const html = render({ status: { enabled: false, scanning: false, repositories: 0 } });
  assert.match(html, /Add your projects first/);
  assert.match(html, />Open Projects<\/button>/);
  assert.doesNotMatch(html, /type="checkbox"/);
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

test("ready: a watched folder with no repository in it is named, quietly", () => {
  const watched = { roots: [{ path: "D:/code", domain: "windows" }, { path: "F:/empty", domain: "windows" }], manualRepositories: [] };
  const html = render({ ...ready, watched });
  assert.match(html, /<p class="today-note">No repository was found in this watched folder: <span class="kit-tech">F:\/empty<\/span><\/p>/);
  assert.doesNotMatch(render({ ...ready, watched: { roots: [{ path: "D:/code", domain: "windows" }], manualRepositories: [] } }), /today-note/);
  assert.doesNotMatch(render(ready), /today-note/);
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
  assert.match(readSource(join(desktop, "src/main/devIntelligenceHost.ts")), /dev-intelligence-update-settings[\s\S]{0,300}?options\.audit\?\.\("Developer Intelligence settings updated"/);
});
