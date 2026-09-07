// AttentionItem: the unit the engine reasons about. `makeItem` normalises a
// plain object into a frozen, validated item. Detailed refusal messages get
// their own phase (Phase 2); here we validate what is needed to build a
// well-formed item and normalise its shape.

/** The four priorities, in ascending order of insistence. */
export const PRIORITIES = ["INFO", "ATTENTION", "ACTION_REQUIRED", "URGENT"];

/**
 * @typedef {Object} Answer
 * @property {string} id     Stable identifier the caller sends back.
 * @property {string} label  Human-readable option text.
 */

/**
 * @typedef {Object} AttentionItem
 * @property {string} id
 * @property {string} source    Where it came from (e.g. "run", "queue").
 * @property {string} subject   Which run or queue it concerns.
 * @property {"INFO"|"ATTENTION"|"ACTION_REQUIRED"|"URGENT"} priority
 * @property {string} title
 * @property {string} detail
 * @property {string} groupKey  How items collapse together.
 * @property {string} at        ISO timestamp.
 * @property {Answer[]} answers  Options offered, or an empty array for none.
 */

/**
 * Normalise and validate a plain object into an AttentionItem.
 * @param {Object} input
 * @returns {AttentionItem}
 */
export function makeItem(input) {
  const raw = input || {};

  const id = normaliseString(raw.id);
  const source = normaliseString(raw.source);
  const subject = normaliseString(raw.subject);
  const priority = normaliseString(raw.priority);
  const title = normaliseString(raw.title);
  const detail = normaliseString(raw.detail);
  const at = normaliseString(raw.at);

  if (!subject) {
    throw new Error(
      `Attention item has no subject: item ${quote(id || title)}. ` +
        `Every item names the run or queue it is about.`
    );
  }
  if (!title) {
    throw new Error(
      `Attention item has a blank title: item ${quote(id || subject)}. ` +
        `Give it a short title a person can read.`
    );
  }
  if (!PRIORITIES.includes(priority)) {
    throw new Error(
      `Unknown priority: ${quote(priority)}. ` +
        `Use INFO, ATTENTION, ACTION_REQUIRED or URGENT.`
    );
  }

  const answers = normaliseAnswers(raw.answers, id || subject, priority);

  const groupKey = normaliseString(raw.groupKey) || `${source}:${subject}`;

  return Object.freeze({
    id,
    source,
    subject,
    priority,
    title,
    detail,
    groupKey,
    at,
    answers,
  });
}

/** @param {unknown} value */
function normaliseString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * @param {unknown} value
 * @param {string} itemName
 * @param {string} priority
 * @returns {Answer[]}
 */
function normaliseAnswers(value, itemName, priority) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new Error(
      `Attention item answers are not a list: item ${quote(itemName)}. ` +
        `Give answers as an array of { id, label }, or omit them.`
    );
  }
  if (value.length > 0 && priority !== "ACTION_REQUIRED") {
    throw new Error(
      `Attention item offers answers but is not answerable: ` +
        `item ${quote(itemName)} is ${priority}. ` +
        `Only ACTION_REQUIRED items may offer answers.`
    );
  }
  const answers = value.map((a) =>
    Object.freeze({
      id: normaliseString(a && a.id),
      label: normaliseString(a && a.label),
    })
  );
  const seen = new Set();
  for (const answer of answers) {
    if (seen.has(answer.id)) {
      throw new Error(
        `Attention item has duplicate answer ids: ` +
          `item ${quote(itemName)} repeats ${quote(answer.id)}. ` +
          `Each answer needs a distinct id.`
      );
    }
    seen.add(answer.id);
  }
  return Object.freeze(answers);
}

/** @param {string} value */
function quote(value) {
  return `"${value}"`;
}
