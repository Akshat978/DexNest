import type { DexNestActionDefinition } from "@dexnest/shared-types";

export const deckActions: DexNestActionDefinition[] = [
  {
    id: "deck.placeholder",
    title: "Deck Placeholder",
    moduleId: "deck",
    module: "deck",
    description: "Placeholder DexNest Deck action endpoint for the initial spine.",
    category: "diagnostics",
    dangerLevel: "safe",
    requiresConfirmation: false,
    confirmationRule: null,
    reversible: false,
    undoActionId: null,
    handlerType: "http_endpoint",
    handlerRef: "/actions/deck.placeholder",
    allowedTriggers: ["deck", "module_ui"],
    enabled: true,
    status: "placeholder"
  }
];
