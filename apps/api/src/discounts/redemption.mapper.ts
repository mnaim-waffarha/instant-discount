import type { Redemption } from '@instant-discount/db';
import type { RedemptionResponse } from './dto';

export function toRedemptionResponse(r: Redemption): RedemptionResponse {
  return {
    redemption_id: r.id,
    status: r.status,
    campaign_id: r.campaignId,
    currency: r.currency,
    original_amount: Number(r.originalAmountMinor),
    discount_amount: Number(r.discountMinor),
    final_amount: Number(r.finalAmountMinor),
    refunded_amount: Number(r.refundedAmountMinor),
    refunded_discount_amount: Number(r.refundedDiscountMinor),
  };
}
