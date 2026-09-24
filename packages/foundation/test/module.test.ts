import { strict as assert } from "node:assert";
import { test } from "node:test";

import { validateManifest, type DexNestModuleManifest } from "../src/module.ts";

const base: DexNestModuleManifest = {
  id: "developer_intelligence",
  title: "Developer Intelligence",
  tablePrefix: "dev_",
  migrations: [{ version: 1, name: "init", sql: "CREATE TABLE IF NOT EXISTS dev_repos (id TEXT);" }],
  eventStreams: ["dev"],
  eventTypes: ["dev.repo.discovered"],
  actionIds: [],
  views: [],
  jobs: []
};

test("a well-formed manifest has no problems", () => {
  assert.deepEqual(validateManifest(base, "dev"), []);
});

test("a migration outside the table prefix is caught", () => {
  // The shared database only stays shared if nobody writes outside their namespace.
  const problems = validateManifest(
    { ...base, migrations: [{ version: 1, name: "x", sql: "CREATE TABLE repositories (id TEXT);" }] },
    "dev"
  );
  assert.match(problems.join("\n"), /"repositories", outside prefix "dev_"/);
});

test("an index on another module's table is caught", () => {
  const problems = validateManifest(
    { ...base, migrations: [{ version: 1, name: "x", sql: "CREATE INDEX idx_x ON event_log (type);" }] },
    "dev"
  );
  assert.match(problems.join("\n"), /"event_log"/);
});

test("event types outside the namespace, and duplicates, are caught", () => {
  const problems = validateManifest({ ...base, eventTypes: ["repo.discovered", "dev.a", "dev.a"] }, "dev");
  assert.equal(problems.length, 2);
});
