# L9 and L10: counted entries, and the newer screens on the Deck

Two of the leftovers that needed the owner's yes. He gave it on 5 October
2026, to each by name.

## L9: Reality RPG counts that an entry was made

| Before | Now |
|---|---|
| Reality RPG could not see anything of the Journal, Finance or the Vault | It can count **that** an entry was made in one of them. Nothing else |

### Exactly three things

| What you do | Rule | XP |
|---|---|---|
| Start a journal entry | Wrote in your journal | 8, once a day |
| Log something you spent | Logged what you spent | 2, up to ten a day |
| Add a document to the Vault | Filed a document in the Vault | 4, up to five a day |

Plus two quests (journal on 5 days this week; log spending on 3 days this
week) and five achievements (a week, a month and a hundred days of
journalling; fifty entries logged; ten documents filed).

### What the game sees, and what it does not

- Of a counted entry it sees what it sees of any other event: **the action's
  name and when**. Not the entry, its title, its text, a mood, a shop, an
  amount, a category or a file name. Not even the module's name.
- Only when the action succeeded.
- **Everything else those modules do is still invisible to it**: opening,
  editing, deleting, searching, unlocking the secure vault, revealing a
  secret, attaching a receipt, recurring bills. Editing an entry earns
  nothing.
- A rule of your own may count these three and may ask nothing else of those
  modules. "Every journal action", "unlocked the vault", or a rule that names
  the module, is refused in the same words as before.
- Filing a capture into the Vault, Finance or the Journal is still not
  counted by the capture rule.

### How

- `packages/reality-rpg/src/domain/privacy.ts`: `COUNTED_ENTRIES` (the three
  actions and the event type each is logged under), `isCountedEntry`,
  `countsEntriesOnly`. The header says what changed, when and on whose word.
- `projection.ts` lets a counted entry through, without its module.
- `validation.ts` accepts a rule that counts entries only.
- One existing test was changed, with the owner's yes: the built-in set "names
  nothing from vault, finance or journal" now says "except the three". The
  six other privacy tests in that package pass unchanged.

## L10: the Stream Deck can open the five newer screens

| Before | Now |
|---|---|
| No Deck button for Today, Skills, Reality RPG, GhostOS or ObjectOS | Five buttons in the **Screens** group that open them |

- A button shows the screen on the desktop. **Nothing a screen holds is sent
  to the Deck**: the reply is "opened", and no more.
- **No other action of those modules is on the Deck.** Through the endpoint,
  saving a rule, turning the game off, saving or deleting a GhostOS entry or
  an object, and rebuilding Skills are all refused, as they were.
- Seven tests held "not Deck-exposed". With the owner's yes they now hold
  "only opening the screen is on the Deck", module by module.

### The phone: not built

The yes covered the Deck and the phone. The phone part was not built, for a
reason that is not about permission: there is nothing small to switch on. A
Deck button opens a screen on the desktop. A phone cannot do that; "phone
access" means showing Today, Skills or your things **on the phone**, which
needs screens designed for it and the data sent to it over the network.
`AGENTS.md` lists mobile as not requested, and it is a project of its own.
None of these modules' actions is phone-exposed, and tests hold that.

## Not covered here

- Reality RPG counts a journal entry when it is first created. Opening
  today's entry again and adding to it is an edit, and earns nothing.
- A Vault document added by sending a file from ObjectOS or a capture is not
  counted: only adding one in the Vault itself.
- XP already earned is not recalculated; the three rules count from when
  they are turned on.

## Tests

- `packages/reality-rpg/src/__tests__/counted-entries.test.ts`: the list is
  three; an action counts only under its own type; what is kept of an entry
  and what is not (titles, text, amounts, file names); failures, edits,
  deletes, unlocks and reveals dropped; a counted action logged any other way
  dropped; rules that count entries accepted, anything wider refused.
- The four module packages' Deck tests, and three desktop ones.
- Root `pnpm test`: 2,437 tests pass; typecheck clean.
- Checked in the real app on a scratch data root, 14 checks: the start
  screen offering the three and saying "only that you did"; a journal entry,
  a spend of 1,299.50 at a named shop and a Vault document each earning XP;
  none of their titles, text, amounts or names anywhere in the game or its
  history; editing, opening and a second journal entry earning nothing; two
  wider rules refused; each of the five opens working from the Deck endpoint
  with a reply that carries nothing; seven other actions of those modules
  refused there.
