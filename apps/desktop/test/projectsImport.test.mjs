// "Import projects", for real: Developer Intelligence's walk over synthetic
// folders on disk (junctions on Windows), through the same scan the desktop
// host uses, then the dialog's screens rendered from the results. Bundled with
// the app's own Vite, as the other view tests are, because Developer
// Intelligence's sources use .js specifiers that only a bundler resolves.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDataBoundary } from "@dexnest/foundation";
import { assertSafeTestPath, makeTestLink } from "@dexnest/foundation/testing";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(desktop, "../..");
let scratch = "";
let world = "";
let scanMod;
let inspectMod;
let dialog;

before(async () => {
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "projects-import-"));
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
          scan: join(desktop, "src/main/projectsFolderScan.ts"),
          inspect: resolve(repoRoot, "packages/projects/src/inspect/inspect.ts"),
          dialog: join(desktop, "src/renderer/views/projects/ImportProjectsDialog.tsx")
        },
        external: ["react", "react/jsx-runtime", "react-dom", "lucide-react", /^node:/],
        output: { format: "es", entryFileNames: "[name].mjs" }
      }
    }
  });
  scanMod = await import(pathToFileURL(join(scratch, "scan.mjs")).href);
  inspectMod = await import(pathToFileURL(join(scratch, "inspect.mjs")).href);
  dialog = await import(pathToFileURL(join(scratch, "dialog.mjs")).href);
  world = realpathSync.native(assertSafeTestPath(mkdtempSync(join(tmpdir(), "dexnest-import-world-"))));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  if (world) rmSync(world, { recursive: true, force: true });
});

function repo(...parts) {
  const dir = join(world, ...parts);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# synthetic\n");
  return dir;
}

function fsPort() {
  return {
    realpath: (p) => realpathSync.native(p),
    kind: (p) => {
      try {
        return statSync(p).isDirectory() ? "dir" : "file";
      } catch {
        return "missing";
      }
    }
  };
}

test("the real walk: every repository under the folder, nested ones too; never node_modules, hidden folders, DexNest's data or a junction loop", async () => {
  const dataRoot = join(world, "DeskNest", "local-data");
  mkdirSync(join(dataRoot, "files", "vault"), { recursive: true });
  repo("DeskNest", "local-data", "files", "vault", "private-repo");
  const code = join(world, "code");
  repo("code", "alpha");
  repo("code", "work", "beta");
  repo("code", "work", "client", "gamma");
  repo("code", "alpha", "packages", "inner"); // inside a repository: that repository is the project
  repo("code", "web", "node_modules", "dep");
  repo("code", ".cache", "hidden");
  mkdirSync(join(code, "empty-folder"), { recursive: true });
  makeTestLink(code, join(code, "loop")); // a junction back to its own parent
  makeTestLink(dataRoot, join(code, "data-shortcut")); // a junction into DexNest's data

  const boundary = createDataBoundary({ dataRoot, realpath: realpathSync.native });
  const isSensitive = (p) => boundary.isSensitive(p);
  const port = scanMod.createFolderScan(isSensitive);
  const result = await inspectMod.scanFoldersForImport([code], port, { fs: fsPort(), isSensitive, projects: [] });

  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.candidates.map((c) => c.name).sort(), ["alpha", "beta", "gamma"]);
  assert.ok(result.candidates.every((c) => !/local-data|node_modules|\.cache/i.test(c.path)), "nothing private, vendored or hidden");
  assert.equal(result.truncated, false);
});

test("the real walk: a folder inside DexNest's data, or a junction to it, is refused before anything is walked", async () => {
  const dataRoot = join(world, "DeskNest2", "local-data");
  mkdirSync(dataRoot, { recursive: true });
  repo("DeskNest2", "local-data", "repo-in-data");
  const shortcut = join(world, "innocent-name");
  makeTestLink(dataRoot, shortcut);
  const boundary = createDataBoundary({ dataRoot, realpath: realpathSync.native });
  const isSensitive = (p) => boundary.isSensitive(p);
  let walked = 0;
  const real = scanMod.createFolderScan(isSensitive);
  const counting = { scan: async (roots) => { walked += 1; return real.scan(roots); } };
  const result = await inspectMod.scanFoldersForImport([dataRoot, shortcut], counting, { fs: fsPort(), isSensitive, projects: [] });
  assert.equal(result.refused.length, 2);
  assert.equal(walked, 0);
  assert.deepEqual(result.candidates, []);
});

test("the real walk says when a limit stopped it early", async () => {
  for (let i = 0; i < 6; i += 1) repo("many", `r${i}`);
  const port = scanMod.createFolderScan(() => false, { maxDepth: 4, maxDirectories: 4000, maxRepositories: 3 });
  const scanned = await port.scan([join(world, "many")]);
  assert.equal(scanned.repositories.length, 3);
  assert.equal(scanned.truncated, true);
});

// --- the dialog's screens ---------------------------------------------------------

const noop = () => undefined;
function body(step, extra = {}) {
  return renderToStaticMarkup(
    createElement(dialog.ImportBody, { step, rememberedRoots: [], pasted: "", onPasted: noop, onPick: noop, onScan: noop, selected: new Set(), onToggle: noop, onToggleAll: noop, ...extra })
  );
}

const SCAN = {
  roots: ["D:\\code"],
  candidates: [
    { path: "D:\\code\\alpha", name: "alpha", existing: null },
    { path: "D:\\code\\beta", name: "beta", existing: null },
    { path: "D:\\code\\gamma", name: "gamma", existing: { id: "gamma", name: "Gamma", archived: false } }
  ],
  refused: [],
  truncated: false,
  unreadable: 0
};

test("results: new repositories start ticked, already-added ones are shown but can't be ticked", () => {
  const selected = dialog.initialSelection(SCAN.candidates);
  assert.deepEqual([...selected].sort(), ["D:\\code\\alpha", "D:\\code\\beta"]);
  const html = body({ kind: "results", scan: SCAN }, { selected });
  assert.match(html, /Found 3 repositories in/);
  assert.match(html, /1 already added/);
  assert.match(html, /Select all new \(2\)/);
  assert.equal((html.match(/type="checkbox"[^>]*checked=""/g) ?? []).length, 3, "two repositories and select-all");
  assert.match(html, /disabled=""[^>]*\/?>(?:(?!<li).)*gamma/s, "gamma's box is disabled");
  assert.match(html, />added</);
  assert.equal(dialog.importButtonLabel(2), "Import 2 projects");
  assert.equal(dialog.importButtonLabel(1), "Import 1 project");
});

test("choose: one-click re-checks of the folders used before; large and unreadable folders are explained", () => {
  const html = body({ kind: "choose" }, { rememberedRoots: ["D:\\code", "E:\\work"] });
  assert.match(html, /Choose a folder…/);
  assert.match(html, /Check again for new projects/);
  assert.match(html, /D:\\code/);
  assert.match(html, /All of them/);
  assert.match(html, /node_modules/);
  const big = body({ kind: "results", scan: { ...SCAN, truncated: true, unreadable: 2 } }, { selected: new Set() });
  assert.match(big, /stopped early/);
  assert.match(big, /2 folders couldn&#x27;t be read/);
});

test("done: a summary with every skipped folder and why", () => {
  const html = body({ kind: "done", result: { added: [{ id: "a" }], skipped: [{ path: "D:\\code\\x", reason: "This folder is already a project: X." }] } });
  assert.match(html, /Imported 1 project\. 1 skipped\./);
  assert.match(html, /already a project: X/);
});

test("each repository is shown where it sits inside the searched folder, not as the same long prefix", () => {
  const r = String.raw;
  assert.equal(dialog.pathWithinRoots(r`D:\code\work\client\gamma`, [r`D:\code`]), r`work\client\gamma`);
  assert.equal(dialog.pathWithinRoots(r`d:\CODE\alpha`, ["D:\\code\\"]), "alpha", "case and a trailing slash don't matter");
  assert.equal(dialog.pathWithinRoots(r`D:\code`, [r`D:\code`]), "(the folder itself)");
  assert.equal(dialog.pathWithinRoots(r`E:\elsewhere\x`, [r`D:\code`]), r`E:\elsewhere\x`);
  assert.equal(dialog.pathWithinRoots("/home/me/code/a/b", ["/home/me/code"]), "a/b");
  const html = body({ kind: "results", scan: SCAN }, { selected: new Set() });
  assert.ok(html.includes(r`title="D:\code\alpha"`), "the full path is in the tooltip");
  assert.doesNotMatch(html, /projects-wizard__suggestion-path[^>]*>alpha</, "a top-level repository doesn't repeat its name as its path");
  const nested = body({ kind: "results", scan: { ...SCAN, candidates: [{ path: r`D:\code\work\beta`, name: "beta", existing: null }] } }, { selected: new Set() });
  assert.ok(nested.includes(r`>work\beta<`), "a nested one shows where it is");
});
