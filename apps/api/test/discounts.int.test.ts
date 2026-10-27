import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountersService } from '../src/counters/counters.service';
import { LifecycleService } from '../src/discounts/lifecycle.service';
import { JobsService } from '../src/jobs/jobs.service';
import { DEMO, createDemoCampaign } from '../scripts/demo-data';
import {
  eventually,
  inquire,
  inquiryBody,
  resetData,
  signedPost,
  startApp,
  type Harness,
} from './harness';

let h: Harness;
let counters: CountersService;
let jobs: JobsService;

async function campaign(overrides: Parameters<typeof createDemoCampaign>[2] = {}) {
  const c = await createDemoCampaign(h.prisma, h.net, overrides);
  await h.cache.refresh();
  return c;
}

beforeAll(async () => {
  const base = await startApp();
  h = { ...base, net: undefined as never };
  counters = h.app.get(CountersService);
  jobs = new JobsService(h.prisma, h.redis, h.app.get(LifecycleService), counters);
});

afterAll(async () => {
  await h.app.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  h.net = await resetData(h);
  await h.cache.refresh();
});

describe('authentication', () => {
  it('rejects missing headers, bad signatures, stale timestamps and unknown keys', async () => {
    const body = inquiryBody();
    const path = '/v1/discounts/inquire';
    const server = h.app.getHttpServer();
    const { default: request } = await import('supertest');

    expect((await request(server).post(path).send(body)).status).toBe(401);
    expect(
      (await signedPost(h.app, path, body, { idempotencyKey: 'k', secret: 'wrong' })).status,
    ).toBe(401);
    expect(
      (
        await signedPost(h.app, path, body, {
          idempotencyKey: 'k',
          timestamp: Math.floor(Date.now() / 1000) - 3600,
        })
      ).status,
    ).toBe(401);
    expect(
      (await signedPost(h.app, path, body, { idempotencyKey: 'k', apiKey: 'nope' })).status,
    ).toBe(401);
  });

  it('accepts a correctly signed request', async () => {
    const res = await inquire(h.app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligible: false, reason: 'NO_ELIGIBLE_CAMPAIGN' });
  });
});

describe('validation', () => {
  it('rejects a card number sent as the token', async () => {
    const res = await inquire(h.app, { card_token: '4123456789012345' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires an Idempotency-Key', async () => {
    const res = await signedPost(h.app, '/v1/discounts/inquire', inquiryBody());
    expect(res.status).toBe(400);
  });
});

describe('inquire', () => {
  it('grants the discount, with funding split, and replays on retry', async () => {
    const c = await campaign();
    const body = inquiryBody({ amount: 50_000 });
    const first = await signedPost(h.app, '/v1/discounts/inquire', body, {
      idempotencyKey: 'retry-me',
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      eligible: true,
      campaign_id: c.id,
      original_amount: 50_000,
      discount_amount: 10_000,
      final_amount: 40_000,
      currency: 'EGP',
      display_message: 'You saved with Demo Bank!',
    });

    const retry = await signedPost(h.app, '/v1/discounts/inquire', body, {
      idempotencyKey: 'retry-me',
    });
    expect(retry.body.redemption_id).toBe(first.body.redemption_id);
    expect(await h.prisma.redemption.count()).toBe(1);

    const reused = await signedPost(
      h.app,
      '/v1/discounts/inquire',
      { ...body, amount: 60_000 },
      { idempotencyKey: 'retry-me' },
    );
    expect(reused.status).toBe(422);

    const r = await h.prisma.redemption.findUniqueOrThrow({
      where: { id: first.body.redemption_id },
    });
    expect(r.fundingSnapshot).toEqual([
      { partnerId: h.net.bank.id, shareBps: 5_000, amountMinor: 5_000 },
      { partnerId: h.net.merchantPartner.id, shareBps: 3_000, amountMinor: 3_000 },
      { partnerId: h.net.waffarha.id, shareBps: 2_000, amountMinor: 2_000 },
    ]);
    expect(r.cardTokenHash).not.toContain('tok_card');
  });

  it('caps the percentage discount and enforces min spend', async () => {
    await campaign();
    expect((await inquire(h.app, { amount: 200_000 })).body.discount_amount).toBe(15_000);
    expect((await inquire(h.app, { amount: 19_999 })).body).toEqual({
      eligible: false,
      reason: 'NO_ELIGIBLE_CAMPAIGN',
    });
  });

  it('does not discount unknown terminals or untargeted BINs', async () => {
    await campaign();
    expect((await inquire(h.app, { terminal_id: 'NOPE' })).body.reason).toBe('UNKNOWN_TERMINAL');
    expect((await inquire(h.app, { bin: '555555' })).body.reason).toBe('NO_ELIGIBLE_CAMPAIGN');
    // The inquiry log is written off the payment path, so it can land a moment later.
    await eventually(
      async () =>
        (await h.prisma.inquiryLog.findFirst({ where: { bin: '555555' } }))?.reason ===
        'NO_ELIGIBLE_CAMPAIGN',
    );
  });

  it('falls through to the next campaign by priority when one is capped', async () => {
    const high = await campaign({ name: 'high', priority: 100, maxUniqueCards: 1 });
    const low = await campaign({ name: 'low', priority: 1 });
    expect((await inquire(h.app)).body.campaign_id).toBe(high.id);
    expect((await inquire(h.app)).body.campaign_id).toBe(low.id);
  });

  it('enforces per-card limits and frees them on cancel', async () => {
    await campaign({ perCardMaxCount: 1 });
    const card = { card_token: 'tok_same_card' };
    const first = await inquire(h.app, card);
    expect(first.body.eligible).toBe(true);
    expect((await inquire(h.app, card)).body).toEqual({
      eligible: false,
      reason: 'LIMITS_REACHED',
    });

    await signedPost(h.app, `/v1/discounts/${first.body.redemption_id}/cancel`, {});
    expect((await inquire(h.app, card)).body.eligible).toBe(true);
  });

  it('enforces the daily redemption limit', async () => {
    await campaign({ dailyRedemptionLimit: 2 });
    expect((await inquire(h.app)).body.eligible).toBe(true);
    expect((await inquire(h.app)).body.eligible).toBe(true);
    expect((await inquire(h.app)).body.reason).toBe('LIMITS_REACHED');
  });

  it('never overshoots the budget under concurrent load', async () => {
    const c = await campaign({ totalBudgetMinor: 100n * 10_000n, maxUniqueCards: null });
    const results = await Promise.all(
      Array.from({ length: 300 }, () => inquire(h.app, { amount: 50_000 })),
    );
    const granted = results.filter((r) => r.body.eligible).length;
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(granted).toBe(100);
    expect(await h.prisma.redemption.count({ where: { campaignId: c.id } })).toBe(100);
    expect((await counters.snapshot(c.id)).spent).toBe(1_000_000);
  });

  it('rebuilds counters from Postgres if Redis loses them', async () => {
    await campaign({ perCardMaxCount: 1 });
    expect((await inquire(h.app, { card_token: 'tok_rebuild' })).body.eligible).toBe(true);
    await h.redis.client.flushdb();
    expect((await inquire(h.app, { card_token: 'tok_rebuild' })).body.reason).toBe(
      'LIMITS_REACHED',
    );
    expect((await inquire(h.app, { card_token: 'tok_other' })).body.eligible).toBe(true);
  });

  it('fails open when the counter store errors', async () => {
    await campaign();
    vi.spyOn(counters, 'reserve').mockRejectedValue(new Error('redis down'));
    const res = await inquire(h.app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligible: false, reason: 'UNAVAILABLE' });
  });
});

describe('lifecycle', () => {
  async function reserved(amount = 50_000) {
    const res = await inquire(h.app, { amount, card_token: 'tok_lifecycle' });
    expect(res.body.eligible).toBe(true);
    return res.body as { redemption_id: string; final_amount: number; campaign_id: string };
  }

  it('confirms, idempotently, and rejects a wrong charged amount', async () => {
    await campaign();
    const r = await reserved();
    const path = `/v1/discounts/${r.redemption_id}/confirm`;
    expect((await signedPost(h.app, path, { charged_amount: 1 })).status).toBe(422);
    const ok = await signedPost(h.app, path, { charged_amount: r.final_amount, auth_code: 'A1' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CONFIRMED');
    expect((await signedPost(h.app, path, { charged_amount: r.final_amount })).body.status).toBe(
      'CONFIRMED',
    );
  });

  it('refuses to confirm an expired reservation and releases its budget', async () => {
    const c = await campaign();
    const r = await reserved();
    await h.prisma.redemption.update({
      where: { id: r.redemption_id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await signedPost(h.app, `/v1/discounts/${r.redemption_id}/confirm`, {
      charged_amount: r.final_amount,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESERVATION_EXPIRED');
    expect((await counters.snapshot(c.id)).spent).toBe(0);
  });

  it('refunds partially then fully, giving budget and card usage back', async () => {
    const c = await campaign({ perCardMaxCount: 1 });
    const r = await reserved(50_000); // discount 10_000, paid 40_000
    await signedPost(h.app, `/v1/discounts/${r.redemption_id}/confirm`, { charged_amount: 40_000 });

    const partial = await signedPost(h.app, `/v1/discounts/${r.redemption_id}/refund`, {
      refund_id: 'rf1',
      amount: 10_000,
    });
    expect(partial.body).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refunded_amount: 10_000,
      refunded_discount_amount: 2_500,
    });
    expect((await counters.snapshot(c.id)).spent).toBe(7_500);

    // Same refund_id again is a no-op.
    const again = await signedPost(h.app, `/v1/discounts/${r.redemption_id}/refund`, {
      refund_id: 'rf1',
      amount: 10_000,
    });
    expect(again.body.refunded_amount).toBe(10_000);

    const tooMuch = await signedPost(h.app, `/v1/discounts/${r.redemption_id}/refund`, {
      refund_id: 'rf2',
      amount: 30_001,
    });
    expect(tooMuch.status).toBe(422);

    const full = await signedPost(h.app, `/v1/discounts/${r.redemption_id}/refund`, {
      refund_id: 'rf3',
      amount: 30_000,
    });
    expect(full.body).toMatchObject({ status: 'REFUNDED', refunded_discount_amount: 10_000 });
    expect(await counters.snapshot(c.id)).toMatchObject({ spent: 0, count: 0, cards: 0 });
    expect((await inquire(h.app, { card_token: 'tok_lifecycle' })).body.eligible).toBe(true);
  });

  it('cannot cancel after a refund, and cannot act on another acquirer’s redemption', async () => {
    await campaign();
    const r = await reserved();
    await signedPost(h.app, `/v1/discounts/${r.redemption_id}/confirm`, {
      charged_amount: r.final_amount,
    });
    await signedPost(h.app, `/v1/discounts/${r.redemption_id}/refund`, {
      refund_id: 'x',
      amount: 1_000,
    });
    expect((await signedPost(h.app, `/v1/discounts/${r.redemption_id}/cancel`, {})).status).toBe(
      409,
    );
    expect(
      (await signedPost(h.app, `/v1/discounts/00000000-0000-0000-0000-000000000000/cancel`, {}))
        .status,
    ).toBe(404);
  });
});

describe('jobs', () => {
  it('expires stale reservations and frees their budget', async () => {
    const c = await campaign();
    const r = (await inquire(h.app)).body;
    await h.prisma.redemption.update({
      where: { id: r.redemption_id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await jobs.expireReservations()).toBe(1);
    expect(
      (await h.prisma.redemption.findUniqueOrThrow({ where: { id: r.redemption_id } })).status,
    ).toBe('EXPIRED');
    expect((await counters.snapshot(c.id)).spent).toBe(0);
  });

  it('activates scheduled campaigns and ends finished ones', async () => {
    const scheduled = await campaign({ status: 'SCHEDULED' });
    const finished = await campaign({ endAt: new Date(Date.now() - 1000) });
    expect(await jobs.advanceCampaigns()).toBe(2);
    const [s, f] = await Promise.all([
      h.prisma.campaign.findUniqueOrThrow({ where: { id: scheduled.id } }),
      h.prisma.campaign.findUniqueOrThrow({ where: { id: finished.id } }),
    ]);
    expect([s.status, f.status]).toEqual(['ACTIVE', 'ENDED']);
  });

  it('reports no drift after a mix of operations', async () => {
    await campaign();
    const a = (await inquire(h.app)).body;
    await inquire(h.app);
    await signedPost(h.app, `/v1/discounts/${a.redemption_id}/cancel`, {});
    expect(await jobs.reconcile()).toEqual([]);
  });
});

it('demo terminal is wired to the demo acquirer', () => {
  expect(DEMO.terminalId).toBe('TID0001');
});
