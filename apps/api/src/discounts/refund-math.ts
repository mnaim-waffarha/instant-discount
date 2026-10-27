export interface RefundState {
  discountMinor: number;
  /** What the customer was charged. */
  finalAmountMinor: number;
  refundedAmountMinor: number;
  refundedDiscountMinor: number;
}

export type RefundOutcome =
  | {
      ok: true;
      discountDeltaMinor: number;
      refundedAmountMinor: number;
      refundedDiscountMinor: number;
      full: boolean;
    }
  | { ok: false; reason: 'REFUND_EXCEEDS_PAID' };

/**
 * A refund of part of what the customer paid reverses the same share of the discount.
 * Reversal is computed on the cumulative refunded amount (not per refund) so rounding never
 * drifts, and a full refund always reverses exactly the whole discount.
 */
export function applyRefund(state: RefundState, refundAmountMinor: number): RefundOutcome {
  const refundedAmount = state.refundedAmountMinor + refundAmountMinor;
  if (refundedAmount > state.finalAmountMinor) return { ok: false, reason: 'REFUND_EXCEEDS_PAID' };

  // A 100%-discounted purchase has nothing to refund but can still be reversed.
  const full = refundedAmount === state.finalAmountMinor;
  const reversed = full
    ? state.discountMinor
    : Math.floor((state.discountMinor * refundedAmount) / state.finalAmountMinor);

  return {
    ok: true,
    discountDeltaMinor: reversed - state.refundedDiscountMinor,
    refundedAmountMinor: refundedAmount,
    refundedDiscountMinor: reversed,
    full,
  };
}
