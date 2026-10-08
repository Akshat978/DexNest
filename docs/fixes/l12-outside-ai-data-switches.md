# L12: Outside AI, what it may see and six more uses

The owner's design: "in settings, which data the AI can access". Then: "as
many sensible features as possible".

Everything here is off until switched on. Nothing here has been used against
the real service: it was tested against a stand-in on this computer.

## The data switches

Settings → Outside AI now has two lists.

**What Outside AI may see.** Six kinds of data, each with its own switch, all
off by default:

| Kind | What it lets leave the computer |
| --- | --- |
| What you say or type to DexNest | A command, a question, a sentence. 300 characters at most. |
| Capture notes | The title and text of one note. Never an attached file. |
| Package and tool names | Names from Skills. Names only. |
| Project names and commit subjects | The lines of the Standup on Today. |
| Lines of your code | The diff of a change about to be committed, with the names of the files in it, and the words of TODO comments. |
| Search results from the newer screens | Titles and short previews from Today, Skills, Reality RPG, GhostOS, ObjectOS, the Timetable and reminders. Eight at most. |

There is no switch for the Vault, Finance, the Journal, files and documents,
the clipboard or secrets. They cannot be turned on because no code path here
reads them.

**Where it is used.** Nine uses, each with its own switch. A use cannot be
ticked until the data it needs is on, and says what it needs. A use whose
data is later switched off stops, and sends nothing.

The check is made in the main process, in one place (`askOutside` in
`outsideAi.ts`): the main switch, the use's switch, every kind of data the
use needs, the private check, then the key. With a use off, the data is not
read at all.

A settings file from before these switches keeps what it already allowed
(commands, Capture) and gains nothing else.

## The six new uses

| Where | Button | Sent | What comes back, and what it does |
| --- | --- | --- | --- |
| Today | Say it in plain words | The Standup's lines, 40 at most | A few sentences, shown. Not saved. |
| Today, Open TODOs | Check which are real | The words of up to 25 TODO comments of one project. Not their files. | Each marked real or not. A tag is shown. Nothing changes. |
| Projects, Changes | Draft message | The diff, one page at most | A draft, shown. "Use this as the message" puts it in the box. Nothing is committed. |
| Skills | Ask which are tooling | Up to 40 names, not the languages | A list, each with Hide. Nothing is hidden until clicked. |
| Reality RPG, Rules | Fill in from this | One sentence you type | One of the built-in rules and a size of reward. The form is filled in. Nothing is saved. |
| Search | Answer from these | The search box, and up to eight matching results | Two sentences, shown with their sources. |

A button is shown only when its use is on, with its data and a key.

Two kinds of model are asked. The decision model (Jev) picks from a fixed
list: commands, Capture, and the Reality RPG rule. A writing model writes the
Standup sentences, the commit draft and the answer, and sorts skills and
TODOs by answering from a fixed set that DexNest checks. The writing model is
a setting ("Model that writes text"), with its own Test button.

## What keeps it safe

- **Secrets.** Before a diff is sent, a file whose name says it holds secrets
  (`.env`, keys, certificates, databases, anything under `local-data/`) is
  left out whole, and a line shaped like a key, a token, a password or an
  email is replaced with "[line withheld]". The screen says what was left out.
  The same line check drops Standup lines and TODO comments. This is a
  pattern check. It can miss a secret that does not look like one.
- **Private words.** A question, a sentence or a search result that mentions
  credentials, identity documents, money, a long number, an email or a link
  is not sent. "pay", "payment" and the like were added to the list.
- **Search answers** read only the newer modules, which Search asks live.
  The document index, the Vault, Finance, the Journal and the clipboard are
  not read.
- **The window sends an id or a question.** The main process gathers the
  data. A path outside the project, or the name of a secrets file, is refused.
- **Nothing acts.** Written text is shown, or offered for a box. A pick is
  checked against DexNest's own list; one that is not on it is discarded.
- **The log.** Every request, sent or refused, is one line in the activity
  log: which use, which kinds of data, how many characters, how long, the
  outcome. Never the text.
- **From DexNest's window only.** Not the Deck, the phone, voice or a hotkey.
- **Failures** (no network, no credit, an answer that is not text) come back
  as one plain sentence. Nothing else stops working.
- Performance Mode pauses all of it.

`AGENTS.md` ("Outside AI") was rewritten to say this. Its rule that a new use
needs the owner's yes and its own switch now also covers a new kind of data.

## Found while checking

- The Standup's lines carried an internal repository id and a report id.
  Project names are now sent in their place, and a line that still has an
  internal id is dropped.
- With a use switched off, the main process still read the data before
  refusing. It now refuses first.

## Checked

- `pnpm test`: all 14 packages, 2,451 tests pass. `pnpm typecheck`: clean.
  30 of them are Outside AI's (`outsideAi.test.ts`, `outsideAiUses.test.ts`).
- In the real app, on a scratch data root, against a stand-in service on this
  computer: 32 checks pass. As shipped everything is off and nothing is sent.
  With every use on and no data allowed, nothing is sent. Each button was
  clicked and what left was read: the secret line, the `.env` file, the
  passport's entry and every path on this computer stayed.
- One of five runs of that check went differently in its set-up: the Standup
  said "No activity in window" and no TODOs were listed. It did not happen
  again and the cause is not known. It is in the scan's set-up, before
  anything of L12 runs.

## Not done, and limits

- **Not tried against the real service.** The request shapes follow
  OpenRouter's documentation. The default writing model
  (`anthropic/claude-haiku-4.5`) is a guess at a name OpenRouter offers; if
  "Test the writing model" fails, put another model's name in the box.
- The Autopilot risk check was not built. Autopilot's design document governs
  what a run may send, and this was not the place to change it.
- A worklog draft was not built; the commit draft covers the same ground.
- The commit draft reads one page of the change. A large change is cut, and
  the screen says so.
- The TODO check reads the first 25 open TODOs of a project.
- What OpenRouter and the model's provider do with a request is governed by
  their terms. DexNest asks them not to keep it; it cannot make them.
