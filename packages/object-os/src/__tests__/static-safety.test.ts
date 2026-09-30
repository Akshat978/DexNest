/**
 * Static checks over the package source.
 * - The domain imports only the domain: nothing in it can do I/O.
 * - No file-system, process, OS or worker access anywhere in the package:
 *   files are the host's, behind a port.
 * - No Electron.
 * - EC-036, as in Developer Intelligence: no LLM or network client anywhere.
 * - The foundation is the only run-time dependency.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '..');
const DOMAIN = join(SRC, 'domain');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : tsFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const importsOf = (text: string) =>
  [...text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

const rel = (file: string) => relative(SRC, file).replace(/\\/g, '/');

describe('static safety', () => {
  it('finds the source it checks', () => {
    expect(tsFiles(DOMAIN).length).toBeGreaterThan(10);
  });

  it('the domain imports only the domain', () => {
    const bad: string[] = [];
    for (const file of tsFiles(DOMAIN)) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.') || !resolve(file, '..', spec).startsWith(DOMAIN)) bad.push(`${rel(file)} -> ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no file-system, process, OS, worker or Electron access', () => {
    const deny = /^(node:)?(fs|fs\/promises|child_process|worker_threads|os|electron)$/;
    const bad = tsFiles(SRC).flatMap((f) => importsOf(readFileSync(f, 'utf8')).filter((s) => deny.test(s)).map((s) => `${rel(f)} -> ${s}`));
    expect(bad).toEqual([]);
    expect(tsFiles(SRC).filter((f) => /\bprocess\.(env|cwd|argv|platform)\b/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('EC-036: no LLM, network or cloud client', () => {
    const deny =
      /\b(openai|anthropic|@ai-sdk|langchain|cohere|ollama|firebase|supabase|aws-sdk)\b|from\s+['"](axios|got|node-fetch|undici)['"]|from\s+['"]node:(http|https|net|tls|dgram|dns)['"]|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/i;
    expect(tsFiles(SRC).filter((f) => deny.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('depends on the foundation and nothing else at run time', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@dexnest/foundation']);
  });
});
