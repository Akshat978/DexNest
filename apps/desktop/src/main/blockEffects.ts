/**
 * What a timetable block changes when it starts and when it ends.
 *
 * An effect is an action id and its parameters rather than a bespoke verb.
 * DexNest already has several hundred actions - lights, performance mode, the
 * vault lock, stopping a project - each with its own danger level, its own
 * journalling and its own confirmation rule. Inventing a second vocabulary
 * beside that would mean re-deciding all of it, and getting a different answer
 * in at least one place.
 *
 * The resolver is pure and takes no clock. Deciding what changed is the part
 * that has to be right at a day boundary, across a restart, and when two
 * blocks overlap; none of that is observable if the answer is computed inside
 * the timer that also performs it.
 */

export type EffectWhen = "enter" | "exit";

export interface BlockEffect {
  id: string;
  /** Whether this runs when the block starts or when it ends. */
  when: EffectWhen;
  actionId: string;
  params?: Record<string, unknown>;
}

/** Only the parts of a timetable block that effects care about. */
export interface EffectBlock {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  title: string;
  effects?: BlockEffect[];
}

/** Which blocks were running, and on which day. */
export interface BlockMoment {
  day: string;
  activeIds: string[];
}

export interface PlannedEffect {
  blockId: string;
  blockTitle: string;
  when: EffectWhen;
  actionId: string;
  params: Record<string, unknown>;
}

/** "HH:MM" as minutes past midnight. Returns null for anything else. */
export function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The blocks running at a moment.
 *
 * Half-open, matching the rest of the timetable: a block ending at 10:00 and
 * one starting at 10:00 do not both count as running at 10:00, which would
 * otherwise apply the first block's exit and the second's enter in an order
 * nothing decides.
 *
 * A block whose end is not after its start is ignored rather than treated as
 * crossing midnight. Nothing else in the timetable wraps, and a block that
 * silently ran until the next morning would be a surprising way to find out.
 */
export function activeBlockIds(blocks: readonly EffectBlock[], day: string, atMinutes: number): string[] {
  return blocks
    .filter(block => {
      if (block.day !== day) return false;
      const start = minutesOf(block.startTime);
      const end = minutesOf(block.endTime);
      if (start === null || end === null || end <= start) return false;
      return start <= atMinutes && atMinutes < end;
    })
    .map(block => block.id);
}

/**
 * What to run, given where things were and where they are.
 *
 * A null previous means DexNest has not observed a moment yet - it just
 * started, or effects were just switched on. Nothing fires then, deliberately.
 * Starting the app at 14:30 inside a block that began at 14:00 and treating
 * that as an entry would re-apply the block's effects on every restart, so
 * closing and reopening DexNest during a focus block would keep resetting the
 * lights someone had since changed by hand.
 *
 * Exits run before entries. Leaving a block that dimmed the lights and
 * entering one that brightens them has an obvious intended result, and the
 * opposite order produces the opposite one.
 */
export function resolveTransitions(
  previous: BlockMoment | null,
  current: BlockMoment,
  blocks: readonly EffectBlock[]
): PlannedEffect[] {
  if (!previous) return [];

  const byId = new Map(blocks.map(block => [block.id, block]));
  const was = new Set(previous.activeIds);
  const is = new Set(current.activeIds);

  const planned: PlannedEffect[] = [];
  const collect = (blockId: string, when: EffectWhen) => {
    // A block deleted or edited between two samples leaves an id with nothing
    // behind it. There is no effect to run and no error to report: the block
    // is gone, which is what the operator asked for.
    const block = byId.get(blockId);
    if (!block) return;
    for (const effect of block.effects ?? []) {
      if (effect.when !== when) continue;
      if (!effect.actionId) continue;
      planned.push({
        blockId: block.id,
        blockTitle: block.title,
        when,
        actionId: effect.actionId,
        params: effect.params ? { ...effect.params } : {}
      });
    }
  };

  for (const blockId of previous.activeIds) {
    if (!is.has(blockId)) collect(blockId, "exit");
  }
  for (const blockId of current.activeIds) {
    if (!was.has(blockId)) collect(blockId, "enter");
  }

  return planned;
}

/** Whether a block has anything to do at all, for the "does this act" badge. */
export function hasEffects(block: EffectBlock): boolean {
  return (block.effects ?? []).some(effect => Boolean(effect.actionId));
}
