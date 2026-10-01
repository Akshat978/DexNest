// Every operation that changes a repository, the same way:
//
//   read fresh state -> plan (or refuse) -> the owner's confirmation and the
//   preview they saw must still match -> journal "running" + event
//   -> run each step (argv built, re-validated, no shell, no prompts)
//   -> read state again -> journal the result and the undo record + event.
//
// Nothing runs on a plan the owner didn't see: if the fresh plan's
// fingerprint differs from the preview's, the result is "stale" and the view
// shows the new preview instead.

import { createHash, randomUUID } from "node:crypto";

import type { EventLog } from "@dexnest/foundation";
import {
  confirmationSatisfied,
  createReadOnlyGit,
  journalParams,
  opFinishedPayload,
  opInterruptedPayload,
  opRefusedPayload,
  opStartedPayload,
  opUndonePayload,
  parseOperationRequest,
  planOperation,
  planUndo,
  projectBadge,
  redactCredentials,
  refuse,
  selectPullAll,
  PROJECTS_EVENT_STREAM,
  PROJECTS_MODULE_ID,
  type Confirmation,
  type EventPayload,
  type GitReader,
  type GitRunner,
  type OpOutcome,
  type OperationPlan,
  type OperationRequest,
  type ProjectsStore,
  type Refusal,
  type RefSnapshot,
  type RepoState,
  type RepoStateOk,
  type UndoRecord
} from "@dexnest/projects";

import { assertSafeMutatingArgv, stepToArgv } from "./argv.ts";
import { classifyFailure, mutatingEnv, type FailureCode } from "./env.ts";

export interface GitOpsOptions {
  runner: GitRunner;
  reader: GitReader;
  store: ProjectsStore;
  events: EventLog;
  now?: () => string;
  newOpId?: () => string;
  /** GIT_SSH or GIT_SSH_COMMAND is set in DexNest's environment: leave ssh alone. */
  environmentSetsSsh?: boolean;
  networkTimeoutMs?: number;
  localTimeoutMs?: number;
}

export interface ExecuteInput {
  projectId: string;
  path: string;
  /** Untrusted: parsed and validated here. */
  request: unknown;
  confirmation?: Confirmation;
  /** The preview the owner saw. When given and the fresh plan differs, nothing runs. */
  expectedFingerprint?: string;
  /** The trigger: module_ui, command, deck... */
  source: string;
  /** Deck / hotkey: refuse anything that would need a choice or a confirmation. */
  nonInteractive?: boolean;
  onOutput?: (line: string) => void;
}

export type ExecuteResult =
  | { status: "refused"; opId: string; refusal: Refusal }
  | { status: "needs_confirmation"; plan: OperationPlan; fingerprint: string }
  | { status: "stale"; plan: OperationPlan; fingerprint: string }
  | { status: "busy"; runningOpId: string; runningVerb: string }
  | {
      status: "done";
      opId: string;
      outcome: OpOutcome;
      plan: OperationPlan;
      message: string;
      errorCode: FailureCode | "stale_state" | null;
      output: string[];
      undoAvailable: boolean;
      state: RepoState | null;
    };

export type PreviewResult = { refused: false; plan: OperationPlan; fingerprint: string } | { refused: true; refusal: Refusal };

export interface BulkProject {
  projectId: string;
  path: string;
}

export interface GitOps {
  preview(input: { projectId: string; path: string; request: unknown }): Promise<PreviewResult>;
  execute(input: ExecuteInput): Promise<ExecuteResult>;
  cancel(opId: string): boolean;
  isBusy(projectId: string): boolean;
  fetchAll(projects: readonly BulkProject[], options: { source: string; concurrency?: number }): Promise<Array<{ projectId: string; result: ExecuteResult }>>;
  pullAll(projects: readonly BulkProject[], options: { source: string }): Promise<{ pulled: Array<{ projectId: string; result: ExecuteResult }>; skipped: Array<{ projectId: string; reason: string }> }>;
  /** On start: journal rows left "running" by a crash become "interrupted", with an event each. */
  recoverInterrupted(): Array<{ opId: string; projectId: string; verb: string }>;
}

const MAX_OUTPUT_LINES = 400;

export function planFingerprint(plan: OperationPlan): string {
  return createHash("sha256").update(JSON.stringify({ kind: plan.kind, summary: plan.summary, steps: plan.steps, safety: plan.safety })).digest("hex").slice(0, 32);
}

function snapshot(state: RepoState | null, extraRefs: Record<string, string> = {}): RefSnapshot | null {
  if (!state || !state.isRepo) return null;
  return { head: state.head.sha, branch: state.head.branch, refs: extraRefs };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        results[i] = await work(items[i]);
      }
    })
  );
  return results;
}

export function createGitOps(options: GitOpsOptions): GitOps {
  const now = options.now ?? (() => new Date().toISOString());
  const newOpId = options.newOpId ?? (() => `op_${randomUUID()}`);
  const readGit = createReadOnlyGit(options.runner);
  const running = new Map<string, { opId: string; verb: string; controller: AbortController }>();
  const byOpId = new Map<string, AbortController>();

  function emit(type: string, projectId: string, source: string, payload: EventPayload): void {
    options.events.append({ type, stream: PROJECTS_EVENT_STREAM, module: PROJECTS_MODULE_ID, subject: projectId, source, payload });
  }

  async function sshIsConfigured(path: string): Promise<boolean> {
    if (options.environmentSetsSsh) return true;
    const result = await readGit.run(path, ["config", "--get", "core.sshCommand"]);
    return result.exitCode === 0 && result.stdout.trim() !== "";
  }

  async function planFor(projectId: string, path: string, request: OperationRequest, state: RepoState): Promise<OperationPlan | Refusal> {
    if (request.kind !== "undo") return planOperation(state, request);
    if (!state.isRepo) return refuse("undo", "not_a_repo", state.reason);
    const record = options.store.getOperation(request.opId);
    if (!record || record.projectId !== projectId || !record.undo) return refuse("undo", "cannot_undo", "There is nothing to undo for that operation.");
    if (record.undoneBy) return refuse("undo", "cannot_undo", "That operation was already undone.");
    if (options.store.latestUndoable(projectId)?.id !== record.id) return refuse("undo", "cannot_undo", "Only the most recent operation can be undone.");
    const undo = record.undo;
    const sha = "commitSha" in undo ? undo.commitSha : "sha" in undo ? undo.sha : null;
    const facts = sha ? await options.reader.undoFacts(path, sha) : { commitOnRemote: null, objectExists: null };
    return planUndo(state, undo, facts);
  }

  async function resolveStashRef(path: string, sha: string): Promise<string | null> {
    const list = await readGit.run(path, ["stash", "list", "--format=%H %gd"]);
    if (list.exitCode !== 0) return null;
    for (const line of list.stdout.split(/\r?\n/)) {
      const [lineSha, ref] = line.split(" ");
      if (lineSha === sha && ref) return ref;
    }
    return null;
  }

  async function revParse(path: string, ref: string): Promise<string | null> {
    const result = await readGit.run(path, ["rev-parse", "--verify", "--quiet", ref]);
    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  }

  async function hasConflicts(path: string): Promise<boolean> {
    const result = await readGit.run(path, ["ls-files", "--unmerged"]);
    return result.exitCode === 0 && result.stdout.trim() !== "";
  }

  function buildUndo(plan: OperationPlan, before: RepoStateOk, after: RepoState | null, createdStash: string | null): UndoRecord | null {
    switch (plan.undo) {
      case "uncommit":
        if (!after?.isRepo || !after.head.sha || !before.head.sha || after.head.sha === before.head.sha || !after.head.branch) return null;
        return { kind: "uncommit", branch: after.head.branch, commitSha: after.head.sha, parentSha: before.head.sha };
      case "recreate_branch": {
        const step = plan.steps.find((s) => s.op === "branch_delete");
        return step && step.op === "branch_delete" ? { kind: "recreate_branch", name: step.name, sha: step.expectSha } : null;
      }
      case "apply_stash":
        return createdStash ? { kind: "apply_stash", sha: createdStash } : null;
      case "pop_stash":
        return createdStash ? { kind: "pop_stash", sha: createdStash } : null;
      case "switch_back":
        return before.head.branch && !before.head.detached ? { kind: "switch_back", branch: before.head.branch } : null;
      case "delete_created_branch": {
        const step = plan.steps.find((s) => s.op === "branch_create");
        return step && step.op === "branch_create" ? { kind: "delete_created_branch", name: step.name, sha: step.startPoint } : null;
      }
      case "restore_remote_branch": {
        const step = plan.steps.find((s) => s.op === "push_delete");
        if (!step || step.op !== "push_delete") return null;
        const tip = before.remoteBranches.find((b) => b.remote === step.remote && b.name === step.branch)?.tipSha;
        return tip ? { kind: "restore_remote_branch", remote: step.remote, name: step.branch, sha: tip } : null;
      }
      case null:
        return null;
    }
  }

  async function execute(input: ExecuteInput): Promise<ExecuteResult> {
    const parsed = parseOperationRequest(input.request);
    if (!parsed.ok) {
      const opId = newOpId();
      options.store.recordRefusal({ id: opId, projectId: input.projectId, verb: parsed.refusal.kind, safety: "normal", params: { verb: parsed.refusal.kind }, refsBefore: null }, parsed.refusal.code, now());
      emit("projects.op.finished", input.projectId, input.source, opRefusedPayload(opId, input.projectId, parsed.refusal));
      return { status: "refused", opId, refusal: parsed.refusal };
    }
    const request = parsed.request;

    const busy = running.get(input.projectId);
    if (busy) return { status: "busy", runningOpId: busy.opId, runningVerb: busy.verb };
    const opId = newOpId();
    const controller = new AbortController();
    running.set(input.projectId, { opId, verb: request.kind, controller });
    byOpId.set(opId, controller);
    try {
      const before = await options.reader.readRepoState(input.path, { signal: controller.signal });
      const planned = await planFor(input.projectId, input.path, request, before);
      let refusal: Refusal | null = planned.refused ? planned : null;
      if (!refusal && input.nonInteractive && !planned.refused && planned.confirm.kind !== "none") {
        refusal = refuse(request.kind, "needs_choice", "This needs a confirmation. Open DexNest to do it.");
      }
      if (refusal) {
        options.store.recordRefusal({ id: opId, projectId: input.projectId, verb: request.kind, safety: "normal", params: { verb: request.kind }, refsBefore: snapshot(before) }, refusal.code, now());
        emit("projects.op.finished", input.projectId, input.source, opRefusedPayload(opId, input.projectId, refusal));
        return { status: "refused", opId, refusal };
      }
      const plan = planned as OperationPlan;
      const state = before as RepoStateOk;
      const fingerprint = planFingerprint(plan);
      if (input.expectedFingerprint !== undefined && input.expectedFingerprint !== fingerprint) return { status: "stale", plan, fingerprint };
      if (!confirmationSatisfied(plan.confirm, input.confirmation)) return { status: "needs_confirmation", plan, fingerprint };

      const begun = options.store.beginOperation(
        { id: opId, projectId: input.projectId, verb: plan.kind, safety: plan.safety, params: journalParams(plan), refsBefore: snapshot(state), undoOf: request.kind === "undo" ? request.opId : null },
        now()
      );
      if (!begun.ok) return { status: "busy", runningOpId: begun.busy.id, runningVerb: begun.busy.verb };
      emit("projects.op.started", input.projectId, input.source, opStartedPayload(opId, input.projectId, plan, state.head.sha));

      const started = Date.now();
      const output: string[] = [];
      const say = (text: string) => {
        for (const line of redactCredentials(text).split(/\r?\n/)) {
          if (!line.trim()) continue;
          if (output.length < MAX_OUTPUT_LINES) output.push(line);
          input.onOutput?.(line);
        }
      };
      const env = mutatingEnv({ overrideSsh: plan.network ? !(await sshIsConfigured(input.path)) : false });
      let outcome: OpOutcome = "succeeded";
      let errorCode: FailureCode | "stale_state" | null = null;
      let message = "";
      let createdStash: string | null = null;
      const stashBefore = await revParse(input.path, "refs/stash");

      // Whatever happens below, the journal row is finished: a refused argv or a
      // runner error must never leave the project looking busy.
      try {
        for (const step of plan.steps) {
          let stashRef: string | undefined;
          if (controller.signal.aborted) {
            outcome = "cancelled";
            message = "Cancelled before the next step; nothing more was run.";
            break;
          }
          if (step.op === "branch_delete") {
            const tip = await revParse(input.path, `refs/heads/${step.name}`);
            if (tip !== step.expectSha) {
              outcome = "failed";
              errorCode = "stale_state";
              message = `${step.name} changed since the preview. Nothing was deleted.`;
              break;
            }
          }
          if (step.op === "reset_soft" && (await revParse(input.path, "HEAD")) !== step.expectHead) {
            outcome = "failed";
            errorCode = "stale_state";
            message = "The branch moved since the preview. Nothing was undone.";
            break;
          }
          if (step.op === "stash_drop_if_clean") {
            if (await hasConflicts(input.path)) {
              message = "Applied with conflicts. The stash is kept so nothing is lost; resolve the conflicts in your editor.";
              outcome = "failed";
              errorCode = "conflict";
              break;
            }
            const ref = await resolveStashRef(input.path, step.sha);
            if (!ref) continue;
            stashRef = ref;
          }
          const built = stepToArgv(step, { opId, stashRef });
          assertSafeMutatingArgv(built.args);
          const result = await options.runner.run({
            cwd: input.path,
            args: built.args,
            stdin: built.stdin,
            env,
            timeoutMs: built.network ? options.networkTimeoutMs ?? 300_000 : options.localTimeoutMs ?? 60_000,
            maxBytes: 1024 * 1024,
            signal: controller.signal
          });
          say(result.stdout);
          say(result.stderr);
          if (result.cancelled) {
            outcome = "cancelled";
            message = "Cancelled. Git was stopped part-way; check the project's state before carrying on.";
            break;
          }
          if (result.timedOut) {
            outcome = "timed_out";
            message = "Git took too long and was stopped.";
            break;
          }
          if (result.notFound) {
            outcome = "failed";
            errorCode = "failed";
            message = "Git isn't installed, or isn't on PATH.";
            break;
          }
          if (result.exitCode !== 0) {
            const failure = classifyFailure(result.stderr, result.stdout);
            outcome = failure.code === "auth_needed" ? "auth_needed" : "failed";
            errorCode = failure.code;
            message = failure.message;
            break;
          }
          if (step.op === "stash_push") {
            const top = await revParse(input.path, "refs/stash");
            createdStash = top && top !== stashBefore ? top : null;
          }
        }
      } catch (error) {
        outcome = "failed";
        errorCode = "failed";
        message = `DexNest stopped before running git: ${(error as Error).message}`;
      }

      let after: RepoState | null = null;
      try {
        after = await options.reader.readRepoState(input.path);
      } catch {
        after = null;
      }
      const undo = outcome === "succeeded" ? buildUndo(plan, state, after, createdStash) : null;
      if (outcome === "succeeded") message = `${plan.title} done.${after ? ` Now: ${projectBadge(after).text}.` : ""}`;
      options.store.finishOperation(
        opId,
        { state: outcome === "succeeded" ? "succeeded" : "failed", outcome, refsAfter: snapshot(after), undo, errorCode },
        now()
      );
      emit("projects.op.finished", input.projectId, input.source, opFinishedPayload(opId, input.projectId, plan, outcome, { durationMs: Date.now() - started, headAfter: after?.isRepo ? after.head.sha : null, undoable: undo !== null, errorCode }));
      if (outcome === "succeeded" && request.kind === "undo") {
        const original = options.store.getOperation(request.opId);
        if (original?.undo) {
          options.store.markUndone(request.opId, opId);
          emit("projects.op.undone", input.projectId, input.source, opUndonePayload(request.opId, opId, input.projectId, original.undo));
        }
      }
      if (plan.kind === "fetch") {
        try {
          options.store.recordFetch(input.projectId, now(), outcome);
        } catch {
          // The project was removed from DexNest while the fetch ran.
        }
      }
      if (outcome === "succeeded") {
        try {
          options.store.noteActivity(input.projectId, now());
        } catch {
          // A project removed meanwhile has no activity to note.
        }
      }
      return { status: "done", opId, outcome, plan, message, errorCode, output, undoAvailable: undo !== null, state: after };
    } finally {
      running.delete(input.projectId);
      byOpId.delete(opId);
    }
  }

  return {
    async preview(input) {
      const parsed = parseOperationRequest(input.request);
      if (!parsed.ok) return { refused: true, refusal: parsed.refusal };
      const state = await options.reader.readRepoState(input.path);
      const planned = await planFor(input.projectId, input.path, parsed.request, state);
      return planned.refused ? { refused: true, refusal: planned } : { refused: false, plan: planned, fingerprint: planFingerprint(planned) };
    },
    execute,
    cancel(opId) {
      const controller = byOpId.get(opId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    isBusy(projectId) {
      return running.has(projectId);
    },
    async fetchAll(projects, bulk) {
      const results = await mapLimit(projects, bulk.concurrency ?? 4, async (p) => ({
        projectId: p.projectId,
        result: await execute({ projectId: p.projectId, path: p.path, request: { kind: "fetch" }, source: bulk.source, nonInteractive: true })
      }));
      return results;
    },
    async pullAll(projects, bulk) {
      const candidates = [];
      const skipped: Array<{ projectId: string; reason: string }> = [];
      for (const p of projects) {
        try {
          candidates.push({ projectId: p.projectId, state: await options.reader.readRepoState(p.path) });
        } catch (error) {
          skipped.push({ projectId: p.projectId, reason: (error as Error).message });
        }
      }
      const selection = selectPullAll(candidates);
      skipped.push(...selection.skipped);
      const pulled: Array<{ projectId: string; result: ExecuteResult }> = [];
      for (const { projectId } of selection.pull) {
        const path = projects.find((p) => p.projectId === projectId)!.path;
        pulled.push({ projectId, result: await execute({ projectId, path, request: { kind: "pull" }, source: bulk.source, nonInteractive: true }) });
      }
      return { pulled, skipped };
    },
    recoverInterrupted() {
      const at = now();
      return options.store.recoverInterrupted(at).map((record) => {
        emit("projects.op.interrupted", record.projectId, "projects", opInterruptedPayload(record.id, record.projectId, record.verb));
        return { opId: record.id, projectId: record.projectId, verb: record.verb };
      });
    }
  };
}
