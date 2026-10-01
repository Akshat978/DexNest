// The view error boundary, rendered. Built with the app's own Vite (SSR, React
// external). Server rendering does not run error boundaries, so the test drives
// the class directly: the error is turned into state, and that state renders
// the fallback.

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
let Boundary;

before(async () => {
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "boundary-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: join(desktop, "src/renderer/components/ViewErrorBoundary.tsx"),
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"], output: { format: "es", entryFileNames: "boundary.mjs" } }
    }
  });
  ({ ViewErrorBoundary: Boundary } = await import(pathToFileURL(join(scratch, "boundary.mjs")).href));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

test("without an error it renders the view untouched", () => {
  const html = renderToStaticMarkup(createElement(Boundary, { viewLabel: "ObjectOS" }, createElement("p", null, "the view")));
  assert.equal(html, "<p>the view</p>");
});

test("an error becomes state, and that state renders an alert with the view's name, the message and two ways out", () => {
  const state = Boundary.getDerivedStateFromError(new Error("api(...).autopilotQueue is not a function"));
  assert.equal(state.error.message, "api(...).autopilotQueue is not a function");
  assert.equal(Boundary.getDerivedStateFromError("plain text").error.message, "plain text");

  let left = 0;
  const b = new Boundary({ viewLabel: "Autopilot", onLeave: () => { left += 1; }, children: null });
  b.state = state;
  const html = renderToStaticMarkup(b.render());
  assert.match(html, /<section class="view-error" role="alert" aria-labelledby="view-error-title">/);
  assert.match(html, /Autopilot stopped working/);
  assert.match(html, /The rest of DexNest is fine/);
  assert.match(html, /autopilotQueue is not a function/);
  assert.match(html, />Try again<\/button>/);
  assert.match(html, />Go to Command<\/button>/);

  // "Try again" clears the error.
  let next = null;
  b.setState = (s) => { next = s; };
  b.retry();
  assert.deepEqual(next, { error: null });

  // On Command itself there is nowhere to go back to.
  const home = new Boundary({ viewLabel: "Command", children: null });
  home.state = state;
  assert.doesNotMatch(renderToStaticMarkup(home.render()), /Go to Command/);
});
