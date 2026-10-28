import { NOT_ELIGIBLE_REASONS } from '../discounts/dto';
import {
  arr,
  bool,
  dateTime,
  enumOf,
  int,
  money,
  nullable,
  num,
  obj,
  pick,
  ref,
  str,
  uuid,
  withFields,
  type Schema,
} from './schemas';

/** Prisma models documented as component schemas (columns come from the Prisma schema). */
export const MODELS = [
  'Partner',
  'Merchant',
  'Branch',
  'Terminal',
  'Acquirer',
  'Campaign',
  'CampaignVersion',
  'CampaignFunding',
  'CampaignVariant',
  'Redemption',
  'RedemptionEvent',
  'Invoice',
  'InvoiceLine',
  'TaxRate',
  'AuditLog',
  'Alert',
];

const minor = money;

/** Hand-described response shapes that are not a single Prisma model. */
export const COMPONENTS: Record<string, Schema> = {
  Error: obj(
    {
      error: obj({
        code: str('Machine-readable code, e.g. VALIDATION_ERROR, CAMPAIGN_NOT_FOUND'),
        message: str('Human-readable explanation'),
      }),
    },
    'all',
    'Every error response has this shape.',
  ),

  // Acquirer API
  Eligible: obj(
    {
      eligible: { type: 'boolean', const: true },
      redemption_id: uuid(),
      campaign_id: uuid(),
      original_amount: minor(),
      discount_amount: minor(),
      final_amount: minor('Charge this amount'),
      currency: enumOf(['EGP', 'SAR']),
      expires_at: dateTime('Confirm before this time'),
      display_message: nullable(str('Optional text for the POS screen / receipt')),
      display_message_ar: nullable(str()),
    },
    'all',
    'A discount applies and has been reserved.',
  ),
  NotEligible: obj(
    {
      eligible: { type: 'boolean', const: false },
      reason: enumOf(
        NOT_ELIGIBLE_REASONS,
        'Why no discount applies. Charge the full amount in every case. Holdout cards of an experiment get NO_ELIGIBLE_CAMPAIGN.',
      ),
    },
    'all',
    'No discount: charge the full amount.',
  ),
  RedemptionView: obj(
    {
      redemption_id: uuid(),
      status: ref('RedemptionStatus'),
      campaign_id: uuid(),
      currency: enumOf(['EGP', 'SAR']),
      original_amount: minor(),
      discount_amount: minor(),
      final_amount: minor(),
      refunded_amount: minor(),
      refunded_discount_amount: minor(),
    },
    'all',
    'Current state of a redemption, as the acquirer sees it.',
  ),

  // Admin
  User: obj({
    id: uuid(),
    email: str(undefined, { format: 'email' }),
    name: str(),
    role: ref('UserRole'),
    partnerId: nullable(uuid('Set for partner users')),
    locale: enumOf(['en', 'ar']),
    active: bool(),
    lastLoginAt: nullable(dateTime()),
    createdAt: dateTime(),
  }),
  /** What campaign mutations return. */
  CampaignWithRelations: withFields('Campaign', {
    fundings: arr(ref('CampaignFunding')),
    variants: arr(ref('CampaignVariant'), 'A/B variants, ordered by key; empty when no test'),
  }),
  /** GET /campaigns/:id: also names each funder and lists the approved versions. */
  CampaignDetail: withFields('Campaign', {
    fundings: arr(
      withFields('CampaignFunding', { partner: pick('Partner', ['id', 'name', 'type']) }),
    ),
    variants: arr(ref('CampaignVariant'), 'A/B variants, ordered by key; empty when no test'),
    versions: arr(pick('CampaignVersion', ['version', 'createdAt'])),
  }),
  CampaignStats: obj({
    campaignId: uuid(),
    currency: enumOf(['EGP', 'SAR']),
    budget: obj({
      totalMinor: nullable(minor('null = unlimited')),
      usedMinor: minor(),
      remainingMinor: nullable(minor()),
      usedPct: nullable(num()),
    }),
    uniqueCards: obj({
      used: nullable(int('null until the live counters exist')),
      max: nullable(int()),
    }),
    redemptionsByStatus: {
      type: 'object',
      additionalProperties: int(),
      description: 'Count per RedemptionStatus',
    },
    confirmRate: nullable(num('Confirmed ÷ decided reservations, %')),
    daily: arr(obj({ day: str('YYYY-MM-DD'), redemptions: int(), discountMinor: minor() })),
    topTerminals: arr(
      obj({
        terminalId: uuid(),
        externalTerminalId: nullable(str()),
        redemptions: int(),
        discountMinor: minor(),
      }),
    ),
  }),
  SimulationResult: obj({
    terminal: obj({
      id: uuid(),
      externalTerminalId: str(),
      merchantId: uuid(),
      mcc: str(),
      country: enumOf(['EG', 'SA']),
      currency: enumOf(['EGP', 'SAR']),
    }),
    at: dateTime(),
    winnerCampaignId: nullable(uuid('The campaign a real payment would get right now')),
    results: arr(
      obj({
        campaignId: uuid(),
        name: str(),
        group: nullable(str('With cardToken: HOLDOUT, A, B or C')),
        heldOut: bool(),
        status: ref('CampaignStatus'),
        priority: int(),
        eligible: bool(),
        reason: nullable(str('Why the campaign does not apply')),
        discountMinor: nullable(minor()),
        finalAmountMinor: nullable(minor()),
        cappedBy: nullable(str('Limit that would block the discount')),
        headroom: obj({
          budgetMinor: nullable(minor()),
          uniqueCards: nullable(int()),
          dailyBudgetMinor: nullable(minor()),
          dailyRedemptions: nullable(int()),
        }),
      }),
    ),
  }),
  Comparison: obj({
    diff: num('treated − control, minor units per card'),
    se: num(),
    ci95: arr(num(), '[low, high]'),
    z: nullable(num()),
    pValue: num(),
    relative: nullable(num('diff ÷ control mean')),
    significant: bool(),
  }),
  PerformanceReport: obj({
    campaignId: uuid(),
    currency: enumOf(['EGP', 'SAR']),
    from: dateTime(),
    to: dateTime(),
    holdoutBps: int(),
    variants: arr(obj({ key: str(), name: str(), weightBps: int() })),
    groups: arr(
      obj({
        group: str('HOLDOUT, A, B or C'),
        cards: int(),
        payments: int(),
        spendMinor: minor(),
        spendPerCardMinor: minor(),
        spendPerCardCi95: nullable(arr(num())),
        avgBasketMinor: minor(),
        paymentsPerCard: num(),
        repeatRatePct: num(),
        discountMinor: minor(),
        costPerPaymentMinor: nullable(minor()),
      }),
    ),
    uplift: arr(
      obj({
        group: str(),
        vsHoldout: nullable({
          allOf: [
            ref('Comparison'),
            obj({
              incrementalSpendMinor: minor(),
              incrementalCi95: arr(num()),
              roi: nullable(num('Incremental spend ÷ discount cost')),
            }),
          ],
        }),
        vsControl: nullable(ref('Comparison')),
      }),
    ),
    enoughData: bool('Every group has at least minCardsPerGroup cards'),
    minCardsPerGroup: int(),
    winner: nullable(str('Variant with the best significant net return')),
  }),
  InquirySummary: obj({
    from: dateTime(),
    to: dateTime(),
    total: int(),
    granted: int(),
    reasons: arr(obj({ reason: nullable(str()), count: int() })),
    latencyMs: obj({ p50: nullable(num()), p95: nullable(num()), p99: nullable(num()) }),
  }),
  TerminalImportResult: obj({
    dryRun: bool('true when nothing was written (dry run, or any row had an error)'),
    valid: int(),
    errors: arr(obj({ line: int(), message: str() })),
    imported: int(),
  }),
  SettlementOverview: obj({
    country: enumOf(['EG', 'SA']),
    period: str('YYYY-MM'),
    periodStart: dateTime(),
    periodEnd: dateTime(),
    funders: arr(
      obj({
        partnerId: uuid(),
        partnerName: str(),
        partnerType: ref('PartnerType'),
        settlementMode: ref('SettlementMode'),
        currency: enumOf(['EGP', 'SAR']),
        fundedMinor: minor(),
        redemptions: int(),
      }),
    ),
  }),
  DocumentDetail: withFields('Invoice', {
    lines: arr(ref('InvoiceLine')),
    partner: ref('Partner'),
  }),
  PortalCampaign: obj({
    id: uuid(),
    name: str(),
    nameAr: nullable(str()),
    status: ref('CampaignStatus'),
    currency: enumOf(['EGP', 'SAR']),
    startAt: dateTime(),
    endAt: dateTime(),
    timezone: str(),
    discountConfig: { description: 'Discount rule (see CampaignInput.discount)' },
    fundings: arr(obj({ shareBps: int() })),
    shareBps: int('Your funding share, basis points (0 if you only host it)'),
    redemptions: int(),
    discountMinor: minor('Discount given, net of refunds'),
    partnerShareMinor: minor('Your share of the discount, net of refunds'),
  }),
  PortalRedemption: obj({
    id: uuid(),
    createdAt: dateTime(),
    status: ref('RedemptionStatus'),
    bin: str(),
    currency: enumOf(['EGP', 'SAR']),
    merchant: str(),
    terminal: str('Terminal id (TID)'),
    originalAmountMinor: minor(),
    discountMinor: minor(),
    refundedDiscountMinor: minor(),
    partnerShareMinor: minor(),
  }),
  Health: obj({
    status: enumOf(['ok', 'degraded']),
    db: enumOf(['ok', 'down']),
    redis: enumOf(['ok', 'down']),
  }),
};
