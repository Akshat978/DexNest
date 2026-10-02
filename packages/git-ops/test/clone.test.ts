// Clone, from a local bare repository (no network).

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { makeTestLink } from "@dexnest/foundation/testing";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createDataBoundary } from "@dexnest/foundation";
import { createNodeInspectFs, type GitRunResult } from "@dexnest/projects";

import { assertSafeCloneArgv, checkFolderName, cloneArgv, cloneRepository, type CloneDeps } from "../src/clone.ts";
import { world, type World } from "./helpers.ts";

let worlds: World[] = [];
afterEach(() => {
  for (const w of worlds) w.dispose();
  worlds = [];
});

function setup(runnerOverride?: CloneDeps["runner"]) {
  const w = world();
  worlds.push(w);
  const dataRoot = join(w.b.root, "DeskNest", "local-data");
  mkdirSync(dataRoot, { recursive: true });
  const boundary = createDataBoundary({ dataRoot, realpath: realpathSync.native });
  const parent = join(w.b.root, "code");
  mkdirSync(parent);
  const deps: CloneDeps = {
    runner: runnerOverride ?? w.b.runner,
    fs: createNodeInspectFs(),
    isSensitive: (p) => boundary.isSensitive(p),
    store: w.store,
    events: w.events,
    allowLocalUrls: true
  };
  return { w, dataRoot, parent, deps };
}

test("clones into a new folder under the chosen parent, logged before and after", async () => {
  const { w, parent, deps } = setup();
  const r = await cloneRepository({ url: w.bare, parentDir: parent, folderName: "shop", source: "module_ui" }, deps);
  assert.equal(r.status === "done" && r.outcome, "succeeded");
  assert.ok(existsSync(join(parent, "shop", ".git")));
  assert.equal(w.b.git(join(parent, "shop"), "log", "-1", "--format=%s").trim(), "first");
  const verbs = w.events.query({ stream: "projects" }).map((e) => [e.type, (e.payload as { verb: string }).verb]);
  assert.deepEqual(verbs, [["projects.op.started", "clone"], ["projects.op.finished", "clone"]]);
  const call = w.calls.find((c) => c.args.includes("clone"))!;
  assert.equal(call.env?.GIT_TERMINAL_PROMPT, "0");
  assert.deepEqual(call.args.slice(-5), ["clone", "--no-recurse-submodules", "--", w.bare, realpathSync.native(join(parent, "shop"))]);
});

test("refuses before any git runs: bad URLs, existing folders, the data root (also via a link), duplicates", async () => {
  const { w, parent, dataRoot, deps } = setup();
  mkdirSync(join(parent, "taken"));
  const link = join(w.b.root, "looks-fine");
  makeTestLink(dataRoot, link);
  const app = w.store.get("app")!;
  w.store.save({ ...app, git: { ...app.git, remoteUrl: "https://github.com/me/existing.git" } });
  const strict = { ...deps, allowLocalUrls: false };
  const cases: Array<[Parameters<typeof cloneRepository>[0], CloneDeps, RegExp]> = [
    [{ url: "ext::sh -c touch% /tmp/pwned", parentDir: parent, source: "module_ui" }, strict, /https or ssh|spaces/],
    [{ url: "ext::sh", parentDir: parent, source: "module_ui" }, strict, /https or ssh/],
    [{ url: "--upload-pack=evil", parentDir: parent, source: "module_ui" }, strict, /not a repository URL/],
    [{ url: "https://me:token123@github.com/me/x.git", parentDir: parent, source: "module_ui" }, strict, /Remove the username or token/],
    [{ url: "file:///etc", parentDir: parent, source: "module_ui" }, strict, /https or ssh/],
    [{ url: w.bare, parentDir: parent, folderName: "taken", source: "module_ui" }, deps, /already exists/],
    [{ url: w.bare, parentDir: parent, folderName: "../escape", source: "module_ui" }, deps, /can't contain/],
    [{ url: w.bare, parentDir: parent, folderName: "CON", source: "module_ui" }, deps, /reserved/],
    [{ url: w.bare, parentDir: join(dataRoot), folderName: "x", source: "module_ui" }, deps, /data folder/],
    [{ url: w.bare, parentDir: link, folderName: "x", source: "module_ui" }, deps, /data folder/],
    [{ url: w.bare, parentDir: join(parent, "missing"), folderName: "x", source: "module_ui" }, deps, /doesn't exist/],
    [{ url: "git@github.com:Me/Existing.git", parentDir: parent, source: "module_ui" }, strict, /already a project/]
  ];
  w.calls.length = 0;
  for (const [input, d, reason] of cases) {
    const r = await cloneRepository(input, d);
    assert.equal(r.status, "refused", input.url);
    if (r.status === "refused") assert.match(r.reason, reason, input.url);
  }
  assert.equal(w.calls.length, 0, "git never ran");
  assert.equal(existsSync(join(dataRoot, "x")), false);
});

test("clone resolves the parent folder itself, even if the boundary it was given doesn't", async () => {
  const { w, dataRoot, deps } = setup();
  const writtenOnly = createDataBoundary({ dataRoot });
  const link = join(w.b.root, "plain-looking");
  makeTestLink(dataRoot, link);
  const r = await cloneRepository({ url: w.bare, parentDir: link, folderName: "x", source: "module_ui" }, { ...deps, isSensitive: (p) => writtenOnly.isSensitive(p) });
  assert.equal(r.status, "refused");
  assert.equal(existsSync(join(dataRoot, "x")), false);
});

test("authentication needed is reported in plain words", async () => {
  const { w, parent, deps } = setup({
    run: async () => ({ exitCode: 128, stdout: "", stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled", timedOut: false, cancelled: false, truncated: false, notFound: false }) satisfies GitRunResult
  });
  void w;
  const r = await cloneRepository({ url: "https://github.com/me/private.git", parentDir: parent, source: "module_ui" }, { ...deps, allowLocalUrls: false });
  assert.equal(r.status === "done" && r.outcome, "auth_needed");
  assert.match(r.status === "done" ? r.message : "", /open a terminal/);
});

test("the clone argv validator accepts only its one shape", () => {
  assert.doesNotThrow(() => assertSafeCloneArgv(cloneArgv("https://github.com/me/x.git", "/code/x")));
  assert.throws(() => assertSafeCloneArgv(cloneArgv("ext::sh", "/code/x")));
  assert.throws(() => assertSafeCloneArgv(cloneArgv("https://github.com/me/x.git", "--template=/evil")));
  assert.throws(() => assertSafeCloneArgv(["clone", "https://github.com/me/x.git", "/code/x"]));
  const extra = cloneArgv("https://github.com/me/x.git", "/code/x");
  extra.splice(-3, 0, "--config=core.hooksPath=/evil");
  assert.throws(() => assertSafeCloneArgv(extra));
  assert.equal(checkFolderName("my repo").ok, true);
  for (const bad of ["", "a/b", "a\\b", "..", "-x", "nul.txt", "x."]) assert.equal(checkFolderName(bad).ok, false, bad);
});
