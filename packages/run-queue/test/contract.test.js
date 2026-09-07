// index.d.ts is a hand-written contract against plain JavaScript, so nothing
// generates it and nothing but this test notices when the two drift apart.
//
// It cannot check types — that is tsc's job — but it can check that every name
// the host compiles against actually exists at runtime, and that nothing is
// reachable but untyped. Both failures would otherwise surface far away: the
// first as "undefined is not a function" in the desktop, the second as `any`
// spreading silently through the host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as api from "../src/index.js";

const declaration = readFileSync(
  fileURLToPath(new URL("../src/index.d.ts", import.meta.url)),
  "utf8"
);

/** Names the contract declares as runtime values, not types. */
function declaredValues() {
  const names = [];
  for (const line of declaration.split("\n")) {
    const match = /^export declare (?:const|function) ([A-Za-z_$][\w$]*)/.exec(line.trim());
    if (match) names.push(match[1]);
  }
  return names;
}

test("every value the contract declares exists at runtime", () => {
  const declared = declaredValues();
  assert.ok(declared.length >= 15, `expected a full API in the contract, found ${declared.length}`);

  const missing = declared.filter(name => api[name] === undefined);
  assert.deepEqual(missing, [], "declared in index.d.ts but absent from src/index.js");
});

test("nothing is exported at runtime without being declared", () => {
  const declared = new Set(declaredValues());
  const undeclared = Object.keys(api).filter(name => !declared.has(name));
  assert.deepEqual(undeclared, [], "exported from src/index.js but absent from index.d.ts");
});
