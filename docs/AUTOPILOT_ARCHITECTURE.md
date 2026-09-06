# DexNest Autopilot Architecture

**Status:** Phase 3 includes bounded primary coding loops, context-request evidence,
and the Autopilot Control Center. Claude Code and Codex retain disabled filesystem
tools. A second provider may be configured as a dormant consultant; it cannot execute.

**Read section 9a before adding a worker** — it states exactly what the policy
layer does and does not guarantee.

This document is the authoritative design for DexNest Autopilot. Coding agents working
on Autopilot must read this file before making changes, and must follow the boundaries
it defines rather than inventing parallel structures.

Where this document and `AGENTS.md` disagree, `AGENTS.md` wins for general DexNest rules;
this document governs Autopilot specifics.

---

## 1. Product definition

DexNest Autopilot is not a Claude or Codex wrapper. It is a local-first automation
runtime that evolves DexNest from a personal command center into a Windows automation
layer built around one loop:

```txt
OBSERVE -> REASON -> ACT -> VERIFY -> REMEMBER -> RECOVER -> ASK
```

`ASK` is a first-class outcome, not an error path. The runtime escalates to the human
for authority, subjective judgment and unresolved blockers, and for nothing else.

Long-term operating modes:

| Mode | Meaning |
|---|---|
| Assist | Context-aware suggestions while the user stays in control |
| Autopilot | Execute outcome-level workflows across applications |
| Away | Continue unattended, interrupt only when genuinely necessary |

**Only the coding domain is in scope for now.** General-PC autonomy is deferred
(section 16). It is chosen first because it solves a real daily workflow and because
software has unusually strong deterministic verification — a compiler, a type checker
and a test suite are ground truth that no other domain offers this cheaply.

### Primary product metric

**Human attention required.** How much useful work completes before the user genuinely
needs to intervene.

Explicitly *not* metrics: number of agents, token count, runtime duration, prompt count.
A run that takes forty minutes and needs no intervention beats one that runs eight hours
and needs six.

---

## 2. First workflow

The manual loop being replaced:

```txt
user explains architecture -> supervisor produces next objective
  -> worker implements -> user waits -> user copies result back
  -> supervisor reviews -> next instruction -> repeat
```

The first implemented loop deliberately omits the supervisor:

```txt
Run Spec
  -> isolated working copy
  -> sticky primary worker
  -> worker performs task
  -> deterministic verification
  -> failures returned automatically to the SAME worker
  -> repeat
  -> acceptance criteria satisfied
  -> evidence-based report
```

**V1 must not require ChatGPT.** If removing the supervisor breaks the loop, the design
is wrong.

---

## 3. Run Spec — the authoritative object

No AI conversation is the source of truth. Every run is governed by a durable,
human-owned Run Spec.

```txt
RunSpec {
  specId, version, createdBy: "human", projectId

  goal            one paragraph, human-written, stable for the run
  nonGoals[]      explicit exclusions - the anti-scope-creep clause
  constraints[]   hard rules ("do not change the schema", "do not add deps")

  acceptanceCriteria[] {
    id, text
    kind: "automated" | "judgment"
    check?          for automated: exact command + expected exit code
    verifiedAt, verifiedBy, evidenceRef
  }

  capabilities {
    workspaceRoot         the isolated working copy
    allowedPaths[]   forbiddenPaths[]
    allowedCommands[]   forbiddenCommands[]
    environmentAllowlist[]
    requiresApproval[]    push, publish, deploy, install, schema change
  }

  workers    { primary, fallback, sticky: true, consultantMode: true }
  supervisor { provider: "none" | "claude" | "codex" | "human" | ... }
  contextSources[]        see section 6

  verification { tiers[], commands{}, runOn }

  budgets {
    maxConsecutiveFailures, maxStepsPerCriterion,
    maxWallClock, maxIdleWithoutProgress
  }

  completion {
    rule: "all automated criteria pass AND all judgment criteria approved"
    approvedBy, approvedAt
  }
}
```

### Three tiers of truth

| Tier | Contents | Who may change it |
|---|---|---|
| **Authoritative** | Run Spec, durable runtime state | Human only |
| **Contextual memory** | Architecture decisions, project history, preferences, prior runs, imported context | System, as evidence |
| **Conversation history** | Chat transcripts | Read-only context source |

Workers and supervisors may *interpret* the Run Spec. They may **propose** amendments,
which become approval items for the human. They may never silently redefine the goal or
the acceptance criteria.

**"The worker says it's done" and "the supervisor says it's done" are both merely
evidence.** A run is complete when the completion rule evaluates true against recorded
evidence — never because a model asserted it.

---

## 4. Runtime boundary

```txt
renderer   apps/desktop/src/renderer/views/Autopilot*.tsx
           Renders snapshots. Owns zero run state. Reload-safe by design.
              |
              |  preload.ts contextBridge (invoke + push)
              v
main.ts    IPC handlers, registry registration, runtime host, tray/notify
           Thin adapter only. Translates IPC <-> runtime API. No run logic.
              |
              |  direct calls (now)  ->  child process (later, if justified)
              v
packages/autopilot-runtime        <-- ZERO Electron imports, enforced
           state machine | planner | dispatcher | verifier
           recovery | attention | adapters
              |
              +-- injected ports: clock, spawn, fs, db, notify
              v
packages/local-db                 Autopilot schema (Phase 1)
```

### The strict rule

`packages/autopilot-runtime` must contain **zero Electron imports**. All platform and
process capability arrives through explicitly injected ports.

This is the entire mechanism by which the runtime can later be extracted into a
dedicated process. If `import { app } from "electron"` ever appears in that package,
the extraction becomes a rewrite and this design has failed.

### Why the runtime is hosted in Electron main for now

A separate long-running process was considered and deferred. Durable state in main plus
SQLite already survives renderer crash, app restart and Windows restart. A separate
process additionally survives only an Electron main crash and a deliberate app quit —
and DexNest is tray-resident with an enforced login item
(`applyLoginItemSettings`, `main.ts:4455`), so main is normally alive whenever the
machine is. Against that: a real IPC protocol, supervision and restart logic, a second
log stream, dual crash handling, and `electron-builder` packaging work.

Revisit if evidence shows main-process crashes are actually costing runs.

### Renderer discipline

Follow the extracted-view pattern already used by `apps/desktop/src/renderer/views/`
(`ToolsView.tsx`, `ClipboardView.tsx` and six others). Never the inline pattern that
made `main.tsx` 17,857 lines.

If a React component holds state that the run's correctness depends on, the architecture
has been violated.

---

## 5. Worker model

Provider-neutral adapter. Initial implementations: `ClaudeCodeWorker`, `CodexWorker`.

```txt
WorkerAdapter {
  id, displayName
  isInstalled()  isAuthenticated()  usageState()

  startSession(spec, workspace)  -> sessionId
  resumeSession(sessionId)       -> ok | expired | not_found

  send(prompt, idempotencyKey)   -> dispatchRef     // journal FIRST (section 8)
  poll()      -> idle | working | awaiting_input | exited
  result()    -> { text, exitCode, filesTouched, commands[], diffRef }

  interrupt()  cancel()          // process-tree termination
  consult(question, readOnlyContext) -> diagnosis   // NO write access
  handoffPackage()               -> HandoffPackage
}
```

Working and completion detection uses process exit, exit code and stdout — deterministic
signals. This is a direct consequence of the deterministic-first principle in section 14.

### Sticky primary

If Claude is primary, the run is `Claude -> Claude -> Claude -> Claude`, never
`Claude -> Codex -> Claude -> Codex`. Accumulated session context is the thing that makes
a long run productive, and alternating destroys it.

Escalation ladder on difficulty:

```txt
1. same worker retries with the error
2. same worker, alternate approach, failure history attached
3. CONSULT fallback worker (read-only: spec + diff + failures + logs)
4. feed diagnosis back to primary            <- ownership unchanged
5. escalate to supervisor / attention queue
6. transfer ownership                        <- last resort only
```

Step 3–4 is the **normal** escalation, not a special case. Ownership transfers only on:
usage exhaustion, repeated auth or session failure, an explicit "I cannot proceed", or
human instruction.

`consult()` must be read-only **enforced at the adapter**, not requested in the prompt.

### Handoff package

Required before any ownership change:

goal, architecture/context, completed work, current state, current failure, attempts
already made and why they failed, relevant files, git/checkpoint state, acceptance
criteria, things not to change.

---

## 6. SupervisorAdapter and ContextSource are different capabilities

This distinction is load-bearing. Conflating them is what made the ChatGPT question
look harder than it is.

| | ContextSource | SupervisorAdapter |
|---|---|---|
| **Provides** | Accumulated knowledge as input | Active judgment during a run |
| **When** | Read at run setup | Invoked repeatedly during the run |
| **Examples** | Imported ChatGPT conversation, markdown architecture doc, project memory, previous run, user-provided text | Claude reviewer, Codex reviewer, human, supported ChatGPT reviewer, future local model |
| **Failure impact** | Run starts with less context | Run loses judgment escalation |

**A ChatGPT conversation can contribute context without ChatGPT being the supervisor.**
An exported transcript is a `ContextSource` and requires no browser automation at all.

### What a supervisor adds that verification cannot

Verification answers: *did mechanically testable requirements pass?*

The supervisor answers: *does this implementation actually satisfy the intended product
and architecture?* — judgment on unfalsifiable criteria, scope policing (a green build
proves nothing was broken, not that nothing unnecessary was done), replanning when the
worker loops, and a completion opinion from something that did not write the code.

The supervisor must never: declare completion on its own authority, amend the Run Spec,
or hold write access. Read-only tools only.

Implementation order: `none` (verifier alone) -> Claude or Codex review session -> human
-> supported ChatGPT -> local model. Shipping `none` first is deliberate: it proves the
verifier stands alone, which is what makes every later supervisor optional.

### ChatGPT position

Preserving an existing ChatGPT conversation remains an intended future capability.
However:

- ChatGPT browser automation is **not** a load-bearing V1 dependency.
- Do not build consumer ChatGPT UI automation as part of the initial runtime.
- A bounded feasibility investigation may run separately.
- Only a sufficiently reliable **and permitted** mechanism may become a production
  adapter. The permission question is not secondary to the technical one.

---

## 7. Persistence

DexNest currently persists through 57 whole-file JSON blobs in `local-data/settings/`
(`main.ts:151`-`210`), rewritten in full by `readJsonFile` / `writeJsonFile`. SQLite
exists but holds exactly one table (`event_log`). That split is fine for settings and
unusable for run state.

| Move to SQLite | Reason |
|---|---|
| `runs` | Frequent updates, queried by state |
| `run_events` (append-only) | The recovery journal; append-only survives partial writes |
| `run_steps` | Ordered, resumable, per-row updates |
| `worker_sessions` | Session ids for resume; PIDs for reconciliation |
| `checkpoints` | Git checkpoint references per verified step |
| `verifications` | Evidence per criterion per attempt |
| `approvals` | Must not be lost; queried by pending state |
| `reconciliation_state` | Crash-recovery bookkeeping |

**Keep as JSON:** Autopilot settings, project profiles, verifier command presets. Small,
hand-editable, no transactional requirement, consistent with the existing `settingsRoot`
convention.

Extend `packages/local-db` — it is the existing SQLite infrastructure. Do not create a
second database layer.

---

## 8. Side-effect durability

Autonomous operation creates an ambiguity that ordinary app code does not have:

```txt
record intent -> perform external side effect -> CRASH before recording success
```

Concretely: DexNest sends Task 7 to Claude; the machine crashes; the database never
records confirmation; DexNest restarts. **It must not blindly resend.** Claude may have
already executed the task, committed, or run a migration.

Required discipline:

```txt
1. journal intent (with idempotency key) BEFORE the external side effect
2. execute
3. record result / confirmation
```

On restart, any run not in a terminal state is **reconciled, never resumed blindly**:

1. Are recorded worker PIDs still alive, and still *our* processes? The sidecar code
   already matches a script marker before killing (`main.ts:91`, `main.ts:114`) — reuse
   that discipline rather than trusting a bare PID.
2. Is the working copy dirty? Does `HEAD` match the last checkpoint?
3. Was the last journaled event a completed step, or a send with no recorded outcome?

Case 3 enters `RECONCILING` and then `PAUSED_NEEDS_REVIEW`. A send with no recorded
outcome is indistinguishable from a successful send, so the safe assumption is that it
landed.

This applies to every non-idempotent action, and worker prompts are the primary case.

---

## 9. Isolation is not a security boundary

Two separate concepts that must not be conflated:

| Concept | What it actually provides |
|---|---|
| **Git worktree** | Protects repository history. Provides reversible working state. Keeps the primary checkout clean and reviewable. |
| **Capability / access boundary** | Controls what the worker process is allowed to read, write and execute. |

**A git worktree is not a sandbox.** A subprocess running inside a worktree can read
any path on the machine that the user can read. Do not document or describe it as
containment.

Practical least-privilege controls the architecture must support:

- allowed project paths / forbidden paths, enforced by the runtime before dispatch
- environment allowlisting rather than inherited `process.env`
- credential exclusion (see section 10)
- forbidden commands: `git push`, `npm publish`, `gh pr merge`, deploy CLIs, package
  installs, anything touching `local-data/`
- approval-required actions for anything reaching production or the network destructively

**Honest limits.** Meaningful network isolation of a child process is not achievable
without infrastructure out of scope for V1. Do not claim it. What is achievable: never
passing permission-skipping flags to workers, so the agent's own confirmation prompts
remain a second independent gate; and journaling every command with its exit code so the
run report is an audit trail rather than a summary.

---

## 9a. What Phase 2 enforcement actually guarantees

This section exists so nobody — human or agent — mistakes the capability policy
for a sandbox. Read it before adding a real worker.

### Enforced: orchestrator policy

Every effect Autopilot performs travels one path:

```txt
Intent -> Policy -> [Approval] -> Journal -> Dispatcher -> Platform port
```

Along that path DexNest genuinely guarantees:

- Path access is canonicalized and boundary-checked before dispatch, and again
  through `realPath` immediately before the effect, so a symlink or junction
  existing at dispatch time cannot redirect it.
- `D:/DeskNest/local-data` and the other always-denied roots are refused
  regardless of Run Spec — a run cannot be *configured* into reading the vault.
- Commands are structured (executable + argument array, never a shell line), and
  shells and script hosts are denied outright, because a shell turns arguments
  into an opaque program that policy cannot inspect.
- A dispatched command receives an allowlisted environment. Known API keys and
  secret-shaped variables are stripped even if explicitly allowlisted.
- A run can terminate only processes it started.
- Gated operations require a human decision, scoped to one exact intent,
  identified by fingerprint and re-verified immediately before dispatch.
- Every decision, approval and denial is durably journaled.

The runtime cannot bypass this: `packages/autopilot-runtime` imports no
filesystem, process or git module, and an architectural test fails the build if
any module other than the dispatcher reaches a platform port.

### NOT enforced: OS-level containment

**Autopilot is not a sandbox, and Phase 2 does not make it one.**

The decisive limitation is this: a future worker such as Claude Code or Codex is
a normal Windows process running as the user. Once DexNest starts it, that
process has the user's full rights. It can open `C:\Users\...` directly, read
`local-data`, spawn its own shell, and reach the network — **without asking
DexNest**, and therefore without passing through any policy in this document.

So the boundary is precisely:

| | Enforced by DexNest | Not enforced |
|---|---|---|
| Effects Autopilot performs itself | Yes — every intent | — |
| Effects a worker asks Autopilot to perform | Yes | — |
| Effects a worker performs on its own | — | **No** |
| Network access of a child process | — | **No** |
| Filesystem reach of a child process | — | **No** |

What actually constrains a real worker in Phase 3 is therefore *not* this policy
layer alone, but: running it in a worktree so its natural working directory is
isolated; never passing permission-skipping flags, so the agent's own
confirmation prompts remain a second independent gate; a stripped environment so
it holds no credentials; and git checkpoints so its work is reversible.

Genuine containment would need OS-level mechanisms — a restricted token, an
AppContainer, a container or a VM — which are explicitly out of scope. Do not
describe DexNest as sandboxing a worker, in code comments, documentation or UI.

### Other honest limits

- **Command semantics are not analysed.** An argument that is an absolute path is
  checked; an argument that *implies* a path (a config file naming another file,
  a script that opens something) is not.
- **The realPath check is not atomic.** It closes the window for links that exist
  at dispatch time, not for one created between the check and the syscall.
- **`USERPROFILE` and `APPDATA` are preserved** in the child environment because
  most toolchains fail without them, even though they name directories path
  policy denies. Autopilot will not open those paths itself; a child process
  could use them to find its own config.
- **Stream Deck approval is a human authorization interface**, not hardware
  isolation. It requires the control token, but a compromised host can still
  drive it.

## 10. Sensitive data boundary — `local-data/`

**Verified against this repository.** `local-data/` exists at the repo root, is
gitignored, and contains live private data:

```txt
local-data/
  settings/     57 JSON files, including:
                  vault-documents.json
                  finance-transactions.json, finance-profiles.json
                  integration-keychain.json     (DPAPI/safeStorage credentials)
                  govee-api-key.local.json
  data/         dexnest.sqlite  (+ -wal, -shm)   <- live event log
  files/        vault/ receipts/ captures/ drop/ scans/ tools/ speech/
  session/ app/ backups/ index/ models/ db/
```

### The rule

> **Access to DexNest source code does not imply permission to read or modify DexNest
> runtime data.** An Autopilot run working on the DexNest repository must not gain
> access to `local-data/`. It is denied unconditionally, including when DexNest is the
> target project.

This is the case that will actually occur, because Autopilot is intended to help build
Autopilot.

### Two verified subtleties

1. **A worktree does not carry `local-data/`.** It is gitignored and untracked, so
   `git worktree add` produces a tree without it. This helps, but per section 9 it is
   not containment — the worker can still reach the original path directly. The runtime
   must deny the path explicitly, not rely on absence.

2. **The data root is resolved by absolute path, not by repo location.** `main.ts:35-41`
   resolves `CANONICAL_DATA_ROOT = D:/DeskNest/local-data` and uses it whenever it
   exists, regardless of where the app is launched from:

   ```txt
   1. DEXNEST_DATA_ROOT env var, if set and non-empty
   2. D:\DeskNest\local-data, if it exists       <-- absolute, wins from anywhere
   3. <app root>/local-data
   ```

   Consequence: a DexNest build launched from an isolated worktree **still reads and
   writes the real user's live `local-data/`**. Any future Autopilot verification tier
   that launches DexNest itself must set `DEXNEST_DATA_ROOT` to a scratch directory, or
   it will mutate real vault, finance and event data during an autonomous run.

Secrets must not be sent to external reasoning services. `.env*` files, the integration
keychain and vault contents are excluded from all worker and supervisor context.

---

## 11. Safety and authority

**Permissions, stopping and recovery are not late-stage features.** They belong in the
first working runtime, before any worker exists. Retrofitting a stop button into a
running state machine is harder than building one in.

The first loop must support: allowed and forbidden workspace, pause, stop, worker
termination, failure and retry limits, approval-required actions, crash recovery,
reconciliation, and durable execution history.

### Reversibility

> **"Send prompt to worker" is not a reversible action.**

The instant a prompt lands, the worker may write files or run commands. This breaks the
risk model DexNest already uses, where `reversible` and `dangerLevel`
(`docs/ACTION_EVENT_CONTRACTS.md`) describe what *DexNest* does.

For Autopilot, **risk is assessed on the worker's capability envelope** — what the agent
could do once handed control — not on the DexNest action that starts it. A single
`send_prompt` inherits the union of every capability the worker session holds.

### Stop and pause semantics

| Control | Behaviour |
|---|---|
| **Pause** | Send no further prompts. Let the current command finish. Checkpoint. |
| **Stop** | Terminate the worker process tree. **Leave the working copy exactly as it is.** Never auto-revert — the user stopped it in order to look. |

Both must work with the renderer closed. This is satisfied by the section 4 boundary.

### Stream Deck

DexNest's existing Stream Deck support provides a useful physical approval surface:
`APPROVE` / `REJECT` / `PAUSE` / `STOP`.

This is a **human authorization interface**. It is not hardware security isolation and
must not be described as equivalent to a dedicated security MCU.

---

## 11a. The autonomous loop and the loop grant

The loop is: send a turn to the chosen sticky worker, run mechanical
verification, feed failures back to the SAME session, repeat within limits, then
complete or hold for a human. There is no planner and no model chooses the next
step; a repair prompt is a deterministic template filled with the failing tier,
its exit code and the tail of its real output.

### The one authority change

Section 11 forbids granting broad standing authority because one intent was
approved. That still holds, and a per-turn button press would make an
unattended loop impossible, so the loop introduces a **LoopGrant**: a human
authorizes at most N turns for ONE run, provider, session and workspace.

What is unchanged:

- Policy still returns REQUIRE_APPROVAL for every worker prompt.
- Every turn still creates its own approval row and its own operation.
- Each approval is resolved with `source: "loop_grant:<id>"`, so the audit shows
  exactly which authorization covered which turn.
- Budget is spent per turn and is **derived by counting consumed turns**, so a
  crash between consuming and sending cannot double-spend.
- Revoking is immediate and stops the loop at the next turn boundary.

What this is not: a session-wide blanket approval, an unbounded grant, or
authority over anything except sending prompts to the already-chosen worker in
the already-validated worktree. Everything else the worker asks Autopilot to do
still goes through ordinary policy.

### Completion is never asserted

A run completes only when every gating verification tier passes AND every
acceptance criterion is automated AND all of them pass. A judgment criterion, a
criterion with no runnable check, or no criteria at all makes the outcome
INDETERMINATE, which holds the run in NEEDS_REVIEW. The loop cannot declare
success it did not mechanically establish.

### Known-good checkpoints

After a fully green verification the loop commits the run's worktree, so a later
regression has a state to return to.

- Only a **PASSED** verification earns a checkpoint. Failed and indeterminate
  results never produce one — a failing or unproven tree is not known-good.
- A green turn that changed nothing records `NO_CHANGES` against the existing
  HEAD rather than creating an empty commit.
- The message is authored by DexNest, never by a model, and carries a marker
  `dexnest-checkpoint:<turnId>`.
- Never push, never merge, never rebase, never amend, never delete.
- One checkpoint per turn, enforced by a UNIQUE index.
- Every git call goes through the effects gateway and the same capability policy
  as any other effect.

**Crash reconciliation.** The intent is journaled and committed before git runs.
If a process dies between `git commit` and recording the SHA, the next attempt
searches history for the marker (`git log --all --fixed-strings --grep=`) and
adopts the commit that already exists. It never commits again. Repeated restarts
are therefore idempotent, and a stop or failure leaves both the worktree and the
latest checkpoint intact.

### The run report

Rebuilt from SQLite on every request — runs, journal, worker sends, grants,
turns, verifications, checkpoints and workspace snapshots. It runs no git and
reads no renderer state, so the same report is produced before and after a
restart, and for stopped and failed runs just as much as completed ones.

Final workspace evidence (HEAD, `git status --porcelain`, `git diff --stat`) is
captured durably at each verification outcome rather than gathered at report
time, which is what keeps the report reproducible after a restart.

Following AGENTS.md, the report records what happened rather than private
content: prompts and provider output stay in the worker store and appear here as
ids and lengths only.

Export writes JSON and Markdown through ordinary `WRITE_FILE` intents, so policy
decides where a report may land. Artifacts go to `<worktree>-autopilot-artifacts`,
deliberately outside the worktree so an export is never a source change and can
never be swept into a checkpoint commit.

### Interaction between stop and uncertainty

Stopping a run terminates a live worker process. Killing a prompt that was
already sent does not undo whatever it did, so the honest outcome is an
UNCERTAIN send and a NEEDS_REVIEW run — not a clean STOPPED. A stop requested
between turns ends the run cleanly instead. Both behaviours are tested.

## 12. Verification

An agent saying "done" does not mean the task is done. Cheapest and most deterministic
tier first; stop at the first failure.

| # | Tier | On failure |
|---|---|---|
| 1 | Diff sanity — files in scope, size, no forbidden paths | Same worker, always |
| 2 | Typecheck (`pnpm typecheck` exists) | Same worker, always |
| 3 | Lint | Same worker |
| 4 | Unit tests | Same worker; escalate on repeat |
| 5 | Build (`pnpm build` exists) | Same worker; escalate on repeat |
| 6 | App launch / smoke | Escalate sooner — often environmental |
| 7 | Browser E2E, screenshots, responsive checks *(later)* | Same worker, with screenshots |
| 8 | Acceptance criteria against the Run Spec | Automated -> worker; judgment -> supervisor |

### Escalation predicate

Straight back to the **same worker** when the failure is deterministic, localized and
novel — a type error, a failing assertion, a missing import. No supervisor, no
notification. This is the bulk of failures, and handling them silently is most of
Autopilot's value.

Escalate to the supervisor when any of these is true:

- the same check fails three times with materially different diffs
- a fix reaches outside the declared scope
- the criterion is a judgment call
- the worker proposes amending a constraint
- a Run Spec budget is exhausted

Escalate to the **human** for authority, subjective decisions, sensitive operations, and
unresolved blockers.

These are evaluable predicates, not a model's self-assessment of whether it is stuck.

---

## 13. Evidence-based completion

Progress comes from evidence, not narration. Never display a percentage that does not
correspond to something counted.

Run history must capture: the Run Spec, tasks attempted, state transitions, verification
results, git checkpoints, final diff, worker and session history, recovery events,
consultant use, supervisor reviews, human interventions, approvals, failures and their
fixes, and final acceptance-criteria status.

---

## 14. Action Router direction

Long-term general computer control follows deterministic-first routing:

```txt
1. direct system / process / filesystem operation
2. CLI / script
3. app-specific adapter
4. browser DOM / CDP
5. Windows accessibility / UI Automation
6. deterministic keyboard shortcut
7. OCR / vision
8. raw mouse / keyboard                    <- last resort
```

**This hierarchy alone is not the moat.** Defensibility comes from the combination of
reliable adapters, accumulated workflow knowledge, recovery behaviour, verification,
project memory, user preferences and historical execution evidence. The ordering is a
correctness principle, not a competitive advantage on its own.

The architectural requirement that follows: express every effect as an **intent routed
through a dispatcher**, even while the only implemented strategy is "run a CLI command".
Hard-coding `execFile` calls throughout the state machine turns the later general-PC
layer into a rewrite; routing `run_tests` through a dispatcher with exactly one strategy
makes it additive.

**Do not implement an ActionRouter package in Phase 0.** A minimal dispatcher interface
arrives with the first executing loop.

---

## 15. Existing DexNest infrastructure — reuse, do not duplicate

Re-verified against the current working tree at commit `f634cbe`.

| Capability | Location | Notes |
|---|---|---|
| Process spawn, `execFile`, detached spawn | `main.ts:2`, `main.ts:9` | Python sidecars, `code`, PowerShell |
| Process-tree termination | `main.ts:119` | `taskkill /PID <n> /F /T` |
| Stale PID discovery and reaping | `main.ts:91`, `main.ts:114` | Matches a script marker before killing — the correct pattern for worker reconciliation |
| Action execution | `runRegisteredAction`, `findAction` (`main.ts:10720`) | Central executor |
| Risk vocabulary | `dangerLevel`, `requiresConfirmation`, `reversible` | `docs/ACTION_EVENT_CONTRACTS.md` |
| Dangerous-routine gating | `routineHasDangerousSteps` (`main.ts:6286`) | Already refuses to bind risky routines to triggers |
| Local HTTP control server | `main.ts:19942`, listens `main.ts:20119` | Port 43217 |
| Control-endpoint authorization | `authorizeControlEndpoint` (`main.ts:10820`) | Localhost-only unless `lanEnabled`; token check only when `tokenEnabled` |
| Stream Deck integration | `packages/action-registry` catalog, `streamdeck-actions/` | Note: `streamdeck-actions/` is gitignored |
| Event log | `packages/local-db`, `appendActionEvent` | 153 call sites, one table |
| Push to renderer | `webContents.send` | 6 channels, e.g. `dexnest:open-view` |
| Credential storage | `safeStorage` / DPAPI (`main.ts:3305`-`3417`) | Integration keychain |
| Git access | `execFileSync("git", ...)` (`main.ts:1993`, `main.ts:2001`) | Branch, tracked files |
| Worker pause policy | `performanceModePauses` (`main.ts:4637`) | Gates heatmap, OCR, indexing, backups, assistant, nudges |
| Backup / restore | `createBackup` (`main.ts:2287`), `restoreBackupConfirmed` (`main.ts:2769`) | Zip-entry safety checks |
| Project registry | `loadProjects` (`main.ts:3913`), `DexNestProject` | A run targets an existing project |
| Routines | `main.ts:1638`, `main.ts:8269` | Linear action lists, manual trigger only |

**Autopilot registers into `performanceModePauses` rather than inventing a second pause
mechanism.**

### Do not create

A second event log. A second process manager. A second credential store. A second
notification path. A second HTTP control endpoint. A second project concept. A second
pause mechanism. A second database layer.

### Module wiring — follow live wiring, not directory structure

`modules/*` contains five packages: `command`, `deck`, `dev`, `clipboard`, `drop`.
Three (`@dexnest/module-command`, `@dexnest/module-deck`, `@dexnest/module-dev`) are
declared as `workspace:*` dependencies in `apps/desktop/package.json`, but **none of the
five is imported anywhere in `apps/desktop/src/`**. Their exports (`deckActions`,
`DevDashboard`) have zero references in the repository. They are stubs — `modules/deck`
is a single placeholder action; `modules/dev` is hardcoded sample cards.

There is no live module-registration system. All real module logic lives in
`apps/desktop/src/main/main.ts` (21,089 lines) and
`apps/desktop/src/renderer/main.tsx` (17,857 lines).

> **Do not create `modules/autopilot` merely because a `modules/` directory exists.**
> Autopilot lives in `packages/autopilot-runtime` with views under
> `apps/desktop/src/renderer/views/`.

---

## 16. First milestone — target, not current scope

**Do not implement this yet.** Documented so that Phase 1 onward aims at it.

> One bounded real coding objective, completed unattended, using: an explicit Run Spec,
> an isolated working copy, one sticky primary worker, durable state, hard verification,
> an automatic repair loop, working pause/stop, crash recovery and reconciliation, and an
> evidence-based report — with zero manual copy/paste during the run.

Success is a **verified outcome**, not runtime duration. A kill test must prove that
interrupting DexNest or the worker mid-run does not cause blind duplicate execution.

---

## 17. Explicitly deferred

Preserve architectural room for these. Do not build speculative abstractions for them.

- continuous screen capture; OCR perception engine; vision models
- generic Windows mouse automation; raw input synthesis
- Teach Mode; workflow learning
- mobile application; general remote-control backend
- multi-agent tournaments
- autonomous production deployment
- Vault / Finance automation
- broad arbitrary-PC control
- macOS and Linux support
- large local LLM infrastructure
- ChatGPT consumer UI automation
- simultaneous autonomous writing workers
- generic plugin ecosystem
- separate Autopilot runtime process (until evidence justifies it)
- pixel-level visual regression (screenshots-as-evidence first)
- more than two worker adapters

---

## 18. Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture freeze, constitution amendment, sensitive-data boundary | **Complete** |
| 1 | Durable spine: Run Spec, state machine, SQLite schema, reconciliation, pause/stop | **Complete** |
| 2 | Isolation, capability policy, approvals, dispatcher seam | **Complete** |
| 3 | Claude worker adapter | Foundation and controlled host/UI turn complete; tool execution deferred |
| 4 | Verification, checkpoints, evidence report -> first milestone | **Complete** — mechanical verification, the sticky single-provider loop, known-good checkpoints and the durable run report all exist |
| 5 | Codex adapter, consultant mode, attention queue | Controlled Codex adapter implemented in Phase 3; consultant mode and attention queue not started |
| 6 | SupervisorAdapter, browser verification | Not started |
| 7+ | General PC autonomy | Not started |

As of Phase 2 the runtime, schema, state machine, journal, reconciliation,
scripted executors, path and command policy, environment filtering, process
ownership, the intent model, the dispatcher, git worktree lifecycle and durable
approvals all exist. No worker adapter, no verification tiers, and no AI
integration of any kind existed at that phase boundary.

## 19. Phase 3 first slice: worker foundation

`WorkerAdapter` is a provider-neutral lifecycle in `src/worker.ts`, implemented
by `ClaudeCodeWorker` using pure command/protocol translation. It receives the
existing effects gateway, enforced policy and persistence ports. It never
receives an unmediated process spawner. No supervisor, fallback, retry loop or
ChatGPT integration is introduced.

Foundation integration contract (used by the controlled host in section 20):

1. Select the existing Phase 2 worktree and a matching run-specific policy.
2. Configure a native Claude executable (not an npm `.cmd`/PowerShell shim).
   Availability detection uses `--version` and `auth status --json`; only an
   existing `claude.ai` subscription login is accepted. The tested CLI is
   2.1.207; older versions are reported unsupported. A newer version still needs
   protocol validation. No quota probe starts a paid model turn.
3. `startSession(runId)` reserves a host-generated UUID transactionally.
   `resumeSession(runId)` attaches the same durable identity. Neither sends a
   paid prompt. `sessionAvailability` reports local/historical evidence only;
   actual provider session availability is confirmed on the next explicit send.
4. With the run explicitly RUNNING, `sendPrompt({runId,sendId,prompt})` sends
   exactly one turn. The first uses `--session-id`; subsequent confirmed turns
   use `--resume`, never `--continue`, `--fork-session`, or a new identity.
5. `interrupt`/`cancel` terminate only the send's currently owned operation tree
   through the dispatcher. A pending approval can be cancelled without dispatch.
   Interrupted work is uncertain, not reverted. Engine stop also interrupts the
   adapter-owned operation. Session IDs never authorize terminating a bare PID
   recovered from a previous host process.

This foundation deliberately uses `--safe-mode`, `--tools ""`, manual permissions,
subscription-only login settings and one turn. Tools/custom hooks/plugins/MCP
are disabled. It can exchange prompts with a real coding-agent CLI but cannot
yet edit a project. No permission-bypass flags are available. The child receives
the Phase 2 filtered environment; `ANTHROPIC_API_KEY` is additionally stripped
unconditionally at dispatch. `--bare` is not used because it changes auth behavior.

Migration 3 adds `autopilot_worker_sessions` and `autopilot_worker_sends` to the
existing SQLite connection. Session identity is unique and tied to one run and
worktree. A partial unique index permits only one unresolved send per run.
Prompt/result bodies are private run records, not audit event payloads. Prompts
travel via stdin, not process arguments. Operation fingerprints cover stdin,
but persisted operation descriptions omit it; replay requires the original
exact prompt, including after human approval.

The send record and WORKER_SEND_INTENT commit before the effects gateway is
called. Immediately before platform dispatch, the gateway commits its operation
identity and the worker records DISPATCHING. An explicit structured result with
the expected session ID is required for success; exit zero alone is insufficient.
Results distinguish auth, quota, missing session, policy/permission, process,
timeout, interruption and malformed protocol failures. No result means no claim
of success, even if some work may have occurred.

On restart, INTENT/DISPATCHING/UNCERTAIN sends enter RECONCILING then NEEDS_REVIEW.
The engine checks these even when no generic run step exists. It never resends
them, including across repeated restarts. Completed sends return their durable
result; pending approvals rejoin the same operation. Human evidence resolution
is defined in section 20. Do not reset an uncertain send to INTENT as a retry mechanism.

The foundation slice did not switch the desktop host from scripted runs to
Claude. Tests use isolated SQLite databases,
real temporary git worktrees, a fake Claude CLI, real process-tree interruption
on Windows, and hard-crash child harnesses. No real model prompts are needed.

## 20. Phase 3 second slice: one controlled host/UI turn

`ControlledWorkerTurns` handles explicit desktop requests, separate from the
scripted executor. `AutopilotEngine.start/resume` reject Claude runs; they cannot
fall into a scripted or autonomous loop. The host injects an existing native
Claude executable and validates the selected primary repository and existing
registered worktree before worker actions. The worktree must be canonical,
outside the primary repository and outside denied roots. This slice creates no
worktrees and offers no renderer-supplied executable/argument/environment fields.

The UI explicitly selects scripted simulation or Claude (external AI opt-in).
Preparing a prompt reserves/resumes the durable session, probes CLI version and
subscription auth, saves the exact prompt, and requests an operation-specific
approval. It does not send a model prompt. **Approve and send once** authorizes
and dispatches that saved send ID through the existing effects gateway. Command
fingerprints, dispatch claims, filtered environment, safe mode, disabled tools,
manual permissions and one-turn limit are unchanged. There is no automatic next
prompt. Completion holds the run at PAUSED; it does not claim the goal is done.

Only the current desktop window's main frame can use Autopilot IPC. Startup
recovery must finish first. Existing token-authenticated approval routes can
resolve approval authority but never dispatch a worker prompt. Registry worker
actions open the review surface; actual send/resolution needs the scoped desktop
control. Shared audit events contain IDs/status/failure metadata, not prompt,
output or human evidence bodies. The UI renders provider output as bounded,
scrollable plain text, with no HTML, Markdown execution or tool affordances.

Migration 4 adds append-only human resolution records and a unique `retry_of`
link. The human must identify the specific UNCERTAIN send and provide evidence
for a final decision:

- **Completed:** settle this send as human-confirmed, mark its same session as
  established, retire any old approval/operation authority, and hold. No resend.
- **Not sent / safe to retry:** settle this send without dispatch, retire its
  old authority, and hold. A separate explicit preparation may allocate one
  linked new send with the exact same prompt and a new approval. A unique index
  permits only one retry child. The original send/operation is never reset.
- **Keep unresolved:** append the decision and retain UNCERTAIN/NEEDS_REVIEW.

Resolution, send settlement, approval retirement and run journal/state update
commit in one transaction. Repeated final resolution is idempotent; conflicting
final decisions are rejected. Resolutions are blocked while the owned worker
action is still active. Stopped runs remain stopped even when a human resolves
their uncertain send. The user must verify the provider session themselves;
the host does not inspect provider transcripts or invent evidence.

Recovery never dispatches a prompt. Even a send still marked AWAITING_APPROVAL
becomes uncertain when its operation already has a dispatch claim. Session IDs,
pending approvals, uncertain sends, resolutions and retry consumption survive
repeated host restarts. Cancellation uses only the live adapter's owned process
tree; old persisted PIDs never authorize termination.

Validation uses the real host IPC handlers, isolated SQLite and git worktrees,
fake Claude processes, abrupt host-child exits, and Windows process-tree checks.
See `AUTOPILOT_PHASE3_CONTROLLED_TURN.md` for the changed files and test results.
No paid model invocation is needed for this slice.

Recommended next slice: read-only session evidence import/reconciliation with
explicit provenance, plus a clearer native installation/worktree setup flow.
Tools remain disabled until a separate approved slice defines their policy and
containment boundary. Autonomous repair, ChatGPT web integration and supervisors remain
later work. Section 9a's lack of OS-level containment still applies.

## 21. Phase 3 third slice: Codex controlled worker

Codex now shares the existing WorkerAdapter, dispatcher, approvals, worker journal,
human resolution and controlled-turn UI with Claude Code. Provider selection is
explicit and immutable per run. A local session reservation is bound to the Codex
thread ID in a committed transaction before the first turn/start reaches stdin.
Later turns resume that exact thread; missing sessions fail without replacement.

The native Codex 0.153.0 app-server runs on demand with ChatGPT authentication,
filtered environment, API keys stripped, read-only sandbox and tool access disabled.
Effective configuration and account type are checked before thread creation.
Unknown versions or incompatible settings fail closed. No autonomous loop exists.
See [the implementation report](AUTOPILOT_PHASE3_CODEX_WORKER.md) for the contract,
changed files, compatibility details and validation results.

## 22. Control Center and durable roles

The desktop now exposes New Run, Runs and Selected Run areas. Creation is a
runtime service behind trusted IPC: validate the form, inspect native provider
readiness without a model call, create a separate worktree through the effects
gateway, reserve the sticky primary session, and authorize a bounded primary
LoopGrant. The host starts the existing loop; React never orchestrates turns.

Run Specs may configure one primary and the other provider as an optional
consultant. A consultant is configuration only. Migration 10 assigns historical
worker sessions and LoopGrants to PRIMARY, without changing their IDs. The
runtime and database reject consultant implementation ownership. Read-only
reports, dashboard filters and the activity timeline reconstruct from SQLite.

See [the Control Center implementation report](AUTOPILOT_CONTROL_CENTER.md) for
the milestone boundary, validation and limitations. Earlier slice descriptions
above document the capabilities at the time those slices shipped.


## 23. Deterministic PRIMARY stuck detection

Versioned PRIMARY_PROGRESS_EVALUATED events persist decisions in the existing
SQLite journal; no migration is needed. Report schema 4 reconstructs the latest
decision, originating turn, verification reference, diagnostic fingerprints,
consecutive comparison count and consultant recommendation without repository reads.

The first ordinary failure remains PROGRESSING. Three consecutive equivalent
comparisons (four matching turns) become STALLED only with unchanged workspace
evidence. Changed diagnostics or workspace evidence reset the count. Repeated
identical request-only turns use the same threshold. Workspace comparison uses
recorded HEAD/status/diff statistics and cumulative fingerprints of applied file
contents. Missing snapshots cannot establish lack of change.

STALLED enters NEEDS_REVIEW before another repair turn. The hold survives restart
and new grants. Terminal provider failures are BLOCKED with original send evidence
preserved. Auth/quota/session/protocol/installation obstacles may recommend another
provider. Policy and verification configuration blocks do not recommend circumventing
the obstacle. Interrupts/timeouts retain existing hold behavior.

Limits: lower failure/grant budgets can hold sooner. Fingerprints are diagnostic,
not cryptographic identities. Changed content is activity, not proof of semantic
improvement. External same-size edits invisible in stored diff statistics may be
missed. No hold reset, consultant execution, or switching is added.
