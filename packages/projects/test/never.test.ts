// The NEVER rules at the contract level: no request can name a forbidden
// operation, or smuggle one in through a flag on an allowed operation.
// git-ops enforces the same rules again at argv level (Phase 4).

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { NEVER_RULES } from "../src/domain/safety.ts";
import { OPERATION_KINDS, parseOperationRequest } from "../src/domain/operations.ts";

test("every NEVER rule refuses each of its operation names", () => {
  for (const rule of NEVER_RULES) {
    for (const kind of rule.kinds) {
      const result = parseOperationRequest({ kind });
      assert.equal(result.ok, false, `${kind} was accepted`);
      if (!result.ok) {
        assert.equal(result.refusal.code, "never_allowed", kind);
        assert.equal(result.refusal.reason, rule.reason);
      }
    }
  }
});

test("every NEVER flag is refused on every allowed operation", () => {
  for (const rule of NEVER_RULES) {
    for (const flag of rule.flags) {
      for (const kind of OPERATION_KINDS) {
        for (const value of [true, "yes", 1]) {
          const result = parseOperationRequest({ kind, [flag]: value });
          assert.equal(result.ok, false, `${kind} + ${flag}=${String(value)} was accepted`);
          if (!result.ok) assert.equal(result.refusal.code, "never_allowed", `${kind} + ${flag}`);
        }
      }
    }
  }
});

test("the forbidden operations named in the brief are all covered", () => {
  const kinds = new Set(NEVER_RULES.flatMap((r) => r.kinds));
  for (const required of ["force_push", "reset_hard", "clean", "clean_fdx", "rebase", "pull_rebase", "amend", "filter_branch"]) {
    assert.ok(kinds.has(required), required);
  }
  const flags = new Set(NEVER_RULES.flatMap((r) => r.flags));
  for (const required of ["force", "forceWithLease", "mirror", "hard", "rebase", "amend"]) assert.ok(flags.has(required), required);
});

test("no NEVER operation is an operation kind DexNest can plan", () => {
  const allowed = new Set<string>(OPERATION_KINDS);
  for (const rule of NEVER_RULES) for (const kind of rule.kinds) assert.equal(allowed.has(kind), false, kind);
});

test("requests are parsed strictly: unknown fields and wrong types are refused, not ignored", () => {
  const cases: unknown[] = [
    null,
    "push",
    { kind: "push", remote: "origin", extra: 1 },
    { kind: "push", setUpstream: "yes" },
    { kind: "commit", files: "all" },
    { kind: "commit", message: "m", files: "some" },
    { kind: "commit", message: "m", files: [1] },
    { kind: "stash_pop", index: -1, sha: "x" },
    { kind: "stash_pop", index: 1.5, sha: "x" },
    { kind: "switch", branch: "x", dirty: "discard" },
    { kind: "undo", opId: "" },
    { kind: "gc" }
  ];
  for (const input of cases) assert.equal(parseOperationRequest(input).ok, false, JSON.stringify(input));
});

test("valid requests parse to exactly what was asked", () => {
  assert.deepEqual(parseOperationRequest({ kind: "push", setUpstream: true }), { ok: true, request: { kind: "push", branch: undefined, remote: undefined, setUpstream: true } });
  assert.deepEqual(parseOperationRequest({ kind: "discard", files: ["a"] }), { ok: true, request: { kind: "discard", files: ["a"] } });
  // A NEVER flag explicitly set to false is not a request for it.
  assert.equal(parseOperationRequest({ kind: "push", force: false }).ok, false, "unknown field still refused");
});
