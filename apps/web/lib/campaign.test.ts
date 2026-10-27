import { describe, expect, it } from 'vitest';
import { emptyDiscount, emptyForm, formFromInput, formToInput } from './campaign';

describe('campaign form', () => {
  it('round-trips a full campaign through the form', () => {
    const form = {
      ...emptyForm('SA'),
      name: 'Mada 10%',
      discountType: 'TIERED' as const,
      tiers: [
        { minSpend: '100', percent: '10', amount: '', maxDiscount: '50' },
        { minSpend: '500', percent: '', amount: '75', maxDiscount: '' },
      ],
      bins: [{ from: '440647', to: '' }],
      schemes: ['MADA' as const],
      mccs: '5812, 5814',
      totalBudget: '10000',
      perCardCount: '2',
      perCardPeriod: 'WEEK' as const,
      fundings: [
        { partnerId: '11111111-1111-1111-1111-111111111111', share: '60' },
        { partnerId: '22222222-2222-2222-2222-222222222222', share: '40' },
      ],
      startAt: '2026-11-01T10:00',
      endAt: '2026-12-01T10:00',
      windows: [{ days: [0, 1, 2, 3, 4], start: '12:00', end: '23:59' }],
    };
    const input = formToInput(form);
    expect(input).toMatchObject({
      currency: 'SAR',
      timezone: 'Asia/Riyadh',
      startAt: '2026-11-01T07:00:00.000Z',
      discount: {
        type: 'TIERED',
        tiers: [
          { minSpendMinor: 10_000, percentBps: 1_000, maxDiscountMinor: 5_000 },
          { minSpendMinor: 50_000, amountMinor: 7_500 },
        ],
      },
      targeting: {
        binRanges: [{ from: '440647', to: '440647' }],
        schemes: ['MADA'],
        mccs: ['5812', '5814'],
      },
      limits: {
        totalBudgetMinor: 1_000_000,
        perCardMaxCount: 2,
        perCardPeriod: 'WEEK',
        maxUniqueCards: null,
      },
      fundings: [{ shareBps: 6_000 }, { shareBps: 4_000 }],
      schedule: [{ daysOfWeek: [0, 1, 2, 3, 4], startMinute: 720, endMinute: 1440 }],
    });
    expect(formToInput(formFromInput(input))).toEqual(input);
  });

  it('round-trips a holdout and an A/B test', () => {
    const form = {
      ...emptyForm('EG'),
      name: 'A/B',
      percent: '10',
      maxDiscount: '50',
      holdoutPct: '10',
      abTest: true,
      variantAName: 'Ten',
      variantAWeight: '50',
      variants: [
        {
          key: 'B' as const,
          name: 'Fixed',
          weight: '50',
          fields: {
            ...emptyDiscount(),
            discountType: 'FIXED' as const,
            fixedAmount: '40',
            minSpend: '300',
          },
        },
      ],
      fundings: [{ partnerId: '11111111-1111-1111-1111-111111111111', share: '100' }],
    };
    const input = formToInput(form);
    expect(input.holdoutBps).toBe(1000);
    expect(input.variants).toEqual([
      {
        key: 'A',
        name: 'Ten',
        weightBps: 5000,
        discount: {
          type: 'PERCENT',
          percentBps: 1000,
          maxDiscountMinor: 5000,
          minSpendMinor: undefined,
        },
      },
      {
        key: 'B',
        name: 'Fixed',
        weightBps: 5000,
        discount: { type: 'FIXED', amountMinor: 4000, minSpendMinor: 30000 },
      },
    ]);
    const back = formFromInput(input);
    expect(back).toMatchObject({
      holdoutPct: '10',
      abTest: true,
      variantAName: 'Ten',
      percent: '10',
    });
    expect(back.variants[0]).toMatchObject({
      key: 'B',
      weight: '50',
      fields: { discountType: 'FIXED', fixedAmount: '40', minSpend: '300' },
    });
    expect(formToInput(back)).toEqual(input);
  });

  it('sends no variants when the A/B test is off', () => {
    const input = formToInput({ ...emptyForm(), abTest: false });
    expect(input.variants).toEqual([]);
    expect(input.holdoutBps).toBe(0);
  });
});
