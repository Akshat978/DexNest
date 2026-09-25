# `@dexnest/standup`

Standup for One: a morning report built from Developer Intelligence facts -
what changed since the previous successful Standup, where to continue (ranked,
with the evidence for each), repository state, NEW/ONGOING/RESOLVED issues,
TODO changes, health failures and conflicts, with history.

Deterministic; no LLM or network calls. Scheduled generation is idempotent per
occurrence, so duplicate triggers resolve to one report. Depends only on
`@dexnest/dev-intelligence-contracts`; storage is `@dexnest/dev-intelligence-store`.
