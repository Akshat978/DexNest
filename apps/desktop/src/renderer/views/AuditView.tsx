import React from "react";
import { formatLocalDateTime } from "@dexnest/shared-types";
import { ScrollText } from "lucide-react";
import { LimitedList } from "../components/shared";
import { Button, EmptyNote, PageHeader } from "../components/ui/kit";
import type { EventEntry } from "../main";
import { idParts } from "../lib/idParts";

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
        icon={<ScrollText />}
        title="Audit"
        titleId="audit-title"
        subtitle="Recent events from the SQLite event log"
        accent="command"
        actions={<Button onClick={() => void refresh()}>Refresh</Button>}
      />

      <div className="event-list audit-list">
        {events.length === 0 ? (
          <EmptyNote>No events yet. Run an action to populate Audit.</EmptyNote>
        ) : (
          <LimitedList items={events} step={50}>
            {(event) => (
              <article className="event-row" key={event.id}>
                <p className="technical">{formatLocalDateTime(event.timestamp)}</p>
                <p>{event.module}</p>
                <p className="technical">
                  {event.actionId
                    ? idParts(event.actionId).map((part, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <wbr />}
                          {part}
                        </React.Fragment>
                      ))
                    : "none"}
                </p>
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
