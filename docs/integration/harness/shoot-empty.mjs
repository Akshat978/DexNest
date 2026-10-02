// Real Electron, fresh data root, nothing seeded: every view at both sizes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, size, open, shot, VIEWS } from "./electron.mjs";

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const { app, win, consoleErrors } = await launch();
const log = [];
for (const [w, h] of [[1280, 800], [1920, 1080]]) {
  await size(app, win, w, h);
  for (const [id] of VIEWS) {
    const before = consoleErrors.length;
    await open(win, id);
    await shot(win, join(out, `${id}-empty-${w}x${h}.jpg`));
    log.push({ view: id, size: `${w}x${h}`, state: "empty", consoleErrors: consoleErrors.slice(before) });
  }
}
writeFileSync(join(out, "empty-console.json"), JSON.stringify(log, null, 1));
await app.close();
console.log("done", log.reduce((n, l) => n + l.consoleErrors.length, 0), "console errors");
