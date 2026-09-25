import { describe, it, expect } from 'vitest';
import { projectEvent } from '../domain/projection.ts';
import { raw } from './fixtures.ts';

const BAIT = {
  module: 'clipboard',
  actionId: 'clipboard.copy',
  status: 'success',
  eventType: 'action_executed',
  source: 'command',
  summary: 'Copied my bank password hunter2',
  metadataJson: { text: 'salary 120000', path: 'C:/Users/me/diary.txt' },
  errorMessage: 'secret error detail',
  durationMs: 12,
  subject: 'fix: remove leaked token',
};

describe('projectEvent keeps an allow-listed envelope and nothing else', () => {
  it('legacy audit rows: module, action and status from the payload; no content', () => {
    const p = projectEvent(raw({ payload: BAIT }));
    expect(p).toEqual({
      kept: true,
      event: {
        id: 'e1',
        seq: 1,
        type: 'action_executed',
        stream: 'audit',
        module: 'clipboard',
        actionId: 'clipboard.copy',
        status: 'success',
        occurredAt: '2026-06-01T10:00:00.000Z',
      },
    });
    const text = JSON.stringify(p);
    for (const bait of ['hunter2', 'salary', 'diary', 'secret error', 'leaked token', 'command', '12']) {
      expect(text, bait).not.toContain(bait);
    }
  });

  it('module events: the envelope module; payload fields are not read at all', () => {
    const p = projectEvent(raw({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', payload: { ...BAIT, sha: 'abc' } }));
    expect(p.kept && p.event).toMatchObject({ module: 'developer_intelligence', actionId: null, status: null });
  });

  it('a payload field that is not a short identifier is not kept (free text never passes)', () => {
    const p = projectEvent(raw({ payload: { module: 'clipboard', actionId: 'copied the text "hello world"', status: 'x'.repeat(200) } }));
    expect(p.kept && p.event).toMatchObject({ actionId: null, status: null });
  });

  it.each([
    ['envelope module vault', raw({ module: 'vault', stream: 'vault' })],
    ['payload module finance', raw({ payload: { module: 'finance', actionId: 'finance.open', status: 'success' } })],
    ['payload module Journal (any case)', raw({ payload: { module: 'Journal' } })],
    ['action id in a denied module', raw({ payload: { module: 'command', actionId: 'vault.secure.unlock' } })],
    ['legacy type named after a denied module', raw({ type: 'vault_ocr_completed' })],
    ['journal type', raw({ type: 'journal.entry_saved', stream: 'journal', module: 'journal' })],
  ])('drops %s', (_name, event) => {
    expect(projectEvent(event)).toEqual({ kept: false, reason: 'denied' });
  });

  it("drops the game's own events", () => {
    expect(projectEvent(raw({ stream: 'rpg', module: 'reality_rpg', type: 'rpg.level.reached' }))).toEqual({ kept: false, reason: 'self' });
    expect(projectEvent(raw({ type: 'rpg.anything' }))).toEqual({ kept: false, reason: 'self' });
  });

  it('drops malformed rows', () => {
    expect(projectEvent(raw({ id: '' }))).toEqual({ kept: false, reason: 'malformed' });
    expect(projectEvent(raw({ seq: Number.NaN }))).toEqual({ kept: false, reason: 'malformed' });
  });

  it('survives payloads of any shape', () => {
    for (const payload of [null, 'text', 42, [1, 2], { module: 7 }]) {
      const p = projectEvent(raw({ payload }));
      expect(p.kept).toBe(true);
    }
  });
});
