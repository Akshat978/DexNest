# Phase 13: search, voice and links

Thirteenth phase of the fixes found in hands-on testing on 3 October 2026.

## What it does now

| Before | Now |
|---|---|
| Search knew nothing of the newer modules | Search finds objects, skills, GhostOS entries, Reality RPG quests and achievements, Timetable blocks and waiting reminders |
| An object added a moment ago was not found until the index was rebuilt | It is found at once |
| A result with no file had no way to be opened | Every result has **Open**, which opens the module it belongs to |
| Sources and results were labelled `tools_ocr`, `dev`, `finance_transaction` | They are named as the sidebar names them |
| Voice knew only the older screens | "Open skills / projects / Reality RPG / GhostOS / ObjectOS / Autopilot / today / activity log", and questions a screen answers: "what needs me", "where did I leave off", "what are my skills", "what's my level", "which warranties are ending" |
| The Stream Deck export had no button for the newer screens, nor for Vault, Capture or Tools | A **Screens** group: ten buttons that open a screen |
| A capture sent to Finance did not know its entry, and the entry did not know its capture | Both show a chip: "Sent to Finance: …" and "From Capture: …". Clicking it opens the other module |
| ObjectOS could send to Calendar and Finance but not the Vault | **Send to Vault** on each attached file |

## How

### Search

- `src/main/moduleSearch.ts`. The newer modules are asked when a search is
  run. Nothing of theirs is written to the index file, so there is no second
  copy to go stale: a deleted GhostOS entry is gone from Search at once.
- GhostOS is asked through its own search, which matches title, notes and
  tags. The result carries the title and type, not the notes.
- A skill the user hid is not offered. A game that is off adds nothing.
  Dismissed reminders are not offered.
- The local intent model's prompt lists the newer screens.

### Voice and the Deck

- Voice opens the screen; the answer is read there. Nothing a module holds is
  spoken or sent anywhere.
- The five `*.open` actions for Today, Skills, Reality RPG, GhostOS and
  ObjectOS now allow the `deck` and `voice` triggers. Opening changes the
  screen on the desktop and returns nothing. **No other action of those
  modules is offered to the Deck**, and ObjectOS still refuses every change
  that does not come from DexNest's own window. Three tests that pinned "not
  Deck-exposed" now pin exactly this.
- The sidebar marks the open screen with `aria-current`.

### Links

- `src/main/recordLinks.ts`, saved in `settings/record-links.json` under the
  data root. A link is two ids and the two titles as they were when it was
  made. It gives neither module a way to read the other.
- Links are made when: Capture files something in Journal, Calendar, Vault,
  Finance or ObjectOS; a Calendar event or a Finance entry is created naming
  the record it came from (ObjectOS's "send to" buttons, Finance's recurring
  bills, Journal's extracted events); ObjectOS sends a file to the Vault.
- Editing a record adds no second link. A source that does not exist adds
  none. When either record is deleted the link is dropped, in the file too.
- Shown on: an object in ObjectOS, a Vault document, a Calendar event, a
  Journal entry, and as a short list in Finance ("Linked entries") and
  Capture ("Sent on"), which do not list their records one by one.
- `vault.import_from_object` copies one attached file into the Vault. The
  path comes from ObjectOS by file id, never from the request, and the action
  runs from DexNest's own window only.

## Not covered here

- The Heatmap overlay (item 78) is not built: it was a question and has no
  answer yet.
- A chip opens the other module's screen. It does not scroll to or select the
  record; the title on the chip is what to look for.
- Records sent on before this phase have no link. Calendar events keep the
  source they always had.
- The phone gets nothing new. The newer modules were built not to be phone
  exposed, and that is unchanged.
- Voice asks no module for an answer to speak. "What's my level" opens the
  screen that shows it.
- The Standup's own text is not searched. Projects are, as before.
- ObjectOS does not show Finance or Vault items inside itself (the reverse
  direction of item 87); it shows the links.
- The Deck buttons were checked through the action registry with the `deck`
  trigger, not over HTTP: the installed DexNest holds the port.

## Tests

- `apps/desktop/test/searchVoiceLinks.test.ts`: the search records, live and
  not indexed; names and screens; voice names and questions; what the Deck
  may run; links; Send to Vault.
- Updated: `objectOsHost.test.ts`, `todayView.test.mjs` (open only on the
  Deck), `objectOsModel.test.ts` (the Finance entry names its object).
- Checked in the real app on a scratch data root, 32 checks: each kind of
  result found; a GhostOS entry found by its notes without the notes in the
  result, and gone after deletion; nothing of the newer modules in the index
  file; four phrases typed into Ask DexNest each opening the right screen; a
  Deck-triggered open working while Deck-triggered changes to ObjectOS,
  GhostOS and the Vault were refused; links from Capture to Finance, Calendar
  and Journal and from ObjectOS to Calendar, Finance and the Vault, seen on
  screen from both ends; a manual copied to the Vault with ObjectOS keeping
  its own; a deleted Finance entry taking its link with it.
