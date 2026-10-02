// The Projects view's decisions, without React.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { normaliseProjectInput, type Project } from "@dexnest/projects/domain";

import {
  DEFAULT_FILTERS,
  filterEntries,
  formFromInput,
  formProblems,
  headerSummary,
  homeSections,
  inputFromForm,
  isSearchShortcut,
  moveFocus,
  quickActions,
  branchLine,
  type ViewEntry
} from "../src/renderer/views/projects/projectsModel.ts";
import { NOW, branch, repo, stash, tree, withCounts } from "../../../packages/projects/test/fixtures.ts";

function project(name: string, extra: Partial<Project> = {}): Project {
  const r = normaliseProjectInput({ name, path: `/code/${name}` }, { existing: null, takenIds: new Set(), now: "2026-09-01T00:00:00.000Z", newCommandId: () => "c" });
  if (!r.ok) throw new Error(r.error);
  return { ...r.project, ...extra };
}

const reason = (entry: ViewEntry, id: string) => quickActions(entry).find((a) => a.id === id)!.disabledReason;

test("quick buttons are disabled for exactly the reason the operation would be refused", () => {
  const behind: ViewEntry = { project: project("a"), state: withCounts(0, 2) };
  assert.equal(reason(behind, "push"), "origin/main has 2 commits you don't have. Pull first.");
  assert.equal(reason(behind, "pull"), null);
  const diverged: ViewEntry = { project: project("b"), state: withCounts(1, 1) };
  assert.match(reason(diverged, "pull")!, /diverged/);
  assert.match(reason(diverged, "push")!, /never force-pushes/);
  const ahead: ViewEntry = { project: project("c"), state: withCounts(3, 0) };
  assert.equal(reason(ahead, "push"), null);
  const noRemote: ViewEntry = { project: project("d"), state: repo({ remotes: [] }) };
  assert.equal(reason(noRemote, "fetch"), "This repository has no remote.");
  const notGit: ViewEntry = { project: project("e"), state: { isRepo: false, reason: "Not a git repository.", readAt: NOW } };
  assert.equal(reason(notGit, "push"), "Not a git repository.");
  assert.equal(reason(notGit, "vscode"), null, "VS Code still opens a plain folder");
  const gone: ViewEntry = { project: project("f"), state: { isRepo: false, reason: "Folder not found.", readAt: NOW } };
  assert.equal(reason(gone, "vscode"), "The project folder doesn't exist.");
  assert.equal(reason({ project: project("g"), state: null }, "pull"), "Reading git state…");
  assert.match(reason({ project: project("h"), state: null, readError: "timeout" }, "pull")!, /timeout/);
  assert.equal(reason({ ...ahead, busy: true }, "push"), "An operation is running in this project.");
});

test("filters: search across name, path, branch, tags and remote; group, tag and status", () => {
  const entries: ViewEntry[] = [
    { project: project("shop", { tags: ["work"], groupId: "g1" }), state: withCounts(1, 0) },
    { project: project("blog", { tags: ["side"] }), state: repo({ workingTree: tree({ untracked: ["x"] }) }) },
    { project: project("notes", { favourite: true }), state: { isRepo: false, reason: "Not a git repository.", readAt: NOW } }
  ];
  const names = (filters: Partial<typeof DEFAULT_FILTERS>) => filterEntries(entries, { ...DEFAULT_FILTERS, ...filters }, NOW, 30).map((e) => e.project.name);
  assert.deepEqual(names({ query: "SHO" }), ["shop"]);
  assert.deepEqual(names({ query: "/code/blog" }), ["blog"]);
  assert.deepEqual(names({ query: "main" }), ["shop", "blog"], "branch names match");
  assert.deepEqual(names({ tag: "side" }), ["blog"]);
  assert.deepEqual(names({ group: "g1" }), ["shop"]);
  assert.deepEqual(names({ group: "none" }), ["blog", "notes"]);
  assert.deepEqual(names({ status: "to_push" }), ["shop"]);
  assert.deepEqual(names({ status: "uncommitted" }), ["blog"]);
  assert.deepEqual(names({ status: "not_git" }), ["notes"]);
  assert.deepEqual(names({ status: "attention" }), ["shop"]);
  assert.deepEqual(names({ status: "favourites" }), ["notes"]);
  const sections = homeSections(entries, DEFAULT_FILTERS, NOW, 30).map((s) => [s.section, s.entries.map((e) => e.project.name)]);
  assert.deepEqual(sections, [["attention", ["shop"]], ["favourites", ["notes"]], ["all", ["blog"]]]);
});

test("header and card lines", () => {
  const entries: ViewEntry[] = [
    { project: project("a"), state: withCounts(2, 0) },
    { project: project("b"), state: repo({ lastFetchAt: "2026-10-01T11:58:00.000Z" }) },
    { project: project("c", { archivedAt: NOW }), state: null }
  ];
  assert.equal(headerSummary(entries, NOW, 30), "2 projects · 1 needs attention · fetched 2 minutes ago");
  const busy = repo({
    workingTree: tree({ unstaged: [{ path: "a", status: "modified" }], untracked: ["b"] }),
    stashes: [stash(0)],
    worktrees: [...repo().worktrees, { path: "/x/dexnest-worktrees/r", headSha: null, branch: "autopilot/r", isMain: false, isCurrent: false, owner: "autopilot", locked: false, prunable: false }]
  });
  assert.equal(branchLine(busy), "main · 2 changed · 1 stashed · 1 Autopilot worktree");
  assert.equal(branchLine(repo({ head: { branch: null, sha: "abcdef1234", detached: true, unborn: false }, branches: [branch("main")] })), "detached at abcdef1");
});

test("keyboard: arrows move through the grid, Home/End jump; '/' focuses search unless typing", () => {
  assert.equal(moveFocus(0, "ArrowRight", 10, 3), 1);
  assert.equal(moveFocus(1, "ArrowDown", 10, 3), 4);
  assert.equal(moveFocus(8, "ArrowDown", 10, 3), 9);
  assert.equal(moveFocus(1, "ArrowUp", 10, 3), 0);
  assert.equal(moveFocus(0, "ArrowLeft", 10, 3), 0);
  assert.equal(moveFocus(4, "End", 10, 3), 9);
  assert.equal(moveFocus(4, "Home", 10, 3), 0);
  assert.equal(moveFocus(4, "a", 10, 3), null);
  assert.equal(moveFocus(0, "ArrowDown", 0, 3), null);
  assert.equal(isSearchShortcut("/", "DIV", false), true);
  assert.equal(isSearchShortcut("/", "INPUT", false), false);
  assert.equal(isSearchShortcut("/", "TEXTAREA", false), false);
  assert.equal(isSearchShortcut("/", "DIV", true), false);
  assert.equal(isSearchShortcut("?", "DIV", false), false);
});

test("the project form round-trips the wizard's draft, and says what stops Save", () => {
  const draft = {
    name: "Shop",
    path: "D:\\code\\shop",
    description: "store",
    accent: "dev",
    projectType: "local_app",
    tags: ["work", "client"],
    commands: { start: "pnpm run dev", build: "pnpm run build" },
    commandList: [{ id: "deploy", label: "deploy", command: "pnpm run deploy", requiresConfirmation: true }],
    ports: [5173, 3000],
    localUrls: ["http://localhost:5173"],
    links: [{ label: "Docs", url: "https://docs.example" }],
    folders: [{ label: "API", path: "D:\\code\\shop\\api" }]
  };
  const form = formFromInput(draft);
  assert.equal(form.links, "Docs | https://docs.example");
  const back = inputFromForm(form);
  assert.deepEqual(back.links, draft.links);
  assert.deepEqual(back.folders, draft.folders);
  assert.deepEqual(back.tags, ["work", "client"]);
  assert.deepEqual(back.ports, ["5173", "3000"]);
  assert.deepEqual(back.commandList, draft.commandList);
  assert.deepEqual(formProblems(form), []);
  assert.deepEqual(formProblems({ ...form, name: " ", ports: "80, 70000, x", localUrls: "localhost:3000" }), [
    "Give the project a name.",
    "Ports must be numbers from 1 to 65535 (70000, x).",
    "localhost:3000 isn't an http(s) URL."
  ]);
});

// --- Phase 8: the project detail -------------------------------------------------

import {
  availability,
  branchRows,
  changeRows,
  detailShortcut,
  lifecycleActions,
  operationLines,
  runCommands
} from "../src/renderer/views/projects/projectsModel.ts";
import { remoteBranch } from "../../../packages/projects/test/fixtures.ts";

test("detail shortcuts: F/P/U open the dialog, 1-7 switch tabs, Esc goes back - never while typing or with modifiers", () => {
  assert.deepEqual(detailShortcut("f", "DIV", false), { kind: "op", request: { kind: "fetch" } });
  assert.deepEqual(detailShortcut("P", "BODY", false), { kind: "op", request: { kind: "pull" } });
  assert.deepEqual(detailShortcut("u", "BUTTON", false), { kind: "op", request: { kind: "push" } });
  assert.deepEqual(detailShortcut("3", "DIV", false), { kind: "tab", tab: "changes" });
  assert.deepEqual(detailShortcut("7", "DIV", false), { kind: "tab", tab: "settings" });
  assert.deepEqual(detailShortcut("Escape", "DIV", false), { kind: "back" });
  assert.equal(detailShortcut("8", "DIV", false), null);
  assert.equal(detailShortcut("f", "INPUT", false), null);
  assert.equal(detailShortcut("f", "TEXTAREA", false), null);
  assert.equal(detailShortcut("f", "DIV", true), null);
  assert.equal(detailShortcut("f", "DIV", false, true), null, "Ctrl+F stays the browser's");
});

test("availability: refusals the dialog can resolve (stash and switch, push and set upstream) still open it", () => {
  const dirty = repo({ branches: [branch("main", { isCurrent: true }), branch("other")], workingTree: tree({ unstaged: [{ path: "a", status: "modified" }] }) });
  assert.equal(availability(dirty, { kind: "switch", branch: "other" }), null);
  const noUp = repo({ branches: [branch("main", { isCurrent: true, upstream: null })] });
  assert.equal(availability(noUp, { kind: "push" }), null);
  assert.match(availability(withCounts(1, 1), { kind: "push" })!, /never force-pushes/);
  assert.equal(availability(null, { kind: "push" }), "Reading git state…");
  assert.equal(availability({ isRepo: false, reason: "Not a git repository.", readAt: NOW }, { kind: "fetch" }), "Not a git repository.");
});

test("branch rows: current first, then by recency; remote-only branches after; gone, stale and Autopilot marked", () => {
  const state = repo({
    branches: [
      branch("main", { isCurrent: true }),
      branch("old", { lastCommitAt: "2026-01-01T00:00:00.000Z", upstream: { ref: "origin/old", remote: "origin", branch: "old", gone: true, counts: null } }),
      branch("fresh", { lastCommitAt: "2026-09-30T23:00:00.000Z", upstream: null, vsDefault: { ahead: 2, behind: 1 }, mergedIntoDefault: false }),
      branch("autopilot/run-1", { checkedOutElsewhere: { path: "/w/dexnest-worktrees/run-1", owner: "autopilot" } })
    ],
    remoteBranches: [remoteBranch("main", { trackedBy: "main" }), remoteBranch("theirs", { lastCommitAt: "2026-09-29T00:00:00.000Z" })]
  });
  const rows = branchRows(state, NOW, 30);
  assert.deepEqual(rows.map((r) => r.key), ["l:main", "l:fresh", "l:autopilot/run-1", "l:old", "r:origin/theirs"]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by["l:main"].vsDefault, "default");
  assert.equal(by["l:fresh"].vsUpstream, "local only");
  assert.equal(by["l:fresh"].vsDefault, "2 ahead · 1 behind");
  assert.equal(by["l:old"].vsUpstream, "upstream gone");
  assert.equal(by["l:old"].stale, true);
  assert.equal(by["l:autopilot/run-1"].elsewhere, "autopilot");
  assert.equal(by["r:origin/theirs"].vsUpstream, "remote only");
});

test("change rows: conflicts first, then staged, changed and new; line counts from the diff stat", () => {
  const state = repo({ workingTree: tree({ conflicted: ["c.ts"], staged: [{ path: "s.ts", status: "added" }], unstaged: [{ path: "u.ts", status: "modified" }], untracked: ["n.ts"] }) });
  const rows = changeRows(state, { staged: [{ path: "s.ts", added: 10, deleted: 0 }], unstaged: [{ path: "u.ts", added: 2, deleted: 3 }] });
  assert.deepEqual(rows.map((r) => [r.group, r.path, r.status, r.added, r.deleted]), [
    ["conflicted", "c.ts", "U", null, null],
    ["staged", "s.ts", "A", 10, 0],
    ["unstaged", "u.ts", "M", 2, 3],
    ["untracked", "n.ts", "?", null, null]
  ]);
});

test("Run tab parity with the Dev dashboard: the same action ids, confirmation and lifecycle conditions", () => {
  const p = project("shop", {
    commands: { start: "pnpm dev", build: "pnpm build", test: "", typecheck: "tsc", custom: "rm -rf dist" },
    commandList: [{ id: "deploy", label: "Deploy", command: "pnpm deploy", requiresConfirmation: true }, { id: "lint", label: "Lint", command: "pnpm lint", requiresConfirmation: false }]
  });
  assert.deepEqual(runCommands(p).map((c) => [c.actionId, c.label, c.confirm]), [
    ["dev.project.shop.run_start", "dev", false],
    ["dev.project.shop.run_build", "build", false],
    ["dev.project.shop.run_typecheck", "typecheck", false],
    ["dev.project.shop.run_custom", "custom", true],
    ["dev.project.shop.run_cmd_deploy", "Deploy", true],
    ["dev.project.shop.run_cmd_lint", "Lint", false]
  ]);
  assert.deepEqual(lifecycleActions(project("bare")), []);
  assert.deepEqual(lifecycleActions(project("x", { commands: { start: "go", build: "", test: "", typecheck: "", custom: "" } })).map((a) => a.op), ["stop", "restart", "check_health"]);
  const full = lifecycleActions(project("y", { ports: [3000], dockerCompose: true, logPath: "a.log", localUrls: ["http://localhost:3000"] }));
  assert.deepEqual(full.map((a) => [a.op, a.dangerous]), [
    ["stop", true], ["restart", true], ["check_health", false], ["kill_ports", true], ["show_processes", false], ["docker_down", true], ["open_logs", false], ["open_urls", false]
  ]);
});

test("recent operations: only the latest finished one can be undone, and only once", () => {
  const rec = (id: string, state: string, undo: unknown, undoneBy: string | null = null) => ({ id, verb: "commit", outcome: state, state, startedAt: NOW, undo, undoneBy });
  assert.deepEqual(operationLines([rec("b", "succeeded", { kind: "uncommit" }), rec("a", "succeeded", { kind: "x" })]).map((l) => l.undoable), [true, false]);
  assert.deepEqual(operationLines([rec("c", "refused", null), rec("b", "succeeded", { kind: "uncommit" })]).map((l) => l.undoable), [false, true], "a refusal isn't an operation that ran");
  assert.deepEqual(operationLines([rec("b", "failed", null), rec("a", "succeeded", { kind: "x" })]).map((l) => l.undoable), [false, false]);
  assert.deepEqual(operationLines([rec("a", "succeeded", { kind: "x" }, "u1")]).map((l) => [l.undoable, l.undone]), [[false, true]]);
});

test("archived projects appear only under Archived", () => {
  const entries: ViewEntry[] = [{ project: project("live"), state: repo() }, { project: project("old", { archivedAt: NOW }), state: null }];
  assert.deepEqual(filterEntries(entries, DEFAULT_FILTERS, NOW, 30).map((e) => e.project.name), ["live"]);
  assert.deepEqual(homeSections(entries, { ...DEFAULT_FILTERS, status: "archived" }, NOW, 30).map((s) => s.entries.map((e) => e.project.name)), [["old"]]);
});
