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
                                  PostgreSQL (source of truth) ◄── Workers (BullMQ):
                                      ▲                            reservation expiry, reconciliation,
                                      │                            invoicing, alerts, webhooks
Admin Web / Partner Portal (Next.js) ─► Admin API (NestJS, JWT + RBAC)
```

Monorepo (pnpm + Turborepo):

```
apps/
  api/            NestJS — modules: decision, transactions, campaigns, partners, merchants,
                  acquirers, invoicing, reports, auth, audit
  worker/         NestJS standalone — BullMQ jobs
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

We start implementation with Phase 0 → Phase 1 on branch `claude/optimistic-cray-navsz4`.

## Defaults assumed — to confirm with acquirer/finance during build

- Card token is stable per card across transactions (needed for per-card caps) and ideally across acquirers.
- Reservation TTL 10 min; refund window = campaign end + 90 days.
- Partial refund reverses discount proportionally.
- VAT rates and invoice format per country.

## Verification

- `pnpm test`: rules-engine unit tests (every discount type, tier boundary, cap, schedule/timezone edge, currency rounding).
- Integration tests (testcontainers Postgres + Redis): full inquire → confirm / cancel / expire / refund flows, idempotent retries, priority fall-through when top campaign is capped.
- k6 concurrency test: 1,000 parallel inquiries against a 100-redemption budget → exactly 100 granted; p99 < 150 ms.
- Simulated acquirer script (`infra/sim-acquirer`) for end-to-end demo against docker-compose.
- Manual: create campaign in admin web → approve → run simulator → run sim acquirer → see live dashboard + invoice draft + partner portal view.
