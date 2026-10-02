// Real Electron, on a seeded data root: click through each new module's main
// flows. Every step is screenshotted and logged (passed / failed + what the
// screen said), with console errors per step.
// node shoot-flows.mjs <outDir> <seededDataRoot> <workDir>   (the folder make-repos.sh made)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, size, open, shot } from "./electron.mjs";

const [out, dataRoot, workDir] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { app, win, consoleErrors } = await launch({ dataRoot });
await size(app, win, 1280, 800);
const steps = [];
let n = 0;
async function step(name, fn) {
  const before = consoleErrors.length;
  const file = `${String(++n).padStart(2, "0")}-${name}-1280x800.jpg`;
  let ok = true, error = null;
  try { await fn(); } catch (e) { ok = false; error = e.message.split("\n")[0]; }
  await win.waitForTimeout(900);
  // What the screen says: alerts, statuses and toasts.
  const said = await win.evaluate(() => [...document.querySelectorAll('[role=alert],[role=status],[role=alertdialog],.kit-toast')].map((e) => e.textContent.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 4));
  await shot(win, join(out, file));
  steps.push({ step: file, ok, error, said, consoleErrors: consoleErrors.slice(before) });
  console.log(ok ? "ok  " : "FAIL", file, error ?? "", said.length ? `| ${said.join(" | ").slice(0, 160)}` : "");
}
const btn = (name, exact = true) => win.getByRole("button", { name, exact });
const tab = (name) => win.getByRole("tab", { name, exact: true });
const main = () => win.locator("main");

// --- Projects ---------------------------------------------------------------------
await open(win, "dev");
await step("projects-home", async () => {});
await step("projects-wizard-open", async () => { await main().getByRole("button", { name: "Add project" }).first().click(); });
await step("projects-wizard-paste", async () => { await win.locator("#projects-wizard-path").fill(`${workDir}/later/notes-app`); await btn("Inspect").click(); await win.waitForTimeout(1500); });
await step("projects-wizard-saved", async () => { await btn("Save project").click(); await win.waitForTimeout(1500); });
await step("projects-detail-shop", async () => { await win.locator(".projects-card__name", { hasText: "Shop web" }).first().click(); await win.waitForTimeout(2000); });
for (const t of ["Branches", "Changes", "History", "Run", "Links", "Settings"]) await step(`projects-tab-${t.toLowerCase()}`, async () => { await win.getByRole("tab", { name: new RegExp(`^${t}`) }).click(); await win.waitForTimeout(800); });
await step("projects-edit-description", async () => { await win.getByLabel("Description", { exact: true }).fill("Storefront for the pottery studio"); await btn("Save changes").click(); await win.waitForTimeout(1200); });
await step("projects-op-dialog-push-preview", async () => { await win.getByRole("tab", { name: /^Overview/ }).click(); await btn("Push").first().click(); await win.waitForTimeout(1500); });
await step("projects-op-dialog-push-result", async () => { await win.locator(".kit-dialog").getByRole("button", { name: /^Push/ }).last().click(); await win.waitForTimeout(2500); });
await step("projects-op-dialog-closed", async () => { await win.locator(".kit-dialog").getByRole("button", { name: "Close" }).click(); });
await step("projects-archive", async () => { await win.getByRole("tab", { name: /^Settings/ }).click(); await btn("Archive project").click(); await win.waitForTimeout(1200); });
await step("projects-archived-filter", async () => { await open(win, "dev"); await win.locator("label.projects-filter", { hasText: "Status" }).locator("select").selectOption("archived"); await win.waitForTimeout(800); });
await step("projects-remove-confirm", async () => { await win.locator(".projects-card__name", { hasText: "Shop web" }).first().click(); await win.waitForTimeout(1200); await win.getByRole("tab", { name: /^Settings/ }).click(); await btn("Remove from DexNest…").click(); });
await step("projects-removed", async () => { await btn("Yes, continue").click(); await win.waitForTimeout(1200); });

// --- GhostOS ------------------------------------------------------------------------
await open(win, "ghost");
await step("ghost-timeline", async () => {});
await step("ghost-add-form", async () => { await tab("Add").click(); });
await step("ghost-add-saved", async () => {
  await win.getByLabel("Type").selectOption({ label: "Person" });
  await win.getByLabel("Title").fill("Priya Natarajan");
  await win.getByLabel("Notes").fill("Met at the ceramics course.");
  await btn("Save").click(); await win.waitForTimeout(1200);
});
await step("ghost-detail", async () => { await tab("Timeline").click(); await win.waitForTimeout(600); await main().getByRole("button", { name: /^Maya Chen/ }).first().click(); await win.waitForTimeout(1000); });
await step("ghost-forget-confirm", async () => { await btn("Forget Maya Chen").click(); });
await step("ghost-forget-done", async () => { await win.getByRole("alertdialog").getByRole("button", { name: "Forget", exact: true }).click(); await win.waitForTimeout(1500); });
await step("ghost-sources-on", async () => { await tab("Sources").click(); await btn("Turn on").click(); await win.waitForTimeout(2500); });
await step("ghost-sources-off-confirm", async () => { await btn("Turn off and remove what it added").click(); });
await step("ghost-sources-off-done", async () => { await win.getByRole("alertdialog").getByRole("button", { name: "Turn off", exact: true }).click(); await win.waitForTimeout(2000); });

// --- ObjectOS -----------------------------------------------------------------------
await open(win, "object");
await step("object-home", async () => {});
await step("object-add-form", async () => { await main().getByRole("button", { name: "Add object" }).first().click(); });
await step("object-add-saved", async () => {
  const form = win.locator("form", { has: win.getByRole("heading", { name: "Add an object" }) });
  await form.getByLabel("Name (required)").fill("Kitchen scale");
  await form.getByLabel("Make").fill("Salter"); await form.getByLabel("Location").fill("Kitchen");
  await form.getByRole("button", { name: "Add object" }).click(); await win.waitForTimeout(1200);
});
await step("object-detail", async () => { await main().getByRole("button", { name: /^Workshop 3D printer/ }).first().click(); await win.waitForTimeout(1200); });
for (const t of ["Maintenance", "Parts", "Modifications", "Settings", "Measurements", "Files", "Purchase", "History"]) await step(`object-tab-${t.toLowerCase()}`, async () => { await tab(t).click(); await win.waitForTimeout(700); });
await step("object-edit-form", async () => { await tab("Overview").click(); await btn("Edit").click(); });
await step("object-edit-saved", async () => { await win.locator("form", { has: win.getByRole("heading", { name: "Edit object" }) }).getByLabel("Location").fill("Workshop, shelf 2"); await btn("Save changes").click(); await win.waitForTimeout(1000); });
await step("object-delete-confirm", async () => { await main().getByRole("button", { name: /^Kitchen scale/ }).first().click(); await win.waitForTimeout(1000); await btn("Delete…").click(); });
await step("object-deleted", async () => { await win.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click(); await win.waitForTimeout(1500); });

// --- Skill Constellation --------------------------------------------------------------
await open(win, "skills");
await step("skills-graph", async () => { await win.waitForTimeout(1000); });
await step("skills-star-detail", async () => { await win.getByRole("button", { name: /^TypeScript,/ }).click(); await win.waitForTimeout(1200); });
await step("skills-settings", async () => { await win.locator("summary", { hasText: "Settings" }).click(); await win.locator("summary", { hasText: "Settings" }).scrollIntoViewIfNeeded(); });

// --- Reality RPG -----------------------------------------------------------------------
await open(win, "rpg");
await step("rpg-character", async () => {});
await step("rpg-quests", async () => { await tab("Quests").click(); });
await step("rpg-quest-created", async () => {
  const form = win.getByRole("form", { name: "New quest" });
  await form.getByLabel("Title").fill("Back up twice this month");
  await form.getByLabel("Rules that count").getByRole("checkbox").first().check().catch(async () => { await form.getByRole("checkbox").first().check(); });
  await form.getByLabel("Target").fill("2");
  await btn("Create quest").click(); await win.waitForTimeout(1200);
});
await step("rpg-quest-abandon-confirm", async () => { await win.getByRole("button", { name: /^Abandon Keep the workshop running/ }).click(); });
await step("rpg-quest-abandoned", async () => { await win.getByRole("alertdialog").getByRole("button", { name: "Abandon", exact: true }).click(); await win.waitForTimeout(1200); });
await step("rpg-achievements", async () => { await tab("Achievements").click(); });
await step("rpg-history", async () => { await tab("History").click(); });
await step("rpg-rules", async () => { await tab("Rules").click(); });
await step("rpg-rule-delete-confirm", async () => { await btn("Delete Memory kept in GhostOS").click(); });
await step("rpg-rule-deleted", async () => { await win.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click(); await win.waitForTimeout(1200); });

writeFileSync(join(out, "flows.json"), JSON.stringify(steps, null, 1));
await app.close();
console.log("steps", steps.length, "failed", steps.filter((s) => !s.ok).length, "console errors", steps.reduce((a, s) => a + s.consoleErrors.length, 0));
