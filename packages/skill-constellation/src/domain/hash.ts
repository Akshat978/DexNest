/**
 * Deterministic short hashes for ids and layout jitter. Pure: no node:crypto,
 * so the domain runs anywhere and the same input always gives the same id.
 * FNV-1a, forward and reversed, as Developer Intelligence's fingerprints do.
 */

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function stableHash(input: string): string {
  const reversed = input.split('').reverse().join('');
  return `${fnv1a32(input).toString(16).padStart(8, '0')}${fnv1a32(reversed).toString(16).padStart(8, '0')}`;
}

/** A number in [0, 1) derived from `input`. */
export function stableFraction(input: string): number {
  return fnv1a32(input) / 0x1_0000_0000;
}
