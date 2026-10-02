// Integration QA F2: Tools' OCR device. GPU is opt-in (AGENTS.md), so with
// nothing saved OCR runs on the CPU; a device the user saved is never changed.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DEFAULT_OCR_DEVICE, resolveOcrDevice } from "../src/main/ocrDevice.ts";

// How main.ts reads Tools settings: defaults, then the saved file over them.
const effective = (savedFile: Record<string, unknown>) => resolveOcrDevice(undefined, { ocrDevice: DEFAULT_OCR_DEVICE, ...savedFile }.ocrDevice);

test("no saved setting -> cpu", () => {
  assert.equal(DEFAULT_OCR_DEVICE, "cpu");
  assert.equal(effective({}), "cpu");
  assert.equal(resolveOcrDevice(undefined, undefined), "cpu");
  assert.equal(resolveOcrDevice(undefined, "nonsense"), "cpu", "an unreadable value is not a choice");
});

test("saved gpu -> stays gpu (and saved cpu stays cpu)", () => {
  assert.equal(effective({ ocrDevice: "gpu" }), "gpu");
  assert.equal(effective({ ocrDevice: "cpu" }), "cpu");
  assert.equal(resolveOcrDevice(undefined, "gpu"), "gpu");
});

test("a device picked for one job wins over the saved one, for that job only", () => {
  assert.equal(resolveOcrDevice("cpu", "gpu"), "cpu");
  assert.equal(resolveOcrDevice("gpu", "cpu"), "gpu");
});

test("nothing defaults or forces the OCR device to gpu any more", () => {
  const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /ocrDevice:\s*"gpu"(?!\s*\|)/, "no default or save writes gpu");
  assert.doesNotMatch(main, /ocrDevice \?\? "gpu"/);
  assert.match(main, /ocrDevice: DEFAULT_OCR_DEVICE/);
  for (const file of ["views/ToolsView.tsx", "main.tsx", "lib/bridge.ts"]) {
    const text = readFileSync(new URL(`../src/renderer/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /ocrDevice \?\? "gpu"|ocrDevice: "gpu"(?!\s*\|)/, file);
  }
});
