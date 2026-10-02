// The Projects view, rendered: the home screen, the empty state, the wizard
// and the operation dialog. Built with the app's own Vite (SSR, React and
// lucide external), rendered with react-dom/server from synthetic data.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { normaliseProjectInput } from "@dexnest/projects/domain";
import { NOW, repo, withCounts } from "../../../packages/projects/test/fixtures.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(desktop, "../..");
let scratch = "";
let view;
let wizard;
let op;

before(async () => {
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "projects-view-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    resolve: { alias: { "@dexnest/projects/domain": resolve(repoRoot, "packages/projects/src/domain/index.ts") } },
    build: {
      ssr: true,
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          view: join(desktop, "src/renderer/views/projects/ProjectsView.tsx"),
          wizard: join(desktop, "src/renderer/views/projects/AddProjectWizard.tsx"),
          op: join(desktop, "src/renderer/views/projects/OperationDialog.tsx")
        },
        external: ["react", "react/jsx-runtime", "react-dom", "lucide-react"],
        output: { format: "es", entryFileNames: "[name].mjs" }
      }
    }
  });
  view = await import(pathToFileURL(join(scratch, "view.mjs")).href);
  wizard = await import(pathToFileURL(join(scratch, "wizard.mjs")).href);
  op = await import(pathToFileURL(join(scratch, "op.mjs")).href);
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function project(name, extra = {}) {
  const r = normaliseProjectInput({ name, path: `/code/${name}` }, { existing: null, takenIds: new Set(), now: "2026-09-01T00:00:00.000Z", newCommandId: () => "c" });
  return { ...r.project, ...extra };
}

const noop = () => undefined;
const filters = { query: "", group: "all", tag: "all", status: "all", sort: "activity" };

function home(entries, extra = {}) {
  return renderToStaticMarkup(
    createElement(view.ProjectsHome, {
      entries,
      groups: [{ id: "g1", name: "Work", position: 0 }],
      filters,
      layout: "grid",
      now: NOW,
      staleDays: 30,
      onFilters: noop,
      onLayout: noop,
      onAdd: noop,
      onFetchAll: noop,
      onPullAll: noop,
      onRefresh: noop,
      onOpen: noop,
      onQuick: noop,
      onToggleFavourite: noop,
      ...extra
    })
  );
}

test("no projects yet: a big 'Add your first project' with the drag-drop hint and the suggestions count", () => {
  const html = home([], { suggestionsCount: 3 });
  assert.match(html, /Add your first project/);
  assert.match(html, /drop a folder anywhere on this window/);
  assert.match(html, /found 3 repositories you can add/);
  assert.match(html, /Add project<\/button>/);
});

test("home: needs attention first, then favourites, then the rest; badges and fetched-ago on cards", () => {
  const html = home([
    { project: project("quiet"), state: repo() },
    { project: project("star", { favourite: true }), state: repo() },
    { project: project("ahead"), state: withCounts(2, 0) }
  ]);
  const order = ["Needs attention", "Favourites", "All projects"].map((t) => html.indexOf(t));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `section order ${order}`);
  assert.ok(html.indexOf(">ahead<") < html.indexOf(">star<") && html.indexOf(">star<") < html.indexOf(">quiet<"));
  assert.match(html, /2 to push/);
  assert.match(html, /all pushed/);
  assert.match(html, /fetched 4 minutes ago/);
  assert.match(html, /3 projects · 1 needs attention · latest fetch 4 minutes ago/);
});

test("a button that can't run says why, stays focusable, and isn't a plain disabled button", () => {
  const html = home([{ project: project("behind"), state: withCounts(0, 2) }]);
  const push = html.match(/<button(?=[^>]*aria-label="Push - behind")[^>]*title="([^"]*)"[^>]*>/);
  assert.ok(push, "push button rendered, named for screen readers");
  assert.match(push[0], /aria-disabled="true"/);
  assert.equal(push[1], "origin/main has 2 commits you don&#x27;t have. Pull first.");
  assert.doesNotMatch(push[0], / disabled=""/);
  // List rows have room for the labels.
  const list = home([{ project: project("behind"), state: withCounts(0, 2) }], { layout: "list" });
  assert.match(list, /Push<\/button>/);
});

test("keyboard: only one card name is in the tab order (roving), search says its shortcut", () => {
  const html = home([{ project: project("a"), state: repo() }, { project: project("b"), state: repo() }, { project: project("c"), state: repo() }]);
  assert.equal((html.match(/class="projects-card__name" tabindex="0"/g) ?? []).length, 1);
  assert.equal((html.match(/class="projects-card__name" tabindex="-1"/g) ?? []).length, 2);
  // The shortcut is announced (aria-keyshortcuts) and shown as a key chip, like the top bar's Ctrl K.
  assert.match(html, /placeholder="Search projects…" aria-keyshortcuts="\/"/);
  assert.match(html, /<kbd class="projects-search__key" aria-hidden="true">\/<\/kbd>/);
  assert.match(html, /<label for="projects-search"/);
});

test("list layout, filters, and the projects.json banner", () => {
  const html = home([{ project: project("a", { tags: ["work"] }), state: repo() }], { layout: "list", legacyChanged: true });
  assert.match(html, /projects-list/);
  assert.match(html, /projects-card--list/);
  assert.match(html, /<option value="work">work<\/option>/);
  assert.match(html, /<option value="g1">Work<\/option>/);
  assert.match(html, /projects.json has changed since it was imported/);
  assert.match(html, /role="radiogroup" aria-label="Layout"/);
});

test("a filter that matches nothing says so", () => {
  const html = home([{ project: project("a"), state: repo() }], { filters: { ...filters, query: "zzz" } });
  assert.match(html, /No projects match these filters/);
});

function wizardBody(step, extra = {}) {
  return renderToStaticMarkup(
    createElement(wizard.WizardBody, {
      step,
      pasted: "",
      onPasted: noop,
      onPick: noop,
      onInspect: noop,
      suggestions: [],
      selected: new Set(),
      onToggleSuggestion: noop,
      onAddSelected: noop,
      clone: { url: "", parentDir: "", folderName: "" },
      onCloneChange: noop,
      onClone: noop,
      onPickParent: noop,
      groups: [],
      onForm: noop,
      ...extra
    })
  );
}

test("wizard step 1: choose, paste, drop, suggestions, clone", () => {
  const html = wizardBody({ kind: "choose" }, { suggestions: [{ discoveredId: "r1", path: "/code/found", name: "found", lastSeenAt: NOW }], selected: new Set(["/code/found"]) });
  assert.match(html, /Choose folder…/);
  assert.match(html, /or paste a path/);
  assert.match(html, /drop a folder anywhere on this window/);
  assert.match(html, /Add selected \(1\)/);
  assert.match(html, /Clone from GitHub/);
  assert.match(html, /Uses the network, only when you click Clone/);
  assert.match(html, /aria-current="step"/);
  const empty = wizardBody({ kind: "choose", error: "That folder doesn't exist." });
  assert.match(empty, /role="alert">That folder doesn&#x27;t exist./);
  assert.match(empty, /Nothing new found/);
});

test("wizard step 3: what DexNest found, a pre-filled form with every control labelled", async () => {
  const { stepFromInspection } = wizard;
  const step = stepFromInspection({
    kind: "ok",
    path: "/code/shop",
    realPath: "/code/shop",
    draft: { name: "shop", path: "/code/shop", commands: { start: "pnpm run dev" }, ports: [5173], localUrls: ["http://localhost:5173"], commandList: [{ id: "lint", label: "lint", command: "pnpm run lint", requiresConfirmation: false }] },
    facts: { isRepo: true, remoteName: "origin", remoteUrl: "https://github.com/me/shop.git", hosting: { kind: "github", owner: "me", repo: "shop" }, defaultBranch: "main", packageManager: "pnpm", framework: "Vite", workspaceFile: null, ports: [5173], scripts: 3 },
    warnings: ["package.json is too large to read; scripts weren't read."]
  });
  const html = wizardBody(step);
  for (const text of ["git repo", "github.com/me/shop", "default main", "Vite", "pnpm", "too large to read"]) assert.match(html, new RegExp(text));
  assert.match(html, /value="pnpm run dev"/);
  assert.match(html, /value="5173"/);
  assert.match(html, /readOnly=""|readonly=""/);
  // Every input/select/textarea has a label: either <label for=id> or aria-label.
  const ids = [...html.matchAll(/<(?:input|select|textarea)(?![^>]*type="checkbox")[^>]*>/g)].map((m) => m[0]);
  for (const control of ids) {
    const id = control.match(/ id="([^"]+)"/)?.[1];
    assert.ok(control.includes("aria-label=") || (id && html.includes(`for="${id}"`)), `unlabelled: ${control}`);
  }
  const refused = wizardBody(stepFromInspection({ kind: "refused", code: "data_root", reason: "This folder is inside DexNest's own data folder." }));
  assert.match(refused, /role="alert">This folder is inside DexNest/);
  const dup = wizardBody(stepFromInspection({ kind: "duplicate", by: "path", existing: { id: "shop", name: "Shop", archived: false }, reason: "This folder is already a project: Shop." }));
  assert.match(dup, /already a project: Shop/);
});

function body(phase, extra = {}) {
  return renderToStaticMarkup(createElement(op.OperationBody, { phase, typed: "", onTyped: noop, output: [], showOutput: false, onToggleOutput: noop, ...extra }));
}

const plan = (extra = {}) => ({ refused: false, kind: "push", safety: "normal", title: "Push", summary: "Push 2 commits from main to origin/main.", details: ["Nothing on the remote is overwritten."], network: true, confirm: { kind: "none" }, steps: [], undo: null, branch: "main", counts: {}, expectHead: null, ...extra });

test("operation dialog: the preview in plain words, with what it touches", () => {
  const html = body({ kind: "preview", plan: plan(), fingerprint: "f" });
  assert.match(html, /Push 2 commits from main to origin\/main\./);
  assert.match(html, /Nothing on the remote is overwritten/);
  assert.match(html, /Uses the network/);
  assert.doesNotMatch(html, /Type .* to confirm/);
  const strong = body({ kind: "preview", plan: plan({ kind: "delete_branch", safety: "strong", title: "Delete unmerged branch", confirm: { kind: "type", text: "feature/x" }, undo: "recreate_branch", network: false }), fingerprint: "f" });
  assert.match(strong, /Type <code class="kit-tech">feature\/x<\/code> to confirm/);
  assert.match(strong, /Can be undone/);
  assert.match(strong, /Type to confirm/);
  const stale = body({ kind: "preview", plan: plan(), fingerprint: "f", stale: true });
  assert.match(stale, /changed since you opened this/);
});

test("operation dialog: running with live output, the result, a refusal", () => {
  const running = body({ kind: "running", plan: plan() }, { output: ["To origin", "main -> main"], showOutput: true });
  assert.match(running, /Push 2 commits from main to origin\/main…/);
  assert.match(running, /aria-expanded="true"/);
  assert.match(running, /<pre class="projects-op__log"[^>]*>To origin\nmain -&gt; main<\/pre>/);
  const done = body({ kind: "result", result: { status: "done", opId: "op1", outcome: "succeeded", plan: plan(), message: "Push done. Now: all pushed.", errorCode: null, output: [], undoAvailable: false, state: null } });
  assert.match(done, /role="status">Push done. Now: all pushed./);
  const auth = body({ kind: "result", result: { status: "done", opId: "op1", outcome: "auth_needed", plan: plan(), message: "Authentication needed - open a terminal here and run the command once yourself.", errorCode: "auth_needed", output: [], undoAvailable: false, state: null } });
  assert.match(auth, /role="alert">Authentication needed/);
  const refused = body({ kind: "refused", refusal: { refused: true, kind: "push", code: "diverged", reason: "main and origin/main have diverged.", offers: ["open_terminal"] } });
  assert.match(refused, /have diverged/);
  assert.deepEqual(op.offerRequest("push_set_upstream", { kind: "push" }), { kind: "push", setUpstream: true });
  assert.deepEqual(op.offerRequest("stash_and_switch", { kind: "switch", branch: "x" }), { kind: "switch", branch: "x", dirty: "stash" });
  assert.equal(op.offerRequest("open_terminal", { kind: "push" }), null);
});

test("operation dialog: before the preview arrives (or when it is refused) the title is the operation in plain words", () => {
  const bridge = { projectsPreview: () => new Promise(() => undefined), onProjectsOutput: () => noop };
  const html = renderToStaticMarkup(createElement(op.OperationDialog, { bridge, projectId: "p", projectName: "DexNest", request: { kind: "delete_remote_branch", remote: "origin", name: "x" }, onClose: noop }));
  assert.match(html, /class="kit-dialog__title">Delete remote branch<\/h2>/);
  assert.doesNotMatch(html, /delete_remote_branch</);
});

// --- static ---------------------------------------------------------------------

const sourceFiles = [
  ...readdirSync(join(desktop, "src/renderer/views/projects")).map((f) => join(desktop, "src/renderer/views/projects", f)),
  ...readdirSync(join(desktop, "src/renderer/components/ui/kit")).map((f) => join(desktop, "src/renderer/components/ui/kit", f))
];

test("design tokens only: no hex or rgb colours, fonts only from tokens", () => {
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, `${file}: hex colour`);
    assert.doesNotMatch(text, /\b(rgb|rgba|hsl|hsla)\s*\(/i, `${file}: rgb/hsl colour`);
    for (const [, family] of text.matchAll(/font-family:\s*([^;]+);/g)) assert.match(family.trim(), /^var\(--font-(ui|tech)\)$/, `${file}: ${family}`);
  }
});

test("the renderer takes only pure code from @dexnest/projects: values from /domain, types from the root", () => {
  for (const file of sourceFiles.filter((f) => /\.tsx?$/.test(f))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*from\s+"@dexnest\/projects(\/[a-z]+)?";/gm)) {
      assert.ok(m[1] || m[2] === "/domain", `${file}: ${m[0]}`);
    }
  }
});

// --- Phase 9: consistency with the existing views ---------------------------------

const kitCss = readFileSync(join(desktop, "src/renderer/components/ui/kit/kit.css"), "utf8");
const rule = (selector) => {
  const m = kitCss.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`));
  assert.ok(m, `missing ${selector}`);
  return m[2];
};

test("page header has the same box as the existing views' headers (text-2xl / text-sm, default h1 and p margins)", () => {
  const title = rule(".kit-header__title");
  assert.match(title, /font-size: 1\.5rem;/);
  assert.match(title, /line-height: 2rem;/);
  assert.match(title, /margin: 0\.67em 0;/);
  const subtitle = rule(".kit-header__subtitle");
  assert.match(subtitle, /font-size: 0\.875rem;/);
  assert.match(subtitle, /line-height: 1\.25rem;/);
  assert.match(subtitle, /margin: 1em 0;/);
});

test("primary buttons are soft accent buttons like the rest of the app, never a solid fill", () => {
  const primary = rule(".kit-button--primary");
  assert.match(primary, /background: color-mix\(in srgb, var\(--kit-accent\) \d+%, transparent\);/);
  assert.match(primary, /color: var\(--kit-accent\);/);
  assert.doesNotMatch(primary, /background: var\(--kit-accent\);/);
});

test("dialogs cover the whole window: rendered into document.body, inline only without a DOM", () => {
  const kit = readFileSync(join(desktop, "src/renderer/components/ui/kit/index.tsx"), "utf8");
  assert.match(kit, /typeof document === "undefined" \? content : createPortal\(content, document\.body\)/);
  assert.match(rule(".kit-backdrop"), /position: fixed;[\s\S]*inset: 0;/);
});

// --- Phase 10: scale and parity --------------------------------------------------

test("250 projects: every card renders, one card name is in the tab order, the CSS keeps off-screen cards cheap", () => {
  const entries = Array.from({ length: 250 }, (_, i) => ({ project: project(`p${String(i).padStart(3, "0")}`), state: repo() }));
  const started = performance.now();
  const html = home(entries);
  const took = performance.now() - started;
  assert.equal((html.match(/class="projects-card__name"/g) ?? []).length, 250);
  assert.equal((html.match(/class="projects-card__name" tabindex="0"/g) ?? []).length, 1);
  assert.ok(took < 3000, `rendered in ${Math.round(took)} ms`);
  const css = readFileSync(join(desktop, "src/renderer/views/projects/Projects.css"), "utf8");
  assert.match(css, /\.projects-grid > li,\s*\.projects-list > li \{\s*content-visibility: auto;/);
});

test("F37: a card shows the project type next to its tags", () => {
  const html = home([{ project: project("site", { projectType: "live_website", tags: ["web"] }), state: repo() }]);
  assert.match(html, /<ul class="projects-card__tags" aria-label="Type and tags"><li class="projects-card__type">Live website<\/li><li>web<\/li><\/ul>/);
  assert.doesNotMatch(home([{ project: project("plain"), state: repo() }]), /projects-card__tags/);
});
