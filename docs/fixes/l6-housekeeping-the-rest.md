# L6: housekeeping, the rest

Sixth of the leftovers after the fifteen fix phases. It finishes what phase 11
(settings, sidebar and housekeeping) left open.

## What it does now

| Before | Now |
|---|---|
| The sidebar was reordered one place at a time, with buttons | A module can also be dragged onto another to take its place. The buttons are still there |
| "Clear data" had no entry for GhostOS, ObjectOS or Projects | All three can be cleared, each saying in words what goes and what stays |
| The "delete data" action was marked desktop-only but would have run for a request from the Deck endpoint that carried the confirmation text | It is refused from anywhere but DexNest's own window |
| The workspace said version 0.1.7 and the app 0.4.0 | Both say 0.4.0, and a test keeps them equal |

## Dragging the sidebar

- Drop a module on another and it takes that place; the ones between shift
  by one. The order is saved as before, in `settings/sidebar.json`.
- A drag that ends anywhere else changes nothing. Hidden modules stay hidden
  and are not a place to drop.
- `placeSidebarView` in `renderer/lib/sidebarLayout.ts`.

## Clearing GhostOS, ObjectOS and Projects

Phase 11 left these out because emptying their tables would have been wrong:
GhostOS keeps a search index and a record of what each source added,
ObjectOS has files on disk for each object, and Projects logs every add and
remove. They are now cleared **through the module's own calls**, the ones
their screens use (`main/moduleClear.ts`). No table is emptied directly and
no file is deleted outside the module.

| Category | What goes | What stays |
|---|---|---|
| **GhostOS** | Every entry, connection and observation. The link to your repositories is turned off | Entries you deleted earlier stay deleted. Connecting the repositories again brings those entries back |
| **ObjectOS** | Every object with its maintenance, purchases, readings and attached files; every part. The copies DexNest made of attached files are deleted from disk | The files you picked them from. Calendar events and Finance entries sent from ObjectOS |
| **Projects** | Every project in DexNest's list, with its commands and history here. Folder watching is switched off | Your folders and repositories. Nothing on disk is touched |

- The same confirmation as every other category: the typed word, and the
  offer of a backup first.
- If some of a module's data could not be removed, the result says so and
  how much did go, rather than reporting a clean sweep.
- A link from a cleared object or project to a record elsewhere goes with it.
- Each module works normally afterwards, GhostOS's search included.

## Data deletion from the window only

Found by this phase's real-app check, and older than it. An action's list of
allowed triggers is recorded in the registry but is **not enforced for every
action**. "Delete Selected DexNest Data" is listed for the command bar and the
window only, yet a request through the Deck endpoint that included the
confirmation text would have been carried out.

It is now refused, before the confirmation text is read, for any source
other than the window and the command bar. The refusal is logged.

**Not done, and worth a decision:** the same gap exists in principle for
other actions marked desktop-only. Enforcing the list for every action is a
wider change (voice opens several screens through actions that do not list
voice), so it was not made here. See "Not covered".

## The two skipped tests

Both are right to skip here, and were left as they are:

- The real HEIC decode runs when `DEXNEST_TEST_HEIC` points at a photo. No
  photo is in the repository; the real-app checks decode one.
- A file-link swap test needs administrator rights or Developer Mode on
  Windows to create the link at all.

## Not covered here

- **Trigger lists are still not enforced for every action.** Only data
  deletion was closed. A proper fix decides, per action, whether voice and
  routines count, and belongs in its own phase.
- GhostOS's record of entries you deleted before is kept on purpose, so
  clearing does not undo earlier deletions.
- Clearing Projects does not delete the scan's records or Standups; that is
  the "Repository scan and Standups" category.
- Dragging is with a mouse. There is no touch dragging; the buttons cover
  keyboard and touch.

## Along the way

- A design rule says focus and drop outlines are solid, not the faint ring
  token. The new drop outline broke it, and so did two outlines added with
  the record links in phase 13 and L2, which that rule's test did not look
  at. All three now use the solid token, and a test covers the link styles.

## Tests

- `apps/desktop/test/housekeepingRest.test.ts`: dragging up, down, to either
  end, onto itself, with hidden modules; each module cleared through its own
  calls, in order, with partial failures reported and no endless loop; no
  category naming those modules' tables; data deletion refused by source
  before anything else; the two version numbers equal.
- Root `pnpm test`: 2,419 tests pass; typecheck clean.
- Checked in the real app on a scratch data root with scratch repositories,
  22 checks: a module dragged up and another down, saved; the three
  categories listed with their counts and wording; nothing cleared without
  the confirmation, nor from the Deck, its endpoint or voice with it;
  ObjectOS cleared with its attached file gone from disk, the picked file and
  the Calendar event kept, the link gone; GhostOS cleared and no longer found
  by Search, then working again; Projects cleared with watching off, the
  repositories untouched, nothing added back, and a project addable again;
  the removals in the activity log.
