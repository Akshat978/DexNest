// Phase 18 — A small schedule grammar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchedule, nextFire } from "../src/index.js";

// Build a local wall-clock ISO instant, so these tests hold in any timezone.
function localIso(year, month, day, hour, minute) {
  return new Date(year, month, day, hour, minute, 0, 0).toISOString();
}

test("nightly at 01:00 parses to every day", () => {
  assert.deepEqual(parseSchedule("nightly at 01:00"), {
    kind: "nightly",
    days: [0, 1, 2, 3, 4, 5, 6],
    hour: 1,
    minute: 0,
  });
});

test("weekdays at 23:30 parses to Monday through Friday", () => {
  assert.deepEqual(parseSchedule("weekdays at 23:30"), {
    kind: "weekdays",
    days: [1, 2, 3, 4, 5],
    hour: 23,
    minute: 30,
  });
});

test("weekends at 09:00 parses to Saturday and Sunday", () => {
  assert.deepEqual(parseSchedule("weekends at 09:00"), {
    kind: "weekends",
    days: [0, 6],
    hour: 9,
    minute: 0,
  });
});

test("a day list parses to the named days, sorted and unique", () => {
  assert.deepEqual(parseSchedule("mon,thu at 22:00"), {
    kind: "days",
    days: [1, 4],
    hour: 22,
    minute: 0,
  });
});

test("day lists are order-independent and de-duplicated", () => {
  assert.deepEqual(parseSchedule("thu,mon,mon at 22:00").days, [1, 4]);
});

test("case and surrounding whitespace are tolerated", () => {
  assert.deepEqual(parseSchedule("  NIGHTLY at 01:00 "), {
    kind: "nightly",
    days: [0, 1, 2, 3, 4, 5, 6],
    hour: 1,
    minute: 0,
  });
});

// Rejections all share one message listing the accepted forms.

const ACCEPTED = /Use one of: nightly at HH:MM, weekdays at HH:MM, weekends at HH:MM, or a day list like mon,thu at HH:MM\./;

test("an invented cadence is refused with the accepted forms", () => {
  assert.throws(() => parseSchedule("every other tuesday"), (error) => {
    assert.match(error.message, /Schedule not recognised: "every other tuesday"\./);
    assert.match(error.message, ACCEPTED);
    return true;
  });
});

test("a missing time is refused", () => {
  assert.throws(() => parseSchedule("nightly"), ACCEPTED);
});

test("an out-of-range hour is refused", () => {
  assert.throws(() => parseSchedule("nightly at 25:00"), ACCEPTED);
});

test("an out-of-range minute is refused", () => {
  assert.throws(() => parseSchedule("nightly at 01:99"), ACCEPTED);
});

test("an unknown day name is refused", () => {
  assert.throws(() => parseSchedule("mon,funday at 09:00"), ACCEPTED);
});

test("a non-string is refused", () => {
  assert.throws(() => parseSchedule(null), ACCEPTED);
});

// Phase 19 — When does it next fire.

const nightly = parseSchedule("nightly at 01:00");

test("before the daily time fires today", () => {
  // now 2026-03-10 00:30 local -> 2026-03-10 01:00 local
  const now = localIso(2026, 2, 10, 0, 30);
  assert.equal(nextFire(nightly, now), localIso(2026, 2, 10, 1, 0));
});

test("exactly at the daily time rolls to tomorrow, never the present", () => {
  const now = localIso(2026, 2, 10, 1, 0);
  assert.equal(nextFire(nightly, now), localIso(2026, 2, 11, 1, 0));
});

test("after the daily time fires tomorrow", () => {
  // now 02:00, past 01:00 -> next day 01:00
  const now = localIso(2026, 2, 10, 2, 0);
  assert.equal(nextFire(nightly, now), localIso(2026, 2, 11, 1, 0));
});

test("the result is strictly after now", () => {
  const now = localIso(2026, 2, 10, 2, 0);
  const fire = nextFire(nightly, now);
  assert.ok(new Date(fire).getTime() > new Date(now).getTime());
});

test("crossing a month boundary", () => {
  // 2026-01-31 02:00 -> 2026-02-01 01:00
  const now = localIso(2026, 0, 31, 2, 0);
  assert.equal(nextFire(nightly, now), localIso(2026, 1, 1, 1, 0));
});

test("crossing a year boundary", () => {
  // 2026-12-31 02:00 -> 2027-01-01 01:00
  const now = localIso(2026, 11, 31, 2, 0);
  assert.equal(nextFire(nightly, now), localIso(2027, 0, 1, 1, 0));
});

test("nextFire refuses an unparsed schedule", () => {
  assert.throws(() => nextFire({ hour: 1 }, localIso(2026, 2, 10, 0, 0)), /not a parsed schedule/);
});

test("nextFire refuses an invalid now", () => {
  assert.throws(() => nextFire(nightly, "later"), /not a valid ISO time/);
});

// Phase 20 — Day filters, and days that are not 24 hours long.

const weekdays = parseSchedule("weekdays at 01:00");
const weekends = parseSchedule("weekends at 09:00");
const monThu = parseSchedule("mon,thu at 22:00");

test("weekdays skips the weekend: Friday night rolls to Monday", () => {
  // 2026-03-13 is a Friday. After 01:00 it must jump to Monday 2026-03-16.
  const now = localIso(2026, 2, 13, 2, 0);
  assert.equal(new Date(now).getDay(), 5); // sanity: Friday
  const fire = nextFire(weekdays, now);
  assert.equal(new Date(fire).getDay(), 1); // Monday
  assert.equal(fire, localIso(2026, 2, 16, 1, 0));
});

test("weekends jumps several days forward from a weekday", () => {
  // 2026-03-09 is a Monday; next weekend fire is Saturday 2026-03-14.
  const now = localIso(2026, 2, 9, 10, 0);
  assert.equal(new Date(now).getDay(), 1); // Monday
  const fire = nextFire(weekends, now);
  assert.equal(new Date(fire).getDay(), 6); // Saturday
  assert.equal(fire, localIso(2026, 2, 14, 9, 0));
});

test("an explicit day list picks the next named day", () => {
  // Monday after 22:00 -> Thursday 22:00.
  const now = localIso(2026, 2, 9, 23, 0);
  assert.equal(new Date(now).getDay(), 1);
  const fire = nextFire(monThu, now);
  assert.equal(new Date(fire).getDay(), 4); // Thursday
  assert.equal(fire, localIso(2026, 2, 12, 22, 0));
});

test("every fire lands on a matching day for a week of starting points", () => {
  for (let day = 1; day <= 7; day += 1) {
    const now = localIso(2026, 2, day, 12, 0);
    const fire = nextFire(weekdays, now);
    assert.ok(weekdays.days.includes(new Date(fire).getDay()));
  }
});

test("wall-clock hour is preserved across a DST boundary", () => {
  // US spring-forward is 2026-03-08. Stepping day by day across it, a
  // "nightly at 01:00" schedule must always fire at 01:00 on the wall — read
  // back via local getHours — not drift by an hour. In a timezone without DST
  // this still holds trivially, so the test is correct everywhere.
  for (let day = 6; day <= 10; day += 1) {
    const now = localIso(2026, 2, day, 0, 30); // 00:30 local, before 01:00
    const fire = new Date(nextFire(nightly, now));
    assert.equal(fire.getHours(), 1);
    assert.equal(fire.getMinutes(), 0);
    assert.equal(fire.getDate(), day); // same local day, since 00:30 < 01:00
  }
});

test("wall-clock hour is preserved across a fall-back boundary", () => {
  // US fall-back is 2026-11-01.
  for (let day = 30; day <= 31; day += 1) {
    const now = localIso(2026, 9, day, 0, 30);
    const fire = new Date(nextFire(nightly, now));
    assert.equal(fire.getHours(), 1);
    assert.equal(fire.getMinutes(), 0);
  }
  const now = localIso(2026, 10, 1, 0, 30);
  const fire = new Date(nextFire(nightly, now));
  assert.equal(fire.getHours(), 1);
  assert.equal(fire.getMinutes(), 0);
});
