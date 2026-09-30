import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { parseTimelineQuery, searchTerms, toFtsQuery, toLikePattern, TIMELINE_LIMITS } from '../domain/index.ts';

let t: TestDatabase | null = null;
afterEach(() => {
  t?.dispose();
  t = null;
});

function ftsTable(rows: string[]) {
  t = createTestDatabase('ghost-search-');
  t.db.exec("CREATE VIRTUAL TABLE s USING fts5(title, tokenize = 'unicode61 remove_diacritics 2')");
  const insert = t.db.prepare('INSERT INTO s (rowid, title) VALUES (?, ?)');
  rows.forEach((title, i) => insert.run([i + 1, title]));
  return (input: string) => {
    const q = toFtsQuery(input);
    if (q === null) return [];
    return t!.db.prepare('SELECT title FROM s WHERE s MATCH ? ORDER BY rowid').all([q]).map((r) => (r as { title: string }).title);
  };
}

describe('search terms', () => {
  it('splits on anything but letters and digits, lowercases, dedupes and caps', () => {
    expect(searchTerms('  Rust, rust & "Go"!  ')).toEqual(['rust', 'go']);
    expect(searchTerms('a b c d e f g h i j').length).toBe(8);
    expect(searchTerms('Café')).toEqual(['café']);
    expect(toFtsQuery('   !!! ')).toBeNull();
  });
});

describe('FTS query: the owner\'s words are data, never syntax', () => {
  it('matches every term as a prefix', () => {
    const find = ftsTable(['TypeScript project', 'Rust notes', 'type theory', 'Café visits']);
    expect(find('type')).toEqual(['TypeScript project', 'type theory']);
    expect(find('type proj')).toEqual(['TypeScript project']);
    expect(find('cafe')).toEqual(['Café visits']);
  });

  it('FTS operators, column filters and stray quotes do not change the query or break it', () => {
    const find = ftsTable(['alpha OR beta', 'alpha', 'beta', 'title thing', 'near miss']);
    for (const input of ['alpha OR beta', 'title:thing', '"', 'NEAR(alpha beta)', '*', '-alpha', '^alpha', 'alpha AND', '(', 'a"b', "'; DROP TABLE s; --"]) {
      expect(() => find(input), input).not.toThrow();
    }
    // "OR" is a word here: only the row containing all three words matches.
    expect(find('alpha OR beta')).toEqual(['alpha OR beta']);
    expect(find('title:thing')).toEqual(['title thing']);
    expect(find("'; DROP TABLE s; --")).toEqual([]);
    expect(t!.db.prepare('SELECT count(*) AS n FROM s').get()).toEqual({ n: 5 });
  });
});

describe('LIKE fallback', () => {
  it('escapes %, _ and the escape character', () => {
    t = createTestDatabase('ghost-like-');
    t.db.exec('CREATE TABLE e (title TEXT)');
    const insert = t.db.prepare('INSERT INTO e (title) VALUES (?)');
    for (const title of ['100% done', '100 done', 'snake_case', 'snakeXcase', 'back\\slash', 'backslash']) insert.run([title]);
    const find = (term: string) => t!.db.prepare("SELECT title FROM e WHERE title LIKE ? ESCAPE '\\' ORDER BY title").all([toLikePattern(term)]).map((r) => (r as { title: string }).title);
    expect(find('100%')).toEqual(['100% done']);
    expect(find('snake_')).toEqual(['snake_case']);
    expect(find('k\\s')).toEqual(['back\\slash']);
  });
});

describe('timeline query', () => {
  it('defaults to everything, newest first, a page at a time', () => {
    const r = parseTimelineQuery(undefined);
    expect(r.ok && r.value).toEqual({ from: null, to: null, types: [], origins: [], observations: true, limit: TIMELINE_LIMITS.defaultLimit, before: null });
  });

  it('filters by type and origin, and pages from a position', () => {
    const r = parseTimelineQuery({ types: ['memory', 'decision', 'memory'], origins: ['manual'], from: '2026-01-01', to: '2026-02-01T00:00:00Z', limit: 10, before: { at: '2026-01-15T00:00:00Z', id: 'ent_12345678' }, observations: false });
    expect(r.ok && r.value).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      types: ['memory', 'decision'],
      origins: ['manual'],
      observations: false,
      limit: 10,
      before: { at: '2026-01-15T00:00:00.000Z', id: 'ent_12345678' },
    });
  });

  it('refuses unknown types, bad ranges and oversized pages', () => {
    for (const q of [{ types: ['robot'] }, { origins: ['cloud'] }, { from: '2026-02-01', to: '2026-01-01' }, { limit: 0 }, { limit: TIMELINE_LIMITS.maxLimit + 1 }, { before: { at: 'x', id: 'y' } }, 'everything']) {
      expect(parseTimelineQuery(q).ok, JSON.stringify(q)).toBe(false);
    }
  });
});
