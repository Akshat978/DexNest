# DexNest

DexNest is an offline-first Electron + React + TypeScript desktop app.

This repository currently contains the initial monorepo foundation only: one desktop shell, shared types, shared design tokens, a local SQLite helper, an action registry, an event log schema, and placeholder module surfaces.

## Setup

```bash
corepack pnpm install
```

## Run Desktop App

```bash
corepack pnpm dev
```

## Build

```bash
corepack pnpm build
```

## Typecheck

```bash
corepack pnpm typecheck
```

## Local Data

DexNest stores real user data under:

```text
./local-data
```

The Electron shell sets its `userData` path to `./local-data/app` so app data does not go to the Windows AppData directory.

## Local Action Endpoint

The desktop app starts a localhost-only endpoint:

```text
POST http://127.0.0.1:43217/actions/:actionId
```

The initial Deck placeholder action is:

```text
POST http://127.0.0.1:43217/actions/deck.placeholder
```
