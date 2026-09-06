// Binding a run to a session the operator already has.
//
// Creating a session is the easy case and the wrong one. The session the human
// primed carries the argument that produced the plan; a fresh one carries the
// plan alone. So a run may adopt an existing session as its PRIMARY, which
// means the very first send resumes rather than starts.
//
// WHAT ATTACHING ACTUALLY DOES
//
// Claude's session identity is the same uuid whether starting or resuming, so
// adoption is: write the worker session row with that uuid and established=1.
// The protocol then emits --resume instead of --session-id. Nothing else in the
// worker path changes, which is the point — attaching is a fact about identity,
// not a second code path.
//
// WHY THE GUARDS ARE STRICT
//
// A transcript is a single-writer file. If the operator still has the session
// open in their editor, DexNest appending to it produces two writers and an
// interleaved conversation neither side can reason about. There is no recovery
// from that, so a session that looks open is refused rather than merged, and a
// session already adopted by another run is refused outright.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { DiscoveredSession, SessionOrigin } from "./sessionDiscovery.ts";
import { canonicalize, samePath } from "./paths.ts";
import { AutopilotStore } from "./store.ts";
import { WorkerStore } from "./workerStore.ts";

export type AttachBlocker =
  /** Written to recently, so probably still open in the operator's editor. */
  | "live"
  /** Another run already adopted it; a session has one writer. */
  | "attached_elsewhere"
  /** Recorded working directory is not this run's workspace. */
  | "project_mismatch"
  /** This run already has a session. */
  | "run_has_session";

export const ATTACH_BLOCKER_REASONS: Record<AttachBlocker, string> = {
  live: "This session was active in the last few minutes, so it is probably still open. Close it, or choose another.",
  attached_elsewhere: "Another run is already continuing this session.",
  project_mismatch: "This session was not working in this project.",
  run_has_session: "This run's conversation has already started, so it cannot adopt another."
};

export interface SessionCandidate {
  session: DiscoveredSession;
  blockers: AttachBlocker[];
  attachable: boolean;
}

export interface AttachedSessionRecord {
  runId: string;
  provider: string;
  sessionId: string;
  origin: SessionOrigin;
  /** The agent's own title at the moment of attaching. Never updated. */
  title: string | null;
  transcriptPath: string | null;
  attachedAt: string;
}

export class SessionAttachError extends Error {
  readonly blocker: AttachBlocker | "unsupported";

  constructor(blocker: AttachBlocker | "unsupported", message: string) {
    super(message);
    this.name = "SessionAttachError";
    this.blocker = blocker;
  }
}

interface AttachRow {
  run_id: string;
  provider: string;
  session_id: string;
  origin: string;
  title: string | null;
  transcript_path: string | null;
  attached_at: string;
}

const toRecord = (row: AttachRow): AttachedSessionRecord => ({
  runId: row.run_id,
  provider: row.provider,
  sessionId: row.session_id,
  origin: row.origin as SessionOrigin,
  title: row.title,
  transcriptPath: row.transcript_path,
  attachedAt: row.attached_at
});

export class SessionAttachStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;
  private readonly workers: WorkerStore;
  private readonly windows: boolean;

  constructor(ports: RuntimePorts, options: { windows?: boolean } = {}) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
    this.workers = new WorkerStore(ports);
    this.windows = options.windows ?? true;
  }

  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_attached_sessions'").get()
    );
  }

  /** What this run adopted, if anything. Null for runs with their own session. */
  record(runId: string): AttachedSessionRecord | null {
    if (!this.available()) return null;
    const row = this.db.prepare("SELECT * FROM autopilot_attached_sessions WHERE run_id=:runId").get<AttachRow>({ runId });
    return row ? toRecord(row) : null;
  }

  /** The run that already writes to this session, if any. */
  private holder(sessionId: string): string | null {
    const row = this.db
      .prepare("SELECT run_id FROM autopilot_worker_sessions WHERE session_id=:sessionId")
      .get<{ run_id: string }>({ sessionId });
    return row?.run_id ?? null;
  }

  private blockersFor(input: { runId: string; session: DiscoveredSession; workspaceRoot: string }): AttachBlocker[] {
    const blockers: AttachBlocker[] = [];
    if (input.session.live) blockers.push("live");

    const holder = this.holder(input.session.sessionId);
    if (holder && holder !== input.runId) blockers.push("attached_elsewhere");

    const recorded = input.session.projectPath;
    if (!recorded || !samePath(
      canonicalize(recorded, { windows: this.windows }),
      canonicalize(input.workspaceRoot, { windows: this.windows }),
      this.windows
    )) blockers.push("project_mismatch");

    const existing = this.workers.session(input.runId);
    if (existing && !this.virgin(input.runId)) blockers.push("run_has_session");
    return blockers;
  }

  /**
   * A session row nothing has ever spoken through.
   *
   * Authorizing the loop creates the run's session, because the grant binds to
   * it -- which meant every created run "had a session" and could never adopt
   * one, and the entire attach path was reachable only from tests. The
   * invariant behind run_has_session is about conversations, not rows: a run
   * whose conversation has begun must not be pointed elsewhere. A placeholder
   * that has never sent, never resumed and has no turns is not a conversation.
   */
  private virgin(runId: string): boolean {
    const session = this.workers.session(runId);
    if (!session || session.established) return false;
    if (this.workers.list(runId).length > 0) return false;
    const hasTurns = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_turns'").get()
      ? this.db.prepare("SELECT id FROM autopilot_turns WHERE run_id=:runId LIMIT 1").get({ runId })
      : null;
    return !hasTurns;
  }

  /**
   * Annotates discovered sessions with why each can or cannot be adopted.
   * Everything is returned: an operator looking for a session they know exists
   * is better served by seeing it greyed out with a reason than by its absence.
   */
  candidates(input: { runId: string; workspaceRoot: string; sessions: DiscoveredSession[] }): SessionCandidate[] {
    return input.sessions.map((session) => {
      const blockers = this.blockersFor({ runId: input.runId, session, workspaceRoot: input.workspaceRoot });
      return { session, blockers, attachable: blockers.length === 0 };
    });
  }

  /**
   * Adopts a session as this run's PRIMARY.
   *
   * The worker session row is written with established=1, so the next send
   * resumes the conversation instead of opening a new one.
   */
  attach(input: {
    runId: string;
    provider: string;
    session: DiscoveredSession;
    workspaceRoot: string;
  }): AttachedSessionRecord {
    if (!this.available()) throw new SessionAttachError("unsupported", "Attaching a session requires migration 17.");
    if (input.provider !== "claude") {
      throw new SessionAttachError(
        "unsupported",
        "Only Claude Code sessions can be adopted from disk today; Codex threads are bound by id."
      );
    }

    return this.store.transaction(() => {
      const blockers = this.blockersFor(input);
      if (blockers.length > 0) {
        throw new SessionAttachError(blockers[0]!, ATTACH_BLOCKER_REASONS[blockers[0]!]);
      }

      const now = this.ports.clock.now();
      // established=1 is the whole point: the first send must resume.
      const placeholder = this.virgin(input.runId) ? this.workers.session(input.runId) : null;
      if (placeholder) {
        // The row the authorization created, never spoken through. Adoption
        // takes its place, and the active grant follows: the grant is bound to
        // a session id, and leaving it pointing at the discarded placeholder
        // would record an authorization for a session that no longer exists.
        this.db
          .prepare(
            `UPDATE autopilot_worker_sessions
                SET provider=:provider, session_id=:sessionId, cwd=:cwd, established=1,
                    provider_session_id=NULL, restored=0, created_at=:now
              WHERE run_id=:runId`
          )
          .run({
            runId: input.runId, provider: input.provider,
            sessionId: input.session.sessionId, cwd: input.workspaceRoot, now
          });
        this.db
          .prepare("UPDATE autopilot_loop_grants SET session_id=:sessionId WHERE run_id=:runId AND status='ACTIVE'")
          .run({ runId: input.runId, sessionId: input.session.sessionId });
      } else {
        this.db
          .prepare(
            `INSERT INTO autopilot_worker_sessions (run_id, provider, session_id, cwd, established, created_at)
             VALUES (:runId, :provider, :sessionId, :cwd, 1, :now)`
          )
          .run({
            runId: input.runId, provider: input.provider,
            sessionId: input.session.sessionId, cwd: input.workspaceRoot, now
          });
      }

      this.db
        .prepare(
          `INSERT INTO autopilot_attached_sessions (run_id, provider, session_id, origin, title, transcript_path, attached_at)
           VALUES (:runId, :provider, :sessionId, :origin, :title, :transcriptPath, :now)`
        )
        .run({
          runId: input.runId, provider: input.provider, sessionId: input.session.sessionId,
          origin: input.session.origin, title: input.session.title,
          transcriptPath: input.session.transcriptPath, now
        });

      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(run.id, run.state, {
        type: "WORKER_SESSION_ATTACHED",
        payload: {
          provider: input.provider,
          sessionId: input.session.sessionId,
          origin: input.session.origin,
          // Metadata only. Transcript content is never journalled.
          title: input.session.title,
          lastActivity: input.session.lastActivity,
          replacedPlaceholder: Boolean(placeholder),
          ...(placeholder ? { placeholderSessionId: placeholder.sessionId } : {})
        }
      });
      return this.record(input.runId)!;
    });
  }
}

/** What the operator should read before a run continues their conversation. */
export function renderAttachedSession(record: AttachedSessionRecord | null): string {
  if (!record) return "This run uses a session DexNest created for it.";
  const origin = record.origin === "vscode" ? "your editor" : record.origin === "cli" ? "a command line" : "an unknown client";
  return [
    `Continuing ${record.provider} session ${record.sessionId}`,
    record.title ? `"${record.title}"` : null,
    `started in ${origin}, adopted ${record.attachedAt}`
  ].filter(Boolean).join(" · ");
}
