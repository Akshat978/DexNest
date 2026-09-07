// What the operator reads in the morning.
//
// A short, plain-text account of the night, meant for a person holding coffee:
// how many projects were touched, which succeeded, which failed and why, which
// were never reached, and why the night ended. No status codes, no jargon.

import { recordsFor } from "./records.js";

/**
 * A human sentence for each stop reason. Every reason code the engine can
 * produce must have one here — a code is not an explanation.
 * @type {Readonly<Record<string, string>>}
 */
const STOP_REASON_SENTENCES = Object.freeze({
  queue_complete: "The night ended because every project had been dealt with.",
  deadline: "The night ended because the cut-off time was reached.",
  cost: "The night ended because the spending budget was used up.",
  max_items: "The night ended because it had touched as many projects as allowed.",
  failing: "The night ended because too many projects failed in a row.",
});

/**
 * A friendly name for an item: its label if it has one, otherwise its id, and
 * failing that its project path.
 * @param {{ id: string, label?: string, projectPath?: string }} item
 * @returns {string}
 */
function nameOf(item) {
  if (typeof item.label === "string" && item.label.trim() !== "") return item.label;
  if (typeof item.id === "string" && item.id.trim() !== "") return item.id;
  return item.projectPath ?? "an unnamed project";
}

/**
 * Render a plain-text summary of the night.
 *
 * @param {ReadonlyArray<{ id: string, label?: string, projectPath?: string }>} queue
 * @param {ReadonlyArray<import("./records.js").Record>} records
 * @param {import("./records.js").Progress} progress
 * @param {string|null} [stopReason]  a reason code from nextAction, if the night stopped
 * @returns {string}
 */
export function renderQueueSummary(queue, records, progress, stopReason) {
  const view = recordsFor(queue, records);
  const statusById = new Map(view.map((record) => [record.itemId, record]));

  const succeeded = [];
  const failed = [];
  const skipped = [];
  const neverReached = [];

  for (const item of queue) {
    const record = statusById.get(item.id);
    const name = nameOf(item);
    switch (record.status) {
      case "DONE":
        succeeded.push(name);
        break;
      case "FAILED":
      case "ABANDONED": {
        const why = record.reason ? ` (${record.reason})` : "";
        const word = record.status === "ABANDONED" ? "was left unfinished" : "failed";
        failed.push(`${name} ${word}${why}`);
        break;
      }
      case "SKIPPED": {
        // Carry the reason, exactly as a failure does. A project skipped
        // because its tree was dirty, or because the run could not be created
        // at all, is precisely the case where the name alone tells the
        // operator nothing they can act on.
        const why = record.reason ? ` (${record.reason})` : "";
        skipped.push(`${name}${why}`);
        break;
      }
      default: // PENDING or RUNNING — not completed this night
        neverReached.push(name);
    }
  }

  const touched = progress.done + progress.failed + progress.inFlight;
  const projectWord = queue.length === 1 ? "project" : "projects";

  const lines = [];
  lines.push(
    `Touched ${touched} of ${queue.length} ${projectWord} tonight.`,
  );

  if (succeeded.length > 0) {
    lines.push(`Succeeded: ${succeeded.join(", ")}.`);
  } else {
    lines.push("Succeeded: none.");
  }

  if (failed.length > 0) {
    lines.push(`Failed: ${failed.join("; ")}.`);
  }

  if (skipped.length > 0) {
    lines.push(`Skipped: ${skipped.join("; ")}.`);
  }

  if (neverReached.length > 0) {
    lines.push(`Never reached: ${neverReached.join(", ")}.`);
  }

  if (stopReason !== undefined && stopReason !== null) {
    lines.push(
      STOP_REASON_SENTENCES[stopReason] ??
        `The night ended (${stopReason}).`,
    );
  }

  return lines.join("\n");
}
