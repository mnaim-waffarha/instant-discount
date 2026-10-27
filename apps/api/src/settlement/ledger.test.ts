import { splitByShares } from '@instant-discount/shared';
import { describe, expect, it } from 'vitest';
import { ledgerLines, type LedgerInput } from './ledger';

const at = (n: number) => new Date(Date.UTC(2026, 9, n));
const shares = [3_334, 3_333, 3_333];
function redemption(discount: number, events: LedgerInput['events']): LedgerInput {
  const amounts = splitByShares(discount, shares);
  return {
    discountMinor: discount,
    fundingSnapshot: ['bank', 'merchant', 'waffarha'].map((partnerId, i) => ({
      partnerId,
      shareBps: shares[i]!,
      amountMinor: amounts[i]!,
    })),
    events,
  };
}
const net = (lines: ReturnType<typeof ledgerLines>, partnerId: string) =>
  lines.filter((l) => l.partnerId === partnerId).reduce((s, l) => s + l.amountMinor, 0);

describe('ledgerLines', () => {
  it('ignores reservations that were never confirmed', () => {
    const r = redemption(1_000, [
      { id: 'e1', type: 'RESERVED', discountDeltaMinor: 1_000, createdAt: at(1) },
      { id: 'e2', type: 'CANCELLED', discountDeltaMinor: -1_000, createdAt: at(1) },
    ]);
    expect(ledgerLines(r)).toEqual([]);
    expect(
      ledgerLines(
        redemption(1_000, [
          { id: 'e1', type: 'EXPIRED', discountDeltaMinor: -1_000, createdAt: at(1) },
        ]),
      ),
    ).toEqual([]);
  });

  it('books each funder share on confirmation', () => {
    const lines = ledgerLines(
      redemption(1_001, [
        { id: 'r', type: 'RESERVED', discountDeltaMinor: 1_001, createdAt: at(1) },
        { id: 'c', type: 'CONFIRMED', discountDeltaMinor: 0, createdAt: at(1) },
      ]),
    );
    expect(lines.map((l) => [l.partnerId, l.amountMinor, l.countDelta])).toEqual([
      ['bank', 335, 1],
      ['merchant', 333, 1],
      ['waffarha', 333, 1],
    ]);
  });

  it('nets every funder to exactly zero after partial refunds that add up to a full one', () => {
    const lines = ledgerLines(
      redemption(1_001, [
        { id: 'c', type: 'CONFIRMED', discountDeltaMinor: 0, createdAt: at(1) },
        { id: 'f1', type: 'REFUNDED', discountDeltaMinor: -500, createdAt: at(5) },
        { id: 'f2', type: 'REFUNDED', discountDeltaMinor: -501, createdAt: at(40) },
      ]),
    );
    for (const p of ['bank', 'merchant', 'waffarha']) expect(net(lines, p)).toBe(0);
    // Only the final reversal changes the redemption count, and refunds keep their own dates.
    expect(lines.filter((l) => l.eventId === 'f1').every((l) => l.countDelta === 0)).toBe(true);
    expect(
      lines
        .filter((l) => l.eventId === 'f2')
        .every((l) => l.countDelta === -1 && l.eventAt.getTime() === at(40).getTime()),
    ).toBe(true);
  });

  it('reverses whatever is left when a confirmed payment is cancelled', () => {
    const lines = ledgerLines(
      redemption(900, [
        { id: 'c', type: 'CONFIRMED', discountDeltaMinor: 0, createdAt: at(1) },
        { id: 'f', type: 'REFUNDED', discountDeltaMinor: -300, createdAt: at(2) },
        { id: 'x', type: 'CANCELLED', discountDeltaMinor: -900, createdAt: at(3) },
      ]),
    );
    for (const p of ['bank', 'merchant', 'waffarha']) expect(net(lines, p)).toBe(0);
    expect(lines.filter((l) => l.eventId === 'x').reduce((s, l) => s + l.amountMinor, 0)).toBe(
      -600,
    );
  });
});
