// Phase 14: purity, determinism, and one voice for every refusal. Three claims,
// each proven from src/index.js's real surface:
//
//   1. Determinism — `decide` on the same inputs returns deep-equal results,
//      call after call, and mutates neither its inputs nor a deep-frozen copy.
//   2. No hidden clock, file or network — "now" is always an argument, so no
//      src/ module may reach for Date.now(), a bare `new Date()`, the
//      filesystem, the network, or process/global state.
//   3. One format, one voice — every refusal the public API throws is a
//      two-part message: a clause naming what was wrong, then a sentence saying
//      what to do instead. Nothing drifted.
//
// These tests may only tighten what earlier phases established; they weaken
// nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  decide,
  makeItem,
  renderNotification,
  renderSummary,
  answersFor,
  validateAnswer,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

const NOW = "2026-09-07T02:30:00-04:00";
const QUIET = { start: "23:00", end: "08:00" };

/** A representative night: routine held, escalation and urgent piercing, an
 *  answerable item, and a group already delivered. Enough shape to exercise
 *  every phase decide() composes. */
function nightState() {
  return {
    items: [
      { id: "b1", source: "run", subject: "build-42", priority: "INFO", title: "iteration completed", at: "2026-09-07T02:05:00-04:00" },
      { id: "b2", source: "run", subject: "build-42", priority: "INFO", title: "iteration completed", at: "2026-09-07T02:20:00-04:00" },
      { id: "d1", source: "run", subject: "deploy-9", priority: "ACTION_REQUIRED", title: "approve migration?", at: "2026-09-07T02:10:00-04:00", answers: [{ id: "yes", label: "Approve" }] },
      { id: "m1", source: "run", subject: "monitor-1", priority: "URGENT", title: "disk almost full", at: "2026-09-07T02:15:00-04:00" },
      { id: "c1", source: "run", subject: "cache-3", priority: "ATTENTION", title: "cache warmed", at: "2026-09-07T02:25:00-04:00" },
    ],
    delivered: [
      { groupKey: "run:cache-3", priority: "INFO", at: "2026-09-07T02:20:00-04:00" },
    ],
    quietHours: QUIET,
    now: NOW,
  };
}

/** Recursively Object.freeze every reachable object and array. */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

test("decide is deterministic: two calls on the same inputs are deep-equal", () => {
  const state = nightState();
  const first = decide(state);
  const second = decide(state);
  assert.deepEqual(first, second);
});

test("decide mutates nothing, even when its whole input is deep-frozen", () => {
  // If decide wrote to any part of the input, a frozen target would throw in
  // strict mode (ES modules are strict), so the call surviving is itself proof.
  const state = deepFreeze(nightState());
  const snapshot = structuredClone(state);
  assert.doesNotThrow(() => decide(state));
  assert.deepEqual(state, snapshot);
});

test("decide's own output is deep-frozen, so an accidental write throws", () => {
  const out = decide(nightState());
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.deliver));
  assert.ok(Object.isFrozen(out.hold));
  assert.ok(Object.isFrozen(out.reason));
  assert.throws(() => {
    out.deliver.push({});
  });
});

test("no src/ module reaches for the clock, filesystem, network, or ambient state", () => {
  // "now" is always passed in; purity is the whole point. Guard against the
  // usual ways a pure function quietly stops being one.
  const forbidden = [
    { re: /Date\.now\s*\(/, why: "Date.now() reads the clock" },
    { re: /new\s+Date\s*\(\s*\)/, why: "a bare new Date() reads the clock" },
    { re: /\brequire\s*\(\s*["']fs["']\s*\)/, why: "requires the filesystem" },
    { re: /\bfrom\s+["']node:fs["']/, why: "imports the filesystem" },
    { re: /\bfrom\s+["']fs["']/, why: "imports the filesystem" },
    { re: /\bfetch\s*\(/, why: "makes a network call" },
    { re: /\bfrom\s+["'](node:)?(http|https|net)["']/, why: "opens the network" },
    { re: /\bprocess\./, why: "reads ambient process state" },
    { re: /\bMath\.random\s*\(/, why: "is nondeterministic" },
  ];
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith(".js")) continue;
    const text = readFileSync(join(SRC, file), "utf8");
    for (const { re, why } of forbidden) {
      assert.ok(!re.test(text), `src/${file} ${why}`);
    }
  }
});

// Every refusal collected from the public API, each paired with a call that
// triggers it. The point is to look at them all together against one format.
const refusals = [
  () => makeItem({ id: "x", title: "t", priority: "INFO" }), // no subject
  () => makeItem({ id: "x", subject: "s", priority: "INFO" }), // blank title
  () => makeItem({ id: "x", subject: "s", title: "t", priority: "LOUD" }), // bad priority
  () => makeItem({ id: "x", subject: "s", title: "t", priority: "INFO", answers: "no" }),
  () => makeItem({ id: "x", subject: "s", title: "t", priority: "INFO", answers: [{ id: "a", label: "A" }] }),
  () => makeItem({ id: "x", subject: "s", title: "t", priority: "ACTION_REQUIRED", answers: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }),
  () => validateAnswer(makeItem({ id: "x", subject: "s", title: "t", priority: "INFO" }), "a"),
  () => validateAnswer(makeItem({ id: "x", subject: "s", title: "t", priority: "ACTION_REQUIRED", answers: [{ id: "yes", label: "Yes" }] }), ""),
  () => validateAnswer(makeItem({ id: "x", subject: "s", title: "t", priority: "ACTION_REQUIRED", answers: [{ id: "yes", label: "Yes" }] }), "no"),
  () => validateAnswer(null, "a"),
  () => answersFor(null),
  () => renderNotification(null),
  () => renderSummary(null),
];

test("every refusal speaks in one voice: a problem clause, then how to fix it", () => {
  for (const trigger of refusals) {
    let message;
    try {
      trigger();
      assert.fail("expected the call to refuse, but it returned");
    } catch (err) {
      assert.ok(err instanceof Error, "refusals throw Error");
      message = err.message;
    }

    // One format: the message ends with a full sentence — a fix, an instruction
    // — so it never trails off after merely naming the problem.
    assert.ok(/[.?]$/.test(message.trim()), `refusal should end in a sentence: ${message}`);

    // Two parts: a clause naming what was wrong, then a separate sentence of
    // guidance. Every refusal carries at least one interior period.
    const sentences = message.split(". ").filter((s) => s.trim().length > 0);
    assert.ok(sentences.length >= 2, `refusal should name the fault and the fix: ${message}`);

    // One voice: guidance in the imperative, never blame or bare status. The
    // final sentence tells the caller what to do.
    const last = sentences[sentences.length - 1];
    assert.ok(
      /\b(Use|Give|Send|Answer|Pass|Only|Each|Every)\b/.test(last),
      `refusal should end with an instruction: ${message}`
    );
  }
});
