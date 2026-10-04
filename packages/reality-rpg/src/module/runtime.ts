/**
 * Reality RPG as a DexNest module.
 *
 * Everything the desktop host needs behind the foundation's host ports, so the
 * host file is wiring only (modelled on Developer Intelligence's runtime).
 *
 * - Off until asked: no job and no timer exist until the user turns it on. A
 *   manual Refresh works either way - it is the user asking.
 * - The `process` job is light (only new rows of named types) and idempotent
 *   per occurrence: a slot delivered twice runs once.
 * - Every user action is validated here, runs through the store, and writes
 *   one audit line. Rules apply from the moment they are created or switched
 *   on; only an explicit backfill reaches into the past.
 */

import { randomUUID } from 'node:crypto';
import type { EventLog, JobOccurrence, ModuleScheduler, ModuleSettings, SqlDatabase } from '@dexnest/foundation';
import { STARTER_ACHIEVEMENTS, STARTER_GROUP_LABELS, STARTER_INFO, STARTER_QUESTS, STARTER_RULES, type StarterGroup } from '../domain/data/starter-pack.ts';
import { characterSheet } from '../domain/levels.ts';
import { evaluateCondition, questProgress, type QuestProgress } from '../domain/progress.ts';
import { normalizeRealityRpgSettings, type RealityRpgSettings } from '../domain/settings.ts';
import type { AchievementDef, CharacterSheet, Progress, Quest, Rule } from '../domain/types.ts';
import { parseAchievement, parseQuest, parseRule, type Parsed } from '../domain/validation.ts';
import { createRpgEngine, type EventReader, type ProcessOutcome, type RpgEngine } from '../engine/engine.ts';
import { RPG_PROCESS_JOB } from '../manifest.ts';
import { createRealityRpgStore, type Invalid, type RealityRpgStore, type RunRecord, type StoredAward, type UnlockRecord } from '../store/store.ts';
import { appendRunEvents } from './events.ts';

export type AuditStatus = 'success' | 'failure';

export interface RealityRpgModuleOptions {
  database: SqlDatabase;
  /** The shared event log: read (named types only) and written (milestones). */
  events: EventLog;
  scheduler: ModuleScheduler;
  settings: ModuleSettings<RealityRpgSettings>;
  /** A line in DexNest's audit log. */
  audit?(summary: string, metadata: Record<string, unknown>, status: AuditStatus): void;
  timeZone?: string;
  now?: () => Date;
  newId?: () => string;
  pageSize?: number;
  /** Tests only: observe or fault the reads. Defaults to `events`. */
  reader?: EventReader;
}

export interface AchievementView {
  achievement: AchievementDef;
  unlocked: UnlockRecord | null;
  progress: Progress;
}

export interface QuestView {
  quest: Quest;
  progress: QuestProgress;
  completions: number;
}

export interface AwardView extends StoredAward {
  ruleName: string | null;
}

export interface RealityRpgSnapshot {
  enabled: boolean;
  sheet: CharacterSheet;
  rules: Rule[];
  achievements: AchievementView[];
  quests: QuestView[];
  recentAwards: AwardView[];
  lastRun: RunRecord | null;
  invalid: { rules: Invalid[]; achievements: Invalid[]; quests: Invalid[] };
  /** The built-in set, offered as templates the user can save. */
  starter: {
    rules: Rule[];
    achievements: AchievementDef[];
    quests: StarterQuest[];
    /** For each built-in rule: its group, what earns it in plain words, and whether it is ticked by default. */
    info: Record<string, { group: StarterGroup; groupLabel: string; when: string; recommended: boolean }>;
  };
}

/** A built-in quest, and the rule it counts. */
export interface StarterQuest {
  id: string;
  title: string;
  needs: string;
  recommended: boolean;
  condition: Quest['condition'];
  window: Quest['window'];
}

/** What turning on with a selection did. */
export interface StartedWith {
  settings: RealityRpgSettings;
  rules: number;
  quests: number;
  achievements: number;
}

export interface RealityRpgStatus {
  enabled: boolean;
  processing: boolean;
  lastRun: RunRecord | null;
  lastError: string | null;
}

export interface RealityRpgModule {
  readonly store: RealityRpgStore;
  readonly engine: RpgEngine;
  start(): void;
  stop(): void;
  status(): RealityRpgStatus;
  getSettings(): RealityRpgSettings;
  updateSettings(next: unknown): RealityRpgSettings;
  enable(): RealityRpgSettings;
  /**
   * Turns the game on with a selection from the built-in set, in one step:
   * the picked rules are saved switched on (from now: nothing earlier
   * earns), the picked quests are created, and the achievements that count
   * a picked rule (and the XP ones) are added.
   */
  enableWith(input: unknown): Parsed<StartedWith>;
  disable(): RealityRpgSettings;
  refresh(): Promise<ProcessOutcome>;
  saveRule(input: unknown): Parsed<Rule>;
  setRuleEnabled(id: unknown, enabled: unknown): Parsed<Rule>;
  deleteRule(id: unknown): Parsed<{ id: string }>;
  createQuest(input: unknown): Parsed<Quest>;
  abandonQuest(id: unknown): Parsed<Quest>;
  saveAchievement(input: unknown): Parsed<AchievementDef>;
  deleteAchievement(id: unknown): Parsed<{ id: string }>;
  backfill(ruleId: unknown): Promise<Parsed<ProcessOutcome>>;
  snapshot(): RealityRpgSnapshot;
}

const EPOCH = '1970-01-01T00:00:00.000Z';
const fail = <T>(...errors: string[]): Parsed<T> => ({ ok: false, errors });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'quest';
}

export function createRealityRpgModule(options: RealityRpgModuleOptions): RealityRpgModule {
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const store = createRealityRpgStore(options.database);
  const engine = createRpgEngine({
    store,
    events: options.reader ?? options.events,
    timeZone,
    now,
    ...(options.newId ? { newId: options.newId } : {}),
    ...(options.pageSize ? { pageSize: options.pageSize } : {}),
    onCommit: (committed) => appendRunEvents(options.events, store, committed),
  });

  let unschedule: (() => void) | undefined;
  let processing = 0;
  let lastError: string | null = null;
  const audit = (summary: string, metadata: Record<string, unknown> = {}, status: AuditStatus = 'success') => options.audit?.(summary, metadata, status);

  async function process(occurrence: Pick<JobOccurrence, 'occurrenceId' | 'trigger'>): Promise<ProcessOutcome> {
    processing += 1;
    try {
      const outcome = await engine.process({ occurrenceId: occurrence.occurrenceId, trigger: occurrence.trigger });
      lastError = null;
      if (outcome.status === 'completed' && outcome.committed.inserted.length > 0) {
        const c = outcome.committed;
        audit(`Reality RPG: +${c.run.xp} XP from ${c.inserted.length} event(s)`, {
          runId: c.run.id, trigger: occurrence.trigger, levels: c.newLevels, achievements: c.newUnlocks.length, quests: c.newCompletions.length,
        });
      }
      return outcome;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      audit(`Reality RPG processing failed: ${lastError}`, { trigger: occurrence.trigger }, 'failure');
      throw error;
    } finally {
      processing -= 1;
    }
  }

  function reschedule(): void {
    unschedule?.();
    unschedule = undefined;
    const settings = options.settings.read();
    if (!settings.enabled) return;
    unschedule = options.scheduler.schedule({
      id: RPG_PROCESS_JOB,
      intervalMs: settings.intervalMinutes * 60_000,
      heavy: false,
      // Catch up once after time away; later slots only see new rows.
      runAtStartup: true,
      run: async (occurrence) => {
        if (!options.settings.read().enabled && occurrence.trigger !== 'manual') return;
        await process(occurrence);
      },
    });
  }

  function save(next: unknown): RealityRpgSettings {
    const settings = normalizeRealityRpgSettings(next);
    options.settings.write(settings);
    reschedule();
    return settings;
  }

  function idArg(value: unknown): string | null {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ? value : null;
  }

  function saveRuleVersion(input: Omit<Rule, 'version'>): Rule {
    return store.saveRule(input, now().toISOString());
  }

  return {
    store,
    engine,

    start() {
      const recovered = engine.recover();
      if (recovered > 0) audit(`Reality RPG closed ${recovered} interrupted run(s)`, { recovered }, 'failure');
      reschedule();
    },

    stop() {
      unschedule?.();
      unschedule = undefined;
    },

    status() {
      return { enabled: options.settings.read().enabled, processing: processing > 0, lastRun: store.listRuns(1)[0] ?? null, lastError };
    },

    getSettings: () => options.settings.read(),

    updateSettings(next) {
      // On/off is not a setting here: it goes through enable() / disable().
      const incoming = isObj(next) ? next : {};
      return save({ ...incoming, enabled: options.settings.read().enabled });
    },

    enable() {
      const s = save({ ...options.settings.read(), enabled: true });
      audit('Reality RPG turned on', { enabled: true });
      return s;
    },

    enableWith(input) {
      if (!isObj(input)) return fail('choose what to start with');
      const pick = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      const ruleIds = pick(input.ruleIds);
      const questIds = pick(input.questIds);
      const at = now().toISOString();
      let rules = 0;
      let quests = 0;
      let achievements = 0;
      for (const template of STARTER_RULES) {
        const parsed = parseRule({ ...(template as object), enabled: true, version: 1, effectiveFrom: at });
        if (!parsed.ok || !ruleIds.has(parsed.value.id)) continue;
        // A rule the owner already has is theirs: it is switched on, not overwritten.
        const existing = store.getRule(parsed.value.id);
        if (existing) {
          if (!existing.enabled) {
            const { version: _v, ...rest } = existing;
            saveRuleVersion({ ...rest, enabled: true, effectiveFrom: at });
            rules += 1;
          }
          continue;
        }
        const { version: _version, ...rule } = parsed.value;
        saveRuleVersion(rule);
        rules += 1;
      }
      const have = new Set(store.listRules().rules.filter((r) => r.enabled).map((r) => r.id));
      const known = new Set(store.listAchievements().achievements.map((a) => a.id));
      for (const template of STARTER_ACHIEVEMENTS) {
        const parsed = parseAchievement(template);
        if (!parsed.ok || known.has(parsed.value.id)) continue;
        const c = parsed.value.condition;
        // An achievement nobody could earn (its rule is not on) is not added.
        if (c.kind !== 'xp' && !c.ruleIds.some((id) => have.has(id))) continue;
        store.saveAchievement(parsed.value, at);
        achievements += 1;
      }
      for (const template of STARTER_QUESTS) {
        if (!questIds.has(template.id) || !have.has(template.needs) || store.getQuest(template.id)) continue;
        const parsed = parseQuest({ id: template.id, title: template.title, condition: template.condition, window: template.window, status: 'active', createdAt: at });
        if (!parsed.ok) continue;
        store.createQuest(parsed.value);
        quests += 1;
      }
      const settings = save({ ...options.settings.read(), enabled: true });
      audit('Reality RPG turned on', { enabled: true, rules, quests, achievements });
      return { ok: true, value: { settings, rules, quests, achievements } };
    },

    disable() {
      const s = save({ ...options.settings.read(), enabled: false });
      audit('Reality RPG turned off', { enabled: false });
      return s;
    },

    refresh() {
      return process({ occurrenceId: `${RPG_PROCESS_JOB}:manual:${randomUUID()}`, trigger: 'manual' });
    },

    saveRule(input) {
      if (!isObj(input)) return fail('a rule must be an object');
      const id = idArg(input.id);
      const existing = id ? store.getRule(id) : undefined;
      const enabled = input.enabled === true;
      // A rule earns only from the moment it is created or switched on. Editing a
      // rule that is already on keeps its start; the user cannot set it directly.
      const effectiveFrom = existing && existing.enabled && enabled ? existing.effectiveFrom : now().toISOString();
      const parsed = parseRule({ ...input, version: 1, effectiveFrom });
      if (!parsed.ok) return parsed;
      const { version: _version, ...rule } = parsed.value;
      const saved = saveRuleVersion(rule);
      audit(`Reality RPG rule ${existing ? 'updated' : 'created'}: ${saved.name}`, { ruleId: saved.id, version: saved.version, enabled: saved.enabled });
      return { ok: true, value: saved };
    },

    setRuleEnabled(idValue, enabledValue) {
      const id = idArg(idValue);
      const existing = id ? store.getRule(id) : undefined;
      if (!existing) return fail('no such rule');
      if (typeof enabledValue !== 'boolean') return fail('enabled must be true or false');
      if (existing.enabled === enabledValue) return { ok: true, value: existing };
      const { version: _version, ...rest } = existing;
      const saved = saveRuleVersion({ ...rest, enabled: enabledValue, effectiveFrom: enabledValue ? now().toISOString() : existing.effectiveFrom });
      audit(`Reality RPG rule ${enabledValue ? 'switched on' : 'switched off'}: ${saved.name}`, { ruleId: saved.id, version: saved.version });
      return { ok: true, value: saved };
    },

    deleteRule(idValue) {
      const id = idArg(idValue);
      if (!id || !store.deleteRule(id)) return fail('no such rule');
      audit('Reality RPG rule deleted (its XP is kept)', { ruleId: id });
      return { ok: true, value: { id } };
    },

    createQuest(input) {
      if (!isObj(input)) return fail('a quest must be an object');
      const title = typeof input.title === 'string' ? input.title : '';
      const id = idArg(input.id) ?? `${slug(title)}-${randomUUID().slice(0, 8)}`;
      if (store.getQuest(id)) return fail('a quest with that id already exists');
      const parsed = parseQuest({ ...input, id, status: 'active', createdAt: now().toISOString() });
      if (!parsed.ok) return parsed;
      const quest = store.createQuest(parsed.value);
      audit(`Reality RPG quest created: ${quest.title}`, { questId: quest.id, window: quest.window.kind });
      return { ok: true, value: quest };
    },

    abandonQuest(idValue) {
      const id = idArg(idValue);
      const quest = id ? store.getQuest(id) : undefined;
      if (!quest) return fail('no such quest');
      if (quest.status !== 'active') return fail(`the quest is already ${quest.status}`);
      const updated = store.setQuestStatus(quest.id, 'abandoned', now().toISOString());
      if (!updated) return fail('no such quest');
      audit(`Reality RPG quest abandoned: ${quest.title}`, { questId: quest.id });
      return { ok: true, value: updated };
    },

    saveAchievement(input) {
      const parsed = parseAchievement(input);
      if (!parsed.ok) return parsed;
      const saved = store.saveAchievement(parsed.value, now().toISOString());
      audit(`Reality RPG achievement saved: ${saved.name}`, { achievementId: saved.id });
      return { ok: true, value: saved };
    },

    deleteAchievement(idValue) {
      const id = idArg(idValue);
      if (!id || !store.deleteAchievement(id)) return fail('no such achievement');
      audit('Reality RPG achievement deleted (an unlock already earned is kept)', { achievementId: id });
      return { ok: true, value: { id } };
    },

    async backfill(ruleIdValue) {
      const id = idArg(ruleIdValue);
      const rule = id ? store.getRule(id) : undefined;
      if (!rule) return fail('no such rule');
      if (!rule.enabled) return fail('switch the rule on before applying it to past activity');
      const { version: _version, ...rest } = rule;
      saveRuleVersion({ ...rest, effectiveFrom: EPOCH });
      // Read the named types from the start. The ledger's unique key means
      // nothing already awarded is awarded again, and other rules still start
      // at their own effectiveFrom.
      store.setCursor(0);
      audit(`Reality RPG rule applied to past activity: ${rule.name}`, { ruleId: rule.id });
      const outcome = await process({ occurrenceId: `backfill:${rule.id}:${randomUUID()}`, trigger: 'manual' });
      return { ok: true, value: outcome };
    },

    snapshot() {
      const at = now();
      const rules = store.listRules();
      const achievements = store.listAchievements();
      const quests = store.listQuests();
      const ledger = store.allAwards();
      const unlocks = new Map(store.listUnlocks().map((u) => [u.achievementId, u]));
      const completions = store.listCompletions();
      const ruleNames = new Map(rules.rules.map((r) => [r.id, r.name]));
      const starterRules = STARTER_RULES.map((r) => parseRule(r)).flatMap((p) => (p.ok ? [p.value] : []));
      const starterAchievements = STARTER_ACHIEVEMENTS.map((a) => parseAchievement(a)).flatMap((p) => (p.ok ? [p.value] : []));
      return {
        enabled: options.settings.read().enabled,
        sheet: characterSheet(ledger),
        rules: rules.rules,
        achievements: achievements.achievements.map((achievement) => ({
          achievement,
          unlocked: unlocks.get(achievement.id) ?? null,
          progress: evaluateCondition(achievement.condition, ledger),
        })),
        quests: quests.quests.map((quest) => ({
          quest,
          progress: questProgress(quest, ledger, at, timeZone),
          completions: completions.filter((c) => c.questId === quest.id).length,
        })),
        recentAwards: store.listAwards({ limit: 50 }).map((a) => ({ ...a, ruleName: ruleNames.get(a.ruleId) ?? null })),
        lastRun: store.listRuns(1)[0] ?? null,
        invalid: { rules: rules.invalid, achievements: achievements.invalid, quests: quests.invalid },
        starter: {
          rules: starterRules,
          achievements: starterAchievements,
          quests: STARTER_QUESTS.flatMap((q) => {
            const parsed = parseQuest({ id: q.id, title: q.title, condition: q.condition, window: q.window, status: 'active', createdAt: at.toISOString() });
            return parsed.ok ? [{ id: q.id, title: q.title, needs: q.needs, recommended: q.recommended, condition: parsed.value.condition, window: parsed.value.window }] : [];
          }),
          info: Object.fromEntries(
            starterRules.flatMap((r) => {
              const info = STARTER_INFO[r.id];
              return info ? [[r.id, { ...info, groupLabel: STARTER_GROUP_LABELS[info.group] }]] : [];
            }),
          ),
        },
      };
    },
  };
}
