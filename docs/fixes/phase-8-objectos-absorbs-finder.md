# Phase 8: ObjectOS absorbs Finder

Eighth phase of the fixes found in hands-on testing on 3 October 2026.

Finder and ObjectOS both recorded a physical thing and where it is, and the
owner had to ask how they differ. The decision was to keep one: ObjectOS, with
everything Finder did.

## What it does now

| Finder had | In ObjectOS |
|---|---|
| A five-second add: name, place, room | "Remember where something is" at the top of ObjectOS. It makes an object with only a name and a place; the rest can be added later |
| "Where is my…" | The same box, answering as you type with where each match is |
| Reverse lookup ("what is in the black drawer") | "What's in…", which also counts an object's components as being in it |
| Recently located, rooms, the item count | "Recently placed", room shortcuts, "12 things in 4 rooms" |
| Lent out, with who and since when | "Lent to…" and "It's back" on the object; the date a loan started is kept |
| Missing | "Mark missing" and "Found it" |
| I moved it | "I moved it": place, room, container |
| A screen and a sidebar entry of its own | Gone. "Open finder" by voice or the command bar opens ObjectOS |

Everything that reached Finder still works and now reaches ObjectOS: "where is
my passport" and "remember the passport is in the black drawer" by voice or
the assistant, Capture's "send to" (now labelled ObjectOS), the "still lent
out" nudge, and Search, which finds an object by its name or its place.

Existing Finder items are moved in on the first start: the file is copied to
`settings/finder-items.backup-before-objectos.json`, each item becomes an
object, and the original is renamed `finder-items.migrated.json`. What ObjectOS
has no field for goes into the notes in words ("Finder: not sure this is where
it is."). An item that cannot be moved stays in the file and is tried again on
the next start.

Three one-way links, each only when clicked:

- Purchase: **Add warranty end to Calendar**
- Maintenance: **Add to Calendar** on a schedule that falls due on a day
- Purchase: **Log this purchase in Finance**

They hand a name, a date and an amount to Calendar's or Finance's own "create"
action. ObjectOS reads nothing from either, so its rule ("never reads Finance,
Vault or any other module's data") still holds.

A backup made without "include files" now still carries ObjectOS's attached
files: its records are in the database, which is always backed up, and a
restore would otherwise list files that are not there.

## How

- `obj_whereabouts` (ObjectOS migration 3): one row per object with room,
  container, who has it, when it was lent, whether it is missing, and when its
  place was last set. The object record itself is unchanged.
- `quickAdd`, `locateObject`, `findObjects`, `whatIsIn`, `recentlyLocated`,
  `rooms`, `whereabouts` on the module; the action `object_os.object.locate`
  and the event `object.located` (flags only: never the place, the room or the
  borrower). ObjectOS's own export carries whereabouts and reads exports
  written before it existed.
- `apps/desktop/src/main/objectLocate.ts`: the bridge the old commands use.
  The `finder.*` action ids are kept, so saved voice phrases, pins and Deck
  buttons keep working; they are carried out in ObjectOS and titled in its
  words.
- `ObjectOsLocate.tsx`: the panel and the card on an object.
- Search records for objects have the source `object`; nudges made before the
  merge still open ObjectOS.

## What to know

- Voice, the command bar and the Deck can now add an object and change where
  one is, because Finder's commands could. Everything else in ObjectOS is
  still its own window only.
- Finder's "archived" becomes ObjectOS's "stored". Its "how sure" setting is
  kept as a line in the notes, not as a field.
- A migrated item reads "placed" on the day it was moved in, not the day
  Finder last touched it.
- A pin or Deck button that named one particular Finder item by its old id no
  longer finds it; commands by name are unaffected.
- "Clear data" has no Finder category any more. One for ObjectOS comes with
  the Settings work in phase 11.

## Not covered here

- Sending an attached manual or receipt to the Vault. Approved, not built:
  it needs the Vault's import path and its lock state, and belongs with the
  cross-module links in phase 13.
- Finance and Vault items shown inside ObjectOS (the reverse direction). The
  links here are send-only, which is narrower than what was approved.

## Tests

- `packages/object-os`: quick add and both lookups, moved / lent / returned /
  missing / found, the loan date surviving later edits, delete and
  export/import, and that a place, a room and a borrower never reach the log.
- Desktop: `objectOsHost.test.ts` (the locate action and channels, the bridge,
  the Finder migration), `objectOsModel.test.ts`, `objectOsView.test.mjs`
  (the panel, the card, and that the Finder screen is gone).
- Checked in the real app on a scratch data root seeded with an old Finder
  file of three items: the file copied aside and renamed; no Finder in the
  sidebar; the three items as objects with their places, borrower and loan
  date; both lookups; quick add; lent, back and moved on an object; the voice
  lookup, reverse lookup and "remember" actions; "open finder" opening
  ObjectOS; Search finding an object by its place; a warranty end arriving in
  Calendar on its day and a purchase in Finance with its amount.
