// Whether a paired phone may run an action.
//
// One predicate, pure, with no knowledge of HTTP, so the rule can be tested
// directly rather than through a server. The route that calls it does nothing
// but turn the answer into a status code.
//
// THE RULE IS AN ALLOWLIST, AND THAT IS THE WHOLE POINT
//
// An action registry reachable over a network port is remote code execution
// with extra steps. The only safe default is "no", so `phone` is absent on 150
// of the 152 actions and they are all refused — including every action added
// after this file was written, by someone who never read it.
//
// Three tempting shortcuts, all rejected:
//
//   - Filter by dangerLevel. `safe` includes vault.secure.copy_username and
//     finance.open. Risk level describes how bad a mistake is at the desk, not
//     whether something belongs on a phone over a network.
//   - Filter by module. The same module holds actions that read and actions
//     that reveal secrets.
//   - Keep a denylist. Then every future action is exposed by default, and the
//     failure is silent.

import type { DexNestActionDefinition, DexNestPhoneExposure } from "@dexnest/shared-types";

/** What a device must hold. Read implies nothing else; control is separate. */
export type PhoneCapability = "read" | "control" | "drop";

export interface ExposureRefusal {
  ok: false;
  /** For the caller to turn into a status code. */
  reason: "not_exposed" | "needs_control" | "disabled";
  message: string;
}

export type ExposureVerdict = { ok: true; requires: DexNestPhoneExposure } | ExposureRefusal;

/**
 * The declared exposure, or null.
 *
 * Deliberately strict about the value: an action carrying `phone: "readonly"`
 * or `phone: true` from a careless edit is treated as undeclared rather than
 * as something close enough, because guessing at intent is how an allowlist
 * quietly becomes a suggestion.
 */
export function phoneExposureOf(action: Pick<DexNestActionDefinition, "phone">): DexNestPhoneExposure | null {
  return action.phone === "read" || action.phone === "control" ? action.phone : null;
}

export function canPhoneRun(
  action: Pick<DexNestActionDefinition, "id" | "phone" | "enabled">,
  capabilities: readonly PhoneCapability[]
): ExposureVerdict {
  const requires = phoneExposureOf(action);
  if (!requires) {
    // Worded as "not available" rather than "does not exist", because it does
    // exist and saying otherwise would be a lie the operator has to debug. But
    // it names no detail about the action either — a refusal that describes
    // what it is refusing is a way to enumerate the registry.
    return {
      ok: false,
      reason: "not_exposed",
      message: "That action is not available from a phone."
    };
  }

  if (action.enabled === false) {
    return { ok: false, reason: "disabled", message: "That action is turned off in DexNest." };
  }

  if (requires === "control" && !capabilities.includes("control")) {
    return {
      ok: false,
      reason: "needs_control",
      message: "This device may read but not control. Grant control from DexNest on the desktop."
    };
  }

  // A `read` action needs no check: holding a device token at all is read, and
  // a device that could not read would have failed authentication already.
  return { ok: true, requires };
}

/** The actions a given device may see. Used for the listing, not the gate. */
export function phoneActions<T extends Pick<DexNestActionDefinition, "id" | "phone" | "enabled">>(
  actions: readonly T[],
  capabilities: readonly PhoneCapability[]
): T[] {
  return actions.filter(action => canPhoneRun(action, capabilities).ok);
}
