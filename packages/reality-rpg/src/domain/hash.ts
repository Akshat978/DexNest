/** Deterministic ids without node:crypto, so the domain stays pure. FNV-1a both ways. */

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
