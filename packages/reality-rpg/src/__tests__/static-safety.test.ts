/**
 * Static checks over the package source.
 * - The domain imports only other domain files: nothing in it can do I/O.
 * - Only projection.ts reads an event payload (types.ts declares it).
 * - EC-036, as in Developer Intelligence: no LLM or network client anywhere.
 * - No file-system or process access anywhere in the module.
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

describe('static safety', () => {
  it('finds the source it checks', () => {
    expect(tsFiles(DOMAIN).length).toBeGreaterThan(8);
  });

  it('the domain imports only the domain', () => {
    const bad: string[] = [];
    for (const file of tsFiles(DOMAIN)) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.') || !resolve(file, '..', spec).startsWith(DOMAIN)) bad.push(`${relative(SRC, file)} -> ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('only the projection reads an event payload', () => {
    const readers = tsFiles(SRC)
      .filter((file) => /\.payload\b|\bpayload\s*[,)]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).replace(/\\/g, '/'));
    expect(readers).toEqual(['domain/projection.ts']);
  });

  it('no file-system, process or worker access', () => {
    const deny = /^node:(fs|fs\/promises|child_process|worker_threads)$|^(fs|fs\/promises|child_process)$/;
    const bad = tsFiles(SRC).flatMap((f) => importsOf(readFileSync(f, 'utf8')).filter((s) => deny.test(s)).map((s) => `${relative(SRC, f)} -> ${s}`));
    expect(bad).toEqual([]);
  });

  it('EC-036: no LLM or network client imports', () => {
    const deny =
      /\b(openai|anthropic|@ai-sdk|langchain|cohere|ollama)\b|from\s+['"](axios|got|node-fetch|undici)['"]|from\s+['"]node:(http|https|net|tls|dgram|dns)['"]|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/i;
    expect(tsFiles(SRC).filter((f) => deny.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f))).toEqual([]);
  });
});
