# L2: links that land on the record

Second of the leftovers after the fifteen fix phases.

## What it does now

| Before | Now |
|---|---|
| A chip such as "Sent to Finance: Tool shop" opened the Finance screen and left you to find the entry | It opens the entry |
| Things sent to the Calendar before phase 13 had no link | They get one the first time links are read after starting DexNest |
| In Calendar's Upcoming list a chip squeezed the event's title out of view | The chip sits under the title |

What "opens the record" means on each screen:

| Screen | What happens |
|---|---|
| ObjectOS | That object opens, whichever one was open before |
| Vault | That document's window opens |
| Journal | That entry is loaded into the editor, and its row is outlined |
| Finance | That entry is loaded into the form (a recurring bill into the recurring form), and its row is outlined |
| Calendar | That event is selected and shown under "Event detail", with Edit and Delete, however far away its date is |
| Capture | A capture that was sent on has no page of its own: its row under "Sent on" is scrolled to and outlined |

The outline goes away after a few seconds. Nothing animates.

## How

- `views/recordFocus.ts`: one request at a time, naming a module and a record
  id. The shell changes screen; that screen takes the request, shows the
  record and clears it. A request nobody takes (the record was deleted in the
  meantime) is dropped after eight seconds, so it cannot fire on a later
  visit.
- `useRecordFocus(module)` in `views/RecordLinks.tsx` is what each screen
  uses. Rows carry `data-record="module:id"` for the scroll and the outline.
- A screen opens a record only when it has that record. It never opens
  something else in its place.
- `backfillFromCalendar` in `main/recordLinks.ts`. A Calendar event has
  always recorded the module and id it came from, so the link can be made
  after the fact when that source still exists. It runs once per start, adds
  nothing twice, and reads nothing the Calendar had not already stored.

## Not covered here

- Only the Calendar can be back-filled. A capture sent to Finance, Journal,
  the Vault or ObjectOS before phase 13 left no record of which entry it
  became, so there is nothing to link from.
- Calendar's "Selected day" panel stays on today when a far-off event is
  opened this way: the screen resets it when it refreshes. The event itself
  is shown under "Event detail".
- A Vault document opens whether or not the Vault's secure area is unlocked,
  as clicking it in the Vault does. The secure area is not involved.
- Search results still open the module's screen, not the record.

## Tests

- `apps/desktop/test/recordFocus.test.ts`: the request (one screen, one at a
  time, newest wins, dropped when stale); every linked screen answering it;
  the back-fill, including events with no source, a deleted source, a synced
  event, and running twice.
- Root `pnpm test`: 2,378 tests pass; typecheck clean.
- Checked in the real app on a scratch data root, 13 checks: two earlier
  Calendar events getting their links on the first read and nothing added on
  the second; chips opening the exact Finance entry, the exact object (with a
  different one left open beforehand), a Calendar event in March 2027, the
  Vault document, the Journal entry and the capture's row; the outline
  clearing; a later plain visit reopening nothing.
