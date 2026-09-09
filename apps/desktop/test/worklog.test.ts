/**
 * Writing a day up from what was watched.
 *
 * Two things decide whether this is worth having. It must not claim more than
 * it observed, and it must never damage text a person wrote - a journal entry
 * is the one thing in DexNest that cannot be regenerated.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  draftWorklog,
  duration,
  mergeWorklog,
  summarise,
  WORKLOG_END,
  WORKLOG_START,
  type WorklogInput
} from "../src/main/worklog.ts";

const day = (over: Partial<WorklogInput> = {}): WorklogInput => ({
  date: "2026-09-09",
  apps: [
    { name: "Code.exe", seconds: 4 * 3600 },
    { name: "chrome.exe", seconds: 40 * 60 },
    { name: "Slack.exe", seconds: 10 * 60 },
    { name: "explorer.exe", seconds: 9 }
  ],
  activeSeconds: 5 * 3600,
  idleSeconds: 2 * 3600,
  blocks: [
    { title: "Deep work", startTime: "09:00", endTime: "12:00", status: "done" },
    { title: "Gym", startTime: "18:00", endTime: "19:00", status: "skipped" }
  ],
  commits: [{ project: "DexNest", subjects: ["feat(dev): push a project", "fix: the parser"] }],
  ...over
});

test("durations read the way a person says them", () => {
  assert.equal(duration(3600), "1h");
  assert.equal(duration(3 * 3600 + 20 * 60), "3h 20m");
  assert.equal(duration(40 * 60), "40m");
  assert.equal(duration(0), "0m");
});

test("only the applications that mattered are named", () => {
  // A list of every process that held focus for nine seconds is not a record
  // of a day.
  const summary = summarise(day());
  assert.equal(summary.topApps.length, 3);
  assert.equal(summary.topApps[0]!.name, "Code.exe");
  assert.ok(!summary.topApps.some(app => app.name === "explorer.exe"));
});

test("applications are sorted here, not trusted to arrive sorted", () => {
  const summary = summarise(day({
    apps: [{ name: "small", seconds: 60 }, { name: "big", seconds: 6000 }]
  }));
  assert.equal(summary.topApps[0]!.name, "big");
});

test("a skipped block is named, not just counted", () => {
  // "2 skipped" is a statistic. "Skipped: Gym" is the thing worth noticing
  // twice in a week.
  const text = draftWorklog(day());
  assert.match(text, /Skipped: Gym/);
});

test("blocks left as planned are reported apart from skipped ones", () => {
  // Nobody said what happened, which is usually the honest answer and a
  // different one from having decided not to.
  const text = draftWorklog(day({
    blocks: [{ title: "Study", startTime: "14:00", endTime: "16:00", status: "planned" }]
  }));
  assert.match(text, /Not marked either way: Study/);
  assert.ok(!/Skipped:/.test(text));
});

test("commit subjects are listed, not summarised into a number", () => {
  // The subjects are the only part that says what was done rather than how
  // much of it.
  const text = draftWorklog(day());
  assert.match(text, /feat\(dev\): push a project/);
  assert.match(text, /fix: the parser/);
});

test("a project with no commits is not mentioned", () => {
  const text = draftWorklog(day({
    commits: [{ project: "DexNest", subjects: ["one thing"] }, { project: "Quiet", subjects: [] }]
  }));
  assert.ok(!text.includes("Quiet"));
  assert.match(text, /1 commit across 1 project\./);
});

test("empty sections are omitted rather than headed with nothing", () => {
  // A heading followed by "none" is the filler that makes a daily note not
  // worth opening.
  const text = draftWorklog(day({ blocks: [], commits: [] }));
  assert.ok(!text.includes("planned blocks"));
  assert.ok(!text.includes("commit"));
  assert.match(text, /Active 5h/);
});

test("a day with nothing observed says so plainly", () => {
  const text = draftWorklog(day({ apps: [], activeSeconds: 0, blocks: [], commits: [] }));
  assert.equal(text, "Nothing recorded for this day.");
});

test("nothing in the draft passes judgement on the day", () => {
  // DexNest can say four hours were spent in an editor. It cannot say whether
  // that was a good day, and a line claiming so is the first thing that would
  // make the whole entry untrustworthy.
  const text = draftWorklog(day()).toLowerCase();
  for (const word of ["productive", "good day", "well done", "unproductive", "wasted", "should have"]) {
    assert.ok(!text.includes(word), `draft editorialises: ${word}`);
  }
});

// --- not damaging what someone wrote ------------------------------------------

test("a draft is appended to an entry that already has writing", () => {
  const merged = mergeWorklog("Felt rough today. Long call with T.", "Active 5h.");
  assert.match(merged, /^Felt rough today\. Long call with T\./);
  assert.match(merged, /Active 5h\./);
});

test("running it twice replaces only DexNest's own paragraphs", () => {
  // The entry is the one thing here that cannot be regenerated, so a second
  // run must not touch a word of it.
  const first = mergeWorklog("Handwritten note.", "Active 5h.");
  const second = mergeWorklog(first, "Active 6h.");
  assert.match(second, /Handwritten note\./);
  assert.match(second, /Active 6h\./);
  assert.ok(!second.includes("Active 5h."));
  assert.equal(second.split(WORKLOG_START).length - 1, 1);
});

test("text written after the section survives a rerun", () => {
  const first = mergeWorklog("Before.", "Active 5h.");
  const edited = `${first}\n\nAdded this afterwards.`;
  const second = mergeWorklog(edited, "Active 6h.");
  assert.match(second, /Before\./);
  assert.match(second, /Added this afterwards\./);
  assert.match(second, /Active 6h\./);
});

test("a broken fence appends rather than guessing where the old one ended", () => {
  // One marker and not the other means someone edited across the boundary.
  // Appending is safe; guessing the extent of the old section is not.
  const damaged = `Note.\n${WORKLOG_START}\nActive 5h.`;
  const merged = mergeWorklog(damaged, "Active 6h.");
  assert.match(merged, /Note\./);
  assert.match(merged, /Active 5h\./);
  assert.match(merged, /Active 6h\./);
});

test("an empty entry gets the section with no leading blank lines", () => {
  const merged = mergeWorklog("", "Active 5h.");
  assert.equal(merged, `${WORKLOG_START}\nActive 5h.\n${WORKLOG_END}`);
});

test("whitespace-only text is treated as empty", () => {
  assert.equal(mergeWorklog("   \n\n  ", "x").startsWith(WORKLOG_START), true);
});
