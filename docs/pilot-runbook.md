# Pilot runbook

For the first live run: one acquirer, one bank, a handful of merchants.

## Before go-live

Deployment itself (Kubernetes, Argo CD, sealed secrets, registry) is described in
[`deploy/README.md`](../deploy/README.md).

- [ ] Production secrets set: `CARD_TOKEN_PEPPER`, `SECRETS_ENCRYPTION_KEY` (32 random bytes),
      `GOOGLE_CLIENT_ID`, `SMTP_URL`, `SLACK_WEBHOOK_URL`, `METRICS_TOKEN`. Stored in the secret
      manager, never in the repo. **Back up `SECRETS_ENCRYPTION_KEY`** — without it acquirer
      secrets cannot be decrypted. Rotating `CARD_TOKEN_PEPPER` resets per-card history.
- [ ] `NODE_ENV=production`, `DEV_LOGIN=false`, `COOKIE_SECURE=true`, `LOG_FORMAT=json`,
      `TRUST_PROXY=true` behind the load balancer; `DEV_LOGIN=false` on the web app too.
- [ ] Database migrations applied (the chart's `migrate` PreSync Job); automated
      Postgres backups with point-in-time recovery; Redis with AOF persistence.
- [ ] mTLS enforced at the ingress for `/v1/*`; acquirer egress IPs allow-listed.
- [ ] VAT rates confirmed by finance (Settlements → VAT rates); billing emails set on partners.
- [ ] Admins and approvers invited (Users); at least two approvers so maker-checker never blocks.
- [ ] Prometheus scraping `/metrics`; Grafana "Instant Discount" dashboard; Slack alerts arriving.
- [ ] Guardrails reviewed (Safety): max discount per payment, discounts per card per hour.
- [ ] Load test against staging at expected peak × 3 (`pnpm --filter @instant-discount/api load`).

## Launch day

1. Create the pilot campaign with a **small total budget and daily budget**, tick
   "pause automatically on fraud alert", submit, and have a second person approve it.
2. Run the simulator for each pilot terminal and a target BIN.
3. Ask the acquirer to switch the pilot terminals on; watch the overview page and Grafana:
   granted %, fail-open %, p99 latency.
4. First real transaction: check it in Transactions (history shows reserved → confirmed).

## Kill-switch drill (do it once before launch)

1. Safety → **Stop all discounts**, with a reason. Every API instance answers `KILL_SWITCH`
   within seconds; a red banner shows in the admin; admins get an email and Slack message.
2. Make a test payment: it goes through at full price.
3. **Resume discounts**. Confirm the next test payment is discounted again.

To stop one campaign only, use **Pause** on its page instead.

## Daily routine

- Alerts page: acknowledge or act on every open alert.
- Overview: "Why payments got no discount" — a jump in `UNKNOWN_TERMINAL` means terminals are
  missing from the registry; `UNAVAILABLE` means failing open (check health).
- Counter drift alerts: if one persists, the counters can be rebuilt from Postgres (delete the
  campaign's `{c:<id>}:init` key in Redis; the next inquiry rebuilds it).

## Month end

On the 1st the worker drafts last month's documents per country. Finance reviews drafts
(Settlements), re-runs the month if late changes are expected, then **Issues** each document:
it gets a number, is locked and is emailed to the partner's billing email. Mark invoices paid
when money arrives; overdue invoices are flagged daily. A wrong document is voided (never
deleted); its amounts are included in the next run.

## Incidents

| Symptom                           | First action                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Fail-open % high                  | Check `/health` (DB, Redis). Payments are safe (full price). Scale or fix the dependency.                                                |
| Fraud alert on a terminal         | Pause affected campaigns (if not auto-paused), contact merchant and acquirer.                                                            |
| Budget overspent suspicion        | Compare campaign stats with Transactions; reconciliation alerts on drift. Budgets are enforced atomically, so overspend is not expected. |
| Wrong campaign configuration live | Pause, propose the fix, approve, resume. Or use the kill switch for a global problem.                                                    |

## Rollback

Deploy the previous image tag. Migrations are additive in this release; no data rollback is
needed. If a migration must be reverted, restore from the pre-deploy backup.
