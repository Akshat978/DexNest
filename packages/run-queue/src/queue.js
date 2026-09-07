// Queue items and their order.
//
// A queue item describes one project the night should work on. The caller
// supplies the content; the engine owns the ordinal. Ordinals are assigned
// from input order and never read from the caller, so two items can never
// claim the same position in the queue.

/**
 * @typedef {Object} QueueItem
 * @property {string} id
 * @property {number} ordinal   assigned by the engine, 0-based, from input order
 * @property {string} projectPath
 * @property {string} goal
 * @property {string} [planText]
 * @property {string} [label]
 */

/**
 * The longest a goal may be. Long enough for a real instruction, short enough
 * that a runaway paste is caught before it reaches an agent.
 */
export const MAX_GOAL_LENGTH = 2000;

/**
 * Normalize, validate and order a list of raw items into a queue.
 *
 * The result is a new array; the input and its items are not mutated. Ordinals
 * are assigned from input order, so the caller cannot fix or collide them. A
 * malformed item is refused with a message that names the offending item and
 * says what to fix, never a generic throw.
 *
 * @param {ReadonlyArray<Partial<QueueItem>>} items
 * @returns {QueueItem[]}
 */
export function buildQueue(items) {
  if (!Array.isArray(items)) {
    throw new Error(
      `Queue input is not an array: ${describe(items)}. Pass an array of items.`,
    );
  }

  const seenIds = new Map();

  return items.map((item, index) => {
    const name = nameOf(item, index);

    if (typeof item.id !== "string" || item.id.trim() === "") {
      throw new Error(
        `Queue item has no id: ${name}. Give every item a unique id.`,
      );
    }
    if (seenIds.has(item.id)) {
      throw new Error(
        `Queue item has a duplicate id: ${name}, already used by item ${seenIds.get(item.id)}. Give every item a unique id.`,
      );
    }
    seenIds.set(item.id, index);

    if (typeof item.goal !== "string" || item.goal.trim() === "") {
      throw new Error(
        `Queue item has no goal: ${name}. Give every item a goal.`,
      );
    }
    if (item.goal.length > MAX_GOAL_LENGTH) {
      throw new Error(
        `Queue item goal is too long: ${name}, ${item.goal.length} characters. Keep goals to at most ${MAX_GOAL_LENGTH} characters.`,
      );
    }

    if (typeof item.projectPath !== "string" || item.projectPath.trim() === "") {
      throw new Error(
        `Queue item has no projectPath: ${name}. Give every item an absolute projectPath.`,
      );
    }
    if (!isAbsolutePath(item.projectPath)) {
      throw new Error(
        `Queue item projectPath is not absolute: ${name} ("${item.projectPath}"). Use an absolute path like /home/me/project or C:\\Users\\me\\project.`,
      );
    }

    /** @type {QueueItem} */
    const normalized = {
      id: item.id,
      ordinal: index,
      projectPath: item.projectPath,
      goal: item.goal,
    };
    if (item.planText !== undefined) normalized.planText = item.planText;
    if (item.label !== undefined) normalized.label = item.label;
    return normalized;
  });
}

/**
 * Produce a new queue with its items in the order named by `itemIds`, with
 * ordinals reassigned from the new order. The id list must be exactly the set
 * of ids already in the queue — no unknowns, no duplicates, none missing — so
 * a reorder can never silently drop or invent a project. Records are untouched
 * (they live outside the queue), so history survives a reorder. Does not
 * mutate its arguments.
 *
 * @param {ReadonlyArray<QueueItem>} queue
 * @param {ReadonlyArray<string>} itemIds
 * @returns {QueueItem[]}
 */
export function reorder(queue, itemIds) {
  if (!Array.isArray(queue)) {
    throw new Error(
      `Queue is not an array: ${describe(queue)}. Pass a built queue.`,
    );
  }
  if (!Array.isArray(itemIds)) {
    throw new Error(
      `Reorder id list is not an array: ${describe(itemIds)}. Pass the item ids in the order you want.`,
    );
  }

  const byId = new Map(queue.map((item) => [item.id, item]));

  const seen = new Set();
  for (const id of itemIds) {
    if (!byId.has(id)) {
      throw new Error(
        `Reorder names an unknown item: "${id}". List only ids already in the queue: ${[...byId.keys()].join(", ")}.`,
      );
    }
    if (seen.has(id)) {
      throw new Error(
        `Reorder names an item twice: "${id}". List every id exactly once.`,
      );
    }
    seen.add(id);
  }

  if (itemIds.length !== queue.length) {
    const missing = queue.map((item) => item.id).filter((id) => !seen.has(id));
    throw new Error(
      `Reorder is missing items: ${missing.map((id) => `"${id}"`).join(", ")}. List every id in the queue exactly once.`,
    );
  }

  return itemIds.map((id, index) => {
    const item = /** @type {QueueItem} */ (byId.get(id));
    return { ...item, ordinal: index };
  });
}

/**
 * Name an item for an error message: its ordinal, plus its id or label when
 * one is present, so the operator can find the offending row.
 * @param {Partial<QueueItem>} item
 * @param {number} index
 * @returns {string}
 */
function nameOf(item, index) {
  const marker =
    typeof item.id === "string" && item.id.trim() !== ""
      ? item.id
      : typeof item.label === "string" && item.label.trim() !== ""
        ? item.label
        : undefined;
  return marker === undefined ? `item ${index}` : `item ${index} ("${marker}")`;
}

/**
 * Whether a path is absolute, POSIX (leading /) or Windows (drive-letter or
 * UNC). No filesystem is touched; this is a syntactic check only.
 * @param {string} path
 * @returns {boolean}
 */
function isAbsolutePath(path) {
  if (path.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  if (path.startsWith("\\\\")) return true;
  return false;
}

/**
 * A short, safe description of an arbitrary value for an error message.
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value;
}
