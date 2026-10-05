# Phase 15: Outside AI, step 2 (Capture only)

Fifteenth phase of the fixes found in hands-on testing on 3 October 2026.

The plan listed eight further uses of Outside AI. The user left the choice
open, and **one was built**. The other seven were left out on purpose; the
reasons are below.

## What it does now

| Before | Now |
|---|---|
| Each note in the Capture inbox is filed by picking one of six buttons | With Outside AI switched on for Capture, each text note also has **Suggest**. It answers "Outside AI suggests: Send to Calendar", and clicking that files it |

- It has its own switch in **Settings → Outside AI**, off by default. Turning
  Outside AI on for commands does not turn it on for Capture.
- **Sent:** that one note's title and text, 300 characters at most, when
  Suggest is clicked. Never automatically, never for the whole inbox.
- **Never sent:** an attached file, or anything about a capture that has one
  (no button, and the action refuses it). A note that reads like a Vault or
  Finance item (a receipt, an amount, a bank, an identity document, a
  password, a prescription) is kept on this computer.
- **What can be suggested:** Calendar, Journal, ObjectOS, Drop, or nothing.
  The Vault and Finance are not on the list, and an answer naming either is
  discarded.
- **Nothing moves by itself.** The suggestion is a button. Filing the note is
  the user's click, through the same action the six buttons use, so the link
  back from phase 13 is made as usual.
- An unsure answer, or "leave it", shows "No clear suggestion for this one".
- Logged like every Outside AI request: when, how long, what was suggested.
  Not the note's words.

## Why the other seven were not built

| Use | Why not now |
|---|---|
| Skills: real skill or tooling | Phase 5 already separates them with weights, locally |
| Repository scan: real TODO or not | Phase 1 already counts only real comment TODOs, locally. This would send lines of source code |
| Autopilot: risk check on a run | Autopilot has its own design document and its own boundary; this would send what a run is about to do |
| Standup in plain language | Sends repository names and commit subjects, which every module so far keeps on this computer |
| Worklog and commit message drafts | Sends diffs: source code |
| Ask: answers over search results | Search results include Vault documents, Finance entries and the Journal. This is the one the rule exists to prevent |
| Reality RPG: a rule in plain English | Phase 9's pick-list already does this without sending anything |

Two more reasons apply to all of them. The plan made this phase depend on
phase 14 proving accurate on the user's own commands, and phase 14 has not
yet been used with a real key. And five of the seven need a model that writes
text, which is a different service and a different kind of content leaving the
computer than a model that picks from a list.

Any of them can be built later. `AGENTS.md` asks for the user's explicit yes
and a separate switch for each.

## How

- `outsideAi.ts`: a third surface, `capture`; `CAPTURE_CRITERIA`,
  `buildCaptureRequest`, `parseCaptureSuggestion`, `suggestCaptureRoute`. The
  switches, the private check and the key are now checked in one function
  that both uses go through.
- Action `outside_ai.suggest_capture_route`, from DexNest's own window only.
  It takes a capture's id, never text.
- `AGENTS.md`: "what may be sent" now lists two things.

## Not covered here

- **Not tried against the real service**, like phase 14: no key was available
  and none was asked for. Checked against a stand-in on this computer.
- The private check is the same list of words and patterns as for commands.
  It leans towards keeping things local, so some harmless notes will get
  "that looked private" instead of a suggestion.
- ObjectOS still asks where the thing is when the suggestion is clicked, as
  the ObjectOS button does.

## Tests

- `apps/desktop/test/outsideAi.test.ts`, four more: its own switch; only the
  note's words; Vault and Finance never suggested and such notes never sent;
  "leave it" and unsure answers; the action taking an id and moving nothing.
- Checked in the real app on a scratch data root against the stand-in, 16
  checks: no button while off, or while on for commands only; the switch and
  its wording; a button on each text note and none on a capture with a file;
  one click sending one note's words; the suggestion shown with nothing
  moved; clicking it filing the note with its link; a receipt never sent; an
  unsure answer and an answer naming the Vault not offered; a capture with a
  file refused; the Deck refused; the log holding each request and none of
  the words.
- Phase 14's real-app check was run again: 26 of 27, the one difference being
  the reworded summary line it looks for.
