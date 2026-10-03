/**
 * Projects is the one list of projects. The repository scan follows it, and
 * every screen calls a project what Projects calls it.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { linkedProjectRepositories, projectNameForPath } from "../src/main/projectLinks.ts";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const project = (name: string, path: string, isRepo: boolean | null = true) => ({ project: { name, path, git: { isRepo } } });

test("the scan takes every project that is a repository, under its Projects name", () => {
  const linked = linkedProjectRepositories([
    project("dexnest", "D:\\DeskNest"),
    project("notes", "D:\\code\\notes", null),
    project("handbook", "D:\\docs", false),
    project("blank", "  ")
  ]);
  assert.deepEqual(linked, [
    { path: "D:\\DeskNest", domain: "windows", displayName: "dexnest" },
    { path: "D:\\code\\notes", domain: "windows", displayName: "notes" }
  ]);
  assert.deepEqual(linkedProjectRepositories([]), []);
});

test("a folder's project name is found whatever the slashes or case", () => {
  const projects = [project("dexnest", "D:\\DeskNest"), project("notes", "D:\\code\\notes")];
  assert.equal(projectNameForPath(projects, "d:/desknest/"), "dexnest");
  assert.equal(projectNameForPath(projects, "D:\\code\\notes"), "notes");
  assert.equal(projectNameForPath(projects, "D:\\code"), null, "a parent folder is not the project");
  assert.equal(projectNameForPath(projects, "D:\\code\\notes-2"), null);
});

test("the hosts are wired to Projects, not to lists of their own", () => {
  const main = readSource("../src/main/main.ts");
  assert.match(main, /linkedRepositories: \(\) => linkedProjectRepositories\(projectsHost\?\.module\.list\(\) \?\? \[\]\)/, "archived projects are not listed, so not scanned");
  assert.match(main, /projectName: \(projectPath\) => projectNameForPath\(projectsHost\?\.module\.list\(\{ includeArchived: true \}\) \?\? \[\], projectPath\)/);
  const autopilot = readSource("../src/main/autopilotHost.ts");
  assert.match(autopilot, /label: options\.projectName\?\.\(path\) \?\? /, "the queue labels a project by its Projects name when it has one");
  // Which projects can be queued is unchanged: past runs only.
  assert.match(autopilot, /for \(const run of engine\.listRuns\(200\)\)/);
});

test("the demo seed no longer makes a project inside DexNest's own data", () => {
  const main = readSource("../src/main/main.ts");
  assert.doesNotMatch(main, /name: "DexNest Demo Project"/);
  assert.doesNotMatch(main, /path: join\(demoFilesRoot, "dev"\)/);
  // One seeded by an older build can still be cleared.
  assert.match(main, /clearRecordArray\("dev\.projects"/);
});

test("the scan is called one thing on screen", () => {
  for (const file of ["GhostOsView.tsx", "SkillConstellationView.tsx", "TodayView.tsx", "projects/ProjectsView.tsx", "projects/DetailTabs.tsx", "projects/AddProjectWizard.tsx"]) {
    const source = readSource(`../src/renderer/views/${file}`);
    const visible = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
      .join("\n");
    assert.doesNotMatch(visible, /Developer Intelligence/, `${file} still shows the internal name`);
  }
  const registry = readSource("../../../packages/action-registry/src/index.ts");
  const descriptions = registry.split("\n").filter((line) => /^\s*(title|description):/.test(line)).join("\n");
  assert.doesNotMatch(descriptions, /Developer Intelligence/);
});
