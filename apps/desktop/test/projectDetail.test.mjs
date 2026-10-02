// The project detail, rendered: header, tabs, and every tab body, from
// synthetic data (Vite SSR, react-dom/server).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { normaliseProjectInput } from "@dexnest/projects/domain";
import { NOW, branch, remoteBranch, repo, stash, tree, withCounts } from "../../../packages/projects/test/fixtures.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(desktop, "../..");
let scratch = "";
let tabs;
let detail;
let bridgeMod;

before(async () => {
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "project-detail-"));
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
          tabs: join(desktop, "src/renderer/views/projects/DetailTabs.tsx"),
          detail: join(desktop, "src/renderer/views/projects/ProjectDetail.tsx"),
          bridge: join(desktop, "src/renderer/views/projects/projectsBridge.ts")
        },
        external: ["react", "react/jsx-runtime", "react-dom", "lucide-react"],
        output: { format: "es", entryFileNames: "[name].mjs" }
      }
    }
  });
  tabs = await import(pathToFileURL(join(scratch, "tabs.mjs")).href);
  detail = await import(pathToFileURL(join(scratch, "detail.mjs")).href);
  bridgeMod = await import(pathToFileURL(join(scratch, "bridge.mjs")).href);
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function project(name, extra = {}) {
  const r = normaliseProjectInput({ name, path: `/code/${name}` }, { existing: null, takenIds: new Set(), now: "2026-09-01T00:00:00.000Z", newCommandId: () => "c" });
  return { ...r.project, ...extra };
}
const noop = () => undefined;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

test("the detail: back, name, badge, branch, quick actions with their shortcuts, and seven tabs", () => {
  const html = render(detail.ProjectDetail, {
    bridge: bridgeMod.fallbackProjectsBridge,
    project: project("shop", { git: { isRepo: true, remoteName: "origin", remoteUrl: "https://github.com/me/shop.git", hosting: { kind: "github", owner: "me", repo: "shop" }, defaultBranch: "main" } }),
    groups: [],
    now: NOW,
    staleDays: 30,
    version: 0,
    dialogOpen: false,
    commandResults: {},
    runAction: async () => ({ ok: true }),
    clearCommandResult: async () => undefined,
    onBack: noop,
    onAsk: noop,
    onToast: noop,
    onChanged: noop,
    onGroups: noop
  });
  assert.match(html, /<h1 class="projects-detail__name">shop<\/h1>/);
  assert.match(html, /title="Back to Projects \(Esc\)"/);
  // Before git state arrives, the three say so instead of their shortcut hint.
  for (const label of ["Fetch", "Pull", "Push"]) assert.match(html, new RegExp(`aria-disabled="true" title="Reading git state…"[^>]*>(?:(?!</button>).)*${label}</button>`, "s"), label);
  assert.match(html, /GitHub<\/button>/);
  assert.match(html, /role="tablist" aria-label="shop sections"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 7);
  assert.match(html, /aria-selected="true"[^>]*>Overview/);
  assert.match(html, /role="tabpanel" id="project-detail-panel-overview" aria-labelledby="project-detail-tab-overview"/);
});

test("overview: status, Autopilot worktrees, where you left off, and Undo only on the latest operation", () => {
  const state = repo({
    workingTree: tree({ unstaged: [{ path: "a", status: "modified" }] }),
    stashes: [stash(0)],
    worktrees: [...repo().worktrees, { path: "/w/dexnest-worktrees/run-1", headSha: null, branch: "autopilot/run-1", isMain: false, isCurrent: false, owner: "autopilot", locked: false, prunable: false }],
    submodules: ["libs/dep"]
  });
  const html = render(tabs.OverviewTab, {
    project: project("shop", { description: "The shop", notes: "remember X", tags: ["work"] }),
    state,
    leftOff: { reason: "Uncommitted changes; 3 commits", evidence: ["working_tree · 2026-10-01"], latestActivityAt: NOW },
    operations: [
      { id: "b", verb: "commit", outcome: "succeeded", state: "succeeded", startedAt: NOW, undoable: true, undone: false },
      { id: "a", verb: "push", outcome: "auth_needed", state: "failed", startedAt: NOW, undoable: false, undone: false }
    ],
    now: NOW,
    onAsk: noop
  });
  for (const text of ["uncommitted changes", "origin/main", "0 staged · 1 changed · 0 new", "Autopilot", "never touches a branch checked out in an Autopilot worktree", "libs/dep", "Uncommitted changes; 3 commits", "The shop", "remember X", "auth_needed"]) assert.match(html, new RegExp(text), text);
  assert.equal((html.match(/>Undo<\/button>/g) ?? []).length, 1);
});

test("branches: the comparison table, Autopilot's branch locked with the reason, push-and-upstream offered", () => {
  const state = repo({
    branches: [
      branch("main", { isCurrent: true }),
      branch("feature", { upstream: null, mergedIntoDefault: false, vsDefault: { ahead: 2, behind: 0 } }),
      branch("autopilot/run-1", { checkedOutElsewhere: { path: "/w/dexnest-worktrees/run-1", owner: "autopilot" } })
    ],
    remoteBranches: [remoteBranch("main", { trackedBy: "main" }), remoteBranch("theirs")]
  });
  const html = render(tabs.BranchesTab, { project: project("shop", { git: { isRepo: true, remoteName: "origin", remoteUrl: "git@github.com:me/shop.git", hosting: null, defaultBranch: "main" } }), state, now: NOW, staleDays: 30, allBranches: false, onShowAll: noop, onAsk: noop, onOpenGithub: noop });
  for (const col of ["Branch", "Upstream", "vs upstream", "vs main", "Last commit", "State"]) assert.match(html, new RegExp(`<th scope="col">${col}</th>`));
  assert.match(html, /class="projects-table__current"/);
  assert.match(html, /Push \+ upstream/);
  assert.match(html, /remote only/);
  assert.match(html, /Check out/);
  assert.match(html, /Delete remote…/);
  const apRow = html.split("<tr").find((r) => r.includes("autopilot/run-1"));
  assert.match(apRow, /Autopilot worktree/);
  assert.match(apRow, /aria-disabled="true"[^>]*title="autopilot\/run-1 is checked out in an Autopilot worktree/);
  assert.match(html, /aria-label="feature on GitHub"/);
  assert.match(html, /Compare all branches with main/);
});

test("changes: grouped files with line counts, conflicts sent to the editor, commit needs a message, discard needs a selection", () => {
  const state = repo({ workingTree: tree({ conflicted: ["c.ts"], staged: [{ path: "s.ts", status: "added" }], unstaged: [{ path: "u.ts", status: "modified" }], untracked: ["new file.ts"] }), stashes: [stash(0)] });
  const html = render(tabs.ChangesTab, { state, stat: { staged: [{ path: "s.ts", added: 10, deleted: 0 }], unstaged: [{ path: "u.ts", added: 2, deleted: 3 }] }, onAsk: noop, onOpenVsCode: noop });
  for (const t of ["Conflicts", "Staged", "Changed", "New files", "\\+10", "-3", "new file.ts", "Open in VS Code", "won&#x27;t pick sides"]) assert.match(html, new RegExp(t), t);
  assert.match(html, /aria-disabled="true" title="Write a commit message first."[^>]*>Commit all<\/button>/);
  assert.match(html, /aria-disabled="true" title="Select the files to discard."/);
  assert.match(html, /aria-label="Select u.ts"/);
  assert.doesNotMatch(html, /aria-label="Select c.ts"/, "a conflicted file can't be selected for commit or discard");
  assert.match(html, /stash@\{0\}/);
  assert.match(html, />Pop<\/button>/);
  const clean = render(tabs.ChangesTab, { state: repo(), stat: null, onAsk: noop, onOpenVsCode: noop });
  assert.match(clean, /Everything is committed/);
});

test("history: short sha, subject, author, pushed or local", () => {
  const html = render(tabs.HistoryTab, { entries: [{ sha: "a".repeat(40), parents: [], subject: "local work", author: "Me", committedAt: NOW, onRemote: false }, { sha: "b".repeat(40), parents: [], subject: "old", author: "Me", committedAt: NOW, onRemote: true }], now: NOW, loading: false });
  assert.match(html, /aaaaaaa/);
  assert.match(html, />local</);
  assert.match(html, />pushed</);
});

test("run: every Dev dashboard command and lifecycle button, the latest output with ANSI stripped, recent runs", () => {
  const p = project("shop", { commands: { start: "pnpm dev", build: "pnpm build", test: "", typecheck: "", custom: "" }, commandList: [{ id: "deploy", label: "Deploy", command: "pnpm deploy", requiresConfirmation: true }], ports: [3000], dockerCompose: true, logCommand: "pnpm logs" });
  const results = {
    "dev.project.shop.run_build": { actionId: "dev.project.shop.run_build", projectId: "shop", status: "success", stdout: "\u001b[32mbuilt\u001b[0m", stderr: "", summary: "Command completed.", durationMs: 1200, finishedAt: NOW },
    "dev.project.shop.check_health": { actionId: "dev.project.shop.check_health", projectId: "shop", status: "failed", stdout: "", stderr: "", summary: "port 3000 closed", durationMs: 10, finishedAt: "2026-10-01T11:00:00.000Z" },
    "dev.project.other.run_build": { actionId: "dev.project.other.run_build", projectId: "other", status: "success", stdout: "", stderr: "", summary: "x", durationMs: 1, finishedAt: NOW }
  };
  const html = render(tabs.RunTab, { project: p, results, running: new Set(["dev.project.shop.run_start"]), now: NOW, onRun: noop, onLifecycle: noop, onClear: noop });
  for (const t of [">dev<", ">build<", "Deploy", "asks first", "ports 3000", "Stop…", "Restart…", "Health", "Kill ports…", "Processes", "Docker down…", "Logs", "1.2 s", "Recent runs", "port 3000 closed"]) assert.match(html, new RegExp(t), t);
  assert.match(html, />built</, "ANSI codes stripped");
  assert.doesNotMatch(html, /\u001b/);
  assert.match(html, /aria-disabled="true" title="Running…"/);
  assert.doesNotMatch(html, /dev\.project\.other/);
});

test("links: open the app, each link, and every folder in Folder / VS Code / Terminal", () => {
  const p = project("shop", { localUrls: ["http://localhost:5173"], links: [{ label: "Docs", url: "https://docs.example" }], folders: [{ label: "API", path: "/code/shop/api" }] });
  const html = render(tabs.LinksTab, { project: p, onOpenApp: noop, onOpenLink: noop, onOpenFolder: noop });
  for (const t of ["Open app", "Docs", "https://docs.example", "API", "/code/shop/api", ">Folder<", ">VS Code<", ">Terminal<"]) assert.match(html, new RegExp(t), t);
  const plain = render(tabs.LinksTab, { project: project("bare"), onOpenApp: noop, onOpenLink: noop, onOpenFolder: noop });
  assert.match(plain, /\/code\/bare/, "with no folders listed, the project folder itself");
});

test("settings: the same form, pre-filled; archive for a live project, restore/remove for an archived one", () => {
  const live = render(tabs.SettingsTab, { project: project("shop", { description: "The shop" }), groups: [], saving: false, saveError: null, onSave: noop, onArchive: noop, onRestore: noop, onRemove: noop, onAddGroup: noop });
  assert.match(live, /value="The shop"/);
  assert.match(live, /aria-disabled="true" title="Nothing has changed."[^>]*>Save changes/);
  assert.match(live, /Archive project/);
  assert.doesNotMatch(live, /Remove from DexNest/);
  const archived = render(tabs.SettingsTab, { project: project("old", { archivedAt: NOW }), groups: [], saving: false, saveError: "boom", onSave: noop, onArchive: noop, onRestore: noop, onRemove: noop, onAddGroup: noop });
  assert.match(archived, />Restore</);
  assert.match(archived, /Remove from DexNest…/);
  assert.match(archived, /never the folder/);
  assert.match(archived, /role="alert"><li>boom<\/li>/);
});
