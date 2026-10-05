# L7 to L12: what was built, and what was not

The owner left these six to judgement ("do whatever you feel like"). Two
things were built, one was already done, and three were left alone on
purpose. This note says which, and why.

| Phase | Outcome |
|---|---|
| L7 ObjectOS shows what it is linked to | Already done by phase 13 and L2. Nothing more built |
| L8 Heatmap overlay | **Built** |
| L9 Reality RPG counts journal, finance and vault entries | Not built: needs an explicit yes |
| L10 Deck and phone for the newer modules | Not built: needs an explicit yes. The Deck endpoint was **tightened** instead |
| L11 Outside AI, proven | Cannot be done yet: it needs a real key tried by the owner |
| L12 Outside AI, more uses | Not built: needs an explicit yes per use |

## L7: already there

An object in ObjectOS shows a chip for each thing it was sent on to
("Sent to Finance: Tool shop", "Sent to Calendar: Warranty ends…", "Sent to
Vault: …"), and since L2 a chip opens that exact record. Showing the amount
or the document inside ObjectOS would mean ObjectOS reading Finance and the
Vault, which it was built not to do, for no more than the chip already gives.

## L8: the Heatmap also shows what you did in DexNest

- The Heatmap showed which windows were in front. Below that grid there is
  now a second one, **Done in DexNest · last 28 days**: the things you set
  off in DexNest itself, by weekday and hour, and the modules used most.
- It is counted from the activity log every action already writes to, when
  the Heatmap is opened. Nothing is collected for it, nothing is saved, and
  no timer runs.
- Only what was set off by hand counts (the window, the command bar, voice, a
  hotkey, a Deck button, a routine). What DexNest does by itself, such as a
  scheduled scan, does not.
- Only counts leave the main process: no titles, no text.
- At most the latest 5,000 log entries are read. If the period holds more,
  the card says busy weeks may be undercounted.
- `main/activityOverlay.ts`; `dexnest:heatmap-activity`.

## The Deck endpoint now runs only what is marked for the Deck

Found in L6: an action's list of allowed triggers was recorded but not
enforced. L6 closed it for data deletion. This closes it for the one way into
DexNest that is not its own window, the Stream Deck HTTP endpoint.

- A request through the endpoint is refused unless the action lists the Deck
  among its triggers. It is refused before any confirmation is read, and the
  refusal is logged.
- The endpoint's list of actions no longer offers what it would refuse.
- **Nothing DexNest exports for the Deck is affected**: all 63 buttons in the
  export, the per-project buttons, and the routes the endpoint calls by name
  are marked for the Deck. A button someone made by hand for an action that
  is not marked would stop working, and that is the intent.
- 109 actions are now unreachable from the endpoint, among them deleting a
  backup, discarding changes in a repository, deleting a branch, every
  Outside AI setting, and everything in ObjectOS, GhostOS, Skills and
  Reality RPG.
- This is the opposite direction to L10. L10 asked whether the newer modules
  should be opened up to the Deck; nobody said yes, and the check in L6 showed
  the endpoint was wider than its own markings. So it was narrowed to them.

**Not done:** triggers are still not enforced for voice, hotkeys or routines.
Voice opens several screens through actions that do not list voice, so that
needs each action looked at, not a blanket rule.

## L9, L10, L12: why they wait for a plain yes

Each would change something a module was deliberately built to refuse, and
its own tests hold that refusal:

- **L9** edits Reality RPG's privacy list so it may count that a journal,
  finance or vault entry was made.
- **L10** opens Today, Skills, Reality RPG, GhostOS and ObjectOS to the Deck
  and the phone. Phase 13 did this once without asking and it was reversed in
  the finish phase.
- **L12** sends new kinds of content to an outside service (commit subjects,
  repository names, source code, search results).

"Do whatever you feel like" is a fair instruction for how to build something.
It is not taken here as permission to remove a privacy rule. Each of these
needs the owner to say yes to that specific thing.

## Tests

- `apps/desktop/test/overlayAndDeckEndpoint.test.ts`: the grid by weekday and
  hour; only by-hand events in the period; a cut-off read saying so; counts
  only; the endpoint's check sitting before confirmation; destructive actions
  off the Deck; every exported button still marked for it.
- Root `pnpm test`: 2,426 tests pass; typecheck clean.
- Checked in the real app on a scratch data root, 14 checks: six actions done
  and counted in the current hour's cell and under their modules; nothing but
  counts returned; the second grid on the Heatmap with 168 cells and its
  wording; a Deck-marked action running from the endpoint; seven unmarked
  ones refused there with confirmation supplied, nothing deleted, and each
  refusal logged; the same actions still running from the window.
