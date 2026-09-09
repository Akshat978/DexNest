/**
 * What a timetable block may be told to do.
 *
 * A choice is a whole effect - an action and the parameters it needs - not an
 * action to be configured afterwards. That is the difference between offering
 * "Govee: turn on" and offering "Lights on - Desk": the first is a form the
 * operator has to fill in correctly for something that will run unattended at
 * 09:00, and a form filled in wrongly there fails where nobody is watching.
 *
 * Built from a snapshot rather than read from disk, so which choices exist for
 * a given set of devices, groups and projects is a question with an answer
 * that can be checked.
 */

export interface EffectChoice {
  /** Stable within a build, for grouping in the picker. */
  group: "Focus" | "Lights" | "Privacy" | "Projects";
  title: string;
  actionId: string;
  params: Record<string, unknown>;
  /** Shown under the title when the choice needs explaining. */
  hint?: string;
}

export interface ChoiceInputs {
  /** Govee devices from the local cache, already filtered to controllable. */
  devices: Array<{ deviceId: string; alias: string }>;
  groups: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; hasStop: boolean }>;
}

/**
 * Every effect a block can be given, for these devices and projects.
 *
 * Deliberately narrow. Most of the action registry makes no sense on a
 * schedule - opening a view at 09:00 while somebody is working in another one
 * is an interruption rather than an effect - and a picker long enough to need
 * scrolling is one where the wrong entry gets chosen.
 *
 * Two actions that look like they belong here are absent on purpose.
 * external.govee.apply_scene is a placeholder in this build: it logs "skipped"
 * and changes nothing, so offering it would be offering a button that cannot
 * work. external.govee.toggle inverts whatever state it finds, which is right
 * for a person pressing it and wrong for a schedule - a lamp switched off by
 * hand during a block would be switched on by the block that meant to turn it
 * off.
 */
export function buildEffectChoices(inputs: ChoiceInputs): EffectChoice[] {
  const choices: EffectChoice[] = [
    {
      group: "Focus",
      title: "Performance mode on",
      actionId: "system.performance.enable",
      params: {},
      hint: "Pauses DexNest's heavier background work."
    },
    {
      group: "Focus",
      title: "Performance mode off",
      actionId: "system.performance.disable",
      params: {}
    },
    {
      group: "Privacy",
      title: "Lock vault and sensitive session",
      actionId: "system.lifecycle.lock_sensitive_session",
      params: {}
    },
    {
      group: "Privacy",
      // Explicit states rather than one entry that flips. clipboard.toggle_listener
      // reads params.enabled despite its name, so a single choice carrying no
      // parameters would read as false and quietly stop clipboard history for
      // ever - which looks like a bug in the clipboard, not in the schedule.
      title: "Pause clipboard history",
      actionId: "clipboard.toggle_listener",
      params: { enabled: false }
    },
    {
      group: "Privacy",
      title: "Resume clipboard history",
      actionId: "clipboard.toggle_listener",
      params: { enabled: true }
    }
  ];

  // Lights are named by what they are, not by which API call reaches them. A
  // target is always carried: without a deviceId or an alias the Govee actions
  // fall back to a default that may not be set, and the failure arrives as
  // "Provide a deviceId or alias" hours later in a log.
  for (const group of inputs.groups) {
    choices.push(
      { group: "Lights", title: `Lights on - ${group.name}`, actionId: "external.govee.turn_on", params: { alias: group.name } },
      { group: "Lights", title: `Lights off - ${group.name}`, actionId: "external.govee.turn_off", params: { alias: group.name } }
    );
  }
  for (const device of inputs.devices) {
    choices.push(
      { group: "Lights", title: `Lights on - ${device.alias}`, actionId: "external.govee.turn_on", params: { deviceId: device.deviceId } },
      { group: "Lights", title: `Lights off - ${device.alias}`, actionId: "external.govee.turn_off", params: { deviceId: device.deviceId } }
    );
  }

  for (const project of inputs.projects) {
    // Only where stopping means something. A project with no stop command, no
    // ports and no compose file has nothing for this to do, and the entry
    // would fail every evening.
    if (!project.hasStop) continue;
    choices.push({
      group: "Projects",
      title: `Stop ${project.name}`,
      actionId: `dev.project.${project.id}.stop`,
      params: { confirmedDangerous: true },
      hint: "Ends its dev server at the close of the block."
    });
  }

  return choices;
}

/**
 * The choice a saved effect came from, if it is still offered.
 *
 * Matched on what will actually run rather than on a stored key, so an effect
 * survives this list being renamed and stops matching when the thing it points
 * at is gone - a device removed from the cache should show as unrecognised
 * rather than silently resolving to a different lamp.
 */
export function findChoice(
  choices: readonly EffectChoice[],
  effect: { actionId: string; params?: Record<string, unknown> }
): EffectChoice | null {
  const wanted = stableParams(effect.params ?? {});
  return choices.find(choice => choice.actionId === effect.actionId && stableParams(choice.params) === wanted) ?? null;
}

/** Key-order-independent comparison, so {a,b} and {b,a} are one thing. */
function stableParams(params: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(params).sort(([left], [right]) => left.localeCompare(right))));
}

/**
 * Ready-made pairs, for the two shapes almost every schedule wants.
 *
 * Each is a start and an end together, because half of one is the failure this
 * whole feature invites: a block that dims the lights and never brings them
 * back leaves someone in the dark wondering what happened.
 */
export interface EffectPreset {
  id: string;
  title: string;
  description: string;
  build: (choices: readonly EffectChoice[]) => Array<{ when: "enter" | "exit"; actionId: string; params: Record<string, unknown> }>;
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: "focus",
    title: "Focus",
    description: "Performance mode on for the block, off afterwards.",
    build: choices => pairFor(choices, "system.performance.enable", "system.performance.disable")
  },
  {
    id: "sensitive",
    title: "Sensitive",
    description: "Pause clipboard history during the block, resume after.",
    build: choices => {
      const pause = choices.find(choice => choice.actionId === "clipboard.toggle_listener" && choice.params.enabled === false);
      const resume = choices.find(choice => choice.actionId === "clipboard.toggle_listener" && choice.params.enabled === true);
      if (!pause || !resume) return [];
      return [
        { when: "enter", actionId: pause.actionId, params: { ...pause.params } },
        { when: "exit", actionId: resume.actionId, params: { ...resume.params } }
      ];
    }
  }
];

function pairFor(
  choices: readonly EffectChoice[],
  enterActionId: string,
  exitActionId: string
): Array<{ when: "enter" | "exit"; actionId: string; params: Record<string, unknown> }> {
  const enter = choices.find(choice => choice.actionId === enterActionId);
  const exit = choices.find(choice => choice.actionId === exitActionId);
  // Both or neither. Adding only the half that exists is how a block ends up
  // turning something on with nothing to turn it back off.
  if (!enter || !exit) return [];
  return [
    { when: "enter", actionId: enter.actionId, params: { ...enter.params } },
    { when: "exit", actionId: exit.actionId, params: { ...exit.params } }
  ];
}
