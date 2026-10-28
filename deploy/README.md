# Deploying to Kubernetes (GitOps)

```
GitHub (main) ──release.yml──► private registry (api, web images)
      │                              ▲
      └─ pins digests in deploy/environments/<env>/values.yaml
                                     │
Argo CD ── watches this repo ──► cluster: api (HPA) · worker · web · migrate Job (PreSync)
                                     │
                     managed Postgres + Redis (outside the cluster)
```

- **Staging** deploys automatically on every push to `main` (Argo CD auto-sync).
- **Production**: push a tag `v*` → the `production` GitHub environment asks for approval →
  the images staging is running are re-tagged (never rebuilt) and pinned in
  `environments/production/values.yaml` → someone presses **Sync** in Argo CD.

## Prerequisites (platform team)

| Component                 | Notes                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Kubernetes ≥ 1.27         | namespaces `instant-discount-staging`, `instant-discount`                            |
| ingress-nginx             | mTLS annotations on the acquirer host; set `ingress.className` if different          |
| cert-manager              | `cert-manager.io/cluster-issuer` annotation on the web host                          |
| Sealed Secrets controller | `kubeseal` CLI with the cluster's public key                                         |
| Argo CD                   | apply `deploy/argocd/staging.yaml` and `deploy/argocd/production.yaml`               |
| Prometheus                | optional `serviceMonitor.enabled: true` (Prometheus Operator)                        |
| Managed Postgres 16       | TLS (`sslmode=require`); one database per environment                                |
| Managed Redis 7           | AUTH + TLS (`rediss://`); persistence on (counters can be rebuilt, but it avoids it) |

## First-time setup

1. **Registry**: create the `instant-discount/api` and `instant-discount/web` repositories, a CI
   robot account (push) and a pull Secret in each namespace:
   `kubectl -n <ns> create secret docker-registry registry-credentials --docker-server=… --docker-username=… --docker-password=…`
2. **GitHub**: repository variable `REGISTRY` (e.g. `registry.waffarha.com/instant-discount`),
   secrets `REGISTRY_USERNAME` / `REGISTRY_PASSWORD`, and an environment named `production` with
   required reviewers.
3. **Hosts**: set real hostnames in `environments/*/values.yaml` (`ingress.*.host`, `config.WEB_BASE_URL`).
4. **Acquirer mTLS**: create the CA Secret the acquirers' client certificates chain to:
   `kubectl -n <ns> create secret generic acquirer-client-ca --from-file=ca.crt=acquirer-ca.pem`,
   and set `whitelist-source-range` to the acquirers' egress IPs in production.
5. **Secrets** (below), then apply the Argo CD applications: `kubectl apply -f deploy/argocd/staging.yaml`.

## Secrets

Never commit plain Secrets. Start from `environments/secret.template.yaml`, fill it in outside the
repository, and seal it for the target namespace:

```bash
cp deploy/environments/secret.template.yaml /tmp/secret.yaml   # edit values; set metadata.namespace
kubeseal --format yaml --namespace instant-discount-staging < /tmp/secret.yaml \
  > deploy/environments/staging/secrets/instant-discount-secrets.sealed.yaml
shred -u /tmp/secret.yaml
git add deploy/environments/staging/secrets/instant-discount-secrets.sealed.yaml
```

| Key                             | Required          | Notes                                                                                                            |
| ------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | yes               | `postgresql://…?sslmode=require&connection_limit=10` (pool per pod × replicas must fit the DB's max connections) |
| `REDIS_URL`                     | yes               | `rediss://:password@host:6380`                                                                                   |
| `CARD_TOKEN_PEPPER`             | yes               | long random; rotating it resets per-card history                                                                 |
| `SECRETS_ENCRYPTION_KEY`        | yes               | `openssl rand -base64 32`; **back it up**, it decrypts acquirer secrets                                          |
| `GOOGLE_CLIENT_ID`              | for staff login   | OAuth client restricted to the web host                                                                          |
| `SMTP_URL`, `SLACK_WEBHOOK_URL` | for notifications | without them alerts and emails are only logged                                                                   |
| `METRICS_TOKEN`                 | recommended       | Prometheus bearer token for `/metrics`                                                                           |

Non-secret settings live in `config:` in the values files (rendered to a ConfigMap; a change rolls
the pods automatically).

## What the chart runs

| Workload      | Probes                                            | Notes                                                                                      |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `api`         | live `/health/live`, ready `/health` (DB + Redis) | HPA on CPU, PDB, zero-downtime rolling updates, `preStop` drain                            |
| `worker`      | live `/health/live`, ready `/health` on port 3010 | `/metrics` for job durations; jobs use Redis locks, so 2 replicas are safe                 |
| `web`         | `/runtime-config`                                 | `API_URL` points at the in-cluster API; Google client id and dev-login are read at runtime |
| `migrate` Job | —                                                 | `prisma migrate deploy` as an Argo CD PreSync hook; the rollout stops if it fails          |

All pods run as non-root with a read-only root filesystem. A NetworkPolicy lets only the ingress
controller, the web pods and Prometheus reach the API; `/metrics` and the admin API are never exposed
through an Ingress (the admin UI calls the API through the web app's `/api` proxy).

## Smoke test after a staging deploy

```bash
API_URL=https://acquirer.instant-discount.staging.example.com \
ACQUIRER_API_KEY=acq_… ACQUIRER_SECRET=… \
  pnpm --filter @instant-discount/api sim -- --amount 50000 --refund 10000
```

(Through the acquirer host this also needs the mTLS client certificate; from inside the cluster,
port-forward the api Service instead.)

## Rollback

Revert the values commit (`git revert <deploy(staging|production) commit>`); Argo CD rolls the
pods back to the previous digests. Migrations are additive; if one must be undone, restore the
pre-deploy database backup.

## Validating chart changes

CI runs `helm lint`, `helm template` for both environments and `kubeconform` on every push
(`.github/workflows/ci.yml`, job `chart`), and builds both Docker images (job `images`).
