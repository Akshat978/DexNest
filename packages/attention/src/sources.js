// Phase 3: the mapping from what DexNest knows about a run to what a person
// should be told, and at what priority. This is the heart of the package.
//
// Every stop reason has a decided meaning here. The mapping is a single table
// so that adding a stop reason without deciding its priority is impossible: an
// unknown reason is refused by name rather than silently dropped. A quiet
// system must never be a silent one — so the default is a refusal, not nothing.

import { makeItem } from "./item.js";

/**
 * The run stop reasons this package understands, each with a decided meaning.
 * Add a reason here and you must choose its priority, title and detail — there
 * is no fallback that would let one slip through unclassified.
 */
export const STOP_REASONS = [
  "proposed_completion",
  "worker_failure",
  "budget_spent",
  "run_finished",
  "provider_limit",
];

/**
 * @typedef {Object} RunState
 * @property {string} runId       Which run this is about; becomes the subject.
 * @property {string} [stopReason] Why the run stopped, or absent if it is still
 *   running (a running run needs no one's attention, so yields no items).
 * @property {string} [at]        ISO timestamp of the stop.
 * @property {string} [detail]    Extra human-readable context, if any.
 */

/**
 * How each stop reason is presented. `priority` is the decided meaning; `title`
 * and `detail` describe it to a person; `answers` are offered only where the
 * engine cannot continue without one, and only on ACTION_REQUIRED items.
 */
const MAPPING = {
  proposed_completion: {
    priority: "ACTION_REQUIRED",
    title: "Run proposes it is done",
    detail: "The worker believes the run is complete and awaits your decision.",
    answers: [
      { id: "approve", label: "Approve completion" },
      { id: "reject", label: "Keep going" },
    ],
  },
  worker_failure: {
    priority: "ACTION_REQUIRED",
    title: "Worker failed",
    detail: "The worker stopped with an error and cannot continue on its own.",
    answers: [
      { id: "retry", label: "Retry" },
      { id: "abandon", label: "Abandon run" },
    ],
  },
  budget_spent: {
    priority: "INFO",
    title: "Run budget spent",
    detail: "The run reached its budget and stopped.",
    answers: [],
  },
  run_finished: {
    priority: "INFO",
    title: "Run finished",
    detail: "The run completed all its work.",
    answers: [],
  },
  provider_limit: {
    priority: "ATTENTION",
    title: "Provider limit reached",
    detail: "A provider limit paused the run; it may resume once the limit clears.",
    answers: [],
  },
};

/**
 * Turn what DexNest knows about a run into zero or more attention items with
 * decided priorities. A running run (no stop reason) yields no items. A known
 * stop reason yields exactly one item. An unknown stop reason is refused.
 *
 * @param {RunState} runState
 * @returns {import("./item.js").AttentionItem[]}
 */
export function itemsFor(runState) {
  const state = runState || {};
  const runId = normalise(state.runId);

  if (!runId) {
    throw new Error(
      `Run state has no runId: run state ${quote(describe(state))}. ` +
        `Every run state names the run it is about.`
    );
  }

  const stopReason = normalise(state.stopReason);
  if (!stopReason) return [];

  const mapped = MAPPING[stopReason];
  if (!mapped) {
    throw new Error(
      `Unknown run stop reason: ${quote(stopReason)}. ` +
        `Use ${STOP_REASONS.join(", ").replace(/, ([^,]*)$/, " or $1")}.`
    );
  }

  const item = makeItem({
    id: `${runId}:${stopReason}`,
    source: "run",
    subject: runId,
    priority: mapped.priority,
    title: mapped.title,
    detail: normalise(state.detail) || mapped.detail,
    at: normalise(state.at),
    answers: mapped.answers,
  });

  return [item];
}

/** @param {unknown} value */
function normalise(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/** @param {RunState} state */
function describe(state) {
  return normalise(state.stopReason) || "(unknown run)";
}

/** @param {string} value */
function quote(value) {
  return `"${value}"`;
}
