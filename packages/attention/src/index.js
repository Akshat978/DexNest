// The public API. Every consumer imports from here, and every test exercises
// the package through this surface rather than reaching into a module.
//
export const PACKAGE_NAME = "dexnest-attention";

export { makeItem, PRIORITIES } from "./item.js";
export { itemsFor, STOP_REASONS } from "./sources.js";
export { groupItems, digestGroup } from "./grouping.js";
export {
  holdForCooldown,
  lastDeliveryFor,
  holdWithEscalation,
  escalates,
  PIERCING_PRIORITIES,
} from "./cooldown.js";
export {
  inQuietHours,
  holdForQuietHours,
  QUIET_HELD_PRIORITIES,
  holdWithUrgency,
  piercesQuietHours,
  QUIET_PIERCING_PRIORITIES,
} from "./quiet.js";
export { decide, DEFAULT_COOLDOWN_MINUTES } from "./decide.js";
export {
  renderNotification,
  NOTIFICATION_TITLE_MAX,
  NOTIFICATION_BODY_MAX,
} from "./render.js";
export { answersFor, validateAnswer } from "./answers.js";
export { renderSummary } from "./summary.js";
