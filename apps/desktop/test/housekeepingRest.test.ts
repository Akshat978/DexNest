/**
 * The rest of the housekeeping: dragging the sidebar into order, "Clear data"
 * for GhostOS, ObjectOS and Projects, and one version number.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { arrangeSidebar, placeSidebarView, type SidebarPrefs } from "../src/renderer/lib/sidebarLayout.ts";
import { clearGhost, clearObjects, clearProjects, countGhost, countObjects, countProjects, type GhostLike, type ObjectsLike, type ProjectsLike } from "../src/main/moduleClear.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");

const views = ["command", "today", "search", "dev", "skills", "rpg", "settings"].map((id) => ({ id }));
const ids = (prefs: SidebarPrefs) => arrangeSidebar(views, prefs).shown.map((v) => v.id);
const NONE: SidebarPrefs = { order: [], hidden: [] };

test("dragging a module onto another puts it there, and the ones between shift by one", () => {
  // Up: rpg dropped on today takes today's place.
  assert.deepEqual(ids(placeSidebarView(views, NONE, "rpg", "today")), ["command", "rpg", "today", "search", "dev", "skills", "settings"]);
  // Down: today dropped on skills ends up where skills was.
  assert.deepEqual(ids(placeSidebarView(views, NONE, "today", "skills")), ["command", "search", "dev", "skills", "today", "rpg", "settings"]);
  // To the very top and the very bottom.
  assert.deepEqual(ids(placeSidebarView(views, NONE, "settings", "command"))[0], "settings");
  assert.deepEqual(ids(placeSidebarView(views, NONE, "command", "settings")).at(-1), "command");
  // Dropped on itself, or naming something that is not in the rail: nothing changes, and nothing is saved.
  assert.equal(placeSidebarView(views, NONE, "rpg", "rpg"), NONE);
  assert.equal(placeSidebarView(views, NONE, "rpg", "nope"), NONE);
  assert.equal(placeSidebarView(views, NONE, "nope", "rpg"), NONE);
});

test("dragging keeps what is hidden hidden, and cannot drop onto a hidden module", () => {
  const prefs: SidebarPrefs = { order: [], hidden: ["search"] };
  const moved = placeSidebarView(views, prefs, "rpg", "today");
  assert.deepEqual(moved.hidden, ["search"]);
  assert.deepEqual(ids(moved), ["command", "rpg", "today", "dev", "skills", "settings"]);
  assert.deepEqual(arrangeSidebar(views, moved).hidden.map((v) => v.id), ["search"]);
  assert.equal(placeSidebarView(views, prefs, "rpg", "search"), prefs, "a hidden module is not a place in the rail");
  // Done twice in a row, each move starts from the last.
  assert.deepEqual(ids(placeSidebarView(views, moved, "settings", "command")), ["settings", "command", "rpg", "today", "dev", "skills"]);
});

test("the sidebar rows can be dragged, and the buttons still work for those who cannot drag", () => {
  const shell = read("src/renderer/main.tsx");
  assert.match(shell, /draggable=\{!sidebarCollapsed\}/);
  assert.match(shell, /arrangeSidebarTo\(placeSidebarView\(railViews, sidebarPrefs, sidebarDrag\.id, view\.id\)\);/);
  assert.match(shell, /onDragEnd=\{\(\) => setSidebarDrag\(null\)\}/, "a drag that ends anywhere else is forgotten");
  assert.match(shell, /aria-label=\{`Move \$\{view\.label\} up`\}/, "the keyboard way is still there");
  assert.match(read("src/renderer/styles.css"), /\.sidebar-row\[data-drop-target="true"\] \{\s*outline: 2px solid var\(--focus-outline\);/);
  // The same rule for the link styles added earlier: solid outlines, never the faint ring.
  assert.doesNotMatch(read("src/renderer/views/RecordLinks.css"), /outline: 2px solid var\(--focus-ring\)/);
});

// --- GhostOS -----------------------------------------------------------------------

function ghost(entities: string[], adapters: { id: string; enabled: boolean; adds: string[] }[], stubborn: string[] = []) {
  const calls: string[] = [];
  const left = new Set(entities);
  const module: GhostLike = {
    status: () => ({ adapters: adapters.map(({ id, enabled }) => ({ id, enabled })), counts: { entity: left.size, relation: 0, observation: left.size } }),
    disableAdapter(id) {
      calls.push(`off:${String(id)}`);
      const adapter = adapters.find((a) => a.id === id)!;
      adapter.enabled = false;
      for (const added of adapter.adds) left.delete(added);
      return { ok: true, value: null };
    },
    forget(input) {
      const { kind, id } = input as { kind: string; id: string };
      calls.push(`forget:${kind}:${id}`);
      if (stubborn.includes(id)) return { ok: false, errors: [`${id} could not be forgotten`] };
      left.delete(id);
      return { ok: true, value: null };
    },
    store: { listEntities: (options) => [...left].slice(0, options?.limit ?? 200).map((id) => ({ id })) }
  };
  return { module, calls, left };
}

test("GhostOS: sources are turned off first, then what was entered by hand is forgotten", () => {
  const g = ghost(["repo-a", "skill-ts", "memory-1", "decision-1"], [{ id: "developer-intelligence", enabled: true, adds: ["repo-a", "skill-ts"] }, { id: "other", enabled: false, adds: [] }]);
  assert.equal(countGhost(g.module), 8);
  const outcome = clearGhost(g.module);
  assert.deepEqual(g.calls, ["off:developer-intelligence", "forget:entity:memory-1", "forget:entity:decision-1"], "what a source added is taken back by turning it off, not forgotten one by one");
  assert.deepEqual(outcome, { records: 8, files: 0, problems: [] });
  assert.equal(countGhost(g.module), 0);
});

test("GhostOS: more entries than one batch, and an entry that will not go does not loop forever", () => {
  const many = ghost(Array.from({ length: 450 }, (_, i) => `e${i}`), []);
  assert.equal(clearGhost(many.module).records, 900);
  assert.equal(many.left.size, 0);

  const stuck = ghost(["a", "b"], [], ["a", "b"]);
  const outcome = clearGhost(stuck.module);
  assert.equal(outcome.records, 0);
  assert.equal(outcome.problems.length, 2);
  assert.equal(stuck.calls.length, 2, "one try each, then it stops");
});

// --- ObjectOS ----------------------------------------------------------------------

test("ObjectOS: every object goes through its own delete (which removes its files), then the parts", () => {
  const calls: string[] = [];
  const objects = [{ id: "OBJ00001", files: 2 }, { id: "OBJ00002", files: 0 }, { id: "OBJ00003", files: 1 }];
  let parts = [{ id: "prt_1" }, { id: "prt_2" }];
  const module: ObjectsLike = {
    listObjects: () => ({ ok: true, value: objects.map(({ id }) => ({ id })) }),
    deleteObject(input) {
      const { id } = input as { id: string };
      calls.push(`object:${id}`);
      if (id === "OBJ00002") return { ok: false, errors: ["OBJ00002 is in use"] };
      return { ok: true, value: { files: Array.from({ length: objects.find((o) => o.id === id)!.files }) } };
    },
    deleteRecord(input) {
      const { kind, id } = input as { kind: string; id: string };
      calls.push(`${kind}:${id}`);
      parts = parts.filter((p) => p.id !== id);
      return { ok: true, value: null };
    },
    store: { parts: () => parts }
  };
  assert.equal(countObjects(module), 5);
  const outcome = clearObjects(module);
  assert.deepEqual(calls, ["object:OBJ00001", "object:OBJ00002", "object:OBJ00003", "part:prt_1", "part:prt_2"]);
  assert.deepEqual(outcome, { records: 4, files: 3, problems: ["OBJ00002 is in use"] }, "what could not go is said, and the rest still went");
});

// --- Projects ----------------------------------------------------------------------

test("Projects: each one is archived if it is not, then removed; watching is switched off", () => {
  const calls: string[] = [];
  let list = [{ id: "p1", archivedAt: null as string | null }, { id: "p2", archivedAt: "2026-10-01T00:00:00.000Z" }, { id: "p3", archivedAt: null }];
  const module: ProjectsLike = {
    list: () => list.map((project) => ({ project })),
    archive(id) { calls.push(`archive:${id}`); list.find((p) => p.id === id)!.archivedAt = "now"; return null; },
    remove(id) {
      calls.push(`remove:${id}`);
      if (id === "p3") throw new Error("p3 is busy");
      if (list.find((p) => p.id === id)!.archivedAt === null) throw new Error("Archive a project before removing it.");
      list = list.filter((p) => p.id !== id);
    },
    updateSettings(next) { calls.push(`settings:${JSON.stringify(next)}`); return null; }
  };
  assert.equal(countProjects(module), 3);
  const outcome = clearProjects(module);
  assert.deepEqual(calls, ["archive:p1", "remove:p1", "remove:p2", "archive:p3", "remove:p3", 'settings:{"watchedRoots":[],"watchSkipped":[]}']);
  assert.deepEqual(outcome, { records: 2, files: 0, problems: ["p3 is busy"] });
});

// --- how they are wired ----------------------------------------------------------------

test("these three are cleared through their modules, never by emptying their tables", () => {
  const main = read("src/main/main.ts");
  const catalog = main.slice(main.indexOf("function dataManagementCatalog"), main.indexOf("function dataManagementState"));
  for (const [id, module] of [["ghost", "ghost"], ["object", "object"], ["projects", "projects"]] as const) {
    const line = catalog.split("\n").find((l) => l.includes(`{ id: "${id}",`)) ?? "";
    assert.match(line, new RegExp(`module: "${module}" \\}`), id);
    assert.doesNotMatch(line, /tablePrefixes/, `${id} names no tables`);
    assert.match(line, /recordFiles: \[\], fileRoots: \[\]/, `${id} names no files or folders either`);
  }
  assert.doesNotMatch(catalog, /tablePrefixes: \[[^\]]*"(ghost_|obj_|proj_)"/, "no category empties GhostOS's, ObjectOS's or Projects' tables");
  assert.match(catalog, /your repositories is turned off\. Connect them again on its Sources tab/);
  assert.match(catalog, /Your folders and repositories are not touched\./);
  assert.match(catalog, /Calendar events and Finance entries you sent from ObjectOS are not touched\./);
  assert.match(main, /if \(outcome\.problems\.length > 0\) throw new Error\(`\$\{outcome\.records\} removed, but not everything:/, "a partial clear is reported as one");
  assert.match(main, /if \(!ghostOsHost\) throw new Error\("GhostOS is not running, so it cannot be cleared\."\);/);
  const clear = read("src/main/moduleClear.ts");
  assert.doesNotMatch(clear, /DELETE FROM|\.exec\(|prepare\(|rmSync|unlinkSync/, "no SQL and no file deletion of its own");
});

test("the workspace and the app say the same version", () => {
  const app = JSON.parse(read("package.json")) as { version: string };
  const root = JSON.parse(readFileSync(join(desktop, "../../package.json"), "utf8")) as { version: string };
  assert.equal(root.version, app.version);
  assert.match(app.version, /^\d+\.\d+\.\d+$/);
});

test("data is deleted from DexNest's own window only, whatever a request says about confirmation", () => {
  const main = read("src/main/main.ts");
  const handler = main.slice(main.indexOf('if (action.id === "system.data.execute_delete")'), main.indexOf('if (action.id === "pins.show_pinned")'));
  const guard = handler.indexOf('if (source !== "module_ui" && source !== "command")');
  assert.ok(guard > 0, "the source is checked");
  assert.ok(guard < handler.indexOf("confirmText"), "before the confirmation text is even read");
  assert.ok(guard < handler.indexOf("executeDataDeletion("), "and before anything is deleted");
  assert.match(handler, /error: "Data is deleted from DexNest's own window, not from here\."/);
  const registry = readFileSync(join(desktop, "../../packages/action-registry/src/index.ts"), "utf8");
  assert.match(registry, /\["system\.data\.execute_delete", "Delete Selected DexNest Data"[^\n]*"critical", true\]/);
});
