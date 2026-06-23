# DEXNEST DESIGN TOKENS — v1 LOCKED

Pitch black base, dark layered cards, neon per-module accents, Inter + JetBrains Mono.

## Core Palette

| Use | Token | Hex |
|---|---|---|
| App background | `--bg` | `#000000` |
| Main surface/cards | `--surface` | `#0A0A0A` |
| Elevated cards | `--surface-2` | `#111111` |
| Hover state | `--surface-hover` | `#111111` |
| Border | `--border` | `#262626` |
| Text primary | `--text` | `#F5F5F5` |
| Text secondary | `--text-muted` | `#A3A3A3` |
| Disabled text | `--text-disabled` | `#525252` |
| Default accent | `--accent` | `#22D3EE` |

## Module Accents

| Module | Token | Hex |
|---|---|---|
| Command | `--accent-command` | `#22D3EE` |
| Drop | `--accent-drop` | `#38BDF8` |
| Clipboard | `--accent-clipboard` | `#8B5CF6` |
| Tools | `--accent-tools` | `#F97316` |
| Vault | `--accent-vault` | `#10B981` |
| Search | `--accent-search` | `#6366F1` |
| Capture | `--accent-capture` | `#EC4899` |
| Finance | `--accent-finance` | `#22C55E` |
| Dev | `--accent-dev` | `#3B82F6` |
| Deck | `--accent-deck` | `#A855F7` |
| Journal | `--accent-journal` | `#F59E0B` |
| Calendar | `--accent-calendar` | `#14B8A6` |
| Finder | `--accent-finder` | `#84CC16` |
| Heatmap | `--accent-heatmap` | `#EF4444` |
| Voice | `--accent-voice` | `#06B6D4` |
| Loop | `--accent-loop` | `#EAB308` |

## Semantic Colors

| Use | Token | Hex |
|---|---|---|
| Success | `--success` | `#22C55E` |
| Warning | `--warning` | `#F59E0B` |
| Error | `--error` | `#EF4444` |
| Info | `--info` | `#38BDF8` |
| Focus ring | `--focus-ring` | accent color at 40% opacity |

## Typography

- UI font: Inter
- Technical font: JetBrains Mono
- Use JetBrains Mono only for commands, paths, logs, code, env vars, and action IDs.

## Non-Negotiable Rules

- Background is always `#000000`.
- Never render cards at pure black.
- Use the layer ladder: `#000000` → `#0A0A0A` → `#111111` → `#262626`.
- Accent is for borders, icons, glows, active states, and highlights.
- Accent is not for body text.
- Body text stays `#F5F5F5`.
- Secondary text stays `#A3A3A3`.
- Every interactive element must show a visible focus ring.
- Semantic colors signal state.
- Module accents signal identity.
- Do not mix semantic state and module identity.

## Logo

Black background, cyan DexNest mark `#22D3EE`.

Each module reuses the same logo shape and swaps cyan for the module accent.
