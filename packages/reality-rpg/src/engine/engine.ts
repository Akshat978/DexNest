/**
 * The Reality RPG engine: one processing run, start to finish.
 *
 *   begin (one run per occurrence)
 *   -> enabled rules name the event types; none named: read nothing, skip
 *   -> read ONLY those types from the event log, after the cursor, in pages
 *   -> project each row to the allow-listed envelope (drops vault/finance/
 *      journal and the game's own events)
 *   -> award (idempotent, capped), then evaluate achievements, quests, levels
 *   -> nothing new: record "skipped"; otherwise commit everything at once
 *   -> anything throws: record "failed"; the ledger and cursor are untouched
 *
 * Seq reuse: event_log.seq is SQLite's rowid, and clearing audit history can
 * let new rows reuse seq values the cursor already passed. When the newest
 * named-type seq is lower than the one the last run saw, the run rescans the
 * named types from the start; the ledger's unique key makes that safe, and
 * rules start by recorded time, not seq, so nothing old is newly awarded.
 *
 * Runs are serialised in-process.
 */

import { randomUUID } from 'node:crypto';
import type { EventLog } from '@dexnest/foundation';
import { awardId, computeAwards } from '../domain/awards.ts';
import { levelFor } from '../domain/levels.ts';
import { ruleMatches } from '../domain/matching.ts';
import { isRecurring, isoWeekOfDay, newUnlocks, questProgress, type QuestProgress } from '../domain/index.ts';
import { projectEvent } from '../domain/projection.ts';
import { namedTypes } from '../domain/validation.ts';
import type { Award, ObservedEvent, Quest, Rule } from '../domain/types.ts';
import type { CommittedRun, RealityRpgStore, RunRecord, RunTrigger } from '../store/store.ts';

/** The only part of the event log the engine uses. */
export type EventReader = Pick<EventLog, 'query'>;

export const DEFAULT_PAGE_SIZE = 500;

export interface ProcessRequest {
  occurrenceId: string;
  trigger: RunTrigger;
}

export type ProcessOutcome =
  | { status: 'completed'; run: RunRecord; committed: CommittedRun; rescanned: boolean }
  | { status: 'skipped'; run: RunRecord; reason: 'no_rules' | 'nothing_new' }
  | { status: 'duplicate'; run: RunRecord };

export interface RpgEngineOptions {
  store: RealityRpgStore;
  events: EventReader;
  timeZone?: string;
  now?: () => Date;
  newId?: () => string;
  pageSize?: number;
  /** Extra writes that commit with a run (its milestone events, Phase 4). */
  onCommit?: (committed: CommittedRun) => void;
}

export interface RpgEngine {
  process(request: ProcessRequest): Promise<ProcessOutcome>;
  /** Closes out runs a crash left running. */
  recover(): number;
}

export function createRpgEngine(options: RpgEngineOptions): RpgEngine {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `run_${randomUUID()}`);
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let queue: Promise<unknown> = Promise.resolve();

  function newestNamedSeq(types: string[]): number {
    const [latest] = options.events.query({ types, orderBy: 'seq', order: 'desc', limit: 1 });
    return latest?.seq ?? 0;
  }

  /** Every row of the named types after `after`, projected. Returns the last seq read. */
  function collect(types: string[], after: number): { events: ObservedEvent[]; lastSeq: number; read: number } {
    const events: ObservedEvent[] = [];
    let cursor = after;
    let read = 0;
    for (;;) {
      const page = options.events.query({ types, afterSeq: cursor, orderBy: 'seq', order: 'asc', limit: pageSize });
      for (const row of page) {
        read += 1;
        // The foundation's row already has the RawEvent shape; only the
        // projection looks inside it.
        const projected = projectEvent(row);
        if (projected.kept) events.push(projected.event);
      }
      if (page.length > 0) cursor = page[page.length - 1]!.seq;
      if (page.length < pageSize) break;
    }
    return { events, lastSeq: cursor, read };
  }

  function questCompletions(quests: readonly Quest[], ledger: readonly Award[], fresh: readonly Award[], at: Date) {
    const done = new Set(store.listCompletions().map((c) => `${c.questId}|${c.periodKey}`));
    const out: { questId: string; periodKey: string; completesQuest: boolean }[] = [];
    for (const quest of quests) {
      if (quest.status !== 'active') continue;
      // The current period, plus any period that new awards fall in (the machine
      // may have been off on the day an award happened).
      const periods = new Map<string, QuestProgress>();
      const current = questProgress(quest, ledger, at, timeZone);
      periods.set(current.periodKey, current);
      if (isRecurring(quest)) {
        for (const award of fresh) {
          const key = quest.window.kind === 'daily' ? award.localDay : isoWeekOfDay(award.localDay);
          if (periods.has(key)) continue;
          // Evaluate that period as if it were "now" on that local day.
          const progress = questProgress(quest, ledger, new Date(`${award.localDay}T12:00:00.000Z`), 'UTC');
          periods.set(key, { ...progress, periodKey: key });
        }
      }
      for (const progress of periods.values()) {
        if (!progress.met || done.has(`${quest.id}|${progress.periodKey}`)) continue;
        out.push({ questId: quest.id, periodKey: progress.periodKey, completesQuest: !isRecurring(quest) });
      }
    }
    return out;
  }

  async function run(request: ProcessRequest): Promise<ProcessOutcome> {
    const begun = store.beginRun({ id: newId(), occurrenceId: request.occurrenceId, trigger: request.trigger, startedAt: now().toISOString() });
    if (!begun.started) return { status: 'duplicate', run: begun.run };
    const runId = begun.run.id;

    try {
      const rules: Rule[] = store.listRules().rules.filter((r) => r.enabled);
      const types = namedTypes(rules);
      if (types.length === 0) {
        // No rule names anything: the log is not read at all.
        return { status: 'skipped', run: store.markSkipped(runId, { finishedAt: now().toISOString(), maxSeqSeen: store.maxSeqSeen() }), reason: 'no_rules' };
      }

      const newest = newestNamedSeq(types);
      const rescanned = newest < store.maxSeqSeen();
      const fromSeq = rescanned ? 0 : store.cursor();
      const collected = collect(types, fromSeq);

      // Idempotency before caps: an event already awarded must not use up a cap slot.
      const candidateIds: string[] = [];
      for (const event of collected.events) for (const rule of rules) if (ruleMatches(rule.match, event)) candidateIds.push(awardId(rule.id, event.id));
      const already = store.existingAwardIds(candidateIds);
      const at = now();
      const days = [...new Set(collected.events.map((e) => e.occurredAt.slice(0, 10)))];
      // Cap counts for the local days these events fall on (and their UTC neighbours).
      const dayWindow = new Set<string>();
      for (const d of days) {
        const t = Date.parse(`${d}T00:00:00.000Z`);
        for (const offset of [-1, 0, 1]) dayWindow.add(new Date(t + offset * 86_400_000).toISOString().slice(0, 10));
      }
      const fresh = computeAwards(rules, collected.events, {
        alreadyAwarded: already,
        dailyCounts: store.dailyCounts(rules.map((r) => r.id), [...dayWindow]),
        timeZone,
      });

      const ledger = [...store.allAwards(), ...fresh];
      const totalXp = ledger.reduce((sum, a) => sum + a.xp, 0);
      const recordedLevels = new Set(store.listLevels().map((l) => l.level));
      const levels: { level: number; totalXp: number }[] = [];
      for (let level = 2; level <= levelFor(totalXp); level++) if (!recordedLevels.has(level)) levels.push({ level, totalXp });

      const unlocked = new Set(store.listUnlocks().map((u) => u.achievementId));
      const unlocks = newUnlocks(store.listAchievements().achievements, ledger, unlocked);
      const completions = questCompletions(store.listQuests('active').quests, ledger, fresh, at);

      const toSeq = collected.lastSeq;
      const nothingNew = fresh.length === 0 && unlocks.length === 0 && completions.length === 0 && levels.length === 0 && toSeq === store.cursor() && !rescanned;
      if (nothingNew) {
        return { status: 'skipped', run: store.markSkipped(runId, { finishedAt: at.toISOString(), maxSeqSeen: newest }), reason: 'nothing_new' };
      }

      const committed = store.commitRun({
        runId,
        finishedAt: at.toISOString(),
        fromSeq,
        toSeq,
        maxSeqSeen: Math.max(newest, toSeq),
        awards: fresh,
        unlocks,
        questCompletions: completions,
        levels,
        ...(options.onCommit ? { alsoInTransaction: options.onCommit } : {}),
      });
      return { status: 'completed', run: committed.run, committed, rescanned };
    } catch (error) {
      store.markFailed(runId, { finishedAt: now().toISOString(), error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  return {
    process(request) {
      const next = queue.then(() => run(request));
      queue = next.catch(() => undefined);
      return next;
    },
    recover() {
      return store.recoverInterruptedRuns(now().toISOString());
    },
  };
}
