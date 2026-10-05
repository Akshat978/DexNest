/**
 * Outside AI: off until switched on, the user's own key, only the words of a
 * command, never anything private, every request logged without its text,
 * and the local path always there to fall back on.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDecisionRequest, confidentEnough, DECISION_MODEL, DEFAULT_OUTSIDE_AI_SETTINGS, INTENT_CRITERIA, looksLikeOpenRouterKey, MAX_COMMAND_CHARS,
  normalizeOutsideAiSettings, OPENROUTER_DECISIONS_URL, outcomeInWords, parseDecision, privateReason, routeCommand, SCREEN_CRITERIA, type OutsideAiSettings, type RouteDeps,
  buildCaptureRequest, CAPTURE_CRITERIA, parseCaptureSuggestion, suggestCaptureRoute
} from "../src/main/outsideAi.ts";
import { confidenceFromPercent, sendingSummary } from "../src/renderer/views/outsideAiModel.ts";
import { seededActions } from "../../../packages/action-registry/src/index.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");

const ON: OutsideAiSettings = { enabled: true, surfaces: { voice: true, typed: true, capture: true }, minConfidence: 0.7 };
const NOWHERE = { voice: false, typed: false, capture: false };
const KEY = `sk-or-${"a".repeat(40)}`;
const answer = (intent: string, confidence: number, screen = "none", screenConfidence = 0.9) => ({
  id: "gen-dec-1", model: "typesafe/jev-1.13-20260917", provider: "TypeSafe",
  answers: { intent: { type: "choice", choice: intent, confidence, probabilities: {} }, screen: { type: "choice", choice: screen, confidence: screenConfidence, probabilities: {} } },
  usage: { input_tokens: 412, output_tokens: 30, cost: 0.000017 }
});

function service(body: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: RouteDeps["fetch"] = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetch };
}

test("it is off by default, and anything unreadable in the settings file means off", () => {
  assert.deepEqual(DEFAULT_OUTSIDE_AI_SETTINGS, { enabled: false, surfaces: NOWHERE, minConfidence: 0.7 });
  for (const junk of [null, undefined, "on", 1, [], { enabled: "yes" }, { enabled: 1, surfaces: { voice: "true" } }]) {
    const s = normalizeOutsideAiSettings(junk);
    assert.equal(s.enabled, false);
    assert.deepEqual(s.surfaces, NOWHERE);
  }
  assert.equal(normalizeOutsideAiSettings({ minConfidence: 0.1 }).minConfidence, 0.5, "never below a coin toss");
  assert.equal(normalizeOutsideAiSettings({ minConfidence: 5 }).minConfidence, 0.99);
  assert.deepEqual(normalizeOutsideAiSettings({ enabled: true, surfaces: { voice: true }, minConfidence: 0.8 }), { enabled: true, surfaces: { voice: true, typed: false, capture: false }, minConfidence: 0.8 });
});

test("nothing is sent while it is off, while a surface is off, or with no key", async () => {
  const s = service(answer("open_module", 0.9, "skills"));
  const key = () => KEY;
  assert.deepEqual(await routeCommand("show me what I am good at", "voice", { fetch: s.fetch, key, settings: DEFAULT_OUTSIDE_AI_SETTINGS }), { ok: false, reason: "off", latencyMs: 0 });
  assert.equal((await routeCommand("show me what I am good at", "voice", { fetch: s.fetch, key, settings: { ...ON, enabled: false } })).ok, false);
  assert.equal((await routeCommand("show me what I am good at", "typed", { fetch: s.fetch, key, settings: { ...ON, surfaces: { voice: true, typed: false, capture: true } } })).ok, false);
  let keyRead = 0;
  const none = await routeCommand("show me what I am good at", "voice", { fetch: s.fetch, key: () => { keyRead += 1; return null; }, settings: ON });
  assert.deepEqual([none.ok, none.ok ? "" : none.reason], [false, "no_key"]);
  assert.equal(s.calls.length, 0, "no request left the computer");
  // And the key is not even read while it is off.
  await routeCommand("show me what I am good at", "voice", { fetch: s.fetch, key: () => { keyRead += 1; return KEY; }, settings: DEFAULT_OUTSIDE_AI_SETTINGS });
  assert.equal(keyRead, 1);
});

test("a command that looks private is never sent", async () => {
  const kept = [
    "what is my passport number", "show my work permit expiry", "my password for the router is hunter2", "what's my SIN",
    "log 42 dollars for groceries", "I spent $18 on lunch", "how much did I pay the bank", "add my salary to finance",
    "open my journal and write that today was hard", "find the invoice from March", "put this in the vault",
    "call 416 555 0199 tomorrow", "email sam@example.com about friday", "save https://example.com/a?b=1", "my card number is 4111 1111 1111 1111",
    "remind me to take my medication", "x".repeat(MAX_COMMAND_CHARS + 1), "   "
  ];
  const s = service(answer("capture_note", 0.99));
  for (const text of kept) {
    assert.notEqual(privateReason(text), null, text);
    const outcome = await routeCommand(text, "voice", { fetch: s.fetch, key: () => KEY, settings: ON });
    assert.deepEqual([outcome.ok, outcome.ok ? "" : outcome.reason], [false, "private"], text);
  }
  assert.equal(s.calls.length, 0, "none of them left the computer");
  for (const text of ["show me what I am good at", "bring up the thing with my quests", "where did I leave the drill", "pull up my week", "is anything waiting on me"]) {
    assert.equal(privateReason(text), null, text);
  }
});

test("the request carries the command's words and nothing else of the user's", async () => {
  const s = service(answer("open_module", 0.93, "skills", 0.9));
  const outcome = await routeCommand("  show me what I am good at  ", "voice", { fetch: s.fetch, key: () => KEY, settings: ON });
  assert.equal(s.calls.length, 1);
  const call = s.calls[0]!;
  assert.equal(call.url, OPENROUTER_DECISIONS_URL);
  assert.equal(call.url, "https://openrouter.ai/api/alpha/decisions");
  assert.deepEqual(call.headers, { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
  assert.deepEqual(Object.keys(call.body).sort(), ["model", "provider", "questions", "state"]);
  assert.equal(call.body.model, DECISION_MODEL);
  assert.deepEqual(call.body.state, { command: "show me what I am good at" });
  assert.deepEqual(call.body.provider, { data_collection: "deny" }, "the provider is asked not to keep it");
  assert.deepEqual(call.body, buildDecisionRequest("show me what I am good at"));
  assert.equal(JSON.stringify(call.body).includes(KEY), false, "the key is in the header only");
  assert.ok(outcome.ok && outcome.used);
  assert.deepEqual(outcome.ok && [outcome.decision.intent, outcome.decision.screen, outcome.decision.inputTokens], ["open_module", "skills", 412]);
});

test("the service picks from DexNest's list; it cannot name an action, and a private lookup is not on the list", () => {
  assert.equal("smart_lookup" in INTENT_CRITERIA, false);
  assert.ok("unknown" in INTENT_CRITERIA && "none" in SCREEN_CRITERIA);
  for (const bad of [
    null, "ok", {}, { answers: {} },
    { answers: { intent: { type: "choice", choice: "vault.secure.reveal", confidence: 0.99 } } },
    { answers: { intent: { type: "choice", choice: "smart_lookup", confidence: 0.99 } } },
    { answers: { intent: { type: "choice", choice: "open_module", confidence: "high" } } },
    { answers: { intent: { type: "choice", choice: "open_module", confidence: 1.4 } } },
    { answers: { intent: { type: "choice", choice: "__proto__", confidence: 0.9 } } }
  ]) assert.equal(parseDecision(bad), null, JSON.stringify(bad));
  const decision = parseDecision({ ...answer("open_module", 0.9, "run_shell", 0.9), actionId: "vault.delete", params: { all: true } });
  assert.deepEqual(decision && [decision.intent, decision.screen], ["open_module", null], "a screen that is not on the list is no screen");
  assert.deepEqual(Object.keys(decision ?? {}).sort(), ["cost", "inputTokens", "intent", "intentConfidence", "model", "screen", "screenConfidence"]);
});

test("an answer is used only when it is sure enough", () => {
  const sure = parseDecision(answer("capture_note", 0.82))!;
  assert.equal(confidentEnough(sure, 0.7), true);
  assert.equal(confidentEnough(sure, 0.9), false);
  assert.equal(confidentEnough(parseDecision(answer("unknown", 0.99))!, 0.5), false, "\"I do not know\" is never acted on");
  assert.equal(confidentEnough(parseDecision(answer("open_module", 0.95, "none", 0.9))!, 0.7), false, "opening needs a screen");
  assert.equal(confidentEnough(parseDecision(answer("open_module", 0.95, "skills", 0.6))!, 0.7), false, "and the screen must be sure too");
  assert.equal(confidentEnough(parseDecision(answer("open_module", 0.95, "skills", 0.8))!, 0.7), true);
});

test("every failure comes back as a reason, so the local path carries on", async () => {
  const deps = (fetch: RouteDeps["fetch"]): RouteDeps => ({ fetch, key: () => KEY, settings: ON, timeoutMs: 40 });
  const reason = async (fetch: RouteDeps["fetch"]) => { const o = await routeCommand("pull up my week", "typed", deps(fetch)); return o.ok ? "ok" : `${o.reason}${o.status ? ` ${o.status}` : ""}`; };
  assert.equal(await reason(service({ error: { code: 401, message: "no" } }, 401).fetch), "http 401");
  assert.equal(await reason(service({}, 402).fetch), "http 402");
  assert.equal(await reason(service({}, 429).fetch), "http 429");
  assert.equal(await reason(service({ answers: { intent: { choice: "delete_everything", confidence: 1 } } }).fetch), "bad_answer");
  assert.equal(await reason(async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } })), "bad_answer");
  assert.equal(await reason(async () => { throw new TypeError("fetch failed"); }), "network");
  assert.equal(await reason((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))), "timeout");
  assert.match(outcomeInWords({ ok: false, reason: "http", status: 401, latencyMs: 1 }), /refused the key/);
  assert.match(outcomeInWords({ ok: false, reason: "private", latencyMs: 0 }), /not sent/);
});

test("a key is recognised by its look, and the Settings card says in words whether anything is sent", () => {
  assert.equal(looksLikeOpenRouterKey(KEY), true);
  for (const bad of ["", "sk-ant-abc", "sk-or-short", "hello", 42, null, `sk-or-${"a".repeat(30)} extra`]) assert.equal(looksLikeOpenRouterKey(bad), false, String(bad));
  assert.equal(sendingSummary({ settings: DEFAULT_OUTSIDE_AI_SETTINGS, hasKey: false }), "Off. Nothing is sent anywhere.");
  assert.match(sendingSummary({ settings: ON, hasKey: false }), /no key is saved, so nothing is sent/);
  assert.match(sendingSummary({ settings: { ...ON, surfaces: NOWHERE }, hasKey: true }), /not allowed anywhere yet, so nothing is sent/);
  assert.equal(sendingSummary({ settings: { ...ON, surfaces: { ...NOWHERE, voice: true } }, hasKey: true }), "On for spoken commands, only when DexNest's own rules cannot tell what a command means.");
  assert.equal(sendingSummary({ settings: { ...ON, surfaces: { ...NOWHERE, capture: true } }, hasKey: true }), "On for Capture, only when you click Suggest on a note.");
  assert.match(sendingSummary({ settings: ON, hasKey: true }), /^On for spoken commands and typed commands, only when .*; and for Capture, only when you click Suggest on a note\.$/);
  assert.deepEqual(["85", "10", "400", "abc"].map((v) => confidenceFromPercent(v, 0.7)), [0.85, 0.5, 0.99, 0.7]);
});

test("the main process keeps the key to itself and logs each request without its words", () => {
  const main = read("src/main/main.ts");
  const block = main.slice(main.indexOf("// --- Outside AI"), main.indexOf("function getIntegrationCredentialValue"));
  assert.match(block, /setIntegrationCredential\(OUTSIDE_AI_PROVIDER, "OpenRouter", value\.trim\(\)\)/, "encrypted in the integration keychain");
  const state = block.slice(block.indexOf("function outsideAiState"), block.indexOf("function logOutsideAi"));
  assert.doesNotMatch(state, /decrypt|getIntegrationCredentialValue|encryptedValue/, "the state sent to the window has no key in it");
  assert.match(block, /key: \(\) => getIntegrationCredentialValue\(OUTSIDE_AI_PROVIDER\)/, "read only when a request is made");
  const log = block.slice(block.indexOf("async function askOutsideAi"), block.indexOf("async function runOutsideAiAction"));
  assert.match(log, /textLength: text\.trim\(\)\.length/);
  assert.doesNotMatch(log, /metadataJson|[{,]\s*text[,:}]|command: text/, "the words are not put in the log line");
  assert.match(block, /if \(source !== "module_ui"\) return \{ ok: false, actionId, error: "Outside AI is changed in Settings/);
  assert.match(block, /writeJsonFile\(outsideAiSettingsPath, \{ \.\.\.loadOutsideAiSettings\(\), enabled: false \}\);/, "removing the key turns it off");
  assert.match(block, /\/\^http:\\\/\\\/127\\\.0\\\.0\\\.1:/, "a test address must be this computer");
  assert.match(main, /const outsideAiSettingsPath = join\(settingsRoot, "outside-ai\.json"\);/);
  // The window gets a decision, never the key, and never raw service output.
  const ipc = main.slice(main.indexOf('ipcMain.handle("dexnest:outside-ai-route"'), main.indexOf('ipcMain.handle("dexnest:record-links"'));
  assert.match(ipc, /\{ ok: true, used: outcome\.used, intent: outcome\.decision\.intent, screen: outcome\.decision\.screen, confidence: outcome\.decision\.intentConfidence \}/);
});

test("its actions run from DexNest's own window only", () => {
  const actions = seededActions.filter((a) => a.id.startsWith("outside_ai."));
  assert.deepEqual(actions.map((a) => a.id).sort(), ["outside_ai.clear_key", "outside_ai.route_command", "outside_ai.set_key", "outside_ai.suggest_capture_route", "outside_ai.test", "outside_ai.update_settings"]);
  for (const a of actions) {
    assert.deepEqual(a.allowedTriggers, ["module_ui"], a.id);
    assert.equal("phone" in a && a.phone !== undefined, false, a.id);
  }
});

test("the router asks only when the rules are unsure, builds the action itself, and always confirms", () => {
  const shell = read("src/renderer/main.tsx");
  const ask = shell.slice(shell.indexOf("const unsure = !fastRoute"), shell.indexOf("const blockedMessage = ambientRouteBlockedMessage"));
  assert.match(ask, /&& ruleRoute\.sensitivity !== "sensitive"/);
  assert.match(ask, /&& \(ruleRoute\.intent === "unknown" \|\| ruleRoute\.confidence !== "high"\)/);
  assert.match(ask, /outside\?\.ok && outside\.used \? routeFromOutsideDecision\(/);
  assert.match(ask, /if \(engineEligible && routerUsed !== "outside-ai"\)/, "otherwise the local model is asked, as before");
  const build = shell.slice(shell.indexOf("function routeFromOutsideDecision"), shell.indexOf("function validateLlmIntent"));
  assert.match(build, /if \(!intent \|\| intent === "unknown" \|\| intent === "smart_lookup"\) return null;/);
  assert.equal((build.match(/requiresConfirmation: true/g) ?? []).length, 2);
  assert.match(shell, /const needsConfirm = route\.intent !== "unknown" && Boolean\(route\.actionId\) && \(routerUsed === "outside-ai" \|\| assistantNeedsConfirm\(route, actions\)\);/, "the step that actually asks");
  assert.doesNotMatch(build, /outside\.actionId|outside\.params/);
  // Every screen the service may pick is one voice already knows how to open.
  const aliases = shell.slice(shell.indexOf("const voiceModuleAliases"), shell.indexOf("function detectModuleAliasFromText"));
  for (const screen of Object.keys(SCREEN_CRITERIA).filter((s) => s !== "none")) {
    assert.ok(new RegExp(`\\n  (?:"${screen}"|${screen.replace(/ /g, "\\s")}): \\{ module:`).test(aliases), screen);
  }
});

test("AGENTS.md states the rule the code keeps", () => {
  const rules = readFileSync(join(desktop, "../../AGENTS.md"), "utf8").replace(/\r\n/g, "\n");
  assert.match(rules, /External AI is allowed in two places only, both off until the user turns them on:\n  Autopilot and Outside AI\./);
  assert.match(rules, /## Outside AI\n/);
  assert.match(rules, /- Off by default\./);
  assert.match(rules, /- Never sent: anything from the Vault, Finance or Journal;/);
  assert.match(rules, /Today that is two things/);
  assert.match(rules, /A suggestion never moves anything by itself\./);
  assert.match(rules, /Do not describe DexNest as fully offline while Outside AI is on\./);
  assert.doesNotMatch(rules, /Autopilot is the one approved exception/);
});

const captureAnswer = (route: string, confidence: number) => ({ model: "typesafe/jev-1.13", answers: { route: { type: "choice", choice: route, confidence } }, usage: { input_tokens: 200, cost: 0.000008 } });

test("Capture: a note is sent only with its own switch on, and only its words", async () => {
  const s = service(captureAnswer("calendar", 0.9));
  const off = await suggestCaptureRoute("Dentist on Thursday at three", { fetch: s.fetch, key: () => KEY, settings: { ...ON, surfaces: { voice: true, typed: true, capture: false } } });
  assert.deepEqual([off.ok, off.ok ? "" : off.reason, s.calls.length], [false, "off", 0], "the command switches do not turn Capture on");
  const outcome = await suggestCaptureRoute("Dentist on Thursday at three", { fetch: s.fetch, key: () => KEY, settings: ON });
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0]!.body, buildCaptureRequest("Dentist on Thursday at three"));
  assert.deepEqual(s.calls[0]!.body.state, { note: "Dentist on Thursday at three" });
  assert.deepEqual(s.calls[0]!.body.provider, { data_collection: "deny" });
  assert.deepEqual(outcome.ok && [outcome.suggestion.route, outcome.used], ["calendar", true]);
});

test("Capture: the Vault and Finance are never suggested, and a note that reads like either is never sent", async () => {
  assert.deepEqual(Object.keys(CAPTURE_CRITERIA).sort(), ["calendar", "drop", "finder", "journal", "keep"]);
  for (const bad of [captureAnswer("vault", 0.99), captureAnswer("finance", 0.99), captureAnswer("capture.route_to_vault", 0.99), { answers: {} }]) assert.equal(parseCaptureSuggestion(bad), null);
  const s = service(captureAnswer("journal", 0.99));
  for (const note of ["Grocery receipt for 84.20", "Paid the plumber", "Passport renewal form", "Bank letter about the account", "New router password is hunter2", "Blood test results, prescription changed"]) {
    const outcome = await suggestCaptureRoute(note, { fetch: s.fetch, key: () => KEY, settings: ON });
    assert.deepEqual([outcome.ok, outcome.ok ? "" : outcome.reason], [false, "private"], note);
  }
  assert.equal(s.calls.length, 0);
});

test("Capture: \"leave it\" and an unsure answer are not suggestions", async () => {
  const used = async (route: string, confidence: number) => { const o = await suggestCaptureRoute("Thinking about the trip", { fetch: service(captureAnswer(route, confidence)).fetch, key: () => KEY, settings: ON }); return o.ok && o.used; };
  assert.equal(await used("journal", 0.85), true);
  assert.equal(await used("journal", 0.6), false);
  assert.equal(await used("keep", 0.99), false);
});

test("Capture: the action takes a note by id, never text or a file, and moves nothing", () => {
  const main = read("src/main/main.ts");
  const handler = main.slice(main.indexOf('if (actionId === "outside_ai.suggest_capture_route")'), main.indexOf('if (actionId === "outside_ai.test")'));
  assert.match(handler, /entry\.id === String\(params\.captureId \?\? ""\) && entry\.status === "inbox"/);
  assert.match(handler, /const text = \[item\.title, item\.text\]\.filter\(Boolean\)\.join\("\. "\);/);
  assert.match(handler, /if \(item\.filePath\) return \{ ok: false, actionId, error: "A capture with a file attached is not sent anywhere\." \};/);
  assert.doesNotMatch(handler, /readFileSync|params\.text|saveCaptureItems|route_to_/, "no file is read, no text is taken from the request, nothing is moved");
  assert.match(handler, /textLength: text\.trim\(\)\.length/);
  const shell = read("src/renderer/main.tsx");
  assert.match(shell, /setSuggestOn\(Boolean\(state\?\.settings\.enabled && state\.settings\.surfaces\.capture && state\.hasKey\)\)/, "no button unless it is switched on");
  assert.match(shell, /\{suggestOn && !item\.filePath && <button type="button" onClick=\{\(\) => void suggestRoute\(item\)\}/, "and never on a capture with a file");
  assert.match(shell, /Outside AI suggests: <button type="button" className="record-link" onClick=\{\(\) => void routeCapture\(suggested\.action, item, suggested\.success\)\}>/, "moving it is the user's click");
});
