// The project detail, rendered: header, tabs, and every tab body, from
// synthetic data (Vite SSR, react-dom/server).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

test("overview: repeated evidence lines all render, without a duplicate-key warning (Integration QA F6)", () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    const html = render(tabs.OverviewTab, {
      project: project("shop"),
      state: repo(),
      leftOff: { reason: "Most recently active", evidence: ["event · 2026-10-02", "event · 2026-10-02", "snapshot · 2026-10-02"], latestActivityAt: NOW },
      operations: [],
      now: NOW,
      onAsk: noop
    });
    assert.equal((html.match(/event · 2026-10-02/g) ?? []).length, 2);
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors.filter((e) => /same key|unique "key"|unique key/i.test(e)), []);
  const source = readFileSync(join(desktop, "src/renderer/views/projects/DetailTabs.tsx"), "utf8");
  assert.doesNotMatch(source, /leftOff\.evidence\.map\(\(e\) => \(\s*<li key=\{e\}>/, "evidence lines are keyed by position");
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

test("branches: a stale local main is said so, can be updated in place, and brought up to the branch you are on", () => {
  const develop = branch("develop", { isCurrent: true, vsDefault: { ahead: 6, behind: 0 }, mergedIntoDefault: false });
  const state = repo({
    head: { branch: "develop", sha: develop.tipSha, detached: false, unborn: false },
    defaultBase: "origin/main",
    branches: [develop, branch("main", { upstream: { ref: "origin/main", remote: "origin", branch: "main", gone: false, counts: { ahead: 0, behind: 26 } } })],
    remoteBranches: [remoteBranch("main", { trackedBy: "main" }), remoteBranch("develop", { trackedBy: "develop" })]
  });
  const asked = [];
  const html = render(tabs.BranchesTab, { project: project("derm"), state, now: NOW, staleDays: 30, allBranches: false, onShowAll: noop, onAsk: (r) => asked.push(r), onOpenGithub: noop, onSetDeployed: noop });
  assert.match(html, /<th scope="col">vs origin\/main<\/th>/, "the column says what it compares with");
  assert.match(html, /main on this PC is 26 commits behind origin\/main, so branches are compared with origin\/main\./);
  assert.match(html, /Compare all branches with origin\/main/);
  const mainRow = html.split("<tr").find((r) => r.includes(">main</span></th>"));
  assert.match(mainRow, />Update<\/button>/);
  assert.match(mainRow, /title="Move main forward to origin\/main, without switching to it"/);
  assert.match(mainRow, />Bring up to develop<\/button>/);
  const developRow = html.split("<tr").find((r) => r.includes(">develop</span></th>"));
  assert.doesNotMatch(developRow, />Update<\/button>|Bring up to/, "the branch you are on is moved by Pull, not here");
  assert.doesNotMatch(html, /vs live/, "no deployed branch marked: no live column");
});

test("branches: the deployed branch is chosen here, badged, and every branch says how far it is from live", () => {
  const develop = branch("develop", { isCurrent: true, vsDefault: { ahead: 6, behind: 0 }, mergedIntoDefault: false, vsDeployed: null });
  const state = repo({
    head: { branch: "develop", sha: develop.tipSha, detached: false, unborn: false },
    deployed: { branch: "develop", base: "origin/develop" },
    branches: [develop, branch("main", { vsDeployed: { ahead: 0, behind: 6 } })],
    remoteBranches: [remoteBranch("main", { trackedBy: "main" }), remoteBranch("develop", { trackedBy: "develop" })]
  });
  const props = { state, now: NOW, staleDays: 30, allBranches: false, onShowAll: noop, onAsk: noop, onOpenGithub: noop, onSetDeployed: noop };
  const html = render(tabs.BranchesTab, { ...props, project: project("derm", { deployedBranch: "develop" }) });
  assert.match(html, /<label for="projects-deployed-branch">Deployed branch<\/label>/);
  assert.match(html, /<option value="">Not deployed<\/option>/);
  assert.match(html, /<option value="develop" selected="">develop<\/option>/);
  assert.match(html, /Compared with origin\/develop: what was pushed of it\. DexNest can&#x27;t see your server, so this is the branch, not the deploy\./);
  assert.match(html, /<th scope="col">vs live<\/th>/);
  const developRow = html.split("<tr").find((r) => r.includes(">develop</span></th>"));
  assert.match(developRow, /<td>live<\/td>/);
  assert.match(developRow, /kit-badge--success[^>]*>.*?deployed<\/span>/s);
  const mainRow = html.split("<tr").find((r) => r.includes(">main</span></th>"));
  assert.match(mainRow, /<td>6 behind<\/td>/);
  assert.doesNotMatch(mainRow, />deployed</);

  // Not a deployed project: the choice is offered, nothing is compared.
  const none = render(tabs.BranchesTab, { ...props, state: repo(), project: project("lib") });
  assert.match(none, /<option value="" selected="">Not deployed<\/option>/);
  assert.match(none, /For a project that is live: the branch it is deployed from\./);
  assert.doesNotMatch(none, /vs live/);

  // The marked branch was deleted since: said, and still selectable to change.
  const gone = render(tabs.BranchesTab, { ...props, state: repo({ deployed: { branch: "release", base: null } }), project: project("old", { deployedBranch: "release" }) });
  assert.match(gone, /There is no branch called release any more\./);
  assert.match(gone, /<option value="release" selected="">release \(missing\)<\/option>/);
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

const messyTree = () => ({
  ...tree({
    unstaged: [{ path: "apps/api/.env", status: "modified" }, { path: "src/app.ts", status: "modified" }],
    untracked: ["Alliance Grant.docx", "skin_dataset_builder.zip", "skin_dataset_builder/", "scripts/audit.py"]
  }),
  sizes: { "skin_dataset_builder/": { files: 2000, bytes: 4 * 1024 ** 3, truncated: true }, "scripts/audit.py": { files: 1, bytes: 900, truncated: false } }
});

test("changes: what deserves a look is marked on its row and listed above the buttons; new files can be ignored", () => {
  const html = render(tabs.ChangesTab, { state: repo({ workingTree: messyTree() }), stat: null, onAsk: noop, onOpenVsCode: noop, onIgnore: noop, showIgnored: false, onToggleIgnored: noop });
  const row = (name) => html.split("<li").find((r) => r.includes(`title="${name}"`));
  assert.match(row("apps/api/.env"), /kit-badge--error[^>]*>.*?secrets file\?<\/span>/s);
  assert.match(row("Alliance Grant.docx"), /kit-badge--warning[^>]*>.*?document<\/span>/s);
  assert.match(row("skin_dataset_builder.zip"), />archive<\/span>/);
  assert.match(row("skin_dataset_builder/"), /very large · more than 4\.0 GB in more than 2,000 files/);
  assert.doesNotMatch(row("src/app.ts"), /kit-badge/);
  assert.doesNotMatch(row("scripts/audit.py"), /kit-badge/, "an ordinary new file carries no mark");

  // Only new files get an Ignore button: git keeps following a file it already tracks.
  assert.match(row("Alliance Grant.docx"), /aria-label="Ignore Alliance Grant\.docx"[^>]*>Ignore<\/button>/);
  assert.match(row("skin_dataset_builder/"), /title="Add skin_dataset_builder\/ to \.gitignore"/);
  assert.doesNotMatch(row("apps/api/.env"), />Ignore<\/button>/);

  // The warning is on the screen before the button is pressed, in the dialog's own words.
  assert.match(html, /<div class="projects-commit__warn" role="note"><p>Before you commit everything:<\/p>/);
  assert.match(html, /<li>apps\/api\/\.env looks like a secrets file\.<\/li>/);
  assert.match(html, /<li>skin_dataset_builder\/ \(more than 4\.0 GB in more than 2,000 files\) is very large\.<\/li>/);
  assert.match(html, /&quot;Commit all&quot; will ask first\./);
  assert.match(html, />Commit all<\/button>/);
  assert.match(html, /aria-disabled="true"[^>]*title="Select the new files to ignore\."[^>]*>Ignore selected<\/button>/);
});

test("changes: a tidy folder has no warning and no marks", () => {
  const html = render(tabs.ChangesTab, { state: repo({ workingTree: tree({ unstaged: [{ path: "src/app.ts", status: "modified" }], untracked: ["src/new.ts"] }) }), stat: null, onAsk: noop, onOpenVsCode: noop, onIgnore: noop, showIgnored: false, onToggleIgnored: noop });
  assert.doesNotMatch(html, /projects-commit__warn|secrets file|very large/);
});

test("changes: ignored files are hidden until asked for, then listed with how to change it", () => {
  const base = { stat: null, onAsk: noop, onOpenVsCode: noop, onIgnore: noop, onToggleIgnored: noop };
  const off = render(tabs.ChangesTab, { ...base, state: repo({ workingTree: tree({ untracked: ["a.txt"] }) }), showIgnored: false });
  assert.match(off, /<input type="checkbox"\/><span id="projects-ignored">Show ignored files<\/span>/);
  assert.doesNotMatch(off, /ignored by \.gitignore/);

  const reading = render(tabs.ChangesTab, { ...base, state: repo({ workingTree: tree({ untracked: ["a.txt"] }) }), showIgnored: true });
  assert.match(reading, /Reading what is ignored…/);

  const on = render(tabs.ChangesTab, { ...base, state: repo({ workingTree: { ...tree({ untracked: ["a.txt"] }), ignored: ["node_modules/", "dataset/", ".env.local"], ignoredTruncated: false } }), showIgnored: true });
  assert.match(on, /<input type="checkbox" checked=""\/>/);
  assert.match(on, /3 ignored by \.gitignore, folders as one line\. They are never committed\. To stop ignoring one, edit \.gitignore\./);
  assert.match(on, /title="dataset\/"/);
  const none = render(tabs.ChangesTab, { ...base, state: repo({ workingTree: { ...tree({ untracked: ["a.txt"] }), ignored: [], ignoredTruncated: false } }), showIgnored: true });
  assert.match(none, /Nothing in this folder is ignored\./);

  // A clean folder still offers the toggle: that is where one looks for what is hidden.
  const clean = render(tabs.ChangesTab, { ...base, state: repo(), showIgnored: false });
  assert.match(clean, /No uncommitted changes/);
  assert.match(clean, /Show ignored files/);
});

test("changes: the detail measures new files, asks for ignored ones only when shown, and ignores through the logged action", () => {
  const source = readFileSync(join(desktop, "src/renderer/views/projects/ProjectDetail.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /projectsRepoState\(project\.id, \{ allBranches, measureUntracked: true, includeIgnored: showIgnored, trackedSecrets: true \}\)/);
  assert.match(source, /props\.runAction\("projects\.ignore", \{ projectId: project\.id, paths \}\)/);
  const home = readFileSync(join(desktop, "src/renderer/views/projects/ProjectsView.tsx"), "utf8");
  assert.doesNotMatch(home, /measureUntracked/, "the home screen does not walk folders");
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

// --- Phase 10: Dev dashboard parity (F37, F49) ----------------------------------

const detailProps = (p) => ({
  bridge: bridgeMod.fallbackProjectsBridge,
  project: p,
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

test("F37: the project type the old Dev list showed is in the detail header", () => {
  assert.match(render(detail.ProjectDetail, detailProps(project("shop", { projectType: "live_website" }))), /<span class="kit-badge kit-badge--neutral">(?:(?!<\/span>).)*<\/span>Live website<\/span>/s);
  assert.doesNotMatch(render(detail.ProjectDetail, detailProps(project("shop"))), /Local app|Live website|Mobile app|External server/);
});

test("F49: git state is read again after every Run or lifecycle action, as the old Dev view did", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(join(desktop, "src/renderer/views/projects/ProjectDetail.tsx"), "utf8");
  const run = source.slice(source.indexOf("const run = async"), source.indexOf("const onRun ="));
  assert.match(run, /await props\.runAction\(actionId, params\)/);
  assert.match(run, /finally \{[\s\S]*void read\(\);/);
});
