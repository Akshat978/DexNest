// Phase 4: grouping. Items sharing a groupKey collapse into one group, so six
// "iteration completed" reads as one "6 iterations completed". The load-bearing
// test is the last one: items about different subjects must never merge, no
// matter how identical their text, because a merge across subjects would say
// the wrong thing about the wrong run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeItem, groupItems, digestGroup } from "../src/index.js";

const AT = "2026-09-07T10:00:00.000Z";

/** Build a real INFO item about a run, i seconds after AT. */
function iteration(runId, i) {
  return makeItem({
    id: `${runId}:iter:${i}`,
    source: "run",
    subject: runId,
    priority: "INFO",
    title: "iteration completed",
    detail: `iteration ${i} finished`,
    at: `2026-09-07T10:00:0${i}.000Z`,
  });
}

test("six iterations about one run collapse into one group of six", () => {
  const stream = [1, 2, 3, 4, 5, 6].map((i) => iteration("run-7", i));
  const groups = groupItems(stream);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 6);
  assert.equal(groups[0].title, "6 iterations completed");
  assert.equal(groups[0].subject, "run-7");
  assert.equal(groups[0].items.length, 6);
});

test("a lone item is its own group and keeps its own title", () => {
  const groups = groupItems([iteration("run-7", 1)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 1);
  assert.equal(groups[0].title, "iteration completed");
});

test("an empty or missing stream yields no groups", () => {
  assert.deepEqual(groupItems([]), []);
  assert.deepEqual(groupItems(undefined), []);
});

test("the group's timestamp is the newest member's", () => {
  const stream = [iteration("run-7", 3), iteration("run-7", 1), iteration("run-7", 5)];
  const [group] = groupItems(stream);
  assert.equal(group.at, "2026-09-07T10:00:05.000Z");
});

test("the group is as loud as its loudest member", () => {
  const info = iteration("run-7", 1);
  const loud = makeItem({
    id: "run-7:blocked",
    source: "run",
    subject: "run-7",
    priority: "ACTION_REQUIRED",
    title: "iteration completed",
    detail: "awaiting your decision",
    at: AT,
    answers: [{ id: "go", label: "Continue" }],
  });
  const [group] = groupItems([info, loud]);
  assert.equal(group.count, 2);
  assert.equal(group.priority, "ACTION_REQUIRED");
});

test("groups follow first appearance in the stream", () => {
  const groups = groupItems([
    iteration("run-b", 1),
    iteration("run-a", 1),
    iteration("run-b", 2),
  ]);
  assert.deepEqual(
    groups.map((g) => g.subject),
    ["run-b", "run-a"]
  );
});

test("items about different subjects never merge, however identical their text", () => {
  // Byte-for-byte identical titles and details, differing only in subject.
  const a = makeItem({
    id: "a",
    source: "run",
    subject: "run-a",
    priority: "INFO",
    title: "iteration completed",
    detail: "the very same words",
    at: AT,
  });
  const b = makeItem({
    id: "b",
    source: "run",
    subject: "run-b",
    priority: "INFO",
    title: "iteration completed",
    detail: "the very same words",
    at: AT,
  });

  const groups = groupItems([a, b]);
  assert.equal(groups.length, 2, "different subjects must stay apart");
  assert.deepEqual(
    new Set(groups.map((g) => g.subject)),
    new Set(["run-a", "run-b"])
  );
  for (const group of groups) {
    assert.equal(group.count, 1);
  }
});

test("an explicit shared groupKey does merge across subjects — grouping obeys the key it is given", () => {
  const a = makeItem({
    id: "a",
    source: "run",
    subject: "run-a",
    priority: "INFO",
    title: "iteration completed",
    detail: "x",
    at: AT,
    groupKey: "shared",
  });
  const b = makeItem({
    id: "b",
    source: "run",
    subject: "run-b",
    priority: "INFO",
    title: "iteration completed",
    detail: "y",
    at: AT,
    groupKey: "shared",
  });
  const groups = groupItems([a, b]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test("grouping does not mutate its input", () => {
  const stream = [iteration("run-7", 1), iteration("run-7", 2)];
  const copy = stream.slice();
  groupItems(stream);
  assert.deepEqual(stream, copy);
  assert.equal(stream.length, 2);
});

// Phase 5: the digest.

/** The one item in a group that awaits an answer. */
function blocked(runId, at) {
  return makeItem({
    id: `${runId}:blocked`,
    source: "run",
    subject: runId,
    priority: "ACTION_REQUIRED",
    title: "approve the migration to continue",
    detail: "awaiting your decision before it proceeds",
    at,
    answers: [{ id: "go", label: "Continue" }],
  });
}

test("a mixed group's digest reads: how many, the newest detail, and priority", () => {
  const stream = [1, 2, 3].map((i) => iteration("run-7", i));
  const [group] = groupItems(stream);
  const digest = digestGroup(group);

  assert.equal(digest.count, 3);
  assert.equal(digest.headline, "3 iterations completed");
  assert.equal(digest.subject, "run-7");
  assert.equal(digest.priority, "INFO");
  // Newest detail: the third iteration is the latest, so its detail shows.
  assert.equal(digest.latest, "iteration 3 finished");
  assert.equal(digest.outstanding.length, 0);
  assert.equal(
    digest.line,
    "run-7: 3 iterations completed — latest: iteration 3 finished"
  );
});

test("an ACTION_REQUIRED item is never hidden inside a summary of routine ones", () => {
  // Five routine iterations plus one item that genuinely needs an answer.
  const routine = [1, 2, 3, 4, 5].map((i) => iteration("run-7", i));
  const ask = blocked("run-7", "2026-09-07T10:00:04.000Z");
  const [group] = groupItems([...routine, ask]);
  const digest = digestGroup(group);

  // The group is as loud as its loudest member.
  assert.equal(digest.priority, "ACTION_REQUIRED");
  // The outstanding item is surfaced in its own right.
  assert.equal(digest.outstanding.length, 1);
  assert.equal(digest.outstanding[0].id, "run-7:blocked");
  // And the readable line names it, rather than folding it into the count.
  assert.match(digest.line, /needs your answer: approve the migration to continue/);
  assert.ok(
    digest.line.includes("approve the migration to continue"),
    "the outstanding question must appear in the digest line, not be buried"
  );
});

test("a group with several outstanding items names how many need answering", () => {
  const one = blocked("run-7", "2026-09-07T10:00:01.000Z");
  const twoRaw = {
    id: "run-7:blocked-2",
    source: "run",
    subject: "run-7",
    priority: "ACTION_REQUIRED",
    title: "confirm the rollback",
    detail: "also waiting",
    at: "2026-09-07T10:00:02.000Z",
    answers: [{ id: "yes", label: "Roll back" }],
  };
  const [group] = groupItems([one, makeItem(twoRaw)]);
  const digest = digestGroup(group);

  assert.equal(digest.outstanding.length, 2);
  assert.match(digest.line, /needs your answer: 2 items need your answer/);
});

test("digesting an empty group is refused with a message that names it", () => {
  assert.throws(
    () => digestGroup({ groupKey: "run:x", subject: "x", items: [] }),
    /Cannot digest an empty group: group "run:x"\./
  );
});
