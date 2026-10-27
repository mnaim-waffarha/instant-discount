import { z } from 'zod';

const minor = z.number().int().nonnegative();

export const inquireSchema = z.object({
  terminal_id: z.string().min(1).max(64),
  /** Acquirer merchant id (MID). Logged only; targeting uses our terminal registry. */
  merchant_id: z.string().max(64).optional(),
  bin: z.string().regex(/^\d{6,8}$/, 'must be 6–8 digits'),
  card_token: z
    .string()
    .min(8)
    .max(256)
    // Defence in depth: we must never receive a card number.
    .refine(
      (v) => !/^\d{13,19}$/.test(v),
      'looks like a card number (PAN); send the acquirer token instead',
    ),
  scheme: z.enum(['VISA', 'MASTERCARD', 'MEEZA', 'MADA', 'AMEX']),
  amount: z.number().int().positive(),
  currency: z.enum(['EGP', 'SAR']),
  acquirer_txn_ref: z.string().min(1).max(64),
});
export type InquireRequest = z.infer<typeof inquireSchema>;

export const confirmSchema = z.object({
  charged_amount: minor,
  auth_code: z.string().max(32).optional(),
});
export type ConfirmRequest = z.infer<typeof confirmSchema>;

export const cancelSchema = z.object({ reason: z.string().max(128).optional() }).default({});
export type CancelRequest = z.infer<typeof cancelSchema>;

export const refundSchema = z.object({
  /** Acquirer's unique id for this refund; repeating it is a no-op. */
  refund_id: z.string().min(1).max(64),
  /** Amount refunded to the customer, out of what they were charged. */
  amount: minor,
});
export type RefundRequest = z.infer<typeof refundSchema>;

export type InquireResponse =
  | {
      eligible: true;
      redemption_id: string;
      campaign_id: string;
      original_amount: number;
      discount_amount: number;
      final_amount: number;
      currency: string;
      expires_at: string;
      display_message: string | null;
      display_message_ar: string | null;
    }
  | { eligible: false; reason: NotEligibleReason };

export type NotEligibleReason =
  | 'UNKNOWN_TERMINAL'
  | 'TERMINAL_INACTIVE'
  | 'NO_ELIGIBLE_CAMPAIGN'
  | 'LIMITS_REACHED'
  | 'UNAVAILABLE';

export interface RedemptionResponse {
  redemption_id: string;
  status: string;
  campaign_id: string;
  currency: string;
  original_amount: number;
  discount_amount: number;
  final_amount: number;
  refunded_amount: number;
  refunded_discount_amount: number;
}
