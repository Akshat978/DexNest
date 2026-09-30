/** Relation vocabulary: a built-in list plus free-form lowercase names. */

export const BUILT_IN_RELATION_TYPES = [
  'worked_on',
  'uses',
  'about',
  'involves',
  'at',
  'part_of',
  'related_to',
  'learned_from',
  'led_to',
] as const;
export type BuiltInRelationType = (typeof BUILT_IN_RELATION_TYPES)[number];

const RELATION_TYPE = /^[a-z][a-z0-9_]{0,39}$/;

export function isRelationType(value: unknown): value is string {
  return typeof value === 'string' && RELATION_TYPE.test(value);
}

export function isBuiltInRelationType(value: string): value is BuiltInRelationType {
  return (BUILT_IN_RELATION_TYPES as readonly string[]).includes(value);
}
