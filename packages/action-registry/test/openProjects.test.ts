// Integration QA F8: Command said "Open Dev Dashboard" after the view became
// Projects. The action keeps its id (pins, routines, voice and Stream Deck
// buttons use it) and opens the same view; only its title and text changed.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { seededActions } from "../src/index.ts";

test("dev.open_dashboard is titled Open Projects and still opens the dev view", () => {
  const action = seededActions.find((a) => a.id === "dev.open_dashboard");
  assert.ok(action, "the old id still exists");
  assert.equal(action.title, "Open Projects");
  assert.match(action.description, /^Open Projects:/);
  assert.equal(action.handlerRef, "desktop.view.dev");
  assert.deepEqual(action.allowedTriggers, ["command", "deck", "module_ui"]);
  assert.equal(action.enabled, true);
  assert.equal(seededActions.filter((a) => /Dev Dashboard/i.test(a.title)).length, 0);
});
