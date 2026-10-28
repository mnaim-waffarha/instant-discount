import { splitByShares } from '@instant-discount/shared';

export interface LedgerInput {
  discountMinor: number;
  /** As captured at reservation; order matters (the split's remainder goes to the first share). */
  fundingSnapshot: Array<{ partnerId: string; shareBps: number; amountMinor: number }>;
  /** All events of the redemption, oldest first. */
  events: Array<{ id: string; type: string; discountDeltaMinor: number; createdAt: Date }>;
}

export interface LedgerLine {
  eventId: string;
  partnerId: string;
  amountMinor: number;
  countDelta: number;
  eventAt: Date;
}

/**
 * Turns a redemption's event history into each funder's signed share per event.
 *
 * - CONFIRMED: +each funder's reserved share, count +1.
 * - REFUNDED / CANCELLED after confirmation: the reversal is computed on the cumulative
 *   reversed discount (split(cumulative) − split(previous cumulative)), using the same split as
 *   the reservation, so a full reversal always nets every funder back to exactly zero.
 * - Reservations, expiries and cancellations before confirmation never reach the ledger.
 */
export function ledgerLines(r: LedgerInput): LedgerLine[] {
  const shares = r.fundingSnapshot.map((f) => f.shareBps);
  const split = (amount: number) => splitByShares(amount, shares);
  const lines: LedgerLine[] = [];
  let confirmed = false;
  let reversed = 0;

  const reverse = (eventId: string, eventAt: Date, newReversed: number) => {
    const before = split(reversed);
    const after = split(newReversed);
    const full = newReversed >= r.discountMinor;
    r.fundingSnapshot.forEach((f, i) => {
      const amount = -((after[i] ?? 0) - (before[i] ?? 0));
      if (amount !== 0 || full)
        lines.push({
          eventId,
          partnerId: f.partnerId,
          amountMinor: amount,
          countDelta: full ? -1 : 0,
          eventAt,
        });
    });
    reversed = newReversed;
  };

  for (const e of r.events) {
    if (e.type === 'CONFIRMED' && !confirmed) {
      confirmed = true;
      for (const f of r.fundingSnapshot) {
        lines.push({
          eventId: e.id,
          partnerId: f.partnerId,
          amountMinor: f.amountMinor,
          countDelta: 1,
          eventAt: e.createdAt,
        });
      }
    } else if (e.type === 'REFUNDED' && confirmed && reversed < r.discountMinor) {
      reverse(e.id, e.createdAt, Math.min(r.discountMinor, reversed - e.discountDeltaMinor));
    } else if (e.type === 'CANCELLED' && confirmed && reversed < r.discountMinor) {
      reverse(e.id, e.createdAt, r.discountMinor);
    }
  }
  return lines;
}
