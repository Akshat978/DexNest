import type { DexNestActionDefinition } from "@dexnest/shared-types";

const actionIdPattern = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

export const seededActions: DexNestActionDefinition[] = [
  {
    id: "command.open_home",
    title: "Open Command Home",
    moduleId: "command",
    module: "command",
    description: "Open the DexNest Command home dashboard.",
    category: "navigation",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "desktop.view.command",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "dev.open_dashboard",
    title: "Open Dev Dashboard",
    moduleId: "dev",
    module: "dev",
    description: "Open the DexNest Dev dashboard placeholder.",
    category: "navigation",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "desktop.view.dev",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "deck.test_endpoint",
    title: "Test Deck Endpoint",
    moduleId: "deck",
    module: "deck",
    description: "Run a safe test through the DexNest localhost action endpoint.",
    category: "diagnostics",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "http_endpoint",
    handlerRef: "/actions/deck.test_endpoint",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "clipboard.open",
    title: "Open Clipboard",
    moduleId: "clipboard",
    module: "clipboard",
    description: "Open the DexNest Clipboard workspace.",
    category: "navigation",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "desktop.view.clipboard",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "clipboard.save_current",
    title: "Save Current Clipboard",
    moduleId: "clipboard",
    module: "clipboard",
    description: "Manually save the current text clipboard into DexNest Clipboard history.",
    category: "clipboard",
    dangerLevel: "caution",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "clipboard.save_current",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "clipboard.copy_plain_text",
    title: "Paste as Plain Text",
    moduleId: "clipboard",
    module: "clipboard",
    description: "Normalize the current clipboard text as plain text.",
    category: "clipboard",
    dangerLevel: "caution",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "clipboard.copy_plain_text",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "clipboard.create_snippet",
    title: "Create Clipboard Snippet",
    moduleId: "clipboard",
    module: "clipboard",
    description: "Create or update a local DexNest Clipboard snippet.",
    category: "clipboard",
    dangerLevel: "caution",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "clipboard.create_snippet",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "clipboard.delete_snippet",
    title: "Delete Clipboard Snippet",
    moduleId: "clipboard",
    module: "clipboard",
    description: "Delete a local DexNest Clipboard snippet.",
    category: "clipboard",
    dangerLevel: "danger",
    requiresConfirmation: true,
    confirmationRule: "Deleting a snippet removes it from local settings.",
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "clipboard.delete_snippet",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.open",
    title: "Open Drop",
    moduleId: "drop",
    module: "drop",
    description: "Open the DexNest Drop local handoff workspace.",
    category: "navigation",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "desktop.view.drop",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.copy_phone_url",
    title: "Copy Drop Phone URL",
    moduleId: "drop",
    module: "drop",
    description: "Copy the DexNest Drop LAN phone URL.",
    category: "drop",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "drop.copy_phone_url",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.create_text_drop",
    title: "Create Text Drop",
    moduleId: "drop",
    module: "drop",
    description: "Create a temporary local text drop.",
    category: "drop",
    dangerLevel: "caution",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "drop.create_text_drop",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.send_clipboard_to_drop",
    title: "Send Current Clipboard to Drop",
    moduleId: "drop",
    module: "drop",
    description: "Create a temporary Drop item from the current text clipboard.",
    category: "drop",
    dangerLevel: "caution",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "drop.send_clipboard_to_drop",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.add_outgoing_file",
    title: "Add Outgoing Drop File",
    moduleId: "drop",
    module: "drop",
    description: "Select a local file and add it to the DexNest Drop outgoing shelf.",
    category: "drop",
    dangerLevel: "caution",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "file_operation",
    handlerRef: "drop.add_outgoing_file",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.remove_outgoing_file",
    title: "Remove Outgoing Drop File",
    moduleId: "drop",
    module: "drop",
    description: "Remove a file from the DexNest Drop outgoing shelf.",
    category: "drop",
    dangerLevel: "danger",
    requiresConfirmation: true,
    confirmationRule: "Removing an outgoing file deletes the Drop copy.",
    reversible: false,
    undoActionId: null,
    handlerType: "file_operation",
    handlerRef: "drop.remove_outgoing_file",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.clear_outgoing",
    title: "Clear Drop Outgoing Shelf",
    moduleId: "drop",
    module: "drop",
    description: "Clear outgoing DexNest Drop text and file items.",
    category: "drop",
    dangerLevel: "danger",
    requiresConfirmation: true,
    confirmationRule: "Clearing outgoing items removes temporary Drop entries and file copies.",
    reversible: false,
    undoActionId: null,
    handlerType: "file_operation",
    handlerRef: "drop.clear_outgoing",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.clear_incoming",
    title: "Clear Drop Incoming List",
    moduleId: "drop",
    module: "drop",
    description: "Clear DexNest Drop incoming metadata while keeping received files on disk.",
    category: "drop",
    dangerLevel: "danger",
    requiresConfirmation: true,
    confirmationRule: "Clearing incoming removes Drop metadata from the desktop list.",
    reversible: false,
    undoActionId: null,
    handlerType: "file_operation",
    handlerRef: "drop.clear_incoming",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.open_incoming_folder",
    title: "Open Drop Incoming Folder",
    moduleId: "drop",
    module: "drop",
    description: "Open the DexNest Drop incoming folder.",
    category: "drop",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "file_operation",
    handlerRef: "drop.open_incoming_folder",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.open_outgoing_folder",
    title: "Open Drop Outgoing Folder",
    moduleId: "drop",
    module: "drop",
    description: "Open the DexNest Drop outgoing folder.",
    category: "drop",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "file_operation",
    handlerRef: "drop.open_outgoing_folder",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "drop.clear_temp_shelf",
    title: "Clear Drop Temp Shelf",
    moduleId: "drop",
    module: "drop",
    description: "Clear temporary local Drop shelf items.",
    category: "drop",
    dangerLevel: "danger",
    requiresConfirmation: true,
    confirmationRule: "Clearing the shelf removes temporary Drop entries.",
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "drop.clear_temp_shelf",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "audit.open_history",
    title: "Open Audit History",
    moduleId: "command",
    module: "command",
    description: "Open recent DexNest event history.",
    category: "navigation",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "desktop.view.audit",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  },
  {
    id: "settings.open",
    title: "Open Settings",
    moduleId: "command",
    module: "command",
    description: "Open DexNest local settings.",
    category: "navigation",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "internal_function",
    handlerRef: "desktop.view.settings",
    allowedTriggers: ["command", "deck", "module_ui"],
    enabled: true,
    status: "available"
  }
];

export function validateActionDefinition(action: DexNestActionDefinition): void {
  if (!actionIdPattern.test(action.id)) {
    throw new Error(`DexNest action id must be dot-delimited lowercase text: ${action.id}`);
  }

  if (!action.title.trim()) {
    throw new Error(`DexNest action ${action.id} must have a title.`);
  }

  if (!action.description.trim()) {
    throw new Error(`DexNest action ${action.id} must have a description.`);
  }

  if (!action.enabled) {
    throw new Error(`DexNest action ${action.id} must be enabled or omitted from the registry.`);
  }
}

export function createActionRegistry(initialActions: DexNestActionDefinition[] = []) {
  const actions = new Map<string, DexNestActionDefinition>();

  function register(action: DexNestActionDefinition): void {
    validateActionDefinition(action);

    if (actions.has(action.id)) {
      throw new Error(`DexNest action already registered: ${action.id}`);
    }

    actions.set(action.id, action);
  }

  for (const action of initialActions) {
    register(action);
  }

  return {
    register,
    get(actionId: string) {
      return actions.get(actionId);
    },
    list() {
      return [...actions.values()];
    }
  };
}
