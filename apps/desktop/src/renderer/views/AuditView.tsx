import React from "react";
import { formatLocalDateTime } from "@dexnest/shared-types";
import { PageHeader, LimitedList } from "../components/shared";
import type { EventEntry } from "../main";

export function AuditView({
  events,
  onRefresh,
  refreshEvents
}: {
  events: EventEntry[];
  onRefresh: (actionId: string) => Promise<void>;
  refreshEvents: () => Promise<void>;
}) {
  async function refresh(): Promise<void> {
    await onRefresh("audit.open_history");
    await refreshEvents();
  }

  return (
    <section className="view-stack" aria-labelledby="audit-title">
      <PageHeader
        eyebrow="SQLite event log"
        title="Recent Events"
        titleId="audit-title"
        actions={(
          <button type="button" onClick={() => void refresh()}>
          Refresh
          </button>
        )}
      />

      <div className="event-list">
        {events.length === 0 ? (
          <p className="empty-state">No events yet. Run an action to populate Audit.</p>
        ) : (
          <LimitedList items={events} step={50}>
            {(event) => (
              <article className="event-row" key={event.id}>
                <p className="technical">{formatLocalDateTime(event.timestamp)}</p>
                <p>{event.module}</p>
                <p className="technical">{event.actionId ?? "none"}</p>
                <p>{event.status}</p>
                <p>{event.source}</p>
                <p>{event.summary}</p>
              </article>
            )}
          </LimitedList>
        )}
      </div>
    </section>
  );
}
