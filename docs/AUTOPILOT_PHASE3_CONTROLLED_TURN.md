# DexNest Autopilot: controlled Claude turn

Implemented the second small Phase 3 slice. Claude runs now use the existing
adapter through trusted desktop IPC, with a saved-prompt review and one explicit
dispatch. No real model prompt was sent during implementation or validation.

## Files changed in this slice

The workspace already contained accepted, uncommitted Phase 1/2/3 work. This list
identifies the files touched for this slice, rather than every entry in git status.

| File | Change |
| --- | --- |
| `packages/autopilot-runtime/src/controlledWorker.ts` | New controlled-turn coordinator; prepare, approve/send, resolve, interrupt and snapshot |
| `packages/autopilot-runtime/src/workerStore.ts` | Send history, human resolution transaction, original approval retirement and one-use retry links |
| `packages/autopilot-runtime/src/worker.ts` | Optional retry provenance and immediate reconciliation of an already-claimed dispatch |
| `packages/autopilot-runtime/src/engine.ts` | Prevent Claude runs entering the scripted loop; recover dispatch claims even when the send still says awaiting approval |
| `packages/autopilot-runtime/src/states.ts` | Human worker resolution event; recovery edges for CREATED/READY runs |
| `packages/autopilot-runtime/src/migrations.ts` | Additive migration 4 for resolution history and unique retry provenance |
| `packages/autopilot-runtime/src/index.ts` | Export the controlled-turn contract and human resolution types |
| `apps/desktop/src/main/autopilotHost.ts` | Adapter wiring, trusted-main-frame IPC, startup recovery gate, worker snapshots, notifications and audit metadata |
| `apps/desktop/src/main/autopilotWorkerConfig.ts` | Native installation discovery and canonical registered-worktree validation |
| `apps/desktop/src/main/preload.ts` | Narrow worker IPC bridge methods |
| `apps/desktop/src/main/main.ts` | Registry navigation to contextual worker review controls |
| `apps/desktop/src/renderer/views/AutopilotView.tsx` | Explicit provider/worktree selection, prompt review, one-send control, status/output and uncertainty resolution |
| `packages/action-registry/src/index.ts` | Register contextual worker review/send/resolution/cancellation actions |
| `packages/autopilot-runtime/test/controlledHost.test.ts` | Eleven host integration tests |
| `packages/autopilot-runtime/test/helpers/controlledHostHarness.ts` | Real host handlers with fake IPC/window and fake Claude process injection |
| `packages/autopilot-runtime/test/helpers/controlledHostCrashChild.ts` | Abrupt host-child exits at three durability boundaries |
| `packages/autopilot-runtime/test/persistence.test.ts` | Upgrade test preserving a Phase 3 foundation session and uncertain send |
| `docs/AUTOPILOT_ARCHITECTURE.md` | Record the current controlled-turn boundary and recovery contract |
| `docs/AUTOPILOT_PHASE3_CONTROLLED_TURN.md` | This implementation and validation report |

## Host and UI behavior

Select **Claude Code** explicitly, enter the primary repository and an existing
registered worktree, then create the run. Native executable discovery checks the
standard user-local installation and native npm package installation. It does
not invoke `.cmd`/PowerShell shims or accept an executable from the renderer.

**Prepare prompt for review** validates the worktree, attaches/reserves the
run's durable session, checks version/subscription auth, and persists a prompt
with its exact operation approval. It sends no model prompt. **Approve and send
once** dispatches only that saved send ID and prompt. A completed turn holds at
PAUSED; another turn requires another explicit preparation and approval.

Session UUID and worktree cwd stay fixed. First dispatch uses `--session-id`;
subsequent confirmed turns use `--resume`. The adapter retains `--safe-mode`,
disabled tools, manual permissions, subscription-only auth, the Phase 2 filtered
environment, unconditional API-key removal and the one-turn limit. Every command
still uses the policy/approval/journal/dispatcher path. No tools, fallback,
supervisor, ChatGPT, Codex or autonomous loop were added.

The UI shows session/send/operation identity, run state, captured text and failure
metadata. Prompt/output/evidence are rendered as plain text. Shared audit events
contain metadata only; private bodies remain in the existing runtime database.
Change notifications are event-driven. Generic start/resume cannot accidentally
run the scripted executor for a Claude run. Registry actions open the contextual
review surface; they cannot dispatch prompts through generic action payloads.

## Uncertain-send resolution

INTENT, DISPATCHING and UNCERTAIN sends survive restart without replay. An
AWAITING_APPROVAL send also enters NEEDS_REVIEW if its operation already has a
dispatch claim. The UI identifies the exact send, prompt, operation and session.

- **Completed:** human evidence settles the send and confirms the same session.
  No prompt is resent, including on repeated clicks or restarts.
- **Not sent / safe to retry:** human evidence settles the old send. A separate
  explicit action prepares one linked retry with a new send/operation ID and a
  fresh prompt approval. A unique index prevents consuming that retry twice.
- **Keep unresolved:** records the decision while preserving NEEDS_REVIEW.

Final decisions require evidence text. Resolution, send settlement, retirement
of old pending approval/operation authority, and the run journal/state update
are atomic. A final decision cannot be contradicted by a later click. An active
owned worker must finish interruption before resolution is allowed. Terminal
runs remain terminal. Provider-session evidence is supplied by the human; the
adapter does not claim that it independently verified a human decision.

## Validation

- `corepack pnpm test`: **128 passed, 0 failed, 0 skipped**. All 116 existing
  tests pass, plus 11 host tests and one migration-upgrade test.
- `corepack pnpm build`: **passed**, including runtime/test typechecking and
  Electron main/preload and renderer production bundles. The existing large
  renderer-chunk warning remains.
- `corepack pnpm --filter @dexnest/desktop exec tsc -p tsconfig.node.json --noEmit`:
  **passed**.
- Renderer typecheck reports the two pre-existing missing `qrcode` declaration
  errors in `renderer/main.tsx` and `renderer/views/DropView.tsx`. No Autopilot
  renderer type errors were reported.
- `git diff --check`: passed for tracked changes.

The host tests exercise actual IPC handlers, real isolated SQLite connections,
temporary registered git worktrees and real Windows child processes running the
fake Claude CLI. They prove same-session resumption, explicit approval before
dispatch, no duplicate send on repeated clicks/restarts, all three human
resolutions, retry consumption, transaction rollback, foreign-frame rejection,
workspace denial, safe environment/flags, and owned-tree cancellation while a
foreign process remains alive. Crash children exit abruptly after send intent,
after the dispatch claim, and after CLI execution before result persistence.

## Limitations and next slice

No paid Claude invocation was made. Actual subscription quota and live provider
completion were not tested. Installation discovery covers the two conventional
native paths; unusual installations need trusted host configuration. Worktrees
must already exist. This slice has no transcript import, result streaming,
automatic evidence collection or tool execution. Worktree isolation remains an
orchestrator boundary, not an OS sandbox.

Browser verification was attempted, but the browser runtime reported no connected
browsers. Visual rendering and real Electron IPC delivery were not exercised in
a live app; host IPC behavior was tested with the fake window/IPC harness. The
running DexNest instance was not restarted.

Recommended next slice: read-only provider-session evidence import with explicit
provenance, so human uncertainty decisions can reference verified session
evidence. Keep tools disabled and retain separate approval for every turn. A
later, separately approved slice should define constrained tool execution and
its containment boundary before enabling any coding loop.
