/**
 * Writing a build's events to the shared event log.
 *
 * Called from inside the build's transaction (the engine's onCommit), so the
 * events and the constellation they describe commit together: there is never
 * a "built" event for a build that rolled back, and never a build without one.
 *
 * Every append carries an idempotency key, so a replay records nothing:
 * - built:       one per occurrence;
 * - discovered:  once ever per skill - a skill that fades and returns is not
 *                "discovered" again;
 * - evidence_lost: once per skill per build.
 */

import type { EventLog } from '@dexnest/foundation';
import type { ConstellationBuild } from '../domain/build.ts';
import {
  builtKey,
  discoveredKey,
  evidenceLostKey,
  SKILL_EVENT_STREAM,
  SKILL_MODULE_ID,
  type ConstellationBuiltPayload,
  type SkillDiscoveredPayload,
  type SkillEvidenceLostPayload,
} from '../domain/events.ts';
import type { BuildRecord } from '../store/store.ts';

export function appendBuildEvents(events: EventLog, build: BuildRecord, result: ConstellationBuild): void {
  const at = build.finishedAt ?? build.startedAt;
  const common = {
    stream: SKILL_EVENT_STREAM,
    module: SKILL_MODULE_ID,
    source: SKILL_MODULE_ID,
    sourceIdentity: build.occurrenceId,
    occurredAt: at,
    recordedAt: at,
    schemaVersion: 1,
  };

  const built: ConstellationBuiltPayload = {
    buildId: build.id,
    occurrenceId: build.occurrenceId,
    skills: result.skills.length,
    evidence: result.evidence.length,
    links: result.links.length,
    added: result.added.length,
    lost: result.lost.length,
    refusedPrivate: result.refusedPrivate,
    othersCommits: result.othersCommits,
  };
  events.append({ ...common, type: 'skill.constellation.built', subject: build.id, idempotencyKey: builtKey(build.occurrenceId), payload: built });

  const byId = new Map(result.skills.map((s) => [s.id, s]));
  for (const skillId of result.added) {
    const skill = byId.get(skillId);
    if (!skill) continue;
    const payload: SkillDiscoveredPayload = {
      skillId,
      buildId: build.id,
      evidenceCount: skill.evidenceCount,
      firstEvidenceAt: skill.firstEvidenceAt,
    };
    events.append({ ...common, type: 'skill.discovered', subject: skillId, idempotencyKey: discoveredKey(skillId), payload });
  }

  for (const skillId of result.lost) {
    const payload: SkillEvidenceLostPayload = { skillId, buildId: build.id };
    events.append({ ...common, type: 'skill.evidence_lost', subject: skillId, idempotencyKey: evidenceLostKey(skillId, build.id), payload });
  }
}
