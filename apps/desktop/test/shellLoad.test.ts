// Integration QA F4 (and F14): when the shell's shared load fails, the ten
// views that render from it say so instead of showing defaults as data; and a
// failing boot step no longer leaves the splash up for good.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SHELL_DATA_VIEWS, shellLoadOverlay } from "../src/renderer/lib/shellLoad.ts";

// Source files are checked out with CRLF on Windows; the patterns below are written for LF.
const readSource = (path: Parameters<typeof readFileSync>[0]) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const main = readSource(new URL("../src/renderer/main.tsx", import.meta.url));

test("the ten shell-data views show the error card when the shared load failed, and only then", () => {
  assert.deepEqual([...SHELL_DATA_VIEWS].sort(), ["calendar", "clipboard", "command", "deck", "drop", "news", "settings", "timetable", "tools", "utilities"]);
  for (const view of SHELL_DATA_VIEWS) {
    assert.equal(shellLoadOverlay(view, "error"), "error", view);
    assert.equal(shellLoadOverlay(view, "ready"), null, view);
    assert.equal(shellLoadOverlay(view, "loading"), null, `${view}: the boot splash covers the first load`);
  }
  for (const view of ["finance", "vault", "dev", "ghost", "object", "rpg", "skills", "autopilot"]) {
    assert.equal(shellLoadOverlay(view, "error"), null, `${view} has its own loader and error state`);
  }
});

test("refreshShellData records ready after the shared state and error when it fails; the card retries it", () => {
  assert.match(main, /setVoiceWorkflowSettings\(nextVoiceWorkflowSettings\);\n\s*setShellLoad\("ready"\);/);
  assert.match(main, /catch \{[\s\S]{0,400}?setShellLoad\("error"\);\n\s*\} finally \{/);
  assert.match(main, /shellLoadOverlay\(activeView, shellLoad\) === "error" && \([\s\S]{0,300}?<ErrorState[\s\S]{0,300}?onRetry=\{\(\) => void refreshShellData\(\)\}/);
});

test("boot: a failing warm-up step still reveals the app", () => {
  const boot = main.slice(main.indexOf("void runBootWarmup()"), main.indexOf("void runBootWarmup()") + 500);
  assert.match(boot, /\.catch\(\(\) => undefined\)/);
  assert.match(boot, /\.finally\(\(\) => \{[\s\S]*setInitialLoadDone\(true\);[\s\S]*setBootReady\(true\);/);
});
