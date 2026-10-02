# Integration merge notes (`cloud/integration`)

`cloud/integration` was created from `main` (`6140a2f`). The five module branches were merged into it with `--no-ff`, one at a time, in the order asked:

| # | Branch | Module | Head merged |
|---|---|---|---|
| 1 | `claude/admiring-babbage-kbw2ew` | Skill Constellation | `376fda3` |
| 2 | `cloud/reality-rpg` | Reality RPG | `b45361e` |
| 3 | `cloud/ghost-os` | GhostOS | `697f19d` |
| 4 | `cloud/object-os` | ObjectOS | `46e6674` |
| 5 | `cloud/projects` | Projects (also brings `cloud/ui-fixes`) | `f73e5eb` |

All five branch from `main` at the same commit, so every conflict is two or more modules adding to the same shared lists: the action registry, `main.ts`, the preload, the renderer bridge, the sidebar meta, `main.tsx`, `shared-types`, `tsconfig.base.json`, `tsconfig.node.json`, the package files and the lockfile.

**Rule used throughout:** keep every module's entries. Nothing from any module was dropped or changed, except the one test adaptation listed at the end.

**How the conflicts were resolved.** Hunk-by-hunk resolution was not safe here. When two modules append similar-looking blocks (for example, four registry actions each), git interleaves them field by field. Each file was therefore merged as a whole, from the three versions git keeps (base, ours, theirs):

- **Both sides only add lines.** Every insertion is applied; where both insert at the same point, the earlier-merged module comes first. Checked: no side deletes or changes a base line.
- **One side also edits existing lines.** This happened only with Projects, in `main.ts`, `preload.ts` and `main.tsx`. A line-level three-way merge applies both sides' changes where they touch different base lines, and refuses if they overlap. There were no overlaps.
- **Independent check of each three-way merge.** Going from either side to the result adds and removes exactly the lines the other side changed. All three files pass.
- **Single-line lists** (icon imports, `ViewId`, unions, `include` arrays, the root `test` chain) were merged by hand into one line containing every item.

## Conflicts, per merge

### 1. `claude/admiring-babbage-kbw2ew` (Skill Constellation)

Merged onto `main` without conflicts (it was the first branch).

### 2. `cloud/reality-rpg` (onto Skill Constellation)

Every conflict was the two modules adding at the same spot; all entries of both are kept, Skill Constellation first.

| File | Conflict | Resolution |
|---|---|---|
| `packages/action-registry/src/index.ts` | Both appended their actions after `standup.generate`; git interleaved the two blocks entry by entry | Pure insertions on both sides: base, then the whole Skill Constellation block (4 actions), then the whole Reality RPG block. Not resolved hunk by hunk, which would have mixed fields of different actions |
| `packages/shared-types/src/index.ts` | Both added a `DexNestModuleId` member | Union: `"skill_constellation" \| "reality_rpg"` |
| `apps/desktop/src/main/main.ts` | Host import, settings path, `start…Host()` functions, open-view map, start and dispose calls | Pure insertions on both sides: both hosts imported, both settings files, both start functions in full, both open entries, both started and disposed |
| `apps/desktop/src/main/preload.ts` | Both added their bridge methods at the same place | Both sets kept |
| `apps/desktop/src/renderer/lib/bridge.ts` | Fallback settings constants and fallback bridge members | Both constants and both sets of fallback members |
| `apps/desktop/src/renderer/main.tsx` | View import, `DexNestBridge extends …`, view render | Both imports and renders; `DexNestBridge extends SkillConstellationBridge, RealityRpgBridge` |
| `apps/desktop/src/renderer/lib/moduleMeta.ts` | Icon import, `ViewId` union, sidebar entry, module meta | Both icons (`Stars`, `Swords`), both ids (`skills`, `rpg`), both sidebar entries and meta |
| `apps/desktop/tsconfig.node.json` | Each added its two host/model test files to `include` | All four test files included |
| `package.json` | Each added its package to the root `test` chain | Both, in the order skill-constellation, reality-rpg |
| `tsconfig.base.json` | Each added a path alias | Both aliases |

`pnpm-lock.yaml` merged without conflict; `pnpm install --frozen-lockfile` passes. `pnpm typecheck`: 0 errors.

### 3. `cloud/ghost-os`

Same pattern: GhostOS added at the spots the first two modules had used. All entries kept, GhostOS after Reality RPG.

| File | Conflict | Resolution |
|---|---|---|
| `apps/desktop/src/main/main.ts` | Host import, settings path, start function, open-view map, start and dispose calls, action routing | Pure insertions on both sides: everything from all three modules kept |
| `apps/desktop/src/main/preload.ts` | Bridge methods at the same place | All three sets kept |
| `apps/desktop/src/renderer/lib/bridge.ts` | Fallback constants and members | All kept |
| `apps/desktop/src/renderer/main.tsx` | View import, `DexNestBridge extends`, view render | All kept; `extends SkillConstellationBridge, RealityRpgBridge, GhostOsBridge` |
| `apps/desktop/src/renderer/lib/moduleMeta.ts` | Icon import, `ViewId`, sidebar entry, meta | `Ghost` icon, `ghost` view id, sidebar entry "GhostOS", meta, all alongside the others |
| `apps/desktop/tsconfig.node.json` | Test files in `include` | All six module test files |
| `package.json` | Root `test` chain | `ghost-os` added after `reality-rpg` |
| `packages/shared-types/src/index.ts` | `DexNestModuleId` member | `"ghost_os"` added to the union |

The action registry merged without conflict. Lockfile frozen install passes; `pnpm typecheck`: 0 errors.

### 4. `cloud/object-os`

| File | Conflict | Resolution |
|---|---|---|
| `packages/action-registry/src/index.ts` | ObjectOS appended its actions at the same place as the others, plus an entry near the end of the file | Pure insertions: all four modules' blocks kept in merge order |
| `apps/desktop/src/main/main.ts`, `preload.ts`, `renderer/lib/bridge.ts` | Host, settings, start/dispose, routing, bridge methods, fallbacks | Pure insertions: all kept |
| `apps/desktop/src/renderer/main.tsx` | Import, `DexNestBridge extends`, render | All kept; `extends …, GhostOsBridge, ObjectOsBridge` |
| `apps/desktop/src/renderer/lib/moduleMeta.ts` | Icon, `ViewId`, sidebar, meta | `Package` icon, `object` view, "ObjectOS" entry, meta |
| `apps/desktop/tsconfig.node.json` | Test files in `include` | All eight module test files |
| `package.json` | Root `test` chain | `object-os` after `ghost-os` |
| `packages/shared-types/src/index.ts` | `DexNestModuleId` | `"object_os"` added |
| `apps/desktop/package.json` | Both sides added workspace dependencies in the same list | Union: `ghost-os`, `object-os`, `reality-rpg`, `skill-constellation` all kept |
| `pnpm-lock.yaml` | Desktop's new `@dexnest/object-os` link, and the `packages/object-os` importer (git fused it with `packages/reality-rpg`, which has an identical body) | `pnpm install --lockfile-only --offline` could not run: the offline cache has no registry metadata for `typescript`, and I did not want to reach the registry. Resolved by hand instead: our lockfile, plus the desktop link and the `packages/object-os` importer block copied verbatim from `cloud/object-os`, both in pnpm's alphabetical order. Only workspace links changed (no external package). `pnpm install --frozen-lockfile --offline` validates it and passes |

`pnpm typecheck`: 0 errors.

### 5. `cloud/projects`

Projects is the only branch that **edits** existing lines (not just adds): in `main.ts` it routes save/delete/touch, `git_push`, `open_vscode` and `open_terminal` through Projects, and in `renderer/main.tsx` it removes `DevView` and its helpers. Those files were merged three-way, line by line: each side's changes applied where the other side didn't touch the same base lines, with insertions at the same point in merge order. The tool refuses truly overlapping edits; there were none. A second, independent check confirmed that, for each file, going from either side to the result adds and removes exactly the other side's changes.

| File | Conflict | Resolution |
|---|---|---|
| `apps/desktop/src/main/main.ts` | Host imports, settings paths, start functions, start/dispose calls (insertions), plus Projects' edits to existing Dev functions | Three-way merge: 8 changes from the integration side, 14 from Projects, none overlapping. All five hosts are imported, started and disposed |
| `apps/desktop/src/main/preload.ts` | Bridge methods; Projects also changed the first line (import) | Three-way merge, verified |
| `apps/desktop/src/renderer/main.tsx` | View imports and renders (insertions); Projects replaces the `dev` view with `ProjectsView` and deletes `DevView` | Three-way merge (3 + 19 changes), verified. Every module's view still renders |
| `packages/action-registry/src/index.ts` | Projects' 29 `projects.*` actions next to the other modules' blocks | Pure insertions: all kept |
| `tsconfig.base.json` | Path aliases | All kept (`@dexnest/projects`, `/domain`, `@dexnest/git-ops` with the others) |
| `apps/desktop/package.json` | Workspace dependencies | Union: `git-ops`, `projects`, `standup` added to the others |
| `package.json` | Root `test` chain | Projects' `projects`, `git-ops` (after foundation, as on its branch) plus all the module packages |
| `packages/shared-types/src/index.ts` | `DexNestModuleId` | `"projects"` added to the union |
| `pnpm-lock.yaml` | Workspace links | Same approach as ObjectOS: our lockfile plus Projects' changes copied verbatim (desktop links to `git-ops`, `projects`, `standup`; importers `packages/git-ops`, `packages/projects`) in alphabetical order. Only workspace links. `pnpm install --frozen-lockfile --offline` passes |

`cloud/projects` already contained `cloud/ui-fixes` (bundled fonts, view error boundary, focus outline), so that work arrives with it. `pnpm typecheck`: 0 errors.

## Test adaptation after the merge

`apps/desktop/test/objectOsView.test.mjs`, "the shell routes to it", asserted the exact text `export interface DexNestBridge extends ObjectOsBridge`. After integration that line extends all four module bridges.

The assertion now requires `ObjectOsBridge` to be among the extended bridges: `/export interface DexNestBridge extends [^{]*\bObjectOsBridge\b[^{]*\{/`. This is the same claim, not a weaker one. Removing `ObjectOsBridge` from the list still fails the test (checked). Commit `98ce6c6`.

## Things checked after merging

- **Host start and dispose order.** The UI audit warned that an automatic merge once put host starts inside `second-instance` and disposes inside `activate`. Here, all five hosts start in `app.whenReady()` after `registerIpcHandlers()`, with Developer Intelligence before Skill Constellation and GhostOS. All five are disposed in `before-quit`.
- **`pnpm install --frozen-lockfile --offline`** passes after every merge.
- **`pnpm typecheck`** shows 0 errors after every merge.

## Gate (Linux), each package run separately

| Package | Pass | Fail | Notes |
|---|---|---|---|
| foundation | 47 | 0 | The baseline failure `tests refuse the real data root` is fixed on the Skill Constellation branch (`e6577c2`), so it now passes |
| projects | 139 | 0 | |
| git-ops | 45 | 0 | |
| dev-intelligence-store | 10 | 0 | |
| dev-intelligence | 86 (+1 skipped) | 2 | Baseline by name: `EC-006: permission-denied path isolated; others proceed`, `refuses a root inside DexNest's data, by path and through a junction` |
| standup | 25 | 0 | |
| skill-constellation | 135 | 0 | |
| reality-rpg | 126 | 0 | |
| ghost-os | 175 | 0 | |
| object-os | 142 | 0 | |
| autopilot-runtime | 668 | 17 | Baseline by name: the 17 listed in `docs/modules/object_os/LINUX_BASELINE.md` (21 `not ok` lines = 17 tests + their 4 suites), identical |
| today | 13 | 0 | |
| action-registry | 26 | 0 | |
| attention | 107 | 0 | |
| run-queue | 164 | 0 | |
| desktop | 375 | 0 | 374 + 1 before the test adaptation above |

No failure outside the Linux baseline.
