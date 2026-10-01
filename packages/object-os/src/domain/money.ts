/**
 * Money as integer minor units plus an ISO 4217 code. No conversion, ever:
 * a price keeps the currency it was paid in.
 */

import type { Money } from './types.ts';

/** Currencies with no minor unit; everything else is taken as two decimals. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'XOF', 'XAF', 'UGX', 'PYG']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD']);

export function decimalsOf(currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

const CURRENCY = /^[A-Z]{3}$/;
export const MAX_AMOUNT_MINOR = 1_000_000_000_00; // one billion in a two-decimal currency

/** "12.50" + "EUR" -> { amount: 1250, currency: "EUR" }. Refuses more decimals than the currency has. */
export function parseMoney(amount: unknown, currency: unknown): Money | null {
  if (typeof currency !== 'string' || !CURRENCY.test(currency.trim().toUpperCase())) return null;
  const code = currency.trim().toUpperCase();
  const decimals = decimalsOf(code);
  const text = typeof amount === 'number' ? String(amount) : typeof amount === 'string' ? amount.trim().replace(/,/g, '') : '';
  const pattern = decimals === 0 ? /^\d{1,15}$/ : new RegExp(`^\\d{1,15}(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null;
  return { amount: minor, currency: code };
}

export function isMoney(value: unknown): value is Money {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as { amount?: unknown; currency?: unknown };
  return typeof m.amount === 'number' && Number.isSafeInteger(m.amount) && m.amount >= 0 && m.amount <= MAX_AMOUNT_MINOR && typeof m.currency === 'string' && CURRENCY.test(m.currency);
}

/** 1250 EUR -> "12.50 EUR". */
export function formatMoney(m: Money): string {
  const decimals = decimalsOf(m.currency);
  if (decimals === 0) return `${m.amount} ${m.currency}`;
  const s = String(m.amount).padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)} ${m.currency}`;
}
