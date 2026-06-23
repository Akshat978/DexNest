import type { DexNestActionDefinition } from "@dexnest/shared-types";

const actionIdPattern = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

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
    id: "clipboard.open_placeholder",
    title: "Open Clipboard Placeholder",
    moduleId: "clipboard",
    module: "clipboard",
    description: "Open the DexNest Clipboard placeholder view.",
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
    status: "placeholder"
  },
  {
    id: "drop.open_placeholder",
    title: "Open Drop Placeholder",
    moduleId: "drop",
    module: "drop",
    description: "Open the DexNest Drop placeholder view.",
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
    status: "placeholder"
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
