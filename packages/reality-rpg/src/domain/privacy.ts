/**
 * What the game may never look at.
 *
 * Vault, finance and journal are DexNest's most private modules. No rule may
 * name them, and their events are dropped at projection even if a rule
 * somehow matched them. The game's own stream is excluded too, so it cannot
 * award XP for its own level-ups and feed itself.
 *
 * One exception, which the owner asked for on 5 October 2026: the game may
 * count *that* an entry was made in one of the three. Exactly three actions,
 * listed in COUNTED_ENTRIES below, and only when they succeeded. What the
 * game sees of such an event is what it sees of any other: the action's name
 * and when. Never the entry, its title, an amount or a file name. Everything
 * else those modules do (opening, editing, unlocking, searching, deleting)
 * stays denied exactly as before.
 *
 * The denial is by name and by prefix, because legacy audit rows name their
 * module in several places: `payload.module` ("vault"), the action id
 * ("vault.secure.unlock") and sometimes the type itself ("vault_ocr_completed").
 */

export const DENIED_MODULES: ReadonlySet<string> = new Set(['vault', 'finance', 'journal']);
export const RPG_STREAM = 'rpg';
export const RPG_TYPE_PREFIX = 'rpg.';

const DENIED_PREFIX = /^(vault|finance|journal)([._-]|$)/i;

export function isDeniedModule(module: string | null | undefined): boolean {
  return typeof module === 'string' && DENIED_MODULES.has(module.trim().toLowerCase());
}

/** An action id, event type or any other name that belongs to a denied module. */
export function isDeniedName(name: string | null | undefined): boolean {
  return typeof name === 'string' && DENIED_PREFIX.test(name.trim());
}

/**
 * "An entry was made": the action that makes it, and the event type DexNest
 * logs it under. The pair must match exactly; a different action of the same
 * module, or the same action under another type, is not counted.
 */
export const COUNTED_ENTRIES: Readonly<Record<string, string>> = {
  'journal.create_entry': 'journal_action',
  'finance.create_transaction': 'finance_action',
  'vault.import_documents': 'vault_action',
};

/** Whether this is one of the three counted actions, logged under its own type. */
export function isCountedEntry(type: string | null | undefined, actionId: string | null | undefined): boolean {
  return typeof actionId === 'string' && typeof type === 'string' && Object.hasOwn(COUNTED_ENTRIES, actionId) && COUNTED_ENTRIES[actionId] === type;
}

/**
 * Whether a rule's match asks for counted entries and nothing else of the
 * private modules: every action it names is a counted one, every type it
 * names is the type of one of those actions, it reads the audit stream, and
 * it counts successes only. Such a rule is allowed; any other rule that
 * names vault, finance or journal is refused as before.
 */
export function countsEntriesOnly(match: { types: readonly string[]; stream?: string; module?: string; actionIds?: readonly string[]; status?: string }): boolean {
  const actions = match.actionIds ?? [];
  if (actions.length === 0 || match.module !== undefined || match.stream !== 'audit' || match.status !== 'success') return false;
  if (!actions.every((id) => Object.hasOwn(COUNTED_ENTRIES, id))) return false;
  const wanted = new Set(actions.map((id) => COUNTED_ENTRIES[id]));
  return match.types.length > 0 && match.types.every((type) => wanted.has(type));
}

export const RPG_MODULE = 'reality_rpg';
const SELF_PREFIX = /^(rpg\.|reality_rpg([._-]|$))/i;

export function isSelfFeeding(stream: string | null | undefined, type: string | null | undefined): boolean {
  return stream === RPG_STREAM || (typeof type === 'string' && SELF_PREFIX.test(type.trim()));
}

/**
 * A module or action id that is the game's own - e.g. the audit line written
 * when the user saves a rule (module "reality_rpg", action
 * "reality_rpg.rule.save"). Awarding XP for using the game would feed itself.
 */
export function isSelfName(name: string | null | undefined): boolean {
  return typeof name === 'string' && SELF_PREFIX.test(name.trim());
}
