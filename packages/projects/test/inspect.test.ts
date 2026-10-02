// The add-project inspector, duplicates, the data-root refusal and DI
// suggestions - synthetic folders in temp directories only.

import { strict as assert } from "node:assert";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createDataBoundary } from "@dexnest/foundation";
import { createTestDatabase, type TestDatabase, makeTestLink } from "@dexnest/foundation/testing";

import { detectFramework, detectPorts, suggestCommands } from "../src/inspect/detect.ts";
import { addSuggestions, inspectFolder, listSuggestions, saveInspectedProject, type InspectDeps } from "../src/inspect/inspect.ts";
import { createNodeInspectFs } from "../src/node/inspectFs.ts";
import { createProjectsStore, runProjectsMigrations, type ProjectsStore } from "../src/store/store.ts";
import { sandbox, type Sandbox } from "./gitRepos.ts";

interface Env {
  b: Sandbox;
  dataRoot: string;
  db: TestDatabase;
  store: ProjectsStore;
  deps: InspectDeps & { store: ProjectsStore };
}

let envs: Env[] = [];
afterEach(() => {
  for (const e of envs) {
    e.db.dispose();
    e.b.dispose();
  }
  envs = [];
});

function env(): Env {
  const b = sandbox("dexnest-inspect-");
  const dataRoot = join(b.root, "DeskNest", "local-data");
  mkdirSync(join(dataRoot, "files", "vault"), { recursive: true });
  writeFileSync(join(dataRoot, "files", "vault", "secret.txt"), "vault bait");
  const db = createTestDatabase("dexnest-inspect-db-");
  runProjectsMigrations(db.db);
  const store = createProjectsStore(db.db);
  const boundary = createDataBoundary({ dataRoot, realpath: realpathSync.native });
  const e: Env = { b, dataRoot, db, store, deps: { fs: createNodeInspectFs(), reader: b.reader(), isSensitive: (p) => boundary.isSensitive(p), store } };
  envs.push(e);
  return e;
}

let c = 0;
const ctx = () => ({ now: "2026-10-01T00:00:00.000Z", newCommandId: () => `cmd_${++c}` });

function nodeApp(e: Env, name: string, pkg: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const dir = join(e.b.root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [file, text] of Object.entries(extra)) writeFileSync(join(dir, file), text);
  return dir;
}

test("a Vite + pnpm app is pre-filled: name, scripts as commands, framework, ports, workspace file", async () => {
  const e = env();
  const dir = nodeApp(
    e,
    "my-app",
    {
      name: "@me/shop-front",
      description: "The shop",
      scripts: { dev: "vite --port 5180", build: "vite build", test: "vitest", typecheck: "tsc --noEmit", lint: "eslint .", deploy: "wrangler deploy", predev: "x" },
      devDependencies: { vite: "^5", react: "^18" }
    },
    { "pnpm-lock.yaml": "", "shop.code-workspace": "{}", ".env": "PORT=9999\nAPI_KEY=sk-live-BAIT\n", ".env.example": "PORT=4000\n" }
  );
  const r = await inspectFolder(dir, e.deps);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.draft.name, "shop-front");
  assert.equal(r.draft.description, "The shop");
  assert.deepEqual(r.draft.commands, { start: "pnpm run dev", build: "pnpm run build", test: "pnpm run test", typecheck: "pnpm run typecheck" });
  assert.deepEqual(r.draft.commandList?.map((cmd) => [cmd.label, cmd.command, cmd.requiresConfirmation]), [
    ["lint", "pnpm run lint", false],
    ["deploy", "pnpm run deploy", true]
  ]);
  assert.deepEqual(r.facts, {
    isRepo: false, remoteName: null, remoteUrl: null, hosting: null, defaultBranch: null,
    packageManager: "pnpm", framework: "Vite", workspaceFile: "shop.code-workspace", ports: [5180, 4000], scripts: 7
  });
  assert.deepEqual(r.draft.localUrls, ["http://localhost:5180", "http://localhost:4000"]);
  assert.equal(JSON.stringify(r).includes("9999"), false, ".env is never read");
  assert.equal(JSON.stringify(r).includes("BAIT"), false);
});

test("a git repo: remote (token stripped), GitHub owner/repo and default branch are filled in", async () => {
  const e = env();
  const { app } = e.b.origin();
  e.b.git(app, "remote", "set-url", "origin", "https://me:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/me/shop.git");
  const r = await inspectFolder(app, e.deps);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.facts.isRepo, true);
  assert.equal(r.facts.remoteUrl, "https://github.com/me/shop.git");
  assert.deepEqual(r.facts.hosting, { kind: "github", owner: "me", repo: "shop" });
  assert.equal(r.facts.defaultBranch, "main");
  assert.equal(r.draft.name, "shop", "no package.json: named after the GitHub repo");
  assert.equal(JSON.stringify(r).includes("ghp_"), false);
});

test("refused: inside the data root by path, through a symlink, a missing path, a file, a drive root", async () => {
  const e = env();
  const inside = await inspectFolder(join(e.dataRoot, "files", "vault"), e.deps);
  assert.equal(inside.kind === "refused" && inside.code, "data_root");
  const link = join(e.b.root, "innocent-looking");
  makeTestLink(join(e.dataRoot, "files"), link);
  const viaLink = await inspectFolder(link, e.deps);
  assert.equal(viaLink.kind === "refused" && viaLink.code, "data_root");
  const nested = await inspectFolder(join(link, "vault"), e.deps);
  assert.equal(nested.kind === "refused" && nested.code, "data_root");
  assert.equal((await inspectFolder(join(e.b.root, "nope"), e.deps)).kind === "refused", true);
  writeFileSync(join(e.b.root, "file.txt"), "x");
  const file = await inspectFolder(join(e.b.root, "file.txt"), e.deps);
  assert.equal(file.kind === "refused" && file.code, "not_a_folder");
  const root = await inspectFolder("/", e.deps);
  assert.equal(root.kind === "refused" && root.code, "drive_root");
  assert.equal((await inspectFolder("   ", e.deps)).kind, "refused");
});

test("the inspector resolves links itself, even if the boundary it was given doesn't", async () => {
  const e = env();
  const writtenOnly = createDataBoundary({ dataRoot: e.dataRoot });
  const link = join(e.b.root, "plain-looking");
  makeTestLink(join(e.dataRoot, "files"), link);
  assert.equal(writtenOnly.isSensitive(link), false, "this boundary can't see through the link");
  const r = await inspectFolder(link, { ...e.deps, isSensitive: (p) => writtenOnly.isSensitive(p) });
  assert.equal(r.kind === "refused" && r.code, "data_root");
});

test("nothing inside the data root is ever read, even to inspect it", async () => {
  const e = env();
  const reads: string[] = [];
  const fs = createNodeInspectFs();
  const spy = { ...e.deps, fs: { ...fs, readText: (p: string, n: number) => (reads.push(p), fs.readText(p, n)), list: (p: string, n: number) => (reads.push(p), fs.list(p, n)) } };
  await inspectFolder(join(e.dataRoot, "files", "vault"), spy);
  await inspectFolder(e.dataRoot, spy);
  assert.deepEqual(reads, []);
  assert.equal(e.b.calls.length, 0, "git wasn't even asked");
});

test("duplicates: the same folder (also through a link), or the same repository cloned elsewhere", async () => {
  const e = env();
  const { bare, app } = e.b.origin();
  const saved = await saveInspectedProject({ path: app, name: "Shop" }, e.deps, { ...ctx(), takenIds: e.store.ids() });
  assert.equal(saved.ok, true);
  const again = await inspectFolder(app, e.deps);
  assert.deepEqual(again.kind === "duplicate" && [again.by, again.existing.name], ["path", "Shop"]);
  const link = join(e.b.root, "shortcut");
  makeTestLink(app, link);
  const viaLink = await inspectFolder(link, e.deps);
  assert.equal(viaLink.kind === "duplicate" && viaLink.by, "path");
  const second = e.b.clone(bare, "second-copy");
  const sameRemote = await inspectFolder(second, e.deps);
  assert.equal(sameRemote.kind === "duplicate" && sameRemote.by, "remote");
  // Editing a project doesn't make it its own duplicate.
  assert.equal((await inspectFolder(app, e.deps, { ignoreProjectId: saved.ok ? saved.project.id : "" })).kind, "ok");
});

test("saving re-inspects: the owner's edits win, the real path is recorded, a late duplicate is still refused", async () => {
  const e = env();
  const dir = nodeApp(e, "tool", { name: "tool", scripts: { start: "node ." } }, { "package-lock.json": "{}" });
  const r = await saveInspectedProject({ path: dir, name: "My Tool", commands: { start: "npm start -- --verbose" }, tags: ["cli"] }, e.deps, { ...ctx(), takenIds: e.store.ids() });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.project.name, "My Tool");
  assert.equal(r.project.commands.start, "npm start -- --verbose");
  assert.equal(r.project.tooling.packageManager, "npm");
  assert.ok(r.project.realPath && r.project.realPath.endsWith("/tool"));
  assert.deepEqual(e.store.get(r.project.id)?.tags, ["cli"]);
  const dup = await saveInspectedProject({ path: dir, name: "Again" }, e.deps, { ...ctx(), takenIds: e.store.ids() });
  assert.equal(dup.ok, false);
  assert.equal(!dup.ok && dup.duplicateOf?.name, "My Tool");
});

test("suggestions: DI's repositories that aren't projects yet, never inside the data root, newest first", async () => {
  const e = env();
  const { app } = e.b.origin();
  const other = join(e.b.root, "other");
  e.b.git(e.b.root, "init", "-q", other);
  const old = join(e.b.root, "old");
  e.b.git(e.b.root, "init", "-q", old);
  const insideData = join(e.dataRoot, "files", "repo");
  e.b.git(e.b.root, "init", "-q", insideData);
  await saveInspectedProject({ path: app }, e.deps, { ...ctx(), takenIds: e.store.ids() });
  const port = {
    list: async () => [
      { id: "r1", path: app, displayName: "app", lastSeenAt: "2026-09-30T00:00:00.000Z" },
      { id: "r2", path: other, displayName: null, lastSeenAt: "2026-09-29T00:00:00.000Z" },
      { id: "r3", path: old, displayName: "Old thing", lastSeenAt: "2026-01-01T00:00:00.000Z" },
      { id: "r4", path: insideData, displayName: "bait", lastSeenAt: "2026-10-01T00:00:00.000Z" },
      { id: "r5", path: join(e.b.root, "gone"), displayName: "gone", lastSeenAt: "2026-10-01T00:00:00.000Z" },
      { id: "r6", path: other, displayName: "dup", lastSeenAt: "2026-09-28T00:00:00.000Z" }
    ]
  };
  const suggestions = await listSuggestions(port, { fs: e.deps.fs, isSensitive: e.deps.isSensitive, projects: e.store.list({ includeArchived: true }) });
  assert.deepEqual(suggestions.map((s) => [s.discoveredId, s.name]), [["r2", "other"], ["r3", "Old thing"]]);

  const added = await addSuggestions([other, old, insideData, app], e.deps, ctx());
  assert.deepEqual(added.added.map((p) => p.name), ["other", "old"]);
  assert.deepEqual(added.skipped.map((s) => s.path), [insideData, app]);
  assert.deepEqual(await listSuggestions(port, { fs: e.deps.fs, isSensitive: e.deps.isSensitive, projects: e.store.list({ includeArchived: true }) }), []);
});

test("an unreadable package.json is a warning, not a failure", async () => {
  const e = env();
  const dir = join(e.b.root, "broken");
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), "{ nope");
  const r = await inspectFolder(dir, e.deps);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.deepEqual(r.warnings, ["package.json is not valid JSON; scripts weren't read."]);
  assert.equal(r.draft.name, "broken");
  const huge = join(e.b.root, "huge");
  mkdirSync(huge);
  writeFileSync(join(huge, "package.json"), JSON.stringify({ name: "x", pad: "y".repeat(600 * 1024) }));
  const h = await inspectFolder(huge, e.deps);
  assert.equal(h.kind === "ok" && h.warnings[0], "package.json is too large to read; scripts weren't read.");
});

test("framework and port detection", () => {
  const files = new Set<string>();
  assert.deepEqual(detectFramework({ dependencies: { next: "14", react: "18" } }, files), { framework: "Next.js", defaultPort: 3000 });
  assert.deepEqual(detectFramework({ devDependencies: { electron: "30", vite: "5" } }, files), { framework: "Electron", defaultPort: null });
  assert.equal(detectFramework(null, new Set(["Cargo.toml"])).framework, "Rust");
  assert.equal(detectFramework(null, new Set(["App.sln"])).framework, ".NET");
  assert.equal(detectFramework(null, new Set(["README.md"])).framework, null);
  assert.deepEqual(detectPorts({ scripts: { dev: "next dev -p 3001", api: "PORT=8080 node api.js" }, defaultPort: 3000 }), [3001, 8080]);
  assert.deepEqual(detectPorts({ viteConfig: "export default { server: { port: 5199 } }", defaultPort: 5173 }), [5199]);
  assert.deepEqual(detectPorts({ defaultPort: 4321 }), [4321]);
  assert.deepEqual(detectPorts({ scripts: { x: "--port 99999" }, defaultPort: null }), []);
  assert.deepEqual(suggestCommands({ scripts: { start: "node .", "type-check": "tsc" } }, "yarn").commands, { start: "yarn run start", typecheck: "yarn run type-check" });
  assert.deepEqual(suggestCommands({ scripts: {} }, "npm"), { commands: {}, commandList: [] });
});
