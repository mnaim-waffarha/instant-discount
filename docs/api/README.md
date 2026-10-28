# API documentation

Everything here except this file, `index.html` and `redocly.yaml` is **generated from the code**.
Do not edit it by hand.

| File                                      | What                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| [`acquirer-v1.yaml`](acquirer-v1.yaml)    | OpenAPI 3.1: the API acquirers integrate with (`/v1/discounts`)          |
| [`admin-v1.yaml`](admin-v1.yaml)          | OpenAPI 3.1: admin web app and partner portal API (`/admin/v1`)          |
| [`ops.yaml`](ops.yaml)                    | OpenAPI 3.1: health probes and Prometheus metrics                        |
| [`endpoints.md`](endpoints.md)            | One table of all endpoints and who may call them                         |
| `acquirer.html`, `admin.html`, `ops.html` | Readable reference (Redoc). Open [`index.html`](index.html) in a browser |

## How it is generated

`apps/api/src/openapi/` builds the specs from the running code's own metadata:

- **Routes, HTTP status codes and roles** are read from the Nest controllers (`@Get`, `@HttpCode`,
  `@Roles`, `@Public`).
- **Request bodies and query parameters** are the same Zod schemas the `ZodPipe` validates with,
  so limits, enums and patterns in the docs are exactly what the API enforces. Field descriptions
  come from `.describe()` on those schemas.
- **Response shapes** for database records come from the Prisma schema; route-specific shapes
  (relations, computed fields) are declared in `src/openapi/routes.ts` and `components.ts`.
- **Summaries, descriptions, error codes and examples** live in `src/openapi/routes.ts`, one entry
  per route.

Three checks keep the docs true:

1. Generation fails if a route has no entry in `routes.ts`, or an entry has no route.
2. `test/api-docs.int.test.ts` calls 50+ endpoints on a real database and validates every JSON
   response against the generated spec, failing on undocumented fields too.
3. CI runs `docs:check`, which fails when these files differ from what the code generates.

## Commands

```bash
pnpm --filter @instant-discount/api docs:api     # regenerate everything in docs/api
pnpm --filter @instant-discount/api docs:check   # what CI runs
```

Run `docs:api` whenever you add or change a route, a request schema or a response.

## Conventions (all APIs)

- Money is an integer in **minor units** (piastres for EGP, halalas for SAR): 125.50 EGP = `12550`.
- Percentages in configuration are **basis points**: 15% = `1500`.
- Times are ISO 8601 in UTC; each campaign has an IANA `timezone` for its schedule and daily caps.
- Lists take `page` (from 1) and `pageSize` (max 200) and return `{ items, total, page, pageSize }`.
- Errors are `{ "error": { "code": "...", "message": "..." } }`. `400 VALIDATION_ERROR` lists
  every invalid field; `401 UNAUTHORIZED`; `403 FORBIDDEN` (role); `404 *_NOT_FOUND`;
  `409` state conflicts (e.g. `INVALID_STATUS`); `422` business-rule violations; `429 RATE_LIMITED`.
