// Integration QA F7: after "Seed Demo Data", Finance shows the demo profile
// unless the user's own active profile holds anything of theirs.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { activeProfileAfterDemoSeed } from "../src/main/demoFinance.ts";

const base = { keptProfileIds: ["personal-default"], demoProfileId: "demo-profile-personal" };

test("fresh install: the empty default profile gives way to the demo profile", () => {
  assert.equal(activeProfileAfterDemoSeed({ ...base, currentActiveId: "personal-default", profilesWithUserData: new Set() }), "demo-profile-personal");
});

test("a profile with the user's own data stays active", () => {
  assert.equal(activeProfileAfterDemoSeed({ ...base, currentActiveId: "personal-default", profilesWithUserData: new Set(["personal-default"]) }), "personal-default");
});

test("an active profile that is gone (or was demo) falls back to the demo profile", () => {
  assert.equal(activeProfileAfterDemoSeed({ ...base, currentActiveId: "demo-profile-business", profilesWithUserData: new Set(["personal-default"]) }), "demo-profile-personal");
});

test("the demo seed uses the rule, counting only non-demo records as the user's", () => {
  const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.match(main, /\[\.\.\.loadFinanceTransactions\(\), \.\.\.loadFinanceRecurring\(\)\]\.filter\(\(item\) => !isDemoRecord\(item\)\)/);
  assert.match(main, /const activeProfileId = activeProfileAfterDemoSeed\(\{/);
});
