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
