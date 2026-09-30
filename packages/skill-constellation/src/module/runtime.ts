/**
 * Skill Constellation as a DexNest module.
 *
 * Everything the desktop host needs behind the foundation's host ports, so the
 * host file is wiring only. Modelled on Developer Intelligence's runtime.
 *
 *   - Off until asked. No job is scheduled, and no timer exists, until the
 *     user turns it on. A manual rebuild works either way - it is the user
 *     asking.
 *   - The scheduled job is heavy (it aggregates the whole dev history), so the
 *     host holds it off in Performance Mode, and it is idempotent per
 *     occurrence: a slot delivered twice builds once and records one event.
 *   - It never starts a Developer Intelligence scan and never reads disk. It
 *     reads what DI already recorded.
 */

import { randomUUID } from 'node:crypto';
import type { DataBoundary, EventLog, JobOccurrence, ModuleScheduler, ModuleSettings, SqlDatabase } from '@dexnest/foundation';
import { computeStrength } from '../domain/strength.ts';
import { normalizeSkillConstellationSettings, type SkillConstellationSettings } from '../domain/settings.ts';
import type { Skill, SkillLayoutPoint, SkillLink, SkillStrength, SkillStrengthSnapshot } from '../domain/types.ts';
import { createConstellationEngine, type BuildOutcome, type ConstellationEngine, type EvidenceView, type Staleness } from '../engine/engine.ts';
import type { DevIntelligenceReader } from '../engine/collect.ts';
import { SKILL_REBUILD_JOB } from '../manifest.ts';
import { createSkillStore, type BuildRecord, type SkillStore } from '../store/store.ts';
import { appendBuildEvents } from './events.ts';

export type AuditStatus = 'success' | 'failure';

export interface SkillConstellationModuleOptions {
  database: SqlDatabase;
  events: EventLog;
  boundary: Pick<DataBoundary, 'isSensitive'>;
  scheduler: ModuleScheduler;
  settings: ModuleSettings<SkillConstellationSettings>;
  /** Developer Intelligence's persistence, read-only. */
  reader: DevIntelligenceReader;
  /** A line in DexNest's audit log. */
  audit?(summary: string, metadata: Record<string, unknown>, status: AuditStatus): void;
  now?: () => Date;
  newId?: () => string;
  pageSize?: number;
}

export interface ConstellationSkill extends Skill {
  strength: SkillStrength;
  hidden: boolean;
}

export interface ConstellationSnapshot {
  enabled: boolean;
  skills: ConstellationSkill[];
  links: SkillLink[];
  layout: SkillLayoutPoint[];
  lastBuild: BuildRecord | null;
  staleness: Staleness;
  /** True when my emails are unset, so every commit counts. */
  countsAllCommits: boolean;
}

export interface SkillConstellationStatus {
  enabled: boolean;
  building: boolean;
  lastBuild: BuildRecord | null;
  lastError: string | null;
  staleness: Staleness;
}

export interface SkillConstellationModule {
  readonly store: SkillStore;
  readonly engine: ConstellationEngine;
  /** Recovers builds a crash left running, and schedules the job if enabled. */
  start(): void;
  stop(): void;
  status(): SkillConstellationStatus;
  getSettings(): SkillConstellationSettings;
  updateSettings(next: unknown): SkillConstellationSettings;
  enable(): SkillConstellationSettings;
  disable(): SkillConstellationSettings;
  /** A rebuild the user asked for. Skipped when nothing changed, unless forced. */
  rebuildNow(options?: { force?: boolean }): Promise<BuildOutcome>;
  constellation(): ConstellationSnapshot;
  describeEvidence(skillId: string, options?: { limit?: number }): Promise<EvidenceView[]>;
  strengthHistory(skillId: string): SkillStrengthSnapshot[];
}

export function createSkillConstellationModule(options: SkillConstellationModuleOptions): SkillConstellationModule {
  const now = options.now ?? (() => new Date());
  const store = createSkillStore(options.database);
  const engine = createConstellationEngine({
    store,
    reader: options.reader,
    events: options.events,
    boundary: options.boundary,
    settings: () => options.settings.read(),
    now,
    ...(options.newId ? { newId: options.newId } : {}),
    ...(options.pageSize ? { pageSize: options.pageSize } : {}),
    onCommit: (build, result) => appendBuildEvents(options.events, build, result),
  });

  let unschedule: (() => void) | undefined;
  let building = 0;
  let lastError: string | null = null;

  async function build(occurrence: Pick<JobOccurrence, 'occurrenceId' | 'trigger'>, force = false): Promise<BuildOutcome> {
    building += 1;
    try {
      const outcome = await engine.build({ occurrenceId: occurrence.occurrenceId, trigger: occurrence.trigger, force });
      lastError = null;
      if (outcome.status === 'completed') {
        const b = outcome.build;
        options.audit?.(
          `Skill Constellation rebuilt: ${b.skills} skill(s), ${b.evidence} evidence row(s)`,
          { buildId: b.id, trigger: occurrence.trigger, added: b.added, lost: b.lost, refusedPrivate: b.refusedPrivate },
          'success',
        );
      }
      return outcome;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      options.audit?.(`Skill Constellation rebuild failed: ${lastError}`, { trigger: occurrence.trigger }, 'failure');
      throw error;
    } finally {
      building -= 1;
    }
  }

  function reschedule(): void {
    unschedule?.();
    unschedule = undefined;
    const settings = options.settings.read();
    if (!settings.enabled) return;
    unschedule = options.scheduler.schedule({
      id: SKILL_REBUILD_JOB,
      intervalMs: settings.rebuildIntervalMinutes * 60_000,
      heavy: true,
      // DI's own startup scan is what produces new facts; building before it
      // would only rebuild yesterday's input.
      runAtStartup: false,
      run: async (occurrence) => {
        // The timer only exists while enabled, but a slot can land mid-toggle.
        if (!options.settings.read().enabled && occurrence.trigger !== 'manual') return;
        await build(occurrence);
      },
    });
  }

  function save(next: unknown): SkillConstellationSettings {
    const settings = normalizeSkillConstellationSettings(next);
    options.settings.write(settings);
    reschedule();
    return settings;
  }

  function setEnabled(enabled: boolean): SkillConstellationSettings {
    const settings = save({ ...options.settings.read(), enabled });
    options.audit?.(enabled ? 'Skill Constellation turned on' : 'Skill Constellation turned off', { enabled }, 'success');
    return settings;
  }

  return {
    store,
    engine,

    start() {
      const recovered = engine.recover();
      if (recovered > 0) {
        options.audit?.(`Skill Constellation closed ${recovered} interrupted build(s)`, { recovered }, 'failure');
      }
      reschedule();
    },

    stop() {
      unschedule?.();
      unschedule = undefined;
    },

    status() {
      return {
        enabled: options.settings.read().enabled,
        building: building > 0,
        lastBuild: store.lastCompletedBuild() ?? null,
        lastError,
        staleness: engine.staleness(),
      };
    },

    getSettings() {
      return options.settings.read();
    },

    updateSettings(next) {
      return save(next);
    },

    enable() {
      return setEnabled(true);
    },

    disable() {
      return setEnabled(false);
    },

    rebuildNow(rebuildOptions) {
      return build({ occurrenceId: `${SKILL_REBUILD_JOB}:manual:${randomUUID()}`, trigger: 'manual' }, rebuildOptions?.force === true);
    },

    constellation() {
      const settings = options.settings.read();
      const hidden = new Set(settings.hiddenSkills);
      const at = now();
      return {
        enabled: settings.enabled,
        skills: store.listSkills().map((skill) => ({ ...skill, strength: computeStrength(skill, at), hidden: hidden.has(skill.id) })),
        links: store.listLinks(),
        layout: store.listLayout(),
        lastBuild: store.lastCompletedBuild() ?? null,
        staleness: engine.staleness(),
        countsAllCommits: settings.myEmails.length === 0,
      };
    },

    describeEvidence(skillId, describeOptions) {
      return engine.describeEvidence(skillId, describeOptions);
    },

    strengthHistory(skillId) {
      return store.strengthHistory(skillId);
    },
  };
}
