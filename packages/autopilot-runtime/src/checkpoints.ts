// Known-good checkpoints.
//
// After a fully green verification the loop commits the worktree, so a later
// regression has something to return to. Everything here is deliberately
// conservative:
//
//   - only the run's own worktree is touched; the primary checkout never is
//   - never push, never merge, never rebase, never amend, never delete
//   - no commit when there is nothing to commit
//   - one checkpoint per turn, enforced by a UNIQUE index
//
// Every git call goes through the effects gateway, so checkpoints obey the same
// capability policy as any other effect.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { EffectsGateway } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";
import { AutopilotStore } from "./store.ts";

export type CheckpointStatus = "INTENT" | "COMMITTED" | "NO_CHANGES" | "FAILED";

export interface CheckpointRecord {
  id: string;
  runId: string;
  turnId: string;
  verificationId: string | null;
  marker: string;
  status: CheckpointStatus;
  commitSha: string | null;
  headBefore: string | null;
  message: string;
  detail: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface WorkspaceSnapshot {
  id: string;
  runId: string;
  turnId: string | null;
  reason: string;
  headSha: string | null;
  statusText: string;
  diffStat: string;
  changedFiles: number;
  createdAt: string;
}

interface CheckpointRow {
  id: string; run_id: string; turn_id: string; verification_id: string | null; marker: string;
  status: string; commit_sha: string | null; head_before: string | null; message: string;
  detail: string | null; created_at: string; settled_at: string | null;
}
interface SnapshotRow {
  id: string; run_id: string; turn_id: string | null; reason: string; head_sha: string | null;
  status_text: string; diff_stat: string; changed_files: number; created_at: string;
}

const MAX_TEXT = 4000;

function truncate(value: string, limit = MAX_TEXT): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n…(truncated)`;
}

/** The token embedded in a checkpoint commit message. Stable per turn. */
export function checkpointMarker(turnId: string): string {
  return `dexnest-checkpoint:${turnId}`;
}

/** Deterministic message. DexNest authors it; no model text is ever committed. */
export function checkpointMessage(input: { runId: string; ordinal: number; marker: string; summary: string }): string {
  return [
    `DexNest Autopilot checkpoint: turn ${input.ordinal}`,
    "",
    `Verification: ${input.summary}`,
    `Run: ${input.runId}`,
    input.marker
  ].join("\n");
}

export class CheckpointStore {
  private readonly db: SqlDatabase;
  private readonly ports: RuntimePorts;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private toCheckpoint(row: CheckpointRow): CheckpointRecord {
    return {
      id: row.id, runId: row.run_id, turnId: row.turn_id, verificationId: row.verification_id,
      marker: row.marker, status: row.status as CheckpointStatus, commitSha: row.commit_sha,
      headBefore: row.head_before, message: row.message, detail: row.detail,
      createdAt: row.created_at, settledAt: row.settled_at
    };
  }

  forTurn(turnId: string): CheckpointRecord | null {
    const row = this.db.prepare("SELECT * FROM autopilot_checkpoints WHERE turn_id = :turnId").get<CheckpointRow>({ turnId });
    return row ? this.toCheckpoint(row) : null;
  }

  list(runId: string): CheckpointRecord[] {
    return this.db
      .prepare("SELECT * FROM autopilot_checkpoints WHERE run_id = :runId ORDER BY created_at, rowid")
      .all<CheckpointRow>({ runId })
      .map((row) => this.toCheckpoint(row));
  }

  /** Journals the intent and COMMITS before any git command runs. */
  recordIntent(input: { runId: string; turnId: string; ordinal: number; verificationId: string | null; summary: string; headBefore: string | null }): CheckpointRecord {
    return this.store.transaction(() => {
      const existing = this.forTurn(input.turnId);
      if (existing) return existing;

      const marker = checkpointMarker(input.turnId);
      const message = checkpointMessage({ runId: input.runId, ordinal: input.ordinal, marker, summary: input.summary });
      const id = this.ports.ids.next("checkpoint");
      const now = this.ports.clock.now();

      this.db
        .prepare(
          `INSERT INTO autopilot_checkpoints
             (id, run_id, turn_id, verification_id, marker, status, commit_sha, head_before, message, detail, created_at)
           VALUES (:id, :runId, :turnId, :verificationId, :marker, 'INTENT', NULL, :headBefore, :message, NULL, :now)`
        )
        .run({ id, runId: input.runId, turnId: input.turnId, verificationId: input.verificationId, marker, headBefore: input.headBefore, message, now });

      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: "CHECKPOINT_INTENT_RECORDED",
        payload: { checkpointId: id, turnId: input.turnId, marker, headBefore: input.headBefore }
      });
      return this.forTurn(input.turnId)!;
    });
  }

  settle(input: { checkpointId: string; status: Exclude<CheckpointStatus, "INTENT">; commitSha?: string | null; detail?: string | null; recovered?: boolean }): CheckpointRecord {
    return this.store.transaction(() => {
      const now = this.ports.clock.now();
      this.db
        .prepare("UPDATE autopilot_checkpoints SET status = :status, commit_sha = :sha, detail = :detail, settled_at = :now WHERE id = :id")
        .run({ id: input.checkpointId, status: input.status, sha: input.commitSha ?? null, detail: input.detail ?? null, now });

      const row = this.db.prepare("SELECT * FROM autopilot_checkpoints WHERE id = :id").get<CheckpointRow>({ id: input.checkpointId })!;
      const record = this.toCheckpoint(row);
      const run = this.store.requireRun(record.runId);
      this.store.appendEventUnsafe(record.runId, run.state, {
        type: input.recovered
          ? "CHECKPOINT_RECOVERED"
          : input.status === "COMMITTED"
            ? "CHECKPOINT_CREATED"
            : input.status === "NO_CHANGES"
              ? "CHECKPOINT_NO_CHANGES"
              : "CHECKPOINT_FAILED",
        payload: { checkpointId: record.id, turnId: record.turnId, status: record.status, commitSha: record.commitSha, detail: record.detail }
      });
      return record;
    });
  }

  recordSnapshot(input: { runId: string; turnId: string | null; reason: string; headSha: string | null; statusText: string; diffStat: string; changedFiles: number }): WorkspaceSnapshot {
    return this.store.transaction(() => {
      const id = this.ports.ids.next("snapshot");
      const now = this.ports.clock.now();
      this.db
        .prepare(
          `INSERT INTO autopilot_workspace_snapshots
             (id, run_id, turn_id, reason, head_sha, status_text, diff_stat, changed_files, created_at)
           VALUES (:id, :runId, :turnId, :reason, :headSha, :statusText, :diffStat, :changedFiles, :now)`
        )
        .run({
          id, runId: input.runId, turnId: input.turnId, reason: input.reason, headSha: input.headSha,
          statusText: truncate(input.statusText), diffStat: truncate(input.diffStat), changedFiles: input.changedFiles, now
        });

      const run = this.store.requireRun(input.runId);
      this.store.appendEventUnsafe(input.runId, run.state, {
        type: "WORKSPACE_SNAPSHOT_RECORDED",
        payload: { snapshotId: id, reason: input.reason, headSha: input.headSha, changedFiles: input.changedFiles }
      });
      return this.snapshots(input.runId).find((snapshot) => snapshot.id === id)!;
    });
  }

  snapshots(runId: string): WorkspaceSnapshot[] {
    return this.db
      .prepare("SELECT * FROM autopilot_workspace_snapshots WHERE run_id = :runId ORDER BY created_at, rowid")
      .all<SnapshotRow>({ runId })
      .map((row) => ({
        id: row.id, runId: row.run_id, turnId: row.turn_id, reason: row.reason, headSha: row.head_sha,
        statusText: row.status_text, diffStat: row.diff_stat, changedFiles: row.changed_files, createdAt: row.created_at
      }));
  }

  latestSnapshot(runId: string): WorkspaceSnapshot | null {
    return this.snapshots(runId).at(-1) ?? null;
  }
}

export interface CheckpointerOptions {
  ports: RuntimePorts;
  effects: EffectsGateway;
  policy: CapabilityPolicy;
}

export class Checkpointer {
  readonly store: CheckpointStore;

  private readonly ports: RuntimePorts;
  private readonly effects: EffectsGateway;
  private readonly policy: CapabilityPolicy;

  constructor(options: CheckpointerOptions) {
    this.ports = options.ports;
    this.effects = options.effects;
    this.policy = options.policy;
    this.store = new CheckpointStore(options.ports);
  }

  /** Runs one git operation through policy and the dispatcher. */
  private async git(runId: string, operation: string, args: string[], cwd: string, purpose: string): Promise<{ ok: boolean; out: string; err: string }> {
    const outcome = await this.effects.request({
      runId,
      stepKey: this.ports.ids.next(`git-${operation}`),
      policy: this.policy,
      intent: { kind: "GIT_OPERATION", operation, args, cwd, purpose }
    });
    if (!("result" in outcome)) {
      const reason = outcome.status === "DENIED" ? outcome.decision.reason : `not authorized (${outcome.status})`;
      return { ok: false, out: "", err: reason };
    }
    return { ok: outcome.result.ok, out: (outcome.result.stdout ?? "").trim(), err: (outcome.result.stderr ?? "").trim() };
  }

  async head(runId: string, cwd: string): Promise<string | null> {
    const result = await this.git(runId, "rev-parse", ["HEAD"], cwd, "checkpoint: read HEAD");
    return result.ok && result.out ? result.out.split("\n")[0]!.trim() : null;
  }

  /** Finds a commit carrying this marker, if one already exists. */
  private async findMarkedCommit(runId: string, cwd: string, marker: string): Promise<string | null> {
    // --fixed-strings so the marker is matched literally, and --all so a commit
    // made on a detached or moved HEAD is still found.
    const result = await this.git(
      runId,
      "log",
      ["--all", "--fixed-strings", `--grep=${marker}`, "--format=%H", "-n", "1"],
      cwd,
      "checkpoint: search for an existing checkpoint commit"
    );
    const sha = result.out.split("\n")[0]?.trim();
    return result.ok && sha ? sha : null;
  }

  private async statusPorcelain(runId: string, cwd: string): Promise<{ ok: boolean; text: string; changed: number }> {
    const result = await this.git(runId, "status", ["--porcelain"], cwd, "checkpoint: inspect working tree");
    const lines = result.out.split("\n").map((line) => line.trim()).filter(Boolean);
    return { ok: result.ok, text: result.out, changed: lines.length };
  }

  /**
   * Creates a checkpoint for a turn whose verification was fully green.
   *
   * Order: journal intent and COMMIT -> look for an existing marked commit
   * (crash recovery) -> stage -> commit -> record the SHA. A crash anywhere
   * after the commit is recovered on the next attempt by finding the marker,
   * never by committing again.
   */
  async checkpoint(input: {
    runId: string;
    turnId: string;
    ordinal: number;
    verificationId: string | null;
    summary: string;
    workspaceRoot: string;
  }): Promise<CheckpointRecord> {
    const existing = this.store.forTurn(input.turnId);
    if (existing && existing.status !== "INTENT") {
      // Already settled: a checkpoint is created at most once per turn.
      return existing;
    }

    const headBefore = existing?.headBefore ?? (await this.head(input.runId, input.workspaceRoot));
    const record = existing ?? this.store.recordIntent({ ...input, headBefore });

    // Crash recovery: did a previous process already make this exact commit?
    const already = await this.findMarkedCommit(input.runId, input.workspaceRoot, record.marker);
    if (already) {
      return this.store.settle({
        checkpointId: record.id,
        status: "COMMITTED",
        commitSha: already,
        detail: "Recovered an existing checkpoint commit by its marker; nothing was committed again.",
        recovered: true
      });
    }

    const status = await this.statusPorcelain(input.runId, input.workspaceRoot);
    if (!status.ok) {
      return this.store.settle({ checkpointId: record.id, status: "FAILED", detail: `Could not inspect the worktree: ${truncate(status.text)}` });
    }
    if (status.changed === 0) {
      // A green turn that changed nothing is a real, recordable outcome — but an
      // empty commit would be noise in the user's history.
      return this.store.settle({
        checkpointId: record.id,
        status: "NO_CHANGES",
        commitSha: headBefore,
        detail: "Verification was green and the worktree was clean; no commit was needed."
      });
    }

    const staged = await this.git(input.runId, "add", ["--all"], input.workspaceRoot, "checkpoint: stage changes");
    if (!staged.ok) {
      return this.store.settle({ checkpointId: record.id, status: "FAILED", detail: `git add failed: ${truncate(staged.err || staged.out)}` });
    }

    const committed = await this.git(
      input.runId,
      "commit",
      ["--message", record.message, "--no-verify"],
      input.workspaceRoot,
      "checkpoint: commit known-good state"
    );

    // Whether it succeeded or not, the marker is the source of truth.
    const sha = await this.findMarkedCommit(input.runId, input.workspaceRoot, record.marker);
    if (sha) {
      return this.store.settle({ checkpointId: record.id, status: "COMMITTED", commitSha: sha });
    }

    return this.store.settle({
      checkpointId: record.id,
      status: "FAILED",
      detail: `git commit did not produce a checkpoint: ${truncate(committed.err || committed.out)}`
    });
  }

  /** Durable evidence of the workspace, so the report needs no live git later. */
  async snapshot(input: { runId: string; turnId: string | null; reason: string; workspaceRoot: string }): Promise<WorkspaceSnapshot> {
    const head = await this.head(input.runId, input.workspaceRoot);
    const status = await this.statusPorcelain(input.runId, input.workspaceRoot);
    const diff = await this.git(input.runId, "diff", ["--stat", "HEAD"], input.workspaceRoot, "report: summarize the working diff");

    return this.store.recordSnapshot({
      runId: input.runId,
      turnId: input.turnId,
      reason: input.reason,
      headSha: head,
      statusText: status.text,
      diffStat: diff.ok ? diff.out : diff.err,
      changedFiles: status.changed
    });
  }
}
