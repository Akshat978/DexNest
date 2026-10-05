// Short answers DexNest says aloud to questions a screen answers.
//
// "What needs me?" used to open Today and say "Opened". It still opens Today,
// and now also says how many things need you. The answers here are counts,
// a level and skill names: nothing from the Vault, Finance or the Journal,
// and no file, project or object names, since they may be spoken in a room.
//
// The wording is in pure functions so it can be tested; `spokenAnswer` reads
// what it needs through the bridge.

import { needsYou } from "../views/todayDayModel.ts";

export type SpokenAnswerKind = "needs" | "level" | "skills" | "things";

export const SPOKEN_ANSWER_KINDS: readonly SpokenAnswerKind[] = ["needs", "level", "skills", "things"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function needsAnswer(count: number): string {
  if (count <= 0) return "Nothing needs you right now.";
  return count === 1 ? "One thing needs you. It is on Today." : `${count} things need you. They are on Today.`;
}

export interface LevelFacts {
  enabled: boolean;
  sheet: { level: number; totalXp: number; xpToNextLevel: number | null };
}

export function levelAnswer(game: LevelFacts | null | undefined): string {
  if (!game) return "Reality RPG is not available.";
  if (!game.enabled) return "Reality RPG is turned off.";
  const { level, totalXp, xpToNextLevel } = game.sheet;
  const next = xpToNextLevel === null ? "" : ` ${xpToNextLevel} more to reach level ${level + 1}.`;
  return `You are level ${level}, with ${totalXp} XP.${next}`;
}

export interface SkillFacts {
  name: string;
  hidden: boolean;
  strength: { score: number };
}

export function skillsAnswer(skills: readonly SkillFacts[] | null | undefined): string {
  const shown = (skills ?? []).filter((skill) => !skill.hidden && skill.strength.score > 0).sort((a, b) => b.strength.score - a.strength.score);
  if (shown.length === 0) return "No skills yet. Run a repository scan, then rebuild Skills.";
  const top = shown.slice(0, 3).map((skill) => skill.name);
  return top.length === 1 ? `Your strongest skill is ${top[0]}.` : `Your strongest skills are ${list(top)}.`;
}

export interface ThingCounts {
  overdue: number;
  dueSoon: number;
  warrantyEnding: number;
  lowStock: number;
}

/** Counts only: which object is not said aloud. */
export function thingsAnswer(counts: ThingCounts | null | undefined): string {
  if (!counts) return "ObjectOS is not available.";
  const parts = [
    counts.overdue > 0 ? `${plural(counts.overdue, "maintenance job is", "maintenance jobs are")} overdue` : "",
    counts.dueSoon > 0 ? `${plural(counts.dueSoon, "is", "are")} due soon` : "",
    counts.warrantyEnding > 0 ? `${plural(counts.warrantyEnding, "warranty is", "warranties are")} ending` : "",
    counts.lowStock > 0 ? `${plural(counts.lowStock, "part is", "parts are")} low on stock` : ""
  ].filter(Boolean);
  return parts.length === 0 ? "No maintenance is due and no warranties are ending." : `${list(parts)}.`.replace(/^./, (c) => c.toUpperCase());
}

export interface SpokenAnswerBridge {
  getTodayAgenda?(): Promise<unknown>;
  objectOsAttention?(): Promise<unknown>;
  autopilotAttention?(): Promise<unknown>;
  realityRpgSnapshot?(): Promise<unknown>;
  skillConstellationSnapshot?(): Promise<unknown>;
}

/** The answer to say, or null when the kind is unknown or it could not be read (the screen is open either way). */
export async function spokenAnswer(kind: unknown, bridge: SpokenAnswerBridge): Promise<string | null> {
  const safe = <T,>(call: (() => Promise<unknown>) | undefined): Promise<T | null> => (call ? call().then((value) => value as T, () => null) : Promise.resolve(null));
  type NeedsInput = Parameters<typeof needsYou>[0];
  switch (kind) {
    case "needs": {
      const [agenda, objects, autopilot] = await Promise.all([
        safe<NeedsInput["agenda"]>(bridge.getTodayAgenda?.bind(bridge)),
        safe<NeedsInput["objects"]>(bridge.objectOsAttention?.bind(bridge)),
        safe<NeedsInput["autopilot"]>(bridge.autopilotAttention?.bind(bridge))
      ]);
      return needsAnswer(needsYou({ agenda, objects, autopilot }).length);
    }
    case "level":
      return levelAnswer(await safe<LevelFacts>(bridge.realityRpgSnapshot?.bind(bridge)));
    case "skills": {
      const snapshot = await safe<{ skills?: SkillFacts[] }>(bridge.skillConstellationSnapshot?.bind(bridge));
      return skillsAnswer(snapshot?.skills);
    }
    case "things": {
      const attention = await safe<{ summary?: { counts?: ThingCounts } }>(bridge.objectOsAttention?.bind(bridge));
      return thingsAnswer(attention?.summary?.counts);
    }
    default:
      return null;
  }
}
