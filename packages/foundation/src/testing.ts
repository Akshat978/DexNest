// Test support: a real SQLite database on disk, never the user's.
//
// Imported only from tests (`@dexnest/foundation/testing`). It loads node:sqlite,
// which the Electron main process does not use, and it refuses to open anything
// that looks like a DexNest data root - the same guard Autopilot's tests use,
// hoisted so every module's tests get it without copying it.

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStatementAdapter, type SqlDatabase } from "./sql.ts";
import { comparablePath, isWithin } from "./boundary.ts";

const FORBIDDEN_ROOTS = [resolve("D:/DeskNest/local-data")];

/** Throws if `candidate` is, or is inside, a DexNest data root. */
export function assertSafeTestPath(candidate: string): string {
  const target = resolve(candidate);
  for (const forbidden of FORBIDDEN_ROOTS) {
    if (isWithin(target, forbidden)) {
      throw new Error(`Refusing to use the real DexNest data root in a test: ${target}`);
    }
  }
  // The written form is checked too: on POSIX a Windows spelling such as
  // "d:\desknest\LOCAL-DATA" resolves under the cwd with its backslashes and
  // case intact, so only the raw string still shows it names a data root.
  if (/\/local-data(\/|$)/.test(comparablePath(target)) || /(^|[\\/])local-data([\\/]|$)/i.test(candidate)) {
    throw new Error(`Refusing to use a path that looks like a DexNest data root: ${target}`);
  }
  return target;
}

export interface TestDatabase {
  db: SqlDatabase;
  path: string;
  /** Closes the connection. The file stays, for reopen-after-restart tests. */
  close(): void;
  /** Opens a second, independent connection to the same file. */
  reopen(): TestDatabase;
  /** Closes and deletes the directory. */
  dispose(): void;
}

function open(path: string, directory: string): TestDatabase {
  const native = new DatabaseSync(path);
  // The same pragmas @dexnest/local-db sets, so tests see production's journal mode.
  native.exec("PRAGMA journal_mode = WAL");
  native.exec("PRAGMA foreign_keys = ON");
  let isOpen = true;
  return {
    db: createStatementAdapter(native),
    path,
    close() {
      if (isOpen) native.close();
      isOpen = false;
    },
    reopen() {
      return open(path, directory);
    },
    dispose() {
      if (isOpen) native.close();
      isOpen = false;
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

/** A fresh on-disk database in a temp directory. */
export function createTestDatabase(label = "dexnest-test-"): TestDatabase {
  const directory = assertSafeTestPath(mkdtempSync(join(tmpdir(), label)));
  return open(join(directory, "test.sqlite"), directory);
}
