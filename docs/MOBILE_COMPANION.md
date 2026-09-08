# DexNest Mobile Companion — handoff

**Read this before touching either repo.** It is the whole context: what exists,
what the rules are, what we are building, and what has already been tried and
rejected. Written 2026-09-08.

---

## 1. What we are building

DexNest is a local-first Electron app on Windows (`D:\DeskNest`). It is the
operator's whole working surface: Autopilot (an unattended overnight Claude Code
worker), Drop (file/text exchange with the phone), Clipboard, Calendar,
Timetable, Journal, Vault, Finance, External Devices, Audit, Backup, Health.

The mobile companion (`D:\dexnest-companion`, Expo/React Native, Android) is
**a viewing version of DexNest, plus Drop in full**. It is not an Autopilot
companion — that was an early misread and the app was rebuilt because of it.

Two rules define the whole product:

1. **The phone reads; the desktop decides.** Runs are started at the desk.
   The phone's only writes are Drop, and later "answer a question" / "pause".
2. **The phone talks only to DexNest.** Never directly to Google, Outlook,
   Anthropic, or anything else. One source of truth, always the desktop.

### Tabs

Three, plus settings behind an avatar. **Today and Command Centre are one tab** —
they are structurally identical (read-only, sectioned, glanceable) and were
merged deliberately.

| Tab | Sections |
|---|---|
| **Today** | Weather · calendar events · timetable · nudges · **Claude & Codex plan usage** · app health |
| **Drop** | Files, images, text — both directions, live |
| **Autopilot** | Tonight · Runs · Stats (sections, not tabs) · run detail |

Today's ordering is an argument, not a layout: what needs a person comes first,
because it is the only time-sensitive thing on the phone. A dashboard that looks
identical whether or not it is holding an emergency has failed.

---

## 2. Standing constraints — non-negotiable

These come from the operator and predate this work. Violating any of them is a
serious error, not a judgement call.

- **Never touch `D:\DeskNest\local-data`.** It holds the vault, finance records
  and the DPAPI keychain. It is a hardcoded deny root.
- **Never read `~/.claude/.credentials.json` or `~/.codex/auth.json`**, or any
  other auth/credential file. See §8 — this was investigated and settled.
- **The Firebase service account JSON in `D:\dexnest-secrets`** must never be
  read, printed, pasted into chat, copied into the database, or logged. Only its
  *path* is configuration.
- **Redaction happens before durable storage**, never after.
- **Never weaken**: the capability policy, the EffectsGateway,
  journal-before-side-effect, worktree isolation, or uncertain-send semantics.
- **Never implement**: browser or Windows automation, OCR/vision, Teach Mode,
  Away Mode beyond spec, generic UI automation, or paid APIs as a default.
- **Vault and finance are never exposed to the phone.** Not hidden — unreachable.

---

## 3. Working agreements

**Phase sizing.** Size each phase to *one Opus 5 low turn's capability* — not to
verification granularity. Too long and the model drops things; too short and the
work fragments across phases. This is a standing instruction.

**Verification.** Every phase ends green on:

```
corepack pnpm test          # autopilot-runtime, 644 tests at last run
corepack pnpm typecheck     # all packages
corepack pnpm build         # all packages
node apps/desktop/test/navigation.test.mjs          # 4/4
node apps/desktop/test/autopilotControlCenter.ui.mjs # see trap in §9
```

Companion app: `npx tsc --noEmit`, then `npx expo export --platform android`
to catch anything types cannot see.

**Commits.** Conventional prefix, then a body explaining *why* in prose — what
was wrong, what it now does, and what was deliberately not done. Co-author line:
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Push to `dev`.
`dev` is **63 commits ahead of `main`** and unmerged; `main` has 99 Dependabot
alerts. Do not merge without being asked.

**Honesty over completeness.** Two examples already standing in the code: the
phone's Stats tab has no 7-day trend because DexNest reports *runs* not *nights*,
and a weekday chart would be six invented numbers beside one real one. Run detail
stops where the phone payload stops rather than reaching for the desk report.
Keep this habit. A chart is a claim.

---

## 4. Architecture invariants

**`packages/autopilot-runtime` has zero Electron imports.** All OS access goes
through injected `RuntimePorts` (`db`, `platform{fs,process,git,env}`, `clock`,
`ids`, `logger`). Enforced by `boundaries.test.ts`: only `dispatcher.ts`,
`workspace.ts`, `engine.ts`, `effects.ts` and `ports.ts` may touch `platform.*`.

**Effects path:** Intent → Policy → Approval/LoopGrant → Journal → Dispatcher →
Port. The journal entry is written *before* the side effect, never after.

**Derived counters, never stored.** A counter that can drift eventually
authorises the wrong amount of work.

**Test stack:** `node:test` + `--experimental-strip-types` +
`--experimental-sqlite`, zero third-party deps. TypeScript **parameter
properties are not supported** in strip-only mode — write explicit assignments.

**Migrations:** 33 exist. Adding one requires the operator to restart DexNest.
Say so explicitly when you add one.

---

## 5. What is already built

### Desktop (`D:\DeskNest`, branch `dev`)

| Commit | What |
|---|---|
| `28cbcb1` | Device pairing, token auth, capability gating; `/drop*` moved behind the auth gate |
| `2ec4ab3` | Fix: a stale FCM push token was silently revoking a pairing |
| `bf88796` | `providerLimits` engine — plan usage from local logs |
| `d1b33c7` | Plan Usage card on the Command page |
| `faecb54` | Fix: stop adding a delta to a reading too old to add to |

Also: the attention engine (`packages/attention`, 10 modules, 105 tests,
vendored, plain JS with a hand-written `index.d.ts`), `AttentionStore`, host
wiring, the desktop Notifications tab, and FCM v1 direct push
(`apps/desktop/src/main/push.ts` — JWT via `node:crypto`, no SDK, no Expo push
service). Verified against real Google.

### Phone (`D:\dexnest-companion`)

Commit `565c58c`. **The design system is correct and should be kept**; only the
tab structure was wrong-scoped and needs restructuring.

| File | Role |
|---|---|
| `src/theme.tsx` | Light + dark as **one set of roles filled in twice**. Screens ask for `colour.surface` and never learn which mode they are in. Follows the system by default. |
| `src/ui.tsx` | Every primitive: `Screen`, `Card`, `Display`, `Title`, `Body`, `Faint`, `Label`, `Button`, `Chip`, `Segmented`, `StatTile`, `Bar`, `ListRow`, `Empty`, `Spinner`. Reads the theme at render time — never a module-level `StyleSheet`, which cannot change at sunset. |
| `src/charts.tsx` | `Ring` (arc gauge), `Bars`, `Sparkline`. ~150 lines of SVG, no chart library. |
| `src/session.tsx` | One fetch shared by every tab. Never clears on failure — shows the last known data marked stale. |
| `src/client.ts` | The only place that knows how a request is authenticated and how a failure is worded. 8s timeout. |
| `src/pairing.ts` | Token in `expo-secure-store` (Android keystore). |
| `src/nav.tsx` | Hand-built bottom tab bar. |

**Design rules to keep:** no screen names a hex code. No screen builds its own
`fetch`. Empty states are first-class — "nothing needs you" is real information.

Native modules present: `expo-secure-store`, `react-native-svg`,
`react-native-safe-area-context`, `@expo/vector-icons`. **Adding a native module
requires `npx expo run:android`, not a JS reload.**

---

## 6. The API surface that already exists

### Companion routes (`apps/desktop/src/main/companionApi.ts`)

```
POST /companion/pair          no token; exchanges a 6-digit code for a device token
GET  /companion/whoami        identity + capabilities
POST /companion/push-token    phone reports its FCM address (called every launch)
GET  /companion/attention     the attention snapshot
GET  /companion/runs          runs in phone shape
```

Auth is a Bearer token; the desktop stores only its SHA-256 hash. Capabilities
are `read` and `control`, checked per route. A paired phone starts **read-only**;
control is granted separately at the desktop.

**Pairing never expires.** Only the 6-digit code does (10 min, single use).
`byTokenHash` deliberately does *not* filter on `status`, because `status`
tracks *push deliverability* and goes `DISABLED` on its own when FCM rejects a
rotated token. Do not re-couple these.

### Drop routes (already complete — see §7)

```
GET  /drop                     the PWA page (manifest, icon, installable)
GET  /drop/api/events          Server-Sent Events — this is what makes it instant
GET  /drop/api/state           current items
POST /drop/api/text            send text
POST /drop/api/upload          send files
GET  /drop/files/:id           download
POST /drop/api/copy-event | /drop/api/download-event
```

---

## 7. Drop — important, and easy to underestimate

Drop is **not** a feature to build. It is a complete PWA with a working API that
the operator used daily: the phone opened `http://<lan-ip>:port/drop`, Android
installed it, and both directions worked instantly via the SSE stream.

It is currently **dark** because `28cbcb1` put `/drop*` behind
`authorizeControlEndpoint`, which refuses non-local requests when LAN exposure is
off — and the operator chose to leave LAN exposure off. This is a deliberate
state, not a regression, but it means Drop is unavailable right now.

So the Drop work is *transport plumbing*, not construction:
- Let `/drop*` accept a paired **companion device token** (restores the PWA over
  Tailscale with LAN still off).
- Point the native tab at the same endpoints with a Bearer token; consume the SSE
  stream for live updates.

The genuinely hard part is Android-native and only affects *send*: the share
sheet, content URIs, and files arriving with no useful name.

---

## 8. Claude/Codex plan usage — settled, do not re-litigate

The Command page shows live plan usage. **Codex is correct and genuinely live**;
Claude is anchored and can go stale. This was investigated exhaustively.

**Codex** writes `rate_limits` into `~/.codex/sessions/**/rollout-*.jsonl` on
every API response: `primary` (window 300 min), `secondary` (10080 min),
`used_percent`, `resets_at`, `plan_type`, `credits`. Live whenever Codex runs.

**Claude** writes `cachedUsageUtilization` into `~/.claude.json`: `five_hour`,
`seven_day`, per-model buckets (`seven_day_opus`, `seven_day_sonnet`,
`nimbus_quill` = Fable), a `limits[]` array, and `fetchedAtMs`. **It is refreshed
only by the interactive TUI.** Tested and confirmed: `claude doctor`,
`claude auth`, and a headless `-p` turn all leave it untouched. The VSCode
extension does not refresh it either. There is also a `.quotaLimits` field in
session transcripts, but it is a *rejection event* written when a limit is
actually hit — not a percentage.

**Do not use the OAuth token or a web session cookie to fetch live numbers.**
Anthropic's Consumer Terms (updated 2026-02-20) prohibit using subscription OAuth
tokens in any third-party tool; server-side enforcement landed 2026-01-09;
enforcement is "without prior notice" and someone was banned for building exactly
this kind of usage tracker. Separately, `/api/oauth/usage` returns 429 at 30–60s
polling and stays 429 for hours, so it would not work anyway. `ccusage` does not
solve this either — it counts tokens and estimates dollars, and never knows the
plan percentage.

**That idea is now tested and dead.** Launching `claude` in a real Windows
console (a true TTY, via `Start-Process`) and leaving the interactive UI running
for 45 seconds does **not** refresh `cachedUsageUtilization`. Together with the
earlier results — `claude doctor`, `claude auth` and a headless `-p` turn all
leave it untouched — nothing DexNest is allowed to do can refresh Claude's
anchor. The card says so rather than suggesting a fix that does not work.

**Design requirement:** staleness is a first-class state, not a caption. A stale
percentage at 3am is worse than no percentage, because it will be acted on.

---

## 9. Traps that have already bitten

- **The UI harness fixture.** `autopilotControlCenter.ui.mjs` throws before its
  first assertion whenever a new bridge method exists without a preload fixture
  stub. This has happened four times. **It is currently failing at HEAD,
  pre-existing and unrelated to Plan Usage** — confirmed by stashing. Navigation,
  runtime tests, typecheck and build are all green.
- **Bash heredocs collapse backslashes.** Use `<<'EOF'` (quoted) or the Write
  tool for anything containing `\n`, `\d`, `\/`. Unquoted heredocs corrupt regex.
- **Hidden tabs stay in the DOM.** UI selectors must be scoped, e.g.
  `section[aria-label="Notifications"] .checkbox-row`.
- **`run.spec.projectPath` is nullable.**
- **A `PENDING → FAILED` transition is refused by the engine.** Use `SKIPPED`.
- **Java `.properties` files treat `\` as an escape** — `android/local.properties`
  must use forward slashes.
- **The usage-report growth heuristic** conflates accumulated context with a
  genuinely bigger phase. Known-wrong, unfixed.

---

## 10. The plan

Phases sized to one Opus 5 low turn each. Ordered end-to-end.

### Now — restructure, and get Drop back

| # | Phase | Done when |
|---|---|---|
| 1 | Move Plan Usage to the top of the Command page | Visible without scrolling |
| 2 | `/drop*` accepts a paired companion device token | PWA works over Tailscale with LAN exposure still off |
| 3 | Phone: three-tab shell; Autopilot sections nested inside one tab | Every current screen reachable, nothing lost |
| 4 | **Action bridge with opt-in exposure** — one `/companion/action`; each action declares `phone: "read" \| "control"`, default unreachable | A non-declared action is refused; vault/finance unreachable *by construction* |
| 5 | Drop tab: receive — list, download, live via SSE | A desktop-sent file appears without a refresh |
| 6 | Drop tab: send — upload + Android share-sheet target | Sharing a photo from any app reaches the desktop |
| 7 | Drop verification (operator) | Both directions, over Tailscale, off home Wi-Fi |

Phase 4 is the security phase and is **not deferrable**. Every hand-written route
added before it is a route that must be migrated after. An action registry
exposed wholesale over a network port is remote code execution with extra steps;
opt-in per action is the difference between a companion app and a back door.

### Next — Today, on data that already exists

| # | Phase | Done when |
|---|---|---|
| 8 | **Provider-agnostic `today` read model** — events + timetable + nudges, one payload, each item source-labelled | One call returns the whole day; adding a provider adds no fields |
| 9 | Expose usage + health over the companion API | Phone shows the same rings with the same honesty about age |
| 10 | Weather provider — free tier, location in settings, cached | Forecast readable from the host |
| 11 | Phone Today screen — hero, sections, drilldowns | Renders live; degrades to cached when off the tailnet |

Phase 8 is the hinge. If the read model is shaped around Google's payload,
adding Outlook rewrites the model *and* the phone screen. Keep it neutral: an
event is a title, a when, a where, and a source label.

### Later — the big desktop lift

| # | Phase | Done when |
|---|---|---|
| 12 | Google account connection — loopback OAuth, tokens in the existing keychain | Two accounts connect and survive a restart |
| 13 | Google calendar sync — incremental, multi-account, dedup | Both accounts' events, no duplicates |
| 14 | Microsoft Graph accounts + sync | Outlook events alongside Google |
| 15 | Phone control — answer a question, pause — through Intent → Policy → Journal | Every phone action journalled with its origin, as `desktop_ui` is today |

**Do not do 12–14 early.** Today is the tab the operator will look at most, which
makes it tempting to build first, but it is the only one blocked on work that is
not on the phone at all. Phases 8–11 give a working Today against the local
calendar and timetable; the Google work then fills it in without touching the
phone.

---

## 11. Also worth knowing

- The operator runs Windows 11, PowerShell primary, Bash available.
- Restarting DexNest is required after any migration — say so.
- The icon font bundle pulls ~4MB of unused glyph sets into the phone app.
  Harmless while sideloading, worth trimming before any real distribution.
- Clipboard history is the natural next feature after Drop — same shape.
- Autopilot could read `five_hour` before starting a phase and hold at a
  threshold *at a phase boundary*, rather than discovering the wall by being
  refused mid-turn. The operator wants manual resume, not auto.
