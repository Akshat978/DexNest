// A green suite from the first commit, so every later phase is measured
// against a passing baseline rather than an unknown one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKAGE_NAME } from "../src/index.js";

test("the package is importable and node --test is green from commit one", () => {
  assert.equal(PACKAGE_NAME, "dexnest-attention");
});
