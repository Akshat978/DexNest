# DexNest Action Registry and Event Log Contracts

## Action Registry

Every module action must use this shape:

```ts
type DexNestAction = {
  id: string;
  title: string;
  module: string;
  description?: string;
  category: string;
  paramsSchema?: Record<string, unknown>;
  defaultParams?: Record<string, unknown>;
  dangerLevel: "safe" | "caution" | "danger" | "critical";
  requiresConfirmation: boolean;
  confirmationRule?: string | null;
  reversible: boolean;
  undoActionId?: string | null;
  handlerType: "internal_function" | "local_command" | "http_endpoint" | "file_operation" | "routine";
  handlerRef: string;
  allowedTriggers: Array<"command" | "deck" | "stream_deck_http" | "keyboard_shortcut" | "tray" | "assistant" | "voice" | "routine" | "module_ui">;
  enabled: boolean;
};
```

## Danger Levels

| Level | Meaning |
|---|---|
| safe | Opens, searches, copies, previews |
| caution | Creates or modifies local state |
| danger | Deletes, clears, stops, overwrites |
| critical | Vault reset, wipe data, destructive backup changes |

## Undo Rule

Undo only exists for clearly reversible actions.

Allowed reversible v1 examples:

- create calendar event → delete created event
- rename file → restore old name
- move file → move back
- create journal entry → move to trash
- clear clipboard → restore previous state if cached

Non-reversible v1 examples:

- run shell command
- stop dev server
- send file to phone
- export backup
- rebuild index
- log heatmap event

If rollback is not guaranteed, set:

```ts
reversible: false
```

## Event Log

Every meaningful action writes an event.

```ts
type DexNestEvent = {
  id: string;
  timestamp: string;
  module: string;
  actionId?: string;
  eventType: string;
  status: "success" | "failed" | "skipped" | "cancelled" | "pending";
  source: "command" | "deck" | "stream_deck_http" | "keyboard_shortcut" | "tray" | "assistant" | "voice" | "routine" | "module_ui" | "system";
  target?: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  metadataJson?: Record<string, unknown>;
  errorMessage?: string | null;
  durationMs?: number | null;
};
```

## Audit Rule

The audit log records what happened, not private content.

Good:

```txt
Sent clipboard text to phone, 248 bytes.
```

Bad:

```txt
Sent clipboard text: full private message...
```
