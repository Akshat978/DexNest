import { strict as assert } from "node:assert";
import { test } from "node:test";

import { attentionReasons, fetchedAgoText, groupForHome, projectBadge, type HomeEntry } from "../src/domain/badge.ts";
import { classifyWorktree } from "../src/domain/repoState.ts";
import { normaliseProjectInput, type Project } from "../src/domain/project.ts";
import { branch, NOW, repo, sha, tree, withCounts } from "./fixtures.ts";

test("one badge per project, by priority", () => {
  assert.equal(projectBadge(null).kind, "unknown");
  assert.equal(projectBadge({ isRepo: false, reason: "x", readAt: NOW }).text, "not a git repo");
  assert.equal(projectBadge(withCounts(2, 3, repo({ workingTree: tree({ conflicted: ["a", "b"] }) }))).text, "2 conflicts");
  assert.equal(projectBadge(withCounts(2, 3, repo({ inProgress: "rebase" }))).text, "rebase in progress");
  assert.equal(projectBadge(withCounts(2, 3)).text, "diverged");
  assert.equal(projectBadge(withCounts(0, 3)).text, "3 to pull");
  assert.equal(projectBadge(withCounts(2, 0, repo({ workingTree: tree({ untracked: ["x"] }) }))).text, "2 to push");
  assert.equal(projectBadge(repo({ workingTree: tree({ untracked: ["x"] }) })).text, "uncommitted changes");
  assert.equal(projectBadge(repo()).text, "all pushed");
  assert.equal(projectBadge(repo({ branches: [branch("main", { isCurrent: true, upstream: null })] })).text, "not pushed yet");
  assert.equal(projectBadge(repo({ head: { branch: null, sha: sha("d"), detached: true, unborn: false } })).text, "detached HEAD");
});

test("fetched N minutes ago - remote state is only as fresh as the last fetch", () => {
  assert.equal(fetchedAgoText(null, NOW), "never fetched");
  assert.equal(fetchedAgoText("2026-10-01T11:59:40.000Z", NOW), "fetched just now");
  assert.equal(fetchedAgoText("2026-10-01T11:59:00.000Z", NOW), "fetched 1 minute ago");
  assert.equal(fetchedAgoText("2026-10-01T11:56:00.000Z", NOW), "fetched 4 minutes ago");
  assert.equal(fetchedAgoText("2026-10-01T09:00:00.000Z", NOW), "fetched 3 hours ago");
  assert.equal(fetchedAgoText("2026-09-28T12:00:00.000Z", NOW), "fetched 3 days ago");
  assert.equal(fetchedAgoText("garbage", NOW), "never fetched");
});

function project(name: string, extra: Partial<Project> = {}): Project {
  const result = normaliseProjectInput({ name, path: `/p/${name}` }, { existing: null, takenIds: new Set(), now: "2026-09-01T00:00:00.000Z", newCommandId: () => "c" });
  if (!result.ok) throw new Error(result.error);
  return { ...result.project, ...extra };
}

test("home: needs attention first, then favourites/pinned, then the rest by activity; archived hidden", () => {
  const entries: HomeEntry[] = [
    { project: project("quiet", { lastActivityAt: "2026-09-10T00:00:00.000Z" }), state: repo() },
    { project: project("recent", { lastActivityAt: "2026-09-30T00:00:00.000Z" }), state: repo() },
    { project: project("fav", { favourite: true }), state: repo() },
    { project: project("push-me"), state: withCounts(1, 0) },
    { project: project("sick"), state: repo(), healthFailing: true },
    { project: project("old", { archivedAt: "2026-01-01T00:00:00.000Z" }), state: withCounts(5, 5) }
  ];
  const groups = groupForHome(entries, { now: NOW, staleDays: 30, sort: "activity" });
  assert.deepEqual(groups.map((g) => [g.section, g.entries.map((e) => e.project.name)]), [
    ["attention", ["push-me", "sick"]],
    ["favourites", ["fav"]],
    ["all", ["recent", "quiet"]]
  ]);
  const byName = groupForHome(entries, { now: NOW, staleDays: 30, sort: "name" });
  assert.deepEqual(byName.at(-1)!.entries.map((e) => e.project.name), ["quiet", "recent"]);
});

test("a stale branch with unpushed work needs attention; a stale, fully pushed one does not", () => {
  const staleCommit = "2026-08-01T00:00:00.000Z";
  const stalePushed = repo({ branches: [branch("main", { isCurrent: true, lastCommitAt: staleCommit })] });
  assert.deepEqual(attentionReasons({ project: project("a"), state: stalePushed }, NOW, 30), []);
  const staleDirty = { ...stalePushed, workingTree: tree({ untracked: ["x"] }) };
  assert.deepEqual(attentionReasons({ project: project("a"), state: staleDirty }, NOW, 30).map((r) => r.kind), ["stale"]);
});

test("worktrees are recognised as Autopilot's by folder or branch", () => {
  assert.equal(classifyWorktree("D:\\code\\dexnest-worktrees\\coding-run-1", "anything", false), "autopilot");
  assert.equal(classifyWorktree("/code/wt", "autopilot/coding-run-1", false), "autopilot");
  assert.equal(classifyWorktree("/code/wt", "dexnest/run-2", false), "autopilot");
  assert.equal(classifyWorktree("/code/wt", "feature", false), "other");
  assert.equal(classifyWorktree("/code/dexnest-worktrees/x", "autopilot/x", true), "self");
});
