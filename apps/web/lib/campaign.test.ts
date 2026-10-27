import { describe, expect, it } from 'vitest';
import { emptyForm, formFromInput, formToInput } from './campaign';

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
});
