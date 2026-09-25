/**
 * Skill Constellation persistence on the shared SqlDatabase.
 *
 * The one rule that matters: a build's result lands whole or not at all. The
 * current constellation (skills, evidence, links, layout), its history rows,
 * the build record and the dev cursor are written in ONE withTransaction. A
 * crash or error anywhere in it rolls all of it back, and the previous
 * constellation is still there, still consistent with the cursor it was built
 * from - so the next build simply does the work again.
 *
 * Nothing here reads Developer Intelligence's tables.
 */

import { withTransaction, type SqlDatabase } from '@dexnest/foundation';
import type { ConstellationBuild } from '../domain/build.ts';
import { buildsToPrune, HISTORY_BUILDS_KEPT, strengthSnapshots } from '../domain/history.ts';
import type {
  EvidenceKind,
  Skill,
  SkillCategory,
  SkillEvidence,
  SkillLayoutPoint,
  SkillLink,
  SkillLinkSource,
  SkillStrengthSnapshot,
} from '../domain/types.ts';

export type BuildStatus = 'running' | 'completed' | 'skipped' | 'failed';
export type BuildTrigger = 'scheduled' | 'startup' | 'manual';

export interface BuildRecord {
  id: string;
  occurrenceId: string;
  trigger: BuildTrigger;
  status: BuildStatus;
  startedAt: string;
  finishedAt: string | null;
  devCursorSeq: number | null;
  settingsFingerprint: string | null;
  skills: number;
  evidence: number;
  links: number;
  added: number;
  lost: number;
  refusedPrivate: number;
  othersCommits: number;
  error: string | null;
}

export type BeginBuildResult = { started: true; build: BuildRecord } | { started: false; build: BuildRecord };

export interface CommitBuildInput {
  buildId: string;
  finishedAt: string;
  devCursorSeq: number;
  settingsFingerprint: string;
  result: ConstellationBuild;
  /**
   * More writes that must commit with the build or not at all - the build's
   * events, in Phase 4. Runs last inside the transaction; throwing rolls back
   * everything.
   */
  alsoInTransaction?: () => void;
}

export interface SkillStore {
  /** Starts a build for an occurrence, or returns the build that occurrence already has. */
  beginBuild(input: { id: string; occurrenceId: string; trigger: BuildTrigger; startedAt: string }): BeginBuildResult;
  commitBuild(input: CommitBuildInput): BuildRecord;
  /** Nothing new to build from: records why and changes nothing else. */
  markSkipped(buildId: string, input: { finishedAt: string; devCursorSeq: number; settingsFingerprint: string }): BuildRecord;
  markFailed(buildId: string, input: { finishedAt: string; error: string }): BuildRecord;
  /** Closes out builds left `running` by a crash. Returns how many. */
  recoverInterruptedBuilds(now: string): number;

  getBuild(id: string): BuildRecord | undefined;
  getBuildByOccurrence(occurrenceId: string): BuildRecord | undefined;
  listBuilds(limit?: number): BuildRecord[];
  lastCompletedBuild(): BuildRecord | undefined;

  /** The dev event seq the current constellation was built from; 0 before any build. */
  devCursor(): number;
  /** The settings fingerprint the current constellation was built with. */
  settingsFingerprint(): string | null;

  listSkills(): Skill[];
  getSkill(id: string): Skill | undefined;
  skillIds(): string[];
  listEvidence(skillId: string, options?: { limit?: number }): SkillEvidence[];
  countEvidence(skillId?: string): number;
  listLinks(): SkillLink[];
  listLayout(): SkillLayoutPoint[];
  strengthHistory(skillId: string, options?: { limit?: number }): SkillStrengthSnapshot[];
  historyBuildIds(): string[];
}

type Row = Record<string, unknown>;

const str = (value: unknown): string => String(value);
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function toBuild(row: Row): BuildRecord {
  return {
    id: str(row.id),
    occurrenceId: str(row.occurrence_id),
    trigger: str(row.trigger) as BuildTrigger,
    status: str(row.status) as BuildStatus,
    startedAt: str(row.started_at),
    finishedAt: strOrNull(row.finished_at),
    devCursorSeq: numOrNull(row.dev_cursor_seq),
    settingsFingerprint: strOrNull(row.settings_fingerprint),
    skills: num(row.skills),
    evidence: num(row.evidence),
    links: num(row.links),
    added: num(row.added),
    lost: num(row.lost),
    refusedPrivate: num(row.refused_private),
    othersCommits: num(row.others_commits),
    error: strOrNull(row.error),
  };
}

function toSkill(row: Row): Skill {
  return {
    id: str(row.id),
    name: str(row.name),
    category: str(row.category) as SkillCategory,
    evidenceCount: num(row.evidence_count),
    repositoryCount: num(row.repository_count),
    evidenceKinds: num(row.evidence_kinds),
    firstEvidenceAt: str(row.first_evidence_at),
    lastEvidenceAt: str(row.last_evidence_at),
    lastActivityAt: strOrNull(row.last_activity_at),
  };
}

function toEvidence(row: Row): SkillEvidence {
  return {
    id: str(row.id),
    skillId: str(row.skill_id),
    kind: str(row.kind) as EvidenceKind,
    repositoryId: str(row.repository_id),
    repositoryName: strOrNull(row.repository_name),
    path: strOrNull(row.path),
    at: str(row.at),
    sourceRef: str(row.source_ref),
    detail: strOrNull(row.detail),
  };
}

function toLink(row: Row): SkillLink {
  const parsed: unknown = JSON.parse(str(row.shared_repository_ids_json));
  return {
    a: str(row.a),
    b: str(row.b),
    source: str(row.source) as SkillLinkSource,
    sharedRepositoryIds: Array.isArray(parsed) ? parsed.map(String) : [],
    weight: num(row.weight),
  };
}

function toSnapshot(row: Row): SkillStrengthSnapshot {
  return {
    buildId: str(row.build_id),
    skillId: str(row.skill_id),
    at: str(row.at),
    evidenceCount: num(row.evidence_count),
    volume: num(row.volume),
    recency: num(row.recency),
    variety: num(row.variety),
    score: num(row.score),
  };
}

const STATE_DEV_CURSOR = 'dev_cursor_seq';
const STATE_FINGERPRINT = 'settings_fingerprint';
const STATE_LAST_BUILD = 'last_build_id';

export function createSkillStore(db: SqlDatabase, options: { historyBuildsKept?: number } = {}): SkillStore {
  const keep = options.historyBuildsKept ?? HISTORY_BUILDS_KEPT;
  const get = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).get<Row>(params);
  const all = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).all<Row>(params);
  const run = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).run(params);

  const getBuild = (id: string) => {
    const row = get('SELECT * FROM skill_builds WHERE id = ?', [id]);
    return row ? toBuild(row) : undefined;
  };
  const requireBuild = (id: string) => {
    const build = getBuild(id);
    if (!build) throw new Error(`Skill Constellation build ${id} does not exist.`);
    return build;
  };
  const state = (key: string) => {
    const row = get('SELECT value FROM skill_state WHERE key = ?', [key]);
    return row ? str(row.value) : null;
  };
  const setState = (key: string, value: string) =>
    run('INSERT INTO skill_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);

  /** Keeps history for the newest `keep` completed builds; drops build rows older than all of them. */
  function pruneHistory(): void {
    const completed = all("SELECT id, started_at FROM skill_builds WHERE status = 'completed'").map((r) => ({
      id: str(r.id),
      at: str(r.started_at),
    }));
    const pruned = buildsToPrune(completed, keep);
    if (pruned.length === 0) return;
    const prunedSet = new Set(pruned);
    const kept = completed.filter((b) => !prunedSet.has(b.id));
    const cutoff = kept.map((b) => b.at).sort()[0];
    const deleteHistory = db.prepare('DELETE FROM skill_strength_history WHERE build_id = ?');
    const deleteBuild = db.prepare('DELETE FROM skill_builds WHERE id = ?');
    for (const id of pruned) {
      deleteHistory.run([id]);
      deleteBuild.run([id]);
    }
    if (cutoff) run("DELETE FROM skill_builds WHERE started_at < ? AND status <> 'running'", [cutoff]);
  }

  return {
    beginBuild(input) {
      return withTransaction(db, () => {
        const inserted = run(
          `INSERT OR IGNORE INTO skill_builds (id, occurrence_id, trigger, status, started_at)
           VALUES (?, ?, ?, 'running', ?)`,
          [input.id, input.occurrenceId, input.trigger, input.startedAt],
        ).changes;
        const row = get('SELECT * FROM skill_builds WHERE occurrence_id = ?', [input.occurrenceId]);
        if (!row) throw new Error(`Skill Constellation build for ${input.occurrenceId} was not recorded.`);
        const build = toBuild(row);
        return inserted > 0 ? { started: true, build } : { started: false, build };
      });
    },

    commitBuild(input) {
      return withTransaction(db, () => {
        const build = requireBuild(input.buildId);
        if (build.status !== 'running') {
          throw new Error(`Skill Constellation build ${input.buildId} is ${build.status}, not running.`);
        }
        const { result } = input;

        run('DELETE FROM skill_skills');
        run('DELETE FROM skill_evidence');
        run('DELETE FROM skill_links');
        run('DELETE FROM skill_layout');

        const insertSkill = db.prepare(
          `INSERT INTO skill_skills (id, name, category, evidence_count, repository_count, evidence_kinds,
             first_evidence_at, last_evidence_at, last_activity_at, build_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const s of result.skills) {
          insertSkill.run([s.id, s.name, s.category, s.evidenceCount, s.repositoryCount, s.evidenceKinds, s.firstEvidenceAt, s.lastEvidenceAt, s.lastActivityAt, input.buildId]);
        }

        const insertEvidence = db.prepare(
          `INSERT INTO skill_evidence (id, skill_id, kind, repository_id, repository_name, path, at, source_ref, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const e of result.evidence) {
          insertEvidence.run([e.id, e.skillId, e.kind, e.repositoryId, e.repositoryName, e.path, e.at, e.sourceRef, e.detail]);
        }

        const insertLink = db.prepare(
          'INSERT INTO skill_links (a, b, source, shared_repository_ids_json, weight) VALUES (?, ?, ?, ?, ?)',
        );
        for (const l of result.links) insertLink.run([l.a, l.b, l.source, JSON.stringify(l.sharedRepositoryIds), l.weight]);

        const insertPoint = db.prepare('INSERT INTO skill_layout (skill_id, x, y) VALUES (?, ?, ?)');
        for (const p of result.layout) insertPoint.run([p.skillId, p.x, p.y]);

        const insertHistory = db.prepare(
          `INSERT INTO skill_strength_history (build_id, skill_id, at, evidence_count, volume, recency, variety, score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const h of strengthSnapshots(input.buildId, input.finishedAt, result.skills)) {
          insertHistory.run([h.buildId, h.skillId, h.at, h.evidenceCount, h.volume, h.recency, h.variety, h.score]);
        }

        run(
          `UPDATE skill_builds SET status = 'completed', finished_at = ?, dev_cursor_seq = ?, settings_fingerprint = ?,
             skills = ?, evidence = ?, links = ?, added = ?, lost = ?, refused_private = ?, others_commits = ?, error = NULL
           WHERE id = ?`,
          [
            input.finishedAt,
            input.devCursorSeq,
            input.settingsFingerprint,
            result.skills.length,
            result.evidence.length,
            result.links.length,
            result.added.length,
            result.lost.length,
            result.refusedPrivate,
            result.othersCommits,
            input.buildId,
          ],
        );
        setState(STATE_DEV_CURSOR, String(input.devCursorSeq));
        setState(STATE_FINGERPRINT, input.settingsFingerprint);
        setState(STATE_LAST_BUILD, input.buildId);

        pruneHistory();
        input.alsoInTransaction?.();
        return requireBuild(input.buildId);
      });
    },

    markSkipped(buildId, input) {
      return withTransaction(db, () => {
        run(
          `UPDATE skill_builds SET status = 'skipped', finished_at = ?, dev_cursor_seq = ?, settings_fingerprint = ?
           WHERE id = ? AND status = 'running'`,
          [input.finishedAt, input.devCursorSeq, input.settingsFingerprint, buildId],
        );
        return requireBuild(buildId);
      });
    },

    markFailed(buildId, input) {
      return withTransaction(db, () => {
        run(`UPDATE skill_builds SET status = 'failed', finished_at = ?, error = ? WHERE id = ? AND status = 'running'`, [
          input.finishedAt,
          input.error,
          buildId,
        ]);
        return requireBuild(buildId);
      });
    },

    recoverInterruptedBuilds(now) {
      return run(
        `UPDATE skill_builds SET status = 'failed', finished_at = ?, error = 'Interrupted before it finished.'
         WHERE status = 'running'`,
        [now],
      ).changes;
    },

    getBuild,

    getBuildByOccurrence(occurrenceId) {
      const row = get('SELECT * FROM skill_builds WHERE occurrence_id = ?', [occurrenceId]);
      return row ? toBuild(row) : undefined;
    },

    listBuilds(limit = 20) {
      return all('SELECT * FROM skill_builds ORDER BY started_at DESC, id DESC LIMIT ?', [limit]).map(toBuild);
    },

    lastCompletedBuild() {
      const id = state(STATE_LAST_BUILD);
      return id ? getBuild(id) : undefined;
    },

    devCursor() {
      const value = Number(state(STATE_DEV_CURSOR) ?? 0);
      return Number.isFinite(value) ? value : 0;
    },

    settingsFingerprint() {
      return state(STATE_FINGERPRINT);
    },

    listSkills() {
      return all('SELECT * FROM skill_skills ORDER BY id').map(toSkill);
    },

    getSkill(id) {
      const row = get('SELECT * FROM skill_skills WHERE id = ?', [id]);
      return row ? toSkill(row) : undefined;
    },

    skillIds() {
      return all('SELECT id FROM skill_skills ORDER BY id').map((r) => str(r.id));
    },

    listEvidence(skillId, listOptions) {
      return all('SELECT * FROM skill_evidence WHERE skill_id = ? ORDER BY at DESC, id LIMIT ?', [skillId, listOptions?.limit ?? 500]).map(
        toEvidence,
      );
    },

    countEvidence(skillId) {
      const row = skillId
        ? get('SELECT COUNT(*) AS n FROM skill_evidence WHERE skill_id = ?', [skillId])
        : get('SELECT COUNT(*) AS n FROM skill_evidence');
      return num(row?.n ?? 0);
    },

    listLinks() {
      return all('SELECT * FROM skill_links ORDER BY a, b').map(toLink);
    },

    listLayout() {
      return all('SELECT * FROM skill_layout ORDER BY skill_id').map((r) => ({ skillId: str(r.skill_id), x: num(r.x), y: num(r.y) }));
    },

    strengthHistory(skillId, historyOptions) {
      return all('SELECT * FROM skill_strength_history WHERE skill_id = ? ORDER BY at DESC, build_id DESC LIMIT ?', [
        skillId,
        historyOptions?.limit ?? keep,
      ]).map(toSnapshot);
    },

    historyBuildIds() {
      return all('SELECT DISTINCT build_id FROM skill_strength_history ORDER BY build_id').map((r) => str(r.build_id));
    },
  };
}
