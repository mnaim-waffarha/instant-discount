import { z } from 'zod';

const minor = z.number().int().nonnegative();
const bps = z.number().int().min(1).max(10_000);
const digits = z.string().regex(/^\d{6,8}$/, 'BIN must be 6–8 digits');

const percentTier = z.object({
  minSpendMinor: minor,
  percentBps: bps,
  maxDiscountMinor: minor.optional(),
});
const fixedTier = z.object({ minSpendMinor: minor, amountMinor: minor });

export const discountConfigSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('PERCENT'),
      percentBps: bps.describe('Percentage off, basis points (15% = 1500)'),
      maxDiscountMinor: minor.optional().describe('Cap per payment, minor units'),
      minSpendMinor: minor.optional().describe('Minimum purchase, minor units'),
    }),
    z.object({
      type: z.literal('FIXED'),
      amountMinor: minor.describe('Amount off, minor units'),
      minSpendMinor: minor.optional().describe('Minimum purchase, minor units'),
    }),
    z.object({
      type: z.literal('TIERED'),
      tiers: z
        .array(z.union([percentTier, fixedTier]))
        .min(1)
        .describe('The highest tier whose minSpendMinor the purchase reaches applies'),
    }),
  ])
  .describe('Percent (optionally capped), fixed amount, or tiered by spend');

export const targetingSchema = z
  .object({
    binRanges: z
      .array(z.object({ from: digits, to: digits }).refine((r) => r.from <= r.to, 'from > to'))
      .optional(),
    schemes: z.array(z.enum(['VISA', 'MASTERCARD', 'MEEZA', 'MADA', 'AMEX'])).optional(),
    merchantIds: z.array(z.string()).optional(),
    branchIds: z.array(z.string()).optional(),
    terminalIds: z.array(z.string()).optional(),
    excludeTerminalIds: z.array(z.string()).optional(),
    mccs: z.array(z.string().regex(/^\d{4}$/)).optional(),
  })
  .describe(
    'Every field is optional; an omitted field matches everything. Fields combine with AND.',
  );

export const scheduleSchema = z
  .array(
    z
      .object({
        daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
      })
      .refine((w) => w.startMinute < w.endMinute, 'startMinute must be before endMinute'),
  )
  .describe(
    'Active windows in the campaign timezone. daysOfWeek: 0 = Sunday … 6 = Saturday; minutes from midnight, endMinute 1440 = end of day.',
  );
