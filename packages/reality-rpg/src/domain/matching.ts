/** Whether an observed event satisfies a rule's match. Exact, case-sensitive names. */

import type { ObservedEvent, RuleMatch } from './types.ts';

export function ruleMatches(match: RuleMatch, event: ObservedEvent): boolean {
  if (!match.types.includes(event.type)) return false;
  if (match.stream !== undefined && match.stream !== event.stream) return false;
  if (match.module !== undefined && match.module !== event.module) return false;
  if (match.actionIds !== undefined && (event.actionId === null || !match.actionIds.includes(event.actionId))) return false;
  if (match.status !== undefined && match.status !== event.status) return false;
  return true;
}
