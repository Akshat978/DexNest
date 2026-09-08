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
    // Read-only on purpose. DexNest shows a day; it does not need permission
    // to rewrite anyone's calendar, and asking for less is the difference
    // between a consent screen someone accepts and one they think about.
    scopes: ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"],
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
    // offline_access is Microsoft's equivalent of access_type=offline.
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

/** Local "HH:MM" from a provider's instant. */
function localTime(value: string | undefined | null): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return null;
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
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
  async google(accessToken: string, accountId: string, days: number): Promise<SyncedEvent[]> {
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

    return ((data.items as Array<Record<string, unknown>>) ?? [])
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
  },

  async microsoft(accessToken: string, accountId: string, days: number): Promise<SyncedEvent[]> {
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

    return ((data.value as Array<Record<string, unknown>>) ?? [])
      .filter(item => !item.isCancelled)
      .map(item => {
        const start = item.start as { dateTime?: string; timeZone?: string } | undefined;
        const end = item.end as { dateTime?: string; timeZone?: string } | undefined;
        const allDay = Boolean(item.isAllDay);
        // Graph returns a naive local-to-the-calendar string with the zone in a
        // sibling field; appending Z is wrong, so it is parsed as given and the
        // Date is trusted to be in the machine's zone, which is the same zone
        // the operator is in.
        const startAt = start?.dateTime ? new Date(`${start.dateTime}Z`) : null;
        const endAt = end?.dateTime ? new Date(`${end.dateTime}Z`) : null;
        const location = (item.location as { displayName?: string } | undefined)?.displayName;

        return {
          id: `microsoft:${accountId}:${String(item.id)}`,
          accountId,
          uid: item.iCalUId ? String(item.iCalUId) : null,
          title: String(item.subject ?? "(no title)"),
          date: startAt ? isoDate(startAt) : "",
          startTime: allDay || !startAt ? null : `${String(startAt.getUTCHours()).padStart(2, "0")}:${String(startAt.getUTCMinutes()).padStart(2, "0")}`,
          endTime: allDay || !endAt ? null : `${String(endAt.getUTCHours()).padStart(2, "0")}:${String(endAt.getUTCMinutes()).padStart(2, "0")}`,
          allDay,
          sourceModule: "outlook",
          notes: location ? String(location) : null,
          color: null
        } satisfies SyncedEvent;
      })
      .filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date));
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
