// What has already been done, told to the worker each turn.
//
// WHY A RUN NEEDS THIS
//
// A short run does not: the session carries the conversation, and three turns
// ago is still in front of the model. A twenty-iteration milestone run is
// different. The session grows, gets compacted, and what compaction throws away
// is exactly the boring middle — which piece of work already exists, what was
// decided in passing, what has already been tried.
//
// So the record is kept outside the conversation and restated every turn. It is
// small, durable and curated, which makes it a better memory than a long
// transcript: it holds the decisions without the noise.
//
// WHAT IT IS NOT
//
// Not the source of truth. The code is. The digest says what happened, not
// what the code contains, and it says so explicitly — an agent that trusted a
// summary over the file in front of it would be worse off than one with no
// summary at all.
//
// Bounded on purpose. A digest that grows with the run would eventually cost
// more context than the history it is standing in for, so older work is rolled
// up rather than listed.

import type { IterationRecord } from "./iterations.ts";
import type { AssumptionRecord } from "./unattended.ts";

/** Recent work is listed; anything older is counted. */
export const MAX_DIGEST_ITERATIONS = 8;
export const MAX_DIGEST_ASSUMPTIONS = 6;
export const MAX_DIGEST_LINE_CHARS = 120;

const line = (value: string | null, limit = MAX_DIGEST_LINE_CHARS): string =>
  (value ?? "").split("\n")[0]!.trim().slice(0, limit);

const MARK: Record<IterationRecord["status"], string> = {
  VERIFIED: "done",
  FAILED: "failed",
  INDETERMINATE: "inconclusive",
  ABANDONED: "abandoned",
  ACTIVE: "in progress"
};

/**
 * The record of a run so far.
 *
 * Empty until there is something to say: on the first piece of work the
 * conversation is the whole history and repeating it would be noise.
 */
export function renderRunDigest(input: {
  iterations: readonly IterationRecord[];
  assumptions: readonly AssumptionRecord[];
}): string {
  // The one in flight is what the worker is doing now, not history.
  const settled = input.iterations.filter((iteration) => iteration.status !== "ACTIVE");
  if (settled.length === 0) return "";

  const verified = settled.filter((iteration) => iteration.status === "VERIFIED").length;
  const committed = settled.filter((iteration) => iteration.checkpointId).length;

  const lines = [
    "WHAT HAS ALREADY BEEN DONE",
    "",
    `${verified} of ${settled.length} piece(s) of work completed, ${committed} committed.`
  ];

  const shown = settled.slice(-MAX_DIGEST_ITERATIONS);
  const older = settled.length - shown.length;
  if (older > 0) {
    const olderVerified = settled.slice(0, older).filter((iteration) => iteration.status === "VERIFIED").length;
    lines.push("", `  1-${older}. ${olderVerified} completed (older work, rolled up)`);
  } else {
    lines.push("");
  }
  for (const iteration of shown) {
    const summary = line(iteration.summary);
    lines.push(`  ${iteration.ordinal}. [${MARK[iteration.status]}]${summary ? ` ${summary}` : ""}`);
  }

  if (input.assumptions.length > 0) {
    const recent = input.assumptions.slice(-MAX_DIGEST_ASSUMPTIONS);
    lines.push("", "Decided along the way, without asking:");
    for (const assumption of recent) lines.push(`  - ${line(assumption.text, 200)}`);
    if (input.assumptions.length > recent.length) {
      lines.push(`  (and ${input.assumptions.length - recent.length} earlier)`);
    }
  }

  lines.push(
    "",
    "None of this needs redoing. It is a record of what happened, not a",
    "description of the code — read the files themselves before assuming",
    "anything about their current contents."
  );
  return lines.join("\n");
}
