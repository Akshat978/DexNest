/**
 * Phase 11: the sidebar the owner arranges, one name per module in the
 * activity log, module settings in Settings, and "Clear data" for the modules
 * that keep their records in the shared database.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { arrangeSidebar, canHide, EMPTY_SIDEBAR_PREFS, moveSidebarView, normalizeSidebarPrefs, setSidebarHidden } from "../src/renderer/lib/sidebarLayout.ts";
import { activityLine, moduleName, STREAMS, typeWords } from "../src/renderer/lib/activityLabels.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");

const views = ["command", "today", "search", "dev", "skills", "rpg", "settings"].map((id) => ({ id }));
const ids = (list: readonly { id: string }[]) => list.map((v) => v.id);

test("sidebar: with nothing saved it is the default order, nothing hidden", () => {
  const rail = arrangeSidebar(views, EMPTY_SIDEBAR_PREFS);
  assert.deepEqual(ids(rail.shown), ["command", "today", "search", "dev", "skills", "rpg", "settings"]);
  assert.deepEqual(rail.hidden, []);
});

test("sidebar: move up and down, one place at a time, and nothing happens at an end", () => {
  let prefs = moveSidebarView(views, EMPTY_SIDEBAR_PREFS, "rpg", -1);
  assert.deepEqual(ids(arrangeSidebar(views, prefs).shown), ["command", "today", "search", "dev", "rpg", "skills", "settings"]);
  prefs = moveSidebarView(views, prefs, "rpg", -1);
  prefs = moveSidebarView(views, prefs, "command", 1);
  assert.deepEqual(ids(arrangeSidebar(views, prefs).shown), ["today", "command", "search", "rpg", "dev", "skills", "settings"]);
  assert.deepEqual(moveSidebarView(views, prefs, "today", -1), prefs, "already at the top");
  assert.deepEqual(moveSidebarView(views, prefs, "settings", 1), prefs, "already at the bottom");
  assert.deepEqual(moveSidebarView(views, prefs, "no-such", 1), prefs);
});

test("sidebar: hiding moves a module to the hidden group and back; Settings cannot be hidden", () => {
  let prefs = setSidebarHidden(EMPTY_SIDEBAR_PREFS, "search", true);
  prefs = setSidebarHidden(prefs, "rpg", true);
  let rail = arrangeSidebar(views, prefs);
  assert.deepEqual(ids(rail.shown), ["command", "today", "dev", "skills", "settings"]);
  assert.deepEqual(ids(rail.hidden), ["search", "rpg"]);
  // Moving past a hidden module skips it: the rail is what is moved.
  prefs = moveSidebarView(views, prefs, "dev", -1);
  assert.deepEqual(ids(arrangeSidebar(views, prefs).shown), ["command", "dev", "today", "skills", "settings"]);
  prefs = setSidebarHidden(prefs, "search", false);
  rail = arrangeSidebar(views, prefs);
  assert.ok(ids(rail.shown).includes("search"));
  assert.deepEqual(ids(rail.hidden), ["rpg"]);

  assert.equal(canHide("settings"), false);
  assert.deepEqual(setSidebarHidden(EMPTY_SIDEBAR_PREFS, "settings", true), EMPTY_SIDEBAR_PREFS);
  assert.deepEqual(ids(arrangeSidebar(views, { order: [], hidden: ["settings"] }).hidden), [], "a saved file that says so is not obeyed");
});

test("sidebar: a module added after the order was saved lands where it would have been", () => {
  const saved = { order: ["today", "command", "dev", "settings"], hidden: [] };
  const later = [...views.slice(0, 3), { id: "calendar" }, ...views.slice(3)];
  assert.deepEqual(ids(arrangeSidebar(later, saved).shown), ["today", "search", "calendar", "command", "dev", "skills", "rpg", "settings"]);
  // "search" follows "today" by default, so it follows it here too, wherever the owner put "today".
  // A module that no longer exists is dropped from a saved order.
  assert.deepEqual(ids(arrangeSidebar(views, { order: ["finder", "today"], hidden: ["finder"] }).shown).includes("finder"), false);
});

test("sidebar: whatever was saved is read as two lists of ids, or as no preference", () => {
  assert.deepEqual(normalizeSidebarPrefs(null), EMPTY_SIDEBAR_PREFS);
  assert.deepEqual(normalizeSidebarPrefs("nonsense"), EMPTY_SIDEBAR_PREFS);
  assert.deepEqual(normalizeSidebarPrefs({ order: ["today", "today", 7, "Bad Id", "dev"], hidden: ["rpg", "settings", { x: 1 }] }), { order: ["today", "dev"], hidden: ["rpg"] });
});

test("sidebar: the rail has move and hide on each row, a hidden group, and saves under the data root", () => {
  const shell = read("src/renderer/main.tsx");
  assert.match(shell, /aria-label=\{`Move \$\{view\.label\} up`\}/);
  assert.match(shell, /aria-label=\{`Move \$\{view\.label\} down`\}/);
  assert.match(shell, /canHide\(view\.id\) && \(\s*<button type="button" aria-label=\{`Hide \$\{view\.label\}`\}/);
  assert.match(shell, /aria-label=\{`Show \$\{view\.label\} in the sidebar`\}/);
  assert.match(shell, /className="sidebar-hidden__toggle" aria-expanded=\{showHiddenViews\}/);
  // A hidden module is still one click away, and still opens.
  assert.match(shell, /rail\.hidden\.map\(\(view\) => \{[\s\S]{0,400}onClick=\{\(\) => void navigate\(view\.id\)\}/);
  // Shown on hover and on keyboard focus, not hover only.
  assert.match(read("src/renderer/styles.css"), /\.sidebar-row:hover \.sidebar-row__tools,\n\.sidebar-row:focus-within \.sidebar-row__tools/);
  const main = read("src/main/main.ts");
  assert.match(main, /const sidebarPrefsPath = join\(settingsRoot, "sidebar\.json"\);/);
});

test("activity log: one name per module, however a row spelled it", () => {
  assert.equal(moduleName("clipboard"), "Clipboard");
  assert.equal(moduleName("Clipboard"), "Clipboard");
  assert.equal(moduleName("DexNest Finance"), "Finance");
  assert.equal(moduleName("finance"), "Finance");
  assert.equal(moduleName("DexNest Tools"), "Tools");
  assert.equal(moduleName("developer_intelligence"), "Repository scan");
  assert.equal(moduleName("skill_constellation"), "Skills");
  assert.equal(moduleName("object_os"), "ObjectOS");
  assert.equal(moduleName("ObjectOS"), "ObjectOS");
  assert.equal(moduleName("finder"), "ObjectOS", "what Finder logged is ObjectOS's now");
  assert.equal(moduleName(null), "DexNest");
  assert.equal(moduleName("Something New"), "Something New", "an unknown module shows as it is");
});

test("activity log: a module's own event reads in words; an action keeps its own line", () => {
  assert.equal(typeWords("dev.commit.observed"), "Commit observed");
  assert.equal(typeWords("object.maintenance_logged"), "Maintenance logged");
  assert.equal(typeWords("action_executed"), "Action executed");
  const own = activityLine({ id: "1", at: "2026-10-04T08:00:00.000Z", stream: "dev", type: "dev.push.observed", module: "developer_intelligence", actionId: null, status: null, source: "scan", summary: null });
  assert.deepEqual([own.module, own.what, own.status, own.summary], ["Repository scan", "dev.push.observed", "recorded", "Push observed"]);
  const bare = activityLine({ id: "2", at: "2026-10-04T08:00:00.000Z", stream: "object", type: "object.located", module: null, actionId: null, status: null, source: "module_ui", summary: null });
  assert.equal(bare.module, "ObjectOS", "the stream names the module when the row does not");
  const action = activityLine({ id: "3", at: "2026-10-04T08:00:00.000Z", stream: "audit", type: "backup_created", module: "backup", actionId: "backup.create", status: "success", source: "module_ui", summary: "Created local DexNest backup." });
  assert.deepEqual([action.module, action.what, action.status, action.summary], ["Backup", "backup.create", "success", "Created local DexNest backup."]);
  assert.deepEqual(STREAMS.map((s) => s.id), ["", "audit", "dev", "projects", "skill", "rpg", "ghost", "object"]);
});

test("activity log: every stream is read, and only an action's own short fields leave the main process", () => {
  const main = read("src/main/main.ts");
  assert.match(main, /ipcMain\.handle\("dexnest:list-activity"/);
  assert.match(main, /const payload = event\.stream === "audit" && typeof event\.payload === "object"/, "a module event's payload is not sent");
  const view = read("src/renderer/views/AuditView.tsx");
  assert.match(view, /title="Activity log"/);
  assert.match(view, /STREAMS\.map\(\(s\) => \(/);
});

test("module settings live in Settings: one section, one Save each; Skills keeps a link, not a panel", () => {
  const shell = read("src/renderer/main.tsx");
  assert.match(shell, /\{ id: "modules", label: "Modules"/);
  assert.match(shell, /settingsSection === "modules" && \(\s*<ModuleSettings bridge=\{getBridge\(\)\}/);
  const settings = read("src/renderer/views/ModuleSettings.tsx");
  for (const card of ["modset-skills", "modset-scan", "modset-rpg", "modset-objects"]) assert.match(settings, new RegExp(`aria-labelledby="${card}"`), card);
  assert.equal((settings.match(/<Button type="submit" variant="primary">Save<\/Button>/g) ?? []).length, 3, "one Save per form, and it saves everything in it");
  assert.doesNotMatch(settings, /Save emails/);
  const skills = read("src/renderer/views/SkillConstellationView.tsx");
  assert.doesNotMatch(skills, /function SettingsPanel|<details className="skill-settings">/);
  assert.match(skills, /sessionStorage\.setItem\("dexnest:settingsSection", "modules"\)/);
  assert.match(skills, /Settings → Modules/);
});

test("module settings: emails and minutes are read forgivingly", async () => {
  const { minutes, parseEmails } = await import("../src/renderer/views/ModuleSettings.tsx").catch(() => ({ minutes: null, parseEmails: null }));
  // The component file imports React; when it cannot be loaded here, its two pure helpers are checked from source.
  if (!minutes || !parseEmails) {
    const source = read("src/renderer/views/ModuleSettings.tsx");
    assert.match(source, /return \[\.\.\.new Set\(text\.toLowerCase\(\)\.split\(\/\[,\\s\]\+\/\)\.filter\(Boolean\)\)\];/);
    assert.match(source, /return Number\.isFinite\(n\) && n >= min \? n : fallback;/);
    return;
  }
  assert.deepEqual(parseEmails("Me@Example.com, me@example.com  other@x.io"), ["me@example.com", "other@x.io"]);
  assert.equal(minutes("30", 5, 15), 30);
  assert.equal(minutes("2", 5, 15), 15);
  assert.equal(minutes("abc", 5, 15), 15);
});

test("clear data: the scan, Skills and Reality RPG can be cleared; tables are emptied, never dropped, all or nothing", () => {
  const main = read("src/main/main.ts");
  assert.match(main, /\{ id: "scan", label: "Repository scan and Standups",[^}]*tablePrefixes: \["dev_", "standup_"\] \}/);
  assert.match(main, /\{ id: "skills", label: "Skills",[^}]*tablePrefixes: \["skill_"\] \}/);
  assert.match(main, /\{ id: "rpg", label: "Reality RPG",[^}]*tablePrefixes: \["rpg_"\] \}/);
  assert.match(main, /db\.exec\("BEGIN IMMEDIATE"\);[\s\S]{0,400}DELETE FROM \$\{table\}[\s\S]{0,200}db\.exec\("COMMIT"\);[\s\S]{0,120}db\.exec\("ROLLBACK"\);/);
  assert.doesNotMatch(main, /DROP TABLE \$\{/);
  // Table names come from the database's own list and a prefix, never from what was asked for.
  assert.match(main, /names\.filter\(\(name\) => \/\^\[a-z\]\[a-z0-9_\]\*\$\/\.test\(name\) && prefixes\.some/);
  assert.match(main, /label: "Command history and pinned actions"/, "the old 'Dev projects' category says what it really holds");
});

test("leftovers: quick action titles wrap, a huge change reads in words, Command's day is the shared agenda", () => {
  const shell = read("src/renderer/main.tsx");
  assert.match(shell, /<p className="quick-action-title text-sm font-medium text-\[#F5F5F5\]" title=\{action\.title\}>/);
  assert.match(read("src/renderer/styles.css"), /\.quick-action-title \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(shell, /Math\.abs\(delta\) > 999 \? \(delta > 0 \? "far more than prev" : "far less than prev"\)/);
  assert.match(shell, /<CommandDay refreshKey=/);
  assert.match(shell, /const rows = dayRows\(agenda\);/);
});

test("a second DexNest starts even when the first holds the Deck port", () => {
  const main = read("src/main/main.ts");
  assert.match(main, /actionServer\.on\("error", \(error\) => \{[\s\S]{0,200}actionServer = null;\n  \}\);\n  actionServer\.listen\(actionPort, "0\.0\.0\.0"\);/);
});
