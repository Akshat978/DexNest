/**
 * Reality RPG persistence on the shared SqlDatabase.
 *
 * Two rules hold everything else up:
 * - The ledger's UNIQUE (rule_id, event_id) means an award can be written at
 *   most once, whatever calls this and however often.
 * - A run's awards, unlocks, quest completions, levels, cursor and run record
 *   commit in ONE transaction. A crash anywhere rolls all of it back and the
 *   next run redoes the work from the same cursor.
 *
 * Definitions (rules, achievements, quests) are stored as JSON and pass the
 * domain's validation on the way out; a row that no longer validates is
 * reported as invalid, never used.
 */

import { withTransaction, type SqlDatabase } from '@dexnest/foundation';
import { parseAchievement, parseQuest, parseRule } from '../domain/validation.ts';
import type { AchievementDef, Award, Quest, QuestStatus, Rule } from '../domain/types.ts';

export type RunStatus = 'running' | 'completed' | 'skipped' | 'failed';
export type RunTrigger = 'scheduled' | 'startup' | 'manual';

export interface RunRecord {
  id: string;
  occurrenceId: string;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  fromSeq: number | null;
  toSeq: number | null;
  awards: number;
  xp: number;
  error: string | null;
}

export interface StoredAward extends Award {
  awardedAt: string;
  runId: string;
}

export interface UnlockRecord {
  achievementId: string;
  unlockedAt: string;
  tippingAwardId: string;
}

export interface QuestCompletion {
  questId: string;
  periodKey: string;
  completedAt: string;
}

export interface LevelReached {
  level: number;
  reachedAt: string;
  totalXp: number;
}

export interface Invalid {
  id: string;
  errors: string[];
}

export interface CommitRunInput {
  runId: string;
  finishedAt: string;
  fromSeq: number;
  /** The cursor after this run: the last seq it processed. */
  toSeq: number;
  /** The log's max seq as seen by this run (for seq-regression detection). */
  maxSeqSeen: number;
  awards: readonly Award[];
  unlocks: readonly { achievementId: string; tippingAwardId: string }[];
  questCompletions: readonly { questId: string; periodKey: string; completesQuest: boolean }[];
  levels: readonly { level: number; totalXp: number }[];
  /** More writes that must commit with the run (its events). Runs last; throwing rolls everything back. */
  alsoInTransaction?: (result: CommittedRun) => void;
}

export interface CommittedRun {
  run: RunRecord;
  /** Awards actually written; duplicates the ledger already held are not included. */
  inserted: StoredAward[];
  newUnlocks: string[];
  newCompletions: { questId: string; periodKey: string }[];
  newLevels: number[];
}

export interface RealityRpgStore {
  // Rules
  saveRule(rule: Omit<Rule, 'version'>, now: string): Rule;
  getRule(id: string): Rule | undefined;
  listRules(): { rules: Rule[]; invalid: Invalid[] };
  ruleVersion(id: string, version: number): Rule | undefined;
  deleteRule(id: string): boolean;

  // Achievements
  saveAchievement(achievement: AchievementDef, now: string): AchievementDef;
  listAchievements(): { achievements: AchievementDef[]; invalid: Invalid[] };
  deleteAchievement(id: string): boolean;
  listUnlocks(): UnlockRecord[];

  // Quests
  createQuest(quest: Quest): Quest;
  getQuest(id: string): Quest | undefined;
  listQuests(status?: QuestStatus): { quests: Quest[]; invalid: Invalid[] };
  setQuestStatus(id: string, status: 'abandoned' | 'active', now: string): Quest | undefined;
  listCompletions(questId?: string): QuestCompletion[];

  // Ledger
  listAwards(options?: { limit?: number; beforeSeq?: number }): StoredAward[];
  allAwards(): StoredAward[];
  hasAward(awardId: string): boolean;
  dailyCounts(ruleIds: readonly string[], days: readonly string[]): Map<string, number>;
  totals(): { totalXp: number; stats: { stat: string; xp: number }[] };
  listLevels(): LevelReached[];

  // Runs
  beginRun(input: { id: string; occurrenceId: string; trigger: RunTrigger; startedAt: string }): { started: boolean; run: RunRecord };
  commitRun(input: CommitRunInput): CommittedRun;
  markSkipped(runId: string, input: { finishedAt: string; maxSeqSeen: number }): RunRecord;
  markFailed(runId: string, input: { finishedAt: string; error: string }): RunRecord;
  recoverInterruptedRuns(now: string): number;
  getRun(id: string): RunRecord | undefined;
  getRunByOccurrence(occurrenceId: string): RunRecord | undefined;
  listRuns(limit?: number): RunRecord[];

  // State
  cursor(): number;
  maxSeqSeen(): number;
  setCursor(seq: number): void;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v);
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toRun(r: Row): RunRecord {
  return {
    id: str(r.id),
    occurrenceId: str(r.occurrence_id),
    trigger: str(r.trigger) as RunTrigger,
    status: str(r.status) as RunStatus,
    startedAt: str(r.started_at),
    finishedAt: strOrNull(r.finished_at),
    fromSeq: numOrNull(r.from_seq),
    toSeq: numOrNull(r.to_seq),
    awards: num(r.awards),
    xp: num(r.xp),
    error: strOrNull(r.error),
  };
}

function toAward(r: Row): StoredAward {
  return {
    id: str(r.id),
    ruleId: str(r.rule_id),
    ruleVersion: num(r.rule_version),
    eventId: str(r.event_id),
    eventSeq: num(r.event_seq),
    eventType: str(r.event_type),
    actionId: strOrNull(r.action_id),
    occurredAt: str(r.occurred_at),
    localDay: str(r.local_day),
    xp: num(r.xp),
    stat: str(r.stat),
    awardedAt: str(r.awarded_at),
    runId: str(r.run_id),
  };
}

function safeJson(text: unknown): unknown {
  try {
    return JSON.parse(str(text));
  } catch {
    return undefined;
  }
}

const STATE_CURSOR = 'cursor';
const STATE_MAX_SEQ = 'max_seq_seen';

export function createRealityRpgStore(db: SqlDatabase): RealityRpgStore {
  const get = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).get<Row>(params);
  const all = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).all<Row>(params);
  const run = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).run(params);

  const state = (key: string) => {
    const r = get('SELECT value FROM rpg_state WHERE key = ?', [key]);
    const n = r ? Number(r.value) : 0;
    return Number.isFinite(n) ? n : 0;
  };
  const setState = (key: string, value: number) =>
    run('INSERT INTO rpg_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, String(value)]);

  const getRun = (id: string) => {
    const r = get('SELECT * FROM rpg_runs WHERE id = ?', [id]);
    return r ? toRun(r) : undefined;
  };
  const requireRun = (id: string) => {
    const r = getRun(id);
    if (!r) throw new Error(`Reality RPG run ${id} does not exist.`);
    return r;
  };

  function readRule(r: Row): Rule | Invalid {
    const parsed = parseRule(safeJson(r.definition_json));
    return parsed.ok ? parsed.value : { id: str(r.id), errors: parsed.errors };
  }

  function readQuest(r: Row): Quest | Invalid {
    const parsed = parseQuest(safeJson(r.definition_json));
    if (!parsed.ok) return { id: str(r.id), errors: parsed.errors };
    return { ...parsed.value, status: str(r.status) as QuestStatus };
  }

  const isInvalid = (v: object): v is Invalid => 'errors' in v;

  function getQuest(id: string): Quest | undefined {
    const r = get('SELECT * FROM rpg_quests WHERE id = ?', [id]);
    if (!r) return undefined;
    const q = readQuest(r);
    return isInvalid(q) ? undefined : q;
  }

  return {
    saveRule(input, now) {
      return withTransaction(db, () => {
        const existing = get('SELECT version, created_at FROM rpg_rules WHERE id = ?', [input.id]);
        const version = existing ? num(existing.version) + 1 : 1;
        const rule: Rule = { ...input, version };
        const parsed = parseRule(rule);
        if (!parsed.ok) throw new Error(`Rule ${input.id} is not valid: ${parsed.errors.join('; ')}`);
        const json = JSON.stringify(parsed.value);
        run(
          `INSERT INTO rpg_rules (id, version, name, enabled, effective_from_seq, definition_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET version = excluded.version, name = excluded.name, enabled = excluded.enabled,
             effective_from_seq = excluded.effective_from_seq, definition_json = excluded.definition_json, updated_at = excluded.updated_at`,
          [rule.id, version, rule.name, rule.enabled ? 1 : 0, rule.effectiveFromSeq, json, existing ? str(existing.created_at) : now, now],
        );
        run('INSERT INTO rpg_rule_versions (rule_id, version, definition_json, saved_at) VALUES (?, ?, ?, ?)', [rule.id, version, json, now]);
        return parsed.value;
      });
    },

    getRule(id) {
      const r = get('SELECT * FROM rpg_rules WHERE id = ?', [id]);
      if (!r) return undefined;
      const rule = readRule(r);
      return isInvalid(rule) ? undefined : rule;
    },

    listRules() {
      const rules: Rule[] = [];
      const invalid: Invalid[] = [];
      for (const r of all('SELECT * FROM rpg_rules ORDER BY id')) {
        const rule = readRule(r);
        if (isInvalid(rule)) invalid.push(rule);
        else rules.push(rule);
      }
      return { rules, invalid };
    },

    ruleVersion(id, version) {
      const r = get('SELECT definition_json FROM rpg_rule_versions WHERE rule_id = ? AND version = ?', [id, version]);
      if (!r) return undefined;
      const parsed = parseRule(safeJson(r.definition_json));
      return parsed.ok ? parsed.value : undefined;
    },

    deleteRule(id) {
      // Awards stay: the ledger is history (decision 3).
      return run('DELETE FROM rpg_rules WHERE id = ?', [id]).changes > 0;
    },

    saveAchievement(achievement, now) {
      const parsed = parseAchievement(achievement);
      if (!parsed.ok) throw new Error(`Achievement ${achievement.id} is not valid: ${parsed.errors.join('; ')}`);
      run(
        `INSERT INTO rpg_achievements (id, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET definition_json = excluded.definition_json, updated_at = excluded.updated_at`,
        [parsed.value.id, JSON.stringify(parsed.value), now, now],
      );
      return parsed.value;
    },

    listAchievements() {
      const achievements: AchievementDef[] = [];
      const invalid: Invalid[] = [];
      for (const r of all('SELECT * FROM rpg_achievements ORDER BY id')) {
        const parsed = parseAchievement(safeJson(r.definition_json));
        if (parsed.ok) achievements.push(parsed.value);
        else invalid.push({ id: str(r.id), errors: parsed.errors });
      }
      return { achievements, invalid };
    },

    deleteAchievement(id) {
      // An unlock already earned stays earned.
      return run('DELETE FROM rpg_achievements WHERE id = ?', [id]).changes > 0;
    },

    listUnlocks() {
      return all('SELECT * FROM rpg_achievement_unlocks ORDER BY unlocked_at, achievement_id').map((r) => ({
        achievementId: str(r.achievement_id),
        unlockedAt: str(r.unlocked_at),
        tippingAwardId: str(r.tipping_award_id),
      }));
    },

    createQuest(quest) {
      const parsed = parseQuest(quest);
      if (!parsed.ok) throw new Error(`Quest ${quest.id} is not valid: ${parsed.errors.join('; ')}`);
      const q = { ...parsed.value, status: 'active' as const };
      run('INSERT INTO rpg_quests (id, definition_json, status, created_at) VALUES (?, ?, ?, ?)', [q.id, JSON.stringify(q), q.status, q.createdAt]);
      return q;
    },

    getQuest,

    listQuests(status) {
      const quests: Quest[] = [];
      const invalid: Invalid[] = [];
      const rows = status ? all('SELECT * FROM rpg_quests WHERE status = ? ORDER BY created_at, id', [status]) : all('SELECT * FROM rpg_quests ORDER BY created_at, id');
      for (const r of rows) {
        const q = readQuest(r);
        if (isInvalid(q)) invalid.push(q);
        else quests.push(q);
      }
      return { quests, invalid };
    },

    setQuestStatus(id, status, now) {
      if (status === 'abandoned') run("UPDATE rpg_quests SET status = 'abandoned', abandoned_at = ? WHERE id = ? AND status = 'active'", [now, id]);
      else run("UPDATE rpg_quests SET status = 'active', abandoned_at = NULL WHERE id = ? AND status = 'abandoned'", [id]);
      return getQuest(id);
    },

    listCompletions(questId) {
      const rows = questId
        ? all('SELECT * FROM rpg_quest_completions WHERE quest_id = ? ORDER BY completed_at', [questId])
        : all('SELECT * FROM rpg_quest_completions ORDER BY completed_at');
      return rows.map((r) => ({ questId: str(r.quest_id), periodKey: str(r.period_key), completedAt: str(r.completed_at) }));
    },

    listAwards(options) {
      const limit = options?.limit ?? 100;
      const rows =
        options?.beforeSeq !== undefined
          ? all('SELECT * FROM rpg_awards WHERE event_seq < ? ORDER BY event_seq DESC, id LIMIT ?', [options.beforeSeq, limit])
          : all('SELECT * FROM rpg_awards ORDER BY event_seq DESC, id LIMIT ?', [limit]);
      return rows.map(toAward);
    },

    allAwards() {
      return all('SELECT * FROM rpg_awards ORDER BY event_seq, id').map(toAward);
    },

    hasAward(awardId) {
      return get('SELECT 1 AS present FROM rpg_awards WHERE id = ?', [awardId]) !== undefined;
    },

    dailyCounts(ruleIds, days) {
      const out = new Map<string, number>();
      if (ruleIds.length === 0 || days.length === 0) return out;
      const rows = all(
        `SELECT rule_id, local_day, COUNT(*) AS n FROM rpg_awards
         WHERE rule_id IN (${ruleIds.map(() => '?').join(', ')}) AND local_day IN (${days.map(() => '?').join(', ')})
         GROUP BY rule_id, local_day`,
        [...ruleIds, ...days],
      );
      for (const r of rows) out.set(`${str(r.rule_id)}|${str(r.local_day)}`, num(r.n));
      return out;
    },

    totals() {
      const rows = all('SELECT stat, SUM(xp) AS xp FROM rpg_awards GROUP BY stat ORDER BY SUM(xp) DESC, stat');
      const stats = rows.map((r) => ({ stat: str(r.stat), xp: num(r.xp) }));
      return { totalXp: stats.reduce((sum, s) => sum + s.xp, 0), stats };
    },

    listLevels() {
      return all('SELECT * FROM rpg_levels ORDER BY level').map((r) => ({ level: num(r.level), reachedAt: str(r.reached_at), totalXp: num(r.total_xp) }));
    },

    beginRun(input) {
      return withTransaction(db, () => {
        const inserted = run(
          "INSERT OR IGNORE INTO rpg_runs (id, occurrence_id, trigger, status, started_at) VALUES (?, ?, ?, 'running', ?)",
          [input.id, input.occurrenceId, input.trigger, input.startedAt],
        ).changes;
        const r = get('SELECT * FROM rpg_runs WHERE occurrence_id = ?', [input.occurrenceId]);
        if (!r) throw new Error(`Reality RPG run for ${input.occurrenceId} was not recorded.`);
        return { started: inserted > 0, run: toRun(r) };
      });
    },

    commitRun(input) {
      return withTransaction(db, () => {
        const current = requireRun(input.runId);
        if (current.status !== 'running') throw new Error(`Reality RPG run ${input.runId} is ${current.status}, not running.`);

        const insertAward = db.prepare(
          `INSERT OR IGNORE INTO rpg_awards (id, rule_id, rule_version, event_id, event_seq, event_type, action_id, occurred_at, local_day, xp, stat, awarded_at, run_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const inserted: StoredAward[] = [];
        for (const a of input.awards) {
          const changes = insertAward.run([a.id, a.ruleId, a.ruleVersion, a.eventId, a.eventSeq, a.eventType, a.actionId, a.occurredAt, a.localDay, a.xp, a.stat, input.finishedAt, input.runId]).changes;
          if (changes > 0) inserted.push({ ...a, awardedAt: input.finishedAt, runId: input.runId });
        }

        const newUnlocks: string[] = [];
        const insertUnlock = db.prepare('INSERT OR IGNORE INTO rpg_achievement_unlocks (achievement_id, unlocked_at, tipping_award_id, run_id) VALUES (?, ?, ?, ?)');
        for (const u of input.unlocks) {
          if (insertUnlock.run([u.achievementId, input.finishedAt, u.tippingAwardId, input.runId]).changes > 0) newUnlocks.push(u.achievementId);
        }

        const newCompletions: { questId: string; periodKey: string }[] = [];
        const insertCompletion = db.prepare('INSERT OR IGNORE INTO rpg_quest_completions (quest_id, period_key, completed_at, run_id) VALUES (?, ?, ?, ?)');
        for (const c of input.questCompletions) {
          if (insertCompletion.run([c.questId, c.periodKey, input.finishedAt, input.runId]).changes > 0) {
            newCompletions.push({ questId: c.questId, periodKey: c.periodKey });
            if (c.completesQuest) run("UPDATE rpg_quests SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'", [input.finishedAt, c.questId]);
          }
        }

        const newLevels: number[] = [];
        const insertLevel = db.prepare('INSERT OR IGNORE INTO rpg_levels (level, reached_at, total_xp, run_id) VALUES (?, ?, ?, ?)');
        for (const l of input.levels) {
          if (insertLevel.run([l.level, input.finishedAt, l.totalXp, input.runId]).changes > 0) newLevels.push(l.level);
        }

        const xp = inserted.reduce((sum, a) => sum + a.xp, 0);
        run(
          "UPDATE rpg_runs SET status = 'completed', finished_at = ?, from_seq = ?, to_seq = ?, awards = ?, xp = ?, error = NULL WHERE id = ?",
          [input.finishedAt, input.fromSeq, input.toSeq, inserted.length, xp, input.runId],
        );
        setState(STATE_CURSOR, input.toSeq);
        setState(STATE_MAX_SEQ, input.maxSeqSeen);

        const result: CommittedRun = { run: requireRun(input.runId), inserted, newUnlocks, newCompletions, newLevels };
        input.alsoInTransaction?.(result);
        return result;
      });
    },

    markSkipped(runId, input) {
      return withTransaction(db, () => {
        run("UPDATE rpg_runs SET status = 'skipped', finished_at = ? WHERE id = ? AND status = 'running'", [input.finishedAt, runId]);
        setState(STATE_MAX_SEQ, input.maxSeqSeen);
        return requireRun(runId);
      });
    },

    markFailed(runId, input) {
      run("UPDATE rpg_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ? AND status = 'running'", [input.finishedAt, input.error, runId]);
      return requireRun(runId);
    },

    recoverInterruptedRuns(now) {
      return run("UPDATE rpg_runs SET status = 'failed', finished_at = ?, error = 'Interrupted before it finished.' WHERE status = 'running'", [now]).changes;
    },

    getRun,

    getRunByOccurrence(occurrenceId) {
      const r = get('SELECT * FROM rpg_runs WHERE occurrence_id = ?', [occurrenceId]);
      return r ? toRun(r) : undefined;
    },

    listRuns(limit = 20) {
      return all('SELECT * FROM rpg_runs ORDER BY started_at DESC, id DESC LIMIT ?', [limit]).map(toRun);
    },

    cursor: () => state(STATE_CURSOR),
    maxSeqSeen: () => state(STATE_MAX_SEQ),
    setCursor: (seq) => {
      setState(STATE_CURSOR, seq);
    },
  };
}
