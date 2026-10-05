# Phase 14: Outside AI, step 1

Fourteenth phase of the fixes found in hands-on testing on 3 October 2026.

This phase changes a project rule. Until now Autopilot was the only place
DexNest could use an AI service on the internet. `AGENTS.md` now allows one
more, **Outside AI**, under the conditions in its new section. With Outside AI
off, which is how it ships, nothing in this phase sends anything.

## What it does now

| Before | Now |
|---|---|
| A command the local rules could not place went to the local model, if one was installed, or to "I'm not sure" | With Outside AI on, the words of that command can be sent to a decision service, which picks one meaning from a fixed list |
| No way to add an OpenRouter key | **Settings → Outside AI**: save a key, test it, remove it |
| | Separate switches for commands you speak and commands you type, and how sure an answer must be |

## The safeguards

- **Off by default.** Three things must be true before anything is sent: a
  key is saved, Outside AI is on, and the place it is used is on.
- **The key** is stored encrypted (Windows DPAPI, through Electron), read only
  when a request is made, never logged, never sent back to the window.
  Removing it turns Outside AI off.
- **What is sent:** the words of one command, 300 characters at most.
- **What is never sent:** anything from the Vault, Finance or Journal, files,
  the clipboard, search results, projects. A command that mentions a
  password, an identity document, money, a long number, an email or a link is
  kept on this computer and routed locally (`privateReason`).
- **Only when unsure.** A command the rules understand is never sent.
- **The service picks, DexNest acts.** The service chooses an intent, and for
  "open a screen" which screen, from DexNest's lists. An answer that names
  anything else is discarded. DexNest builds the action from its own tables.
- **Always confirmed.** What Outside AI suggested shows as "Outside AI
  suggests: …" with Confirm and Cancel, even for opening a screen.
- **Sure enough.** An answer below the set confidence (70% by default, never
  under 50%) is ignored.
- **Falls back.** No network, no credit, a refused key, a changed API, a slow
  answer (4 seconds): the local path carries on.
- **Logged.** Every request writes one line to the event log: the service,
  the model, where it was used, the length of the text, how long it took, what
  was decided. Not the text.
- **From DexNest's own window only.** The Deck, voice and the phone cannot
  change these settings.
- Performance Mode pauses it, as it pauses the local model.

## How

- `src/main/outsideAi.ts`: settings, the private check, the request, reading
  the answer, the confidence rule, every failure as a reason. No Electron.
- The service is Jev (`typesafe/jev-1.13`) through OpenRouter's Decisions
  endpoint, `POST https://openrouter.ai/api/alpha/decisions`. The request sets
  `provider.data_collection` to `deny`.
- `main.ts`: the key in the integration keychain, `settings/outside-ai.json`,
  three IPC calls (state, set key, route) and three registered actions
  (update settings, remove key, test).
- `views/OutsideAiSettings.tsx`, `views/outsideAiModel.ts`.
- The command router asks Outside AI before the local model, and only when
  the rules are unsure and did not mark the command sensitive.

## Not covered here

- **Not tried against the real service.** No key was available, and none was
  asked for. Everything was checked against a stand-in on this computer that
  answers in the shape OpenRouter documents. The first real use should be the
  **Test** button.
- OpenRouter marks the endpoint alpha. If its shape changes, answers stop
  being understood and DexNest carries on locally; the fix is in one file.
- "Ask the provider not to keep it" is a request DexNest cannot enforce. The
  card says so.
- The private check is a list of words and patterns. It errs towards keeping
  things local, and it can still miss a private command phrased in none of
  those words. What is sent is only ever what was said or typed as a command.
- The command bar at the top (Ctrl+K) is a list of actions and is not routed.
  "Typed" means the Ask DexNest box.
- Only routing. Capture, Skills, the Standup in plain words, drafts and
  answers are phase 15, each needing its own switch.
- No count of requests or spend is shown; OpenRouter's own page has it.

## Tests

- `apps/desktop/test/outsideAi.test.ts`: off by default; nothing sent while
  off, without a key or for a surface that is off; eighteen private-looking
  commands held back; the exact request; answers off the list discarded; the
  confidence rule; each failure; the key kept to the main process; the log
  line; the actions' triggers; the router; the wording of `AGENTS.md`.
- Checked in the real app on a scratch data root against the stand-in, 27
  checks: off as shipped and sending nothing; the card's wording; a wrong key
  refused; a key saved, not on disk in the clear and never returned; Test
  sending one fixed phrase; on-but-allowed-nowhere sending nothing; a clear
  command not sent; an unclear one sent as its words only, and acted on only
  after Confirm; an unsure answer ignored; an answer naming an action not
  followed; a 402 leaving the app working; five private commands never sent;
  the log holding every request and none of the words or the key; the Deck
  refused; removing the key turning it off.
