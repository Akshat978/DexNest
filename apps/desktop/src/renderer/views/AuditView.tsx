import React, { useCallback, useEffect, useState } from "react";
import { formatLocalDateTime } from "@dexnest/shared-types";
import { ScrollText } from "lucide-react";
import { LimitedList } from "../components/shared";
import { Button, EmptyNote, InlineError, PageHeader } from "../components/ui/kit";
import { idParts } from "../lib/idParts";
import { activityLine, STREAMS, type ActivityRow } from "../lib/activityLabels";

export interface ActivityBridge {
  listActivity(query: { stream?: string; limit?: number }): Promise<ActivityRow[]>;
}

/**
 * Everything DexNest recorded, newest first: the actions people ran (the
 * audit stream) and what each module wrote to its own stream - commits the
 * scan saw, project operations, XP, objects. One name per module.
 */
export function AuditView({
  bridge,
  onRefresh,
  initial
}: {
  bridge: ActivityBridge;
  onRefresh: (actionId: string) => Promise<void>;
  /** Tests only: start from known rows instead of loading. */
  initial?: { rows: ActivityRow[]; stream?: string };
}) {
  const [stream, setStream] = useState(initial?.stream ?? "");
  const [rows, setRows] = useState<ActivityRow[]>(initial?.rows ?? []);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (which: string) => {
      try {
        setRows(await bridge.listActivity({ ...(which ? { stream: which } : {}), limit: 400 }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The activity log could not be read.");
      }
    },
    [bridge]
  );

  useEffect(() => {
    if (initial === undefined) void load(stream);
  }, [initial, load, stream]);

  async function refresh(): Promise<void> {
    await onRefresh("audit.open_history");
    await load(stream);
  }

  const lines = rows.map(activityLine);

  return (
    <section className="view-stack" aria-labelledby="audit-title">
      <PageHeader
        icon={<ScrollText />}
        title="Activity log"
        titleId="audit-title"
        subtitle="What DexNest did and what its modules recorded, newest first"
        accent="command"
        actions={<Button onClick={() => void refresh()}>Refresh</Button>}
      />

      <div className="audit-streams" role="group" aria-label="Show">
        {STREAMS.map((s) => (
          <button key={s.id || "all"} type="button" className="audit-stream" aria-pressed={stream === s.id} onClick={() => setStream(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {error && <InlineError>{error}</InlineError>}

      <div className="event-list audit-list">
        {lines.length === 0 ? (
          <EmptyNote>{stream ? "Nothing recorded here yet." : "No events yet. Run an action to populate the log."}</EmptyNote>
        ) : (
          <LimitedList items={lines} step={50}>
            {(event) => (
              <article className="event-row" key={event.id}>
                <p className="technical">{formatLocalDateTime(event.at)}</p>
                <p>{event.module}</p>
                <p className="technical">
                  {idParts(event.what).map((part, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <wbr />}
                      {part}
                    </React.Fragment>
                  ))}
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
