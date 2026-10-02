// Launch the real DexNest Electron app for screenshots (Linux, under xvfb).
// Fresh temp data root and profile every time; never a real data root.
// Needs: `pnpm --filter @dexnest/desktop build`, the renderer dev server on
// 127.0.0.1:5173, and better-sqlite3 built for Electron (see README.md).
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/opt/node22/lib/node_modules/");
const { _electron: electron } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "../../../apps/desktop");

export const VIEWS = [
  ["command", "Command"], ["search", "Search / Ask"], ["clipboard", "Clipboard"], ["drop", "Drop"], ["tools", "Tools"], ["vault", "Vault"],
  ["journal", "Journal"], ["calendar", "Calendar"], ["timetable", "Timetable"], ["utilities", "Utilities"], ["news", "News"], ["finder", "Finder"],
  ["capture", "Capture"], ["finance", "Finance"], ["dev", "Projects"], ["autopilot", "Autopilot"], ["skills", "Skills"], ["rpg", "Reality RPG"],
  ["ghost", "GhostOS"], ["object", "ObjectOS"], ["deck", "Deck"], ["heatmap", "Heatmap"], ["devices", "External Devices"], ["backup", "Backup"],
  ["health", "App Health"], ["settings", "Settings"], ["audit", "Audit"]
];

export async function launch({ dataRoot } = {}) {
  const root = dataRoot ?? mkdtempSync(join(tmpdir(), "dexnest-int-data-"));
  const profile = mkdtempSync(join(tmpdir(), "dexnest-int-profile-"));
  const app = await electron.launch({
    executablePath: join(desktop, "node_modules/electron/dist/electron"),
    args: [join(desktop, "dist/main/main.cjs"), "--no-sandbox", `--user-data-dir=${profile}`],
    cwd: desktop,
    env: { ...process.env, DEXNEST_DATA_ROOT: root, VITE_DEV_SERVER_URL: "http://127.0.0.1:5173" },
    timeout: 90000
  });
  const win = await app.firstWindow({ timeout: 90000 });
  const consoleErrors = [];
  win.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  win.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(5000);
  return { app, win, dataRoot: root, consoleErrors };
}

// Electron's BrowserWindow size: set the content size so screenshots are exactly WxH.
export async function size(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); }, [w, h]);
  await win.setViewportSize({ width: w, height: h });
  await win.waitForTimeout(400);
}

export async function open(win, view) {
  // The sidebar button, by its exact label. Hidden views (settings, audit) go through the shell's own navigation.
  const label = VIEWS.find(([id]) => id === view)?.[1];
  const button = win.locator("nav").first().getByRole("button", { name: label, exact: true });
  if (await button.count()) {
    await button.first().click();
  } else {
    await win.evaluate((v) => { sessionStorage.setItem("dexnest:lastActiveView", v); }, view);
    await win.reload();
    await win.waitForTimeout(4000);
  }
  await win.waitForTimeout(1500);
}

export async function shot(win, path) {
  await win.screenshot({ path, type: "jpeg", quality: 78 });
}
