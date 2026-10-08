// The day on the Today screen: what is planned (calendar and timetable, one
// list), what needs the owner (reminders, ObjectOS and Autopilot, one list),
// the open TODOs behind the number in the hero, and earlier Standups.
//
// Read-only. Each card loads through the bridge it is given and renders
// nothing extra when a source is not there.

import React, { useEffect, useState } from "react";
import type { StandupReport } from "@dexnest/dev-intelligence-contracts";
import type { AttentionView } from "@dexnest/object-os";
import type { TodayAgenda } from "@dexnest/today";
import { AlertTriangle, Bell, CalendarDays, CheckCircle2, Clock, History, ListTodo } from "lucide-react";
import { Badge, Button, Card, EmptyNote, InlineError, ListRow, SectionTitle } from "../components/ui/kit";
import { useOutsideAi } from "./outsideAiUse";
import "./OutsideAi.css";
import {
  dayLine,
  dayRows,
  earlierStandups,
  needsYou,
  resolvedSince,
  todoGroups,
  todoPlace,
  type AutopilotAttention,
  type ObjectAttention,
  type OpenTodo
} from "./todayDayModel";

export interface TodayDayBridge {
  getTodayAgenda?(): Promise<TodayAgenda>;
  objectOsAttention(): Promise<AttentionView>;
  autopilotAttention?(): Promise<AutopilotAttention>;
  devIntelligenceTodos?(): Promise<OpenTodo[]>;
  standupList?(limit?: number): Promise<StandupReport[]>;
}

export interface DayData {
  agenda: TodayAgenda | null;
  objects: ObjectAttention | null;
  autopilot: AutopilotAttention | null;
  todos: OpenTodo[];
  standups: StandupReport[];
}

const EMPTY: DayData = { agenda: null, objects: null, autopilot: null, todos: [], standups: [] };
const TONE = { error: "error", warning: "warning", info: "accent" } as const;
const OPEN: Record<"calendar" | "object" | "autopilot", string> = { calendar: "calendar.open", object: "object_os.open", autopilot: "autopilot.open" };

/** Reads the day's sources; one that fails or is missing is simply empty. */
export function useDay(bridge: TodayDayBridge, refreshKey: unknown, initial?: Partial<DayData>): DayData {
  const [data, setData] = useState<DayData>({ ...EMPTY, ...initial });
  useEffect(() => {
    if (initial) return;
    let live = true;
    const safe = <T,>(call: (() => Promise<T>) | undefined, fallback: T) => (call ? call().catch(() => fallback) : Promise.resolve(fallback));
    Promise.all([
      safe(bridge.getTodayAgenda?.bind(bridge), null),
      safe(bridge.objectOsAttention?.bind(bridge), null),
      safe(bridge.autopilotAttention?.bind(bridge), null),
      safe(bridge.devIntelligenceTodos?.bind(bridge), [] as OpenTodo[]),
      safe(bridge.standupList ? () => bridge.standupList!(8) : undefined, [] as StandupReport[])
    ]).then(([agenda, objects, autopilot, todos, standups]) => {
      if (live) setData({ agenda, objects, autopilot, todos, standups });
    });
    return () => {
      live = false;
    };
  }, [bridge, refreshKey, initial]);
  return data;
}

/** Planned today, and what needs you: side by side above the Standup. */
export function DayCards({ day, open }: { day: DayData; open(actionId: string): void }) {
  const rows = dayRows(day.agenda);
  const needs = needsYou(day);
  return (
    <div className="today-day">
      <Card aria-labelledby="today-day-title">
        <SectionTitle id="today-day-title" action={<Button size="sm" variant="ghost" onClick={() => open("calendar.open")}>Calendar</Button>}>Your day</SectionTitle>
        <p className="today-note">{dayLine(day.agenda)}</p>
        {rows.length > 0 && (
          <div className="today-rows">
            {rows.slice(0, 8).map((row) => (
              <ListRow
                key={row.id}
                icon={row.done ? <CheckCircle2 /> : row.kind === "event" ? <CalendarDays /> : <Clock />}
                tone={row.done ? "success" : row.kind === "event" ? "accent" : "neutral"}
                title={row.title}
                meta={row.meta}
                trailing={<span className="technical">{row.time}</span>}
              />
            ))}
          </div>
        )}
        {rows.length > 8 && <EmptyNote>and {rows.length - 8} more in Calendar and Timetable.</EmptyNote>}
      </Card>

      <Card aria-labelledby="today-needs-title">
        <SectionTitle id="today-needs-title" count={needs.length} action={<Button size="sm" variant="ghost" onClick={() => open("audit.open_history")}>Activity log</Button>}>Needs you</SectionTitle>
        {needs.length === 0 ? (
          <EmptyNote>Nothing is waiting on you: no reminders due, no maintenance overdue, no Autopilot run asking.</EmptyNote>
        ) : (
          <div className="today-rows">
            {needs.slice(0, 8).map((item) => (
              <ListRow
                key={item.id}
                icon={item.source === "Reminder" ? <Bell /> : <AlertTriangle />}
                tone={TONE[item.tone]}
                title={item.title}
                meta={item.detail}
                trailing={<Badge tone={TONE[item.tone]}>{item.source}</Badge>}
                onClick={() => open(OPEN[item.view])}
              />
            ))}
          </div>
        )}
        {needs.length > 8 && <EmptyNote>and {needs.length - 8} more.</EmptyNote>}
      </Card>
    </div>
  );
}

/** The open TODOs the hero counts, by project, each with where it is. */
export function TodoCard({ todos, nameOf }: { todos: readonly OpenTodo[]; nameOf(repositoryId: string): string }) {
  const groups = todoGroups(todos, nameOf);
  if (groups.length === 0) return null;
  return (
    <Card aria-labelledby="today-todos">
      <SectionTitle id="today-todos" count={todos.length}>Open TODOs</SectionTitle>
      {groups.map((group) => <TodoGroupRows key={group.repositoryId} group={group} />)}
    </Card>
  );
}

const todoKey = (filePath: string, line: number | null | undefined): string => `${filePath}:${line ?? ""}`;

/** One project's open TODOs. With Outside AI switched on for it, a button asks which of them are real tasks. */
function TodoGroupRows({ group }: { group: ReturnType<typeof todoGroups>[number] }) {
  const ai = useOutsideAi<{ checked?: number; notReal?: { filePath: string; line: number | null }[] }>("todos", "outside_ai.check_todos");
  const [verdict, setVerdict] = useState<{ checked: number; notReal: Set<string> } | null>(null);
  return (
    <details className="today-todos">
      <summary>
        <ListTodo aria-hidden="true" /> {group.name} <span className="technical">{group.todos.length}</span>
      </summary>
      {ai.on && (
        <div className="outside-ai-row">
          <Button
            size="sm"
            disabled={ai.busy}
            onClick={() => void ai.ask({ repositoryId: group.repositoryId }).then((result) => {
              if (result) setVerdict({ checked: result.checked ?? 0, notReal: new Set((result.notReal ?? []).map((todo) => todoKey(todo.filePath, todo.line))) });
            })}
          >
            {ai.busy ? "Checking…" : "Check which are real"}
          </Button>
          <span className="today-note">Sends the words of up to 25 of these comments to Outside AI, not the files they are in.</span>
        </div>
      )}
      {ai.error && <InlineError>{ai.error}</InlineError>}
      {verdict && !ai.error && (
        <p className="today-note" role="status">
          Outside AI read {verdict.checked} and marked {verdict.notReal.size} as probably not a task. Nothing was changed; it can be wrong.
        </p>
      )}
      <ul>
        {group.todos.slice(0, 50).map((todo, i) => (
          <li key={`${todo.filePath}:${todo.line ?? i}:${i}`}>
            <span className="technical today-todos__place">{todoPlace(todo)}</span>
            <span>
              {todo.text || todo.kind}
              {verdict?.notReal.has(todoKey(todo.filePath, todo.line)) && <span className="outside-ai-tag">probably not a task</span>}
            </span>
          </li>
        ))}
        {group.todos.length > 50 && <li className="today-note">and {group.todos.length - 50} more in this project.</li>}
      </ul>
    </details>
  );
}

/** What was put right since the last Standup, and the Standups before this one. */
export function HistoryCard({ report, standups }: { report: StandupReport | null; standups: readonly StandupReport[] }) {
  const resolved = resolvedSince(report);
  const earlier = earlierStandups(standups, report?.id ?? null);
  if (resolved.length === 0 && earlier.length === 0) return null;
  return (
    <Card aria-labelledby="today-history">
      <SectionTitle id="today-history">History</SectionTitle>
      {resolved.length > 0 && (
        <div className="today-rows">
          {resolved.map((item) => (
            <ListRow key={item.id} icon={<CheckCircle2 />} tone="success" title={item.title} meta={item.summary} />
          ))}
        </div>
      )}
      {earlier.length > 0 && (
        <>
          <p className="today-note">Earlier Standups</p>
          <div className="today-rows">
            {earlier.slice(0, 7).map((s) => (
              <ListRow key={s.id} icon={<History />} tone="neutral" title={s.when} meta={s.line} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
