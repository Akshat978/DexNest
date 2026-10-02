// Real Electron: seed synthetic data, then every view at both sizes.
// node shoot-normal.mjs <outDir> <codeDir>   (prints the data root for reuse)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, size, open, shot, VIEWS } from "./electron.mjs";
import { seed } from "./seed.mjs";

const [out, codeDir] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { app, win, dataRoot, consoleErrors } = await launch();
const seeded = await seed(win, { codeDir });
console.log("seeded", JSON.stringify(seeded.summary), "\n" + seeded.log.join("\n"));
await win.reload();
await win.waitForTimeout(5000);
const log = [];
for (const [w, h] of [[1280, 800], [1920, 1080]]) {
  await size(app, win, w, h);
  for (const [id] of VIEWS) {
    const before = consoleErrors.length;
    await open(win, id);
    await win.waitForTimeout(id === "dev" || id === "skills" ? 2500 : 0);
    await shot(win, join(out, `${id}-normal-${w}x${h}.jpg`));
    log.push({ view: id, size: `${w}x${h}`, state: "normal", consoleErrors: consoleErrors.slice(before) });
  }
}
writeFileSync(join(out, "normal-console.json"), JSON.stringify({ dataRoot, seeded, log }, null, 1));
await app.close();
console.log("dataRoot", dataRoot, "console errors", log.reduce((n, l) => n + l.consoleErrors.length, 0));
