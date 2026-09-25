/**
 * What the game may never look at.
 *
 * Vault, finance and journal are DexNest's most private modules. No rule may
 * name them, and their events are dropped at projection even if a rule
 * somehow matched them. The game's own stream is excluded too, so it cannot
 * award XP for its own level-ups and feed itself.
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

export function isSelfFeeding(stream: string | null | undefined, type: string | null | undefined): boolean {
  return stream === RPG_STREAM || (typeof type === 'string' && type.startsWith(RPG_TYPE_PREFIX));
}
