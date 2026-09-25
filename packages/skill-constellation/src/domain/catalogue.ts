/**
 * Resolving what Developer Intelligence recorded to a skill.
 */

import { CATALOGUE_NAMES, CATALOGUE_SKILLS, type CatalogueSkill } from './data/catalogue.ts';
import type { SkillDefinition } from './types.ts';

const BY_ID: ReadonlyMap<string, CatalogueSkill> = new Map(CATALOGUE_SKILLS.map((skill) => [skill.id, skill]));

export function catalogueSkill(id: string): SkillDefinition | undefined {
  return BY_ID.get(id);
}

/** Unmapped libraries get this prefix, so they can never collide with a catalogue id. */
export const UNMAPPED_LIBRARY_PREFIX = 'lib-';

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The skill a technology fact evidences, or undefined when it evidences none.
 *
 * - Catalogue entries map to their canonical skill (react-dom -> React).
 * - Type packages (@types/*) are never a skill.
 * - Other libraries become a skill only when `includeUnmappedLibraries` is on.
 * - project, baseImage and toolchain facts never become skills.
 */
export function resolveTechnologySkill(
  category: string,
  name: string,
  options: { includeUnmappedLibraries: boolean },
): SkillDefinition | undefined {
  const key = name.trim().toLowerCase();
  if (key.length === 0) return undefined;
  const mapped = CATALOGUE_NAMES[category]?.[key];
  if (mapped) return BY_ID.get(mapped);
  if (category !== 'library' || !options.includeUnmappedLibraries) return undefined;
  if (key.startsWith('@types/')) return undefined;
  const id = slug(key);
  if (id.length === 0) return undefined;
  return { id: `${UNMAPPED_LIBRARY_PREFIX}${id}`, name: name.trim(), category: 'library' };
}
