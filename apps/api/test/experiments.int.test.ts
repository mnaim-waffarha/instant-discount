import { HOLDOUT, assignGroup, type ExperimentConfig } from '@instant-discount/rules-engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashCardToken } from '../src/common/crypto';
import { createDemoCampaign } from '../scripts/demo-data';
import { DEMO } from '../scripts/demo-data';
import { eventually, inquire, loginAs, resetData, startApp, type Harness } from './harness';

let h: Harness;
const pepper = () => process.env.CARD_TOKEN_PEPPER!;

/** A card token that lands in `group` for this campaign's experiment. */
async function cardIn(campaignId: string, group: string, prefix = 'tok_exp') {
  const c = await h.prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { variants: true },
  });
  const exp: ExperimentConfig = {
    campaignId: c.id,
    salt: c.experimentSalt,
    holdoutBps: c.holdoutBps,
    variants: c.variants
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((v) => ({ key: v.key, weightBps: v.weightBps, discount: v.discountConfig as never })),
  };
  for (let i = 0; i < 10_000; i++) {
    const token = `${prefix}_${group}_${i}_card`;
    if (assignGroup(exp, hashCardToken(pepper(), token)) === group) return token;
  }
  throw new Error(`no card found for ${group}`);
}

beforeAll(async () => {
  const base = await startApp();
  h = { ...base, net: undefined as never };
});
afterAll(async () => h.app.close());
beforeEach(async () => {
  h.net = await resetData(h);
  await h.prisma.user.createMany({
    data: [
      { email: 'manager@waffarha.com', name: 'Manager', role: 'CAMPAIGN_MANAGER' },
      { email: 'approver@waffarha.com', name: 'Approver', role: 'APPROVER' },
      {
        email: 'ops@demobank.example',
        name: 'Bank Ops',
        role: 'PARTNER_USER',
        partnerId: h.net.bank.id,
      },
    ],
  });
  await h.cache.refresh();
});

describe('holdout', () => {
  it('holdout cards get a plain "no discount", treated cards get it, and both are recorded', async () => {
    const c = await createDemoCampaign(h.prisma, h.net, { holdoutBps: 2_000, perCardMaxCount: 10 });
    await h.cache.refresh();
    const held = await cardIn(c.id, HOLDOUT);
    const treated = await cardIn(c.id, 'A');

    expect((await inquire(h.app, { card_token: held })).body).toEqual({
      eligible: false,
      reason: 'NO_ELIGIBLE_CAMPAIGN',
    });
    expect((await inquire(h.app, { card_token: held })).body.eligible).toBe(false); // same card, same group
    const ok = (await inquire(h.app, { card_token: treated })).body;
    expect(ok.eligible).toBe(true);

    await eventually(async () => (await h.prisma.campaignExposure.count()) === 3);
    const rows = await h.prisma.campaignExposure.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.group)).toEqual([HOLDOUT, HOLDOUT, 'A']);
    expect(rows[2]!.redemptionId).toBe(ok.redemption_id);
    expect(rows.every((r) => r.merchantPartnerId === h.net.merchantPartner.id)).toBe(true);
  });

  it('a held-out card may still get a lower-priority campaign; only the top campaign records exposure', async () => {
    const top = await createDemoCampaign(h.prisma, h.net, {
      name: 'top',
      priority: 50,
      holdoutBps: 2_000,
    });
    const fallback = await createDemoCampaign(h.prisma, h.net, { name: 'fallback', priority: 1 });
    await h.cache.refresh();
    const held = await cardIn(top.id, HOLDOUT);
    const r = (await inquire(h.app, { card_token: held })).body;
    expect(r.campaign_id).toBe(fallback.id);
    await eventually(async () => (await h.prisma.campaignExposure.count()) === 1);
    expect(await h.prisma.campaignExposure.findFirst()).toMatchObject({
      campaignId: top.id,
      group: HOLDOUT,
      redemptionId: null,
    });
  });
});

describe('A/B variants', () => {
  async function abCampaign() {
    const manager = await loginAs(h.app, 'manager@waffarha.com');
    const approver = await loginAs(h.app, 'approver@waffarha.com');
    const body = {
      name: 'A/B',
      country: 'EG',
      currency: 'EGP',
      startAt: new Date(Date.now() - 60_000).toISOString(),
      endAt: new Date(Date.now() + 86_400_000).toISOString(),
      discount: { type: 'PERCENT', percentBps: 1_000 },
      targeting: { binRanges: [{ from: DEMO.bin, to: DEMO.bin }] },
      limits: { perCardMaxCount: 10 },
      fundings: [{ partnerId: h.net.bank.id, shareBps: 10_000 }],
      holdoutBps: 1_000,
      variants: [
        {
          key: 'A',
          name: '20% off',
          weightBps: 5_000,
          discount: { type: 'PERCENT', percentBps: 2_000 },
        },
        {
          key: 'B',
          name: '50 EGP off over 300',
          weightBps: 5_000,
          discount: { type: 'FIXED', amountMinor: 5_000, minSpendMinor: 30_000 },
        },
      ],
    };
    const bad = await manager
      .post('/admin/v1/campaigns')
      .send({ ...body, variants: [{ ...body.variants[0], weightBps: 6_000 }, body.variants[1]] });
    expect(bad.body.error.message).toContain('variant weights must sum to 10000');
    expect(
      (await manager.post('/admin/v1/campaigns').send({ ...body, holdoutBps: 3_000 })).status,
    ).toBe(400);

    const created = (await manager.post('/admin/v1/campaigns').send(body)).body;
    // The campaign's own discount follows the control variant.
    expect(created.discountConfig).toEqual({ type: 'PERCENT', percentBps: 2_000 });
    expect(created.variants.map((v: { key: string }) => v.key)).toEqual(['A', 'B']);
    await manager.post(`/admin/v1/campaigns/${created.id}/submit`).send({});
    await approver.post(`/admin/v1/campaigns/${created.id}/approve`).send({});
    await eventually(async () => h.cache.get(created.id) !== undefined);
    return { id: created.id as string, manager };
  }

  it('applies each variant’s discount type, level and min spend to its cards', async () => {
    const { id, manager } = await abCampaign();
    const a = await cardIn(id, 'A');
    const b = await cardIn(id, 'B');

    expect((await inquire(h.app, { card_token: a, amount: 50_000 })).body.discount_amount).toBe(
      10_000,
    ); // 20%
    expect((await inquire(h.app, { card_token: b, amount: 50_000 })).body.discount_amount).toBe(
      5_000,
    ); // fixed 50
    expect((await inquire(h.app, { card_token: b, amount: 20_000 })).body.reason).toBe(
      'NO_ELIGIBLE_CAMPAIGN',
    ); // below B's min spend
    expect((await inquire(h.app, { card_token: a, amount: 20_000 })).body.discount_amount).toBe(
      4_000,
    ); // A has none

    const variants = await h.prisma.redemption.findMany({
      select: { variantKey: true, discountMinor: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(variants.map((v) => v.variantKey)).toEqual(['A', 'B', 'A']);

    // The simulator shows the card's group.
    const sim = (
      await manager.post('/admin/v1/simulate').send({
        terminalId: h.net.terminal.id,
        bin: DEMO.bin,
        scheme: 'VISA',
        amountMinor: 50_000,
        cardToken: b,
      })
    ).body;
    expect(sim.results.find((r: { campaignId: string }) => r.campaignId === id)).toMatchObject({
      group: 'B',
      discountMinor: 5_000,
    });
  });
});

describe('performance report', () => {
  /** Inserts exposures (and redemptions for treated payments) with known spend. */
  async function seed(
    campaignId: string,
    group: string,
    cards: number,
    spendPerPayment: (card: number) => number[],
    discountPerPayment: number,
    opts: { merchantPartnerId?: string; prefix?: string; status?: 'CONFIRMED' | 'RELEASED' } = {},
  ) {
    const merchantPartnerId = opts.merchantPartnerId ?? h.net.merchantPartner.id;
    const card = (i: number) => `${opts.prefix ?? group}-card-${i}`;
    for (let i = 0; i < cards; i++) {
      for (const [j, amount] of spendPerPayment(i).entries()) {
        let redemptionId: string | undefined;
        if (group !== HOLDOUT) {
          const r = await h.prisma.redemption.create({
            data: {
              acquirerId: h.net.acquirer.id,
              idempotencyKey: `${group}-${i}-${j}-${Math.random()}`,
              acquirerTxnRef: `t-${i}-${j}`,
              campaignId,
              campaignVersion: 1,
              terminalId: h.net.terminal.id,
              cardTokenHash: card(i),
              bin: DEMO.bin,
              scheme: 'VISA',
              currency: 'EGP',
              originalAmountMinor: amount,
              discountMinor: discountPerPayment,
              finalAmountMinor: amount - discountPerPayment,
              fundingSnapshot: [],
              counterKeys: { day: 'x', cardPeriod: 'all' },
              status: opts.status ?? 'CONFIRMED',
              variantKey: group,
              expiresAt: new Date(),
            },
          });
          redemptionId = r.id;
        }
        await h.prisma.campaignExposure.create({
          data: {
            campaignId,
            group,
            cardTokenHash: card(i),
            amountMinor: amount,
            currency: 'EGP',
            merchantPartnerId,
            redemptionId,
          },
        });
      }
    }
  }

  it('computes uplift vs holdout, its confidence interval and ROI', async () => {
    const c = await createDemoCampaign(h.prisma, h.net, {
      holdoutBps: 2_000,
      startAt: new Date(Date.now() - 86_400_000),
    });
    // Holdout: one payment per card, 90 or 110 EGP (mean 100).
    await seed(c.id, HOLDOUT, 120, (i) => [i % 2 ? 9_000 : 11_000], 0);
    // Treated: two payments per card totalling 110 or 130 EGP (mean 120), 10 EGP discount each.
    await seed(c.id, 'A', 120, (i) => (i % 2 ? [5_000, 6_000] : [6_000, 7_000]), 1_000);
    // Another merchant's traffic, and a declined payment (cancelled redemption), must not count.
    await seed(c.id, HOLDOUT, 5, () => [99_999], 0, {
      merchantPartnerId: h.net.bank.id,
      prefix: 'elsewhere',
    });
    await seed(c.id, 'A', 1, () => [99_999], 1_000, { prefix: 'declined', status: 'RELEASED' });

    const fin = await loginAs(h.app, 'manager@waffarha.com');
    const report = (await fin.get(`/admin/v1/campaigns/${c.id}/performance`)).body;
    const all = Object.fromEntries(report.groups.map((g: { group: string }) => [g.group, g]));
    expect(all.HOLDOUT).toMatchObject({ cards: 125, payments: 125 });

    // Scope to the merchant's own terminals to drop the other partner's rows.
    const scoped = await h.app
      .get((await import('../src/reports/performance.service')).PerformanceService)
      .report(c.id, { merchantPartnerId: h.net.merchantPartner.id });
    const g = Object.fromEntries(scoped.groups.map((x) => [x.group, x]));
    expect(g.HOLDOUT).toMatchObject({
      cards: 120,
      payments: 120,
      spendPerCardMinor: 10_000,
      discountMinor: 0,
    });
    expect(g.A).toMatchObject({
      cards: 120,
      payments: 240,
      spendPerCardMinor: 12_000,
      avgBasketMinor: 6_000,
      paymentsPerCard: 2,
      repeatRatePct: 100,
      discountMinor: 240_000,
      costPerPaymentMinor: 1_000,
    });

    const up = scoped.uplift.find((u) => u.group === 'A')!.vsHoldout!;
    expect(up.diff).toBe(2_000); // +20 EGP per card
    expect(up.relative).toBeCloseTo(0.2, 10);
    expect(up.significant).toBe(true);
    expect(up.ci95[0]).toBeGreaterThan(0);
    expect(up.incrementalSpendMinor).toBe(240_000); // 20 EGP × 120 cards
    expect(up.roi).toBe(1); // 2,400 EGP extra spend for 2,400 EGP of discount
    expect(scoped.enoughData).toBe(true);

    const csv = (await fin.get(`/admin/v1/campaigns/${c.id}/performance.csv`)).text;
    expect(csv.split('\n')[0]).toContain('uplift_per_card');
  });

  it('is available to funders in the portal', async () => {
    const c = await createDemoCampaign(h.prisma, h.net, { holdoutBps: 1_000 });
    await seed(c.id, HOLDOUT, 3, () => [10_000], 0);
    const bank = await loginAs(h.app, 'ops@demobank.example');
    const r = (await bank.get(`/admin/v1/portal/campaigns/${c.id}/performance`)).body;
    expect(r.groups.find((g: { group: string }) => g.group === HOLDOUT).cards).toBe(3);
    expect(r.enoughData).toBe(false);
  });
});
