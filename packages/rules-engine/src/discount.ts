import { percentOf } from '@instant-discount/shared';
import type { DiscountConfig, DiscountTier } from './types';

export type DiscountResult =
  { ok: true; discountMinor: number } | { ok: false; reason: 'BELOW_MIN_SPEND' };

/** Computes the discount for an amount. Never exceeds the amount itself. */
export function computeDiscount(config: DiscountConfig, amountMinor: number): DiscountResult {
  let discount: number;
  switch (config.type) {
    case 'PERCENT':
      if (amountMinor < (config.minSpendMinor ?? 0))
        return { ok: false, reason: 'BELOW_MIN_SPEND' };
      discount = applyCap(percentOf(amountMinor, config.percentBps), config.maxDiscountMinor);
      break;
    case 'FIXED':
      if (amountMinor < (config.minSpendMinor ?? 0))
        return { ok: false, reason: 'BELOW_MIN_SPEND' };
      discount = config.amountMinor;
      break;
    case 'TIERED': {
      const tier = pickTier(config.tiers, amountMinor);
      if (!tier) return { ok: false, reason: 'BELOW_MIN_SPEND' };
      discount =
        'percentBps' in tier
          ? applyCap(percentOf(amountMinor, tier.percentBps), tier.maxDiscountMinor)
          : tier.amountMinor;
      break;
    }
  }
  return { ok: true, discountMinor: Math.max(0, Math.min(discount, amountMinor)) };
}

function applyCap(value: number, cap: number | undefined): number {
  return cap === undefined ? value : Math.min(value, cap);
}

/** Highest tier whose minimum spend the amount reaches. */
function pickTier(tiers: DiscountTier[], amountMinor: number): DiscountTier | undefined {
  return tiers
    .filter((t) => amountMinor >= t.minSpendMinor)
    .reduce<DiscountTier | undefined>(
      (best, t) => (!best || t.minSpendMinor > best.minSpendMinor ? t : best),
      undefined,
    );
}
