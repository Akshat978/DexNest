/**
 * Standup activity window resolution.
 *
 * Anchoring choice for `since_last_standup`:
 *   from = previous successful report's `timeWindow.to` (NOT generatedAt).
 *   That way the covered activity range is contiguous and missed days are
 *   included in the next successful report's window (full gap span).
 *
 * Timestamps stored as ISO-8601 UTC (`Date.toISOString()`).
 * Calendar "today" uses Intl.DateTimeFormat with the configured IANA zone
 * (no external timezone library).
 */

import type {
  GenerateStandupInput,
  StandupReport,
  StandupTimeWindow,
  StandupWindowKind,
} from '@dexnest/dev-intelligence-contracts';

export interface WindowClock {
  now(): Date;
}

export interface WindowTimezone {
  getTimezone(): string;
}

export interface ResolveWindowContext {
  readonly now: Date;
  readonly timezone: string;
  readonly latestSuccessfulReport: StandupReport | null;
}

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

/** Parts of a calendar date in an IANA timezone. */
export function zonedYmd(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value;
    if (!v) throw new Error(`Intl missing ${type} for zone ${timeZone}`);
    return Number.parseInt(v, 10);
  };
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Offset (ms) of `timeZone` relative to UTC at the given instant.
 * Positive means zone is ahead of UTC (e.g. +3600000 for UTC+1).
 */
export function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value;
    if (v === undefined) throw new Error(`Intl missing ${type}`);
    return Number.parseInt(v, 10);
  };
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * UTC instant of local midnight (00:00:00.000) on the calendar day of `instant`
 * in `timeZone`. Correct across DST transitions via iterative offset resolve.
 */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const { year, month, day } = zonedYmd(instant, timeZone);
  // First guess: treat Y-M-D as UTC midnight, then correct by zone offset.
  let guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const offset = timezoneOffsetMs(new Date(guess), timeZone);
    const next = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Local calendar date string YYYY-MM-DD in the given IANA zone. */
export function localDateString(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedYmd(instant, timeZone);
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function assertValidIso(label: string, value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${label} timestamp: ${value}`);
  }
  return d;
}

/**
 * Resolve the activity window for a generation request.
 */
export function resolveWindow(
  input: GenerateStandupInput,
  ctx: ResolveWindowContext,
): StandupTimeWindow {
  const kind: StandupWindowKind = input.window?.kind ?? 'since_last_standup';
  const timezone = input.window?.timezone ?? ctx.timezone;
  const to = ctx.now;
  const toIso = to.toISOString();

  if (kind === 'custom') {
    const fromRaw = input.window?.from;
    const toRaw = input.window?.to;
    if (!fromRaw || !toRaw) {
      throw new Error(
        'custom window requires both window.from and window.to (ISO-8601 UTC)',
      );
    }
    const fromDate = assertValidIso('window.from', fromRaw);
    const toDate = assertValidIso('window.to', toRaw);
    if (!(fromDate.getTime() < toDate.getTime())) {
      throw new Error(
        `custom window requires from < to (got from=${fromRaw}, to=${toRaw})`,
      );
    }
    return {
      kind,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      timezone,
    };
  }

  if (kind === 'today') {
    const from = startOfLocalDay(to, timezone);
    return {
      kind,
      from: from.toISOString(),
      to: toIso,
      timezone,
    };
  }

  if (kind === 'last_24_hours') {
    return {
      kind,
      from: new Date(to.getTime() - MS_DAY).toISOString(),
      to: toIso,
      timezone,
    };
  }

  if (kind === 'last_3_days') {
    return {
      kind,
      from: new Date(to.getTime() - 3 * MS_DAY).toISOString(),
      to: toIso,
      timezone,
    };
  }

  // since_last_standup (default)
  const prev = ctx.latestSuccessfulReport;
  if (!prev) {
    // First run: 24h lookback
    return {
      kind: 'since_last_standup',
      from: new Date(to.getTime() - MS_DAY).toISOString(),
      to: toIso,
      timezone,
    };
  }

  // Anchor at previous report's timeWindow.to (documented choice).
  return {
    kind: 'since_last_standup',
    from: prev.timeWindow.to,
    to: toIso,
    timezone,
  };
}

/** Deterministic scheduled occurrence id for a local calendar slot. */
export function scheduledOccurrenceId(
  now: Date,
  timezone: string,
  windowKind: StandupWindowKind,
): string {
  return `standup:${localDateString(now, timezone)}:${windowKind}`;
}
