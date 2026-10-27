import { describe, expect, it } from 'vitest';
import { evaluateCampaign, rankCampaigns } from './engine';
import type { CampaignRule, TransactionContext } from './types';

const now = new Date('2026-10-27T10:00:00Z');

const txn: TransactionContext = {
  country: 'EG',
  currency: 'EGP',
  amountMinor: 100_000,
  bin: '41234567',
  scheme: 'VISA',
  merchantId: 'm1',
  branchId: 'b1',
  terminalId: 't1',
  mcc: '5812',
};

function campaign(overrides: Partial<CampaignRule> = {}): CampaignRule {
  return {
    id: 'c1',
    version: 1,
    status: 'ACTIVE',
    priority: 10,
    country: 'EG',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
    startAt: new Date('2026-10-01T00:00:00Z'),
    endAt: new Date('2026-11-01T00:00:00Z'),
    discount: { type: 'PERCENT', percentBps: 2_000, maxDiscountMinor: 15_000 },
    targeting: { binRanges: [{ from: '412345', to: '412345' }], mccs: ['5812'] },
    ...overrides,
  };
}

describe('evaluateCampaign', () => {
  it('grants an eligible discount', () => {
    expect(evaluateCampaign(campaign(), txn, now)).toEqual({
      eligible: true,
      campaignId: 'c1',
      discountMinor: 15_000,
      finalAmountMinor: 85_000,
    });
  });

  it.each([
    [{ status: 'PAUSED' }, 'NOT_ACTIVE'],
    [{ endAt: new Date('2026-10-27T09:00:00Z') }, 'OUTSIDE_DATES'],
    [{ country: 'SA', currency: 'SAR' }, 'COUNTRY_MISMATCH'],
    [{ targeting: { binRanges: [{ from: '555555', to: '555555' }] } }, 'BIN_NOT_TARGETED'],
    [{ targeting: { schemes: ['MEEZA'] } }, 'SCHEME_NOT_TARGETED'],
    [{ targeting: { merchantIds: ['m2'] } }, 'MERCHANT_NOT_TARGETED'],
    [{ targeting: { excludeTerminalIds: ['t1'] } }, 'TERMINAL_EXCLUDED'],
    [{ targeting: { mccs: ['5411'] } }, 'MCC_NOT_TARGETED'],
    [{ schedule: [{ daysOfWeek: [5], startMinute: 0, endMinute: 1440 }] }, 'OUTSIDE_SCHEDULE'],
    [
      { discount: { type: 'FIXED', amountMinor: 5_000, minSpendMinor: 200_000 } },
      'BELOW_MIN_SPEND',
    ],
  ] as const)('rejects %o with %s', (overrides, reason) => {
    expect(evaluateCampaign(campaign(overrides as Partial<CampaignRule>), txn, now)).toMatchObject({
      eligible: false,
      reason,
    });
  });
});

describe('rankCampaigns', () => {
  it('orders by priority, then discount, and reports rejections', () => {
    const result = rankCampaigns(
      [
        campaign({ id: 'low', priority: 1, discount: { type: 'FIXED', amountMinor: 50_000 } }),
        campaign({
          id: 'high-small',
          priority: 5,
          discount: { type: 'FIXED', amountMinor: 1_000 },
        }),
        campaign({ id: 'high-big', priority: 5, discount: { type: 'FIXED', amountMinor: 2_000 } }),
        campaign({ id: 'off', status: 'DRAFT' }),
      ],
      txn,
      now,
    );
    expect(result.eligible.map((e) => e.campaignId)).toEqual(['high-big', 'high-small', 'low']);
    expect(result.rejected).toEqual([{ eligible: false, campaignId: 'off', reason: 'NOT_ACTIVE' }]);
  });
});
