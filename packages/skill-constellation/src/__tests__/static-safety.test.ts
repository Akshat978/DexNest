/**
 * Static checks over the package source.
 *
 * - The domain is pure: it imports only other domain files. No node:*, no
 *   database, no foundation runtime - so nothing in it can touch disk.
 * - EC-036, as in Developer Intelligence: no LLM or network client anywhere
 *   in the package.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '..');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : tsFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const importsOf = (text: string) =>
  [...text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? '',
  );

describe('static safety', () => {
  it('finds the source it is checking', () => {
    expect(tsFiles(join(SRC, 'domain')).length).toBeGreaterThan(5);
  });

  it('domain imports only other domain files', () => {
    const bad: string[] = [];
    for (const file of tsFiles(join(SRC, 'domain'))) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) bad.push(`${relative(SRC, file)} -> ${specifier}`);
        else if (!resolve(file, '..', specifier).startsWith(join(SRC, 'domain'))) bad.push(`${relative(SRC, file)} -> ${specifier}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the module never reads disk or spawns processes: no fs, child_process or worker imports outside tests', () => {
    const deny = /^node:(fs|fs\/promises|child_process|worker_threads)$|^(fs|fs\/promises|child_process)$/;
    const bad: string[] = [];
    for (const file of tsFiles(SRC)) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (deny.test(specifier)) bad.push(`${relative(SRC, file)} -> ${specifier}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('EC-036: no LLM or network client imports', () => {
    const deny =
      /\b(openai|anthropic|@ai-sdk|langchain|cohere|ollama)\b|from\s+['"](axios|got|node-fetch|undici)['"]|from\s+['"]node:(http|https|net|tls|dgram|dns)['"]|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/i;
    const bad = tsFiles(SRC).filter((file) => deny.test(readFileSync(file, 'utf8')));
    expect(bad.map((f) => relative(SRC, f))).toEqual([]);
  });
});
