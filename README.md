# Instant Discount

Real-time card discounts at POS. When a customer pays by card, the acquirer asks this
service whether a campaign applies. If one does, the POS charges the discounted amount.
If none does, or the service doesn't answer within ~800 ms, the full amount is charged.

- [docs/PLAN.md](docs/PLAN.md): requirements, architecture, roadmap and progress
- [docs/api/acquirer-v1.yaml](docs/api/acquirer-v1.yaml): the API acquirers integrate with (OpenAPI 3)

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

Tests (the integration tests need Postgres and Redis running; they use the
`instant_discount_test` database and Redis db 1):

```bash
pnpm turbo run build typecheck test
```
