// What Projects declares about itself (foundation DexNestModuleManifest).

import type { DexNestModuleManifest } from "@dexnest/foundation";

import { PROJECTS_ACTIONS } from "../domain/actions.ts";
import { PROJECTS_EVENT_STREAM, PROJECTS_EVENT_TYPES, PROJECTS_MODULE_ID } from "../domain/events.ts";
import { DEFAULT_PROJECTS_SETTINGS } from "../domain/settings.ts";
import { PROJECTS_MIGRATIONS } from "../store/migrations.ts";

export const SCHEDULED_FETCH_JOB_ID = "scheduled_fetch";

export const PROJECTS_MANIFEST: DexNestModuleManifest = {
  id: PROJECTS_MODULE_ID,
  title: "Projects",
  tablePrefix: "proj_",
  migrations: PROJECTS_MIGRATIONS,
  eventStreams: [PROJECTS_EVENT_STREAM],
  eventTypes: PROJECTS_EVENT_TYPES,
  actionIds: PROJECTS_ACTIONS.map((action) => action.id),
  // The view keeps the Dev dashboard's id so pins, routines and voice keep working.
  views: [{ id: "dev", title: "Projects" }],
  // Network work: heavy, so performance mode pauses it. Only scheduled when the owner turns it on.
  jobs: [{ id: SCHEDULED_FETCH_JOB_ID, defaultIntervalMs: DEFAULT_PROJECTS_SETTINGS.scheduledFetch.intervalMinutes * 60_000, heavy: true }]
};
