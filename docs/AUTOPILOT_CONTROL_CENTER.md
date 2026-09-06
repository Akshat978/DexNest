# DexNest Autopilot Control Center

## Files changed

Runtime, under `packages/autopilot-runtime/src/`:

- New `controlCenter.ts`: validated NewRunForm, readiness mapping/probes, dashboard projection and creation service.
- New `roles.ts`: the two roles, provider-pair validation and PRIMARY-only execution guard.
- `runSpec.ts`, `store.ts`: optional durable consultant configuration, structured verification/acceptance commands, compatible interpretation of provider-only legacy specs and fingerprints for new authority fields.
- `migrations.ts`, `workerStore.ts`, `loopStore.ts`: PRIMARY ownership and restored-session evidence.
- `worker.ts`, `loop.ts`, `controlledWorker.ts`: role enforcement, explicit grant scope, provider readiness before loop startup and configured verification commands through existing policy.
- `verification.ts`: structured commands with worktree cwd; legacy command parsing remains supported.
- `dispatcher.ts`: real-path checks for worktree source and destination before creation.
- `report.ts`, `index.ts`: report schema 3, role/session projections, failure counts, activity and exports.

Desktop and shared actions:

- `apps/desktop/src/main/autopilotHost.ts`: trusted dashboard/readiness/creation/resume IPC, background primary launch, durable startup failure reporting and recovery attachment.
- `apps/desktop/src/main/preload.ts`: bridge methods.
- `apps/desktop/src/renderer/views/AutopilotView.tsx`: Control Center navigation, dashboard, detail, controls and evidence views.
- New `apps/desktop/src/renderer/views/AutopilotNewRun.tsx`: run creation form.
- New `apps/desktop/src/renderer/views/Autopilot.css`: scoped layout using DexNest tokens.
- `packages/action-registry/src/index.ts`: shared creation/readiness actions opening the trusted view.
- New `packages/autopilot-runtime/test/controlCenter.test.ts` and `apps/desktop/test/autopilotControlCenter.ui.mjs`.
- This report and `docs/AUTOPILOT_ARCHITECTURE.md`.

The workspace already contained uncommitted accepted work. This inventory identifies
this milestone, not every change listed by git status.

## Schema and migrations

Migration 10 adds `role='PRIMARY'` to existing worker sessions and LoopGrants,
with database CHECK constraints rejecting consultant ownership in this milestone.
It adds a durable restored flag for primary sessions. Existing IDs, provider
thread IDs, grants, sends, events, context requests and checkpoints remain intact.
Consultant configuration is part of the authoritative persisted Run Spec; no
consultant session is allocated. Historical specs are not rewritten. A stored
provider-only Claude/Codex spec is interpreted as PRIMARY with no consultant.

Report schema 3 includes explicit roles, session establishment/restoration,
PRIMARY-scoped grants, consecutive failure count and a human-readable activity
projection. All earlier evidence sections remain present. The generation timestamp
still changes when a report is rebuilt. A real restart may add reconciliation and
session-restoration events; reconstruction does not invent events or replay work.

## Control Center

New Run collects the goal, existing Dev project or local folder, primary,
optional consultant, maximum turns, failure limit, five verification tiers,
constraints, non-goals and acceptance criteria. It reuses the existing project
listing and desktop folder chooser. The selected absolute project path is shown.
Use the canonical primary Git repository root. DexNest creates a run-specific
worktree in a sibling `dexnest-worktrees` directory; the primary checkout stays
untouched. No dependency installation, push, merge or restore is introduced.

Verification accepts an executable and argument array, with cwd fixed to the run
worktree. Commands are never assembled into a shell command. Disabled tiers are
omitted. Acceptance criteria refer to an enabled structured check or to human
judgment; judgment continues to hold for review under the existing verifier.
At least one verification tier and acceptance criterion are required.

Create and start calls one host/runtime workflow, creates a 1–50-turn grant and
launches the existing primary loop in the host. Background execution does not
block the renderer control channel. Workspace/setup failure remains durably
visible on the created run; no failed operation is blindly repeated.

Runs lists project, role configuration, state, turn/grant usage, latest verification,
creation/activity times and attention. Filters use runtime states and durable
approval/grant evidence. NEEDS_REVIEW, pending approval and exhausted paused grants
are visible as requiring attention. Selected Run exposes sessions, execution,
verification, acceptance, workspace/checkpoints, context requests, denials,
approvals and a bounded readable timeline. Full prompts/provider text are behind
explicit disclosure controls. Uncertain sends retain completed / safe-to-retry /
keep-unresolved resolution, including evidence and one explicit linked retry.

## Roles and readiness

PRIMARY alone owns normal/repair turns, file-output application, context-request
supply and checkpoints. Worker entry points and loop/grant guards reject
CONSULTANT execution. The only allowed pairs are Claude/none, Codex/none,
Claude/Codex and Codex/Claude. No automatic consultant selection or switching occurs.

Readiness performs version and subscription-login probes through the existing
EffectsGateway/Policy/Dispatcher path. It never sends a model prompt or creates a
consultant session. It returns only installation, authentication, version and
classified failure information. Probe-only audit runs remain in SQLite but are
excluded from the automations dashboard. Executable discovery is refreshed when
checking readiness, so supported new installations can be found without restart.
New Run requires an available primary; the host checks again before creation and
primary execution. The configured unavailable consultant remains visibly configured.

Readiness proves login availability, not remaining quota or future model access.
Codex still requires the version and effective configuration supported by the
accepted adapter. Its effective tool/configuration attestation occurs during the
approved worker transport; no readiness model invocation is added.

## Persistence and restart

Dashboards, selected details, reports and timeline use durable SQLite evidence.
Renderer state stores only view/filter/selection and the unsent form. Recovery
holds unexplained in-flight work and never resumes a model automatically. Sessions
remain bound to their original primary provider and IDs. Restored indicates local
session attachment after runtime recovery, not independent confirmation that the
remote provider still accepts the session. The dormant consultant remains not started.

## Validation

- Full test suite: 239/239 passed, including all 225 baseline tests and 14 new runtime tests.
- Isolated Electron renderer harness: passed; navigation, filtering, selected evidence, readiness and collapsed prompt visibility verified without real providers.
- Runtime and Electron main typechecks: passed. Workspace typecheck retains only the two previously documented missing `qrcode` declarations in renderer `main.tsx` and `DropView.tsx`; no new renderer errors.
- Production build: passed, with the existing large-chunk advisory.
- No paid model prompts were sent and no real `local-data` was accessed. Runtime tests and the UI harness used scratch data.

## Security and limitations

The local-data/Vault/Finance denial, filtered environment, stripped API keys,
disabled worker filesystem tools, policy dispatcher, journal-before-effect,
sticky sessions, uncertain-send reconciliation, bounded grants and green-only
checkpoints remain in place. Creating a worktree now also resolves source and
destination paths at dispatch to reject redirection. A worktree is still not an
OS sandbox. All real file contents continue through the existing effects path.

Verification examples must be adapted to the project, and dependencies must
already be available in the worktree. Shell wrappers such as npm.cmd are rejected;
configure native executables with explicit arguments. Human judgment retains the
existing review limitation; no new acceptance-override mechanism is added.
Pause/stop use existing runtime boundaries and owned-worker cancellation behavior.
No paid live-provider turn was tested. The UI test runs only the actual renderer
view in a hidden isolated Electron harness with fake IPC, not the live DexNest main
process. Its Electron userData and DEXNEST_DATA_ROOT point to scratch directories.

Actual consultant sessions/calls, diagnosis, feedback, fallback, switching,
supervisors, restore and PC automation remain deliberately unimplemented.
