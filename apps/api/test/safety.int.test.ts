import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailerService } from '../src/mail/mailer.service';
import { AlertsService } from '../src/safety/alerts.service';
import { SettingsService } from '../src/safety/settings.service';
import { createDemoCampaign } from '../scripts/demo-data';
import { inquire, loginAs, resetData, signedPost, startApp, type Harness } from './harness';

let h: Harness;
let alerts: AlertsService;
let settings: SettingsService;

async function campaign(overrides: Parameters<typeof createDemoCampaign>[2] = {}) {
  const c = await createDemoCampaign(h.prisma, h.net, { perCardMaxCount: 20, ...overrides });
  await h.cache.refresh();
  return c;
}

beforeAll(async () => {
  const base = await startApp();
  h = { ...base, net: undefined as never };
  alerts = h.app.get(AlertsService);
  settings = h.app.get(SettingsService);
});
afterAll(async () => h.app.close());
beforeEach(async () => {
  h.net = await resetData(h);
  await h.prisma.user.createMany({
    data: [
      { email: 'admin@waffarha.com', name: 'Admin', role: 'ADMIN' },
      { email: 'manager@waffarha.com', name: 'Manager', role: 'CAMPAIGN_MANAGER' },
    ],
  });
  await h.cache.refresh();
});

describe('safety controls', () => {
  it('kill switch stops every discount at once, and only admins can flip it', async () => {
    await campaign();
    const admin = await loginAs(h.app, 'admin@waffarha.com');
    const manager = await loginAs(h.app, 'manager@waffarha.com');
    expect(
      (await manager.post('/admin/v1/safety/kill-switch').send({ enabled: true, reason: 'test' }))
        .status,
    ).toBe(403);

    await admin
      .post('/admin/v1/safety/kill-switch')
      .send({ enabled: true, reason: 'suspected fraud' })
      .expect(200);
    expect((await inquire(h.app)).body).toEqual({ eligible: false, reason: 'KILL_SWITCH' });
    expect(await h.prisma.alert.count({ where: { type: 'KILL_SWITCH' } })).toBe(1);

    await admin
      .post('/admin/v1/safety/kill-switch')
      .send({ enabled: false, reason: 'all clear' })
      .expect(200);
    expect((await inquire(h.app)).body.eligible).toBe(true);
    expect(
      (await h.prisma.auditLog.findMany({ where: { action: 'settings.update' } })).length,
    ).toBe(2);
  });

  it('caps any single discount at the per-currency guardrail', async () => {
    await campaign();
    await settings.update(null, { maxDiscountPerTxnMinor: { EGP: 5_000, SAR: null } });
    const r = (await inquire(h.app, { amount: 50_000 })).body;
    expect(r).toMatchObject({ eligible: true, discount_amount: 5_000, final_amount: 45_000 });
  });

  it('limits discounts per card per hour across campaigns, without counting misses', async () => {
    await campaign();
    await settings.update(null, { cardVelocity: { maxGrantsPerHour: 2 } });
    const card = { card_token: 'tok_velocity_card' };
    expect((await inquire(h.app, { ...card, bin: '999999' })).body.reason).toBe(
      'NO_ELIGIBLE_CAMPAIGN',
    );
    expect((await inquire(h.app, card)).body.eligible).toBe(true);
    expect((await inquire(h.app, card)).body.eligible).toBe(true);
    expect((await inquire(h.app, card)).body.reason).toBe('VELOCITY_LIMIT');
    expect((await inquire(h.app, { card_token: 'tok_other_card' })).body.eligible).toBe(true);
  });

  it('validates settings updates', async () => {
    const admin = await loginAs(h.app, 'admin@waffarha.com');
    expect(
      (await admin.put('/admin/v1/safety').send({ cardVelocity: { maxGrantsPerHour: -1 } })).status,
    ).toBe(400);
    const ok = await admin.put('/admin/v1/safety').send({ alerts: { errorRatePct: 2 } });
    expect(ok.body.alerts).toMatchObject({ errorRatePct: 2, p99LatencyMs: 500 });
  });
});

describe('alerts', () => {
  it('fires budget thresholds once each, emailing admins for the serious ones', async () => {
    await campaign({ totalBudgetMinor: 20_000n });
    const mailer = h.app.get(MailerService);
    mailer.outbox.length = 0;

    await inquire(h.app, { amount: 50_000 }); // 100 EGP of 200 → 50%
    await alerts.evaluate();
    await alerts.evaluate();
    let found = await h.prisma.alert.findMany({ where: { type: 'BUDGET_THRESHOLD' } });
    expect(found.map((a) => a.severity)).toEqual(['INFO']);
    expect(mailer.outbox).toHaveLength(0); // INFO is not emailed

    await inquire(h.app, { amount: 50_000 }); // 100%
    await alerts.evaluate();
    found = await h.prisma.alert.findMany({
      where: { type: 'BUDGET_THRESHOLD' },
      orderBy: { createdAt: 'asc' },
    });
    expect(found.map((a) => a.severity)).toEqual(['INFO', 'WARNING', 'CRITICAL']);
    expect(mailer.outbox.map((m) => m.to)).toEqual(['admin@waffarha.com', 'admin@waffarha.com']);
  });

  it('flags a high fail-open rate', async () => {
    await h.prisma.inquiryLog.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        acquirerId: h.net.acquirer.id,
        acquirerTxnRef: `x${i}`,
        bin: '412345',
        amountMinor: 1_000n,
        currency: 'EGP' as const,
        eligible: false,
        reason: i < 5 ? 'UNAVAILABLE' : 'NO_ELIGIBLE_CAMPAIGN',
        latencyMs: 10,
      })),
    });
    await alerts.evaluate();
    expect(await h.prisma.alert.findFirst({ where: { type: 'ERROR_RATE' } })).toMatchObject({
      severity: 'CRITICAL',
    });
  });

  it('detects a terminal spike and auto-pauses opted-in campaigns', async () => {
    const c = await campaign({ autoPauseOnFraud: true });
    await settings.update(null, { alerts: { terminalSpikeMin: 3, terminalSpikeFactor: 1 } });
    for (let i = 0; i < 3; i++) await inquire(h.app);
    await alerts.evaluate();
    expect(
      await h.prisma.alert.findFirst({ where: { type: 'FRAUD_TERMINAL_SPIKE' } }),
    ).toBeTruthy();
    expect((await h.prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'PAUSED',
    );
    expect(
      await h.prisma.alert.findFirst({ where: { type: 'CAMPAIGN_AUTO_PAUSED', campaignId: c.id } }),
    ).toBeTruthy();
    await h.cache.refresh();
    expect((await inquire(h.app)).body.eligible).toBe(false);
  });

  it('flags one card making many inquiries', async () => {
    await campaign();
    await settings.update(null, { alerts: { cardInquiriesPerHour: 3 } });
    for (let i = 0; i < 4; i++)
      await inquire(h.app, { card_token: 'tok_busy_card', bin: '999999' });
    // The inquiry log is written off the payment path.
    await new Promise((r) => setTimeout(r, 200));
    await alerts.evaluate();
    expect(
      await h.prisma.alert.findFirst({ where: { type: 'FRAUD_CARD_VELOCITY' } }),
    ).toMatchObject({ severity: 'WARNING' });
  });

  it('lists and acknowledges alerts', async () => {
    await alerts.raise({
      type: 'TEST',
      severity: 'WARNING',
      title: 't',
      message: 'm',
      dedupeKey: 'k',
    });
    expect(
      await alerts.raise({
        type: 'TEST',
        severity: 'WARNING',
        title: 't',
        message: 'm',
        dedupeKey: 'k',
      }),
    ).toBe(false);
    const manager = await loginAs(h.app, 'manager@waffarha.com');
    const list = (await manager.get('/admin/v1/alerts?status=OPEN')).body;
    expect(list.total).toBe(1);
    await manager.post(`/admin/v1/alerts/${list.items[0].id}/acknowledge`).send({}).expect(200);
    expect((await manager.get('/admin/v1/alerts?status=OPEN')).body.total).toBe(0);
  });
});

describe('observability', () => {
  it('exposes Prometheus metrics and echoes request ids', async () => {
    await campaign();
    const r = (await inquire(h.app)).body;
    await signedPost(h.app, `/v1/discounts/${r.redemption_id}/confirm`, {
      charged_amount: r.final_amount,
    });
    const metrics = await request(h.app.getHttpServer()).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toMatch(/instant_discount_inquiries_total\{outcome="GRANTED"\} \d+/);
    expect(metrics.text).toMatch(
      /instant_discount_lifecycle_total\{action="confirm",outcome="ok"\} \d+/,
    );
    expect(metrics.text).toContain('instant_discount_inquiry_duration_seconds_bucket');

    const res = await request(h.app.getHttpServer()).get('/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
