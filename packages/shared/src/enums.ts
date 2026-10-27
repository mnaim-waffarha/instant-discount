export const Currency = { EGP: 'EGP', SAR: 'SAR' } as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

export const Country = { EG: 'EG', SA: 'SA' } as const;
export type Country = (typeof Country)[keyof typeof Country];

export const COUNTRY_DEFAULTS: Record<Country, { currency: Currency; timezone: string }> = {
  EG: { currency: 'EGP', timezone: 'Africa/Cairo' },
  SA: { currency: 'SAR', timezone: 'Asia/Riyadh' },
};

export const CardScheme = {
  VISA: 'VISA',
  MASTERCARD: 'MASTERCARD',
  MEEZA: 'MEEZA',
  MADA: 'MADA',
  AMEX: 'AMEX',
} as const;
export type CardScheme = (typeof CardScheme)[keyof typeof CardScheme];

export const PartnerType = { BANK: 'BANK', MERCHANT: 'MERCHANT', WAFFARHA: 'WAFFARHA' } as const;
export type PartnerType = (typeof PartnerType)[keyof typeof PartnerType];

export const CampaignStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const RedemptionStatus = {
  RESERVED: 'RESERVED',
  CONFIRMED: 'CONFIRMED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;
export type RedemptionStatus = (typeof RedemptionStatus)[keyof typeof RedemptionStatus];
