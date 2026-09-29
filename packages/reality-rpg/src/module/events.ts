/**
 * Writing a run's milestones to the shared event log.
 *
 * Called inside the run's transaction (the engine's onCommit), so a milestone
 * event exists exactly when the run that produced it committed. Each carries
 * an idempotency key, so even a replayed run could not record one twice:
 * a level once ever, an achievement once ever, a quest once per period, a
 * run once per occurrence. Payloads are ids, numbers and dates only.
 *
 * Awards are not events; one per matched event would flood the log.
 */

import type { EventLog } from '@dexnest/foundation';
import {
  achievementKey,
  levelKey,
  questKey,
  runKey,
  RPG_EVENT_STREAM,
  RPG_MODULE_ID,
  type AchievementUnlockedPayload,
  type LevelReachedPayload,
  type QuestCompletedPayload,
  type RunCompletedPayload,
} from '../domain/events.ts';
import type { CommittedRun, RealityRpgStore } from '../store/store.ts';

export function appendRunEvents(events: EventLog, store: Pick<RealityRpgStore, 'listUnlocks' | 'totals'>, committed: CommittedRun): void {
  const { run } = committed;
  const at = run.finishedAt ?? run.startedAt;
  const base = { stream: RPG_EVENT_STREAM, module: RPG_MODULE_ID, source: RPG_MODULE_ID, sourceIdentity: run.occurrenceId, occurredAt: at, recordedAt: at, schemaVersion: 1 };

  if (committed.inserted.length > 0) {
    const payload: RunCompletedPayload = {
      runId: run.id,
      occurrenceId: run.occurrenceId,
      awards: committed.inserted.length,
      xp: run.xp,
      fromSeq: run.fromSeq ?? 0,
      toSeq: run.toSeq ?? 0,
    };
    events.append({ ...base, type: 'rpg.run.completed', subject: run.id, idempotencyKey: runKey(run.occurrenceId), payload });
  }

  const totalXp = store.totals().totalXp;
  for (const level of committed.newLevels) {
    const payload: LevelReachedPayload = { level, totalXp, runId: run.id };
    events.append({ ...base, type: 'rpg.level.reached', subject: String(level), idempotencyKey: levelKey(level), payload });
  }

  if (committed.newUnlocks.length > 0) {
    const tipping = new Map(store.listUnlocks().map((u) => [u.achievementId, u.tippingAwardId]));
    for (const achievementId of committed.newUnlocks) {
      const payload: AchievementUnlockedPayload = { achievementId, tippingAwardId: tipping.get(achievementId) ?? '', runId: run.id };
      events.append({ ...base, type: 'rpg.achievement.unlocked', subject: achievementId, idempotencyKey: achievementKey(achievementId), payload });
    }
  }

  for (const c of committed.newCompletions) {
    const payload: QuestCompletedPayload = { questId: c.questId, periodKey: c.periodKey, runId: run.id };
    events.append({ ...base, type: 'rpg.quest.completed', subject: c.questId, idempotencyKey: questKey(c.questId, c.periodKey), payload });
  }
}
