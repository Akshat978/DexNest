/**
 * The constellation engine: one build, start to finish.
 *
 *   begin (idempotent per occurrence)
 *     -> nothing new since the last build?  record "skipped", change nothing
 *     -> collect from Developer Intelligence, build (pure), commit (one transaction)
 *     -> anything throws?                   record "failed", previous constellation stays
 *
 * Builds are serialised in-process: a manual rebuild and a scheduled one with
 * different occurrence ids never interleave, so the stored cursor can only move
 * forward and never describes a constellation built from older input.
 *
 * The engine reads Developer Intelligence and the event log; it opens no file.
 */

import { randomUUID } from 'node:crypto';
import type { DataBoundary, EventLog } from '@dexnest/foundation';
import { buildConstellation, type ConstellationBuild } from '../domain/build.ts';
import { isPrivateLookingPath } from '../domain/privacy.ts';
import { buildSettingsFingerprint, type SkillConstellationSettings } from '../domain/settings.ts';
import type { SkillEvidence } from '../domain/types.ts';
import type { BuildRecord, BuildTrigger, SkillStore } from '../store/store.ts';
import { repositoryBoundary } from './boundary.ts';
import { collectInput, latestDevSeq, type DevIntelligenceReader } from './collect.ts';

export interface BuildRequest {
  occurrenceId: string;
  trigger: BuildTrigger;
  /** Build even when nothing changed since the last build. */
  force?: boolean;
}

export type BuildOutcome =
  | { status: 'completed'; build: BuildRecord; result: ConstellationBuild }
  | { status: 'skipped'; build: BuildRecord }
  /** This occurrence already has a build; nothing was done. */
  | { status: 'duplicate'; build: BuildRecord };

export interface Staleness {
  hasBuild: boolean;
  /** Dev events recorded since the last build. */
  devChanged: boolean;
  /** Build-relevant settings changed since the last build. */
  settingsChanged: boolean;
  stale: boolean;
  devCursorSeq: number;
  latestDevSeq: number;
}

export interface EvidenceView extends SkillEvidence {
  /** A TODO's text, looked up from Developer Intelligence now. Never stored. */
  todoText: string | null;
}

export interface ConstellationEngineOptions {
  store: SkillStore;
  reader: DevIntelligenceReader;
  events: EventLog;
  boundary: Pick<DataBoundary, 'isSensitive'>;
  settings: () => SkillConstellationSettings;
  now?: () => Date;
  newId?: () => string;
  pageSize?: number;
  /**
   * Extra writes that commit with a completed build (its events, Phase 4).
   * Runs inside the build's transaction; throwing fails the build.
   */
  onCommit?: (build: BuildRecord, result: ConstellationBuild) => void;
}

export interface ConstellationEngine {
  build(request: BuildRequest): Promise<BuildOutcome>;
  staleness(): Staleness;
  /** Closes out builds a crash left running. */
  recover(): number;
  /** A skill's evidence, newest first, with TODO text looked up live. */
  describeEvidence(skillId: string, options?: { limit?: number }): Promise<EvidenceView[]>;
}

export function createConstellationEngine(options: ConstellationEngineOptions): ConstellationEngine {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `build_${randomUUID()}`);
  const { store } = options;
  let queue: Promise<unknown> = Promise.resolve();

  function staleness(): Staleness {
    const latest = latestDevSeq(options.events);
    const hasBuild = store.lastCompletedBuild() !== undefined;
    const devChanged = latest !== store.devCursor();
    const settingsChanged = store.settingsFingerprint() !== buildSettingsFingerprint(options.settings());
    return {
      hasBuild,
      devChanged,
      settingsChanged,
      stale: !hasBuild || devChanged || settingsChanged,
      devCursorSeq: store.devCursor(),
      latestDevSeq: latest,
    };
  }

  async function runBuild(request: BuildRequest): Promise<BuildOutcome> {
    const begun = store.beginBuild({
      id: newId(),
      occurrenceId: request.occurrenceId,
      trigger: request.trigger,
      startedAt: now().toISOString(),
    });
    if (!begun.started) return { status: 'duplicate', build: begun.build };
    const buildId = begun.build.id;

    try {
      const settings = options.settings();
      const fingerprint = buildSettingsFingerprint(settings);
      const state = staleness();
      if (!state.stale && !request.force) {
        const build = store.markSkipped(buildId, {
          finishedAt: now().toISOString(),
          devCursorSeq: state.latestDevSeq,
          settingsFingerprint: fingerprint,
        });
        return { status: 'skipped', build };
      }

      const collected = await collectInput({
        reader: options.reader,
        events: options.events,
        ...(options.pageSize ? { pageSize: options.pageSize } : {}),
      });
      const builtAt = now();
      const result = buildConstellation(collected.input, {
        settings,
        isSensitive: repositoryBoundary(options.boundary, collected.repositoryRoots),
        now: builtAt,
        previousSkillIds: store.skillIds(),
      });
      const build = store.commitBuild({
        buildId,
        finishedAt: builtAt.toISOString(),
        devCursorSeq: collected.devCursorSeq,
        settingsFingerprint: fingerprint,
        result,
        ...(options.onCommit
          ? { alsoInTransaction: () => options.onCommit?.(store.getBuild(buildId)!, result) }
          : {}),
      });
      return { status: 'completed', build, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.markFailed(buildId, { finishedAt: now().toISOString(), error: message });
      throw error;
    }
  }

  return {
    build(request) {
      const run = queue.then(() => runBuild(request));
      queue = run.catch(() => undefined);
      return run;
    },

    staleness,

    recover() {
      return store.recoverInterruptedBuilds(now().toISOString());
    },

    async describeEvidence(skillId, describeOptions) {
      const rows = store.listEvidence(skillId, describeOptions);
      const out: EvidenceView[] = [];
      for (const row of rows) {
        let todoText: string | null = null;
        if ((row.kind === 'todo.open' || row.kind === 'todo.resolved') && row.path && !isPrivateLookingPath(row.path)) {
          const marker = await options.reader.todos.get(row.sourceRef);
          todoText = marker?.text ?? null;
        }
        out.push({ ...row, todoText });
      }
      return out;
    },
  };
}
