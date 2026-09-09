/**
 * What a block can be told to do.
 *
 * These effects run unattended, so an entry that is offered but cannot work is
 * worse than one that is missing: it fails at 09:00 with nobody watching, and
 * the symptom shows up as the module it called rather than as the schedule
 * that called it.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildEffectChoices,
  EFFECT_PRESETS,
  findChoice,
  type ChoiceInputs
} from "../src/main/effectChoices.ts";

const inputs = (over: Partial<ChoiceInputs> = {}): ChoiceInputs => ({
  devices: [{ deviceId: "d1", alias: "Desk" }],
  groups: [{ id: "g1", name: "Study" }],
  projects: [{ id: "p1", name: "DexNest", hasStop: true }],
  ...over
});

test("the scene action is not offered, because it does nothing", () => {
  // external.govee.apply_scene is a placeholder in this build: it logs
  // "skipped" and changes nothing. Offering it would be offering a button that
  // cannot work, and the operator would find out at the block boundary.
  const ids = buildEffectChoices(inputs()).map(choice => choice.actionId);
  assert.ok(!ids.includes("external.govee.apply_scene"));
});

test("the light toggle is not offered, because a schedule must not invert", () => {
  // Right for a person pressing it, wrong for a block: a lamp switched off by
  // hand mid-block would be switched on by the effect that meant to end it.
  const ids = buildEffectChoices(inputs()).map(choice => choice.actionId);
  assert.ok(!ids.includes("external.govee.toggle"));
});

test("clipboard choices carry the state they mean", () => {
  // clipboard.toggle_listener reads params.enabled despite its name. A single
  // entry with no parameters would read as false and quietly stop clipboard
  // history for ever, which looks like a bug in the clipboard.
  const choices = buildEffectChoices(inputs()).filter(choice => choice.actionId === "clipboard.toggle_listener");
  assert.equal(choices.length, 2);
  assert.deepEqual(choices.map(choice => choice.params.enabled).sort(), [false, true]);
});

test("every light choice carries a target", () => {
  // Without a deviceId or alias the Govee actions fall back to a default that
  // may never have been set, and the failure arrives hours later in a log as
  // "Provide a deviceId or alias".
  for (const choice of buildEffectChoices(inputs()).filter(choice => choice.group === "Lights")) {
    assert.ok(choice.params.deviceId || choice.params.alias, `${choice.title} has no target`);
  }
});

test("groups and devices both become choices", () => {
  const titles = buildEffectChoices(inputs()).map(choice => choice.title);
  assert.ok(titles.includes("Lights on - Study"));
  assert.ok(titles.includes("Lights off - Desk"));
});

test("with no Govee devices there are no light choices", () => {
  const choices = buildEffectChoices(inputs({ devices: [], groups: [] }));
  assert.equal(choices.filter(choice => choice.group === "Lights").length, 0);
  // And the rest still exist, so an empty Govee cache does not empty the picker.
  assert.ok(choices.some(choice => choice.actionId === "system.performance.enable"));
});

test("a project with nothing to stop is not offered", () => {
  // No stop command, no ports, no compose file: the entry would fail every
  // evening at the same time.
  const choices = buildEffectChoices(inputs({ projects: [{ id: "p1", name: "Docs", hasStop: false }] }));
  assert.equal(choices.filter(choice => choice.group === "Projects").length, 0);
});

test("stopping a project is pre-confirmed, since nothing at 18:00 can answer", () => {
  const stop = buildEffectChoices(inputs()).find(choice => choice.actionId === "dev.project.p1.stop")!;
  assert.equal(stop.params.confirmedDangerous, true);
});

// --- matching a saved effect back to its choice -------------------------------

test("a saved effect finds the choice it came from", () => {
  const choices = buildEffectChoices(inputs());
  const found = findChoice(choices, { actionId: "clipboard.toggle_listener", params: { enabled: false } });
  assert.equal(found?.title, "Pause clipboard history");
});

test("the same action with different parameters is a different choice", () => {
  const choices = buildEffectChoices(inputs());
  assert.equal(findChoice(choices, { actionId: "clipboard.toggle_listener", params: { enabled: true } })?.title, "Resume clipboard history");
});

test("parameter order does not decide identity", () => {
  const choices = buildEffectChoices(inputs());
  const found = findChoice(choices, { actionId: "dev.project.p1.stop", params: { confirmedDangerous: true } });
  assert.ok(found);
});

test("an effect pointing at a removed device matches nothing", () => {
  // It must read as unrecognised rather than quietly resolving to another lamp.
  const choices = buildEffectChoices(inputs({ devices: [] }));
  assert.equal(findChoice(choices, { actionId: "external.govee.turn_on", params: { deviceId: "d1" } }), null);
});

// --- presets ------------------------------------------------------------------

test("a preset adds both halves or neither", () => {
  // Half of a preset is the failure this feature invites: a block that dims
  // the lights and never brings them back.
  const choices = buildEffectChoices(inputs());
  for (const preset of EFFECT_PRESETS) {
    const built = preset.build(choices);
    assert.equal(built.length, 2, `${preset.id} did not produce a pair`);
    assert.deepEqual(built.map(effect => effect.when), ["enter", "exit"]);
  }
});

test("a preset whose actions are unavailable adds nothing", () => {
  const built = EFFECT_PRESETS.map(preset => preset.build([])).flat();
  assert.deepEqual(built, []);
});

test("preset params are copies, not references into the choice list", () => {
  const choices = buildEffectChoices(inputs());
  const built = EFFECT_PRESETS.find(preset => preset.id === "sensitive")!.build(choices);
  built[0]!.params.enabled = "tampered";
  const pause = choices.find(choice => choice.title === "Pause clipboard history")!;
  assert.equal(pause.params.enabled, false);
});
