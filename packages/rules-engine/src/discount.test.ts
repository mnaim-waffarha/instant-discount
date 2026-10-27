import { describe, expect, it } from 'vitest';
import { computeDiscount } from './discount';

describe('computeDiscount', () => {
  it('percent with max cap', () => {
    const cfg = { type: 'PERCENT', percentBps: 2_000, maxDiscountMinor: 20_000 } as const;
    expect(computeDiscount(cfg, 50_000)).toEqual({ ok: true, discountMinor: 10_000 });
    expect(computeDiscount(cfg, 500_000)).toEqual({ ok: true, discountMinor: 20_000 });
  });

  it('fixed amount never exceeds the bill', () => {
    const cfg = { type: 'FIXED', amountMinor: 10_000 } as const;
    expect(computeDiscount(cfg, 50_000)).toEqual({ ok: true, discountMinor: 10_000 });
    expect(computeDiscount(cfg, 6_000)).toEqual({ ok: true, discountMinor: 6_000 });
  });

  it('min spend threshold', () => {
    const cfg = { type: 'FIXED', amountMinor: 10_000, minSpendMinor: 50_000 } as const;
    expect(computeDiscount(cfg, 49_999)).toEqual({ ok: false, reason: 'BELOW_MIN_SPEND' });
    expect(computeDiscount(cfg, 50_000)).toEqual({ ok: true, discountMinor: 10_000 });
  });

  it('tiered picks the highest reached tier, regardless of order', () => {
    const cfg = {
      type: 'TIERED',
      tiers: [
        { minSpendMinor: 100_000, percentBps: 1_500, maxDiscountMinor: 30_000 },
        { minSpendMinor: 50_000, percentBps: 1_000 },
        { minSpendMinor: 300_000, amountMinor: 60_000 },
      ],
    } as const;
    expect(computeDiscount(cfg, 40_000)).toEqual({ ok: false, reason: 'BELOW_MIN_SPEND' });
    expect(computeDiscount(cfg, 50_000)).toEqual({ ok: true, discountMinor: 5_000 });
    expect(computeDiscount(cfg, 100_000)).toEqual({ ok: true, discountMinor: 15_000 });
    expect(computeDiscount(cfg, 250_000)).toEqual({ ok: true, discountMinor: 30_000 });
    expect(computeDiscount(cfg, 300_000)).toEqual({ ok: true, discountMinor: 60_000 });
  });
});
