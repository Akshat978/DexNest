// What the Projects screen says about branches: what they are compared with,
// which is deployed, and which can be moved forward without switching.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { terminalProgramName } from "../../../packages/projects/src/node/launch.ts";
import { availability, branchRows, branchSummary, defaultBaseLabel, deployedSummary, staleDefaultNote } from "../src/renderer/views/projects/projectsModel.ts";
import { NOW, branch, remoteBranch, repo } from "../../../packages/projects/test/fixtures.ts";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The dermassist shape: on develop, local main 26 behind origin/main, staging merged. */
function dermassist(extra: Parameters<typeof repo>[0] = {}) {
  const develop = branch("develop", { isCurrent: true, vsDefault: { ahead: 6, behind: 0 }, mergedIntoDefault: false });
  return repo({
    head: { branch: "develop", sha: develop.tipSha, detached: false, unborn: false },
    defaultBase: "origin/main",
    branches: [
      develop,
      branch("main", { upstream: { ref: "origin/main", remote: "origin", branch: "main", gone: false, counts: { ahead: 0, behind: 26 } } }),
      branch("staging", { vsDefault: { ahead: 0, behind: 26 }, mergedIntoDefault: true })
    ],
    remoteBranches: [remoteBranch("main", { trackedBy: "main" }), remoteBranch("develop", { trackedBy: "develop" }), remoteBranch("staging", { trackedBy: "staging" })],
    ...extra
  });
}

const row = (state: ReturnType<typeof repo>, name: string) => branchRows(state, NOW, 30).find((r) => r.name === name)!;

test("the comparison column is named for what it compares with, and says why when that is the remote", () => {
  assert.equal(defaultBaseLabel(dermassist()), "origin/main");
  assert.equal(staleDefaultNote(dermassist()), "main on this PC is 26 commits behind origin/main, so branches are compared with origin/main.");
  // Up to date: compared with main, nothing to explain.
  assert.equal(defaultBaseLabel(repo()), "main");
  assert.equal(staleDefaultNote(repo()), null);
  assert.equal(defaultBaseLabel(null), "default");
  assert.equal(defaultBaseLabel(repo({ defaultBranch: null, defaultBase: null })), "default");
});

test("a branch behind its upstream that you are not on can be updated in place; the one you are on cannot", () => {
  const state = dermassist();
  assert.deepEqual(row(state, "main").update, { kind: "fast_forward", branch: "main" });
  assert.equal(availability(state, row(state, "main").update!), null, "allowed: it only moves forward");
  assert.equal(row(state, "develop").update, null, "the current branch uses Pull");
  assert.equal(row(state, "staging").update, null, "in sync with its upstream");
});

test("the default branch can be brought up to the branch you are on, and only it", () => {
  const state = dermassist();
  assert.deepEqual(row(state, "main").bringUp, { request: { kind: "fast_forward", branch: "main", from: "develop" }, label: "Bring up to develop" });
  assert.equal(availability(state, row(state, "main").bringUp!.request), null);
  assert.equal(row(state, "staging").bringUp, null);
  assert.equal(row(state, "develop").bringUp, null);
  // On the default branch itself there is nothing to bring it up to.
  assert.equal(row(repo(), "main").bringUp, null);
  // When main has commits develop lacks, the button says why it cannot.
  const diverged = dermassist();
  diverged.branches[0] = { ...diverged.branches[0], vsDefault: { ahead: 6, behind: 2 } };
  assert.match(availability(diverged, row(diverged, "main").bringUp!.request) ?? "", /main has 2 commits that develop doesn't/);
});

test("the deployed branch is marked, and every branch says how far it is from what is live", () => {
  const plain = dermassist();
  assert.equal(row(plain, "develop").deployed, false);
  assert.equal(row(plain, "develop").vsDeployed, "", "nothing marked: no column to fill");

  const state = dermassist({ deployed: { branch: "develop", base: "origin/develop" } });
  state.branches = state.branches.map((b) => (b.name === "main" ? { ...b, vsDeployed: { ahead: 0, behind: 32 } } : b.name === "staging" ? { ...b, vsDeployed: { ahead: 0, behind: 32 } } : { ...b, vsDeployed: null }));
  assert.equal(row(state, "develop").deployed, true);
  assert.equal(row(state, "develop").vsDeployed, "live");
  assert.equal(row(state, "main").deployed, false);
  assert.equal(row(state, "main").vsDeployed, "32 behind");

  // On the deployed branch with a commit not pushed: that commit is not live.
  state.branches = state.branches.map((b) => (b.name === "develop" ? { ...b, vsDeployed: { ahead: 1, behind: 0 } } : b));
  assert.equal(row(state, "develop").vsDeployed, "1 ahead");

  // A marked branch that no longer exists is not compared with anything.
  const gone = dermassist({ deployed: { branch: "release", base: null } });
  assert.equal(row(gone, "develop").vsDeployed, "");
});

test("a card says how many branches there are and which is furthest ahead", () => {
  assert.equal(branchSummary(dermassist()), "3 branches · develop 6 ahead of origin/main");
  assert.equal(branchSummary(repo()), null, "one branch: nothing to add");
  const level = repo({ branches: [branch("main", { isCurrent: true }), branch("old", { vsDefault: { ahead: 0, behind: 4 } })] });
  assert.equal(branchSummary(level), "2 branches");
  assert.equal(branchSummary(null), null);
});

test("a card says which branch is live, and how much of the current branch is not", () => {
  assert.equal(deployedSummary(dermassist(), null), null, "not a deployed project");
  const state = dermassist({ deployed: { branch: "main", base: "origin/main" } });
  state.branches = state.branches.map((b) => (b.name === "develop" ? { ...b, vsDeployed: { ahead: 6, behind: 0 } } : b));
  assert.equal(deployedSummary(state, "main"), "live: main · 6 not live");
  assert.equal(deployedSummary(dermassist({ deployed: { branch: "develop", base: "origin/develop" } }), "develop"), "live: develop");
  assert.equal(deployedSummary(null, "develop"), "live: develop", "before git state is read");
});

test("the terminal is named for what was started, and the message says where to look", () => {
  assert.equal(terminalProgramName("C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe"), "Windows Terminal");
  assert.equal(terminalProgramName("powershell.exe"), "PowerShell");
  assert.equal(terminalProgramName("/usr/bin/gnome-terminal"), "gnome-terminal");
  const runtime = readSource("../../../packages/projects/src/module/runtime.ts");
  assert.match(runtime, /Started \$\{terminalName\} in \$\{project\.name\}\. If it didn't come to the front, it's in the taskbar\./);
  assert.doesNotMatch(runtime, /Opened a terminal for/, "it no longer claims a window opened");
});

test("a long project name wraps before it is cut, and the full name is the tooltip", () => {
  const css = readSource("../src/renderer/views/projects/Projects.css");
  const rule = /\.projects-card__name \{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.match(rule, /-webkit-line-clamp: 2;/);
  assert.doesNotMatch(rule, /white-space: nowrap/);
  assert.match(readSource("../src/renderer/views/projects/ProjectCard.tsx"), /title=\{project\.name\}/);
});
