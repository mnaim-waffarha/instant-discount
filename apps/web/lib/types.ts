/** Shapes returned by the admin API (amounts are integer minor units). */

export type CampaignStatus =
  'DRAFT' | 'PENDING_APPROVAL' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED';
export type Scheme = 'VISA' | 'MASTERCARD' | 'MEEZA' | 'MADA' | 'AMEX';
export type Country = 'EG' | 'SA';
export type PartnerType = 'BANK' | 'MERCHANT' | 'WAFFARHA';

export type DiscountTier =
  | { minSpendMinor: number; percentBps: number; maxDiscountMinor?: number }
  | { minSpendMinor: number; amountMinor: number };
export type DiscountConfig =
  | { type: 'PERCENT'; percentBps: number; maxDiscountMinor?: number; minSpendMinor?: number }
  | { type: 'FIXED'; amountMinor: number; minSpendMinor?: number }
  | { type: 'TIERED'; tiers: DiscountTier[] };

export interface Targeting {
  binRanges?: Array<{ from: string; to: string }>;
  schemes?: Scheme[];
  merchantIds?: string[];
  branchIds?: string[];
  terminalIds?: string[];
  excludeTerminalIds?: string[];
  mccs?: string[];
}

export interface ScheduleWindow {
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
}

export interface Limits {
  totalBudgetMinor?: number | null;
  maxUniqueCards?: number | null;
  dailyBudgetMinor?: number | null;
  dailyRedemptionLimit?: number | null;
  perCardMaxCount?: number | null;
  perCardMaxAmountMinor?: number | null;
  perCardPeriod: 'DAY' | 'WEEK' | 'CAMPAIGN';
}

export interface CampaignInput {
  name: string;
  nameAr?: string;
  description?: string;
  country: Country;
  currency: 'EGP' | 'SAR';
  timezone: string;
  startAt: string;
  endAt: string;
  priority: number;
  discount: DiscountConfig;
  targeting: Targeting;
  schedule: ScheduleWindow[] | null;
  displayMessage?: string;
  displayMessageAr?: string;
  limits: Limits;
  fundings: Array<{ partnerId: string; shareBps: number }>;
  settlementMode: 'WAFFARHA_COLLECTS' | 'DIRECT';
  autoPauseOnFraud?: boolean;
}

export interface Partner {
  id: string;
  name: string;
  nameAr: string | null;
  type: PartnerType;
  country: Country;
  taxNumber: string | null;
  billingEmail: string | null;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  status: CampaignStatus;
  version: number;
  priority: number;
  country: Country;
  currency: 'EGP' | 'SAR';
  timezone: string;
  startAt: string;
  endAt: string;
  discountType: DiscountConfig['type'];
  discountConfig: DiscountConfig;
  targeting: Targeting;
  schedule: ScheduleWindow[] | null;
  displayMessage: string | null;
  displayMessageAr: string | null;
  totalBudgetMinor: number | null;
  maxUniqueCards: number | null;
  dailyBudgetMinor: number | null;
  dailyRedemptionLimit: number | null;
  perCardMaxCount: number | null;
  perCardMaxAmountMinor: number | null;
  perCardPeriod: Limits['perCardPeriod'] | null;
  settlementMode: CampaignInput['settlementMode'];
  autoPauseOnFraud: boolean;
  createdById: string | null;
  updatedById: string | null;
  submittedById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  pendingChanges: CampaignInput | null;
  pendingById: string | null;
  pendingAt: string | null;
  createdAt: string;
  updatedAt: string;
  fundings: Array<{
    partnerId: string;
    shareBps: number;
    partner?: Pick<Partner, 'id' | 'name' | 'type'>;
  }>;
  versions?: Array<{ version: number; createdAt: string }>;
}

export interface CampaignStats {
  currency: string;
  budget: {
    totalMinor: number | null;
    usedMinor: number;
    remainingMinor: number | null;
    usedPct: number | null;
  };
  uniqueCards: { used: number | null; max: number | null };
  redemptionsByStatus: Record<string, number>;
  confirmRate: number | null;
  daily: Array<{ day: string; redemptions: number; discountMinor: number }>;
  topTerminals: Array<{
    terminalId: string;
    externalTerminalId: string | null;
    redemptions: number;
    discountMinor: number;
  }>;
}

export interface Merchant {
  id: string;
  partnerId: string;
  name: string;
  nameAr: string | null;
  country: Country;
  mcc: string;
  partner?: Pick<Partner, 'id' | 'name'>;
  branches?: Branch[];
  _count?: { branches: number; terminals: number };
}

export interface Branch {
  id: string;
  merchantId: string;
  name: string;
  city: string | null;
}

export interface Terminal {
  id: string;
  acquirerId: string;
  externalTerminalId: string;
  merchantId: string;
  branchId: string | null;
  mcc: string | null;
  active: boolean;
  merchant?: { id: string; name: string };
  branch?: { id: string; name: string } | null;
  acquirer?: { id: string; name: string };
}

export interface Acquirer {
  id: string;
  name: string;
  country: Country;
  apiKeyId: string;
  ipAllowlist: string[];
  certFingerprint: string | null;
  active: boolean;
  terminalCount?: number;
  createdAt: string;
}

export interface Redemption {
  id: string;
  acquirerTxnRef: string;
  campaignId: string;
  campaignVersion: number;
  bin: string;
  scheme: Scheme;
  currency: string;
  originalAmountMinor: number;
  discountMinor: number;
  finalAmountMinor: number;
  refundedAmountMinor: number;
  refundedDiscountMinor: number;
  status: string;
  fundingSnapshot: Array<{ partnerId: string; shareBps: number; amountMinor: number }>;
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
  campaign?: { id: string; name: string; currency?: string };
  terminal?: {
    id: string;
    externalTerminalId: string;
    merchant?: { id: string; name: string };
    branch?: Branch | null;
  };
  acquirer?: { id: string; name: string };
  events?: Array<{
    id: string;
    type: string;
    discountDeltaMinor: number;
    amountMinor: number | null;
    createdAt: string;
    payload: unknown;
  }>;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  partnerId: string | null;
  locale: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InquirySummary {
  total: number;
  granted: number;
  reasons: Array<{ reason: string | null; count: number }>;
  latencyMs: { p50: number | null; p95: number | null; p99: number | null };
}

export type DocumentType = 'INVOICE' | 'PAYOUT_STATEMENT' | 'STATEMENT';
export type DocumentStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'VOID';

export interface SettlementDocument {
  id: string;
  type: DocumentType;
  number: string | null;
  partnerId: string;
  country: Country;
  currency: 'EGP' | 'SAR';
  periodStart: string;
  periodEnd: string;
  subtotalMinor: number;
  vatBps: number;
  vatMinor: number;
  totalMinor: number;
  status: DocumentStatus;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  voidReason: string | null;
  partner?: Pick<Partner, 'id' | 'name' | 'type'> & Partial<Partner>;
  lines?: Array<{
    id: string;
    kind: 'FUNDED_SHARE' | 'OWED_BY_FUNDER' | 'OWN_CONTRIBUTION';
    campaignId: string;
    campaignName: string;
    counterpartyName: string | null;
    redemptionCount: number;
    grossMinor: number;
    reversedMinor: number;
    netMinor: number;
  }>;
}
