// A real repository with a local bare "origin", a test database, the event
// log and a git-ops instance - all in temp directories.

import { createEventLog, runFoundationMigrations, type EventLog } from "@dexnest/foundation";
import { createTestDatabase, type TestDatabase } from "@dexnest/foundation/testing";
import { createProjectsStore, normaliseProjectInput, runProjectsMigrations, type GitRunner, type GitRunRequest, type ProjectsStore } from "@dexnest/projects";

import { sandbox, type Sandbox } from "../../projects/test/gitRepos.ts";
import { createGitOps, type ExecuteResult, type GitOps, type GitOpsOptions } from "../src/executor.ts";

export interface World {
  b: Sandbox;
  bare: string;
  app: string;
  db: TestDatabase;
  store: ProjectsStore;
  events: EventLog;
  ops: GitOps;
  /** Every git call git-ops and its reader made. */
  calls: GitRunRequest[];
  make(overrides?: Partial<GitOpsOptions>): GitOps;
  dispose(): void;
}

export function world(options: { runner?: (inner: GitRunner) => GitRunner } = {}): World {
  const b = sandbox("dexnest-gitops-");
  const { bare, app } = b.origin();
  const db = createTestDatabase("dexnest-gitops-db-");
  runFoundationMigrations(db.db);
  runProjectsMigrations(db.db);
  const store = createProjectsStore(db.db);
  const events = createEventLog(db.db);
  for (const id of ["app", "second", "third"]) {
    const made = normaliseProjectInput({ id, name: id, path: `${b.root}/${id}` }, { existing: null, takenIds: new Set(), now: "2026-10-01T00:00:00.000Z", newCommandId: () => "cmd_1" });
    if (made.ok) store.save(made.project);
  }
  const runner = options.runner ? options.runner(b.runner) : b.runner;
  let n = 0;
  const make = (overrides: Partial<GitOpsOptions> = {}) =>
    createGitOps({ runner, reader: b.reader(), store, events, newOpId: () => `op_${++n}`, ...overrides });
  return {
    b,
    bare,
    app,
    db,
    store,
    events,
    ops: make(),
    calls: b.calls,
    make,
    dispose() {
      db.dispose();
      b.dispose();
    }
  };
}

export function done(result: ExecuteResult): Extract<ExecuteResult, { status: "done" }> {
  if (result.status !== "done") throw new Error(`expected done, got ${result.status}: ${JSON.stringify(result).slice(0, 400)}`);
  return result;
}

export function commitFile(w: World, cwd: string, name: string, content: string, message: string): string {
  w.b.write(`${cwd}/${name}`, content);
  w.b.git(cwd, "add", name);
  w.b.git(cwd, "commit", "-q", "-m", message);
  return w.b.git(cwd, "rev-parse", "HEAD").trim();
}

export const P = "app";
