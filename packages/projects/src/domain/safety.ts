// How dangerous an operation is, in the owner's terms, and what each class
// costs them before it runs. The classes come from the Projects brief:
//
//   read     - looks, never changes anything
//   normal   - one click, after a plain-words preview
//   caution  - a confirmation dialog
//   strong   - type the branch name to confirm
//   never    - not offered, not even as an option; refused wherever it appears
//
// The action registry has its own vocabulary (dangerLevel + requiresConfirmation);
// registryDanger() is the one place the two meet.

export type SafetyClass = "read" | "normal" | "caution" | "strong";

export type DangerLevel = "safe" | "caution" | "danger" | "critical";

export interface RegistrySafety {
  dangerLevel: DangerLevel;
  requiresConfirmation: boolean;
  confirmationRule?: string;
}

export function registryDanger(safety: SafetyClass): RegistrySafety {
  switch (safety) {
    case "read":
      return { dangerLevel: "safe", requiresConfirmation: false };
    case "normal":
      // The module shows its own preview; the registry does not ask again.
      return { dangerLevel: "caution", requiresConfirmation: false };
    case "caution":
      return { dangerLevel: "danger", requiresConfirmation: true };
    case "strong":
      return { dangerLevel: "critical", requiresConfirmation: true, confirmationRule: "Type the branch name to confirm." };
  }
}

/** What the owner must do before a plan of this class may run. */
export type ConfirmationNeed =
  | { kind: "none" }
  | { kind: "dialog" }
  | { kind: "type"; text: string };

export interface Confirmation {
  confirmed?: boolean;
  typed?: string;
}

/** Whether what the owner did satisfies what the plan needs. Exact match only. */
export function confirmationSatisfied(need: ConfirmationNeed, given: Confirmation | undefined): boolean {
  switch (need.kind) {
    case "none":
      return true;
    case "dialog":
      return given?.confirmed === true;
    case "type":
      return given?.confirmed === true && typeof given.typed === "string" && given.typed === need.text;
  }
}

/**
 * Operations DexNest never performs. Not a class an operation can have: these
 * have no OperationKind, no planner and no action. A request naming one, or
 * carrying a flag that would turn an allowed operation into one, is refused.
 * git-ops enforces the same list again at argv level (Phase 4).
 */
export interface NeverRule {
  id: string;
  /** Request kinds (as they might arrive over IPC) that mean this operation. */
  kinds: readonly string[];
  /** Request fields that would smuggle it into an allowed operation. */
  flags: readonly string[];
  reason: string;
}

export const NEVER_RULES: readonly NeverRule[] = [
  {
    id: "force_push",
    kinds: ["force_push", "push_force", "push_force_with_lease"],
    flags: ["force", "forceWithLease", "forceIfIncludes", "mirror", "plusRefspec"],
    reason: "DexNest never force-pushes. It would overwrite commits on the remote."
  },
  {
    id: "reset_hard",
    kinds: ["reset_hard", "reset"],
    flags: ["hard", "resetHard"],
    reason: "DexNest never runs reset --hard. It throws away work with no way back."
  },
  {
    id: "clean",
    kinds: ["clean", "clean_fdx"],
    flags: ["clean"],
    reason: "DexNest never runs git clean. It deletes untracked files permanently."
  },
  {
    id: "rebase",
    kinds: ["rebase", "pull_rebase"],
    flags: ["rebase"],
    reason: "DexNest never rebases. Open a terminal if you want to."
  },
  {
    id: "rewrite_history",
    kinds: ["amend", "commit_amend", "filter_branch", "filter_repo", "replace", "squash", "reflog_expire", "update_ref_delete", "gc_prune"],
    flags: ["amend", "noVerifyRewrite"],
    reason: "DexNest never rewrites history."
  }
];

export function neverRuleForKind(kind: string): NeverRule | undefined {
  return NEVER_RULES.find((rule) => rule.kinds.includes(kind));
}

export function neverRuleForFlag(flag: string): NeverRule | undefined {
  return NEVER_RULES.find((rule) => rule.flags.includes(flag));
}
