// Phase 13: what the operator reads in one line. `renderSummary(decision)` turns
// a whole night's Decision (Phase 10) into a single plain-English sentence a
// person can read to judge whether the engine is behaving: what is going out,
// what is being held, and — crucially — why each held thing waits. No status
// codes, no jargon like "cooldown" or "ACTION_REQUIRED"; those belong in the
// data, not in front of a tired human.
//
// This function is bound by the rule that outranks the rest: a quiet system is
// never a silent one. If anything is held, the summary names it and says why,
// and if a held or sent group is still waiting on the operator's answer, the
// summary surfaces that too — it is never swallowed by a count of routine work.

/**
 * Render a whole decision as one readable line for an operator.
 *
 * @param {import("./decide.js").Decision} decision  The output of `decide`.
 * @returns {string} A single plain-text sentence.
 */
export function renderSummary(decision) {
  if (!decision || typeof decision !== "object") {
    throw new Error(
      "Cannot summarise a non-decision. Pass the result of decide()."
    );
  }

  const deliver = Array.isArray(decision.deliver) ? decision.deliver : [];
  const hold = Array.isArray(decision.hold) ? decision.hold : [];
  const reasons = Array.isArray(decision.reason) ? decision.reason : [];

  const reasonByKey = new Map();
  for (const r of reasons) {
    if (r && typeof r === "object") reasonByKey.set(r.groupKey, r);
  }

  const sending = describeSending(deliver);
  const holding = describeHolding(hold, reasonByKey);

  return `${sending} ${holding}`.trim();
}

/**
 * @param {import("./grouping.js").GroupDigest[]} deliver
 * @returns {string}
 */
function describeSending(deliver) {
  if (deliver.length === 0) {
    return "Sending nothing right now.";
  }
  const parts = deliver.map(namePart);
  return `Sending ${countPhrase(deliver.length, "update")} now: ${parts.join(
    "; "
  )}.`;
}

/**
 * @param {import("./grouping.js").GroupDigest[]} hold
 * @param {Map<string, import("./decide.js").HeldReason>} reasonByKey
 * @returns {string}
 */
function describeHolding(hold, reasonByKey) {
  if (hold.length === 0) {
    return "Holding nothing back.";
  }
  const parts = hold.map((digest) => {
    const why = reasonPhrase(reasonByKey.get(digest.groupKey));
    return `${namePart(digest)} (waiting ${why})`;
  });
  return `Holding ${countPhrase(hold.length, "update")} back: ${parts.join(
    "; "
  )}.`;
}

/**
 * Name one group readably: its subject, what happened, and — if it is still
 * waiting on the operator — that it needs an answer. The last part is never
 * dropped: an outstanding question must not hide behind a routine count.
 *
 * @param {import("./grouping.js").GroupDigest} digest
 * @returns {string}
 */
function namePart(digest) {
  const subject = String(digest.subject || digest.groupKey || "something");
  const headline = String(digest.headline || "").trim();
  let text = headline ? `${subject} — ${headline}` : subject;

  const outstanding = Array.isArray(digest.outstanding)
    ? digest.outstanding
    : [];
  if (outstanding.length > 0) {
    const need =
      outstanding.length === 1
        ? "needs your answer"
        : `${outstanding.length} still need your answer`;
    text += ` (${need})`;
  }
  return text;
}

/**
 * Turn a held reason into plain words. Every branch says when the hold lifts,
 * so the operator can see not just that something waits but until when.
 *
 * @param {import("./decide.js").HeldReason} [reason]
 * @returns {string}
 */
function reasonPhrase(reason) {
  if (!reason) {
    // A held group with no stated reason would be exactly the silent system
    // this engine forbids; say so plainly rather than omit it.
    return "for a reason that was not recorded";
  }

  const clauses = [];
  if (reason.coolsDownAt) {
    clauses.push(`it was notified recently (again after ${reason.coolsDownAt})`);
  }
  if (reason.quietEndsAt) {
    clauses.push(`it is quiet hours until ${reason.quietEndsAt}`);
  }
  if (clauses.length === 0) {
    return `because ${String(reason.reason || "it is being held")}`;
  }
  return `because ${clauses.join(" and ")}`;
}

/**
 * @param {number} n
 * @param {string} noun
 * @returns {string}
 */
function countPhrase(n, noun) {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}
