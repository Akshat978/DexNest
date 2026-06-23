# DexNest Architecture Rules

## Main Principle

DexNest is one connected ecosystem, not a folder of unrelated apps.

## Structure

Use one main desktop shell:

```txt
apps/desktop
```

```txt
packages/action-registry
packages/local-db
packages/shared-types
packages/shared-ui
packages/voice
packages/encryption
```

Modules:

```txt
modules/command
modules/dev
modules/deck
modules/clipboard
modules/drop
modules/tools
modules/vault
modules/search
modules/capture
modules/finance
modules/journal
modules/calendar
modules/finder
modules/heatmap
modules/loop
```

## Desktop Rule

Use one Electron shell with internal routing.

Do not create separate Electron processes for each module.

## Background Rule

Only one lightweight core service should run in the background.

Allowed always-on:

- tray service
- action endpoint
- Command hotkey
- clipboard listener
- calendar nudges
- Drop server only when enabled

On-demand only:

- OCR
- PDF compression
- indexing
- embeddings
- local LLM
- backup compression
- Heatmap aggregation
- Loop analysis

## Mobile Rule

Android later uses Expo React Native.

PC is the brain. Android is the capture device.

## Connection Rule

Every module must:

- Register actions into DexNest Command
- Write useful events into the event log
- Use the shared local data root
- Avoid cloud by default
