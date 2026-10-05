/** One way to write a date, shared by every screen that shows one. */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dayKey, dayLabel, dayTimeLabel, displayTimeZone, isDayValue, momentLabel, setDisplayTimeZone, todayKey, UNKNOWN_DATE } from "../src/renderer/lib/dates.ts";

const REGINA = "America/Regina"; // UTC-6 all year
const AUCKLAND = "Pacific/Auckland"; // UTC+12 or +13
const KOLKATA = "Asia/Kolkata"; // UTC+5:30

// The wording tests name a zone, so they read the same on every machine.
setDisplayTimeZone("UTC");

test("a day is written day first, with the month as a word and the year", () => {
  assert.equal(dayLabel("2026-10-03T15:50:00.000Z"), "3 Oct 2026");
  assert.equal(dayLabel("2026-01-09"), "9 Jan 2026", "a plain day is taken as written");
  assert.equal(dayLabel("2025-12-31T23:59:59.000Z"), "31 Dec 2025");
  // An instant with an offset is the same instant; in UTC it is already the 4th.
  assert.equal(dayLabel("2026-10-03T22:30:00-06:00"), "4 Oct 2026");
});

test("a moment adds the time", () => {
  assert.equal(dayTimeLabel("2026-06-01T09:00:00.000Z"), "1 Jun 2026, 09:00");
  assert.equal(dayTimeLabel("2026-06-01T09:00:00+02:00"), "1 Jun 2026, 07:00");
});

test("what is not a date says so instead of printing rubbish", () => {
  for (const bad of ["", "never", "2026-13-40", null, undefined]) {
    assert.equal(dayLabel(bad), UNKNOWN_DATE, String(bad));
    assert.equal(dayTimeLabel(bad), UNKNOWN_DATE, String(bad));
  }
  assert.equal(dayKey("x"), null);
});

test("the key for grouping by day stays YYYY-MM-DD", () => {
  assert.equal(dayKey("2026-06-01T09:00:00.000Z"), "2026-06-01");
  assert.equal(dayKey("2026-06-01"), "2026-06-01");
});

test("a moment is shown as the day and time it was where you are", () => {
  // Half past nine in the evening in Saskatchewan: stored as the next day, UTC.
  const evening = "2026-10-04T03:30:00.000Z";
  assert.equal(dayKey(evening, REGINA), "2026-10-03");
  assert.equal(dayLabel(evening, REGINA), "3 Oct 2026");
  assert.equal(dayTimeLabel(evening, REGINA), "3 Oct 2026, 21:30");
  assert.equal(dayLabel(evening, "UTC"), "4 Oct 2026", "the day it used to show");
  // East of UTC it goes the other way: early morning there is still yesterday in UTC.
  const morning = "2026-10-03T20:15:00.000Z";
  assert.equal(dayTimeLabel(morning, AUCKLAND), "4 Oct 2026, 09:15");
  assert.equal(dayTimeLabel(morning, KOLKATA), "4 Oct 2026, 01:45", "a half-hour zone");
  // Midnight is 00:00, never 24:00.
  assert.equal(dayTimeLabel("2026-10-04T06:00:30.000Z", REGINA), "4 Oct 2026, 00:00");
  // The end of a year.
  assert.equal(dayLabel("2026-01-01T02:00:00.000Z", REGINA), "31 Dec 2025");
});

test("a day you picked stays that day in every time zone", () => {
  // GhostOS stores a picked day at midnight UTC, ObjectOS at noon UTC.
  for (const zone of ["UTC", REGINA, AUCKLAND, KOLKATA, "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    assert.equal(dayLabel("2026-10-03", zone), "3 Oct 2026", zone);
    assert.equal(dayLabel("2026-10-03T00:00:00.000Z", zone), "3 Oct 2026", `midnight stamp, ${zone}`);
    assert.equal(dayLabel("2026-10-03T12:00:00.000Z", zone), "3 Oct 2026", `noon stamp, ${zone}`);
    assert.equal(dayKey("2026-10-03T00:00:00Z", zone), "2026-10-03", zone);
    assert.equal(dayTimeLabel("2026-10-03T12:00:00.000Z", zone), "3 Oct 2026", "a day has no time to show");
  }
  assert.equal(isDayValue("2026-10-03"), true);
  assert.equal(isDayValue("2026-10-03T12:00:00.000Z"), true);
  assert.equal(isDayValue("2026-10-03T12:00:00.001Z"), false, "a moment that merely falls near noon is a moment");
  assert.equal(isDayValue("2026-10-03T12:00:01.000Z"), false);
  assert.equal(isDayValue("2026-10-03T06:00:00.000Z"), false);
  // A real moment one second after a stamp is moved like any other.
  assert.equal(dayLabel("2026-10-03T00:00:01.000Z", REGINA), "2 Oct 2026");
});

test("a commit or a sync is always a moment, even at exactly noon or midnight UTC", () => {
  assert.equal(momentLabel("2026-06-30T12:00:00.000Z", "UTC"), "30 Jun 2026, 12:00");
  assert.equal(momentLabel("2026-06-30T12:00:00.000Z", REGINA), "30 Jun 2026, 06:00");
  assert.equal(momentLabel("2026-06-30T00:00:00.000Z", REGINA), "29 Jun 2026, 18:00");
  assert.equal(momentLabel("nope"), UNKNOWN_DATE);
  const read = (file: string) => readFileSync(new URL(`../src/renderer/views/${file}`, import.meta.url), "utf8");
  assert.match(read("ghostOsModel.ts"), /export function shortDateTime\(iso: string\): string \{\s*return momentLabel\(iso\);/);
  assert.match(read("todayDayModel.ts"), /when: momentLabel\(r\.generatedAt\),/);
});

test("today is today where you are", () => {
  const lateEvening = new Date("2026-10-04T04:10:00.000Z"); // 22:10 on the 3rd in Regina
  assert.equal(todayKey(lateEvening, REGINA), "2026-10-03");
  assert.equal(todayKey(lateEvening, "UTC"), "2026-10-04");
  assert.equal(todayKey(lateEvening, AUCKLAND), "2026-10-04");
  // Exactly noon UTC is a moment here, not a picked day.
  assert.equal(todayKey(new Date("2026-10-03T12:00:00.000Z"), AUCKLAND), "2026-10-04");
});

test("the zone is this computer's unless a test names one", () => {
  setDisplayTimeZone(null);
  assert.equal(displayTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  setDisplayTimeZone(REGINA);
  assert.equal(dayLabel("2026-10-04T03:30:00.000Z"), "3 Oct 2026", "the default argument follows it");
  setDisplayTimeZone("UTC");
  assert.equal(dayLabel("2026-10-04T03:30:00.000Z"), "4 Oct 2026");
});

test("the four module screens write their dates through it", () => {
  for (const model of ["ghostOsModel.ts", "objectOsModel.ts", "realityRpgModel.ts", "skillConstellationModel.ts"]) {
    const source = readFileSync(new URL(`../src/renderer/views/${model}`, import.meta.url), "utf8");
    assert.match(source, /from "\.\.\/lib\/dates\.ts"/, model);
    const shortDate = /export (?:function shortDate\(iso: string\): string \{\s*return ([^;]+);|const shortDate = \(iso: string\) => ([^;]+);)/.exec(source);
    assert.ok(shortDate, `${model} has shortDate`);
    assert.equal((shortDate[1] ?? shortDate[2]).trim(), "dayLabel(iso)", `${model} does not format dates its own way`);
  }
});

test("no screen of the four reads a day off the UTC form of a moment", () => {
  const read = (file: string) => readFileSync(new URL(`../src/renderer/views/${file}`, import.meta.url), "utf8");
  assert.match(read("GhostOsView.tsx"), /const today = initial\?\.today \?\? todayKey\(\);/);
  const ghost = read("ghostOsModel.ts");
  assert.match(ghost, /when: dayKey\(str\(d\.occurredAt \?\? d\.decidedAt \?\? e\.startedAt\)\) \?\? "",/);
  assert.match(ghost, /endedAt: dayKey\(str\(d\.endedAt \?\? e\.endedAt\)\) \?\? "",/);
  assert.match(read("objectOsModel.ts"), /date: dayKey\(status\.dueAt\) \?\? status\.dueAt\.slice\(0, 10\)/);
});
