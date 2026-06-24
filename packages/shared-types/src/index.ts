export type DexNestModuleId = "command" | "dev" | "deck" | "clipboard" | "drop";

export type DexNestActionStatus = "available" | "placeholder";
export type DexNestActionDangerLevel = "safe" | "caution" | "danger" | "critical";
export type DexNestActionHandlerType =
  | "internal_function"
  | "local_command"
  | "http_endpoint"
  | "file_operation"
  | "routine";
export type DexNestActionTrigger = "command" | "deck" | "voice" | "routine" | "module_ui";
export type DexNestEventStatus = "success" | "failed" | "skipped" | "cancelled" | "pending";
export type DexNestEventSource = DexNestActionTrigger | "system" | "phone_pwa";

export interface DexNestActionDefinition {
  id: string;
  title: string;
  moduleId: DexNestModuleId;
  module: DexNestModuleId;
  description: string;
  category: string;
  paramsSchema?: Record<string, unknown>;
  defaultParams?: Record<string, unknown>;
  dangerLevel: DexNestActionDangerLevel;
  requiresConfirmation: boolean;
  confirmationRule?: string | null;
  reversible: boolean;
  undoActionId?: string | null;
  handlerType: DexNestActionHandlerType;
  handlerRef: string;
  allowedTriggers: DexNestActionTrigger[];
  enabled: boolean;
  status: DexNestActionStatus;
}

export interface DexNestActionInvocation {
  actionId: string;
  payload: unknown;
  requestedAt: string;
}

export interface DexNestModuleCard {
  id: DexNestModuleId;
  title: string;
  description: string;
  status: DexNestActionStatus;
}

export interface DexNestEventLogEntry {
  id: string;
  type: string;
  source: string;
  payload: unknown;
  createdAt: string;
  timestamp: string;
  module: string;
  actionId?: string;
  eventType: string;
  status: DexNestEventStatus;
  summary: string;
}
