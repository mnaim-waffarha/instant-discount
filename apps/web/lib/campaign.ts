import type { MessageKey } from '@/messages/en';
import { fromMinor, toMinor, utcToZoned, zonedToUtc } from './format';
import type { Campaign, CampaignInput, Country, DiscountConfig, Scheme } from './types';

export function discountLabel(
  c: { discountConfig: DiscountConfig; currency: string },
  t: (k: MessageKey) => string,
): string {
  const d = c.discountConfig;
  if (d.type === 'PERCENT') return `${d.percentBps / 100}%`;
  if (d.type === 'FIXED') return `${d.amountMinor / 100} ${c.currency}`;
  return `${t('wizard.type.TIERED')} (${d.tiers.length})`;
}

export const COUNTRY = {
  EG: { currency: 'EGP', timezone: 'Africa/Cairo' },
  SA: { currency: 'SAR', timezone: 'Asia/Riyadh' },
} as const;

export const SCHEMES: Scheme[] = ['VISA', 'MASTERCARD', 'MEEZA', 'MADA', 'AMEX'];

/** Wizard form state: everything as strings, exactly as typed. Money is in major units. */
export interface CampaignForm {
  name: string;
  nameAr: string;
  description: string;
  country: Country;
  priority: string;
  displayMessage: string;
  displayMessageAr: string;
  settlementMode: CampaignInput['settlementMode'];
  discountType: DiscountConfig['type'];
  percent: string;
  maxDiscount: string;
  minSpend: string;
  fixedAmount: string;
  tiers: Array<{ minSpend: string; percent: string; amount: string; maxDiscount: string }>;
  bins: Array<{ from: string; to: string }>;
  schemes: Scheme[];
  merchantIds: string[];
  excludeTerminalIds: string[];
  mccs: string;
  totalBudget: string;
  maxCards: string;
  dailyBudget: string;
  dailyCount: string;
  perCardCount: string;
  perCardAmount: string;
  perCardPeriod: 'DAY' | 'WEEK' | 'CAMPAIGN';
  fundings: Array<{ partnerId: string; share: string }>;
  startAt: string;
  endAt: string;
  windows: Array<{ days: number[]; start: string; end: string }>;
}

export function emptyForm(country: Country = 'EG'): CampaignForm {
  const tz = COUNTRY[country].timezone;
  const start = new Date(Date.now() + 86_400_000);
  start.setUTCMinutes(0, 0, 0);
  return {
    name: '',
    nameAr: '',
    description: '',
    country,
    priority: '10',
    displayMessage: '',
    displayMessageAr: '',
    settlementMode: 'WAFFARHA_COLLECTS',
    discountType: 'PERCENT',
    percent: '20',
    maxDiscount: '',
    minSpend: '',
    fixedAmount: '',
    tiers: [{ minSpend: '', percent: '', amount: '', maxDiscount: '' }],
    bins: [],
    schemes: [],
    merchantIds: [],
    excludeTerminalIds: [],
    mccs: '',
    totalBudget: '',
    maxCards: '',
    dailyBudget: '',
    dailyCount: '',
    perCardCount: '',
    perCardAmount: '',
    perCardPeriod: 'CAMPAIGN',
    fundings: [{ partnerId: '', share: '100' }],
    startAt: utcToZoned(start, tz),
    endAt: utcToZoned(new Date(start.getTime() + 30 * 86_400_000), tz),
    windows: [],
  };
}

const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Loads a campaign (or its pending change) into the form. */
export function formFromInput(c: CampaignInput): CampaignForm {
  const d = c.discount;
  const base = emptyForm(c.country);
  return {
    ...base,
    name: c.name,
    nameAr: c.nameAr ?? '',
    description: c.description ?? '',
    country: c.country,
    priority: String(c.priority),
    displayMessage: c.displayMessage ?? '',
    displayMessageAr: c.displayMessageAr ?? '',
    settlementMode: c.settlementMode,
    discountType: d.type,
    percent: d.type === 'PERCENT' ? String(d.percentBps / 100) : base.percent,
    maxDiscount: d.type === 'PERCENT' ? fromMinor(d.maxDiscountMinor) : '',
    minSpend: d.type !== 'TIERED' ? fromMinor(d.minSpendMinor) : '',
    fixedAmount: d.type === 'FIXED' ? fromMinor(d.amountMinor) : '',
    tiers:
      d.type === 'TIERED'
        ? d.tiers.map((tier) => ({
            minSpend: fromMinor(tier.minSpendMinor),
            percent: 'percentBps' in tier ? String(tier.percentBps / 100) : '',
            amount: 'amountMinor' in tier ? fromMinor(tier.amountMinor) : '',
            maxDiscount: 'percentBps' in tier ? fromMinor(tier.maxDiscountMinor) : '',
          }))
        : base.tiers,
    bins: c.targeting.binRanges ?? [],
    schemes: c.targeting.schemes ?? [],
    merchantIds: c.targeting.merchantIds ?? [],
    excludeTerminalIds: c.targeting.excludeTerminalIds ?? [],
    mccs: (c.targeting.mccs ?? []).join(', '),
    totalBudget: fromMinor(c.limits.totalBudgetMinor),
    maxCards: s(c.limits.maxUniqueCards),
    dailyBudget: fromMinor(c.limits.dailyBudgetMinor),
    dailyCount: s(c.limits.dailyRedemptionLimit),
    perCardCount: s(c.limits.perCardMaxCount),
    perCardAmount: fromMinor(c.limits.perCardMaxAmountMinor),
    perCardPeriod: c.limits.perCardPeriod,
    fundings: c.fundings.map((f) => ({ partnerId: f.partnerId, share: String(f.shareBps / 100) })),
    startAt: utcToZoned(c.startAt, c.timezone),
    endAt: utcToZoned(c.endAt, c.timezone),
    windows: (c.schedule ?? []).map((w) => ({
      days: w.daysOfWeek,
      start: hhmm(w.startMinute),
      end: hhmm(w.endMinute === 1440 ? 1439 : w.endMinute),
    })),
  };
}

export function campaignToInput(c: Campaign): CampaignInput {
  return {
    name: c.name,
    nameAr: c.nameAr ?? undefined,
    description: c.description ?? undefined,
    country: c.country,
    currency: c.currency,
    timezone: c.timezone,
    startAt: c.startAt,
    endAt: c.endAt,
    priority: c.priority,
    discount: c.discountConfig,
    targeting: c.targeting,
    schedule: c.schedule,
    displayMessage: c.displayMessage ?? undefined,
    displayMessageAr: c.displayMessageAr ?? undefined,
    limits: {
      totalBudgetMinor: c.totalBudgetMinor,
      maxUniqueCards: c.maxUniqueCards,
      dailyBudgetMinor: c.dailyBudgetMinor,
      dailyRedemptionLimit: c.dailyRedemptionLimit,
      perCardMaxCount: c.perCardMaxCount,
      perCardMaxAmountMinor: c.perCardMaxAmountMinor,
      perCardPeriod: c.perCardPeriod ?? 'CAMPAIGN',
    },
    fundings: c.fundings.map((f) => ({ partnerId: f.partnerId, shareBps: f.shareBps })),
    settlementMode: c.settlementMode,
  };
}

const int = (v: string) => (v.trim() ? Math.round(Number(v)) : null);
const bps = (percent: string) => Math.round(Number(percent) * 100);
const minutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Form → API payload. The server does the real validation and reports every problem. */
export function formToInput(f: CampaignForm): CampaignInput {
  const { currency, timezone } = COUNTRY[f.country];
  const opt = (v: string) => toMinor(v) ?? undefined;
  let discount: DiscountConfig;
  if (f.discountType === 'PERCENT') {
    discount = {
      type: 'PERCENT',
      percentBps: bps(f.percent),
      maxDiscountMinor: opt(f.maxDiscount),
      minSpendMinor: opt(f.minSpend),
    };
  } else if (f.discountType === 'FIXED') {
    discount = {
      type: 'FIXED',
      amountMinor: toMinor(f.fixedAmount) ?? 0,
      minSpendMinor: opt(f.minSpend),
    };
  } else {
    discount = {
      type: 'TIERED',
      tiers: f.tiers.map((tier) =>
        tier.percent.trim()
          ? {
              minSpendMinor: toMinor(tier.minSpend) ?? 0,
              percentBps: bps(tier.percent),
              maxDiscountMinor: opt(tier.maxDiscount),
            }
          : { minSpendMinor: toMinor(tier.minSpend) ?? 0, amountMinor: toMinor(tier.amount) ?? 0 },
      ),
    };
  }
  const mccs = f.mccs.split(/[\s,]+/).filter(Boolean);
  return {
    name: f.name.trim(),
    nameAr: f.nameAr.trim() || undefined,
    description: f.description.trim() || undefined,
    country: f.country,
    currency,
    timezone,
    startAt: zonedToUtc(f.startAt, timezone).toISOString(),
    endAt: zonedToUtc(f.endAt, timezone).toISOString(),
    priority: int(f.priority) ?? 0,
    discount,
    targeting: {
      binRanges: f.bins.length
        ? f.bins.map((b) => ({ from: b.from.trim(), to: (b.to || b.from).trim() }))
        : undefined,
      schemes: f.schemes.length ? f.schemes : undefined,
      merchantIds: f.merchantIds.length ? f.merchantIds : undefined,
      excludeTerminalIds: f.excludeTerminalIds.length ? f.excludeTerminalIds : undefined,
      mccs: mccs.length ? mccs : undefined,
    },
    schedule: f.windows.length
      ? f.windows.map((w) => ({
          daysOfWeek: w.days,
          startMinute: minutes(w.start),
          endMinute: w.end === '23:59' ? 1440 : minutes(w.end),
        }))
      : null,
    displayMessage: f.displayMessage.trim() || undefined,
    displayMessageAr: f.displayMessageAr.trim() || undefined,
    limits: {
      totalBudgetMinor: toMinor(f.totalBudget),
      maxUniqueCards: int(f.maxCards),
      dailyBudgetMinor: toMinor(f.dailyBudget),
      dailyRedemptionLimit: int(f.dailyCount),
      perCardMaxCount: int(f.perCardCount),
      perCardMaxAmountMinor: toMinor(f.perCardAmount),
      perCardPeriod: f.perCardPeriod,
    },
    fundings: f.fundings
      .filter((x) => x.partnerId)
      .map((x) => ({ partnerId: x.partnerId, shareBps: bps(x.share) })),
    settlementMode: f.settlementMode,
  };
}
