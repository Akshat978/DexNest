// Phase 12: answers. The engine validates an answer; it never performs one.
// `answersFor` reports the options an item offered — an empty list for an item
// that offered none. `validateAnswer` confirms that a given id is one the item
// actually offered, and refuses, with a message naming the offending value,
// when the item offered no answers at all or when the id was never among them.
//
// Following CONVENTIONS: an item is answerable only when its priority is
// ACTION_REQUIRED, the one level defined as "DexNest cannot continue without an
// answer". An INFO/ATTENTION/URGENT item offers nothing to answer, and makeItem
// already refuses to build such an item with answers attached, so an answerable
// item here is exactly one carrying a non-empty answers list.

/**
 * The options an item offered, in order. A fresh array every call; the item is
 * not mutated. An item that offered no answers yields an empty array — this is
 * a question about the item, not a refusal, so it does not throw.
 *
 * @param {import("./item.js").AttentionItem} item
 * @returns {import("./item.js").Answer[]}
 */
export function answersFor(item) {
  requireItem(item, "read the answers of");
  const answers = Array.isArray(item.answers) ? item.answers : [];
  return answers.map((a) =>
    Object.freeze({ id: String(a.id || ""), label: String(a.label || "") })
  );
}

/**
 * Confirm that `answerId` is an option the item offered, and return that
 * option. Refuses — never performs — when the item offered no answers, or when
 * the id was not one it offered. The refusal names the offending value.
 *
 * @param {import("./item.js").AttentionItem} item
 * @param {string} answerId
 * @returns {import("./item.js").Answer}
 */
export function validateAnswer(item, answerId) {
  requireItem(item, "validate an answer for");
  const offered = answersFor(item);
  const name = String((item && (item.id || item.subject)) || "");

  if (offered.length === 0) {
    throw new Error(
      `Answer offered to an item that asked nothing: ` +
        `item ${quote(name)} offers no answers. ` +
        `Only an ACTION_REQUIRED item with options can be answered.`
    );
  }

  const id = normalise(answerId);
  if (!id) {
    throw new Error(
      `Answer has no id: item ${quote(name)} was answered with ${quote(
        answerId == null ? "" : String(answerId)
      )}. ` +
        `Send back the id of one option: ${offered
          .map((a) => a.id)
          .join(", ")}.`
    );
  }

  const match = offered.find((a) => a.id === id);
  if (!match) {
    throw new Error(
      `Answer was never offered: item ${quote(name)} has no option ${quote(
        id
      )}. ` +
        `Answer with one of: ${offered.map((a) => a.id).join(", ")}.`
    );
  }

  return match;
}

/**
 * @param {unknown} item
 * @param {string} verb
 */
function requireItem(item, verb) {
  if (!item || typeof item !== "object") {
    throw new Error(
      `Cannot ${verb} a non-item: got ${quote(
        item == null ? "" : String(item)
      )}. Pass an item built by makeItem.`
    );
  }
}

/** @param {unknown} value */
function normalise(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/** @param {string} value */
function quote(value) {
  return `"${value}"`;
}
