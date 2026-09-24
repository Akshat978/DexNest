// The data boundary. Windows cases run against the real filesystem.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { comparablePath, createDataBoundary, isWithin } from "../src/boundary.ts";

test("containment is by path segment, not string prefix", () => {
  // D:/DeskNest/local-data-old is not inside D:/DeskNest/local-data.
  assert.equal(isWithin("D:/DeskNest/local-data/vault", "D:/DeskNest/local-data", "win32"), true);
  assert.equal(isWithin("D:/DeskNest/local-data", "D:/DeskNest/local-data", "win32"), true);
  assert.equal(isWithin("D:/DeskNest/local-data-old/x", "D:/DeskNest/local-data", "win32"), false);
});

test("Windows paths compare case-insensitively and by either separator", () => {
  assert.equal(isWithin("d:\\desknest\\LOCAL-DATA\\finance", "D:/DeskNest/local-data", "win32"), true);
  assert.equal(comparablePath("D:\\DeskNest\\", "win32"), comparablePath("d:/desknest", "win32"));
});

test("a drive root stays a drive root", () => {
  assert.equal(isWithin("D:/anything", "D:/", "win32"), true);
});

test("the data root is sensitive by its written form", () => {
  const boundary = createDataBoundary({ dataRoot: "D:/DeskNest/local-data", platform: "win32" });
  assert.equal(boundary.isSensitive("D:\\DeskNest\\local-data\\settings\\x.json"), true);
  assert.equal(boundary.isSensitive("D:/DeskNest/apps/desktop/src/main.ts"), false);
});

test("extra roots are denied too", () => {
  const boundary = createDataBoundary({
    dataRoot: "D:/DeskNest/local-data",
    extraSensitiveRoots: ["C:/Users/me/.ssh"],
    platform: "win32"
  });
  assert.equal(boundary.isSensitive("c:/users/ME/.ssh/id_ed25519"), true);
});

test("a path that resolves into the data root is sensitive", { skip: process.platform !== "win32" && "junctions are a Windows feature" }, () => {
  // The case string comparison alone misses: a junction elsewhere on disk that
  // points at the data root. Built as a real junction, which needs no admin.
  const base = mkdtempSync(join(tmpdir(), "boundary-"));
  const dataRoot = join(base, "local-data");
  const alias = join(base, "innocent-looking");
  try {
    mkdirSync(join(dataRoot, "vault"), { recursive: true });
    execFileSync("cmd", ["/c", "mklink", "/J", alias, dataRoot], { stdio: "ignore" });
    const boundary = createDataBoundary({ dataRoot, realpath: realpathSync.native });
    assert.equal(boundary.isSensitive(join(alias, "vault")), true);
    assert.equal(boundary.isSensitive(join(base, "elsewhere")), false);
  } finally {
    try { execFileSync("cmd", ["/c", "rmdir", alias], { stdio: "ignore" }); } catch { /* already gone */ }
    rmSync(base, { recursive: true, force: true });
  }
});

test("a data root reached through a junction is recognised by its real path", { skip: process.platform !== "win32" && "junctions are a Windows feature" }, () => {
  const base = mkdtempSync(join(tmpdir(), "boundary-"));
  const real = join(base, "real-data");
  const configured = join(base, "configured-root");
  try {
    mkdirSync(real);
    execFileSync("cmd", ["/c", "mklink", "/J", configured, real], { stdio: "ignore" });
    const boundary = createDataBoundary({ dataRoot: configured, realpath: realpathSync.native });
    assert.equal(boundary.isSensitive(join(real, "journal.json")), true);
  } finally {
    try { execFileSync("cmd", ["/c", "rmdir", configured], { stdio: "ignore" }); } catch { /* already gone */ }
    rmSync(base, { recursive: true, force: true });
  }
});

test("an unresolvable path is judged by its written form, not waved through", () => {
  const boundary = createDataBoundary({
    dataRoot: "D:/DeskNest/local-data",
    realpath: () => { throw new Error("ENOENT"); },
    platform: "win32"
  });
  assert.equal(boundary.isSensitive("D:/DeskNest/local-data/missing"), true);
});
