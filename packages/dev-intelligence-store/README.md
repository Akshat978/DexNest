# `@dexnest/dev-intelligence-store`

Developer Intelligence and Standup persistence on DexNest's shared foundation:
the one better-sqlite3 connection, the shared migration ledger (modules
`developer_intelligence` and `standup`), `dev_`/`standup_` tables, and developer
events in the shared `event_log` (stream `dev`). Writes that belong together
commit together; nothing rewrites the database file.

`./testing` provides `createSqlitePersistence({ dbPath })` over `node:sqlite`
with the same migrations and SQL, for the vitest suites.
