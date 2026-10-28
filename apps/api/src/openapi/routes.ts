import { arr, obj, page, pick, ref, str, uuid, withFields, type Schema } from './schemas';

export type SpecName = 'acquirer' | 'admin' | 'ops';
export type Content = 'application/json' | 'text/csv' | 'application/pdf' | 'text/plain';

export interface RouteDoc {
  spec: SpecName;
  tag: string;
  summary: string;
  description?: string;
  operationId?: string;
  /** Success body (JSON unless `content` says otherwise). */
  response?: Schema;
  responseDescription?: string;
  content?: Content;
  /** Extra error responses: status → which codes and when. */
  errors?: Record<number, string>;
  /** Response headers, e.g. Set-Cookie on sign-in. */
  responseHeaders?: Record<string, { description: string }>;
  requestExample?: unknown;
  responseExample?: unknown;
}

const campaign = ref('CampaignWithRelations');
const notFound = (code: string) => ({ 404: code });
const transition = (summary: string, description: string, from: string): RouteDoc => ({
  spec: 'admin',
  tag: 'Campaigns',
  summary,
  description,
  response: campaign,
  errors: { ...notFound('CAMPAIGN_NOT_FOUND'), 409: `INVALID_STATUS (allowed from ${from})` },
});
const sessionCookie = {
  'Set-Cookie': { description: 'The session cookie (HttpOnly, Secure, SameSite=Lax).' },
};

/**
 * One entry per route, keyed "METHOD /path" exactly as the controllers declare it. The
 * generator fails when a route has no entry here or an entry has no route.
 * Request schemas, roles and status codes are not repeated here: they are read from the code.
 */
export const ROUTE_DOCS: Record<string, RouteDoc> = {
  // ── Acquirer API ──────────────────────────────────────────────────────────────────────
  'POST /v1/discounts/inquire': {
    spec: 'acquirer',
    tag: 'Discounts',
    operationId: 'inquireDiscount',
    summary: 'Ask whether a discount applies, and reserve it',
    description:
      'Call before charging the card, with an 800 ms client timeout. If `eligible` is true, charge `final_amount` and confirm; otherwise charge the full amount.',
    response: { oneOf: [ref('Eligible'), ref('NotEligible')] },
    responseDescription: 'Decision. Always 200 for a valid request, eligible or not.',
    errors: {
      409: 'IDEMPOTENCY_IN_PROGRESS: the same Idempotency-Key is still being processed',
      422: 'IDEMPOTENCY_KEY_REUSED: the Idempotency-Key was used with a different body',
    },
    requestExample: {
      terminal_id: 'TID0001',
      merchant_id: 'MID-778',
      bin: '412345',
      card_token: 'tok_4f9c2a71b3',
      scheme: 'VISA',
      amount: 50000,
      currency: 'EGP',
      acquirer_txn_ref: 'TXN-2026-000123',
    },
    responseExample: {
      eligible: true,
      redemption_id: '3f0d6c1e-8a2b-4c7d-9e10-5b6a7c8d9e0f',
      campaign_id: '45781692-824b-4d65-9d5b-c8a63bc12162',
      original_amount: 50000,
      discount_amount: 10000,
      final_amount: 40000,
      currency: 'EGP',
      expires_at: '2026-10-28T10:10:00.000Z',
      display_message: 'Demo Bank 20% off',
      display_message_ar: 'خصم 20% من بنك ديمو',
    },
  },
  'POST /v1/discounts/:id/confirm': {
    spec: 'acquirer',
    tag: 'Discounts',
    operationId: 'confirmDiscount',
    summary: 'The discounted charge succeeded',
    description:
      '`charged_amount` must equal `final_amount`. Confirming twice returns the same result.',
    response: ref('RedemptionView'),
    errors: {
      ...notFound('REDEMPTION_NOT_FOUND'),
      409: 'REDEMPTION_CANCELLED or RESERVATION_EXPIRED',
      422: 'AMOUNT_MISMATCH: charged_amount differs from final_amount (cancel instead)',
    },
    requestExample: { charged_amount: 40000, auth_code: 'A1B2C3' },
  },
  'POST /v1/discounts/:id/cancel': {
    spec: 'acquirer',
    tag: 'Discounts',
    operationId: 'cancelDiscount',
    summary: 'The charge was declined or voided: release the discount',
    description: 'Allowed before or after confirmation, but not after a refund.',
    response: ref('RedemptionView'),
    errors: { ...notFound('REDEMPTION_NOT_FOUND'), 409: 'USE_REFUND: already refunded' },
  },
  'POST /v1/discounts/:id/refund': {
    spec: 'acquirer',
    tag: 'Discounts',
    operationId: 'refundDiscount',
    summary: 'Refund all or part of a confirmed purchase',
    description:
      'The discount is reversed in the same proportion as the refund. Repeating a `refund_id` is a no-op.',
    response: ref('RedemptionView'),
    errors: {
      ...notFound('REDEMPTION_NOT_FOUND'),
      409: 'NOT_CONFIRMED or ALREADY_REFUNDED',
      422: 'REFUND_EXCEEDS_PAID: total refunds would exceed what the customer paid',
    },
    requestExample: { refund_id: 'RF-0001', amount: 20000 },
  },

  // ── Operations ────────────────────────────────────────────────────────────────────────
  'GET /health': {
    spec: 'ops',
    tag: 'Health',
    summary: 'Readiness: database and Redis reachable',
    description: 'Returns 503 with the same body when a dependency is down.',
    response: ref('Health'),
    errors: { 503: 'A dependency is down (body is the same Health object)' },
  },
  'GET /health/live': {
    spec: 'ops',
    tag: 'Health',
    summary: 'Liveness: the process is up',
    description: 'Ignores dependencies on purpose, so a database blip does not restart pods.',
    response: obj({ status: str(undefined, { const: 'ok' }) }),
  },
  'GET /metrics': {
    spec: 'ops',
    tag: 'Metrics',
    summary: 'Prometheus metrics',
    description:
      'Prometheus text format. When `METRICS_TOKEN` is set, send `Authorization: Bearer <token>`. Keep it on the internal network.',
    content: 'text/plain',
  },

  // ── Auth ──────────────────────────────────────────────────────────────────────────────
  'POST /admin/v1/auth/google': {
    spec: 'admin',
    tag: 'Auth',
    summary: 'Staff sign-in with a Google ID token',
    description:
      'Accepts an ID token from Google Identity Services for the Workspace domain. Sets the session cookie. Rate limited per IP.',
    response: ref('User'),
    responseHeaders: sessionCookie,
    errors: { 429: 'RATE_LIMITED' },
  },
  'POST /admin/v1/auth/magic-link': {
    spec: 'admin',
    tag: 'Auth',
    summary: 'Email a one-time sign-in link (partners)',
    description:
      'Answers 202 whether or not the email belongs to an active partner user, so it cannot be used to discover accounts. Staff sign in with Google instead.',
    response: obj({ sent: { type: 'boolean', const: true } }),
    errors: { 429: 'RATE_LIMITED' },
  },
  'POST /admin/v1/auth/magic-link/verify': {
    spec: 'admin',
    tag: 'Auth',
    summary: 'Exchange a magic-link token for a session',
    response: ref('User'),
    responseHeaders: sessionCookie,
    errors: { 429: 'RATE_LIMITED' },
  },
  'POST /admin/v1/auth/dev-login': {
    spec: 'admin',
    tag: 'Auth',
    summary: 'Development sign-in by email (local only)',
    description: 'Answers 404 unless `DEV_LOGIN=true`; never enabled in staging or production.',
    response: ref('User'),
    responseHeaders: sessionCookie,
    errors: { 404: 'Dev login is disabled' },
  },
  'POST /admin/v1/auth/logout': {
    spec: 'admin',
    tag: 'Auth',
    summary: 'Sign out and revoke the session',
    response: obj({ ok: { type: 'boolean', const: true } }),
  },
  'GET /admin/v1/auth/me': {
    spec: 'admin',
    tag: 'Auth',
    summary: 'The signed-in user',
    response: ref('User'),
  },

  // ── Campaigns ─────────────────────────────────────────────────────────────────────────
  'GET /admin/v1/campaigns': {
    spec: 'admin',
    tag: 'Campaigns',
    summary: 'List campaigns',
    description:
      '`awaitingApproval=true` returns submitted campaigns and live ones with a pending change.',
    response: page(
      withFields('Campaign', {
        fundings: arr(
          withFields('CampaignFunding', { partner: pick('Partner', ['id', 'name', 'type']) }),
        ),
      }),
    ),
  },
  'POST /admin/v1/campaigns': {
    spec: 'admin',
    tag: 'Campaigns',
    summary: 'Create a draft campaign',
    description:
      'Funding shares must total 100%. With `variants`, variant A is the control and its discount becomes the campaign discount; weights must total 10000.',
    response: campaign,
    errors: { 422: 'INVALID_CAMPAIGN (details in the message)' },
    requestExample: {
      name: 'Demo Bank 20% at cafes',
      nameAr: 'خصم 20% من بنك ديمو في المقاهي',
      country: 'EG',
      currency: 'EGP',
      startAt: '2026-11-01T07:00:00.000Z',
      endAt: '2026-12-01T07:00:00.000Z',
      priority: 10,
      discount: {
        type: 'PERCENT',
        percentBps: 2000,
        maxDiscountMinor: 15000,
        minSpendMinor: 20000,
      },
      targeting: { binRanges: [{ from: '412345', to: '412399' }], mccs: ['5812', '5814'] },
      schedule: [{ daysOfWeek: [0, 1, 2, 3, 4], startMinute: 720, endMinute: 960 }],
      displayMessage: 'Demo Bank 20% off',
      limits: { totalBudgetMinor: 5000000, perCardMaxCount: 2, perCardPeriod: 'WEEK' },
      fundings: [
        { partnerId: '6f1c2e3a-0000-4000-8000-000000000001', shareBps: 5000 },
        { partnerId: '6f1c2e3a-0000-4000-8000-000000000002', shareBps: 3000 },
        { partnerId: '6f1c2e3a-0000-4000-8000-000000000003', shareBps: 2000 },
      ],
      holdoutBps: 1000,
      variants: [
        {
          key: 'A',
          name: '20% off',
          weightBps: 5000,
          discount: {
            type: 'PERCENT',
            percentBps: 2000,
            maxDiscountMinor: 15000,
            minSpendMinor: 20000,
          },
        },
        {
          key: 'B',
          name: 'EGP 40 off',
          weightBps: 5000,
          discount: { type: 'FIXED', amountMinor: 4000, minSpendMinor: 20000 },
        },
      ],
    },
  },
  'GET /admin/v1/campaigns/:id': {
    spec: 'admin',
    tag: 'Campaigns',
    summary: 'Get a campaign with fundings, variants and approved versions',
    response: ref('CampaignDetail'),
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'PUT /admin/v1/campaigns/:id': {
    spec: 'admin',
    tag: 'Campaigns',
    summary: 'Edit a campaign',
    description:
      'Drafts change in place. For a SCHEDULED, ACTIVE or PAUSED campaign the change is stored as `pendingChanges` and applies only after another user approves it.',
    response: campaign,
    errors: {
      ...notFound('CAMPAIGN_NOT_FOUND'),
      409: 'INVALID_STATUS or CAMPAIGN_OVER',
      422: 'INVALID_CAMPAIGN or INVALID_CHANGE',
    },
  },
  'POST /admin/v1/campaigns/:id/submit': transition(
    'Submit a draft for approval',
    'DRAFT → PENDING_APPROVAL.',
    'DRAFT',
  ),
  'POST /admin/v1/campaigns/:id/withdraw': transition(
    'Withdraw a submission',
    'PENDING_APPROVAL → DRAFT.',
    'PENDING_APPROVAL',
  ),
  'POST /admin/v1/campaigns/:id/approve': {
    ...transition(
      'Approve a campaign or its pending change',
      'Maker-checker: the approver must not be the user who created, edited or submitted it. Approving a submitted campaign makes it SCHEDULED (or ACTIVE if it has started); approving a pending change applies it and records a new version.',
      'PENDING_APPROVAL, or a live campaign with pendingChanges',
    ),
    errors: {
      ...notFound('CAMPAIGN_NOT_FOUND'),
      403: 'FORBIDDEN: you made this change (maker-checker)',
      409: 'NOTHING_TO_APPROVE',
    },
  },
  'POST /admin/v1/campaigns/:id/reject': {
    ...transition(
      'Reject a campaign or its pending change',
      'A submitted campaign returns to DRAFT with the reason; a pending change is discarded.',
      'PENDING_APPROVAL, or a live campaign with pendingChanges',
    ),
    errors: { ...notFound('CAMPAIGN_NOT_FOUND'), 409: 'NOTHING_TO_REJECT' },
  },
  'POST /admin/v1/campaigns/:id/pause': transition(
    'Pause a live campaign',
    'Takes effect on every API instance within seconds.',
    'SCHEDULED or ACTIVE',
  ),
  'POST /admin/v1/campaigns/:id/resume': {
    ...transition(
      'Resume a paused campaign',
      'PAUSED → ACTIVE (or SCHEDULED before its start).',
      'PAUSED',
    ),
    errors: {
      ...notFound('CAMPAIGN_NOT_FOUND'),
      409: 'INVALID_STATUS (allowed from PAUSED) or CAMPAIGN_OVER (end date passed)',
    },
  },
  'POST /admin/v1/campaigns/:id/end': transition(
    'End a campaign now',
    'Irreversible. Ending an already ended campaign is a no-op.',
    'SCHEDULED, ACTIVE or PAUSED',
  ),
  'POST /admin/v1/campaigns/:id/clone': {
    spec: 'admin',
    tag: 'Campaigns',
    summary: 'Copy a campaign into a new draft',
    description:
      'The copy gets a new experiment salt, so A/B and holdout groups are re-randomised.',
    response: campaign,
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'GET /admin/v1/campaigns/:id/versions/:version': {
    spec: 'admin',
    tag: 'Campaigns',
    summary: 'An approved version snapshot',
    response: ref('CampaignVersion'),
    errors: notFound('Version not found'),
  },
  'GET /admin/v1/campaigns/:id/stats': {
    spec: 'admin',
    tag: 'Campaigns',
    summary: 'Budget, caps and daily usage',
    response: ref('CampaignStats'),
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'GET /admin/v1/campaigns/:id/performance': {
    spec: 'admin',
    tag: 'Experiments',
    summary: 'Uplift vs holdout and A/B comparison',
    description:
      'Intent-to-treat by group (HOLDOUT, A, B, C). Declined payments are excluded; holdout and timed-out payments count at full price. Use `from` after a change to the experiment.',
    response: ref('PerformanceReport'),
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'GET /admin/v1/campaigns/:id/performance.csv': {
    spec: 'admin',
    tag: 'Experiments',
    summary: 'Performance report as CSV',
    content: 'text/csv',
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'POST /admin/v1/simulate': {
    spec: 'admin',
    tag: 'Simulator',
    summary: 'Would this payment get a discount, and why?',
    description:
      'Evaluates every campaign in the terminal’s country without reserving anything. With `cardToken`, shows the card’s holdout / A-B group for each campaign.',
    response: ref('SimulationResult'),
    errors: notFound('TERMINAL_NOT_FOUND'),
    requestExample: {
      terminalId: '7d1f0b6e-3c2a-4b5d-8e9f-0a1b2c3d4e5f',
      bin: '412345',
      scheme: 'VISA',
      amountMinor: 50000,
      includeInactive: true,
    },
  },

  // ── Transactions ──────────────────────────────────────────────────────────────────────
  'GET /admin/v1/redemptions': {
    spec: 'admin',
    tag: 'Transactions',
    summary: 'Search redemptions',
    response: page(
      withFields('Redemption', {
        campaign: pick('Campaign', ['id', 'name']),
        terminal: obj({
          id: uuid(),
          externalTerminalId: str(),
          merchant: pick('Merchant', ['id', 'name']),
        }),
        acquirer: pick('Acquirer', ['id', 'name']),
      }),
    ),
  },
  'GET /admin/v1/redemptions/:id': {
    spec: 'admin',
    tag: 'Transactions',
    summary: 'A redemption with its event history',
    response: withFields('Redemption', {
      events: arr(ref('RedemptionEvent')),
      campaign: pick('Campaign', ['id', 'name', 'currency']),
      terminal: withFields('Terminal', {
        merchant: pick('Merchant', ['id', 'name']),
        branch: { anyOf: [ref('Branch'), { type: 'null' }] },
      }),
      acquirer: pick('Acquirer', ['id', 'name']),
    }),
    errors: notFound('REDEMPTION_NOT_FOUND'),
  },
  'GET /admin/v1/inquiries/summary': {
    spec: 'admin',
    tag: 'Transactions',
    summary: 'Why payments did or did not get a discount, and latency',
    description: 'Defaults to the last 24 hours.',
    response: ref('InquirySummary'),
  },

  // ── Network ───────────────────────────────────────────────────────────────────────────
  'GET /admin/v1/merchants': {
    spec: 'admin',
    tag: 'Network',
    summary: 'List merchants',
    response: page(
      withFields('Merchant', {
        partner: pick('Partner', ['id', 'name']),
        _count: obj({ branches: { type: 'integer' }, terminals: { type: 'integer' } }),
      }),
    ),
  },
  'POST /admin/v1/merchants': {
    spec: 'admin',
    tag: 'Network',
    summary: 'Create a merchant',
    response: ref('Merchant'),
    errors: { 422: 'INVALID_PARTNER or COUNTRY_MISMATCH' },
  },
  'GET /admin/v1/merchants/:id': {
    spec: 'admin',
    tag: 'Network',
    summary: 'A merchant with its partner and branches',
    response: withFields('Merchant', { partner: ref('Partner'), branches: arr(ref('Branch')) }),
    errors: notFound('MERCHANT_NOT_FOUND'),
  },
  'PATCH /admin/v1/merchants/:id': {
    spec: 'admin',
    tag: 'Network',
    summary: 'Update a merchant',
    response: ref('Merchant'),
    errors: notFound('MERCHANT_NOT_FOUND'),
  },
  'POST /admin/v1/merchants/:id/branches': {
    spec: 'admin',
    tag: 'Network',
    summary: 'Add a branch',
    response: ref('Branch'),
    errors: notFound('MERCHANT_NOT_FOUND'),
  },
  'GET /admin/v1/terminals': {
    spec: 'admin',
    tag: 'Network',
    summary: 'List terminals',
    response: page(
      withFields('Terminal', {
        merchant: pick('Merchant', ['id', 'name']),
        branch: { anyOf: [pick('Branch', ['id', 'name']), { type: 'null' }] },
        acquirer: pick('Acquirer', ['id', 'name']),
      }),
    ),
  },
  'POST /admin/v1/terminals': {
    spec: 'admin',
    tag: 'Network',
    summary: 'Register a terminal (TID)',
    description: 'TIDs are unique per acquirer.',
    response: ref('Terminal'),
    errors: {
      422: 'DUPLICATE_TERMINAL (TID already used by this acquirer), INVALID_MERCHANT or INVALID_BRANCH',
    },
  },
  'PATCH /admin/v1/terminals/:id': {
    spec: 'admin',
    tag: 'Network',
    summary: 'Update a terminal',
    response: ref('Terminal'),
    errors: { ...notFound('TERMINAL_NOT_FOUND'), 422: 'INVALID_BRANCH' },
  },
  'POST /admin/v1/terminals/import': {
    spec: 'admin',
    tag: 'Network',
    summary: 'Bulk-import terminals from CSV',
    description:
      'CSV columns: `acquirer_api_key,tid,merchant_id,branch_id,mcc` (header row required). `dryRun` defaults to true. Nothing is written if any row has an error.',
    response: ref('TerminalImportResult'),
    requestExample: {
      csv: 'acquirer_api_key,tid,merchant_id,branch_id,mcc\nacq_demo,TID0002,0b6f1c2e-0000-4000-8000-000000000001,,5812',
      dryRun: true,
    },
  },

  // ── Partners & acquirers ──────────────────────────────────────────────────────────────
  'GET /admin/v1/partners': {
    spec: 'admin',
    tag: 'Partners',
    summary: 'List partners (banks, merchants, Waffarha)',
    response: page(ref('Partner')),
  },
  'POST /admin/v1/partners': {
    spec: 'admin',
    tag: 'Partners',
    summary: 'Create a partner',
    response: ref('Partner'),
  },
  'GET /admin/v1/partners/:id': {
    spec: 'admin',
    tag: 'Partners',
    summary: 'A partner with its merchants and funded campaigns',
    response: withFields('Partner', {
      merchants: arr(ref('Merchant')),
      fundings: arr(
        withFields('CampaignFunding', { campaign: pick('Campaign', ['id', 'name', 'status']) }),
      ),
    }),
    errors: notFound('PARTNER_NOT_FOUND'),
  },
  'PATCH /admin/v1/partners/:id': {
    spec: 'admin',
    tag: 'Partners',
    summary: 'Update a partner',
    response: ref('Partner'),
    errors: notFound('PARTNER_NOT_FOUND'),
  },
  'GET /admin/v1/acquirers': {
    spec: 'admin',
    tag: 'Acquirers',
    summary: 'List acquirers',
    description: 'The HMAC secret is never returned here.',
    response: arr(
      withFields('Acquirer', {
        terminalCount: { type: 'integer' },
        _count: obj({ terminals: { type: 'integer' } }),
      }),
    ),
  },
  'POST /admin/v1/acquirers': {
    spec: 'admin',
    tag: 'Acquirers',
    summary: 'Onboard an acquirer',
    description:
      'Returns the HMAC secret **once**. Store it securely and share it with the acquirer over a secure channel.',
    response: obj({ acquirer: ref('Acquirer'), hmacSecret: str('64 hex characters, shown once') }),
  },
  'PATCH /admin/v1/acquirers/:id': {
    spec: 'admin',
    tag: 'Acquirers',
    summary: 'Update an acquirer (activate, IP allowlist, certificate)',
    response: ref('Acquirer'),
    errors: notFound('ACQUIRER_NOT_FOUND'),
  },
  'POST /admin/v1/acquirers/:id/rotate-secret': {
    spec: 'admin',
    tag: 'Acquirers',
    summary: 'Rotate the HMAC secret',
    description:
      'The new secret applies immediately; instances may accept the old one for up to a minute (cache).',
    response: obj({ hmacSecret: str('64 hex characters, shown once') }),
    errors: notFound('ACQUIRER_NOT_FOUND'),
  },

  // ── Users & audit ─────────────────────────────────────────────────────────────────────
  'GET /admin/v1/users': {
    spec: 'admin',
    tag: 'Users',
    summary: 'List users',
    response: page(ref('User')),
  },
  'POST /admin/v1/users': {
    spec: 'admin',
    tag: 'Users',
    summary: 'Invite a user',
    description:
      'Staff need a Workspace email (they sign in with Google); partner users need a `partnerId` and sign in by magic link. The invitee is emailed.',
    response: ref('User'),
    errors: {
      409: 'USER_EXISTS',
      422: 'PARTNER_REQUIRED, PARTNER_NOT_ALLOWED, STAFF_DOMAIN or INVALID_PARTNER',
    },
  },
  'PATCH /admin/v1/users/:id': {
    spec: 'admin',
    tag: 'Users',
    summary: 'Change a user’s name, role, status or language',
    description: 'Role and deactivation changes sign the user out everywhere.',
    response: ref('User'),
    errors: { ...notFound('USER_NOT_FOUND'), 422: 'SELF_LOCKOUT or ROLE_KIND_CHANGE' },
  },
  'PATCH /admin/v1/users/me/locale': {
    spec: 'admin',
    tag: 'Users',
    summary: 'Set your own language',
    response: ref('User'),
  },
  'GET /admin/v1/audit': {
    spec: 'admin',
    tag: 'Audit',
    summary: 'Audit log',
    description: 'Every change made through the admin API, with before/after values.',
    response: page(
      withFields('AuditLog', {
        actor: { anyOf: [pick('User', ['id', 'email', 'name']), { type: 'null' }] },
      }),
    ),
  },

  // ── Settlement ────────────────────────────────────────────────────────────────────────
  'GET /admin/v1/settlements/overview': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'What each funder owes for a month (live)',
    response: ref('SettlementOverview'),
  },
  'POST /admin/v1/settlements/run': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'Draft the month’s documents for a country',
    description:
      'Builds the ledger and creates DRAFT invoices, payout statements and statements. Re-running only adds what is new. Fails if no VAT rate is configured.',
    response: obj({ created: { type: 'integer' }, period: str('YYYY-MM') }),
    errors: { 422: 'No VAT rate for the country and period' },
  },
  'GET /admin/v1/documents': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'List settlement documents',
    response: page(withFields('Invoice', { partner: pick('Partner', ['id', 'name', 'type']) })),
  },
  'GET /admin/v1/documents/:id': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'A document with its lines',
    response: ref('DocumentDetail'),
    errors: notFound('DOCUMENT_NOT_FOUND'),
  },
  'GET /admin/v1/documents/:id/pdf': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'Document PDF (English and Arabic)',
    content: 'application/pdf',
    errors: notFound('DOCUMENT_NOT_FOUND'),
  },
  'GET /admin/v1/documents/:id/csv': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'Document lines as CSV',
    content: 'text/csv',
    errors: notFound('DOCUMENT_NOT_FOUND'),
  },
  'POST /admin/v1/documents/:id/issue': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'Issue a draft (assigns the gap-free number, emails the partner)',
    response: ref('DocumentDetail'),
    errors: { ...notFound('DOCUMENT_NOT_FOUND'), 409: 'INVALID_STATUS (only DRAFT)' },
  },
  'POST /admin/v1/documents/:id/paid': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'Mark an issued invoice or payout as paid',
    response: ref('DocumentDetail'),
    errors: {
      ...notFound('DOCUMENT_NOT_FOUND'),
      409: 'INVALID_STATUS or NOT_PAYABLE (statements)',
    },
  },
  'POST /admin/v1/documents/:id/void': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'Void a document',
    description: 'Its ledger entries are released and land in the next run.',
    response: ref('DocumentDetail'),
    errors: { ...notFound('DOCUMENT_NOT_FOUND'), 409: 'INVALID_STATUS (PAID or VOID)' },
  },
  'GET /admin/v1/tax-rates': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'VAT rates by country',
    response: arr(ref('TaxRate')),
  },
  'POST /admin/v1/tax-rates': {
    spec: 'admin',
    tag: 'Settlement',
    summary: 'Add a VAT rate from a date',
    response: ref('TaxRate'),
  },

  // ── Partner portal ────────────────────────────────────────────────────────────────────
  'GET /admin/v1/portal/me': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Your organisation',
    response: pick('Partner', ['id', 'name', 'nameAr', 'type', 'country']),
  },
  'GET /admin/v1/portal/campaigns': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Campaigns you fund or that run at your terminals',
    response: arr(ref('PortalCampaign')),
  },
  'GET /admin/v1/portal/campaigns/:id/redemptions': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Discounted payments of a campaign',
    description: 'A merchant that does not fund the campaign sees only payments at its terminals.',
    response: page(ref('PortalRedemption')),
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'GET /admin/v1/portal/campaigns/:id/redemptions.csv': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Discounted payments as CSV',
    content: 'text/csv',
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'GET /admin/v1/portal/campaigns/:id/performance': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Campaign performance and experiment results',
    description:
      'Funders see the whole campaign; a non-funding merchant sees only its own terminals.',
    response: ref('PerformanceReport'),
    errors: notFound('CAMPAIGN_NOT_FOUND'),
  },
  'GET /admin/v1/portal/documents': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Your issued invoices and statements',
    response: page(ref('Invoice')),
  },
  'GET /admin/v1/portal/documents/:id/pdf': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Document PDF',
    content: 'application/pdf',
    errors: notFound('DOCUMENT_NOT_FOUND'),
  },
  'GET /admin/v1/portal/documents/:id/csv': {
    spec: 'admin',
    tag: 'Portal',
    summary: 'Document lines as CSV',
    content: 'text/csv',
    errors: notFound('DOCUMENT_NOT_FOUND'),
  },

  // ── Safety & alerts ───────────────────────────────────────────────────────────────────
  'GET /admin/v1/safety': {
    spec: 'admin',
    tag: 'Safety',
    summary: 'Kill switch, guardrails and alert thresholds',
    response: ref('SafetySettings'),
  },
  'PUT /admin/v1/safety': {
    spec: 'admin',
    tag: 'Safety',
    summary: 'Update guardrails and alert thresholds',
    description:
      'Nested partial update. All API instances use the new values within seconds. The kill switch has its own endpoint.',
    response: ref('SafetySettings'),
  },
  'POST /admin/v1/safety/kill-switch': {
    spec: 'admin',
    tag: 'Safety',
    summary: 'Stop (or resume) every discount',
    description:
      'Within seconds every inquiry answers `KILL_SWITCH` and payments carry on at full price. Raises a critical alert.',
    response: ref('SafetySettings'),
  },
  'GET /admin/v1/alerts': {
    spec: 'admin',
    tag: 'Safety',
    summary: 'Budget, health and fraud alerts',
    response: page(ref('Alert')),
  },
  'POST /admin/v1/alerts/:id/acknowledge': {
    spec: 'admin',
    tag: 'Safety',
    summary: 'Acknowledge an alert',
    response: ref('Alert'),
    errors: notFound('ALERT_NOT_FOUND'),
  },
};
