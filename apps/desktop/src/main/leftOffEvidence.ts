// Projects' "Where you left off" lists the evidence behind Developer
// Intelligence's reason. The refs carry only a kind ("snapshot", "event") and
// an id, which read as noise ("event · 2026-10-02 · event · ..."); this turns
// each into what it was, from the facts the reason was built from.

const EVENT_LABELS: Record<string, string> = {
  "dev.repo.discovered": "Repository found",
  "dev.repo.snapshot": "Repository scanned",
  "dev.commit.observed": "Commit",
  "dev.branch.changed": "Branch changed",
  "dev.working_tree.changed": "Uncommitted changes",
  "dev.conflict.observed": "Merge conflict",
  "dev.git_operation.started": "Git operation started",
  "dev.git_operation.resolved": "Git operation finished",
  "dev.todo.observed": "TODO added",
  "dev.todo.resolved": "TODO resolved",
  "dev.health.completed": "Health check",
  "dev.technology.observed": "Technology found",
  "dev.technology.removed": "Technology removed"
};

export interface EvidenceRefLike {
  readonly kind: string;
  readonly id: string;
  readonly observedAt?: string;
}

export interface EventLike {
  readonly eventId: string;
  readonly type: string;
  readonly payload: unknown;
}

/** One evidence line: what it was, then the day it was seen. */
export function evidenceLine(ref: EvidenceRefLike, events: readonly EventLike[]): string {
  let what: string;
  if (ref.kind === "snapshot") {
    what = "Working tree scanned";
  } else if (ref.kind === "event") {
    const event = events.find((e) => e.eventId === ref.id);
    what = event ? EVENT_LABELS[event.type] ?? "Activity" : "Activity";
    const sha = event?.type === "dev.commit.observed" ? (event.payload as { sha?: unknown } | null)?.sha : undefined;
    if (typeof sha === "string" && sha) what = `${what} ${sha.slice(0, 7)}`;
  } else {
    what = ref.kind.replace(/_/g, " ");
    what = what.charAt(0).toUpperCase() + what.slice(1);
  }
  return ref.observedAt ? `${what} · ${ref.observedAt.slice(0, 10)}` : what;
}
