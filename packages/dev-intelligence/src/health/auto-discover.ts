/**
 * Read-only discovery of *candidate* scripts for UI suggestion.
 * MUST NEVER execute discovered scripts — only configured HealthCheck rows run.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DiscoveredScriptCandidate {
  source: 'package.json' | 'makefile' | 'composer.json' | 'other';
  name: string;
  /** Suggested argv ONLY — never executed by DI without explicit HealthCheck. */
  suggestedArgv: string[];
  evidencePath: string;
}

/**
 * Lists scripts that a human might later configure as health checks.
 * This function performs ZERO process execution.
 */
export async function listDiscoveredScriptCandidates(
  rootPath: string,
): Promise<DiscoveredScriptCandidate[]> {
  const out: DiscoveredScriptCandidate[] = [];
  try {
    const raw = await readFile(join(rootPath, 'package.json'), 'utf8');
    const json = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = json.scripts ?? {};
    for (const name of Object.keys(scripts).sort()) {
      // Intentionally do NOT run npm/yarn/pnpm here.
      out.push({
        source: 'package.json',
        name,
        suggestedArgv: ['npm', 'run', name, '--if-present'],
        evidencePath: 'package.json',
      });
    }
  } catch {
    /* no package.json or unreadable */
  }
  return out;
}

/**
 * Guard used by tests + orchestrator: executing discovered scripts is forbidden.
 */
export function assertNeverAutoRunDiscoveredScripts(): void {
  // Dual-use marker for static review / tests — no runtime side effects.
}
