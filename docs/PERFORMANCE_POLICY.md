# DexNest Performance Policy

## Core Principle

DexNest should feel always available, not always busy.

## Target Idle Usage

| Mode | Target |
|---|---|
| Tray/core service | 100–300 MB RAM |
| Idle CPU | near 0% |
| GPU | 0% |
| Desktop open | acceptable temporary RAM increase |
| Heavy tasks | user-triggered only |

## Always-Ready Core

These may stay active:

- Command hotkey
- clipboard listener
- Deck localhost endpoint
- tray icon
- light notification/nudge service
- local action registry
- Drop server only when enabled

## Cold Workers

These start only when needed:

- OCR
- PDF compression
- image conversion
- search indexing
- embeddings
- local LLM
- backup compression
- Heatmap aggregation
- Loop pattern detection
- Ambient voice

## Performance/Gaming Mode

When enabled:

- pause OCR
- pause indexing
- pause Heatmap aggregation
- pause Loop
- pause Ambient Voice
- pause backups
- pause file watchers
- keep only Command, Clipboard basics, Deck, and urgent reminders

## Heatmap Policy

Heatmap should be light.

- Sample active window every 60 seconds by default.
- Aggregate summaries every 3 hours.
- Pause when idle.
- Pause in fullscreen games.
- No keylogging.
- No screenshots.
- No screen recording.
- No content capture.

## Voice Policy

- Click-to-speak first.
- Ambient wake word later only.
- Ambient off by default.
- Visible listening indicator required.
- Local-only processing.
- No cloud STT by default.
