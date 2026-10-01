// @dexnest/projects - every code project, its branches and how far they are
// from this PC. See docs/modules/projects/PLAN.md.
//
// This package only ever reads git. Anything that changes a repository goes
// through @dexnest/git-ops, which this package must never import.

export * from "./domain/safety.ts";
export * from "./domain/names.ts";
export * from "./domain/remote.ts";
export * from "./domain/project.ts";
export * from "./domain/legacy.ts";
export * from "./domain/repoState.ts";
export * from "./domain/badge.ts";
export * from "./domain/operations.ts";
export * from "./domain/planners.ts";
export * from "./domain/events.ts";
export * from "./domain/settings.ts";
export * from "./domain/actions.ts";
export * from "./domain/hosting.ts";
