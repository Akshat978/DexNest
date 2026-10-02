# Integration QA: how the screenshots were made

**Both methods were used. Each screenshot's folder says which made it.**

| Folder | Made by | States |
|---|---|---|
| `screenshots/before/electron/` | **The real DexNest Electron app**, launched under `xvfb` (Linux) | `empty` (fresh data root, nothing seeded), `normal` (after seeding), `flows/` (click-throughs) |
| `screenshots/before/stub/` | **The Vite renderer with a stubbed preload bridge**, in Chromium (Playwright) | `loading`, `error`, `busy` |
| `screenshots/after/electron/`, `after/stub/` | The same two methods, after the phase 2 fixes | **Only screens that changed.** A screen missing from `after/` looked the same as in `before/` |

The stub is used only for states a healthy real app can't be put into on demand. For `loading` and `error`, the shell starts normally; the harness then makes every bridge read hang ("loading") or reject with "database is locked" ("error"), and opens the view. `busy` is the four new modules' large-dataset fixtures (500 objects, 4,200 GhostOS entries, 80 skills, level 42), taken from the UI audit's harness.

Every screenshot listed in `ISSUES.md` was actually captured and looked at. Nothing is described from code alone, except where a finding says so.

## The real app (Linux, under xvfb)

- `pnpm --filter @dexnest/desktop build`, then the renderer dev server on `127.0.0.1:5173` (development mode loads it from there).
- Electron 35.7.5 with `--no-sandbox` (the container runs as root) and a fresh `--user-data-dir` in a temp folder.
- **`DEXNEST_DATA_ROOT` is a fresh temp directory for every run.** No real data root was ever opened.
- `better-sqlite3` in the workspace is built for Node (ABI 127); Electron 35 needs ABI 133.
  - The Electron headers host (`electronjs.org`) is blocked in this container, so it could not be rebuilt.
  - Instead, the official prebuilt `better-sqlite3-v11.10.0-electron-v133-linux-x64` from the package's GitHub release was swapped in only while Electron ran. A trap always restores the Node build afterwards, so the Node tests are unaffected (checked by hash).
- Driven with Playwright's Electron support. Screenshots are taken at a content size of exactly 1280x800 and 1920x1080.

## Synthetic data

All seeded through the app's own bridge and actions: the same calls the UI makes. Nothing is real.

- **Older modules:** the app's own `demo.seed` action (clipboard, vault, finance, journal and calendar, capture and finder, timetable, news, deck).
- **Projects:** six small git repositories made by `harness/make-repos.sh` in a temp folder, each with a local bare "origin":
  - unpushed work with uncommitted changes, a stash and a feature branch;
  - a repository three commits behind its origin;
  - a clean Python repository;
  - one with no remote;
  - an old repository with a merged branch;
  - a Rust CLI.

  The add-project flow uses a seventh repository.
- **Developer Intelligence:** pointed at the same temp folder and scanned. **Skill Constellation** is then built from that scan (13 skills).
- **GhostOS:** 13 entries of every type, with 6 connections, 2 observations and a decision outcome.
- **ObjectOS:** 8 objects, with schedules, maintenance logs, parts, measurements, two settings versions, a modification, purchases (one warranty ending in 25 days) and a component.
- **Reality RPG:** the starter rules and achievements, two custom rules and two quests, then "apply to past activity" (220 XP).

## Reproduce

From `apps/desktop`, with the renderer dev server running on 5173 and the stub harness on 5199 (`npx vite --config ../../docs/integration/harness/vite.config.mjs`):

```sh
sh ../../docs/integration/harness/make-repos.sh /tmp/dexnest-int-work
xvfb-run -a node ../../docs/integration/harness/shoot-empty.mjs <out>
xvfb-run -a node ../../docs/integration/harness/shoot-normal.mjs <out> /tmp/dexnest-int-work/code
xvfb-run -a node ../../docs/integration/harness/shoot-flows.mjs <out> <seeded data root> /tmp/dexnest-int-work
node ../../docs/integration/harness/shoot-stub.mjs <out>
```

Run the Electron scripts with the Electron build of `better-sqlite3` in place, as described above.

## What these screenshots are not

- **Linux, not Windows.** Fonts render through Linux's FreeType, and scrollbars and native controls (`select`, date inputs) look like Linux Chromium's. Anything in `ISSUES.md` that may differ on Windows says so.
- **Autopilot** in the stub (`stub/autopilot-*`) shows the view error boundary. The stub bridge lacks `autopilotMorningBrief`, so this is a harness artefact, not a bug. The real app renders Autopilot (`electron/autopilot-*`).
- **Audit** is a hidden view. In the stub it can't be reopened after a reload, so it has no stub loading or error shots.
- **"Busy" means large data.** A long-running operation (for example a slow push) can't be held open in the real app on demand, so it was not captured.

Screenshots are JPEG (quality 62) to keep the repository manageable: 274 files, about 21 MB, in `before/`, and 68 files, about 5 MB, in `after/`.

In `after/electron/flows/`, three GhostOS steps (26–28: turning a source on and off) were added, so later step numbers are three higher than in `before/`.
