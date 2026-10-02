// Projects in the desktop shell: the trusted-frame check, the IPC channels and
// their preload bridge, the registry entries, and the main.ts wiring.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { seededActions } from "@dexnest/action-registry";
import { PROJECTS_ACTIONS, registryDanger } from "@dexnest/projects";

import { isTrustedMainFrame } from "../src/main/trustedFrame.ts";

const read = (path: string) => readFileSync(new URL(`../src/main/${path}`, import.meta.url), "utf8");

test("the trusted-frame check accepts only DexNest's own window's main frame", () => {
  const mainFrame = { id: "main" };
  const webContents = { mainFrame };
  const window = { isDestroyed: () => false, webContents };
  assert.equal(isTrustedMainFrame({ sender: webContents, senderFrame: mainFrame }, window), true);
  assert.equal(isTrustedMainFrame({ sender: webContents, senderFrame: { id: "iframe" } }, window), false, "a subframe");
  assert.equal(isTrustedMainFrame({ sender: { mainFrame }, senderFrame: mainFrame }, window), false, "another webContents");
  assert.equal(isTrustedMainFrame({ sender: webContents, senderFrame: mainFrame }, { ...window, isDestroyed: () => true }), false, "a destroyed window");
  assert.equal(isTrustedMainFrame({ sender: webContents, senderFrame: mainFrame }, null), false, "no window");
});

test("every Projects IPC channel goes through the trusted-frame handler, and the preload exposes each one", () => {
  const host = read("projectsHost.ts");
  const preload = read("preload.ts");
  assert.equal((host.match(/ipcMain\.handle\(/g) ?? []).length, 1, "only the guarded helper registers handlers");
  assert.match(host, /if \(!isTrustedMainFrame\(event, options\.getWindow\(\)\)\) throw/);
  const channels = [...host.matchAll(/handle\("(dexnest:projects-[a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(channels.length >= 30, `${channels.length} channels`);
  for (const channel of channels) assert.ok(preload.includes(`"${channel}"`), `preload lacks ${channel}`);
  // dexnest:projects-git is the Dev dashboard's own (main.ts) channel, kept until its view is replaced.
  for (const [, channel] of preload.matchAll(/invoke\("(dexnest:projects-[a-z-]+)"/g)) {
    if (channel !== "dexnest:projects-git") assert.ok(channels.includes(channel), `preload calls unknown ${channel}`);
  }
});

test("the registry has every Projects action, with the contract's safety and triggers", () => {
  for (const contract of PROJECTS_ACTIONS) {
    const entry = seededActions.find((a) => a.id === contract.id);
    assert.ok(entry, contract.id);
    const danger = registryDanger(contract.safety);
    assert.equal(entry.dangerLevel, danger.dangerLevel, contract.id);
    assert.equal(entry.requiresConfirmation, danger.requiresConfirmation, contract.id);
    assert.deepEqual([...entry.allowedTriggers].sort(), [...contract.triggers].sort(), contract.id);
    assert.equal(entry.moduleId, "projects");
    assert.equal(entry.phone, undefined, "no Projects action is phone-exposed");
  }
  const registered = seededActions.filter((a) => a.id.startsWith("projects.")).map((a) => a.id).sort();
  assert.deepEqual(registered, PROJECTS_ACTIONS.map((a) => a.id).sort());
  for (const entry of seededActions.filter((a) => a.id.startsWith("projects."))) {
    if (entry.dangerLevel === "danger" || entry.dangerLevel === "critical") assert.deepEqual(entry.allowedTriggers, ["module_ui"], entry.id);
  }
});

test("main.ts: Projects starts before IPC and disposes on quit; projects.* actions route to it; no git push of its own", () => {
  const main = read("main.ts");
  const ready = main.indexOf("startProjectsHost();\n  registerIpcHandlers();");
  assert.ok(ready > 0, "started before the IPC handlers that read projects");
  assert.match(main, /devIntelligenceHost\?\.dispose\(\);\n  projectsHost\?\.dispose\(\);\n  void hostScheduler\.dispose\(\);/);
  assert.match(main, /if \(actionId\.startsWith\("projects\."\)\) \{/);
  assert.match(main, /projectsHost\.module\.runAction\(actionId, source, payload\)/);
  assert.equal(main.includes('runGit(project.path, ["push"]'), false, "pushing goes through git-ops");
  assert.match(main, /projectsHost\.module\.execute\(project\.id, \{ kind: "push" \}, \{ source \}\)/);
  assert.match(main, /function loadProjects\(\): DexNestProject\[\] \{\n  if \(projectsHost\) return projectsHost\.module\.legacyProjects\(\)/);
  assert.match(main, /if \(projectsHost\) projectsHost\.module\.archiveLegacy\(projectId\);/, "delete archives");
});

test("the host never runs git itself and never reads projects.json after the migration", () => {
  const host = read("projectsHost.ts");
  assert.equal(/\bexecFile\(|\bexec\(|"git"/.test(host), false);
  assert.equal(/readFileSync|readJsonFile/.test(host), false);
  assert.match(host, /shell: false/);
});
