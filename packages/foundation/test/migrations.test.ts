// Per-module migrations in the shared database.

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";

import { inspectModuleMigrations, ModuleMigrationError, runModuleMigrations } from "../src/migrations.ts";
import { createTestDatabase, type TestDatabase } from "../src/testing.ts";

let handle: TestDatabase | undefined;
afterEach(() => {
  handle?.dispose();
  handle = undefined;
});

const db = () => (handle = createTestDatabase()).db;

const one = { version: 1, name: "one", sql: "CREATE TABLE dev_a (id TEXT PRIMARY KEY);" };
const two = { version: 2, name: "two", sql: "ALTER TABLE dev_a ADD COLUMN extra TEXT;" };

test("applies pending migrations in order and records them", () => {
  const d = db();
  assert.deepEqual(runModuleMigrations(d, "dev", [two, one]), { applied: [1, 2], alreadyApplied: [] });
  assert.deepEqual(runModuleMigrations(d, "dev", [one, two]), { applied: [], alreadyApplied: [1, 2] });
});

test("a failed migration is rolled back and not recorded", () => {
  // The crash-during-upgrade case: nothing half-built, nothing claiming it ran,
  // so the next start simply tries again.
  const d = db();
  const broken = { version: 2, name: "broken", sql: "CREATE TABLE dev_b (id TEXT); CREATE TABLE dev_b (id TEXT);" };
  assert.throws(() => runModuleMigrations(d, "dev", [one, broken]), ModuleMigrationError);
  assert.deepEqual(inspectModuleMigrations(d, "dev", [one, broken]), { applied: [1], pending: [2] });
  const table = d.prepare("SELECT name FROM sqlite_master WHERE name = 'dev_b'").get();
  assert.equal(table, undefined, "the first statement of the failed migration must be rolled back too");
});

test("modules keep separate histories in one ledger", () => {
  const d = db();
  runModuleMigrations(d, "dev", [one]);
  const other = { version: 1, name: "one", sql: "CREATE TABLE standup_a (id TEXT);" };
  assert.deepEqual(runModuleMigrations(d, "standup", [other]).applied, [1]);
});

test("a migration may not manage its own transaction", () => {
  const d = db();
  const rogue = { version: 1, name: "rogue", sql: "BEGIN; CREATE TABLE dev_x (id TEXT); COMMIT;" };
  assert.throws(() => runModuleMigrations(d, "dev", [rogue]), /owns it/);
});

test("a trigger body is not mistaken for a transaction", () => {
  const d = db();
  runModuleMigrations(d, "dev", [one]);
  const trigger = {
    version: 2,
    name: "trigger",
    sql: `
      CREATE TABLE dev_log (id TEXT);
      CREATE TRIGGER dev_a_insert AFTER INSERT ON dev_a
      BEGIN
        INSERT INTO dev_log (id) VALUES (NEW.id);
      END;
    `
  };
  assert.deepEqual(runModuleMigrations(d, "dev", [one, trigger]).applied, [2]);
});

test("duplicate and invalid versions are refused before anything runs", () => {
  const d = db();
  assert.throws(() => runModuleMigrations(d, "dev", [one, { ...one, name: "again" }]), /twice/);
  assert.throws(() => runModuleMigrations(d, "dev", [{ ...one, version: 0 }]), /invalid version/);
  assert.throws(() => runModuleMigrations(d, "Dev-Module", [one]), /lowercase/);
});
