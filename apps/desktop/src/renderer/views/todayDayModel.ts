// What the "day" part of Today decides, kept out of React so it can be tested:
// the one agenda (calendar, timetable, nudges) as rows, the single list of
// things that need the owner (nudges, ObjectOS, Autopilot), the open TODOs by
// project, and earlier Standups. No DOM, no bridge, no I/O.

import type { AgendaItem, TodayAgenda } from "@dexnest/today";
import type { StandupReport } from "@dexnest/dev-intelligence-contracts";
import { momentLabel } from "../lib/dates.ts";
import { sectionItems, sectionTotal } from "./todayModel.ts";

export interface DayRow {
  id: string;
  kind: "event" | "block";
  /** "09:00 – 10:30", "all day", or "any time". */
  time: string;
  title: string;
  /** Where it came from, and its state when it has one: "Timetable · done". */
  meta: string;
  done: boolean;
}

function timeText(item: Pick<AgendaItem, "allDay" | "startTime" | "endTime">): string {
  if (item.allDay) return "all day";
  if (!item.startTime) return "any time";
  return item.endTime ? `${item.startTime} – ${item.endTime}` : item.startTime;
}

/** The day's events and timetable blocks, in the agenda's own order. Nudges go to "needs you". */
export function dayRows(agenda: Pick<TodayAgenda, "items"> | null): DayRow[] {
  return (agenda?.items ?? [])
    .filter((item) => item.kind === "event" || item.kind === "block")
    .map((item) => ({
      id: item.id,
      kind: item.kind as "event" | "block",
      time: timeText(item),
      title: item.title,
      meta: [item.source.label, item.status && item.status !== "planned" ? item.status : null].filter(Boolean).join(" · "),
      done: item.status === "done"
    }));
}

/** "2 events and 5 blocks today", "Nothing planned today". */
export function dayLine(agenda: Pick<TodayAgenda, "counts"> | null): string {
  const events = agenda?.counts.events ?? 0;
  const blocks = agenda?.counts.blocks ?? 0;
  if (events + blocks === 0) return "Nothing planned today";
  const parts = [events > 0 ? `${events} ${events === 1 ? "event" : "events"}` : "", blocks > 0 ? `${blocks} timetable ${blocks === 1 ? "block" : "blocks"}` : ""].filter(Boolean);
  return `${parts.join(" and ")} today`;
}

export type NeedsTone = "error" | "warning" | "info";

export interface NeedsYouItem {
  id: string;
  title: string;
  detail: string;
  /** Who is asking: "Reminder", "ObjectOS", "Autopilot". */
  source: string;
  /** The view that deals with it. */
  view: "calendar" | "object" | "autopilot";
  tone: NeedsTone;
}

/** ObjectOS's attention, as the view already has it (names are for the owner's own screen). */
export interface ObjectAttention {
  summary: {
    items: readonly (
      | { kind: "maintenance"; objectId: string; scheduleId: string; status: { state: string } }
      | { kind: "warranty"; objectId: string; state: string; daysLeft: number }
      | { kind: "stock"; partId: string; quantity: number; lowStockAt: number }
    )[];
  };
  names: Record<string, string>;
}

/** What Autopilot is waiting on. */
export interface AutopilotAttention {
  deliver?: readonly { id: string; title: string; detail: string; priority?: string }[];
  hold?: readonly { id: string; title: string; detail: string; priority?: string }[];
}

/**
 * One list of what needs the owner, from the three places that used to keep
 * their own: reminders and nudges, ObjectOS (maintenance, warranties, stock)
 * and Autopilot (a run waiting for an answer). Most pressing first.
 */
export function needsYou(input: { agenda: Pick<TodayAgenda, "items"> | null; objects: ObjectAttention | null; autopilot: AutopilotAttention | null }): NeedsYouItem[] {
  const out: NeedsYouItem[] = [];
  for (const item of input.autopilot?.deliver ?? []) {
    out.push({ id: `autopilot:${item.id}`, title: item.title, detail: item.detail, source: "Autopilot", view: "autopilot", tone: "error" });
  }
  for (const item of input.objects?.summary.items ?? []) {
    const names = input.objects?.names ?? {};
    if (item.kind === "maintenance") {
      const overdue = item.status.state === "overdue";
      out.push({
        id: `object:maintenance:${item.scheduleId}`,
        title: `${names[item.scheduleId] ?? "Maintenance"} ${overdue ? "is overdue" : "is due soon"}`,
        detail: names[item.objectId] ?? "",
        source: "ObjectOS",
        view: "object",
        tone: overdue ? "error" : "warning"
      });
    } else if (item.kind === "warranty") {
      out.push({
        id: `object:warranty:${item.objectId}`,
        title: item.daysLeft <= 0 ? "Warranty ends today" : `Warranty ends in ${item.daysLeft} ${item.daysLeft === 1 ? "day" : "days"}`,
        detail: names[item.objectId] ?? "",
        source: "ObjectOS",
        view: "object",
        tone: "warning"
      });
    } else {
      out.push({ id: `object:stock:${item.partId}`, title: `${names[item.partId] ?? "A part"} is low`, detail: `${item.quantity} left`, source: "ObjectOS", view: "object", tone: "info" });
    }
  }
  for (const item of input.agenda?.items ?? []) {
    if (item.kind !== "nudge" || !item.needsAction) continue;
    out.push({ id: item.id, title: item.title, detail: item.detail ?? "", source: "Reminder", view: "calendar", tone: "info" });
  }
  const rank: Record<NeedsTone, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** The bell's badge: "3", "9+", or nothing. */
export function bellBadge(count: number): string | null {
  return count <= 0 ? null : count > 9 ? "9+" : String(count);
}

export interface OpenTodo {
  repositoryId: string;
  kind: string;
  filePath: string;
  line?: number;
  text: string;
}

export interface TodoGroup {
  repositoryId: string;
  name: string;
  todos: OpenTodo[];
}

/** Open TODOs under the project they are in, the project with the most first; inside, by file and line. */
export function todoGroups(todos: readonly OpenTodo[], nameOf: (repositoryId: string) => string): TodoGroup[] {
  const groups = new Map<string, TodoGroup>();
  for (const todo of todos) {
    let group = groups.get(todo.repositoryId);
    if (!group) groups.set(todo.repositoryId, (group = { repositoryId: todo.repositoryId, name: nameOf(todo.repositoryId), todos: [] }));
    group.todos.push(todo);
  }
  for (const group of groups.values()) group.todos.sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0));
  return [...groups.values()].sort((a, b) => b.todos.length - a.todos.length || a.name.localeCompare(b.name));
}

/** "src/main.ts:42". */
export const todoPlace = (todo: Pick<OpenTodo, "filePath" | "line">): string => (todo.line ? `${todo.filePath}:${todo.line}` : todo.filePath);

export interface EarlierStandup {
  id: string;
  /** "3 Oct 2026, 09:00". */
  when: string;
  /** "12 changes · 2 need attention". */
  line: string;
}

/** Standups before the one on screen, newest first. */
export function earlierStandups(reports: readonly StandupReport[], currentId: string | null): EarlierStandup[] {
  return reports
    .filter((r) => r.id !== currentId)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .map((r) => {
      const changes = sectionTotal(r, "Changed");
      const attention = sectionTotal(r, "NeedsAttention");
      return {
        id: r.id,
        when: momentLabel(r.generatedAt),
        line: [`${changes} ${changes === 1 ? "change" : "changes"}`, attention > 0 ? `${attention} needed attention` : "nothing needed attention"].join(" · ")
      };
    });
}

/** What the last Standup says was put right since the one before: resolved issues, by their summary. */
export function resolvedSince(report: StandupReport | null): { id: string; title: string; summary: string }[] {
  if (!report) return [];
  return sectionItems(report, "History")
    .filter((item) => item.lifecycle === "RESOLVED")
    .map((item) => ({ id: item.id, title: item.title, summary: item.summary ?? "" }));
}
