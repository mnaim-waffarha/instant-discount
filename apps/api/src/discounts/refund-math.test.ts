import { describe, expect, it } from 'vitest';
import { applyRefund } from './refund-math';

const base = {
  discountMinor: 10_000,
  finalAmountMinor: 30_000,
  refundedAmountMinor: 0,
  refundedDiscountMinor: 0,
};

describe('applyRefund', () => {
  it('reverses the discount proportionally', () => {
    expect(applyRefund(base, 15_000)).toEqual({
      ok: true,
      discountDeltaMinor: 5_000,
      refundedAmountMinor: 15_000,
      refundedDiscountMinor: 5_000,
      full: false,
    });
  });

  it('reverses exactly the whole discount on the last refund despite rounding', () => {
    const first = applyRefund({ ...base, discountMinor: 1_000 }, 10_000);
    expect(first).toMatchObject({ ok: true, refundedDiscountMinor: 333 });
    const second = applyRefund(
      { ...base, discountMinor: 1_000, refundedAmountMinor: 10_000, refundedDiscountMinor: 333 },
      20_000,
    );
    expect(second).toMatchObject({
      ok: true,
      discountDeltaMinor: 667,
      refundedDiscountMinor: 1_000,
      full: true,
    });
  });

  it('rejects refunding more than was paid', () => {
    expect(applyRefund({ ...base, refundedAmountMinor: 20_000 }, 10_001)).toEqual({
      ok: false,
      reason: 'REFUND_EXCEEDS_PAID',
    });
  });

  it('handles a fully discounted purchase', () => {
    expect(applyRefund({ ...base, finalAmountMinor: 0 }, 0)).toMatchObject({
      ok: true,
      discountDeltaMinor: 10_000,
      full: true,
    });
  });
});
