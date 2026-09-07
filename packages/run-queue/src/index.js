// The public API. Every consumer imports from here, and every test exercises
// the package through this surface rather than reaching into a module.
//
export const PACKAGE_NAME = "dexnest-run-queue";

export { buildQueue, reorder, MAX_GOAL_LENGTH } from "./queue.js";

export {
  STATUSES,
  isStatus,
  makeRecord,
  pendingRecord,
  recordsFor,
  canTransition,
  transition,
  isSettled,
  progress,
  skip,
} from "./records.js";

export { nextAction } from "./decide.js";

export { parseSchedule, nextFire } from "./schedule.js";

export { renderQueueSummary } from "./summary.js";
