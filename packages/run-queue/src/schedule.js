// A small schedule grammar.
//
// Deliberately tiny: four forms an operator can write at midnight and trust.
// Not a cron parser. parseSchedule turns the text into a plain shape; nextFire
// (Phase 19) turns that shape plus a `now` into the next occurrence.

/**
 * @typedef {Object} Schedule
 * @property {"nightly"|"weekdays"|"weekends"|"days"} kind
 * @property {number[]} days   local weekdays it may fire on, 0=Sunday..6=Saturday
 * @property {number} hour     0..23, local wall-clock
 * @property {number} minute   0..59, local wall-clock
 */

/**
 * The day names accepted in a day list, in week order, mapped to their
 * JavaScript getDay() index (0=Sunday).
 * @type {ReadonlyArray<[string, number]>}
 */
const DAY_NAMES = [
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["wed", 3],
  ["thu", 4],
  ["fri", 5],
  ["sat", 6],
];

const DAY_INDEX = new Map(DAY_NAMES);

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * The one refusal message shape for this module, listing the accepted forms.
 * @param {string} text
 * @returns {string}
 */
function notRecognised(text) {
  return (
    `Schedule not recognised: ${JSON.stringify(text)}. ` +
    `Use one of: nightly at HH:MM, weekdays at HH:MM, weekends at HH:MM, ` +
    `or a day list like mon,thu at HH:MM.`
  );
}

/**
 * Parse a schedule string into a plain shape. Accepts exactly four forms:
 *
 *   "nightly at HH:MM"
 *   "weekdays at HH:MM"
 *   "weekends at HH:MM"
 *   "mon,thu at HH:MM"   (a comma list of day names)
 *
 * Anything else is refused with a message listing the accepted forms. Case and
 * surrounding whitespace are tolerated; the grammar itself is not widened.
 *
 * @param {string} text
 * @returns {Schedule}
 */
export function parseSchedule(text) {
  if (typeof text !== "string") {
    throw new Error(notRecognised(text));
  }

  const trimmed = text.trim().toLowerCase();
  const match = /^(.+?)\s+at\s+(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match === null) {
    throw new Error(notRecognised(text));
  }

  const [, dayPart, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) {
    throw new Error(notRecognised(text));
  }

  if (dayPart === "nightly") {
    return { kind: "nightly", days: [...EVERY_DAY], hour, minute };
  }
  if (dayPart === "weekdays") {
    return { kind: "weekdays", days: [...WEEKDAYS], hour, minute };
  }
  if (dayPart === "weekends") {
    return { kind: "weekends", days: [...WEEKENDS], hour, minute };
  }

  const days = parseDayList(dayPart, text);
  return { kind: "days", days, hour, minute };
}

/**
 * The next occurrence of a schedule strictly after `now`, as an ISO string.
 *
 * Times are LOCAL wall-clock: "nightly at 01:00" is 01:00 on the wall on every
 * matching date. The candidate is built from local calendar components and
 * advanced a whole calendar day at a time, reconstructed from components each
 * step so the wall-clock hour is preserved across a daylight-saving change
 * rather than drifting by an hour. "Strictly after" means a candidate equal to
 * `now` rolls forward — 01:00 evaluated at 01:00 returns tomorrow, never the
 * present moment.
 *
 * @param {Schedule} schedule
 * @param {string} now  ISO string
 * @returns {string}
 */
export function nextFire(schedule, now) {
  if (schedule === null || typeof schedule !== "object" || !Array.isArray(schedule.days)) {
    throw new Error(
      `Schedule is not a parsed schedule: ${JSON.stringify(schedule)}. Pass the result of parseSchedule.`,
    );
  }
  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    throw new Error(
      `Schedule "now" is not a valid ISO time: ${JSON.stringify(now)}. Use an ISO instant like 2026-09-07T02:00:00.000Z.`,
    );
  }

  const { hour, minute, days } = schedule;
  let candidate = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    hour,
    minute,
    0,
    0,
  );

  // At most 8 steps: one for "today already passed" plus up to seven to reach
  // the next matching weekday.
  for (let step = 0; step < 8; step += 1) {
    if (candidate.getTime() > nowDate.getTime() && days.includes(candidate.getDay())) {
      return candidate.toISOString();
    }
    candidate = new Date(
      candidate.getFullYear(),
      candidate.getMonth(),
      candidate.getDate() + 1,
      hour,
      minute,
      0,
      0,
    );
  }

  // Unreachable for a non-empty day set; a schedule with no days cannot fire.
  throw new Error(
    `Schedule can never fire: no days set on ${JSON.stringify(schedule)}. Include at least one day.`,
  );
}

/**
 * Parse a comma-separated list of day names into sorted, unique day indices.
 * @param {string} dayPart
 * @param {string} original  the caller's text, for the refusal message
 * @returns {number[]}
 */
function parseDayList(dayPart, original) {
  const tokens = dayPart.split(",").map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => token === "")) {
    throw new Error(notRecognised(original));
  }
  const indices = new Set();
  for (const token of tokens) {
    if (!DAY_INDEX.has(token)) {
      throw new Error(notRecognised(original));
    }
    indices.add(DAY_INDEX.get(token));
  }
  return [...indices].sort((a, b) => a - b);
}
