import { SESSION_COOKIE } from '../admin/auth/session.service';
import type { SpecName } from './routes';

const LICENSE = { name: 'Proprietary — Waffarha' };

interface SpecMeta {
  info: { title: string; version: string; description: string; license?: { name: string } };
  servers: Array<{ url: string; description?: string; variables?: Record<string, unknown> }>;
  tags: Array<{ name: string; description: string }>;
  securitySchemes: Record<string, unknown>;
}

const ACQUIRER_DESCRIPTION = `Called by acquirers / payment providers while a card payment is in progress at a POS.

## Flow
1. **Inquire** before charging the card. If \`eligible\` is true, charge \`final_amount\`.
2. **Confirm** once the charge succeeds, or **Cancel** if it is declined or voided.
   A reservation that is neither confirmed nor cancelled expires after \`expires_at\`
   (default 10 minutes) and its budget is released.
3. **Refund** (full or partial) when the merchant refunds the purchase later.

## Timeouts — fail open
Use a client timeout of **800 ms** on inquire. On timeout, any error or \`eligible: false\`,
charge the full amount. Never block the payment because of this API.
If you charged the full amount after a timeout, do nothing: the reservation expires on its own.

## Amounts
All amounts are integers in **minor units** (piastres for EGP, halalas for SAR): 125.50 EGP = \`12550\`.

## Authentication
Every request is sent over mTLS and carries:
- \`X-Api-Key\`: your key id
- \`X-Timestamp\`: unix time in seconds; requests more than 300 s off are rejected
- \`X-Signature\`: lowercase hex of
  \`HMAC-SHA256(secret, timestamp + "\\n" + METHOD + "\\n" + path + "\\n" + hex(SHA256(raw body)))\`,
  where \`path\` is the request path including any query string, e.g. \`/v1/discounts/inquire\`.

## Card data
Send the card **BIN** (first 6–8 digits) and your **card token** (stable per card).
Never send the full card number (PAN); requests that look like they contain one are rejected.

## Idempotency
\`inquire\` requires an \`Idempotency-Key\` header (use your transaction reference). Retrying with
the same key returns the original answer. Confirm and cancel are naturally idempotent; refund is
idempotent per \`refund_id\`.

## Errors
Every error has the shape \`{ "error": { "code": "...", "message": "..." } }\`. Only a valid
\`200\` from inquire with \`eligible: true\` means a discount applies; treat anything else
(including network errors and timeouts) as "no discount".
`;

const ADMIN_DESCRIPTION = `Back-office API used by the Waffarha admin web app and the partner portal. It is not exposed
to acquirers; in Kubernetes it is reached only through the web app's \`/api/*\` proxy.

## Authentication
Sign in to get the \`${SESSION_COOKIE}\` session cookie (HttpOnly, Secure, SameSite=Lax):
- **Staff** (\`@waffarha.com\`): \`POST /admin/v1/auth/google\` with a Google Identity Services ID token.
- **Partners**: \`POST /admin/v1/auth/magic-link\` emails a one-time link; the web app exchanges
  its token at \`POST /admin/v1/auth/magic-link/verify\`.
- **Local development** only: \`POST /admin/v1/auth/dev-login\` (needs \`DEV_LOGIN=true\`).

Requests with a body must be \`application/json\` (together with SameSite cookies this blocks CSRF).

## Roles
\`ADMIN\`, \`CAMPAIGN_MANAGER\`, \`APPROVER\`, \`FINANCE\`, \`VIEWER\` are staff roles; \`PARTNER_USER\`
belongs to one partner (bank or merchant) and can only use the \`/admin/v1/portal\` and auth
endpoints. Each operation lists the roles allowed (also as \`x-roles\`); others get \`403 FORBIDDEN\`.
Campaign changes follow maker-checker: the approver must be a different user.

## Conventions
- **Money** is an integer in minor units (piastres for EGP, halalas for SAR): 125.50 EGP = \`12550\`.
- **Percentages** in configuration are basis points: 15% = \`1500\`.
- **Dates** are ISO 8601 in UTC; each campaign has an IANA \`timezone\` for its schedule.
- **Lists** take \`page\` (from 1) and \`pageSize\` (max 200) and return \`{ items, total, page, pageSize }\`.
- **Errors** are \`{ "error": { "code": "...", "message": "..." } }\`; validation errors (\`400 VALIDATION_ERROR\`)
  list every invalid field in the message.
- Every change is written to the audit log (\`GET /admin/v1/audit\`).
`;

const OPS_DESCRIPTION = `Endpoints for Kubernetes probes and Prometheus. The worker process serves the same three
paths on \`WORKER_PORT\` (default 3010).`;

export const SPECS: Record<SpecName, SpecMeta> = {
  acquirer: {
    info: {
      title: 'Waffarha Instant Discount — Acquirer API',
      version: '1.0.0',
      description: ACQUIRER_DESCRIPTION,
      license: LICENSE,
    },
    servers: [
      {
        url: 'https://{host}',
        variables: {
          host: {
            default: 'sandbox.example.com',
            description: 'Provided per environment during onboarding',
          },
        },
      },
    ],
    tags: [{ name: 'Discounts', description: 'Inquire, then confirm, cancel or refund.' }],
    securitySchemes: {
      AcquirerHmac: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description:
          'Your key id. Every request also carries `X-Timestamp` and `X-Signature` (HMAC-SHA256, see the overview) and is sent over mTLS from an allow-listed IP.',
      },
    },
  },
  admin: {
    info: {
      title: 'Waffarha Instant Discount — Admin & Partner Portal API',
      version: '1.0.0',
      description: ADMIN_DESCRIPTION,
      license: LICENSE,
    },
    servers: [{ url: '/', description: 'Same origin as the web app (proxied under /api)' }],
    tags: [
      { name: 'Auth', description: 'Sign-in, sign-out and the current user.' },
      {
        name: 'Campaigns',
        description: 'Create, edit, approve and run campaigns (maker-checker).',
      },
      { name: 'Experiments', description: 'Holdout uplift, A/B comparison and ROI.' },
      { name: 'Simulator', description: 'Dry-run a payment against every campaign.' },
      { name: 'Transactions', description: 'Redemptions and inquiry outcomes.' },
      { name: 'Network', description: 'Merchants, branches and terminals (TIDs).' },
      { name: 'Partners', description: 'Banks, merchants and Waffarha as funders.' },
      { name: 'Acquirers', description: 'Acquirer onboarding and API credentials.' },
      { name: 'Users', description: 'Staff and partner users.' },
      {
        name: 'Settlement',
        description: 'Ledger, invoices, payout statements, statements and VAT.',
      },
      { name: 'Portal', description: 'Read-only views for a partner’s own users.' },
      { name: 'Safety', description: 'Kill switch, guardrails and alerts.' },
      { name: 'Audit', description: 'Who changed what.' },
    ],
    securitySchemes: {
      SessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: SESSION_COOKIE,
        description: 'Set by the sign-in endpoints.',
      },
    },
  },
  ops: {
    info: {
      title: 'Waffarha Instant Discount — Operations',
      version: '1.0.0',
      description: OPS_DESCRIPTION,
      license: LICENSE,
    },
    servers: [{ url: '/', description: 'API (port 3000) or worker (WORKER_PORT)' }],
    tags: [
      { name: 'Health', description: 'Kubernetes readiness and liveness probes.' },
      { name: 'Metrics', description: 'Prometheus scrape endpoint.' },
    ],
    securitySchemes: {
      MetricsToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'Required only when METRICS_TOKEN is set.',
      },
    },
  },
};
