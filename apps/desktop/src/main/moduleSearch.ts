// What Search can find in the newer modules.
//
// ObjectOS, Skills, GhostOS, Reality RPG, the Timetable and reminders are asked
// when a search is run; nothing of theirs is copied into the index file. A GhostOS
// entry that is deleted is therefore gone from Search at once, and the index
// under the data root holds no second copy of any of them.
//
// Each record's `sourceModule` is the id of the screen it opens in.
//
// Electron-free: main.ts supplies what each module holds.

export interface ModuleSearchRecord {
  id: string;
  sourceModule: string;
  entityType: string;
  entityId: string;
  title: string;
  filePath: null;
  fileType: "metadata";
  sizeBytes: null;
  textPreview: string;
  searchableText?: string;
  tags: string[];
  category: string;
  createdAt: string;
  updatedAt: string;
  indexedAt: string;
}

/** The screens these records open in, in the order Search lists them. */
export const LIVE_SEARCH_SOURCES: readonly string[] = ["object", "skills", "ghost", "rpg", "timetable", "reminders"];

function record(sourceModule: string, entityType: string, entityId: string, title: string, at: string, now: string, rest: { preview?: string; tags?: string[]; category?: string; text?: string } = {}): ModuleSearchRecord {
  return {
    id: `${sourceModule}-${entityType}-${entityId}`,
    sourceModule,
    entityType,
    entityId,
    title,
    filePath: null,
    fileType: "metadata",
    sizeBytes: null,
    textPreview: rest.preview ?? "",
    ...(rest.text ? { searchableText: rest.text } : {}),
    tags: (rest.tags ?? []).filter(Boolean),
    category: rest.category ?? entityType,
    createdAt: at || now,
    updatedAt: at || now,
    indexedAt: now
  };
}

export interface ObjectLike {
  id: string;
  itemName: string;
  location: string;
  room?: string | null;
  container?: string | null;
  notes?: string | null;
  tags: readonly string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Objects by name and place. An object added a moment ago is found at once. */
export function objectRecords(items: readonly ObjectLike[], now: string): ModuleSearchRecord[] {
  return items.map((item) => ({
    ...record("object", "object", item.id, item.itemName, item.createdAt, now, {
      preview: [item.location, item.room, item.container, item.notes].filter(Boolean).join(" · "),
      tags: [...item.tags, item.status],
      category: item.room || item.container || item.location || "object"
    }),
    updatedAt: item.updatedAt || item.createdAt || now
  }));
}

export interface SkillLike {
  id: string;
  name: string;
  category: string;
  repositoryCount: number;
  lastActivityAt?: string | null;
  lastEvidenceAt: string;
  strength: { score: number };
  hidden: boolean;
}

export function skillRecords(skills: readonly SkillLike[], now: string): ModuleSearchRecord[] {
  return skills.filter((skill) => !skill.hidden).map((skill) =>
    record("skills", "skill", skill.id, skill.name, skill.lastActivityAt ?? skill.lastEvidenceAt, now, {
      preview: `Skill · ${skill.category} · strength ${Math.round(skill.strength.score * 100)}% · ${skill.repositoryCount} ${skill.repositoryCount === 1 ? "repository" : "repositories"}`,
      tags: ["skill", skill.category],
      category: skill.category
    })
  );
}

export interface GhostHitLike {
  id: string;
  type: string;
  title: string;
  timelineAt: string;
  origin: string;
}

/**
 * GhostOS answers with its own search, which also matches an entry's notes and
 * tags; the words searched for are kept on the record so a match found there
 * still counts here. The notes themselves are not copied.
 */
export function ghostRecords(hits: readonly GhostHitLike[], query: string, now: string): ModuleSearchRecord[] {
  return hits.map((hit) =>
    record("ghost", "ghost_entry", hit.id, hit.title, hit.timelineAt, now, {
      preview: `GhostOS · ${hit.type}${hit.origin === "manual" ? " · entered by you" : " · from your repositories"}`,
      tags: ["ghostos", hit.type],
      category: hit.type,
      text: query
    })
  );
}

export interface QuestLike {
  quest: { id: string; title: string; status: string; createdAt: string };
}
export interface AchievementLike {
  achievement: { id: string; name: string; description: string };
  unlocked: { unlockedAt?: string } | null;
}

export function rpgRecords(quests: readonly QuestLike[], achievements: readonly AchievementLike[], now: string): ModuleSearchRecord[] {
  return [
    ...quests.map(({ quest }) =>
      record("rpg", "quest", quest.id, quest.title, quest.createdAt, now, { preview: `Reality RPG quest · ${quest.status}`, tags: ["quest", quest.status], category: "quest" })
    ),
    ...achievements.map(({ achievement, unlocked }) =>
      record("rpg", "achievement", achievement.id, achievement.name, unlocked?.unlockedAt ?? now, now, {
        preview: `Reality RPG achievement · ${unlocked ? "unlocked" : "not yet unlocked"} · ${achievement.description}`,
        tags: ["achievement", unlocked ? "unlocked" : "locked"],
        category: "achievement"
      })
    )
  ];
}

export interface BlockLike {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  title: string;
  category: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function timetableRecords(blocks: readonly BlockLike[], now: string): ModuleSearchRecord[] {
  return blocks.map((block) => ({
    ...record("timetable", "timetable_block", block.id, block.title, block.createdAt, now, {
      preview: `Timetable · ${block.day} ${block.startTime} to ${block.endTime}${block.notes ? ` · ${block.notes}` : ""}`,
      tags: ["timetable", block.day, block.category],
      category: block.category || "timetable"
    }),
    updatedAt: block.updatedAt || block.createdAt || now
  }));
}

export interface NudgeLike {
  id: string;
  title: string;
  message: string;
  sourceModule: string;
  date: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Reminders still waiting. One that was dismissed is not offered again here. */
export function reminderRecords(nudges: readonly NudgeLike[], now: string): ModuleSearchRecord[] {
  return nudges.filter((nudge) => nudge.status === "active" || nudge.status === "snoozed").map((nudge) => ({
    ...record("reminders", "reminder", nudge.id, nudge.title, nudge.createdAt, now, {
      preview: `Reminder · ${nudge.date} · ${nudge.message}`,
      tags: ["reminder", nudge.priority, nudge.sourceModule],
      category: "reminder"
    }),
    updatedAt: nudge.updatedAt || nudge.createdAt || now
  }));
}
