# DexNest Phase 3: Codex controlled worker

## Outcome

Codex is the second real adapter in the existing controlled-turn infrastructure.
Users explicitly choose Claude Code or Codex when creating a run. The provider is
stored in the Run Spec and worker session; no fallback or provider switching is
implemented. Each saved prompt still requires its own trusted host approval.

## Contract and transport

`CodexWorker` implements the existing `WorkerAdapter` through `DurableWorker`:
`detect`, `startSession`, `resumeSession`, `sessionAvailability`, `sendPrompt`,
`interrupt`, `cancel` and `reconcile`. It uses the same effects gateway, exact
intent fingerprint, dispatcher, process ownership and SQLite worker store.

The CLI transport is native `codex app-server --stdio`, with a bounded JSON-RPC
conversation: initialize, inspect effective configuration, inspect account,
thread/start or thread/resume, then exactly one turn/start. Agent message items
and matching turn completion become a structured WorkerResult. Raw configuration
and account responses are not stored or displayed. Any tool item or incoming
server request stops the process; DexNest never grants worker tool approvals.

Installation detection inspects native executable locations and `--version`.
This slice supports **codex-cli 0.153.0 only** and checks the app-server version
again at initialization. New versions require a compatibility audit. Shell shims
are rejected. CLI discovery covers common native and VS Code installations.

## Authentication and restrictions

`login status` must report ChatGPT login, and app-server `account/read` must
confirm a ChatGPT account immediately before session work. `forced_login_method`
is ChatGPT and the provider is the built-in OpenAI provider; custom OpenAI provider
configuration is rejected. DexNest does not initiate login or accept API billing.
Login availability does not promise remaining quota or a particular entitlement.

The child uses the Phase 2 filtered environment. Both OPENAI_API_KEY and
ANTHROPIC_API_KEY are additionally removed case-insensitively at dispatch, even
if an allowlist includes them. The existing validated worktree is the process cwd.
Read-only sandbox, user-reviewed on-request approvals, disabled environment/tool
access, disabled web/shell/apps/plugins/hooks/multi-agent features and explicit
tool settings are supplied without any permission-bypass flag.

Configured MCP names are discovered with restricted `mcp list --json`; only names
are retained. Each is disabled through child-local overrides. Global Codex config
is never edited. Effective config is checked again before thread creation, so a
newly enabled MCP server or conflicting managed setting fails closed. Provider
credentials remain managed by the existing CLI login; DexNest neither copies nor
parses credential files. DexNest session/send records remain in its local-data DB.

## Sticky session and durable sends

`startSession` reserves the durable DexNest session UUID without a model call.
On the first approved send, Codex returns its own thread UUID. Migration 5 adds
the nullable provider thread ID and provider options to the existing session row.
Binding the provider UUID and its journal event commits synchronously before
turn/start can be written to stdin. A bound UUID cannot be replaced. Subsequent
turns call thread/resume with that exact UUID and reapply restrictions.

The existing send intent commits before dispatch, and the dispatch claim commits
before process startup. Unknown outcomes remain UNCERTAIN/NEEDS_REVIEW across
restarts. Repeated requests for completed sends return the stored result. No
startup path replays prompts. Cancellation terminates only a live owned process
tree; a persisted PID does not grant termination authority.

The existing human resolution controls apply to Codex: keep unresolved; completed
(no resend); or not sent/safe to retry. Resolution evidence is durable and retires
the old approval. Safe resolution permits one linked explicit retry with a fresh
approval, still using the bound session. It does not itself send anything.

## Failure classification

Missing native executable, unsupported version, authentication, quota/rate limit,
missing/invalid session, permission/tool restriction, policy/configuration,
protocol, process exit, timeout and interruption remain distinct. An incomplete
transport after dispatch stays uncertain even if its likely failure is known.
A structured terminal failure can be recorded as certain; it is never retried
automatically. Missing sessions are not silently replaced.

## Files changed in this slice

Runtime under `packages/autopilot-runtime/src/`:

- New `codexWorker.ts` and `codexConversation.ts`: adapter and pure bounded RPC protocol.
- `worker.ts`, `workerStore.ts`, `migrations.ts`, `states.ts`: provider identity binding, configuration names and journal events.
- `intent.ts`, `ports.ts`, `dispatcher.ts`, `effects.ts`: fingerprinted interactive transport, session commit callback, sanitized result and mandatory key removal.
- `controlledWorker.ts`, `engine.ts`, `index.ts`: fixed-provider factory, controlled-only execution guard and exports.

Desktop and shared actions:

- `apps/desktop/src/main/autopilotPlatform.ts`: owned interactive process transport.
- `apps/desktop/src/main/autopilotWorkerConfig.ts`: native Codex discovery.
- `apps/desktop/src/main/autopilotHost.ts`: explicit Codex creation, availability and worker controls.
- `apps/desktop/src/renderer/views/AutopilotView.tsx`: provider selection, fixed-provider status, Codex thread identity and shared resolution/result controls. Output remains escaped text.
- `packages/action-registry/src/index.ts`: provider-neutral labels for existing worker actions; IDs and trusted control routing preserved.

Tests under `packages/autopilot-runtime/test/`:

- New `codex.test.ts`, `helpers/fakeCodex.mjs`, `helpers/codexReadOnlyProbe.ts`.
- `helpers/workerHarness.ts`, `helpers/controlledHostHarness.ts`, `helpers/controlledHostCrashChild.ts`: fake transport selection and session-binding crash injection.
- `persistence.test.ts`: additive migration expectation.
- This report and `docs/AUTOPILOT_ARCHITECTURE.md` describe the slice.

The workspace already contained accepted, uncommitted Phase 1/2/3 work. This
inventory identifies this slice; it does not claim all git-status changes are new.

## Validation

- `corepack pnpm test`: **143 passed, 0 failed, 0 skipped**, including all 128 existing tests and 15 Codex tests.
- `corepack pnpm build`: passed (existing large-renderer-chunk advisory).
- Runtime typecheck and Electron main `tsconfig.node.json` typecheck: passed.
- Workspace typecheck: remains blocked by the two existing missing `qrcode` declarations in renderer `main.tsx` and `DropView.tsx`; no other errors reported.
- Native Codex 0.153.0 read-only compatibility probe: passed effective configuration and ChatGPT account checks. The probe intercepts thread/start/resume before transmission. **No real thread or model prompt was sent.**

Tests cover sticky sessions and provider persistence, durable send and thread
binding before prompt bytes, abrupt crashes at four boundaries, repeated restart
without replay, stored duplicate results, human resolution and single explicit
retry, failed identity commit, API-key exclusion, worktree cwd, distinct failures,
API account/config rejection and Windows owned-process-tree cancellation while
an unrelated process remains alive.

## Limits and next slice

No paid live completion or visual desktop UI test was performed. Fake processes
validate the host/protocol path; the native probe validates only pre-turn setup.
Subscription quota is confirmed only by a real approved turn. The adapter is
version-pinned and does not provide an installation/login wizard.

A crash between Codex creating a thread and DexNest committing its ID may leave
an orphan provider thread. The send remains uncertain, with no guessed identity
or automatic replacement. A completed human resolution without a known provider
ID cannot manufacture a resumable session. Existing Phase 2 documentation's
absence of an independent OS containment boundary still applies.

Recommended next slice: read-only provider evidence import for uncertain sends,
with provenance and human confirmation. Keep tools disabled and turns explicit.
Provider switching, autonomous loops, supervisors, Codex tool execution and
ChatGPT web integration are outside this slice.
