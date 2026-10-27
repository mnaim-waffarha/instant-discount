import type { Currency } from './enums';

/**
 * All amounts in the system are integers in minor units (piastres / halalas).
 * Both EGP and SAR use 2 decimal places.
 */
export const MINOR_UNITS: Record<Currency, number> = { EGP: 2, SAR: 2 };

export function toMinor(major: number, currency: Currency): number {
  return Math.round(major * 10 ** MINOR_UNITS[currency]);
}

export function toMajor(minor: number, currency: Currency): number {
  return minor / 10 ** MINOR_UNITS[currency];
}

/** Percentage of an amount, in basis points (1% = 100 bps), rounded down to favour funders. */
export function percentOf(amountMinor: number, bps: number): number {
  return Math.floor((amountMinor * bps) / 10_000);
}

/** Split an amount across shares (bps summing to 10_000); remainder goes to the first share. */
export function splitByShares(amountMinor: number, sharesBps: number[]): number[] {
  const parts = sharesBps.map((s) => Math.floor((amountMinor * s) / 10_000));
  const remainder = amountMinor - parts.reduce((a, b) => a + b, 0);
  if (parts.length > 0) parts[0] = (parts[0] ?? 0) + remainder;
  return parts;
}
