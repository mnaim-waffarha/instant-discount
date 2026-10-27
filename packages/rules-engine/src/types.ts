import type { CampaignStatus, CardScheme, Country, Currency } from '@instant-discount/shared';

/** Amounts are integer minor units; percentages are basis points (20% = 2000). */
export type DiscountConfig =
  | { type: 'PERCENT'; percentBps: number; maxDiscountMinor?: number; minSpendMinor?: number }
  | { type: 'FIXED'; amountMinor: number; minSpendMinor?: number }
  | { type: 'TIERED'; tiers: DiscountTier[] };

export type DiscountTier =
  | { minSpendMinor: number; percentBps: number; maxDiscountMinor?: number }
  | { minSpendMinor: number; amountMinor: number };

export interface BinRange {
  /** Inclusive, 6–8 digits. A single BIN is from === to. */
  from: string;
  to: string;
}

export interface Targeting {
  binRanges?: BinRange[];
  schemes?: CardScheme[];
  merchantIds?: string[];
  branchIds?: string[];
  terminalIds?: string[];
  excludeTerminalIds?: string[];
  mccs?: string[];
}

/** Recurring window in the campaign's timezone. Days: 0 = Sunday … 6 = Saturday. */
export interface ScheduleWindow {
  daysOfWeek: number[];
  /** Minutes from local midnight, start inclusive, end exclusive. */
  startMinute: number;
  endMinute: number;
}

export interface CampaignRule {
  id: string;
  version: number;
  status: CampaignStatus;
  priority: number;
  country: Country;
  currency: Currency;
  timezone: string;
  startAt: Date;
  endAt: Date;
  discount: DiscountConfig;
  targeting: Targeting;
  /** Empty or missing = active all day, every day. */
  schedule?: ScheduleWindow[];
}

export interface TransactionContext {
  country: Country;
  currency: Currency;
  amountMinor: number;
  bin: string;
  scheme: CardScheme;
  merchantId: string;
  branchId?: string;
  terminalId: string;
  mcc: string;
}

export const RejectReason = {
  NOT_ACTIVE: 'NOT_ACTIVE',
  OUTSIDE_DATES: 'OUTSIDE_DATES',
  OUTSIDE_SCHEDULE: 'OUTSIDE_SCHEDULE',
  COUNTRY_MISMATCH: 'COUNTRY_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  BIN_NOT_TARGETED: 'BIN_NOT_TARGETED',
  SCHEME_NOT_TARGETED: 'SCHEME_NOT_TARGETED',
  MERCHANT_NOT_TARGETED: 'MERCHANT_NOT_TARGETED',
  BRANCH_NOT_TARGETED: 'BRANCH_NOT_TARGETED',
  TERMINAL_NOT_TARGETED: 'TERMINAL_NOT_TARGETED',
  TERMINAL_EXCLUDED: 'TERMINAL_EXCLUDED',
  MCC_NOT_TARGETED: 'MCC_NOT_TARGETED',
  BELOW_MIN_SPEND: 'BELOW_MIN_SPEND',
  ZERO_DISCOUNT: 'ZERO_DISCOUNT',
} as const;
export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];

export type Evaluation =
  | { eligible: true; campaignId: string; discountMinor: number; finalAmountMinor: number }
  | { eligible: false; campaignId: string; reason: RejectReason };
