/**
 * Hand-written related skills - data only.
 *
 * A pair is drawn as a curated link only when both skills already exist from
 * evidence; it never creates a skill or adds evidence. Ids must be catalogue
 * ids (the tests check). Order within a pair does not matter.
 */

export const RELATED_PAIRS: readonly (readonly [string, string])[] = [
  ['typescript', 'javascript'],
  ['react', 'javascript'],
  ['react', 'nextjs'],
  ['vue', 'javascript'],
  ['svelte', 'javascript'],
  ['angular', 'typescript'],
  ['electron', 'nodejs'],
  ['express', 'nodejs'],
  ['fastify', 'nodejs'],
  ['nestjs', 'typescript'],
  ['vite', 'vitest'],
  ['c', 'cpp'],
  ['java', 'kotlin'],
  ['prisma', 'sqlite'],
];
