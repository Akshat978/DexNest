// The shape of the git-ops package, as the Projects runtime sees it.
//
// The runtime needs to start git operations, but this package must never
// import git-ops (the read side can't reach a mutating command). So the types
// live here, git-ops implements them, and the host passes the implementation
// in.

import type { OpOutcome } from "./events.ts";
import type { OperationPlan, Refusal } from "./operations.ts";
import type { RepoState } from "./repoState.ts";
import type { Confirmation } from "./safety.ts";

export type FailureCode =
  | "auth_needed"
  | "offline"
  | "not_fast_forward"
  | "rejected"
  | "local_changes"
  | "locked"
  | "hook_failed"
  | "conflict"
  | "nothing_to_commit"
  | "failed";

export interface ExecuteInput {
  projectId: string;
  path: string;
  /** Untrusted: git-ops parses and validates it. */
  request: unknown;
  confirmation?: Confirmation;
  /** The preview the owner saw. When given and the fresh plan differs, nothing runs. */
  expectedFingerprint?: string;
  /** The trigger: module_ui, command, deck... */
  source: string;
  /** Deck / hotkey / bulk: refuse anything that would need a choice or a confirmation. */
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

export interface CloneRequest {
  url: string;
  parentDir: string;
  folderName?: string;
  source: string;
  signal?: AbortSignal;
  onOutput?: (line: string) => void;
}

export type CloneResult =
  | { status: "refused"; reason: string; duplicateOf?: { id: string; name: string } }
  | { status: "done"; outcome: "succeeded" | "failed" | "auth_needed" | "cancelled" | "timed_out"; path: string; message: string; errorCode: FailureCode | null; output: string[] };

export interface GitOpsPort {
  preview(input: { projectId: string; path: string; request: unknown }): Promise<PreviewResult>;
  execute(input: ExecuteInput): Promise<ExecuteResult>;
  cancel(opId: string): boolean;
  isBusy(projectId: string): boolean;
  fetchAll(projects: readonly BulkProject[], options: { source: string; concurrency?: number }): Promise<Array<{ projectId: string; result: ExecuteResult }>>;
  pullAll(projects: readonly BulkProject[], options: { source: string }): Promise<{ pulled: Array<{ projectId: string; result: ExecuteResult }>; skipped: Array<{ projectId: string; reason: string }> }>;
  recoverInterrupted(): Array<{ opId: string; projectId: string; verb: string }>;
  clone(input: CloneRequest): Promise<CloneResult>;
}
