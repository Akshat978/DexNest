// Phase 11: rendering for a notification. A channel shows a title and a body
// inside real length limits, and once shown it is on its own: no network, no
// app to open, no "tap to see more". So the rendering must be self-sufficient.
// For an answerable item that means the question and every option it offers are
// present in full. Everything here is subordinate to one rule: truncation may
// shorten the surrounding context, but it must never cut the question — or an
// option — in half, because a half-question is worse than silence.

/** Real limits, chosen to sit inside what push channels commonly show. */
export const NOTIFICATION_TITLE_MAX = 64;
export const NOTIFICATION_BODY_MAX = 240;

/** Marker between the ellipsised context and the question it precedes. */
const ELLIPSIS = "…";

/**
 * @typedef {Object} Notification
 * @property {string} title  A short header, within NOTIFICATION_TITLE_MAX.
 * @property {string} body   The readable body, within NOTIFICATION_BODY_MAX,
 *   except that a question block (question + options) is never shortened even
 *   if it alone would exceed the limit — self-sufficiency outranks brevity.
 * @property {boolean} answerable  Whether the item offers options to answer.
 * @property {string[]} options  The option labels named in the body, in order.
 * @property {boolean} truncated  Whether any context was shortened to fit.
 */

/**
 * Render one item as the notification a channel would show. The item is not
 * mutated. An answerable item (ACTION_REQUIRED with options) always carries its
 * question and every option label in full; routine items may have their context
 * shortened to fit, at a word boundary, never mid-word.
 *
 * @param {import("./item.js").AttentionItem} item
 * @returns {Notification}
 */
export function renderNotification(item) {
  if (!item || typeof item !== "object") {
    throw new Error(
      `Cannot render a notification for a non-item: got ${quote(
        item == null ? "" : String(item)
      )}. Pass an item built by makeItem.`
    );
  }

  const title = String(item.title || "");
  const detail = String(item.detail || "");
  const subject = String(item.subject || "");
  const answers = Array.isArray(item.answers) ? item.answers : [];
  const answerable = item.priority === "ACTION_REQUIRED" && answers.length > 0;
  const options = answers.map((a) => String(a.label || a.id || ""));

  const header = subject ? `${subject}: ${title}` : title;
  const renderedTitle = truncate(header, NOTIFICATION_TITLE_MAX);

  if (answerable) {
    const { body, truncated } = answerableBody(title, detail, options);
    return Object.freeze({
      title: renderedTitle,
      body,
      answerable: true,
      options: Object.freeze(options.slice()),
      truncated,
    });
  }

  const context = detail || title;
  const truncated = context.length > NOTIFICATION_BODY_MAX;
  return Object.freeze({
    title: renderedTitle,
    body: truncate(context, NOTIFICATION_BODY_MAX),
    answerable: false,
    options: Object.freeze([]),
    truncated,
  });
}

/**
 * Build the body of an answerable item. The question block — the question
 * itself followed by every option — is kept whole no matter what. If there is
 * room, the leading detail is included; if not, it is shortened at a word
 * boundary, and if even that leaves no useful room it is dropped entirely. The
 * question is never shortened.
 *
 * @param {string} question
 * @param {string} detail
 * @param {string[]} options
 * @returns {{ body: string, truncated: boolean }}
 */
function answerableBody(question, detail, options) {
  const optionsLine = `Options: ${options.join(" / ")}`;
  const questionBlock = `${question}\n${optionsLine}`;

  if (!detail) {
    return { body: questionBlock, truncated: false };
  }

  const separator = "\n\n";
  const full = `${detail}${separator}${questionBlock}`;
  if (full.length <= NOTIFICATION_BODY_MAX) {
    return { body: full, truncated: false };
  }

  // The question block is inviolable; whatever remains of the budget is what
  // the detail may occupy. If that is too little to say anything useful, the
  // detail is dropped rather than reduced to an ellipsis.
  const room = NOTIFICATION_BODY_MAX - questionBlock.length - separator.length;
  const MIN_USEFUL_DETAIL = ELLIPSIS.length + 8;
  if (room < MIN_USEFUL_DETAIL) {
    return { body: questionBlock, truncated: true };
  }

  const shortDetail = truncate(detail, room);
  return { body: `${shortDetail}${separator}${questionBlock}`, truncated: true };
}

/**
 * Shorten a string to at most `max` characters at a word boundary, appending an
 * ellipsis. A string already within the limit is returned unchanged. The result
 * is guaranteed to be no longer than `max`.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  if (text.length <= max) return text;
  const budget = max - ELLIPSIS.length;
  if (budget <= 0) return text.slice(0, max);
  const slice = text.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  const kept = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/** @param {string} value */
function quote(value) {
  return `"${value}"`;
}
