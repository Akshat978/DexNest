/**
 * A day, written from what DexNest already watched.
 *
 * The heatmap knows which applications were in front. The timetable knows what
 * was planned and what got marked done. The Dev projects know their
 * repositories. Nothing joined the three, so the only account of a day was
 * whatever somebody remembered to type at the end of it.
 *
 * Pure: takes a gathered day and returns text. What the numbers are is the
 * main process's problem; what they add up to is this one's, and that is the
 * part worth being able to check.
 */

export interface WorklogInput {
  date: string;
  /** Seconds in front of each application, largest first is not assumed. */
  apps: Array<{ name: string; seconds: number }>;
  activeSeconds: number;
  idleSeconds: number;
  /** What the timetable planned for that weekday, with how it ended. */
  blocks: Array<{ title: string; startTime: string; endTime: string; status: string }>;
  /** Commits made that day, per project. */
  commits: Array<{ project: string; subjects: string[] }>;
}

export interface WorklogSummary {
  date: string;
  activeSeconds: number;
  topApps: Array<{ name: string; seconds: number }>;
  planned: number;
  done: number;
  skipped: number;
  commitCount: number;
  projectsTouched: number;
}

/** "3h 20m", or "40m" under an hour. Zero is never rendered as "0h 0m". */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function summarise(input: WorklogInput): WorklogSummary {
  return {
    date: input.date,
    activeSeconds: input.activeSeconds,
    // Sorted here rather than trusting the caller, and cut to three: a list of
    // every process that held focus for nine seconds is not a record of a day.
    topApps: [...input.apps].sort((left, right) => right.seconds - left.seconds).slice(0, 3),
    planned: input.blocks.length,
    done: input.blocks.filter(block => block.status === "done").length,
    skipped: input.blocks.filter(block => block.status === "skipped").length,
    commitCount: input.commits.reduce((total, entry) => total + entry.subjects.length, 0),
    projectsTouched: input.commits.filter(entry => entry.subjects.length > 0).length
  };
}

/**
 * The day as prose, or as close to it as a machine should get.
 *
 * Written as observations rather than conclusions. DexNest can say four hours
 * were spent in an editor and that two planned blocks were not marked done; it
 * cannot say whether that was a good day, and a generated line claiming so
 * would be the first thing to make the whole entry untrustworthy.
 *
 * Sections with nothing in them are omitted entirely. A heading followed by
 * "none" is the kind of filler that makes a daily note not worth opening.
 */
export function draftWorklog(input: WorklogInput): string {
  const summary = summarise(input);
  const lines: string[] = [];

  if (summary.activeSeconds > 0) {
    const apps = summary.topApps.map(app => `${app.name} ${duration(app.seconds)}`).join(", ");
    lines.push(`Active ${duration(summary.activeSeconds)}${apps ? ` — ${apps}` : ""}.`);
  }

  if (summary.planned > 0) {
    const parts = [`${summary.done}/${summary.planned} planned blocks done`];
    if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
    lines.push(`${parts.join(", ")}.`);

    // Named individually, because "2 skipped" is a statistic and "skipped Gym,
    // skipped Study" is the thing worth noticing twice in a week.
    const skipped = input.blocks.filter(block => block.status === "skipped").map(block => block.title);
    if (skipped.length > 0) lines.push(`Skipped: ${skipped.join(", ")}.`);

    // Blocks left as planned are not the same as skipped: nobody said what
    // happened. Worth a line, because that is usually the honest answer.
    const untouched = input.blocks.filter(block => block.status === "planned").map(block => block.title);
    if (untouched.length > 0) lines.push(`Not marked either way: ${untouched.join(", ")}.`);
  }

  if (summary.commitCount > 0) {
    lines.push(`${summary.commitCount} commit${summary.commitCount === 1 ? "" : "s"} across ${summary.projectsTouched} project${summary.projectsTouched === 1 ? "" : "s"}.`);
    for (const entry of input.commits) {
      if (entry.subjects.length === 0) continue;
      // Every subject, not a count. The subjects are the only part of this
      // that says what was actually done rather than how much of it.
      for (const subject of entry.subjects) {
        lines.push(`  ${entry.project}: ${subject}`);
      }
    }
  }

  // Nothing observed is a real answer and gets said plainly, rather than
  // producing an empty section that looks like a failure to gather.
  if (lines.length === 0) return "Nothing recorded for this day.";
  return lines.join("\n");
}

/** The fence that marks DexNest's own paragraphs inside an entry. */
export const WORKLOG_START = "<!-- dexnest:worklog -->";
export const WORKLOG_END = "<!-- /dexnest:worklog -->";

/**
 * Puts the draft into an entry without touching what was written by hand.
 *
 * A journal entry is the one place in DexNest holding text nobody can
 * regenerate, so this appends between markers and, on a second run, replaces
 * only what is between them. Overwriting the entry would be losing the day it
 * was meant to describe.
 */
export function mergeWorklog(existingText: string, draft: string): string {
  const section = `${WORKLOG_START}\n${draft}\n${WORKLOG_END}`;
  const start = existingText.indexOf(WORKLOG_START);
  const end = existingText.indexOf(WORKLOG_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = existingText.slice(0, start);
    const after = existingText.slice(end + WORKLOG_END.length);
    return `${before}${section}${after}`;
  }

  // A half-present fence - one marker and not the other - means the text was
  // edited across the boundary. Appending a fresh section is safe; trying to
  // guess where the old one ended is not.
  const trimmed = existingText.trimEnd();
  return trimmed ? `${trimmed}\n\n${section}` : section;
}
