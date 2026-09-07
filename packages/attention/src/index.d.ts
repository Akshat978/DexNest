// Types for the attention engine.
//
// The engine is plain JavaScript on purpose — it must run under `node --test`
// with an empty node_modules, and a build step would have meant a dependency.
// Its consumers are TypeScript, so the types are declared here by hand against
// the JSDoc in src/*.js. They are a contract, not a generated artifact: if the
// two ever disagree, this file is what the host compiled against, and the
// disagreement is a bug.

export declare const PACKAGE_NAME: "dexnest-attention";

export type Priority = "INFO" | "ATTENTION" | "ACTION_REQUIRED" | "URGENT";
export declare const PRIORITIES: readonly Priority[];

/** Priorities that are delivered even while their group is cooling down. */
export declare const PIERCING_PRIORITIES: readonly Priority[];
/** Priorities quiet hours may hold. */
export declare const QUIET_HELD_PRIORITIES: readonly Priority[];
/** Priorities delivered even at 3am. */
export declare const QUIET_PIERCING_PRIORITIES: readonly Priority[];
export declare const DEFAULT_COOLDOWN_MINUTES: number;
export declare const NOTIFICATION_TITLE_MAX: number;
export declare const NOTIFICATION_BODY_MAX: number;

export interface Answer {
  id: string;
  label: string;
}

export interface AttentionItem {
  id: string;
  /** Where it came from, e.g. "run" or "queue". */
  source: string;
  /** Which run or queue it concerns. */
  subject: string;
  priority: Priority;
  title: string;
  detail: string;
  /** How items collapse together. */
  groupKey: string;
  at: string;
  /** Options offered, or empty for an item that needs no answer. */
  answers: Answer[];
}

/**
 * The engine's own vocabulary for why a run stopped.
 *
 * Deliberately smaller than DexNest's eighteen LoopStopReasons: those describe
 * the machine, and these describe what it means to a person. The host maps one
 * onto the other, the way it maps stop reasons onto queue outcomes.
 */
export type AttentionStopReason =
  | "proposed_completion"
  | "worker_failure"
  | "budget_spent"
  | "run_finished"
  | "provider_limit";
export declare const STOP_REASONS: readonly AttentionStopReason[];

export interface RunState {
  runId: string;
  stopReason?: AttentionStopReason;
  at?: string;
  detail?: string;
}

export interface GroupDigest {
  groupKey: string;
  subject: string;
  /** The highest priority in the group; a digest is as loud as its loudest member. */
  priority: Priority;
  count: number;
  headline: string;
  latest: string;
  outstanding: AttentionItem[];
}

export interface DeliveryRecord {
  groupKey: string;
  priority: Priority;
  at: string;
}

export interface QuietHours {
  /** "HH:MM" local wall-clock. */
  start: string;
  end: string;
}

export interface HeldReason {
  groupKey: string;
  reason: "cooling_down" | "quiet_hours" | "cooling_down+quiet_hours";
  coolsDownAt: string | null;
  quietEndsAt: string | null;
}

export interface Decision {
  deliver: GroupDigest[];
  hold: GroupDigest[];
  /** One per held group, aligned with `hold`. Never shorter than it. */
  reason: HeldReason[];
}

export interface DecisionState {
  items: Array<Partial<AttentionItem> & { id: string }>;
  delivered?: readonly DeliveryRecord[];
  quietHours: QuietHours;
  /**
   * ISO timestamp CARRYING ITS LOCAL OFFSET.
   *
   * Quiet hours read the wall-clock hour straight out of this string, which is
   * what makes them survive a daylight-saving change. Pass a UTC "Z" timestamp
   * and the window silently runs on UTC instead.
   */
  now: string;
  cooldownMinutes?: number;
}

export declare function makeItem(input: Partial<AttentionItem> & { id: string }): AttentionItem;
export declare function itemsFor(runState: RunState): AttentionItem[];
export declare function groupItems(items: readonly AttentionItem[]): GroupDigest[];
export declare function digestGroup(group: GroupDigest): GroupDigest;

export declare function lastDeliveryFor(
  groupKey: string,
  deliveries: readonly DeliveryRecord[]
): DeliveryRecord | null;
export declare function escalates(priority: Priority): boolean;
export declare function holdForCooldown(
  item: AttentionItem,
  deliveries: readonly DeliveryRecord[],
  cooldownMinutes: number,
  now: string
): { hold: boolean; coolsDownAt: string | null };
export declare function holdWithEscalation(
  item: AttentionItem,
  deliveries: readonly DeliveryRecord[],
  cooldownMinutes: number,
  now: string
): { hold: boolean; coolsDownAt: string | null };

export declare function inQuietHours(now: string, quietHours: QuietHours): boolean;
export declare function piercesQuietHours(priority: Priority): boolean;
export declare function holdForQuietHours(
  item: AttentionItem,
  quietHours: QuietHours,
  now: string
): { hold: boolean; quietEndsAt: string | null };
export declare function holdWithUrgency(
  item: AttentionItem,
  quietHours: QuietHours,
  now: string
): { hold: boolean; quietEndsAt: string | null };

/** The one entry point a caller needs. Pure; safe to call twice on frozen state. */
export declare function decide(state: DecisionState): Decision;

export declare function renderNotification(item: AttentionItem | GroupDigest): {
  title: string;
  body: string;
};
export declare function answersFor(item: AttentionItem): Answer[];
export declare function validateAnswer(item: AttentionItem, answerId: string): Answer;
export declare function renderSummary(decision: Decision): string;
