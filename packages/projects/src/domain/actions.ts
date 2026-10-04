// The Projects actions: id, safety class, who may trigger them, whether they
// use the network. The registry entries (Phase 6) are generated from this
// list, and the runtime enforces `triggers` itself - the shell's dispatcher
// declares allowedTriggers but does not check them.
//
// Only safe, non-destructive actions may come from the Stream Deck: open,
// fetch, fetch all, and "push current project" (which never asks and refuses
// whenever pushing is not plainly safe). Caution and strong actions are
// module_ui only.

import type { SafetyClass } from "./safety.ts";

export type ActionTrigger = "command" | "deck" | "stream_deck_http" | "keyboard_shortcut" | "module_ui";

export interface ProjectsActionContract {
  id: string;
  title: string;
  safety: SafetyClass;
  triggers: readonly ActionTrigger[];
  network: boolean;
}

const UI: readonly ActionTrigger[] = ["module_ui"];
const COMMAND_UI: readonly ActionTrigger[] = ["command", "module_ui"];
const DECK: readonly ActionTrigger[] = ["command", "deck", "stream_deck_http", "keyboard_shortcut", "module_ui"];

export const PROJECTS_ACTIONS: readonly ProjectsActionContract[] = [
  { id: "projects.add", title: "Add project", safety: "normal", triggers: UI, network: false },
  { id: "projects.update", title: "Edit project", safety: "normal", triggers: UI, network: false },
  { id: "projects.archive", title: "Archive project", safety: "normal", triggers: COMMAND_UI, network: false },
  { id: "projects.restore", title: "Restore archived project", safety: "normal", triggers: COMMAND_UI, network: false },
  { id: "projects.remove", title: "Remove archived project from DexNest", safety: "caution", triggers: UI, network: false },
  { id: "projects.import_legacy", title: "Import projects.json", safety: "normal", triggers: UI, network: false },
  { id: "projects.clone", title: "Clone repository", safety: "normal", triggers: UI, network: true },
  { id: "projects.suggestions.add", title: "Add suggested repositories", safety: "normal", triggers: UI, network: false },
  { id: "projects.import_folder", title: "Import projects from folders", safety: "normal", triggers: UI, network: false },
  { id: "projects.open_vscode", title: "Open project in VS Code", safety: "read", triggers: DECK, network: false },
  { id: "projects.open_terminal", title: "Open terminal in project", safety: "read", triggers: DECK, network: false },
  { id: "projects.open_folder", title: "Open project folder", safety: "read", triggers: DECK, network: false },
  { id: "projects.open_github", title: "Open project on GitHub", safety: "read", triggers: DECK, network: false },
  { id: "projects.git.refresh", title: "Refresh git status", safety: "read", triggers: COMMAND_UI, network: false },
  { id: "projects.git.fetch", title: "Fetch project", safety: "normal", triggers: DECK, network: true },
  { id: "projects.git.fetch_all", title: "Fetch all projects", safety: "normal", triggers: DECK, network: true },
  { id: "projects.git.pull", title: "Pull (fast-forward only)", safety: "normal", triggers: COMMAND_UI, network: true },
  { id: "projects.git.pull_all", title: "Pull all clean projects", safety: "normal", triggers: COMMAND_UI, network: true },
  // The module previews it and asks first when it is the default branch moving to another branch.
  { id: "projects.git.fast_forward", title: "Move a branch forward without switching to it", safety: "normal", triggers: UI, network: false },
  { id: "projects.git.push", title: "Push", safety: "normal", triggers: COMMAND_UI, network: true },
  { id: "projects.git.push_current", title: "Push current project", safety: "normal", triggers: DECK, network: true },
  { id: "projects.git.commit", title: "Commit", safety: "normal", triggers: UI, network: false },
  { id: "projects.git.stash", title: "Stash changes", safety: "normal", triggers: UI, network: false },
  { id: "projects.git.stash_pop", title: "Pop stash", safety: "normal", triggers: UI, network: false },
  { id: "projects.git.switch", title: "Switch branch", safety: "normal", triggers: UI, network: false },
  { id: "projects.git.create_branch", title: "Create branch", safety: "normal", triggers: UI, network: false },
  { id: "projects.git.delete_branch", title: "Delete local branch", safety: "strong", triggers: UI, network: false },
  { id: "projects.git.delete_remote_branch", title: "Delete remote branch", safety: "strong", triggers: UI, network: true },
  { id: "projects.git.discard", title: "Discard changes", safety: "caution", triggers: UI, network: false },
  { id: "projects.git.undo", title: "Undo last operation", safety: "normal", triggers: UI, network: false },
  { id: "projects.git.cancel", title: "Cancel running operation", safety: "read", triggers: UI, network: false }
];

export function projectsAction(id: string): ProjectsActionContract | undefined {
  return PROJECTS_ACTIONS.find((action) => action.id === id);
}

/** Whether `source` may trigger `id`. Unknown actions and unknown sources are refused. */
export function triggerAllowed(id: string, source: string): boolean {
  const action = projectsAction(id);
  return action !== undefined && (action.triggers as readonly string[]).includes(source);
}

const DECK_SOURCES = new Set(["deck", "stream_deck_http", "keyboard_shortcut"]);

/** The rule the list above must keep: nothing above "normal" from the deck. */
export function deckSafe(action: ProjectsActionContract): boolean {
  const fromDeck = action.triggers.some((t) => DECK_SOURCES.has(t));
  return !fromDeck || action.safety === "read" || (action.safety === "normal" && DECK_ALLOWED_NORMAL.has(action.id));
}

/** Normal-class actions the brief allows from the deck. */
export const DECK_ALLOWED_NORMAL: ReadonlySet<string> = new Set(["projects.git.fetch", "projects.git.fetch_all", "projects.git.push_current"]);
