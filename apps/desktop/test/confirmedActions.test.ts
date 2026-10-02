// Integration QA F1: an action the main process only runs when confirmed
// (danger / critical, or requiresConfirmation - main.ts runRegisteredAction)
// must be sent with confirmedDangerous by the view that offers it, or the
// button can never work. GhostOS Forget and "Turn off" were both refused.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { seededActions } from "@dexnest/action-registry";

import { confirmed } from "../src/renderer/views/ghostOsModel.ts";

const needsConfirmation = new Set(
  seededActions.filter((a) => a.dangerLevel === "danger" || a.dangerLevel === "critical" || a.requiresConfirmation).map((a) => a.id)
);
const views = ["GhostOsView.tsx", "ObjectOsView.tsx", "RealityRpgView.tsx", "SkillConstellationView.tsx"];

test("every literal action call that needs confirmation sends confirmedDangerous", () => {
  let checked = 0;
  for (const file of views) {
    const text = readFileSync(new URL(`../src/renderer/views/${file}`, import.meta.url), "utf8");
    // run("id", params) / onAction("id", params) with a literal id.
    for (const m of text.matchAll(/\b(?:run|onAction)\(\s*"([a-z_]+\.[a-z_.]+)"\s*(?:,([^\n]*))?/g)) {
      const [, id, rest = ""] = m;
      if (!needsConfirmation.has(id)) continue;
      checked += 1;
      assert.match(rest, /\bconfirmed\(|confirmedDangerous:\s*true/, `${file}: ${id} is sent without confirmation`);
    }
  }
  assert.ok(checked >= 2, `found ${checked} confirmed calls (GhostOS forget and adapter.disable at least)`);
});

test("GhostOS: the confirmed() helper adds the flag and keeps the target", () => {
  assert.deepEqual(confirmed({ kind: "entity", id: "ent_12345678" }), { kind: "entity", id: "ent_12345678", confirmedDangerous: true });
  assert.ok(needsConfirmation.has("ghost_os.forget"));
  assert.ok(needsConfirmation.has("ghost_os.adapter.disable"));
});
