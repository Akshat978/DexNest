// App-shell navigation registry.
//
// The sidebar is generated from SIDEBAR_VIEWS, top to bottom, inside a scrolling
// rail. That makes list *order* a product surface rather than bookkeeping: an
// entry appended to the end is present in the DOM but sits below the fold on a
// normal window, which is exactly how Autopilot came to be invisible despite
// being fully implemented and routed.
//
// These assertions are about reachability, not cosmetics.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const metaSource = readFileSync(new URL("../src/renderer/lib/moduleMeta.ts", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/renderer/main.tsx", import.meta.url), "utf8");
const autopilotSource = readFileSync(new URL("../src/renderer/views/AutopilotView.tsx", import.meta.url), "utf8");

/** The registry, read from source so the test cannot drift from the shell. */
function sidebarViews() {
  const start = metaSource.indexOf("export const SIDEBAR_VIEWS");
  assert.ok(start > -1, "SIDEBAR_VIEWS is the sidebar registry");
  const body = metaSource.slice(start, metaSource.indexOf("];", start));
  return [...body.matchAll(/\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map(([, id, label]) => ({ id, label }));
}

function hiddenViews() {
  const match = /export const SIDEBAR_HIDDEN_VIEWS: ViewId\[\] = \[([^\]]*)\]/.exec(metaSource);
  assert.ok(match, "SIDEBAR_HIDDEN_VIEWS exists");
  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, id]) => id);
}

test("Autopilot is a first-class sidebar module", () => {
  const views = sidebarViews();
  const autopilot = views.find((view) => view.id === "autopilot");

  assert.ok(autopilot, "autopilot is registered in the sidebar");
  assert.equal(autopilot.label, "Autopilot");
  assert.equal(hiddenViews().includes("autopilot"), false, "it is not filtered out of the rail");

  // Reachable by clicking, with no flag, query string or debug route.
  assert.match(shellSource, /views\.filter\(\(view\) => !SIDEBAR_HIDDEN_VIEWS\.includes\(view\.id\)\)/);
  assert.equal(/autopilot[^\n]*(featureFlag|debugOnly|devOnly)/i.test(shellSource), false, "no feature gate");
});

test("Autopilot sits with the developer tooling, above the fold", () => {
  const views = sidebarViews();
  const index = (id) => views.findIndex((view) => view.id === id);

  assert.equal(index("autopilot"), index("dev") + 1, "it follows Dev");
  assert.ok(index("autopilot") < index("settings"), "and comes before Settings");
  assert.ok(index("autopilot") < index("health"), "and before App Health");
  // The concrete regression: it must not be stranded at the end of the rail.
  assert.notEqual(index("autopilot"), views.length - 1, "never last in the list");
  assert.ok(index("autopilot") <= 16, `expected an above-the-fold position, got ${index("autopilot")}`);
});

test("every sidebar module has an icon and a route", () => {
  for (const view of sidebarViews()) {
    assert.match(metaSource, new RegExp(`\\n\\s*${view.id}:\\s*\\{\\s*icon:`), `${view.id} has an icon`);
  }
  // The rail falls back to a generic icon, so assert Autopilot has its own.
  assert.match(metaSource, /autopilot:\s*\{\s*icon:\s*Bot/);
  assert.match(shellSource, /activeView === "autopilot" && <AutopilotView \/>/, "autopilot renders the Control Center");
  assert.match(shellSource, /import \{ AutopilotView \} from "\.\/views\/AutopilotView"/);
});

test("there is exactly one Autopilot Control Center", () => {
  assert.match(autopilotSource, /title="Autopilot Control Center"/);
  // Every area stays on the one canonical page rather than becoming a second
  // Autopilot screen somewhere in the shell.
  assert.match(autopilotSource, /\["New Run", "Queue", "Runs", "Selected Run", "Notifications"\]/);
  // No second, simplified copy of the page anywhere in the renderer.
  const copies = [...shellSource.matchAll(/Autopilot Control Center/g)].length;
  assert.equal(copies, 0, "the shell does not re-implement the Control Center");
  assert.equal(/debug surface/i.test(autopilotSource), false, "it is no longer described as a debug surface");
  void desktop;
});
