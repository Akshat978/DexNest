// Continuing a session the operator already primed.
//
// The value of an existing session is the argument that produced the plan, and
// that only survives if the run resumes the actual conversation. So the tests
// care about two things: that identity is carried through to a --resume rather
// than a fresh --session-id, and that a session is never adopted while someone
// else might still be writing to it.
//
// Real SQLite and a real transcript store on disk. No provider is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SessionDiscovery, describeSession, SESSION_LIVE_WINDOW_MS } from "../src/sessionDiscovery.ts";
import { SessionAttachStore, SessionAttachError, renderAttachedSession } from "../src/sessionAttach.ts";
import { claudeCodeProtocol } from "../src/claudeCodeWorker.ts";
import { WorkerStore } from "../src/workerStore.ts";
import { AutopilotStore } from "../src/store.ts";
import { createRunSpec } from "../src/runSpec.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger } from "./helpers/harness.ts";
import { createPlatformPorts } from "./helpers/platform.ts";
import type { RuntimePorts } from "../src/ports.ts";

const NOW = "2026-09-06T12:00:00.000Z";
const PROJECT = "D:/MyApp";
const PRIMED = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER = "bbbbbbbb-2222-4222-8222-222222222222";

/** Writes a transcript in the shape Claude Code actually produces. */
function transcript(options: {
  sessionId: string; cwd: string; entrypoint: string; title?: string;
  first: string; last: string; filler?: number;
  /** Bytes of prompt on the leading record, before anything identifying. */
  leadingPromptBytes?: number;
}): string {
  const lines: string[] = [
    JSON.stringify({
      type: "queue-operation", operation: "enqueue", timestamp: options.first, sessionId: options.sessionId,
      // Real transcripts put the entire prompt on this one line, ahead of every
      // record that identifies the session.
      ...(options.leadingPromptBytes ? { content: "p".repeat(options.leadingPromptBytes) } : {})
    }),
    JSON.stringify({
      type: "user", message: { role: "user", content: "design the thing" }, timestamp: options.first,
      entrypoint: options.entrypoint, cwd: options.cwd, sessionId: options.sessionId,
      version: "2.1.261", gitBranch: "main", isSidechain: false
    })
  ];
  if (options.title) lines.push(JSON.stringify({ type: "ai-title", aiTitle: options.title, sessionId: options.sessionId }));
  // Bulk, so the tail sample is exercised rather than the head being the file.
  for (let index = 0; index < (options.filler ?? 0); index += 1) {
    lines.push(JSON.stringify({ type: "assistant", padding: "x".repeat(400), timestamp: options.first, sessionId: options.sessionId }));
  }
  lines.push(JSON.stringify({ type: "assistant", message: { role: "assistant" }, timestamp: options.last, sessionId: options.sessionId }));
  return lines.join("\n") + "\n";
}

function store(t: { after(fn: () => void): void }, options: { withRunSession?: boolean } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-attach-"));
  const projects = resolve(root, "projects");
  // The directory name is a lossy encoding of the path; discovery must not
  // depend on it, so the fixture deliberately uses a mismatched drive case.
  mkdirSync(resolve(projects, "d--MyApp"), { recursive: true });
  mkdirSync(resolve(projects, "C--Elsewhere"), { recursive: true });

  const write = (dir: string, id: string, opts: Parameters<typeof transcript>[0]) =>
    writeFileSync(resolve(projects, dir, `${id}.jsonl`), transcript(opts), "utf8");

  write("d--MyApp", PRIMED, {
    sessionId: PRIMED, cwd: "D:\\MyApp", entrypoint: "claude-vscode", title: "Architecture for the notifications system",
    first: "2026-09-04T09:00:00.000Z", last: "2026-09-05T18:00:00.000Z", filler: 300
  });
  write("d--MyApp", OTHER, {
    sessionId: OTHER, cwd: "D:\\MyApp", entrypoint: "sdk-cli", title: "A DexNest run",
    first: "2026-09-05T10:00:00.000Z", last: "2026-09-05T10:05:00.000Z"
  });
  write("C--Elsewhere", "cccccccc-3333-4333-8333-333333333333", {
    sessionId: "cccccccc-3333-4333-8333-333333333333", cwd: "C:\\Elsewhere", entrypoint: "claude-vscode",
    first: "2026-09-05T11:00:00.000Z", last: "2026-09-05T11:30:00.000Z"
  });

  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));
  const platform = createPlatformPorts({ USERPROFILE: root });
  const ports: RuntimePorts = {
    db: database.db, platform, clock: createTestClock(NOW), ids: createTestIds(1), logger: createTestLogger()
  };
  runAutopilotMigrations(ports.db, NOW);
  const runs = new AutopilotStore(ports);
  for (const id of ["run-a", "run-b"]) {
    runs.createRun({ spec: { ...createRunSpec({ goal: "g" }, { id, now: NOW }), id }, executorId: "test" });
  }
  if (options.withRunSession) {
    // established:true makes it a conversation, not a placeholder. A virgin row
    // (created by authorizing the loop, never spoken through) does NOT block
    // adoption -- that case has its own tests.
    new WorkerStore(ports).createSession({ runId: "run-a", provider: "claude", sessionId: "own-session", cwd: PROJECT, established: false });
    ports.db.prepare("UPDATE autopilot_worker_sessions SET established=1 WHERE run_id='run-a'").run({});
  }

  t.after(() => { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return {
    ports, runs, root,
    discovery: new SessionDiscovery({ fs: platform.fs, env: platform.env, now: () => NOW, root: projects }),
    attach: new SessionAttachStore(ports),
    write: (id: string, opts: Parameters<typeof transcript>[0]) => write("d--MyApp", id, opts)
  };
}

// --- discovery --------------------------------------------------------------

test("sessions are matched on the cwd inside the transcript, not the directory name", (t) => {
  const { discovery } = store(t);
  const found = discovery.forProject(PROJECT);
  assert.deepEqual(found.map((session) => session.sessionId), [PRIMED, OTHER], "newest first");
  // C:\Elsewhere lives in the same root and must not appear.
  assert.equal(found.some((session) => session.projectPath?.includes("Elsewhere")), false);
});

test("metadata is read without loading the transcript", (t) => {
  const { discovery } = store(t);
  const primed = discovery.forProject(PROJECT)[0]!;
  assert.equal(primed.title, "Architecture for the notifications system");
  assert.equal(primed.origin, "vscode", "a session from the editor is distinguishable from a DexNest one");
  assert.equal(primed.cliVersion, "2.1.261");
  assert.equal(primed.gitBranch, "main");
  assert.equal(primed.firstActivity, "2026-09-04T09:00:00.000Z");
  // The last timestamp lives past the head sample, so this proves the tail read.
  assert.equal(primed.lastActivity, "2026-09-05T18:00:00.000Z");
  assert.ok(primed.sizeBytes > 64 * 1024, "fixture must exceed the head sample to be a real test");
  assert.equal(discovery.forProject(PROJECT)[1]!.origin, "cli");
});

test("a session whose identifying record sits past the first sample is still found", (t) => {
  // Regression. The fixed 64 KB head window was cut in the middle of the huge
  // leading prompt line on a real DexNest transcript, so cwd came back null and
  // the session was invisible in its own project. Found by running discovery
  // against the real store, not by this suite, which is why it is pinned here.
  const h = store(t);
  h.write(PRIMED, {
    sessionId: PRIMED, cwd: "D:\\MyApp", entrypoint: "sdk-cli", title: "A very long opening prompt",
    first: "2026-09-04T09:00:00.000Z", last: "2026-09-05T18:00:00.000Z",
    leadingPromptBytes: 200 * 1024
  });
  const found = h.discovery.forProject(PROJECT).find((session) => session.sessionId === PRIMED);
  assert.ok(found, "a session must not disappear because its first line is large");
  assert.equal(found!.projectPath, "D:\\MyApp");
  assert.equal(found!.origin, "cli");
  assert.equal(found!.lastActivity, "2026-09-05T18:00:00.000Z");
});

test("escalation stops at the cap rather than loading an unbounded file", (t) => {
  const h = store(t);
  // Identifying records pushed past every escalation window.
  h.write(PRIMED, {
    sessionId: PRIMED, cwd: "D:\\MyApp", entrypoint: "sdk-cli",
    first: "2026-09-04T09:00:00.000Z", last: "2026-09-05T18:00:00.000Z",
    leadingPromptBytes: 2 * 1024 * 1024
  });
  // It drops out of this project's list rather than costing an unbounded read.
  assert.equal(h.discovery.forProject(PROJECT).some((session) => session.sessionId === PRIMED), false);
});

test("a recently written transcript is treated as still open", (t) => {
  const h = store(t);
  const recent = new Date(Date.parse(NOW) - SESSION_LIVE_WINDOW_MS / 2).toISOString();
  h.write(PRIMED, {
    sessionId: PRIMED, cwd: "D:\\MyApp", entrypoint: "claude-vscode", title: "Still open",
    first: "2026-09-04T09:00:00.000Z", last: recent
  });
  assert.equal(h.discovery.forProject(PROJECT)[0]!.live, true);

  const stale = new Date(Date.parse(NOW) - SESSION_LIVE_WINDOW_MS * 2).toISOString();
  h.write(PRIMED, {
    sessionId: PRIMED, cwd: "D:\\MyApp", entrypoint: "claude-vscode", title: "Closed",
    first: "2026-09-04T09:00:00.000Z", last: stale
  });
  assert.equal(h.discovery.forProject(PROJECT)[0]!.live, false);
});

test("malformed, empty and non-session files are skipped rather than thrown on", (t) => {
  const h = store(t);
  const dir = resolve(h.root, "projects", "d--MyApp");
  writeFileSync(resolve(dir, "notes.txt"), "not a session", "utf8");
  writeFileSync(resolve(dir, "dddddddd-4444-4444-8444-444444444444.jsonl"), "{ broken\n{ also broken\n", "utf8");
  writeFileSync(resolve(dir, "eeeeeeee-5555-4555-8555-555555555555.jsonl"), "", "utf8");
  assert.deepEqual(h.discovery.forProject(PROJECT).map((session) => session.sessionId), [PRIMED, OTHER]);
});

test("a missing transcript root is not an error", (t) => {
  const { ports } = store(t);
  const discovery = new SessionDiscovery({
    fs: ports.platform!.fs, env: ports.platform!.env, now: () => NOW, root: "D:/nope/does/not/exist"
  });
  assert.equal(discovery.root(), null);
  assert.deepEqual(discovery.forProject(PROJECT), []);
});

// --- attaching --------------------------------------------------------------

test("attaching adopts the session so the next send resumes it", (t) => {
  const h = store(t);
  const session = h.discovery.forProject(PROJECT)[0]!;
  const record = h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT });

  assert.equal(record.sessionId, PRIMED);
  assert.equal(record.origin, "vscode");
  assert.equal(record.title, "Architecture for the notifications system");

  const worker = new WorkerStore(h.ports).session("run-a")!;
  assert.equal(worker.sessionId, PRIMED);
  assert.equal(worker.established, true, "an adopted session is already established");

  // The actual point of the phase: the CLI is told to resume, not to start.
  const intent = claudeCodeProtocol("C:/claude/claude.exe").prompt(worker, "continue");
  assert.ok(intent.args.includes("--resume"), "expected --resume");
  assert.equal(intent.args[intent.args.indexOf("--resume") + 1], PRIMED);
  assert.equal(intent.args.includes("--session-id"), false);
});

test("a session open somewhere else is refused, because a transcript has one writer", (t) => {
  const h = store(t);
  const recent = new Date(Date.parse(NOW) - 60_000).toISOString();
  h.write(PRIMED, {
    sessionId: PRIMED, cwd: "D:\\MyApp", entrypoint: "claude-vscode", title: "Open in the editor",
    first: "2026-09-04T09:00:00.000Z", last: recent
  });
  const session = h.discovery.forProject(PROJECT)[0]!;
  assert.throws(
    () => h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT }),
    (error: SessionAttachError) => error.blocker === "live"
  );
  assert.equal(new WorkerStore(h.ports).session("run-a"), null, "a refused attach must leave no session behind");
});

test("a session already adopted by another run is refused", (t) => {
  const h = store(t);
  const session = h.discovery.forProject(PROJECT)[0]!;
  h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT });
  assert.throws(
    () => h.attach.attach({ runId: "run-b", provider: "claude", session, workspaceRoot: PROJECT }),
    (error: SessionAttachError) => error.blocker === "attached_elsewhere"
  );
});

test("a placeholder session nothing has spoken through does not block adoption", (t) => {
  // Authorizing the loop creates the run's session because the grant binds to
  // it. Every created run therefore "had a session", and the whole attach path
  // was unreachable outside tests -- found on the first real attempt to use it.
  const h = store(t);
  new WorkerStore(h.ports).createSession({ runId: "run-a", provider: "claude", sessionId: "placeholder-id", cwd: PROJECT, established: false });

  const session = h.discovery.forProject(PROJECT)[0]!;
  const record = h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT });
  assert.equal(record.sessionId, PRIMED);

  const worker = new WorkerStore(h.ports).session("run-a")!;
  assert.equal(worker.sessionId, PRIMED, "the placeholder is replaced, not kept alongside");
  assert.equal(worker.established, true);
});

test("adopting re-points an active grant at the adopted session", (t) => {
  // The grant is bound to a session id. Left pointing at the discarded
  // placeholder, the journal would record an authorization for a session that
  // no longer exists.
  const h = store(t);
  new WorkerStore(h.ports).createSession({ runId: "run-a", provider: "claude", sessionId: "placeholder-id", cwd: PROJECT, established: false });
  h.ports.db.prepare(`INSERT INTO autopilot_loop_grants (id, run_id, provider, session_id, workspace_root, max_turns, status, granted_by, granted_at)
    VALUES ('grant-1','run-a','claude','placeholder-id',:root,10,'ACTIVE','test',:now)`).run({ root: PROJECT, now: NOW });

  const session = h.discovery.forProject(PROJECT)[0]!;
  h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT });

  const grant = h.ports.db.prepare("SELECT session_id FROM autopilot_loop_grants WHERE id='grant-1'").get<{ session_id: string }>({})!;
  assert.equal(grant.session_id, PRIMED);
});

test("a run whose conversation has begun cannot adopt another", (t) => {
  const h = store(t, { withRunSession: true });
  const session = h.discovery.forProject(PROJECT)[0]!;
  assert.throws(
    () => h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT }),
    (error: SessionAttachError) => error.blocker === "run_has_session"
  );
});

test("a session from another project is refused", (t) => {
  const h = store(t);
  const session = h.discovery.forProject(PROJECT)[0]!;
  assert.throws(
    () => h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: "D:/SomewhereElse" }),
    (error: SessionAttachError) => error.blocker === "project_mismatch"
  );
});

test("Codex threads are not adopted from disk, and say so", (t) => {
  const h = store(t);
  const session = h.discovery.forProject(PROJECT)[0]!;
  assert.throws(
    () => h.attach.attach({ runId: "run-a", provider: "codex", session, workspaceRoot: PROJECT }),
    /Codex threads are bound by id/
  );
});

test("candidates explain themselves instead of disappearing", (t) => {
  const h = store(t);
  const candidates = h.attach.candidates({
    runId: "run-a", workspaceRoot: PROJECT, sessions: h.discovery.forProject(PROJECT)
  });
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((candidate) => candidate.attachable));

  h.attach.attach({ runId: "run-a", provider: "claude", session: candidates[0]!.session, workspaceRoot: PROJECT });
  const after = h.attach.candidates({
    runId: "run-b", workspaceRoot: PROJECT, sessions: h.discovery.forProject(PROJECT)
  });
  assert.deepEqual(after[0]!.blockers, ["attached_elsewhere"]);
  assert.equal(after[0]!.attachable, false);
  assert.equal(after[1]!.attachable, true, "an unrelated session stays available");
});

test("attaching journals metadata and never transcript content", (t) => {
  const h = store(t);
  const session = h.discovery.forProject(PROJECT)[0]!;
  h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT });

  const event = h.runs.listEvents("run-a").find((entry) => entry.type === "WORKER_SESSION_ATTACHED")!;
  assert.ok(event);
  const payload = JSON.stringify(event.payload);
  assert.match(payload, /Architecture for the notifications system/);
  assert.equal(payload.includes("design the thing"), false, "no message content may reach the journal");
  assert.equal(payload.includes(session.transcriptPath), false, "the transcript path is provenance, not journal payload");
});

test("attaching requires migration 17", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-attach-nomig-"));
  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));
  t.after(() => { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); });
  const ports: RuntimePorts = {
    db: database.db, platform: createPlatformPorts({}), clock: createTestClock(NOW),
    ids: createTestIds(1), logger: createTestLogger()
  };
  runAutopilotMigrations(ports.db, NOW, []);
  const attach = new SessionAttachStore(ports);
  assert.equal(attach.record("run-a"), null);
  assert.throws(
    () => attach.attach({
      runId: "run-a", provider: "claude", workspaceRoot: PROJECT,
      session: {
        sessionId: PRIMED, transcriptPath: "x", projectPath: PROJECT, origin: "vscode", title: null,
        cliVersion: null, gitBranch: null, firstActivity: null, lastActivity: null, sizeBytes: 1, live: false
      }
    }),
    /migration 17/
  );
});

// --- rendering --------------------------------------------------------------

test("descriptions are readable and content-free", (t) => {
  const h = store(t);
  const line = describeSession(h.discovery.forProject(PROJECT)[0]!);
  assert.match(line, /Architecture for the notifications system/);
  assert.match(line, /from your editor/);
  assert.match(line, /MB|KB/);

  const session = h.discovery.forProject(PROJECT)[0]!;
  h.attach.attach({ runId: "run-a", provider: "claude", session, workspaceRoot: PROJECT });
  assert.match(renderAttachedSession(h.attach.record("run-a")), /Continuing claude session/);
  assert.equal(renderAttachedSession(null), "This run uses a session DexNest created for it.");
});
