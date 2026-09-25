# Reality RPG - plan

Module id `reality_rpg` · table prefix `rpg_` · event namespace `rpg.` ·
event stream `rpg` · view id `rpg` · package `@dexnest/reality-rpg` ·
branch `cloud/reality-rpg`.

Status: **Phase 1 (contracts) done.** Decisions on the Phase 0 questions are in section 13b. Read with `AGENTS.md` and
`docs/DEXNEST_FOUNDATION_ARCHITECTURE.md`. Shaped after Developer
Intelligence's runtime/host split (`packages/dev-intelligence/src/module/runtime.ts`,
`apps/desktop/src/main/devIntelligenceHost.ts`).

---

## 1. What it is

A game layer over what already happens in DexNest. The user's activity is
already written to the shared `event_log` (every action run through the
registry, Developer Intelligence's observations, module events). Reality RPG
reads **only the event types its rules name**, and turns matching events into:

- **XP** (and a level from total XP), optionally tagged to a **stat**
  (e.g. "Craft", "Focus") for the character sheet;
- **achievements** that unlock once when a condition over awards is met;
- **quests**: goals the user writes, with a measurable condition and an
  optional window or recurrence, whose progress is computed from awards.

Rules, achievements and quests are **data** (JSON validated by the domain),
never code. Awarding is idempotent: replaying the same events never awards
twice.

## 2. Scope

- A rules engine: rules match events by explicit type (plus optional stream,
  module, action id and status), and award XP to a stat. Caps per day.
- An award ledger, idempotent on (rule, event id).
- Levels from total XP by a data-defined curve.
- Achievements (data) with conditions over the ledger.
- Quests (user-defined) with measurable conditions: count of awards from
  named rules, XP total, or distinct days with an award, over a fixed window
  or a daily/weekly recurrence.
- A light, off-by-default scheduled job that processes new events; a manual
  "Refresh".
- Registered actions for everything a user does; event log writes for
  milestones (level, achievement, quest completion).
- Host file, IPC, preload bridge, and a view: character sheet, achievements,
  active quests, history.

## 3. Out of scope

- Reading any module's own tables or files. The only input is `event_log`,
  through the foundation's `EventLog`.
- Reading **content** of any event: summaries, metadata, commit subjects,
  file names, amounts, text. Only an allow-listed envelope (section 8).
- Anything from vault, finance or journal beyond what Q1 decides (default:
  nothing at all).
- Rules written as code, scripts or expressions (no `eval`, no JS
  predicates). Rules are a fixed JSON shape.
- Penalties, negative XP, loss of level, streak-shaming, notifications that
  nag. (Q6.)
- Social features, sharing, leaderboards, sync, cloud, telemetry.
- LLM-suggested quests or rules.
- Mobile/phone or Deck exposure (Q7).
- Reacting to events in real time through `EventLog.subscribe` (Q5; default
  is the scheduled job plus Refresh).

## 4. Where the code lives

One package, layered by folder like `@dexnest/skill-constellation` on the
earlier branch, with a static test enforcing the layering:

| Path | Contents | I/O |
|---|---|---|
| `packages/reality-rpg/src/domain/` | Types; rule / achievement / quest schemas and validation; the event projection; matching; award computation (caps, idempotency keys); level curve; achievement and quest evaluation; recurrence windows; settings. | none |
| `packages/reality-rpg/src/domain/data/` | Level curve and the optional starter pack of rules/achievements (Q4) as literal data files. | none |
| `packages/reality-rpg/src/store/` | Migrations via `runModuleMigrations`; persistence on `SqlDatabase`. | DB |
| `packages/reality-rpg/src/engine/` | Reads `event_log` (only named types, paged by seq), projects, awards, evaluates, commits in one transaction. | DB |
| `packages/reality-rpg/src/module/` | Runtime (settings, job, entry points for every action), milestone events, manifest. | via ports |
| `apps/desktop/src/main/realityRpgHost.ts` | Wiring, IPC with the trusted-main-frame check. | Electron |
| `apps/desktop/src/main/preload.ts` | Bridge methods. | Electron |
| `apps/desktop/src/renderer/views/RealityRpgView.tsx` (+ `.css`, + pure model) | The view. | renderer |
| `packages/action-registry/src/index.ts` | Action definitions. | - |

Dependencies: `@dexnest/foundation` only. It does not depend on Developer
Intelligence or any other module package; it knows other modules only by the
event type strings its rules name.

## 5. Data model

### Domain types (Phase 1)

```ts
// The only view of an event the engine keeps (section 8).
interface ObservedEvent {
  id: string; seq: number; type: string; stream: string;
  module: string | null;   // envelope module, or payload.module for legacy audit rows
  actionId: string | null; // audit "action_executed" rows only
  status: string | null;   // "success" | "failed" | ... from audit rows only
  occurredAt: string;
}

interface RuleMatch {
  types: string[];              // REQUIRED, non-empty, exact strings: the only types ever read
  stream?: string;              // e.g. "audit", "dev"
  module?: string;
  actionIds?: string[];         // for audit action_executed rows
  status?: "success" | "failed";
}

interface Rule {
  id: string; version: number; name: string; enabled: boolean;
  match: RuleMatch;
  award: { xp: number; stat: string };   // xp integer 1..500
  dailyCap?: number;                      // max awards per local day
  effectiveFromSeq: number;               // no retroactive awards unless backfilled (Q3)
}

type Condition =
  | { kind: "count"; ruleIds: string[]; target: number }
  | { kind: "xp"; stat?: string; target: number }
  | { kind: "days"; ruleIds: string[]; target: number };   // distinct local days

interface AchievementDef { id: string; name: string; description: string; condition: Condition }
interface Quest {
  id: string; title: string; condition: Condition;
  window: { kind: "fixed"; from: string; to: string } | { kind: "daily" } | { kind: "weekly" } | { kind: "none" };
  status: "active" | "completed" | "abandoned";
  createdAt: string;
}

interface Award { id: string; ruleId: string; ruleVersion: number; eventId: string; eventSeq: number;
  eventType: string; occurredAt: string; localDay: string; xp: number; stat: string; awardedAt: string }
```

### Tables (Phase 2), all through `runModuleMigrations(db, "reality_rpg", …)`

| Table | Key | Purpose |
|---|---|---|
| `rpg_rules` | `id` | Current rule definition (JSON), version, enabled, `effective_from_seq`, timestamps |
| `rpg_rule_versions` | `(rule_id, version)` | Every saved version, so an award can say which rule text produced it |
| `rpg_awards` | `id`; **`UNIQUE(rule_id, event_id)`** | The ledger. The unique key is what makes replay safe |
| `rpg_achievements` | `id` | Achievement definitions (JSON) |
| `rpg_achievement_unlocks` | `achievement_id` (PK) | Once each; unlock time and the award that tipped it |
| `rpg_quests` | `id` | Quest definition (JSON), status, created/completed/abandoned times |
| `rpg_quest_completions` | `(quest_id, period_key)` | One completion per quest per period (recurring quests) |
| `rpg_levels` | `level` (PK) | When each level was first reached (once each) |
| `rpg_runs` | `id`; **`UNIQUE(occurrence_id)`** | One processing run per scheduler slot: seq range, awards, status, error |
| `rpg_state` | `key` | Cursor (`last_seq`), last seen max seq, settings fingerprint |

Totals (XP, per-stat XP, level) are **derived** from `rpg_awards` on read, not
stored as counters that could drift.

A run's awards, unlocks, quest completions, level rows, cursor and run record
commit in **one** `withTransaction`; a crash anywhere rolls all of it back and
the next run redoes the work.

Settings (host JSON file under the data root's settings, like DI):
`{ schemaVersion: 1, enabled: false, intervalMinutes: 15 }`.

## 6. How awarding works

1. Enabled rules give the set of **named types**. No enabled rule: the job
   reads nothing at all.
2. `EventLog.query({ types: namedTypes, afterSeq: cursor, orderBy: "seq",
   limit: 500 })`, paged. Only named types are ever queried.
3. Each row is projected to `ObservedEvent` immediately (section 8) and
   dropped if it belongs to a denied module or the `rpg` stream itself.
4. For each rule whose `match` fits and whose `effectiveFromSeq <= event.seq`:
   award `rule.award.xp` unless the rule's `dailyCap` for that local day is
   reached. Award id = hash(ruleId, eventId); inserted with `INSERT OR
   IGNORE` against `UNIQUE(rule_id, event_id)`.
5. Re-evaluate achievements, active quests and level from the ledger;
   record new unlocks/completions/levels (each once).
6. Advance the cursor to the last seq processed. Commit.

Idempotency, three layers: the run's occurrence id (a slot delivered twice
runs once), the ledger's unique key (a replayed event awards nothing), and
once-only unlock/completion/level rows plus event-log idempotency keys.

**Seq reuse.** `event_log.seq` is SQLite's `rowid`, and "clear audit
history" (Settings → Data Management) deletes the newest rows, so new rows
can reuse seq values the cursor has passed. Each run compares the log's
current max seq with the last one it saw; if it went down, it rescans from
the rules' earliest `effectiveFromSeq` (the ledger's unique key absorbs
repeats). Tested in Phase 7.

**Rule edits.** Editing a rule bumps its version; past awards keep the XP and
version they were given (the ledger is history, not a formula). Disabling a
rule stops new awards; deleting one keeps its awards (Q3).

**Time.** "Day" and "week" are the local day/ISO week in the OS time zone
(`Intl`), computed from each event's `occurredAt`. DST edges tested.

## 7. Events written

Stream `rpg`, module `reality_rpg`. Awards themselves are **not** event-log
events (one per matched event would flood the log); they live in the ledger.

| Type | Subject | Idempotency key | When |
|---|---|---|---|
| `rpg.level.reached` | level | `reality_rpg:level:<n>` | First time a level is reached |
| `rpg.achievement.unlocked` | achievement id | `reality_rpg:achievement:<id>` | Once per achievement |
| `rpg.quest.completed` | quest id | `reality_rpg:quest:<id>:<periodKey>` | Once per quest per period |
| `rpg.run.completed` | run id | `reality_rpg:run:<occurrenceId>` | A run that awarded something |

Rules can never match the `rpg` stream or `rpg.*` types (validated, and the
collector drops them): the game must not feed itself.

User actions (rule/quest/achievement edits, on/off, refresh) are journalled
in the audit stream by the action registry, as for every other action.

## 8. Privacy: what it reads and what it never reads

- **Input:** `event_log` rows whose `type` an enabled rule names. Nothing
  else - no module tables, no files, no DI stores.
- **Projection:** each row becomes `ObservedEvent` in one function, the only
  place a payload is touched. It keeps `id, seq, type, stream, module,
  actionId, status, occurredAt`. For legacy audit rows, `module`, `actionId`
  and `status` come from the payload's fields of those names; **`summary`,
  `metadataJson`, `errorMessage`, `subject` text, commit subjects, paths and
  every other field are never copied, stored, logged or shown.**
- **Denied modules:** events whose module (envelope or payload) is `vault`,
  `finance` or `journal`, or whose action id starts with `vault.`,
  `finance.` or `journal.`, are dropped at projection, and a rule that names
  them is rejected at validation - unless Q1 says otherwise.
- Note: the foundation's `EventLog.query` parses the whole payload before the
  projection runs, so denied rows are deserialised in memory for an instant
  even though nothing from them is kept. A truly content-free read needs a
  foundation change (Q2).
- **Bait test (Definition of done):** plant `event_log` rows for vault,
  finance and journal actions with content-like summaries and metadata
  ("password", "salary", "diary"), plus rows of types no rule names, and
  prove no `rpg_*` row, no `rpg.*` event and no IPC response contains any of
  it, and that unnamed types were never returned by a query (spy on
  `EventLog.query`).

## 9. Actions

`moduleId: "reality_rpg"`, `safe`, triggers `command` + `module_ui`, not phone-
or Deck-exposed (Q7):

| Action id | Does |
|---|---|
| `reality_rpg.open` | Open the view (`desktop.view.rpg`) |
| `reality_rpg.refresh` | Process new events now |
| `reality_rpg.enable` / `reality_rpg.disable` | Turn the scheduled job on/off (off by default) |
| `reality_rpg.rule.save` | Create or update a rule (validated) |
| `reality_rpg.rule.set_enabled` | Enable/disable a rule |
| `reality_rpg.rule.delete` | Delete a rule (awards kept - Q3) |
| `reality_rpg.quest.create` | Create a quest |
| `reality_rpg.quest.abandon` | Abandon a quest |
| `reality_rpg.achievement.save` / `.delete` | Edit achievement definitions |
| `reality_rpg.backfill` | Apply a rule to past events (only if Q3 = yes) |

## 10. Scheduling

One job, `process`, on `createHostScheduler`: scheduled only while enabled
(no timer when off), interval `intervalMinutes` (default 15, min 5), **not
heavy** by default - it reads only new rows of named types, usually a handful
(Q5). A run with no enabled rules, or no new rows, costs one `MAX(seq)`
query. `runAtStartup: true` so time away is caught up once.

## 11. View (Phase 6)

- **Character sheet:** level, total XP, XP to next level, XP per stat.
- **Achievements:** unlocked (with date and the event type that tipped it)
  and locked (with progress).
- **Active quests:** progress bars as numbers ("3 of 5 days"), window,
  abandon; create-quest form.
- **History:** recent awards - rule name, event type, action id, time, XP.
  Never event content.
- **Rules:** list, enable/disable, edit (a form that produces the JSON shape;
  no free-form code).
- Empty (off / no rules / no awards yet), loading and error states; keyboard
  accessible; tokens only (accent: Q8); Inter/JetBrains Mono.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Event content leaking (audit summaries can hold private text) | One projection function, allow-listed fields, bait tests, static check that nothing else reads `payload` |
| Vault/finance/journal activity used at all | Denied at validation and projection (Q1) |
| Seq reuse after "clear audit history" | Max-seq regression detection + rescan; ledger unique key (section 6) |
| Feedback loop (RPG events awarding XP) | `rpg` stream/types unmatchable |
| Farming (e.g. `ui_clicked` spam, repeated navigation) | Per-rule daily caps; starter pack avoids noisy types; view shows where XP came from |
| Rule edits rewriting history | Ledger stores XP and rule version at award time |
| Retroactive surprise on first enable (thousands of past events) | `effectiveFromSeq` = log max seq when a rule is created; backfill only on request (Q3) |
| Legacy audit rows with no envelope module | Module read from the payload's `module` field only |
| Time zones / DST for daily & weekly quests | Local day computed per event with `Intl`; tests across DST |
| Large log on first run | Paged by seq, named types only, one transaction per page |
| Demo-seeded events awarding XP, then deleted | Awards stay (history); Q9 |
| Idle CPU | No timer when off; light query when on; no view animation |

## 13. Open questions for you

1. **Vault, finance, journal.** Deny them completely (default: no rule may
   name them, their events are dropped), or allow *counting* their actions
   (e.g. "wrote a journal entry today" by action id and status, never
   content)? A journaling habit quest needs the latter.
2. **Content-free reads.** `EventLog.query` returns the full payload. Accept
   "projected immediately, never kept" (default), or add a small foundation
   option to query envelope-only (a change to another package, separate
   commit)? The latter is the only way to truly never deserialise denied
   rows.
3. **Retroactivity.** New rules apply from creation onward (default), with an
   explicit `reality_rpg.backfill` action to apply one to past events? Or no
   backfill at all? And on rule delete: keep its awards (default) or remove
   them?
4. **Starter pack.** Ship a small, disabled-by-default set of example rules
   and achievements (e.g. "Commit observed" 5 XP Craft, "Standup generated"
   10 XP Focus, "First quest completed") as data the user can enable, or
   start completely empty?
5. **Live updates.** Scheduled job + Refresh only (default), or also react to
   new events through `EventLog.subscribe` (instant, but work inside other
   modules' write paths)? And is 15 minutes the right default interval?
6. **Tone.** Confirm: no penalties, no negative XP, no streak-loss messages.
7. **Phone/Deck.** Keep everything off the phone and Deck (default), or
   expose read-only "character sheet" to a paired phone?
8. **Accent colour.** `DESIGN_TOKENS.md` has no RPG token. Reuse an existing
   one (suggest `--accent-loop` or `--accent-command`), or add a token?
9. **Deleted source events.** If events are later deleted (audit history
   cleared, demo data removed), keep the awards they produced (default) or
   remove them?
10. **Stats.** Free-text stat names on rules (default), or a fixed list you
    choose (e.g. Craft, Focus, Health, Order)?

## 13b. Decisions (you chose the defaults)

1. Vault, finance and journal are **denied completely**: no rule may name
   them (by module, action id or type prefix, any case), and their events
   are dropped at projection.
2. No foundation change: events are projected immediately and never kept.
   The projection is the only code that reads a payload (static test).
3. New rules apply from creation onward (`effectiveFromSeq` = log max seq
   when saved or enabled); an explicit `reality_rpg.backfill` action applies
   one to past events. Deleting a rule keeps its awards.
4. A starter pack ships as data, every rule disabled
   (`domain/data/starter-pack.ts`): Commit observed, Standup generated,
   Repositories scanned, Backup completed; achievements First steps,
   Hundred, Committed week.
5. Scheduled job (15 minutes, minimum 5) plus Refresh; no live subscription.
6. No penalties, no negative XP, no streak-loss messages.
7. Not phone- or Deck-exposed.
8. Accent `--accent-loop` (existing token). No new tokens.
9. Awards stay when their source events are later deleted.
10. Free-text stat names (letters, digits, spaces, up to 32 characters).

**Phase 1 notes.** Payload fields kept for legacy audit rows (`module`,
`actionId`, `status`) must also be short identifiers
(`[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}`), so free text in those fields cannot
pass either. Quests count only awards that happened after the quest was
created. The level curve is data: level n needs 50·n·(n-1) XP, 60 levels.

## 14. Phases for this module

Every phase ends at the gate: `pnpm typecheck`; whole-workspace tests with no
new failures against the baseline (section 15); new tests; a mutation check;
commit and push to `cloud/reality-rpg`; report.

| Phase | Deliverable | Key tests | Planned mutation check |
|---|---|---|---|
| 1 Contracts | `domain/`: types, JSON validation for rules/achievements/quests (incl. denied modules, `rpg.*` unmatchable, explicit non-empty types), projection, matching, award computation with caps and ids, level curve, condition evaluation, day/week keys, settings. Package scaffold. | Projection keeps only allow-listed fields; denied modules dropped; validation rejects bad/denied/self-feeding rules; caps; DST day keys; static test: domain imports only domain | Let the projection copy `summary` |
| 2 Store | `rpg_*` migrations, ledger with unique key, runs with unique occurrence, one-transaction commit, derived totals, manifest | Close/reopen keeps everything; duplicate award insert is a no-op; failed commit leaves nothing; `validateManifest` = [] | Drop `UNIQUE(rule_id, event_id)` |
| 3 Engine | Collector (named types only, paged), cursor, seq-regression rescan, awarding, evaluation, commit | Replaying the same events awards nothing new; **bait test**; unnamed types never queried (spy); rescan after audit clear | Query without the `types` filter |
| 4 Actions + events | Registry entries, milestone events with idempotency keys inside the run transaction, runtime entry points, off-by-default job | Slot fired twice → one run, one set of awards and events; every action writes the log | Remove the run's occurrence key |
| 5 Host | `realityRpgHost.ts`, IPC with trusted-frame check, input validation, preload, `main.ts` wiring and action handlers | Untrusted frames refused; no timer when off; channels removed on dispose | Remove the frame check |
| 6 View | Character sheet, achievements, quests, history, rules; empty/loading/error; keyboard | Rendered states (Vite SSR + `react-dom/server`, no new deps); model tests; no hex/rgb | Put a literal colour in the CSS |
| 7 Hardening | Restart mid-run, disk faults at every write, 100k-event log, racing triggers, seq reuse, DST, corrupt rule JSON, rule edited mid-run | As listed | Break crash recovery |
| 8 Handoff | `HANDOFF.md` | - | - |

## 15. Baseline on this branch (Linux)

This branch is `origin/main` plus the cherry-picked foundation test-guard fix
(`e6577c2` from `claude/admiring-babbage-kbw2ew`). It does not contain Skill
Constellation. Known Linux-only failures (not this module's to fix):
2 in `@dexnest/dev-intelligence`, 17 in `@dexnest/autopilot-runtime`.
`pnpm test` chains packages with `&&`, so it still stops at the first failing
package (dev-intelligence) on Linux; the gate runs each package's tests
separately. Exact counts are in the Phase 0 report.
