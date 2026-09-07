// Phase 10: one night, driven through the single public entry point `decide`.
// We assert the whole outcome — what goes out, what waits, and the reason each
// waiting group waits — and we prove the rule that outranks the rest: nothing is
// held silently. Every held group is named in both `hold` and `reason`, and the
// escalations and urgencies that pierce the holds still get through at 2am.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, makeItem } from "../src/index.js";

// 02:30 local, inside a 23:00–08:00 quiet window.
const NOW = "2026-09-07T02:30:00-04:00";
const QUIET = { start: "23:00", end: "08:00" };

test("a realistic night: routine waits, escalations and urgent pierce, nothing is silent", () => {
  const items = [
    // build-42: two routine INFO iterations — collapse into one group, held by
    // quiet hours until 08:00.
    { id: "b1", source: "run", subject: "build-42", priority: "INFO", title: "iteration completed", at: "2026-09-07T02:05:00-04:00" },
    { id: "b2", source: "run", subject: "build-42", priority: "INFO", title: "iteration completed", at: "2026-09-07T02:20:00-04:00" },
    // deploy-9: an ACTION_REQUIRED that cannot proceed without an answer —
    // pierces quiet hours, delivered even at 2am.
    { id: "d1", source: "run", subject: "deploy-9", priority: "ACTION_REQUIRED", title: "approve migration?", at: "2026-09-07T02:10:00-04:00", answers: [{ id: "yes", label: "Approve" }] },
    // monitor-1: URGENT, time-sensitive — pierces quiet hours too.
    { id: "m1", source: "run", subject: "monitor-1", priority: "URGENT", title: "disk almost full", at: "2026-09-07T02:15:00-04:00" },
    // cache-3: routine ATTENTION whose group was just delivered — held by BOTH
    // cooldown and quiet hours, and the reason must say both.
    { id: "c1", source: "run", subject: "cache-3", priority: "ATTENTION", title: "cache warmed", at: "2026-09-07T02:25:00-04:00" },
  ];

  const delivered = [
    // cache-3 was delivered 10 minutes ago, well inside the 60-minute cooldown.
    { groupKey: "run:cache-3", priority: "INFO", at: "2026-09-07T02:20:00-04:00" },
  ];

  const out = decide({ items, delivered, quietHours: QUIET, now: NOW });

  // Delivered now: the two piercing groups, in input order.
  assert.deepEqual(
    out.deliver.map((d) => d.groupKey),
    ["run:deploy-9", "run:monitor-1"]
  );
  // The ACTION_REQUIRED digest still names the outstanding answer.
  const deploy = out.deliver.find((d) => d.groupKey === "run:deploy-9");
  assert.equal(deploy.outstanding.length, 1);
  assert.match(deploy.line, /needs your answer/);

  // Held: the routine groups, in input order.
  assert.deepEqual(
    out.hold.map((d) => d.groupKey),
    ["run:build-42", "run:cache-3"]
  );

  // Nothing is held silently: a reason for every held group, aligned with hold.
  assert.equal(out.reason.length, out.hold.length);
  assert.deepEqual(
    out.reason.map((r) => r.groupKey),
    out.hold.map((d) => d.groupKey)
  );

  const build = out.reason.find((r) => r.groupKey === "run:build-42");
  assert.equal(build.reason, "quiet_hours");
  assert.equal(build.quietEndsAt, "08:00");
  assert.equal(build.coolsDownAt, null);

  // The collapsed routine group still reports its two members.
  const buildDigest = out.hold.find((d) => d.groupKey === "run:build-42");
  assert.equal(buildDigest.count, 2);

  // cache-3 is held for both reasons, and both are named.
  const cache = out.reason.find((r) => r.groupKey === "run:cache-3");
  assert.equal(cache.reason, "cooling_down+quiet_hours");
  assert.equal(cache.quietEndsAt, "08:00");
  assert.ok(cache.coolsDownAt);
});

test("cooldown alone holds outside quiet hours, and escalation pierces it", () => {
  const day = "2026-09-07T12:00:00-04:00"; // outside the quiet window
  const items = [
    { id: "a", source: "run", subject: "sync-1", priority: "INFO", title: "synced", at: "2026-09-07T11:59:00-04:00" },
    { id: "b", source: "run", subject: "sync-2", priority: "ACTION_REQUIRED", title: "confirm delete?", at: "2026-09-07T11:59:00-04:00" },
  ];
  const delivered = [
    { groupKey: "run:sync-1", priority: "INFO", at: "2026-09-07T11:40:00-04:00" },
    { groupKey: "run:sync-2", priority: "INFO", at: "2026-09-07T11:40:00-04:00" },
  ];

  const out = decide({ items, delivered, quietHours: QUIET, now: day });

  // sync-1 routine is held by cooldown; sync-2 escalation pierces it.
  assert.deepEqual(out.hold.map((d) => d.groupKey), ["run:sync-1"]);
  assert.deepEqual(out.deliver.map((d) => d.groupKey), ["run:sync-2"]);
  const r = out.reason[0];
  assert.equal(r.reason, "cooling_down");
  assert.equal(r.quietEndsAt, null);
  assert.ok(r.coolsDownAt);
});

test("a clear daytime item with no prior delivery is delivered plainly", () => {
  const day = "2026-09-07T12:00:00-04:00";
  const out = decide({
    items: [makeItem({ id: "x", source: "run", subject: "fresh", priority: "INFO", title: "started", at: day })],
    delivered: [],
    quietHours: QUIET,
    now: day,
  });
  assert.deepEqual(out.deliver.map((d) => d.groupKey), ["run:fresh"]);
  assert.equal(out.hold.length, 0);
  assert.equal(out.reason.length, 0);
});
