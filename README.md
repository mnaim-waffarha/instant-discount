# Instant Discount

Real-time card discounts at POS. When a customer pays by card, the acquirer asks this
service whether a campaign applies. If one does, the POS charges the discounted amount.
If none does, or the service doesn't answer within ~800 ms, the full amount is charged.

- [docs/PLAN.md](docs/PLAN.md): requirements, architecture, roadmap and progress
- [docs/api/](docs/api/README.md): full API documentation generated from the code: OpenAPI 3.1 for the acquirer, admin/portal and ops APIs, an endpoint table and an HTML reference ([`index.html`](docs/api/index.html))
- [CLAUDE.md](CLAUDE.md): working rules (checks, PR to `main` after each task, conventions)
- [docs/acquirer-integration-guide.md](docs/acquirer-integration-guide.md): onboarding, signing examples, failure handling, certification
- [docs/pilot-runbook.md](docs/pilot-runbook.md): go-live checklist, kill-switch drill, month end, incidents
- [deploy/README.md](deploy/README.md): Kubernetes + Argo CD deployment, secrets, CI/CD, rollback

## Layout

| Path                    | What                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `apps/api`              | NestJS service: acquirer API (`dist/main.js`) and background worker (`dist/worker.js`) |
| `packages/rules-engine` | Pure eligibility + discount calculation + campaign ranking + config schemas            |
| `packages/shared`       | Enums, currencies (EGP/SAR), money helpers (integer minor units)                       |
| `packages/db`           | Prisma schema and migrations (PostgreSQL)                                              |
| `infra/`                | docker-compose for Postgres + Redis                                                    |

## How a payment works

1. `POST /v1/discounts/inquire`: we resolve the terminal and evaluate active campaigns by
   priority. The first one whose limits have room is **reserved** atomically in Redis
   (budget, unique cards, daily and per-card caps).
2. `POST /v1/discounts/{id}/confirm` once the charge succeeds, or `/cancel` if it fails.
   Unconfirmed reservations expire after 10 minutes and their budget is released by the worker.
3. `POST /v1/discounts/{id}/refund` reverses the discount in proportion to the amount refunded.

Postgres is the source of truth. Redis counters can be rebuilt from it at any time.

Safety: a global kill switch, a per-currency cap on any single discount and a per-card hourly
limit apply to every payment (Admin → Safety). Budget, health and fraud alerts go to the
dashboard, admin email and Slack; campaigns can opt in to pause automatically on fraud alerts.
`/metrics` exposes Prometheus metrics.

Experiments: a campaign can keep a holdout group (cards that get no discount) and split the rest
between up to three A/B variants. The campaign page and the partner portal report the uplift
in spend per card against the holdout, with confidence intervals and ROI.

## Run the whole stack in Docker

```bash
cp .env.example .env    # set real secrets
docker compose -f infra/docker-compose.full.yml up --build
# web :3001 · api :3000 · Prometheus :9090 · Grafana :3002
```

## Development

```bash
pnpm install
pnpm infra:up                         # Postgres + Redis (Docker)
cp .env.example .env                  # then: set -a; . ./.env; set +a
pnpm --filter @instant-discount/db migrate:deploy
pnpm turbo run build
pnpm --filter @instant-discount/api seed          # demo acquirer, terminal and campaign
pnpm --filter @instant-discount/api start         # API on :3000
pnpm --filter @instant-discount/api start:worker  # background jobs

pnpm --filter @instant-discount/api sim -- --amount 50000 --refund 10000   # one simulated payment
pnpm --filter @instant-discount/api load -- --requests 2000 --concurrency 50
```

Web app (port 3001):

```bash
cp apps/web/.env.example apps/web/.env.local   # DEV_LOGIN=true for local sign-in
pnpm --filter @instant-discount/web dev
```

Sign-in: staff use Google (`GOOGLE_CLIENT_ID`, `@waffarha.com` only); partner users get an email
magic link. Locally, with `DEV_LOGIN=true` for both the API and the web app, sign in as
any seeded user, e.g. `manager@waffarha.com` and `approver@waffarha.com` (campaigns need a
different user to approve them). `BOOTSTRAP_ADMIN_EMAILS` creates the first admins.

Browser smoke test against the running stack: `node apps/web/e2e/smoke.mjs <screenshot-dir>`.

Tests (the integration tests need Postgres and Redis running; they use the
`instant_discount_test` database and Redis db 1):

```bash
pnpm turbo run build typecheck test
```
