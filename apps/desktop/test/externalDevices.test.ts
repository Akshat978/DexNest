// Integration QA F13: a Govee provider the user hasn't turned on is "off",
// not an error (red banner + "Error" chip on every fresh install).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { providerView } from "../src/renderer/views/externalDevicesModel.ts";

test("provider states: ready is connected, disabled is off, the rest are problems", () => {
  assert.equal(providerView("ready"), "connected");
  assert.equal(providerView("disabled"), "off");
  for (const s of ["missing_api_key", "locked", "error", "offline"]) assert.equal(providerView(s), "problem", s);
});

test("the red banner and the Error chip are for problems only; off is shown neutrally", () => {
  const view = readFileSync(new URL("../src/renderer/views/ExternalDevicesView.tsx", import.meta.url), "utf8");
  assert.match(view, /\{provider === "problem" && \(\s*<div className="[^"]*border-\[#EF4444\]/);
  assert.match(view, /\{provider === "off" && \(\s*<div className="[^"]*border-\[var\(--border\)\][^"]*">\s*<span className="text-sm text-\[var\(--text-muted\)\]">/);
  assert.equal((view.match(/provider === "off" \? "offline" : "error"/g) ?? []).length, 2, "header chip and provider card");
  assert.doesNotMatch(view, /\{!connected && \(/);
});
