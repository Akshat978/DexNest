/**
 * StandupService implementation — idempotent generate / get / list.
 *
 * Manual regeneration policy (documented):
 *   Manual reports DO advance lifecycle and count as latestSuccessfulReport.
 *   They use a distinct occurrenceId so they never collide with a scheduled slot.
 *   This keeps since_last_standup contiguous with the last successful generation
 *   of either kind.
 *
 * Scheduled idempotency:
 *   Same (occurrenceId, scheduled) → return existing report; no lifecycle mutation.
 *   Concurrent duplicate calls coalesce via an in-flight Promise map.
 */

import type {
  GenerateStandupInput,
  GetStandupReportInput,
  ListStandupReportsQuery,
  ListStandupReportsResult,
  PersistencePorts,
  StandupReport,
  StandupService,
  StandupStore,
  StandupTriggerKind,
  StandupWindowKind,
} from '@dexnest/dev-intelligence-contracts';
import { collectFacts } from './facts.js';
import { detectOpenIssues, transitionLifecycle } from './lifecycle.js';
import {
  buildSections,
  STANDUP_SCHEMA_VERSION,
} from './sections.js';
import {
  resolveWindow,
  scheduledOccurrenceId,
} from './windows.js';

export interface StandupClock {
  now(): Date;
}

export interface StandupTimezone {
  getTimezone(): string;
}

export interface CreateStandupServiceOptions {
  readonly persistence: PersistencePorts;
  readonly standupStore: StandupStore;
  readonly clock?: StandupClock;
  readonly timezone?: StandupTimezone | string;
  /**
   * Optional nonce factory for manual occurrence ids (tests inject a counter).
   * Default: incrementing counter + generatedAt.
   */
  readonly manualNonce?: () => string;
}

function resolveTimezone(
  timezone: CreateStandupServiceOptions['timezone'],
): string {
  if (!timezone) return 'UTC';
  if (typeof timezone === 'string') return timezone;
  return timezone.getTimezone();
}

let defaultManualCounter = 0;

function newReportId(generatedAt: string, occurrenceId: string): string {
  // Deterministic-ish id from occurrence + generatedAt (sufficient for tests;
  // collisions across distinct occurrences are fine to avoid).
  const raw = `${occurrenceId}|${generatedAt}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `standup_rpt_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createStandupService(
  options: CreateStandupServiceOptions,
): StandupService {
  const clock: StandupClock = options.clock ?? { now: () => new Date() };
  const getTz = () => resolveTimezone(options.timezone);
  const manualNonce =
    options.manualNonce ??
    (() => {
      defaultManualCounter += 1;
      return String(defaultManualCounter);
    });

  const inFlight = new Map<string, Promise<StandupReport>>();

  async function generateFresh(
    input: GenerateStandupInput,
    triggerKind: StandupTriggerKind,
    occurrenceId: string,
  ): Promise<StandupReport> {
    const now = clock.now();
    const timezone = getTz();
    const latest =
      await options.standupStore.getLatestSuccessfulReport();

    const timeWindow = resolveWindow(input, {
      now,
      timezone,
      latestSuccessfulReport: latest,
    });

    const generatedAt = now.toISOString();
    const reportId = newReportId(generatedAt, occurrenceId);

    const facts = await collectFacts(
      options.persistence,
      timeWindow,
      input.repositoryIds,
    );

    const previousOpen = await options.standupStore.getIssueStates();
    const observed = detectOpenIssues(facts.repositories, generatedAt);
    const lifecycle = transitionLifecycle(
      observed,
      previousOpen,
      reportId,
      generatedAt,
    );

    const prevSummary = latest
      ? `Previous window ${latest.timeWindow.kind} [${latest.timeWindow.from} → ${latest.timeWindow.to}]`
      : undefined;

    const built = buildSections({
      reportId,
      window: timeWindow,
      repos: facts.repositories,
      lifecycle,
      previousReportId: latest?.id,
      previousWindowSummary: prevSummary,
      generatedAt,
    });

    const report: StandupReport = {
      id: reportId,
      occurrenceId,
      triggerKind,
      idempotencyKey: {
        occurrenceId,
        triggerKind,
      },
      generatedAt,
      timeWindow,
      schemaVersion: STANDUP_SCHEMA_VERSION,
      sections: built.sections,
      items: built.items,
      continuationCandidates: built.continuationCandidates,
      issueStates: [
        ...lifecycle.openStates,
        ...lifecycle.announcements
          .filter((a) => a.lifecycle === 'RESOLVED')
          .map((a) => a.state),
      ],
      previousSuccessfulReportId: latest?.id,
      diagnostics: {
        repositoryCount: facts.repositories.length,
        partialFailureCount: facts.repositories.filter((r) => !r.ok).length,
        openIssueCount: lifecycle.openStates.length,
        windowKind: timeWindow.kind,
      },
    };

    // Persist report first (idempotent on occurrence). If a concurrent writer
    // won, return their report and skip lifecycle mutation.
    const saved = await options.standupStore.saveReport(report);
    if (saved.id !== report.id) {
      return saved;
    }

    // Only the winning writer advances lifecycle.
    await options.standupStore.upsertIssueStates(lifecycle.openStates);
    return saved;
  }

  return {
    async generateStandup(input: GenerateStandupInput): Promise<StandupReport> {
      const triggerKind: StandupTriggerKind =
        input.triggerKind ??
        input.idempotencyKey?.triggerKind ??
        'manual';

      const now = clock.now();
      const timezone = getTz();
      const windowKind: StandupWindowKind =
        input.window?.kind ?? 'since_last_standup';

      let occurrenceId =
        input.occurrenceId ??
        input.idempotencyKey?.occurrenceId ??
        undefined;

      if (triggerKind === 'scheduled') {
        if (!occurrenceId) {
          occurrenceId = scheduledOccurrenceId(now, timezone, windowKind);
        }

        const existing = await options.standupStore.findByOccurrence(
          occurrenceId,
          'scheduled',
        );
        if (existing) return existing;

        const flightKey = `scheduled:${occurrenceId}`;
        const pending = inFlight.get(flightKey);
        if (pending) return pending;

        const promise = generateFresh(input, 'scheduled', occurrenceId).finally(
          () => {
            inFlight.delete(flightKey);
          },
        );
        inFlight.set(flightKey, promise);
        return promise;
      }

      // manual
      if (!occurrenceId || input.forceNewOccurrence) {
        occurrenceId = `manual:${now.toISOString()}:${manualNonce()}`;
      }

      const flightKey = `manual:${occurrenceId}`;
      const pending = inFlight.get(flightKey);
      if (pending) return pending;

      const promise = generateFresh(input, 'manual', occurrenceId).finally(
        () => {
          inFlight.delete(flightKey);
        },
      );
      inFlight.set(flightKey, promise);
      return promise;
    },

    async getStandupReport(
      input: GetStandupReportInput,
    ): Promise<StandupReport | null> {
      return options.standupStore.getReport(input.id);
    },

    async listStandupReports(
      query: ListStandupReportsQuery,
    ): Promise<ListStandupReportsResult> {
      return options.standupStore.listReports(query);
    },
  };
}

/** Helper re-export for tests / callers building scheduled keys. */
export { localDateString, scheduledOccurrenceId } from './windows.js';
