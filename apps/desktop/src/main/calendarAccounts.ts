// Connected calendar accounts, and the events they bring.
//
// WHERE THE PROVIDER STOPS
//
// Google and Microsoft return entirely different payloads, and both are large.
// This file is the only place either vocabulary exists. Everything downstream
// receives the same normalised event, which is what makes @dexnest/today's
// promise real rather than aspirational — a promise kept by a type is kept
// only until someone spreads a provider object into it.
//
// SYNCED EVENTS ARE NOT LOCAL EVENTS
//
// They live in their own file and are never merged into the operator's own
// calendar. Two reasons. A synced event is owned by the provider, so editing
// it here would produce a change that the next sync silently reverts. And
// disconnecting an account has to remove exactly what that account brought,
// which is a delete by accountId rather than an archaeology problem.
//
// TOKENS
//
// Refresh tokens go in the existing integration keychain — Electron
// safeStorage, DPAPI on Windows — which is where DexNest already keeps
// credentials it must be able to read at startup without a vault unlock. They
// are never written to the accounts file, never logged, and never returned to
// the renderer.

import type { EventInput } from "@dexnest/today";

export type CalendarProviderId = "google" | "microsoft";

export interface CalendarAccount {
  id: string;
  provider: CalendarProviderId;
  /** What the operator recognises: their address on that provider. */
  email: string;
  connectedAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
  /** How many events the last sync brought, for the settings row. */
  eventCount: number;
  enabled: boolean;
  /**
   * The scopes the provider actually granted, as it reported them.
   *
   * What DexNest asked for and what it holds are different things: a consent
   * screen can be half-approved, and an account connected before writing
   * existed holds a read-only token no matter what the current code requests.
   * Absent means an account from before this was recorded, which is exactly
   * the read-only case.
   */
  grantedScopes?: string[];
}

/** An event as DexNest stores it, from any provider. */
export interface SyncedEvent extends EventInput {
  accountId: string;
  /**
   * The provider's cross-account identity for this event.
   *
   * Both providers issue one, and it is the same value in both when the same
   * meeting reaches two accounts — which is exactly the case that would
   * otherwise show a person their 3pm twice.
   */
  uid: string | null;
}

/**
 * One window's worth of events, and whether that window is all of them.
 *
 * complete matters because absence is about to mean deletion. A provider that
 * returned only the first page looks exactly like one whose later events were
 * deleted, and acting on that would remove local events for the crime of being
 * the 251st thing in a busy month.
 */
export interface FetchedEvents {
  events: SyncedEvent[];
  complete: boolean;
}

export interface ProviderConfig {
  clientId: string;
  clientSecret?: string | null;
}

export const PROVIDERS: Record<CalendarProviderId, {
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
  needsSecret: boolean;
}> = {
  google: {
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // calendar.events, not the broader calendar scope: it covers reading and
    // writing events, which is all DexNest does, and leaves calendar creation,
    // deletion and sharing settings out of what is being asked for.
    //
    // This is a wider grant than DexNest used to request, so an account
    // connected before this change holds a read-only token and has to be
    // reconnected. That is handled rather than assumed - see accountCanWrite.
    scopes: ["https://www.googleapis.com/auth/calendar.events", "openid", "email"],
    extraAuthParams: {
      // Without offline access Google issues no refresh token and the account
      // disconnects itself an hour later.
      access_type: "offline",
      // Forces the consent screen even on a re-connect, which is the only way
      // to get a replacement refresh token if the first was lost.
      prompt: "consent"
    },
    needsSecret: true
  },
  microsoft: {
    label: "Outlook",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Read-only, deliberately. Outlook writes need Calendars.ReadWrite and a
    // different event shape on Graph; until that is built, asking for write
    // permission DexNest cannot use would be taking access for nothing.
    scopes: ["https://graph.microsoft.com/Calendars.Read", "offline_access", "openid", "email"],
    needsSecret: false
  }
};

// --- fetching, per provider --------------------------------------------------

async function getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // 401 is meaningful to the caller — it means re-authorise, not retry — so
    // it is preserved in the message rather than flattened into "failed".
    throw new Error(`${response.status}: ${body.slice(0, 200)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export const whoAmI = {
  async google(accessToken: string): Promise<string> {
    const data = await getJson("https://www.googleapis.com/oauth2/v3/userinfo", accessToken);
    return String(data.email ?? "a Google account");
  },
  async microsoft(accessToken: string): Promise<string> {
    const data = await getJson("https://graph.microsoft.com/v1.0/me", accessToken);
    return String(data.mail ?? data.userPrincipalName ?? "an Outlook account");
  }
};

/** The local date a window covers, YYYY-MM-DD. */
const isoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Local "HH:MM" from a Date. */
const localClock = (at: Date): string =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

/** Local "HH:MM" from a provider's instant. */
function localTime(value: string | undefined | null): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return null;
  return localClock(at);
}

/**
 * Fetches a window of events and normalises them.
 *
 * A window rather than a sync token. Incremental sync is the right answer for
 * a client that mirrors an entire calendar; DexNest shows the next few days,
 * so asking for the next few days is both simpler and self-healing — a missed
 * push, a deleted event, a token that expired all resolve themselves on the
 * following poll instead of needing reconciliation.
 */
export const fetchEvents = {
  async google(accessToken: string, accountId: string, days: number): Promise<FetchedEvents> {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + days * 86400000);

    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      // Expands recurring events into their instances, so a weekly standup
      // arrives as the actual occurrences rather than as a rule to interpret.
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250"
    });
    const data = await getJson(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      accessToken
    );

    const events = ((data.items as Array<Record<string, unknown>>) ?? [])
      .filter(item => item.status !== "cancelled")
      .map(item => {
        const start = item.start as { date?: string; dateTime?: string } | undefined;
        const end = item.end as { date?: string; dateTime?: string } | undefined;
        const allDay = Boolean(start?.date);
        return {
          id: `google:${accountId}:${String(item.id)}`,
          accountId,
          uid: item.iCalUID ? String(item.iCalUID) : null,
          title: String(item.summary ?? "(no title)"),
          date: allDay ? String(start?.date) : isoDate(new Date(String(start?.dateTime))),
          startTime: allDay ? null : localTime(start?.dateTime),
          endTime: allDay ? null : localTime(end?.dateTime),
          allDay,
          sourceModule: "google",
          notes: item.location ? String(item.location) : null,
          color: null
        } satisfies SyncedEvent;
      })
      .filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date));

    // A page token means Google had more to give. Not paginated through, since
    // 250 events in the window is already far past what this is for - but it
    // is recorded, so nothing downstream mistakes a cut-off list for a short one.
    return { events, complete: !data.nextPageToken };
  },

  async microsoft(accessToken: string, accountId: string, days: number): Promise<FetchedEvents> {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + days * 86400000);

    // calendarView, not /events: it expands recurrences the way Google's
    // singleEvents does. /events returns the series master and leaves the
    // expansion as an exercise.
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $top: "250",
      $orderby: "start/dateTime"
    });
    const data = await getJson(
      `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`,
      accessToken
    );

    const events = ((data.value as Array<Record<string, unknown>>) ?? [])
      .filter(item => !item.isCancelled)
      .map(item => {
        const start = item.start as { dateTime?: string; timeZone?: string } | undefined;
        const end = item.end as { dateTime?: string; timeZone?: string } | undefined;
        const allDay = Boolean(item.isAllDay);
        // Graph returns a naive datetime string plus the zone in a sibling
        // field, and without a Prefer: outlook.timezone header that zone is
        // UTC. So appending Z is correct — it names the instant — and the
        // local parts are then read off it below.
        const startAt = start?.dateTime ? new Date(`${start.dateTime}Z`) : null;
        const endAt = end?.dateTime ? new Date(`${end.dateTime}Z`) : null;
        const location = (item.location as { displayName?: string } | undefined)?.displayName;

        return {
          id: `microsoft:${accountId}:${String(item.id)}`,
          accountId,
          uid: item.iCalUId ? String(item.iCalUId) : null,
          title: String(item.subject ?? "(no title)"),
          date: startAt ? isoDate(startAt) : "",
          // Local getters, matching isoDate above. Reading UTC parts here while
          // the date came from local ones put a 3pm meeting on screen at 21:00
          // for anyone not on UTC, and made the time disagree with its own date
          // across midnight.
          startTime: allDay || !startAt ? null : localClock(startAt),
          endTime: allDay || !endAt ? null : localClock(endAt),
          allDay,
          sourceModule: "outlook",
          notes: location ? String(location) : null,
          color: null
        } satisfies SyncedEvent;
      })
      .filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date));

    // Graph signals more pages with @odata.nextLink, the same way Google uses
    // a page token.
    return { events, complete: !data["@odata.nextLink"] };
  }
};

/**
 * Removes the same meeting arriving through more than one account.
 *
 * Keyed on the provider's own UID, which is stable across accounts and across
 * providers for an invitation sent to both. Falling back to title-and-time
 * would merge two genuinely different 3pm calls with the same name, so events
 * without a UID are always kept.
 */
/** Scopes that let DexNest write events to a Google calendar. */
const GOOGLE_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar"
];

/**
 * Whether DexNest can change this account's events.
 *
 * Answered from what the provider granted, never from what the current build
 * requests. Those two agree only for an account connected since the request
 * changed, and the gap between them is precisely the case this exists for: an
 * older account whose stored token is read-only while the code around it has
 * moved on. Getting this wrong in the optimistic direction means offering an
 * Edit button that fails at the API.
 *
 * Outlook is false regardless. Its write path is not built, so a granted
 * scope would not make one appear.
 */
export function accountCanWrite(account: Pick<CalendarAccount, "provider" | "grantedScopes">): boolean {
  if (account.provider !== "google") return false;
  const granted = account.grantedScopes ?? [];
  return granted.some(scope => GOOGLE_WRITE_SCOPES.includes(scope));
}

/**
 * The scopes a token response reported, or null when it reported none.
 *
 * Null and empty are different answers and must not collapse: a refresh that
 * omits `scope` says nothing about the grant, while an empty grant would say
 * everything. Callers keep what they had on null.
 */
export function parseGrantedScopes(scope: string | null | undefined): string[] | null {
  if (typeof scope !== "string") return null;
  const parts = scope.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts : null;
}


// --- writing back to Google ---------------------------------------------------

/** A DexNest event, in the shape the write path needs. */
export interface WritableEvent {
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
  notes?: string | null;
}

/**
 * A DexNest event as a Google Calendar resource.
 *
 * Kept apart from the request that sends it so the mapping can be checked
 * without a network or an account. Times are the awkward part: DexNest stores
 * a local date and a wall-clock time with no zone, and Google needs either an
 * all-day date pair or a pair of instants. Sending the wall clock with an
 * explicit timeZone lets Google resolve it, rather than this guessing an
 * offset and being an hour wrong twice a year.
 */
export function googleEventBody(event: WritableEvent, timeZone: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: event.title,
    // location, because that is where fetchEvents reads notes back from. A
    // round trip that put notes somewhere else would lose them on the next
    // sync, which is worse than never having sent them.
    location: event.notes ?? ""
  };

  if (event.allDay) {
    // Google's all-day end date is exclusive: a single-day event ends on the
    // following day. Sending the same date for both is rejected outright.
    body.start = { date: event.date };
    body.end = { date: addDays(event.date, 1) };
    return body;
  }

  const start = event.startTime || "09:00";
  // An event with a start and no end is a point in time to DexNest and an
  // error to Google. An hour is the assumption a calendar app makes.
  const end = event.endTime || addMinutes(start, 60);
  body.start = { dateTime: `${event.date}T${start}:00`, timeZone };
  body.end = {
    // An end at or before the start would be rejected. This happens for real:
    // 23:30 to 00:15 is a legal thing to want and cannot be expressed by a
    // DexNest event, which has no end date - so it is clamped rather than sent
    // and refused.
    dateTime: `${event.date}T${end <= start ? addMinutes(start, 60) : end}:00`,
    timeZone
  };
  return body;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return isoDate(parsed);
}

function addMinutes(time: string, minutes: number): string {
  const [hours = "0", mins = "0"] = time.split(":");
  const total = Number(hours) * 60 + Number(mins) + minutes;
  // Clamped rather than wrapped: an event pushed past midnight would land on
  // the wrong day, and 23:59 on the right day is the smaller lie.
  const capped = Math.min(total, 23 * 60 + 59);
  return `${String(Math.floor(capped / 60)).padStart(2, "0")}:${String(capped % 60).padStart(2, "0")}`;
}

async function sendJson(
  url: string,
  accessToken: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  // 404 and 410 on a delete mean the event is already gone. That is the
  // outcome that was asked for, so it is not an error to report.
  if (method === "DELETE" && (response.ok || response.status === 404 || response.status === 410)) {
    return {};
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status}: ${text.slice(0, 200)}`);
  }
  // A successful DELETE has no body; everything else does.
  return response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>);
}

const GOOGLE_EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export const writeEvents = {
  /** Creates the event and returns the id Google gave it. */
  async create(accessToken: string, event: WritableEvent, timeZone: string): Promise<string> {
    const created = await sendJson(GOOGLE_EVENTS, accessToken, "POST", googleEventBody(event, timeZone));
    const id = String(created.id ?? "").trim();
    if (!id) throw new Error("Google accepted the event but returned no id.");
    return id;
  },

  async update(accessToken: string, remoteId: string, event: WritableEvent, timeZone: string): Promise<void> {
    // PATCH rather than PUT: DexNest models a fraction of what a Google event
    // can hold, and a full replace would strip attendees, conferencing and
    // reminders that were set elsewhere.
    await sendJson(`${GOOGLE_EVENTS}/${encodeURIComponent(remoteId)}`, accessToken, "PATCH", googleEventBody(event, timeZone));
  },

  async remove(accessToken: string, remoteId: string): Promise<void> {
    await sendJson(`${GOOGLE_EVENTS}/${encodeURIComponent(remoteId)}`, accessToken, "DELETE");
  }
};

export function dedupe(events: readonly SyncedEvent[]): SyncedEvent[] {
  const seen = new Set<string>();
  const kept: SyncedEvent[] = [];
  for (const event of events) {
    if (!event.uid) { kept.push(event); continue; }
    const key = `${event.uid}|${event.date}|${event.startTime ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(event);
  }
  return kept;
}
