// Stub harness (Vite renderer, stubbed bridge, Chromium): loading and error for
// every view, plus the "large" (busy) scenario for the four modules with fixtures.
// The shell boots normally; the view's own reads then hang or fail.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { VIEWS } from "./electron.mjs";

const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:5199/docs/integration/harness/index.html";
const b = await chromium.launch();
const errors = [];
async function capture(view, label, mode, w, h, file, scenario = "normal") {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on("pageerror", (e) => errors.push(`${file}: ${e.message}`));
  if (mode) {
    await p.goto(`${base}?v=command&s=${scenario}`);
    await p.waitForTimeout(2500);
    await p.evaluate((m) => { window.__harnessMode = m; }, mode);
    const button = p.locator("nav").first().getByRole("button", { name: label, exact: true });
    if (await button.count()) await button.first().click();
    else { await p.evaluate((v) => sessionStorage.setItem("dexnest:lastActiveView", v), view); await p.reload(); await p.waitForTimeout(500); await p.evaluate((m) => { window.__harnessMode = m; }, mode); }
  } else {
    await p.goto(`${base}?v=${view}&s=${scenario}`);
  }
  await p.waitForTimeout(2000);
  await p.screenshot({ path: join(out, file), type: "jpeg", quality: 78 });
  await p.close();
}
for (const [w, h] of [[1280, 800], [1920, 1080]]) {
  for (const [id, label] of VIEWS) for (const mode of ["loading", "error"]) await capture(id, label, mode, w, h, `${id}-${mode}-${w}x${h}.jpg`);
  for (const id of ["object", "ghost", "rpg", "skills"]) await capture(id, null, null, w, h, `${id}-busy-${w}x${h}.jpg`, "large");
}
await b.close();
console.log("page errors:", errors.length, "\n" + [...new Set(errors.map((e) => e.replace(/^[^:]+: /, "")))].slice(0, 10).join("\n"));
