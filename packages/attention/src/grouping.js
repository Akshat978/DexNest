// Phase 4: grouping. Many items that are about the same thing collapse into one
// group, so a person reads "6 iterations completed" instead of six identical
// lines. The collapse is keyed on `groupKey` alone — and because `groupKey`
// defaults to `source:subject`, two items about different runs never merge,
// however similar their titles read. That guarantee is the point of this phase:
// saying less must never mean saying the wrong thing about the wrong subject.

/** The four priorities, ascending. Highest in a group decides the group's. */
const PRIORITY_RANK = {
  INFO: 0,
  ATTENTION: 1,
  ACTION_REQUIRED: 2,
  URGENT: 3,
};

/**
 * @typedef {Object} ItemGroup
 * @property {string} groupKey  What every member shares.
 * @property {string} subject   The subject every member is about.
 * @property {number} count     How many items collapsed into this group.
 * @property {"INFO"|"ATTENTION"|"ACTION_REQUIRED"|"URGENT"} priority
 *   The highest priority among the members — the group is as loud as its
 *   loudest item, never quieter.
 * @property {string} title     A single readable line standing for the group.
 * @property {string} at        The newest member's timestamp.
 * @property {import("./item.js").AttentionItem[]} items  The members, in the
 *   order they arrived.
 */

/**
 * Collapse a stream of items into groups, one per `groupKey`. Order of the
 * returned groups follows first appearance of each key in the input, so the
 * output is deterministic. The input is not mutated.
 *
 * @param {import("./item.js").AttentionItem[]} items
 * @returns {ItemGroup[]}
 */
export function groupItems(items) {
  const stream = Array.isArray(items) ? items : [];

  /** @type {Map<string, import("./item.js").AttentionItem[]>} */
  const byKey = new Map();
  const order = [];
  for (const item of stream) {
    const key = item.groupKey;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push(item);
  }

  return order.map((key) => summarise(key, byKey.get(key)));
}

/**
 * @param {string} groupKey
 * @param {import("./item.js").AttentionItem[]} members
 * @returns {ItemGroup}
 */
function summarise(groupKey, members) {
  let priority = members[0].priority;
  let newest = members[0];
  for (const item of members) {
    if (PRIORITY_RANK[item.priority] > PRIORITY_RANK[priority]) {
      priority = item.priority;
    }
    if (item.at > newest.at) newest = item;
  }

  const count = members.length;
  const title =
    count === 1 ? members[0].title : collapseTitle(count, members[0].title);

  return Object.freeze({
    groupKey,
    subject: members[0].subject,
    count,
    priority,
    title,
    at: newest.at,
    items: Object.freeze(members.slice()),
  });
}

/**
 * Turn one member's title and a count into a collapsed line: "iteration
 * completed" over six items reads "6 iterations completed". The leading noun is
 * pluralised so the sentence still parses; if a title is a single word it is
 * simply prefixed with the count.
 *
 * @param {number} count
 * @param {string} title
 * @returns {string}
 */
function collapseTitle(count, title) {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return `${count}`;
  words[0] = pluralise(words[0]);
  return `${count} ${words.join(" ")}`;
}

/** @param {string} word */
function pluralise(word) {
  if (/[sxz]$/i.test(word) || /(ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

// Phase 5: the digest. A group is many items; a person wants one line. The
// digest says three things and never fewer: how many collapsed here, the newest
// detail so the reader knows where the subject stands now, and what is still
// outstanding — the items awaiting an answer. The last of these is why a digest
// is not just a shorter summary: an ACTION_REQUIRED item among routine ones must
// be named in its own right, never folded into "6 iterations completed" where a
// reader skims past it. Saying less must not bury the thing that needed saying.

/**
 * @typedef {Object} GroupDigest
 * @property {string} groupKey
 * @property {string} subject
 * @property {"INFO"|"ATTENTION"|"ACTION_REQUIRED"|"URGENT"} priority
 *   The highest priority in the group — the digest is as loud as its loudest
 *   member, so an outstanding action is never demoted by routine company.
 * @property {number} count     How many items the group holds.
 * @property {string} headline  The collapsed title, e.g. "6 iterations completed".
 * @property {string} latest    The newest member's detail (or its title if the
 *   detail is blank), so the reader sees where the subject stands now.
 * @property {import("./item.js").AttentionItem[]} outstanding  The members still
 *   awaiting an answer (ACTION_REQUIRED), in arrival order. Empty when none.
 * @property {string} line      One readable line standing for the whole group.
 *   When anything is outstanding the line names it explicitly; it is never
 *   hidden inside the count of routine items.
 */

/**
 * Render a single group as one readable digest item.
 *
 * @param {import("./grouping.js").ItemGroup} group  A group from `groupItems`.
 * @returns {GroupDigest}
 */
export function digestGroup(group) {
  if (!group || !Array.isArray(group.items) || group.items.length === 0) {
    throw new Error(
      `Cannot digest an empty group: group ${quote(
        group && group.groupKey
      )}. A digest renders one or more collapsed items.`
    );
  }

  const members = group.items;
  let newest = members[0];
  for (const item of members) {
    if (item.at > newest.at) newest = item;
  }
  const latest = newest.detail || newest.title;

  const outstanding = members.filter((m) => m.priority === "ACTION_REQUIRED");

  return Object.freeze({
    groupKey: group.groupKey,
    subject: group.subject,
    priority: group.priority,
    count: group.count,
    headline: group.title,
    latest,
    outstanding: Object.freeze(outstanding.slice()),
    line: digestLine(group, latest, outstanding),
  });
}

/**
 * @param {import("./grouping.js").ItemGroup} group
 * @param {string} latest
 * @param {import("./item.js").AttentionItem[]} outstanding
 * @returns {string}
 */
function digestLine(group, latest, outstanding) {
  let line = `${group.subject}: ${group.title}`;
  if (latest) line += ` — latest: ${latest}`;

  if (outstanding.length > 0) {
    const need =
      outstanding.length === 1
        ? outstanding[0].title
        : `${outstanding.length} items need your answer`;
    line += ` — needs your answer: ${need}`;
  }
  return line;
}

/** @param {unknown} value */
function quote(value) {
  return `"${value == null ? "" : value}"`;
}
