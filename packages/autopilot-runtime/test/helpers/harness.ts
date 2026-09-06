// Test harness.
//
// DATA SAFETY (hard requirement, see AGENTS.md "Sensitive Data Boundary"):
// DexNest resolves D:\DeskNest\local-data as CANONICAL_DATA_ROOT whenever that
// directory exists, regardless of where a process is launched from. No test may
// touch it. Every harness here allocates a fresh temp directory, and
// assertSafeDataRoot() refuses to run if a path anywhere near the real data root
// is used.

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type {
  Clock,
  IdGenerator,
  Logger,
  RuntimePorts,
  SqlDatabase,
  SqlStatement
} from "../../src/ports.ts";
import type { SideEffectLedger } from "../../src/scriptedExecutor.ts";

/** Paths that tests must never read or write. */
const FORBIDDEN_ROOTS = [resolve("D:/DeskNest/local-data"), resolve(process.cwd(), "../../local-data")];

export function assertSafeDataRoot(candidate: string): string {
  const target = resolve(candidate);
  for (const forbidden of FORBIDDEN_ROOTS) {
    const normalized = forbidden.toLowerCase();
    const check = target.toLowerCase();
    if (check === normalized || check.startsWith(normalized + sep.toLowerCase())) {
      throw new Error(
        `Refusing to run a test against the real DexNest data root: ${target}. ` +
          `Tests must use an isolated temporary directory.`
      );
    }
  }
  if (target.toLowerCase().includes(`${sep}local-data${sep}`) || target.toLowerCase().endsWith(`${sep}local-data`)) {
    throw new Error(`Refusing to use a path that looks like a DexNest data root: ${target}`);
  }
  return target;
}

/** node:sqlite adapter implementing the runtime's SqlDatabase port. */
export function createNodeSqliteAdapter(path: string): { db: SqlDatabase; close: () => void } {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");

  const db: SqlDatabase = {
    exec(sql: string): void {
      database.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const statement = database.prepare(sql);
      return {
        run(params?: Record<string, unknown>) {
          const result = params ? statement.run(params as never) : statement.run();
          return { changes: Number(result.changes ?? 0) };
        },
        get<T>(params?: Record<string, unknown>) {
          const row = params ? statement.get(params as never) : statement.get();
          // node:sqlite returns null-prototype objects; better-sqlite3 returns
          // ordinary ones. Normalize so both drivers honour the same contract.
          return (row === undefined ? undefined : ({ ...row } as T)) as T | undefined;
        },
        all<T>(params?: Record<string, unknown>) {
          const rows = params ? statement.all(params as never) : statement.all();
          return rows.map((row) => ({ ...row })) as T[];
        }
      };
    }
  };

  return { db, close: () => database.close() };
}

/** Deterministic clock: every call advances by one second. */
export function createTestClock(startIso = "2026-01-01T00:00:00.000Z"): Clock & { advance(ms: number): void } {
  let current = Date.parse(startIso);
  return {
    now(): string {
      const value = new Date(current).toISOString();
      current += 1000;
      return value;
    },
    advance(ms: number): void {
      current += ms;
    }
  };
}

/**
 * Deterministic ids so event ordering assertions are stable.
 *
 * `instance` distinguishes successive runtimes opened against the same durable
 * database — without it a fresh runtime would re-mint ids the previous one
 * already wrote and collide on the primary key.
 */
export function createTestIds(instance = 1): IdGenerator {
  let counter = 0;
  return {
    next(prefix: string): string {
      counter += 1;
      return `${prefix}-i${instance}-${String(counter).padStart(6, "0")}`;
    }
  };
}

export function createTestLogger(): Logger & { entries: Array<{ level: string; message: string }> } {
  const entries: Array<{ level: string; message: string }> = [];
  return {
    entries,
    log(level, message) {
      entries.push({ level, message });
    }
  };
}

/** A side-effect ledger persisted to a file, so it survives losing the runtime. */
export class FileSideEffectLedger implements SideEffectLedger {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private read(): Array<{ runId: string; stepKey: string; idempotencyKey: string }> {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, "utf8").trim();
    if (!raw) return [];
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { runId: string; stepKey: string; idempotencyKey: string });
  }

  append(runId: string, stepKey: string, idempotencyKey: string): void {
    appendFileSync(this.path, `${JSON.stringify({ runId, stepKey, idempotencyKey })}\n`, "utf8");
  }

  entriesFor(runId: string, stepKey: string): string[] {
    return this.read()
      .filter((entry) => entry.runId === runId && entry.stepKey === stepKey)
      .map((entry) => entry.idempotencyKey);
  }

  all(): Array<{ runId: string; stepKey: string; idempotencyKey: string }> {
    return this.read();
  }

  size(): number {
    return this.read().length;
  }
}

export interface TestWorkspace {
  dir: string;
  dbPath: string;
  ledgerPath: string;
  ledger: FileSideEffectLedger;
  /** Opens a fresh connection + ports against the same durable files. */
  openPorts(): { ports: RuntimePorts; close: () => void };
  cleanup(): void;
}

/**
 * Creates an isolated temp workspace. Every call is a fresh directory, and the
 * DEXNEST_DATA_ROOT override is set so that anything which might resolve the
 * real DexNest data root cannot.
 */
export function createTestWorkspace(): TestWorkspace {
  const dir = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-autopilot-")));
  process.env.DEXNEST_DATA_ROOT = dir;

  const dbPath = join(dir, "test.sqlite");
  const ledgerPath = join(dir, "side-effects.jsonl");
  writeFileSync(ledgerPath, "", "utf8");

  let instance = 0;

  return {
    dir,
    dbPath,
    ledgerPath,
    ledger: new FileSideEffectLedger(ledgerPath),
    openPorts() {
      instance += 1;
      const { db, close } = createNodeSqliteAdapter(dbPath);
      const ports: RuntimePorts = {
        db,
        clock: createTestClock(),
        ids: createTestIds(instance),
        logger: createTestLogger()
      };
      return { ports, close };
    },
    cleanup() {
      // Windows holds SQLite WAL/SHM handles briefly after close, so retry
      // rather than leaving temporary directories behind.
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // A leftover temp directory is not worth failing a test over; it is
        // isolated and the OS reclaims it.
      }
    }
  };
}
