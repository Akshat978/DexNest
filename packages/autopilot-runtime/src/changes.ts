// What a run actually changed, phase by phase.
//
// A run report says a phase was verified. It does not say what the phase did,
// and answering that meant leaving DexNest for a git log — which is the last
// manual step in reviewing a night's work.
//
// Everything needed was already recorded: a checkpoint per verified phase with
// the commit before and after, and an iteration joining that checkpoint to the
// plan item it advanced. This walks that join and asks git for the numbers.
//
// WHY THE NUMBERS AND NOT THE DIFF
//
// A file list with counts answers "is this the size of change I expected, in
// the places I expected" — which is the question at 8am, and the one that
// decides whether to read further. Shipping the patch itself would be shipping
// a code review to a phone, and a review is not what a glance is for.
//
// UNCHECKPOINTED PHASES ARE STILL LISTED
//
// A phase that failed verification never earned a checkpoint, so there is
// nothing to diff. It appears with no changes rather than being omitted: an
// absent phase reads as one that did not exist, and the operator would have to
// notice the gap in the numbering to learn otherwise.

import type { CheckpointRecord } from "./checkpoints.ts";
import type { IterationRecord } from "./iterations.ts";
import type { FileChange, GitPort } from "./ports.ts";
import type { PlanItemProgress } from "./plan.ts";

export interface PhaseChanges {
  /** The plan item, when the iteration advanced one. */
  planItemId: string | null;
  title: string;
  ordinal: number;
  status: string;
  /** Null when the phase never earned a checkpoint. */
  commitSha: string | null;
  files: FileChange[];
  insertions: number;
  deletions: number;
  /** Files whose lines cannot be counted, e.g. images. */
  binaryFiles: number;
}

export interface RunChanges {
  phases: PhaseChanges[];
  files: number;
  insertions: number;
  deletions: number;
}

/** Sums a file list, treating binary files as countable only by their number. */
export function totalsOf(files: readonly FileChange[]): Pick<PhaseChanges, "insertions" | "deletions" | "binaryFiles"> {
  let insertions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  for (const file of files) {
    if (file.insertions === null || file.deletions === null) { binaryFiles += 1; continue; }
    insertions += file.insertions;
    deletions += file.deletions;
  }
  return { insertions, deletions, binaryFiles };
}

export function buildRunChanges(input: {
  git: GitPort;
  workspaceRoot: string | null;
  iterations: readonly IterationRecord[];
  checkpoints: readonly CheckpointRecord[];
  planItems: readonly PlanItemProgress[];
}): RunChanges {
  const byCheckpoint = new Map(input.checkpoints.map(record => [record.id, record]));
  const byPlanItem = new Map(input.planItems.map(item => [item.id, item]));

  const phases: PhaseChanges[] = input.iterations.map((iteration, index) => {
    const checkpoint = iteration.checkpointId ? byCheckpoint.get(iteration.checkpointId) ?? null : null;
    const item = iteration.planItemId ? byPlanItem.get(iteration.planItemId) ?? null : null;

    // Both ends are needed. A checkpoint with no headBefore is one whose
    // starting point was never recorded, and diffing against a guess would
    // produce a number that looks authoritative and is not.
    const files = checkpoint?.commitSha && checkpoint.headBefore && input.workspaceRoot
      ? input.git.diffStat({ dir: input.workspaceRoot, from: checkpoint.headBefore, to: checkpoint.commitSha })
      : [];

    return {
      planItemId: iteration.planItemId,
      title: item?.title ?? iteration.summary ?? `Iteration ${iteration.ordinal}`,
      ordinal: item?.ordinal ?? iteration.ordinal ?? index + 1,
      status: iteration.status,
      commitSha: checkpoint?.commitSha ?? null,
      files,
      ...totalsOf(files)
    };
  });

  // Counted across the run rather than summed from the phases, because a file
  // touched in three phases is one file changed, not three.
  const touched = new Set<string>();
  for (const phase of phases) for (const file of phase.files) touched.add(file.path);

  return {
    phases,
    files: touched.size,
    insertions: phases.reduce((sum, phase) => sum + phase.insertions, 0),
    deletions: phases.reduce((sum, phase) => sum + phase.deletions, 0)
  };
}
