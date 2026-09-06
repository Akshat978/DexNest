# DexNest context-request report evidence

This slice adds read-only context-request evidence to the existing run report and
Autopilot report view. It does not change request authorization, file selection,
turn scheduling, LoopGrant consumption or worker tools.

## Report model

RunReport schema version 2 adds `contextRequests`. Each entry includes the request
ID/path, originating and consuming turn IDs/ordinals, status, tri-state `allowed`
(null while pending), denial reason, prior-context availability explanation,
supplied size and unit, restart provenance, and the consuming grant's provider and
session identity. The provider-specific session ID comes only from that consuming
send's result when present; it is not guessed from a later session.

The projection uses SQLite request rows, turn/grant/send records and journaled
context selections. It copies no prompt, provider response or file content.
The host's report method now calls the projection directly rather than constructing
a worker and validating the live worktree first. Reports therefore need no
filesystem, git, worker executable or provider login.

Markdown adds a compact Context requests table with path, originating turn,
status/allowed, reason, consuming turn, supplied size and restart evidence.
Worker-controlled request fields are escaped as Markdown table data.

## Persistence and restart

Additive migration 9 stores originating/resolving runtime IDs and a size-unit
marker on context requests. Runtime IDs are allocated through the existing ID
port only on request mutation, never when building a report. A fulfilled request
with differing IDs is marked fulfilled after a runtime restart; matching IDs mean
same-runtime fulfillment. Pending/denied requests and legacy rows without both
IDs return null for that field rather than inventing history.

New supplied counts use UTF-8 bytes. Existing stored counts were JavaScript UTF-16
string lengths and are preserved with `legacy_utf16_units`; they cannot be
corrected from SQLite metadata without duplicating or rereading content. Existing
selection/request budget behavior remains unchanged.

Fresh runtime reconstruction preserves request evidence exactly, including pending
and denied status, consumed-turn linkage and restart provenance. The report's
existing `generatedAt` timestamp still reflects when it was built.

## UI

The existing Run report panel gains a small read-only Context requests section.
It displays path, originating turn, status, denial/availability reason, supplied
size and consuming turn using existing styling and escaped React text. The field
type is derived from the runtime RunReport so the IPC/UI contract stays aligned.
No new navigation, action or controls are added.

## Changed files

- `packages/autopilot-runtime/src/report.ts`: structured projection and Markdown.
- `packages/autopilot-runtime/src/contextRequests.ts`: runtime/size provenance.
- `packages/autopilot-runtime/src/migrations.ts`: additive migration 9.
- `packages/autopilot-runtime/src/loop.ts`: UTF-8 supplied-byte measurement.
- `packages/autopilot-runtime/src/controlledWorker.ts`: SQLite-only report entry.
- `packages/autopilot-runtime/src/index.ts`: report entry type export.
- `apps/desktop/src/renderer/views/AutopilotView.tsx`: read-only evidence section.
- `packages/autopilot-runtime/test/contextRequests.test.ts`: report, host IPC,
  restart, Unicode size, legacy provenance and Markdown escaping tests.
- This implementation note.

## Validation and limits

Results: 225/225 tests passed, including all previous 222 tests. Workspace build,
runtime typecheck and Electron main typecheck passed. Workspace typecheck reports
only the two existing missing `qrcode` declarations in renderer `main.tsx` and
`DropView.tsx`. No visual desktop test was performed.

Validation uses isolated SQLite databases and fake CLI/process harnesses. No paid
Claude or Codex prompt is sent. Tests cover fulfilled/denied/pending evidence,
turn links, exact UTF-8 size, provider/session attribution, host UI response shape,
SQLite-only reconstruction, restart stability and content-free Markdown.

The prior selection journal proves inclusion or omission, but does not record an
exact per-file omission cause. The report states that limitation rather than
claiming a budget or policy reason. A request for a file already supplied is also
reported honestly. Parser-rejected malformed envelopes that never became request
rows are not fabricated into request records. Fulfillment means supplied to the
durable consuming-turn context; it does not independently prove the provider read
it or that an uncertain prompt was received.

Recommended next slice: record precise per-file omission reasons at context
selection time, without storing contents or enabling worker filesystem tools.
