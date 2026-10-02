// Project input rules, carried over from the old upsertProject (F2, F3) and
// the projects.json mapping (migration contract for Phase 2).

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { normaliseProjectInput, type NormaliseContext, type Project } from "../src/domain/project.ts";
import { importLegacyProjects, projectToLegacy } from "../src/domain/legacy.ts";

let counter = 0;
function ctx(existing: Project | null = null, taken: string[] = []): NormaliseContext {
  return { existing, takenIds: new Set(taken), now: "2026-10-01T00:00:00.000Z", newCommandId: () => `cmd_gen${++counter}` };
}

function make(input: Parameters<typeof normaliseProjectInput>[0], c = ctx()): Project {
  const result = normaliseProjectInput(input, c);
  if (!result.ok) assert.fail(result.error);
  return result.project;
}

test("name and path are required", () => {
  assert.deepEqual(normaliseProjectInput({ name: " ", path: "D:/x" }, ctx()), { ok: false, error: "Project name and path are required." });
  assert.deepEqual(normaliseProjectInput({ name: "x" }, ctx()), { ok: false, error: "Project name and path are required." });
});

test("ids come from the name, with -2, -3 on collision, and never change on edit", () => {
  assert.equal(make({ name: "My App!", path: "D:/a" }).id, "my-app");
  assert.equal(make({ name: "My App", path: "D:/a" }, ctx(null, ["my-app", "my-app-2"])).id, "my-app-3");
  const first = make({ name: "One", path: "D:/a" });
  const edited = make({ name: "Renamed" }, ctx(first, [first.id]));
  assert.equal(edited.id, "one");
  assert.equal(edited.name, "Renamed");
});

test("omitted fields keep the stored value; ports are 1-65535 integers without duplicates", () => {
  const first = make({
    name: "App", path: "D:/app", ports: [3000, "5173", 0, 70000, 3000, "x"],
    folders: [{ label: "API", path: "D:/app/api" }], links: [{ url: "https://example.test" }],
    projectType: "live_website", commands: { start: "pnpm dev" }
  });
  assert.deepEqual(first.ports, [3000, 5173]);
  assert.deepEqual(first.links, [{ label: "https://example.test", url: "https://example.test" }]);
  const edited = make({ description: "new" }, ctx(first, [first.id]));
  assert.deepEqual(edited.ports, [3000, 5173]);
  assert.deepEqual(edited.folders, first.folders);
  assert.equal(edited.projectType, "live_website");
  assert.equal(edited.commands.start, "pnpm dev");
  assert.equal(edited.createdAt, first.createdAt);
});

test("command list ids are kept when valid (Stream Deck cards point at them) and generated otherwise", () => {
  const p = make({
    name: "App", path: "D:/a",
    commandList: [
      { id: "lint", label: "Lint", command: "pnpm lint" },
      { id: "Bad Id", label: "Fmt", command: "pnpm fmt", requiresConfirmation: true },
      { label: "", command: "x" },
      { id: "lint", label: "Dup", command: "y" }
    ]
  });
  assert.equal(p.commandList.length, 3);
  assert.equal(p.commandList[0].id, "lint");
  assert.match(p.commandList[1].id, /^cmd_gen\d+$/);
  assert.equal(p.commandList[1].requiresConfirmation, true);
  assert.notEqual(p.commandList[2].id, "lint");
});

test("accent is a token name, never a colour value", () => {
  assert.equal(make({ name: "a", path: "p", accent: "#ff0000" }).accent, "dev");
  assert.equal(make({ name: "a", path: "p", accent: "vault" }).accent, "vault");
});

// --- projects.json -------------------------------------------------------------

const LEGACY = [
  {
    id: "dexnest",
    name: "DexNest",
    path: "D:\\DeskNest",
    description: "the app",
    accent: "dev",
    commands: { start: "pnpm dev", build: "pnpm build", test: "", typecheck: "pnpm typecheck", custom: "" },
    urls: ["http://localhost:5173"],
    notes: "multi\nline",
    ports: [5173],
    stopCommand: "pnpm stop",
    logCommand: "",
    logPath: "D:\\logs\\app.log",
    dockerComposeEnabled: true,
    healthUrl: "http://localhost:5173/health",
    projectType: "local_app",
    folders: [{ label: "Root", path: "D:\\DeskNest" }],
    links: [{ label: "Docs", url: "https://docs.example" }],
    commandList: [{ id: "deploy", label: "Deploy", command: "pnpm deploy", requiresConfirmation: true }],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-02-01T00:00:00.000Z",
    lastOpenedAt: "2025-03-01T00:00:00.000Z",
    futureField: { kept: [1, 2, 3] }
  },
  { id: "dexnest", name: "Second", path: "D:\\other", commands: {}, urls: [], notes: "", createdAt: "x", updatedAt: "y" },
  { name: "", path: "D:\\nameless" },
  "garbage",
  { name: "Minimal", path: "D:\\min" }
];

test("projects.json: every field maps, ids are preserved, duplicates get -2, bad entries are reported", () => {
  const { projects, skipped } = importLegacyProjects(LEGACY, { now: "2026-10-01T00:00:00.000Z", newCommandId: () => "cmd_x" });
  assert.deepEqual(projects.map((p) => p.id), ["dexnest", "dexnest-2", "minimal"]);
  assert.deepEqual(skipped, [{ index: 2, reason: "missing name or path" }, { index: 3, reason: "not an object" }]);
  const p = projects[0];
  assert.equal(p.path, "D:\\DeskNest");
  assert.deepEqual(p.localUrls, ["http://localhost:5173"]);
  assert.deepEqual(p.ports, [5173]);
  assert.equal(p.dockerCompose, true);
  assert.equal(p.projectType, "local_app");
  assert.deepEqual(p.commandList, [{ id: "deploy", label: "Deploy", command: "pnpm deploy", requiresConfirmation: true }]);
  assert.equal(p.lastOpenedAt, "2025-03-01T00:00:00.000Z");
  assert.deepEqual(p.legacy, LEGACY[0]);
});

test("projects.json round-trips: every original field comes back, including ones DexNest doesn't know", () => {
  const { projects } = importLegacyProjects(LEGACY, { now: "2026-10-01T00:00:00.000Z", newCommandId: () => "cmd_x" });
  assert.deepEqual(projectToLegacy(projects[0]), LEGACY[0]);
  // An edit shows up in the old shape too.
  const edited = { ...projects[0], name: "DexNest 2", ports: [] };
  const back = projectToLegacy(edited);
  assert.equal(back.name, "DexNest 2");
  assert.deepEqual(back.ports, []);
  assert.deepEqual(back.futureField, { kept: [1, 2, 3] });
});

test("a minimal entry gets the old defaults and no optional keys it never had", () => {
  const { projects } = importLegacyProjects([{ name: "Minimal", path: "D:\\min" }], { now: "2026-10-01T00:00:00.000Z", newCommandId: () => "cmd_x" });
  const back = projectToLegacy(projects[0]);
  assert.equal(back.accent, "dev");
  assert.deepEqual(back.commands, { start: "", build: "", test: "", typecheck: "", custom: "" });
  for (const key of ["ports", "stopCommand", "folders", "links", "commandList", "dockerComposeEnabled"]) assert.equal(key in back, false, key);
});

test("a file that isn't a list imports nothing and says so", () => {
  assert.deepEqual(importLegacyProjects({ projects: [] }, { now: "n", newCommandId: () => "c" }), { projects: [], skipped: [{ index: -1, reason: "projects.json is not a list" }] });
});

test("mapping never mutates its input", () => {
  const copy = JSON.parse(JSON.stringify(LEGACY)) as unknown;
  const { projects } = importLegacyProjects(copy, { now: "n", newCommandId: () => "c" });
  projects[0].legacy!.name = "changed";
  assert.deepEqual(copy, LEGACY);
});
