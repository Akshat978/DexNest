// UI-audit screenshots: the harness (vite.config.mjs, port 5199) in Chromium.
// node docs/ui-audit/harness/shoot.mjs [filter]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
// SHOTS_DIR overrides where they go (e.g. screenshots/after-fixes).
const out = process.env.SHOTS_DIR ?? join(here, "..", "screenshots");
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:5199/docs/ui-audit/harness/index.html";
const filter = process.argv[2] ?? "";

const sizes = [[1280, 800], [1920, 1080]];
const newViews = ["object", "ghost", "rpg", "skills"];
const states = ["normal", "empty", "loading", "error", "large"];
// After load: open a detail where the view has one, so "normal" shows it too.
const detail = {
  object: async (p) => { await p.getByRole("button", { name: /Workshop printer/ }).first().click(); },
  ghost: async (p) => { await p.locator(".ghost-item").first().click(); },
  skills: async (p) => { await p.locator("[role=button]").first().click(); }
};
const shots = [];
for (const v of newViews) for (const s of states) shots.push({ v, s, name: `${v}-${s}` });
for (const v of ["object", "ghost", "skills"]) shots.push({ v, s: "normal", name: `${v}-detail`, then: detail[v] });
// Autopilot is also tried: in the browser preview it blanks the whole renderer (see REPORT.md).
for (const v of ["command", "dev", "calendar", "autopilot"]) shots.push({ v, s: "normal", name: `existing-${v}` });
// The sidebar, scrolled to each new module's entry while its view is open.
for (const v of [...newViews, "calendar"]) shots.push({ v, s: "normal", name: `sidebar-${v}`, sidebar: true });

// Extra views at 1280x800 only: other tabs, forms, and keyboard focus.
const tab = (name) => async (p) => { await p.getByRole("tab", { name }).click(); };
const focusTab = async (p) => { await p.locator('[role=tab][aria-selected=true]').first().focus(); await p.keyboard.press("ArrowRight"); };
const extra = [
  ["object", "object-tab-maintenance", async (p) => { await detail.object(p); await p.waitForTimeout(500); await tab("Maintenance")(p); }],
  ["object", "object-tab-parts", async (p) => { await detail.object(p); await p.waitForTimeout(500); await tab("Parts")(p); }],
  ["object", "object-tab-settings", async (p) => { await detail.object(p); await p.waitForTimeout(500); await tab("Settings")(p); }],
  ["object", "object-tab-files", async (p) => { await detail.object(p); await p.waitForTimeout(500); await tab("Files")(p); }],
  ["object", "object-tab-purchase", async (p) => { await detail.object(p); await p.waitForTimeout(500); await tab("Purchase")(p); }],
  ["object", "object-form-add", async (p) => { await p.getByRole("button", { name: "Add object" }).click(); }],
  ["object", "object-confirm-delete", async (p) => { await detail.object(p); await p.waitForTimeout(500); await p.getByRole("button", { name: "Delete…" }).click(); }],
  ["object", "object-focus", async (p) => { await detail.object(p); await p.waitForTimeout(500); await focusTab(p); }],
  ["ghost", "ghost-tab-add", tab("Add")],
  ["ghost", "ghost-tab-sources", tab("Sources")],
  ["ghost", "ghost-focus", focusTab],
  ["rpg", "rpg-tab-quests", tab("Quests")],
  ["rpg", "rpg-tab-achievements", tab("Achievements")],
  ["rpg", "rpg-tab-history", tab("History")],
  ["rpg", "rpg-tab-rules", tab("Rules")],
  ["rpg", "rpg-focus", focusTab],
  ["skills", "skills-settings", async (p) => { const d = p.locator("details summary").first(); await d.click(); await d.scrollIntoViewIfNeeded(); }],
  ["skills", "skills-focus", async (p) => { await p.locator("[role=button]").first().focus(); }]
];
for (const [v, name, then] of extra) shots.push({ v, s: "normal", name, then, only1280: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const log = [];
for (const shot of shots.filter((x) => x.name.includes(filter))) {
  for (const [w, h] of shot.only1280 ? [sizes[0]] : sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: "dark" });
    page.on("pageerror", (e) => log.push(`${shot.name} ${w}: pageerror ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") log.push(`${shot.name} ${w}: console ${m.text().slice(0, 200)}`); });
    await page.goto(`${base}?v=${shot.v}&s=${shot.s}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    if (shot.then) {
      try { await shot.then(page); await page.waitForTimeout(800); } catch (e) { log.push(`${shot.name} ${w}: could not open detail: ${e.message.split("\n")[0]}`); }
    }
    const file = join(out, `${shot.name}-${w}x${h}.jpg`);
    if (shot.sidebar) {
      await page.locator(`[data-testid=nav-${shot.v}]`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: file, type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: 250, height: h } });
    } else await page.screenshot({ path: file, type: "jpeg", quality: 82 });
    log.push(`shot ${file.split("/").pop()}`);
    await page.close();
  }
}
await browser.close();
console.log(log.join("\n"));
