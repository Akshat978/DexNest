// The branch a project's owner marks as deployed: a name they choose, kept
// with the project, optional because not every project is deployed.

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";

import { runFoundationMigrations } from "@dexnest/foundation";
import { createTestDatabase, type TestDatabase } from "@dexnest/foundation/testing";

import { normaliseProjectInput, type Project } from "../src/domain/project.ts";
import { PROJECTS_MIGRATIONS } from "../src/store/migrations.ts";
import { createProjectsStore, runProjectsMigrations } from "../src/store/store.ts";

const ctx = (existing: Project | null) => ({ existing, takenIds: new Set<string>(), now: "2026-10-03T12:00:00.000Z", newCommandId: () => "cmd_1" });

function make(input: Record<string, unknown>, existing: Project | null = null): Project {
  const result = normaliseProjectInput({ name: "App", path: "D:/code/app", ...input }, ctx(existing));
  if (!result.ok) assert.fail(result.error);
  return result.project;
}

let dbs: TestDatabase[] = [];
afterEach(() => {
  for (const db of dbs) db.dispose();
  dbs = [];
});

test("a project has no deployed branch until one is marked", () => {
  assert.equal(make({}).deployedBranch, null);
});

test("marking, changing and clearing; an edit that does not mention it leaves it alone", () => {
  const marked = make({ deployedBranch: " develop " });
  assert.equal(marked.deployedBranch, "develop");
  assert.equal(make({ name: "Renamed" }, marked).deployedBranch, "develop", "omitted: kept");
  assert.equal(make({ deployedBranch: "main" }, marked).deployedBranch, "main");
  assert.equal(make({ deployedBranch: null }, marked).deployedBranch, null);
  assert.equal(make({ deployedBranch: "" }, marked).deployedBranch, null);
  assert.equal(make({ deployedBranch: "release/2026.10" }).deployedBranch, "release/2026.10");
});

test("only something that can be a branch name is accepted", () => {
  for (const bad of ["-f", "--force", "+main", "a b", "a..b", "x:y", "HEAD"]) {
    const result = normaliseProjectInput({ name: "App", path: "D:/code/app", deployedBranch: bad }, ctx(null));
    assert.equal(result.ok, false, bad);
    if (!result.ok) assert.match(result.error, /^Deployed branch: /);
  }
});

test("it is stored with the project and survives a reload", () => {
  const db = createTestDatabase("dexnest-projects-deployed-");
  dbs.push(db);
  runFoundationMigrations(db.db);
  runProjectsMigrations(db.db);
  const store = createProjectsStore(db.db);

  const project = make({ id: "app", deployedBranch: "develop" });
  store.save(project);
  store.save(make({ id: "plain", name: "Plain", path: "D:/code/plain" }));
  assert.equal(store.get("app")?.deployedBranch, "develop");
  assert.equal(store.get("plain")?.deployedBranch, null);

  store.save({ ...store.get("app")!, deployedBranch: null });
  assert.equal(createProjectsStore(db.db).get("app")?.deployedBranch, null);
});

test("the column arrives by its own migration, so an existing database gains it", () => {
  assert.deepEqual(PROJECTS_MIGRATIONS.map((m) => [m.version, m.name]), [[1, "core"], [2, "deployed-branch"]]);
  assert.match(PROJECTS_MIGRATIONS[1].sql, /ALTER TABLE proj_projects ADD COLUMN deployed_branch TEXT;/);
});
