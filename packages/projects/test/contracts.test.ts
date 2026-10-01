// Events never carry content; actions keep the deck rule; settings are off by
// default; the package stays pure.

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { opFinishedPayload, opStartedPayload, PROJECTS_EVENT_TYPES } from "../src/domain/events.ts";
import { planOperation } from "../src/domain/planners.ts";
import { deckSafe, PROJECTS_ACTIONS, triggerAllowed } from "../src/domain/actions.ts";
import { registryDanger } from "../src/domain/safety.ts";
import { DEFAULT_PROJECTS_SETTINGS, normaliseProjectsSettings } from "../src/domain/settings.ts";
import { repo, SECRET_MESSAGE, tree } from "./fixtures.ts";

test("operation events carry ids, verb, counts and outcome - never the commit message or file paths", () => {
  const state = repo({ workingTree: tree({ unstaged: [{ path: "secret/plans.txt", status: "modified" }] }) });
  const result = planOperation(state, { kind: "commit", message: SECRET_MESSAGE, files: ["secret/plans.txt"] });
  assert.equal(result.refused, false);
  if (result.refused) return;
  const started = JSON.stringify(opStartedPayload("op_1", "app", result, state.head.sha));
  const finished = JSON.stringify(opFinishedPayload("op_1", "app", result, "succeeded", { durationMs: 12.6, headAfter: "abc", undoable: true }));
  for (const json of [started, finished]) {
    assert.equal(json.includes("rotate key"), false);
    assert.equal(json.includes("DO-NOT-LOG"), false);
    assert.equal(json.includes("secret/plans.txt"), false);
    assert.match(json, /"verb":"commit"/);
    assert.match(json, /"files":1/);
  }
  assert.match(finished, /"durationMs":13/);
});

test("event types all live in the projects namespace", () => {
  for (const type of PROJECTS_EVENT_TYPES) assert.match(type, /^projects\.[a-z_]+\.[a-z_]+$/);
});

test("only read actions and fetch / fetch all / push current may come from the deck", () => {
  for (const action of PROJECTS_ACTIONS) assert.ok(deckSafe(action), action.id);
  assert.equal(triggerAllowed("projects.git.push_current", "deck"), true);
  assert.equal(triggerAllowed("projects.git.push", "deck"), false);
  assert.equal(triggerAllowed("projects.git.discard", "deck"), false);
  assert.equal(triggerAllowed("projects.git.discard", "command"), false);
  assert.equal(triggerAllowed("projects.git.delete_branch", "stream_deck_http"), false);
  assert.equal(triggerAllowed("projects.unknown", "module_ui"), false);
  for (const action of PROJECTS_ACTIONS) {
    if (action.safety === "caution" || action.safety === "strong") assert.deepEqual(action.triggers, ["module_ui"], action.id);
  }
});

test("the deck rule itself rejects a destructive deck action", () => {
  assert.equal(deckSafe({ id: "projects.git.discard", title: "x", safety: "caution", triggers: ["deck", "module_ui"], network: false }), false);
  assert.equal(deckSafe({ id: "projects.git.commit", title: "x", safety: "normal", triggers: ["deck"], network: false }), false);
});

test("safety classes map to the registry: caution and strong always require confirmation", () => {
  assert.deepEqual(registryDanger("read"), { dangerLevel: "safe", requiresConfirmation: false });
  assert.equal(registryDanger("normal").requiresConfirmation, false);
  assert.equal(registryDanger("caution").requiresConfirmation, true);
  assert.equal(registryDanger("strong").dangerLevel, "critical");
  assert.equal(registryDanger("strong").requiresConfirmation, true);
});

test("action ids are unique and well-formed", () => {
  const ids = PROJECTS_ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/);
});

test("settings: scheduled fetch is off by default and can't be set below 15 minutes", () => {
  assert.equal(DEFAULT_PROJECTS_SETTINGS.scheduledFetch.enabled, false);
  assert.deepEqual(normaliseProjectsSettings(undefined), DEFAULT_PROJECTS_SETTINGS);
  assert.equal(normaliseProjectsSettings({ scheduledFetch: { enabled: "yes" } }).scheduledFetch.enabled, false);
  assert.equal(normaliseProjectsSettings({ scheduledFetch: { enabled: true, intervalMinutes: 1 } }).scheduledFetch.intervalMinutes, 30);
  assert.equal(normaliseProjectsSettings({ staleDays: 7, fetchConcurrency: 99 }).fetchConcurrency, 4);
});

// --- static ------------------------------------------------------------------

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []
  );
}

test("the domain is pure: no I/O, no process, no network, no LLM, never git-ops or Developer Intelligence", () => {
  const forbidden = /from\s+["'](node:)?(fs|child_process|net|http|https|dgram|tls|worker_threads|electron|axios|got|node-fetch|undici)["']|@dexnest\/git-ops|@dexnest\/dev-intelligence|\b(openai|anthropic|@ai-sdk|langchain|ollama)\b|(?<![.\w])fetch\(|\bprocess\.env\b|(?<![.\w])spawn\(|(?<![.\w])exec(File|Sync)?\(/;
  const offenders = sources(join(SRC, "domain")).filter((file) => forbidden.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("the package never imports @dexnest/git-ops (the read side can't reach a mutating command)", () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as Record<string, Record<string, string> | undefined>;
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    assert.equal(Object.keys(pkg[field] ?? {}).includes("@dexnest/git-ops"), false, field);
  }
  const offenders = sources(SRC).filter((file) => /(from\s+|import\(\s*)["']@dexnest\/git-ops/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("no source in the package spells out a mutating git command line", () => {
  const verbs = "push|pull|fetch|commit|add|stash|switch|checkout|reset|clean|rebase|merge|branch|clone|restore|rm|tag|cherry-pick|revert|update-ref|filter-branch|gc|reflog";
  const pattern = new RegExp(`["']git["']\\s*,\\s*["'](${verbs})["']|\\[\\s*["'](${verbs})["']\\s*,\\s*["']-`);
  const offenders = sources(SRC).filter((file) => pattern.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});
