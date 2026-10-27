# Instant Discount

Real-time card discounts at POS. When a customer pays by card, the acquirer asks this
service whether a campaign applies. If one does, the POS charges the discounted amount.
If none does, or the service doesn't answer within ~800 ms, the full amount is charged.

See [docs/PLAN.md](docs/PLAN.md) for requirements, architecture and the phased roadmap.

## Layout

| Path                    | What                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `packages/shared`       | Enums, currencies (EGP/SAR), money helpers (integer minor units) |
| `packages/rules-engine` | Pure eligibility + discount calculation + campaign ranking       |
| `packages/db`           | Prisma schema (PostgreSQL)                                       |
| `infra/`                | docker-compose for Postgres + Redis                              |
| `apps/`                 | API, worker, admin web, partner portal (coming next)             |

## Development

```bash
pnpm install
pnpm infra:up                      # Postgres + Redis
cp .env.example .env
pnpm turbo run build typecheck test
```
