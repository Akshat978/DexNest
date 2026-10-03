// GhostOS view, rendered.
//
// The real GhostOsView.tsx is bundled with the app's own Vite (SSR build,
// React external) and rendered with react-dom/server, once per state, from
// synthetic data. No Electron, no main process, no data root. Effects do not
// run under server rendering, which lets the `initial` prop pin each state.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const desktop = fileURLToPath(new URL("..", import.meta.url));
let scratch = "";
let View;

before(async () => {
  // Inside the app's node_modules so the bundle resolves the app's React.
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "ghost-view-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: join(desktop, "src/renderer/views/GhostOsView.tsx"),
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"], output: { format: "es", entryFileNames: "view.mjs" } }
    }
  });
  ({ GhostOsView: View } = await import(pathToFileURL(join(scratch, "view.mjs")).href));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const never = () => new Promise(() => {});
const bridge = { ghostOsStatus: never, ghostOsTimeline: never, ghostOsSearch: never, ghostOsEntity: never, ghostOsSettings: never, ghostOsUpdateSettings: never };
const onAction = async () => ({ ok: true });
const T = "2026-06-01T09:00:00.000Z";

const zero = { entity: 0, relation: 0, observation: 0 };
const di = (enabled, installed = true) => ({ id: "developer_intelligence", enabled, cursor: null, lastSyncAt: enabled ? "2026-06-30T12:00:00.000Z" : null, counts: enabled ? { entity: 3, relation: 2, observation: 5 } : zero, installed });
const status = (counts, adapter = di(false)) => ({ adapters: [adapter], syncing: false, lastRun: null, lastError: null, searchMode: "fts", counts });
const empty = status(zero);
const full = status({ entity: 3, relation: 2, observation: 5 }, di(true));

const manual = { origin: "manual", sourceId: null, sourceRef: null, evidence: [{ kind: "manual" }], confidence: 1 };
const fromDi = (ref, evidence, confidence) => ({ origin: "adapter", sourceId: "adapter:developer_intelligence", sourceRef: ref, evidence, confidence });
const project = {
  id: "ent_proj0001", type: "project", title: "Zephyr app", notes: "The tracker.", tags: ["work"], details: {}, occurredAt: null, startedAt: null, endedAt: null,
  provenance: fromDi("repo:r1", [{ kind: "repository", repositoryId: "repo-app" }], 1), createdAt: T, updatedAt: T
};
const detail = {
  entity: project,
  relations: [
    { relation: { id: "rel_uses0001", fromId: project.id, toId: "ent_skill001", type: "uses", strength: 1, validFrom: T, validTo: null, notes: "", provenance: fromDi("uses:r1:ts", [{ kind: "technology", factId: "f1", repositoryId: "repo-app", evidencePath: "package.json", evidenceKind: "package.json" }], 0.9), createdAt: T, updatedAt: T }, direction: "out", other: { id: "ent_skill001", type: "skill", title: "TypeScript" } },
    { relation: { id: "rel_mine0001", fromId: "ent_me000001", toId: project.id, type: "worked_on", strength: 1, validFrom: null, validTo: "2026-05-01T00:00:00.000Z", notes: "", provenance: manual, createdAt: T, updatedAt: T }, direction: "in", other: { id: "ent_me000001", type: "person", title: "Me" } }
  ],
  observations: [
    { id: "obs_day00001", entityId: project.id, statement: "2 commits observed", observedAt: T, provenance: fromDi("day:r1:2026-06-01", [{ kind: "commit", repositoryId: "repo-app", sha: "abcdef1234", at: T }, { kind: "commit", repositoryId: "repo-app", sha: "1234567abc", at: T }], 0.6), createdAt: T },
    { id: "obs_note0001", entityId: project.id, statement: "shipped v1", observedAt: T, provenance: manual, createdAt: T }
  ],
  derivedFrom: []
};
const items = [
  { kind: "observation", id: "obs_day00001", at: T, entityId: project.id, entityType: "project", title: "Zephyr app", statement: "2 commits observed", origin: "adapter", confidence: 0.6 },
  { kind: "entity", id: "ent_me000001", at: T, entityId: "ent_me000001", entityType: "person", title: "Me", statement: null, origin: "manual", confidence: 1 },
  { kind: "entity", id: project.id, at: T, entityId: project.id, entityType: "project", title: "Zephyr app", statement: null, origin: "adapter", confidence: 1 },
  { kind: "relation", id: "rel_ended001", at: "2026-05-01T00:00:00.000Z", entityId: project.id, entityType: "project", title: "Zephyr app", statement: "uses Go", origin: "adapter", confidence: 0.9 }
];

const render = (props) => renderToStaticMarkup(createElement(View, { bridge, onAction, ...props }));

test("loading: a status, busy, no controls yet", () => {
  const html = render({});
  assert.match(html, /role="status"[^>]*>(?:<[^>]+>)*Loading GhostOS…/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /role="tablist"/);
});

test("error: an alert with the reason and a retry", () => {
  const html = render({ initial: { status: null, error: "database is locked" } });
  assert.match(html, /role="alert"/);
  assert.match(html, /database is locked/);
  assert.match(html, />Try again</);
});

test("empty: says what GhostOS is, what it never reads, and still offers every section", () => {
  const html = render({ initial: { status: empty } });
  assert.match(html, /Every fact says where it came from and how sure it is/);
  assert.match(html, /never reads your vault, finance, journal, clipboard, captures or chat histories/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /Nothing on the timeline/);
  assert.doesNotMatch(html, />Sync now</, "no sync while no source is on");
});

test("tabs: one tab stop, the selected tab controls a labelled panel", () => {
  const html = render({ initial: { status: full, tab: "sources" } });
  assert.equal(html.split('role="tab"').length - 1, 3);
  assert.equal((html.match(/role="tab"[^>]*tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /id="ghost-tab-sources" aria-selected="true" aria-controls="ghost-panel-sources" tabindex="0"/);
  assert.match(html, /role="tabpanel" id="ghost-panel-sources" aria-labelledby="ghost-tab-sources"/);
});

test("timeline: filterable by type, searchable, each row says where it came from", () => {
  const html = render({ initial: { status: full, items } });
  assert.match(html, /<div class="ghost-filter" role="group" aria-labelledby="ghost-filter-label"><span id="ghost-filter-label" class="ghost-meta">Show types \(all\)<\/span>/);
  assert.equal((html.match(/class="ghost-chip" aria-pressed="false"/g) ?? []).length, 11);
  assert.match(html, /<span class="technical">3<\/span> entries · <span class="technical">2<\/span> connections · <span class="technical">5<\/span> observations/);
  assert.match(html, /<form class="ghost-search" role="search" aria-label="Search GhostOS">/);
  assert.match(html, /<label for="ghost-search-input">/);
  assert.match(html, /Zephyr app: 2 commits observed/);
  assert.match(html, /Observation · <time class="technical" datetime="2026-06-01T09:00:00.000Z">2026-06-01<\/time> · from a source, 60% sure/i);
  assert.match(html, /Person · <time[^>]*>2026-06-01<\/time> · entered by you/);
  assert.match(html, /<span>Zephyr app stopped: uses Go<\/span><span class="ghost-meta">Connection ended · <time[^>]*>2026-05-01<\/time>/i);
  assert.match(html, />Sync now</);
});

test("empty: the first steps are buttons in the empty state", () => {
  const html = render({ initial: { status: empty } });
  assert.match(html, /<section class="kit-empty" aria-label="Nothing in GhostOS yet">/);
  assert.match(html, /<div class="kit-empty__actions"><button type="button" class="kit-button kit-button--primary kit-button--md">Add an entry<\/button><button type="button" class="kit-button kit-button--secondary kit-button--md">Open Sources<\/button><\/div>/);
});

test("entity detail: the entry's own actions sit in its header, next to its title", () => {
  const html = render({ initial: { status: full, items, detail } });
  assert.match(html, /<div class="ghost-detail-head"><div><p class="ghost-meta">Project<\/p><h3 id="ghost-detail-title">Zephyr app<\/h3><\/div><div class="button-row"><button type="button" class="kit-button kit-button--ghost kit-button--sm" aria-label="Forget Zephyr app">Forget…<\/button><\/div><\/div>/);
  // The connection form starts from words, not a stored id.
  assert.match(html, /<input class="kit-input" id="ghost-rel-type" list="ghost-rel-types" value="related to"\/>/);
  assert.match(html, /<option value="worked on"><\/option>/);
});

test("links are readable text with an accent underline, not accent-coloured text", () => {
  const css = readFileSync(join(desktop, "src/renderer/views/GhostOs.css"), "utf8");
  const link = css.match(/\.ghost-link \{([^}]*)\}/)?.[1] ?? "";
  assert.match(link, /color: var\(--text\);/);
  assert.match(link, /text-decoration-color: var\(--accent-ghost\);/);
});

test("entity detail: every fact with its source and its evidence", () => {
  const html = render({ initial: { status: full, items, detail } });
  assert.match(html, /<h3 id="ghost-detail-title">Zephyr app<\/h3>/);
  // The entity, each connection and each observation carries a source line.
  assert.match(html, /From Developer Intelligence · 100% sure/);
  assert.match(html, /From Developer Intelligence · 90% sure/);
  assert.match(html, /From Developer Intelligence · 60% sure/);
  assert.equal((html.match(/Entered by you/g) ?? []).length, 2);
  // Evidence, where it is not the owner.
  assert.match(html, /Repository record repo-app/);
  assert.match(html, /Technology fact in repo-app: package.json \(package.json\)/);
  assert.match(html, /Commit abcdef1 in repo-app at 2026-06-01 09:00/);
  assert.match(html, /Commit 1234567 in repo-app/);
  // Connections both ways, with validity.
  assert.match(html, /uses → <button type="button" class="ghost-link">TypeScript<\/button>/);
  assert.match(html, /← worked on <button type="button" class="ghost-link">Me<\/button> until <time[^>]*>2026-05-01<\/time>/i);
  assert.match(html, /uses → <button type="button" class="ghost-link">TypeScript<\/button> from <time[^>]*>2026-06-01<\/time>/i);
  // A source's entry is forgotten, not edited.
  assert.doesNotMatch(html, />Edit</);
  assert.match(html, /aria-label="Forget Zephyr app"/);
  assert.match(html, /<form class="ghost-form ghost-form--inline" aria-label="New connection">/);
  assert.match(html, /<form class="ghost-form ghost-form--inline" aria-label="New observation">/);
});

test("connection picker: a labelled combobox that searches every entry, with an empty state", () => {
  const html = render({ initial: { status: full, items, detail } });
  assert.match(html, /<label for="ghost-rel-to">To<\/label><input class="kit-input" id="ghost-rel-to" type="text" role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="ghost-rel-to-list" aria-describedby="ghost-rel-to-status"/i);
  assert.match(html, /role="status" aria-live="polite">Type to search your entries\.<\/p>/);
  assert.match(html, /<ul id="ghost-rel-to-list" role="listbox" aria-label="Matching entries" class="ghost-picker-list" hidden="">/);
  assert.doesNotMatch(html, /<select id="ghost-rel-to"/, "no longer limited to the loaded timeline");
  assert.match(html, /<button type="submit" class="kit-button kit-button--secondary kit-button--md" disabled="">Connect<\/button>/);
});

test("connection picker: results with the highlighted option announced; the entry itself never offered", () => {
  const results = [
    { id: project.id, type: "project", title: "Zephyr app", timelineAt: T, origin: "adapter" },
    { id: "ent_skill001", type: "skill", title: "TypeScript", timelineAt: T, origin: "adapter" },
    { id: "ent_far00001", type: "person", title: "Someone far back", timelineAt: "2020-01-01T00:00:00.000Z", origin: "manual" }
  ];
  const html = render({ initial: { status: full, items, detail, picker: { query: "e", results, active: 1 } } });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-activedescendant="ghost-pick-ent_far00001"/i);
  assert.match(html, /<li id="ghost-pick-ent_skill001" role="option" aria-selected="false"/);
  assert.match(html, /<li id="ghost-pick-ent_far00001" role="option" aria-selected="true"[^>]*>Someone far back <span class="ghost-meta">Person<\/span>/);
  assert.doesNotMatch(html, /ghost-pick-ent_proj0001/);
  assert.match(html, />2 entries found\. Use the arrow keys to choose\.</);
});

test("connection picker: no results, and a chosen entry", () => {
  const none = render({ initial: { status: full, items, detail, picker: { query: "zzz", results: [] } } });
  assert.match(none, />Nothing matches “zzz”\.</);
  assert.match(none, /aria-expanded="false"/);
  const chosen = render({ initial: { status: full, items, detail, picker: { query: "", results: null, chosen: { id: "ent_far00001", title: "Someone far back", typeLabel: "Person" } } } });
  assert.match(chosen, /<span>To<\/span> <strong>Someone far back<\/strong> <span class="ghost-meta">\(Person\)<\/span> <button type="button" class="kit-button kit-button--ghost kit-button--sm" aria-label="Change the entry, now Someone far back">Change<\/button>/);
  assert.match(chosen, /<button type="submit" class="kit-button kit-button--secondary kit-button--md">Connect<\/button>/);
});

test("forget asks first, and says what it removes", () => {
  const html = render({ initial: { status: full, items, detail, confirmForget: true } });
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /class="kit-dialog__title">Forget this entry\?<\/h2><p [^>]*>GhostOS also forgets everything it derived from it\. This cannot be undone, and a source cannot bring it back\.<\/p>/);
  assert.match(html, />Cancel<\/button><button type="button" class="kit-button kit-button--danger kit-button--md kit-confirm__ok">Forget<\/button>/);
});

test("an entry you made can be edited; a decision offers its outcome; a file is a reference", () => {
  const decision = { ...project, id: "ent_dec00001", type: "decision", title: "Move", provenance: manual, details: { decidedAt: T, choice: "go", alternatives: ["stay"], rationale: "light", outcome: null, outcomeAt: null, reviewAt: null } };
  const html = render({ initial: { status: full, items, detail: { entity: decision, relations: [], observations: [], derivedFrom: [] } } });
  assert.match(html, />Edit</);
  assert.match(html, /<dt>Alternatives<\/dt><dd>stay<\/dd>/);
  assert.match(html, /<form class="ghost-form" aria-label="Record the outcome">/);
  const file = { ...project, id: "ent_file0001", type: "file", title: "Plan", provenance: manual, details: { path: "C:\\notes\\plan.md", label: "plan" } };
  const fileHtml = render({ initial: { status: full, items, detail: { entity: file, relations: [], observations: [], derivedFrom: [] } } });
  assert.match(fileHtml, /<dd class="technical">C:\\notes\\plan.md<\/dd>/);
  assert.match(fileHtml, /GhostOS never opens this file/);
});

test("add: a labelled form whose fields follow the type", () => {
  const html = render({ initial: { status: full, tab: "add", form: { ...emptyForm(), type: "decision" } } });
  assert.match(html, /<form class="ghost-form ghost-card" aria-label="New entry">/);
  for (const id of ["ghost-f-type", "ghost-f-title", "ghost-f-when", "ghost-f-choice", "ghost-f-alts", "ghost-f-why", "ghost-f-notes", "ghost-f-tags"]) {
    assert.match(html, new RegExp(`<label for="${id}">`), id);
  }
  assert.match(html, /<label for="ghost-f-when">Decided on<\/label>/);
  assert.doesNotMatch(html, /ghost-f-path/);
  const file = render({ initial: { status: full, tab: "add", form: { ...emptyForm(), type: "file" } } });
  assert.match(file, /Path \(a reference; GhostOS never opens it\)/);
});

test("sources: what Developer Intelligence gives, what it never gives, and off removes what it added", () => {
  const on = render({ initial: { status: full, tab: "sources" } });
  assert.match(on, /It never reads commit messages, other event types, or any file/);
  assert.match(on, />Turn off and remove what it added</);
  assert.match(on, /Things you forgot stay forgotten/);
  assert.match(on, />Export…</);
  assert.match(on, />Import…</);
  const off = render({ initial: { status: empty, tab: "sources" } });
  assert.match(off, />Turn on</);
  const missing = render({ initial: { status: status(zero, di(false, false)), tab: "sources" } });
  assert.match(missing, /Developer Intelligence is not running/);
  assert.doesNotMatch(missing, />Turn on</);
});

test("a refused forget is reported inside the confirmation, next to the question, not at the top of the page", () => {
  const refused = { ok: false, text: "Forget in GhostOS requires confirmation." };
  const html = render({ initial: { status: full, items, detail, confirmForget: true, notice: refused } });
  assert.match(html, /<footer class="kit-dialog__footer"><p class="kit-inline-error" role="alert">Forget in GhostOS requires confirmation\.<\/p>/);
  assert.equal(html.split("Forget in GhostOS requires confirmation.").length - 1, 1, "said once");
  // Without a confirmation open, the same failure is reported at the top.
  const plain = render({ initial: { status: full, items, detail, notice: refused } });
  assert.match(plain, /<\/header><p class="kit-inline-error" role="alert">Forget in GhostOS requires confirmation\.<\/p>/);
});

test("sources: turning the source off asks first (it deletes what it added), then offers Turn off / Cancel", () => {
  const on = render({ initial: { status: full, tab: "sources" } });
  assert.doesNotMatch(on, /role="alertdialog"/, "no confirmation until asked");
  const asking = render({ initial: { status: full, tab: "sources", confirmDisable: true } });
  assert.match(asking, /role="alertdialog" aria-modal="true" aria-labelledby="([^"]+)"[^>]*>[\s\S]*<h2 id="\1" class="kit-dialog__title">Turn off Developer Intelligence\?<\/h2>/);
  assert.match(asking, /Everything it added to GhostOS is deleted, including detected habits\. This cannot be undone\./);
  assert.match(asking, />Cancel<\/button><button type="button" class="kit-button kit-button--danger kit-button--md kit-confirm__ok">Turn off<\/button>/);
});

test("design tokens only: no literal colours; fonts from tokens; the module accent", () => {
  const files = ["GhostOsView.tsx", "GhostOs.css", "ghostOsModel.ts"].map((f) => readFileSync(join(desktop, "src/renderer/views", f), "utf8"));
  for (const text of files) {
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, "no hex colours");
    assert.doesNotMatch(text, /\b(rgb|rgba|hsl|hsla)\s*\(/i, "no rgb/hsl colours");
    assert.doesNotMatch(text, /\b(white|black|red|blue|green|gray|grey|gold|yellow)\b\s*[;"'}]/i, "no named colours");
  }
  const css = files[1];
  for (const [, family] of css.matchAll(/font-family:\s*([^;]+);/g)) assert.match(family.trim(), /^var\(--font-(ui|tech)\)$/, family);
  assert.match(css, /var\(--accent-ghost\)/);
  assert.doesNotMatch(css, /animation|transition/, "nothing animates");
});

test("the shell routes to it: sidebar entry, icon, action", () => {
  const meta = readFileSync(join(desktop, "src/renderer/lib/moduleMeta.ts"), "utf8");
  const shell = readFileSync(join(desktop, "src/renderer/main.tsx"), "utf8");
  assert.match(meta, /\{ id: "ghost", label: "GhostOS", accentClass: "accent-ghost", actionId: "ghost_os.open" \}/);
  assert.match(meta, /ghost: \{ icon: Ghost, accent: "var\(--accent-ghost\)" \}/);
  assert.match(shell, /activeView === "ghost" && <GhostOsView bridge=\{getBridge\(\)\}/);
});

function emptyForm() {
  return { id: null, type: "person", title: "", notes: "", tags: "", when: "", endedAt: "", text: "", choice: "", alternatives: "", rationale: "", cadence: "weekly", path: "", label: "", participants: "" };
}
