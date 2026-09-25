/**
 * StandupStore on DexNest's shared connection.
 * Standup-owned tables (standup_*). Not part of DI PersistencePorts.
 *
 * The standalone build opened raw BEGIN/COMMIT itself. On a shared connection
 * that fails outright whenever a caller already holds a transaction, because
 * SQLite cannot nest BEGIN - so both transactional methods use withTransaction,
 * which nests through savepoints.
 */

import type {
  IssueLifecycleState,
  ListStandupReportsQuery,
  ListStandupReportsResult,
  StandupReport,
  StandupStore,
  StandupTriggerKind,
} from '@dexnest/dev-intelligence-contracts';
import { withTransaction } from '@dexnest/foundation';
import type { StoreDb } from '../db.ts';

function parseReport(json: string): StandupReport {
  return JSON.parse(json) as StandupReport;
}

export function createStandupStore(db: StoreDb): StandupStore {
  function loadReportById(id: string): StandupReport | null {
    const row = db.get<{ report_json: string }>(
      'SELECT report_json FROM standup_reports WHERE id = ?',
      [id],
    );
    return row ? parseReport(String(row.report_json)) : null;
  }

  return {
    async saveReport(report: StandupReport): Promise<StandupReport> {
      // Scheduled (and any trigger) unique on (occurrence_id, trigger_kind).
      // INSERT OR IGNORE: if collision, return existing without mutating lifecycle.
      const existing = db.get<{ id: string; report_json: string }>(
        `SELECT id, report_json FROM standup_reports
         WHERE occurrence_id = ? AND trigger_kind = ?`,
        [report.occurrenceId, report.triggerKind],
      );
      if (existing) {
        return parseReport(String(existing.report_json));
      }

      return withTransaction(db.sql, () => {
        // Re-checked inside the transaction: BEGIN IMMEDIATE holds the write
        // lock, so no other writer can insert the same occurrence in between.
        const again = db.get<{ report_json: string }>(
          `SELECT report_json FROM standup_reports
           WHERE occurrence_id = ? AND trigger_kind = ?`,
          [report.occurrenceId, report.triggerKind],
        );
        if (again) return parseReport(String(again.report_json));

        const changes = db.run(
          `INSERT OR IGNORE INTO standup_reports (
            id, occurrence_id, trigger_kind, generated_at,
            window_kind, window_from, window_to, timezone,
            schema_version, previous_report_id, status, report_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
          [
            report.id,
            report.occurrenceId,
            report.triggerKind,
            report.generatedAt,
            report.timeWindow.kind,
            report.timeWindow.from,
            report.timeWindow.to,
            report.timeWindow.timezone ?? null,
            report.schemaVersion,
            report.previousSuccessfulReportId ?? null,
            JSON.stringify(report),
          ],
        );

        if (changes === 0) {
          // The id already exists under another occurrence. Return what is
          // stored rather than writing items against a report that is not ours.
          return loadReportById(report.id) ?? report;
        }

        // Items commit with their report or not at all: a report with half its
        // items would render as a Standup with sections silently missing.
        for (const item of report.items) {
          db.run(
            `INSERT INTO standup_items (
              report_id, item_id, section, repository_id, lifecycle,
              issue_fingerprint, sort_key, item_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              report.id,
              item.id,
              item.section,
              item.repositoryId ?? null,
              item.lifecycle ?? null,
              item.issueIdentity?.fingerprint ?? null,
              item.sortKey ?? null,
              JSON.stringify(item),
            ],
          );
        }
        return report;
      });
    },

    async findByOccurrence(
      occurrenceId: string,
      triggerKind: StandupTriggerKind,
    ): Promise<StandupReport | null> {
      const row = db.get<{ report_json: string }>(
        `SELECT report_json FROM standup_reports
         WHERE occurrence_id = ? AND trigger_kind = ?`,
        [occurrenceId, triggerKind],
      );
      return row ? parseReport(String(row.report_json)) : null;
    },

    async getReport(id: string): Promise<StandupReport | null> {
      return loadReportById(id);
    },

    async listReports(
      query: ListStandupReportsQuery,
    ): Promise<ListStandupReportsResult> {
      const clauses: string[] = ["status = 'completed'"];
      const params: Array<string | number> = [];

      if (query.generatedFrom) {
        clauses.push('generated_at >= ?');
        params.push(query.generatedFrom);
      }
      if (query.generatedTo) {
        clauses.push('generated_at < ?');
        params.push(query.generatedTo);
      }
      if (query.windowKind) {
        clauses.push('window_kind = ?');
        params.push(query.windowKind);
      }
      if (query.triggerKind) {
        clauses.push('trigger_kind = ?');
        params.push(query.triggerKind);
      }
      if (query.occurrenceId) {
        clauses.push('occurrence_id = ?');
        params.push(query.occurrenceId);
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const countRow = db.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM standup_reports ${where}`,
        params,
      );
      const total = Number(countRow?.c ?? 0);

      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;
      const rows = db.all<{ report_json: string }>(
        `SELECT report_json FROM standup_reports
         ${where}
         ORDER BY generated_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

      let reports = rows.map((r) => parseReport(String(r.report_json)));

      // Optional repositoryId filter (not a column — filter in memory after load).
      if (query.repositoryId) {
        const rid = query.repositoryId;
        reports = reports.filter((rep) =>
          rep.items.some((it) => it.repositoryId === rid),
        );
      }

      return { reports, total };
    },

    async getLatestSuccessfulReport(): Promise<StandupReport | null> {
      const row = db.get<{ report_json: string }>(
        `SELECT report_json FROM standup_reports
         WHERE status = 'completed'
         ORDER BY generated_at DESC
         LIMIT 1`,
      );
      return row ? parseReport(String(row.report_json)) : null;
    },

    async getIssueStates(): Promise<readonly IssueLifecycleState[]> {
      const rows = db.all<{
        fingerprint: string;
        identity_json: string;
        lifecycle: string;
        first_observed_at: string;
        last_observed_at: string;
        first_report_id: string | null;
        resolved_in_report_id: string | null;
      }>(
        `SELECT fingerprint, identity_json, lifecycle, first_observed_at,
                last_observed_at, first_report_id, resolved_in_report_id
         FROM standup_issue_states
         WHERE lifecycle != 'RESOLVED'`,
      );
      return rows.map((r) => {
          const identity = JSON.parse(String(r.identity_json)) as IssueLifecycleState['identity'];
          const state: IssueLifecycleState = {
            identity,
            lifecycle: String(r.lifecycle) as IssueLifecycleState['lifecycle'],
            firstObservedAt: String(r.first_observed_at),
            lastObservedAt: String(r.last_observed_at),
          };
          if (r.first_report_id) {
            (state as { firstReportId?: string }).firstReportId = String(
              r.first_report_id,
            );
          }
          if (r.resolved_in_report_id) {
            (state as { resolvedInReportId?: string }).resolvedInReportId =
              String(r.resolved_in_report_id);
          }
          return state;
      });
    },

    async upsertIssueStates(
      states: readonly IssueLifecycleState[],
    ): Promise<void> {
      withTransaction(db.sql, () => {
        // Replace the open set: delete all, then write the open (NEW/ONGOING)
        // states. RESOLVED announcements are carried on the report itself;
        // keeping them out of the open set prevents re-announcement as NEW.
        db.run(`DELETE FROM standup_issue_states`);
        for (const s of states) {
          if (s.lifecycle === 'RESOLVED') continue;
          db.run(
            `INSERT OR REPLACE INTO standup_issue_states (
              fingerprint, identity_json, lifecycle, first_observed_at,
              last_observed_at, first_report_id, resolved_in_report_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              s.identity.fingerprint,
              JSON.stringify(s.identity),
              s.lifecycle,
              s.firstObservedAt,
              s.lastObservedAt,
              s.firstReportId ?? null,
              s.resolvedInReportId ?? null,
            ],
          );
        }
      });
    },
  };
}
