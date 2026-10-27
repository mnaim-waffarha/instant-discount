# Instant Discount Platform — Plan

## Context

Waffarha wants a real-time **instant discount** system for card payments at physical POS terminals.
When a customer pays by card, the **acquirer** (payment provider running the terminals) asks our API
whether the card + merchant qualify for a discount. If yes, the POS charges the discounted amount; if
no (or we're slow/down), the full amount is charged. Campaigns are **co-funded** (Waffarha + bank +
merchant) and carry rich configuration: discount rules, caps, targeting, schedule, priority.

The repo `instant-discount` is empty — this is a greenfield build.

### Confirmed requirements (from Q&A)

| Topic              | Decision                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Partners / funding | Co-funded: a campaign can involve a bank, a merchant and Waffarha with % split                                               |
| Integration        | Acquirer/payment provider calls **our own published API** (no existing spec)                                                 |
| User identity      | Card only: **BIN + card token/hash** from acquirer — no PAN ever (light PCI scope)                                           |
| Timing             | **Before charge**, real-time, then confirm / cancel / refund                                                                 |
| Discount types     | % with max cap, fixed amount, min-spend threshold, tiered                                                                    |
| Caps               | Total budget, max unique cards, per-card limits (count/amount per day/week/campaign), daily budget/count, day & hour windows |
| Targeting          | BIN ranges, card scheme (Visa/MC/Meeza/Mada), merchant/branch/terminal, MCC                                                  |
| Conflicts          | **Priority order** — highest-priority eligible campaign wins (falls through if capped)                                       |
| Lifecycle          | Inquire → Confirm / Cancel(reversal) / Refund (full & partial)                                                               |
| Settlement         | **Full invoicing** per partner with payment status tracking                                                                  |
| Markets            | Egypt + KSA — EGP & SAR, Africa/Cairo & Asia/Riyadh                                                                          |
| Failure mode       | Fail-open: acquirer timeout ~800 ms → no discount                                                                            |
| Stack              | NestJS (TypeScript) + PostgreSQL + Redis; Docker                                                                             |
| UI                 | Admin web dashboard + admin APIs + partner portal (banks/merchants read their campaigns)                                     |

---

## Architecture

```
POS ──► Acquirer ──(mTLS + HMAC)──► Decision API (NestJS, stateless, horizontally scaled)
                                      │  ├─ campaign cache (in-memory, refreshed via Redis pub/sub)
                                      │  └─ Redis Lua: atomic reserve of budget/caps
                                      ▼
                                  PostgreSQL (source of truth) ◄── Worker (scheduled jobs + Redis locks):
                                      ▲                            reservation expiry, reconciliation,
                                      │                            invoicing, alerts, webhooks
Admin Web / Partner Portal (Next.js) ─► Admin API (NestJS, JWT + RBAC)
```

**One repository (confirmed):** a single monorepo `instant-discount` (pnpm + Turborepo) holding all
apps; each app is deployed independently but shares the engine, types and DB schema.

```
apps/
  api/            NestJS — modules: decision, transactions, campaigns, partners, merchants,
                  acquirers, invoicing, reports, auth, audit. Two entrypoints from one
                  codebase: dist/main.js (HTTP) and dist/worker.js (background jobs)
  admin-web/      Next.js — internal ops dashboard
  partner-portal/ Next.js — bank/merchant read-only portal
packages/
  rules-engine/   pure TS: eligibility + discount calculation (no I/O, heavily unit-tested)
  shared/         DTOs, enums, money utils (integer minor units), zod schemas
  db/             Prisma schema + migrations
infra/            docker-compose (postgres, redis), k6 load tests, OpenAPI spec
```

## Data model (core tables)

- **Partner** (type: BANK | MERCHANT | WAFFARHA, country, contacts, billing info)
- **Merchant** → **Branch** → **Terminal** (terminal_id per acquirer, MCC, country)
- **Acquirer** (API client: key id, HMAC secret, mTLS cert fingerprint, IP allowlist, status)
- **Campaign**: name, status (DRAFT → PENDING_APPROVAL → SCHEDULED → ACTIVE → PAUSED → ENDED),
  country, currency, timezone, start_at, end_at, priority, discount_type, discount config (JSON:
  percent/max_cap, fixed, min_spend, tiers[]), version
- **CampaignTargeting**: BIN ranges, schemes, merchant/branch/terminal includes/excludes, MCCs
- **CampaignLimits**: total_budget, max_unique_cards, per_card {max_count, max_amount, period},
  daily_budget, daily_count, schedule windows (days of week + hours)
- **CampaignFunding**: partner_id + share % (must sum to 100)
- **Redemption** (one per inquiry that granted a discount): idempotency key, acquirer_txn_ref,
  terminal, card_token_hash, BIN, original_amount, discount_amount, final_amount, currency,
  status (RESERVED → CONFIRMED | RELEASED | EXPIRED; CONFIRMED → PARTIALLY_REFUNDED | REFUNDED),
  funding breakdown snapshot, campaign_version
- **RedemptionEvent** (append-only ledger of every state change + amounts)
- **InquiryLog** (all inquiries incl. "no discount" + reason code — for analytics/debug; partitioned by month)
- **Invoice** / **InvoiceLine** (partner, period, currency, amounts, status DRAFT/ISSUED/PAID/OVERDUE)
- **User / Role** (admin, campaign_manager, approver, finance, viewer, partner_user scoped to partner) and **AuditLog**

Card tokens stored only as `HMAC-SHA256(pepper, acquirer_token)`; BIN kept for targeting/reporting.

## POS / Acquirer API (v1, OpenAPI published)

All requests: mTLS + `X-Api-Key` + `X-Signature` (HMAC of body + timestamp, 5-min replay window) + `Idempotency-Key`.

1. `POST /v1/discounts/inquire` — {terminal_id, merchant_id, mcc, bin, card_token, scheme, amount, currency, acquirer_txn_ref, timestamp}
   → `{eligible: true, redemption_id, campaign_id, discount_amount, final_amount, expires_at, display_message_en/ar}` or `{eligible: false, reason}`. Target p99 < 150 ms.
2. `POST /v1/discounts/{redemption_id}/confirm` — {acquirer_auth_code, charged_amount} → CONFIRMED.
3. `POST /v1/discounts/{redemption_id}/cancel` — payment declined/voided → RELEASED (budget restored).
4. `POST /v1/discounts/{redemption_id}/refund` — {refund_amount (of original purchase)} → proportional discount reversal, budget/per-card usage restored proportionally.
5. Unconfirmed reservations auto-**EXPIRE** after TTL (default 10 min, configurable) and are released.
   All endpoints idempotent; repeated calls return the same result.

## Decision engine flow (inquire)

1. Auth + signature + idempotency check (Redis).
2. Resolve terminal → merchant/branch/country (cached).
3. Load candidate campaigns from in-memory index (ACTIVE, country, time window) sorted by priority.
4. For each candidate: `rules-engine` eligibility (BIN, scheme, merchant/branch/terminal, MCC, min spend, schedule window) → compute discount (type/tiers/max cap, never exceeding amount; currency rounding).
5. **Atomic reserve** via one Redis Lua script: check & increment total budget, daily budget/count, unique-card set, per-card count/amount for period. If any cap fails → try next campaign.
6. Persist Redemption (RESERVED) + InquiryLog; return response. On internal error → `eligible:false` (fail-open).
   Redis counters are rebuilt from Postgres by a reconciliation job; Postgres is the source of truth. Budget soft-stop alerts at 50/80/100%.

## Admin web + Admin API

- Partners, merchants/branches/terminals (CSV bulk import), acquirers (credential generation/rotation)
- Campaign builder: wizard (basics → discount → targeting → limits → funding → schedule → review)
- **Maker-checker approval** before activation; edits create a new campaign version
- **Simulator**: "would this card/terminal/amount get a discount and why" (dry-run, no reservation)
- Live campaign dashboard: budget used, redemptions, unique cards, confirm rate; pause / kill switch
- Transaction explorer (search by txn ref / redemption id / BIN), reason-code analytics
- Invoicing: generate monthly invoices per partner per currency, mark paid, export PDF/CSV
- Audit log viewer; RBAC management; bilingual EN/AR UI (RTL)

## Partner portal

Partner users (bank or merchant) see only campaigns they fund: KPIs, redemptions, their funding share, invoices & statements, CSV export. Read-only in v1.

## Invoicing logic

Nightly job aggregates CONFIRMED redemptions minus refunds into per-partner ledger lines using each
redemption's funding snapshot. Month-end job creates invoices (per partner × currency × period), with
VAT config per country (EG 14%, KSA 15% — to confirm with finance), invoice numbering, status tracking.

## Recommendations (included in plan)

- **Fraud/abuse**: velocity limits per card & per terminal, terminal allowlist per campaign, anomaly alerts (one terminal spiking), auto-pause rule.
- **Safety**: campaign kill switch, budget hard stop enforced atomically, max discount per transaction global guardrail.
- **Ops**: alerts (Slack/email) on budget thresholds, error rate, latency; daily reconciliation report with acquirer settlement files (phase 2).
- **Growth (later)**: card-linked offers in Waffarha app, MoEngage push "you saved X", A/B testing of discount levels, ROI reports for partners.
- **Compliance**: never accept PAN (reject requests containing 13–19 digit card numbers), secrets in a vault, encrypted backups, data retention policy.

---

## Implementation phases & steps

**Phase 0 – Foundation (week 1)**

1. Monorepo scaffold (pnpm, Turborepo, ESLint/Prettier, tsconfig), docker-compose (Postgres 16, Redis 7).
2. Prisma schema + first migration; seed script (sample partners, merchant, terminals, acquirer).
3. CI (GitHub Actions): lint, typecheck, unit + integration tests (testcontainers).

**Phase 1 – Core engine & POS API (weeks 2–3)** 4. `packages/rules-engine`: eligibility + all 4 discount types + money/rounding utils; exhaustive unit tests. 5. Acquirer auth (HMAC + idempotency middleware), OpenAPI spec. 6. Inquire endpoint + Redis Lua reservation + campaign cache with pub/sub invalidation. 7. Confirm / cancel / refund endpoints + RedemptionEvent ledger; expiry worker; reconciliation worker. 8. Load/concurrency test (k6): prove budget & caps never overshoot under parallel load; p99 latency target.

**Phase 2 – Admin API & dashboard (weeks 4–6)** 9. Auth (JWT, RBAC), audit log. 10. CRUD APIs: partners, merchants/branches/terminals (+ CSV import), acquirers, campaigns (+ versioning, approval). 11. Admin web: campaign wizard, approval queue, simulator, live dashboard, transaction explorer.

**Phase 3 – Invoicing & partner portal (weeks 7–8)** 12. Funding ledger + monthly invoice generation, PDF export, payment status. 13. Partner portal with scoped access, KPIs, invoices, exports.

**Phase 4 – Hardening & launch (weeks 9–10)** 14. Alerts/monitoring (OpenTelemetry, Prometheus/Grafana), fraud rules, kill switch drills. 15. Acquirer sandbox + integration guide; pilot with one acquirer, one bank, a few merchants.

### Progress

- **Phase 0 — done.** Monorepo, docker-compose, Prisma schema + `init` migration, seed script, CI
  (build, typecheck, unit + integration tests against Postgres/Redis service containers).
- **Phase 3 — done.** Settlement ledger (exact per-funder shares, refunds reversed in the period
  they happen), monthly drafts per country, INVOICE / PAYOUT_STATEMENT / STATEMENT documents with
  gap-free numbers, VAT table, PDF (EN + Arabic names) and CSV, email on issue, paid/void/overdue;
  partner portal (campaigns, live share, payments, documents).
- **Phase 2 — done.** Admin API (Google SSO, magic links, RBAC, maker-checker campaigns with
  versioned change requests, simulator, stats, explorer, audit) and the bilingual web app.
- **Phase 1 — done.** Rules engine; acquirer API (`docs/api/acquirer-v1.yaml`) with HMAC auth,
  idempotency and fail-open; Redis Lua reservation; confirm/cancel/refund with event ledger;
  worker jobs (reservation expiry, campaign SCHEDULED→ACTIVE→ENDED, counter reconciliation);
  acquirer simulator and load-test scripts.

### Decisions confirmed for Phases 2–4

| Topic         | Decision                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Staff login   | Google Workspace SSO, restricted to `@waffarha.com` (hosted domain check)                             |
| Partner login | Email magic link (admin invites; one-time link, 15 min, single use)                                   |
| Web apps      | **One** Next.js app: admin area + partner portal, routes gated by role                                |
| Language      | English + Arabic with RTL, language toggle                                                            |
| Invoices      | PDF + CSV, VAT per country (EG 14%, SA 15% — configurable), numbers like `INV-EG-2026-000001`         |
| Alerts        | Email (SMTP) + Slack incoming webhook, also listed in the dashboard                                   |
| Funding       | Configurable per campaign: any mix of bank(s), the merchant itself, and Waffarha (shares sum to 100%) |
| Waffarha fee  | None for now                                                                                          |

### Phase 2 — Admin API, auth and web app

**2a. Schema additions** (`packages/db/prisma/schema.prisma`, new migration)

- `Session` (hashed token, userId, expiresAt, ip, userAgent), `MagicLinkToken` (hashed, email, expiresAt, usedAt).
- `User`: add `googleSub`, `locale`, `lastLoginAt`; `passwordHash` removed (no passwords).
- `Campaign`: `settlementMode` (see Phase 3), `rejectionReason`, `submittedById/At`, `pausedAt`.
- `CampaignFunding`: role enum `BANK | MERCHANT | WAFFARHA` derived from partner type (validation: merchant-funded share must point at the campaign's merchant partner).

**2b. Auth module** (`apps/api/src/auth/`)

- Google SSO: web app gets a Google ID token (Google Identity Services); `POST /admin/v1/auth/google` verifies it with `google-auth-library` (audience = `GOOGLE_CLIENT_ID`, `hd` = `waffarha.com`, email verified). Only users pre-registered by an admin can log in; `BOOTSTRAP_ADMIN_EMAILS` seeds the first ADMIN(s).
- Magic link: `POST /admin/v1/auth/magic-link` (always 200, no user enumeration) → email with link; `POST /admin/v1/auth/magic-link/verify` consumes it. Only PARTNER_USER accounts.
- Session: random 32-byte token in an httpOnly, Secure, SameSite=Lax cookie; stored hashed; 12 h sliding expiry; `POST /auth/logout`.
- `DEV_LOGIN=true` (non-production only) enables `POST /auth/dev-login` so local dev and tests work without Google.
- `@Roles(...)` guard + `@CurrentUser()`; partner users are automatically scoped to their `partnerId`.
- Rate limit auth endpoints (Redis counter per IP/email).

**2c. Audit log** — interceptor on all admin mutations writes `AuditLog` (actor, action, entity, before/after JSON; secrets redacted). `GET /admin/v1/audit`.

**2d. Admin APIs** (`/admin/v1/*`, zod-validated, paginated, reuse `ZodPipe`, `ApiError`)

- Partners, merchants, branches, terminals CRUD; `POST /terminals/import` CSV (columns: acquirer_api_key, tid, merchant, branch, mcc) with a dry-run preview and per-row errors.
- Acquirers: create returns the HMAC secret **once** (stored with `encryptSecret`), rotate secret, toggle active, IP allowlist.
- Users: invite staff (role) or partner user (partnerId), deactivate.
- Campaigns: create/edit while DRAFT (validated with rules-engine `discountConfigSchema`/`targetingSchema`/`scheduleSchema` + funding sum = 10000); `submit` → PENDING_APPROVAL; `approve` (APPROVER/ADMIN, **must differ from creator**) → SCHEDULED or ACTIVE, writes `CampaignVersion` snapshot; `reject` (reason) → DRAFT; `pause`/`resume`/`end`; `clone`; edits to an approved campaign create a new version that again needs approval. Every status change publishes `CAMPAIGNS_CHANGED_CHANNEL` (`campaign-cache.service.ts`).
- Simulator `POST /campaigns/simulate`: terminal + BIN + scheme + amount (+ optional time) → per-campaign verdict from `rankCampaigns` plus current cap headroom from `CountersService.snapshot`; never reserves.
- Stats `GET /campaigns/:id/stats`: budget used/remaining, redemptions by status, unique cards, confirm rate, daily series, top terminals.
- Transactions explorer `GET /redemptions` (filter by campaign, status, txn ref, BIN, terminal, date) + detail with event ledger; `GET /inquiries/reasons` (reason-code breakdown).

**2e. Web app** (`apps/web`, Next.js App Router + Tailwind, Waffarha branding via the `waffarha-design` skill)

- `next-intl` with `en`/`ar` messages, `dir="rtl"` for Arabic, number/date formatting per locale and currency.
- Next.js rewrites `/api/*` → Nest API (same origin, cookie auth). Server components fetch with the forwarded cookie; middleware redirects by role (`/admin/*` staff, `/portal/*` partners).
- Admin pages: login (Google button), overview dashboard, campaigns list, **campaign wizard** (basics → discount → targeting → limits → funding → schedule → review), campaign detail (live stats, actions, versions), approvals queue, simulator, partners, merchants/branches/terminals (+ CSV upload), acquirers (show-secret-once dialog), transactions explorer, users, audit log.

**Verification 2:** API integration tests (auth via dev-login, RBAC denials, maker-checker, approval → campaign live in the acquirer API within one publish, CSV import errors, simulator matches real inquiry); web smoke tests with Playwright (login, create → submit → approve campaign as two users, simulator, EN/AR screenshots).

### Phase 3 — Settlement, invoicing, partner portal

**Settlement model (configurable per campaign, `settlementMode`)**

- `WAFFARHA_COLLECTS` (default): Waffarha **invoices** each external funder (banks) for their share and **pays the merchant** the bank + Waffarha shares → merchant gets a payout statement. The merchant's own share is shown on its statement as its contribution; no money moves for it.
- `DIRECT`: funders settle with the merchant themselves; the system issues **statements** (no invoices) to every funder and the merchant showing who owes whom.

**3a. Ledger** — nightly job writes `SettlementEntry` rows from the `RedemptionEvent` ledger: CONFIRMED → +share per funder, REFUNDED / cancel-after-confirm → −share, using each redemption's `fundingSnapshot` (proportional). Entries are dated by event date, so a refund in a later month shows up in that month. Idempotent per event.

**3b. Documents** — month-end job (Africa/Cairo / Asia/Riyadh month boundaries) per partner × currency × period:

- `INVOICE` (funder owes Waffarha): lines per campaign (redemptions, gross funded, refunds, net), VAT by partner country from a `TaxRate` table, numbering `INV-{country}-{year}-{seq}` (per-country sequence, gap-free in a transaction).
- `PAYOUT_STATEMENT` (Waffarha owes merchant) and `STATEMENT` (DIRECT mode / informational).
- Lifecycle DRAFT → ISSUED (locks numbers, emails PDF to the partner's billing email) → PAID / OVERDUE (daily job past `dueAt`) / VOID (credit-note style; never deleted).
- PDF via `pdfkit` (bilingual header, Arabic text shaped with an Arabic-capable font; tables in English) + CSV export.
- Admin pages: settlements overview, document list/detail, issue/mark paid/void, downloads.

**3c. Partner portal** (`/portal/*` in the same web app, read-only)

- Overview KPIs for campaigns the partner funds (or, for a merchant, runs at its terminals), redemptions list (BIN + masked card hash only), their funded share, documents with PDF/CSV download, CSV export of redemptions.
- Partner users manage nothing; all data scoped server-side by `partnerId`.

**Verification 3:** unit tests for ledger math (partial refunds across months, rounding stays exact with `splitByShares`), document totals = ledger totals, numbering under concurrency, both settlement modes; portal access tests (partner cannot read another partner's data); PDF renders (EN/AR) checked by screenshot.

### Phase 4 — Hardening & launch readiness

**4a. Alerts** (`Alert` table + notifier with email via SMTP/`nodemailer` and Slack webhook; dev mode logs instead of sending)

- Budget thresholds 50 / 80 / 100 % per campaign (each fired once), daily cap reached, counter drift from the reconcile job, inquiry error rate / p99 latency over threshold, expiry backlog.
- Fraud signals: card velocity (> N inquiries per card per hour across campaigns), terminal spike (redemptions/hour vs 7-day baseline), many cards on one terminal in minutes. Per-campaign option **auto-pause on fraud alert**.
- Alerts list + acknowledge in the admin dashboard.

**4b. Safety controls**

- Global kill switch (Redis flag set from the admin UI, audited) → inquire answers `UNAVAILABLE` instantly on all instances.
- Global max discount per transaction per currency (guardrail applied after the rules engine).
- Per-card velocity limit enforced in the reserve path (Redis counter), not only alerted.

**4c. Observability** — `/metrics` (prom-client): inquiries by outcome, latency histogram, reserve results, lifecycle calls, job durations; JSON structured logs with request ids; sample Grafana dashboard JSON in `infra/grafana/`.

**4d. Deployability** — Dockerfiles for `api` (API + worker entrypoints) and `web`; `infra/docker-compose.full.yml` running the whole stack; `.env` reference for every variable; migration step on deploy.

**4e. Acquirer onboarding & pilot** — `docs/acquirer-integration-guide.md` (flow, signing examples in Node and bash/openssl, error handling, fail-open rules, test cards/terminals in the sandbox seed), `docs/pilot-runbook.md` (go-live checklist, kill-switch drill, reconciliation routine, rollback).

**Verification 4:** tests for each alert rule and kill switch; load test re-run with metrics on; full stack via docker-compose (if Docker is available in the environment, otherwise local processes) → simulator payment → alert fires → invoice generated → partner portal view.

### Implementation notes (differences from the original plan)

- The worker is a second entrypoint of `apps/api` rather than a separate app, so jobs reuse the
  same services. Jobs use `@nestjs/schedule` with a Redis lock (one replica runs each job)
  instead of BullMQ; BullMQ can come later if we need queued, retried work (webhooks, invoices).
- Load testing is a Node script (`pnpm --filter @instant-discount/api load`) instead of k6.
- Integration tests run against real Postgres/Redis (local or CI service containers) instead of
  testcontainers.
- When a campaign's remaining total budget or a card's remaining amount is smaller than the
  discount, the campaign is skipped (no partial discount) and the next campaign is tried.
- If Redis loses a campaign's counters, they are rebuilt from Postgres on the next inquiry.
- Settlement: a refund or cancellation after a document was issued is not lost; it lands in the
  next run as a credit (a negative line). Voiding a document releases its entries for the next run.
  Drafting invoices fails if no VAT rate is configured for the country (never a silent 0%).
- Portal figures are live estimates (net of refunds); issued documents are the official amounts.

## Defaults assumed — to confirm with acquirer/finance during build

- Card token is stable per card across transactions (needed for per-card caps) and ideally across acquirers.
- Reservation TTL 10 min; refund window = campaign end + 90 days.
- Partial refund reverses discount proportionally.
- VAT rates and invoice format per country.

## Verification

- `pnpm test`: rules-engine unit tests (every discount type, tier boundary, cap, schedule/timezone edge, currency rounding).
- Integration tests (testcontainers Postgres + Redis): full inquire → confirm / cancel / expire / refund flows, idempotent retries, priority fall-through when top campaign is capped.
- Concurrency test: 300 parallel inquiries against a 100-redemption budget → exactly 100 granted.
- Load script against a running server: 2,000 inquiries vs a 1,000-card cap → exactly the cap granted.
- Acquirer simulator script (`pnpm --filter @instant-discount/api sim`) for an end-to-end demo.
- Manual: create campaign in admin web → approve → run simulator → run sim acquirer → see live dashboard + invoice draft + partner portal view.
