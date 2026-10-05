/**
 * The Projects leftovers on the screen side: the tracked-secrets warning and
 * the watched import folders. (Bringing any branch level is in
 * projectBranches.test.ts, and in the projects and git-ops packages.)
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { toggleWatched, trackedSecretsNote, watchCheckMessage } from "../src/renderer/views/projects/projectsModel.ts";
import { repo } from "../../../packages/projects/test/fixtures.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("tracked secrets: said plainly, with the files, why ignoring is not enough, and the one command", () => {
  assert.equal(trackedSecretsNote(null), null);
  assert.equal(trackedSecretsNote(repo()), null, "not asked for, nothing said");
  assert.equal(trackedSecretsNote({ ...repo(), trackedSecrets: { paths: [], more: 0 } }), null, "none found, nothing said");

  const one = trackedSecretsNote({ ...repo(), trackedSecrets: { paths: [".env"], more: 0 } })!;
  assert.equal(one.title, "Git is tracking a file that looks like a secret");
  assert.deepEqual(one.paths, [".env"]);
  assert.equal(one.command, 'git rm --cached -- ".env"');
  assert.match(one.lines.join(" "), /does not stop git following it/);
  assert.match(one.lines.join(" "), /keep the file on this PC/);
  assert.match(one.lines.join(" "), /already in the history stays there/);
  assert.match(one.lines.join(" "), /change them/);

  const many = trackedSecretsNote({ ...repo(), trackedSecrets: { paths: ["config/.env.production", "keys/id_rsa"], more: 5 } })!;
  assert.equal(many.title, "Git is tracking 7 files that look like secrets");
  assert.equal(many.more, 5);
  assert.equal(many.command, 'git rm --cached -- "config/.env.production"');
  // A name with a quote in it cannot break out of the command shown.
  assert.equal(trackedSecretsNote({ ...repo(), trackedSecrets: { paths: ['a".env'], more: 0 } })!.command, 'git rm --cached -- "a\\".env"');
});

test("tracked secrets: asked for only on a project's own page, shown on Changes, and DexNest runs nothing", () => {
  assert.match(read("../src/renderer/views/projects/ProjectDetail.tsx"), /includeIgnored: showIgnored, trackedSecrets: true \}/);
  const host = read("../src/main/projectsHost.ts");
  assert.match(host, /trackedSecrets: opt\(o\)\.trackedSecrets === true \}/);
  const everyProject = host.slice(host.indexOf('handle("dexnest:projects-repo-states"')).split("\n")[0]!;
  assert.doesNotMatch(everyProject, /trackedSecrets/, "the home screen's read of every project does not list files");
  const tabs = read("../src/renderer/views/projects/DetailTabs.tsx");
  assert.match(tabs, /\{secrets && \(\s*<div className="projects-commit__warn" role="note" aria-label="Tracked files that look like secrets">/);
  assert.match(tabs, /<Technical>\{secrets\.command\}<\/Technical>/);
  assert.doesNotMatch(tabs, /rm --cached|"rm"/, "the command is shown, never run from here");
});

test("watched folders: what was added is said once, by name", () => {
  assert.equal(watchCheckMessage(null), null);
  assert.equal(watchCheckMessage({ ran: false, added: [], truncated: false }), null, "skipped: nothing to say");
  assert.equal(watchCheckMessage({ ran: true, added: [], truncated: false }), null, "looked, found nothing new: nothing to say");
  assert.equal(watchCheckMessage({ ran: true, added: [{ name: "alpha" }], truncated: false }), "Added 1 new project from a watched folder: alpha.");
  assert.equal(watchCheckMessage({ ran: true, added: [{ name: "a" }, { name: "b" }, { name: "c" }], truncated: false }), "Added 3 new projects from watched folders: a, b, c.");
  assert.equal(watchCheckMessage({ ran: true, added: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }], truncated: false }), "Added 5 new projects from watched folders: a, b, c and 2 more.");
  assert.match(watchCheckMessage({ ran: true, added: [{ name: "a" }], truncated: true }) ?? "", /some may have been missed; use Import projects/);
});

test("watched folders: switched on and off one at a time", () => {
  assert.deepEqual(toggleWatched([], "D:\\code", true), ["D:\\code"]);
  assert.deepEqual(toggleWatched(["D:\\code"], "D:\\code", true), ["D:\\code"], "not twice");
  assert.deepEqual(toggleWatched(["D:\\code", "D:\\work"], "D:\\code", false), ["D:\\work"]);
  assert.deepEqual(toggleWatched(["D:\\work"], "D:\\code", false), ["D:\\work"]);
});

test("watched folders: looked in when Projects is opened, never on a timer, and offered where folders are remembered", () => {
  const view = read("../src/renderer/views/projects/ProjectsView.tsx");
  assert.match(view, /void \(bridge\.projectsCheckWatched\?\.\(\) \?\? Promise\.resolve\(null\)\)\.then\(/);
  assert.match(view, /onWatch=\{\(root, on\) => void bridge\.projectsUpdateSettings\(\{ watchedRoots: toggleWatched\(settings\.watchedRoots \?\? \[\], root, on\) \}\)/);
  const host = read("../src/main/projectsHost.ts");
  assert.match(host, /handle\("dexnest:projects-check-watched", \(o\) => projects\.checkWatchedFolders\(\{ force: opt\(o\)\.force === true \}\)\);/);
  const module = read("../../../packages/projects/src/module/runtime.ts");
  const check = module.slice(module.indexOf("async checkWatchedFolders"), module.indexOf("async importFolders"));
  assert.doesNotMatch(check, /setInterval|setTimeout|scheduler/, "nothing schedules it");
  assert.match(check, /if \(!options\.folderScan \|\| current\.watchedRoots\.length === 0\) return none;/);
  assert.match(check, /\.slice\(0, WATCH_ADD_LIMIT\)/);
  const dialog = read("../src/renderer/views/projects/ImportProjectsDialog.tsx");
  assert.match(dialog, /It never checks in the background, and a project you remove is not added back\./);
  assert.match(dialog, /<input type="checkbox" checked=\{watchedRoots\.includes\(root\)\} onChange=\{\(e\) => onWatch\(root, e\.target\.checked\)\} \/>/);
});
