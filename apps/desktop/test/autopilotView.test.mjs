// Autopilot Control Center, presentation.
//
// The real AutopilotView.tsx is bundled with the app's own Vite (SSR build,
// React external). Effects do not run under server rendering, so the render
// is the view before its first load; the helpers are checked directly.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const desktop = fileURLToPath(new URL("..", import.meta.url));
let scratch = "";
let mod;

before(async () => {
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "autopilot-view-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: join(desktop, "src/renderer/views/AutopilotView.tsx"),
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"], output: { format: "es", entryFileNames: "view.mjs" } }
    }
  });
  mod = await import(pathToFileURL(join(scratch, "view.mjs")).href);
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

test("a run's badge colour follows what the operator should do about it", () => {
  const { runStateTone } = mod;
  assert.equal(runStateTone("COMPLETED", true), "warning", "attention wins over any state");
  for (const state of ["RUNNING", "PAUSE_REQUESTED", "RECONCILING"]) assert.equal(runStateTone(state, false), "accent");
  assert.equal(runStateTone("COMPLETED", false), "success");
  assert.equal(runStateTone("FAILED", false), "error");
  assert.equal(runStateTone("NEEDS_REVIEW", false), "warning");
  assert.equal(runStateTone("STOPPED", false), "neutral");
});

test("the dashboard numbers come from the categories the runtime assigns", () => {
  const runs = ["ACTIVE", "NEEDS ATTENTION", "NEEDS ATTENTION", "COMPLETED", "STOPPED / FAILED"].map(category => ({ category }));
  assert.deepEqual(mod.runCounts(runs), { total: 5, active: 1, attention: 2, completed: 1 });
  assert.deepEqual(mod.runCounts([]), { total: 0, active: 0, attention: 0, completed: 0 });
});

test("the kit header in the Autopilot accent, kit tabs, and no stat tiles before any runs", () => {
  const html = renderToStaticMarkup(createElement(mod.AutopilotView));
  assert.match(html, /<section class="view-stack autopilot" style="--kit-accent:var\(--accent-autopilot\)/);
  assert.match(html, /id="autopilot-title"[^>]*>Autopilot Control Center</);
  assert.match(html, /<nav class="autopilot-areas kit-tabs" aria-label="Autopilot areas">/);
  assert.match(html, /<button type="button" class="kit-tab kit-tab--on" aria-pressed="true">Runs<\/button>/);
  assert.match(html, /<button type="button" class="kit-tab" aria-pressed="false" disabled="">Selected Run<\/button>/);
  assert.doesNotMatch(html, /kit-stat/);
  assert.match(html, /No Autopilot runs yet/);
});
