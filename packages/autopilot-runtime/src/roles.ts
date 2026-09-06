import type { RunSpec } from "./runSpec.ts";

export type WorkerRole = "PRIMARY" | "CONSULTANT";
export type CodingProvider = "claude" | "codex";
export interface WorkerRoles { primary: CodingProvider; consultant: CodingProvider | null }
export function validateRoles(primary: unknown, consultant: unknown = null): WorkerRoles {
  if (primary !== "claude" && primary !== "codex") throw new Error("Choose exactly one primary: Claude or Codex.");
  if (consultant !== null && consultant !== "claude" && consultant !== "codex") throw new Error("Unsupported consultant.");
  if (primary === consultant) throw new Error("Primary and consultant must be different providers.");
  return { primary, consultant };
}
export function rolesFor(spec: Pick<RunSpec, "workers"> & { provider?: string }) {
  return { primary: spec.workers?.primary ?? spec.provider ?? "scripted", consultant: spec.workers?.consultant ?? null };
}
export function assertPrimary(role: WorkerRole = "PRIMARY"): void {
  if (role !== "PRIMARY") throw new Error("CONSULTANT execution is disabled; only PRIMARY owns implementation turns.");
}
