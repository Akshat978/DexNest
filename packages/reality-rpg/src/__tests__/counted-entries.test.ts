/**
 * The one exception to "the game never looks at vault, finance or journal":
 * it may count that an entry was made. Three actions, by name, when they
 * succeeded. Nothing else of those modules, and never what an entry says.
 */

import { describe, expect, it } from 'vitest';
import { COUNTED_ENTRIES, countsEntriesOnly, isCountedEntry, isDeniedName } from '../domain/privacy.ts';
import { projectEvent } from '../domain/projection.ts';
import { parseRule } from '../domain/validation.ts';
import { ruleMatches } from '../domain/matching.ts';
import { STARTER_RULES } from '../domain/data/starter-pack.ts';
import { raw } from './fixtures.ts';

/** A journal save as DexNest logs it, with everything private it could carry. */
const journalSave = (actionId = 'journal.create_entry', status = 'success') =>
  raw({
    type: 'journal_action',
    payload: {
      module: 'DexNest Journal',
      actionId,
      status,
      summary: 'Saved journal entry: I am worried about the tests',
      metadataJson: { title: 'A hard day', mood: 'low', words: 412, text: 'Dear diary' },
      errorMessage: null,
    },
  });

describe('exactly three actions are counted', () => {
  it('the list is these three and no more', () => {
    expect(COUNTED_ENTRIES).toEqual({
      'journal.create_entry': 'journal_action',
      'finance.create_transaction': 'finance_action',
      'vault.import_documents': 'vault_action',
    });
  });

  it('an action counts only under its own event type', () => {
    expect(isCountedEntry('journal_action', 'journal.create_entry')).toBe(true);
    expect(isCountedEntry('finance_action', 'finance.create_transaction')).toBe(true);
    expect(isCountedEntry('vault_action', 'vault.import_documents')).toBe(true);
    expect(isCountedEntry('vault_action', 'journal.create_entry')).toBe(false);
    expect(isCountedEntry('action_executed', 'journal.create_entry')).toBe(false);
    for (const other of ['journal.update_entry', 'journal.delete_entry', 'journal.open', 'finance.update_transaction', 'finance.delete_transaction', 'finance.show_monthly_summary', 'vault.secure.unlock', 'vault.secure.reveal', 'vault.open_document', 'vault.import_from_object', 'capture.route_to_vault', '__proto__', 'constructor', '']) {
      expect(isCountedEntry('journal_action', other), other).toBe(false);
      expect(isCountedEntry('finance_action', other), other).toBe(false);
      expect(isCountedEntry('vault_action', other), other).toBe(false);
    }
    expect(isCountedEntry(null, 'journal.create_entry')).toBe(false);
    expect(isCountedEntry('journal_action', null)).toBe(false);
  });
});

describe('what the game sees of a counted entry', () => {
  it('is the action, the type and the time: nothing the entry holds, and not the module', () => {
    const p = projectEvent(journalSave());
    expect(p).toEqual({
      kept: true,
      event: { id: 'e1', seq: 1, type: 'journal_action', stream: 'audit', module: null, actionId: 'journal.create_entry', status: 'success', occurredAt: '2026-06-01T10:00:00.000Z', recordedAt: '2026-06-01T10:00:00.000Z' },
    });
    const seen = JSON.stringify(p);
    for (const secret of ['worried', 'A hard day', 'low', '412', 'Dear diary', 'summary', 'metadataJson', 'title']) expect(seen, secret).not.toContain(secret);
  });

  it('a finance entry carries no amount and a vault import no file name', () => {
    const spend = projectEvent(raw({ type: 'finance_action', payload: { module: 'DexNest Finance', actionId: 'finance.create_transaction', status: 'success', summary: 'Created DexNest Finance transaction.', metadataJson: { amount: 1299.5, store: 'Pharmacy', category: 'Health' } } }));
    expect(spend.kept).toBe(true);
    for (const secret of ['1299', 'Pharmacy', 'Health']) expect(JSON.stringify(spend), secret).not.toContain(secret);
    const filed = projectEvent(raw({ type: 'vault_action', payload: { module: 'DexNest Vault', actionId: 'vault.import_documents', status: 'success', summary: 'Imported 1 Vault document.', metadataJson: { fileName: 'passport-scan.pdf', category: 'Identity' } } }));
    expect(filed.kept).toBe(true);
    for (const secret of ['passport', 'Identity', 'pdf']) expect(JSON.stringify(filed), secret).not.toContain(secret);
  });

  it('even if the module is written as a plain name, it is not carried along', () => {
    const p = projectEvent(raw({ type: 'journal_action', payload: { module: 'journal', actionId: 'journal.create_entry', status: 'success' } }));
    expect(p.kept && p.event.module).toBe(null);
  });
});

describe('everything else of those modules is still dropped', () => {
  it('a save that failed, an edit, a delete, an unlock, a reveal', () => {
    expect(projectEvent(journalSave('journal.create_entry', 'failed'))).toEqual({ kept: false, reason: 'denied' });
    for (const actionId of ['journal.update_entry', 'journal.delete_entry', 'journal.open_today', 'journal.extract_events']) {
      expect(projectEvent(journalSave(actionId)), actionId).toEqual({ kept: false, reason: 'denied' });
    }
    for (const actionId of ['vault.secure.unlock', 'vault.secure.reveal', 'vault.open_document', 'vault.edit_document_metadata', 'vault.import_from_object']) {
      expect(projectEvent(raw({ type: 'vault_action', payload: { module: 'DexNest Vault', actionId, status: 'success' } })), actionId).toEqual({ kept: false, reason: 'denied' });
    }
    for (const actionId of ['finance.update_transaction', 'finance.delete_transaction', 'finance.attach_receipt', 'finance.create_recurring']) {
      expect(projectEvent(raw({ type: 'finance_action', payload: { module: 'DexNest Finance', actionId, status: 'success' } })), actionId).toEqual({ kept: false, reason: 'denied' });
    }
  });

  it('a counted action logged any other way is dropped', () => {
    // Under another type, on another stream, as a module event, or with no status.
    expect(projectEvent(raw({ type: 'vault_ocr_completed', payload: { actionId: 'vault.import_documents', status: 'success' } })).kept).toBe(false);
    expect(projectEvent(raw({ type: 'action_executed', payload: { actionId: 'journal.create_entry', status: 'success' } })).kept).toBe(false);
    expect(projectEvent(raw({ type: 'journal_action', stream: 'dev', payload: { actionId: 'journal.create_entry', status: 'success' } })).kept).toBe(false);
    expect(projectEvent(raw({ type: 'journal_action', module: 'journal', payload: { actionId: 'journal.create_entry', status: 'success' } })).kept).toBe(false);
    expect(projectEvent(raw({ type: 'journal_action', payload: { actionId: 'journal.create_entry' } })).kept).toBe(false);
    expect(projectEvent(raw({ type: 'journal_action', payload: { actionId: 'journal.create_entry', status: 'success and more text' } })).kept).toBe(false);
  });

  it('the names themselves are still denied names', () => {
    for (const name of ['journal_action', 'journal.create_entry', 'vault', 'finance.anything']) expect(isDeniedName(name), name).toBe(true);
  });
});

describe('a rule may count entries, and may ask nothing else of those modules', () => {
  const rule = (match: Record<string, unknown>) => parseRule({ id: 'r', name: 'R', enabled: true, match, award: { xp: 5, stat: 'Focus' }, dailyCap: 5 });
  const counted = (types: string[], actionIds: string[]) => ({ types, stream: 'audit', actionIds, status: 'success' });

  it('the three built-in rules are accepted and match exactly their entry', () => {
    for (const id of ['journal-written', 'expense-logged', 'document-filed']) {
      const parsed = parseRule(STARTER_RULES.find((r) => (r as { id: string }).id === id));
      expect(parsed.ok, id).toBe(true);
    }
    const journal = parseRule(STARTER_RULES.find((r) => (r as { id: string }).id === 'journal-written'));
    const saved = projectEvent(journalSave());
    expect(journal.ok && saved.kept && ruleMatches(journal.value.match, saved.event)).toBe(true);
    const spend = projectEvent(raw({ type: 'finance_action', payload: { actionId: 'finance.create_transaction', status: 'success' } }));
    expect(journal.ok && spend.kept && ruleMatches(journal.value.match, spend.event)).toBe(false);
  });

  it('several counted entries in one rule are fine', () => {
    expect(rule(counted(['journal_action', 'finance_action'], ['journal.create_entry', 'finance.create_transaction'])).ok).toBe(true);
    expect(countsEntriesOnly(counted(['vault_action'], ['vault.import_documents']))).toBe(true);
  });

  it('anything wider is refused, in the words it always was', () => {
    const refused = [
      counted(['journal_action'], ['journal.update_entry']), // another action
      counted(['journal_action'], ['journal.create_entry', 'journal.delete_entry']), // a counted one and another
      counted(['journal_action', 'vault_action'], ['journal.create_entry']), // a type whose action is not named
      counted(['vault_ocr_completed'], ['vault.import_documents']), // another type of the module
      { types: ['journal_action'], stream: 'audit', status: 'success' }, // every journal action
      { types: ['journal_action'], stream: 'audit', actionIds: ['journal.create_entry'] }, // failures too
      { types: ['journal_action'], actionIds: ['journal.create_entry'], status: 'success' }, // no stream named
      { types: ['journal_action'], stream: 'audit', actionIds: ['journal.create_entry'], status: 'success', module: 'journal' }, // by module
      { types: ['journal_action'], stream: 'audit', actionIds: [], status: 'success' },
    ];
    for (const match of refused) {
      const parsed = rule(match);
      expect(parsed.ok, JSON.stringify(match)).toBe(false);
      expect(!parsed.ok && parsed.errors.join(' '), JSON.stringify(match)).toContain('rules may not name vault, finance or journal activity');
      expect(countsEntriesOnly(match as Parameters<typeof countsEntriesOnly>[0]), JSON.stringify(match)).toBe(false);
    }
  });
});
