# Instant Discount — working rules

Real-time POS card discounts for Waffarha (EG + KSA). Monorepo: `apps/api` (NestJS acquirer API,
admin API and worker), `apps/web` (Next.js admin + partner portal, EN/AR), `packages/*`
(rules engine, shared money/country helpers, Prisma schema). Background: `docs/PLAN.md`.

## Workflow

- Work on a feature branch, never directly on `main`.
- **After each task:** run the checks below, commit, push the branch, and **open a pull request
  into `main`**. Describe what changed and how it was tested.
- If the previous PR was merged, start the next task from the latest `main`
  (`git fetch origin main && git checkout -B <branch> origin/main`) instead of stacking on
  merged history.
- Commit only source; never commit `.env`, secrets or local data.

## Checks before pushing

```bash
pnpm turbo run build typecheck test   # unit + integration tests (needs Postgres + Redis)
npx prettier --check .
pnpm turbo run docs:check             # API docs match the code
```

For UI changes, also run the browser smoke test (`node apps/web/e2e/smoke.mjs`) against a
running stack and look at the screenshots in English and Arabic.

## Conventions

- Money is an integer in minor units (piastres / halalas) everywhere; percentages in
  configuration are basis points.
- Every UI string exists in English and Arabic (`apps/web/messages/en.ts` / `ar.ts` share typed
  keys); layouts must work right-to-left.
- Database changes: edit `packages/db/prisma/schema.prisma`, then create the migration with
  `prisma migrate diff --from-migrations … --to-schema-datamodel … --script`. Backfill before
  making a column `NOT NULL`.
- Validation is Zod (`ZodPipe`). Errors are `{ error: { code, message } }` via `ApiError`.
- **API docs are generated** (`docs/api/`). When you add or change a route, a request schema or
  a response, update `apps/api/src/openapi/routes.ts` (or `components.ts`) and run
  `pnpm --filter @instant-discount/api docs:api`. Never edit the generated files by hand.
- Brand: the web app uses the secondary palette (`apps/web/tailwind.config.ts`); the logo stays
  the primary orange.

## Pointers

- `docs/PLAN.md`: requirements, decisions, progress
- `docs/api/`: OpenAPI specs and the HTML reference (`index.html`)
- `docs/acquirer-integration-guide.md`, `docs/pilot-runbook.md`
- `deploy/README.md`: Kubernetes, Argo CD, secrets, releases
