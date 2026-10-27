import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserRole } from '@instant-discount/db';
import { AcquirersService } from '../src/acquirers/acquirers.service';
import { MailerService } from '../src/mail/mailer.service';
import { DEMO } from '../scripts/demo-data';
import {
  eventually,
  inquire,
  inquiryBody,
  loginAs,
  resetData,
  signedPost,
  startApp,
  type Harness,
} from './harness';

let h: Harness;
let mailer: MailerService;

const MANAGER = 'manager@waffarha.com';
const MANAGER2 = 'manager2@waffarha.com';
const APPROVER = 'approver@waffarha.com';
const VIEWER = 'viewer@waffarha.com';
const ADMIN = 'admin@waffarha.com';

async function user(email: string, role: UserRole, partnerId?: string) {
  return h.prisma.user.create({ data: { email, name: email.split('@')[0]!, role, partnerId } });
}

/** A valid campaign body funded 50/30/20 by bank, merchant and Waffarha. */
function campaignBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Bank 20% at Demo Cafe',
    country: 'EG',
    currency: 'EGP',
    startAt: new Date(Date.now() - 60_000).toISOString(),
    endAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    priority: 5,
    discount: { type: 'PERCENT', percentBps: 2_000, maxDiscountMinor: 15_000 },
    targeting: { binRanges: [{ from: DEMO.bin, to: DEMO.bin }], merchantIds: [h.net.merchant.id] },
    limits: { totalBudgetMinor: 1_000_000, perCardMaxCount: 3 },
    fundings: [
      { partnerId: h.net.bank.id, shareBps: 5_000 },
      { partnerId: h.net.merchantPartner.id, shareBps: 3_000 },
      { partnerId: h.net.waffarha.id, shareBps: 2_000 },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  const base = await startApp();
  h = { ...base, net: undefined as never };
  mailer = h.app.get(MailerService);
});
afterAll(async () => h.app.close());
beforeEach(async () => {
  h.net = await resetData(h);
  await h.cache.refresh();
  await Promise.all([
    user(ADMIN, 'ADMIN'),
    user(MANAGER, 'CAMPAIGN_MANAGER'),
    user(MANAGER2, 'CAMPAIGN_MANAGER'),
    user(APPROVER, 'APPROVER'),
    user(VIEWER, 'VIEWER'),
  ]);
});

describe('auth and roles', () => {
  it('requires a session and enforces roles', async () => {
    const anon = request(h.app.getHttpServer());
    expect((await anon.get('/admin/v1/campaigns')).status).toBe(401);
    expect(
      (await anon.post('/admin/v1/auth/dev-login').send({ email: 'nobody@waffarha.com' })).status,
    ).toBe(401);

    const viewer = await loginAs(h.app, VIEWER);
    expect((await viewer.get('/admin/v1/auth/me')).body).toMatchObject({
      email: VIEWER,
      role: 'VIEWER',
    });
    expect((await viewer.get('/admin/v1/campaigns')).status).toBe(200);
    expect((await viewer.post('/admin/v1/campaigns').send(campaignBody())).status).toBe(403);
    expect((await viewer.get('/admin/v1/users')).status).toBe(403);

    await viewer.post('/admin/v1/auth/logout').send({});
    expect((await viewer.get('/admin/v1/auth/me')).status).toBe(401);
  });

  it('rejects non-JSON mutations (CSRF protection)', async () => {
    const manager = await loginAs(h.app, MANAGER);
    const res = await manager
      .post('/admin/v1/partners')
      .type('form')
      .send('name=x&type=BANK&country=EG');
    expect(res.status).toBe(415);
  });

  it('reports Google SSO as not configured without a client id', async () => {
    const res = await request(h.app.getHttpServer())
      .post('/admin/v1/auth/google')
      .send({ idToken: 'x'.repeat(20) });
    expect(res.status).toBe(503);
  });

  it('signs partner users in with a single-use magic link, and keeps them out of admin', async () => {
    await user('ops@demobank.com', 'PARTNER_USER', h.net.bank.id);
    const server = h.app.getHttpServer();
    mailer.outbox.length = 0;

    await request(server).post('/admin/v1/auth/magic-link').send({ email: VIEWER }).expect(202);
    expect(mailer.outbox).toHaveLength(0); // staff never get magic links

    await request(server)
      .post('/admin/v1/auth/magic-link')
      .send({ email: 'ops@demobank.com' })
      .expect(202);
    const token = /token=([\w-]+)/.exec(mailer.outbox.at(-1)!.text)![1]!;

    const agent = request.agent(server);
    expect((await agent.post('/admin/v1/auth/magic-link/verify').send({ token })).body.role).toBe(
      'PARTNER_USER',
    );
    expect(
      (await request(server).post('/admin/v1/auth/magic-link/verify').send({ token })).status,
    ).toBe(401);
    expect((await agent.get('/admin/v1/auth/me')).status).toBe(200);
    expect((await agent.get('/admin/v1/campaigns')).status).toBe(403);
  });
});

describe('users', () => {
  it('invites staff with a Workspace email and partner users with a partner', async () => {
    const admin = await loginAs(h.app, ADMIN);
    expect(
      (
        await admin
          .post('/admin/v1/users')
          .send({ email: 'x@gmail.com', name: 'X', role: 'VIEWER' })
      ).status,
    ).toBe(422);
    expect(
      (
        await admin
          .post('/admin/v1/users')
          .send({ email: 'p@bank.com', name: 'P', role: 'PARTNER_USER' })
      ).status,
    ).toBe(422);
    const ok = await admin
      .post('/admin/v1/users')
      .send({ email: 'P@Bank.com', name: 'P', role: 'PARTNER_USER', partnerId: h.net.bank.id });
    expect(ok.status).toBe(201);
    expect(ok.body.email).toBe('p@bank.com');
    expect(mailer.outbox.at(-1)!.to).toBe('p@bank.com');
  });

  it('signs a user out everywhere when deactivated', async () => {
    const viewer = await loginAs(h.app, VIEWER);
    const admin = await loginAs(h.app, ADMIN);
    const id = (await viewer.get('/admin/v1/auth/me')).body.id;
    await admin.patch(`/admin/v1/users/${id}`).send({ active: false }).expect(200);
    expect((await viewer.get('/admin/v1/auth/me')).status).toBe(401);
  });
});

describe('merchant network', () => {
  it('creates partners, merchants, branches and terminals with validation', async () => {
    const m = await loginAs(h.app, MANAGER);
    const bank = (
      await m.post('/admin/v1/partners').send({ name: 'CIB', type: 'BANK', country: 'EG' })
    ).body;
    expect(
      (
        await m
          .post('/admin/v1/merchants')
          .send({ partnerId: bank.id, name: 'X', country: 'EG', mcc: '5812' })
      ).status,
    ).toBe(422);

    const mp = (
      await m.post('/admin/v1/partners').send({ name: 'Cafe Co', type: 'MERCHANT', country: 'EG' })
    ).body;
    const merchant = (
      await m
        .post('/admin/v1/merchants')
        .send({ partnerId: mp.id, name: 'Cafe', country: 'EG', mcc: '5812' })
    ).body;
    const branch = (
      await m.post(`/admin/v1/merchants/${merchant.id}/branches`).send({ name: 'Maadi' })
    ).body;
    const t = await m.post('/admin/v1/terminals').send({
      acquirerId: h.net.acquirer.id,
      externalTerminalId: 'T-NEW',
      merchantId: merchant.id,
      branchId: branch.id,
    });
    expect(t.status).toBe(201);
    const dup = await m.post('/admin/v1/terminals').send({
      acquirerId: h.net.acquirer.id,
      externalTerminalId: 'T-NEW',
      merchantId: merchant.id,
    });
    expect(dup.body.error.code).toBe('DUPLICATE_TERMINAL');
  });

  it('imports terminals from CSV with a dry run first', async () => {
    const m = await loginAs(h.app, MANAGER);
    const bad = `acquirer_api_key,tid,merchant_id,mcc\n${DEMO.apiKeyId},A1,${h.net.merchant.id},5812\nacq_nope,A2,${h.net.merchant.id},\n${DEMO.apiKeyId},A3,${h.net.merchant.id},58\n`;
    const dry = (await m.post('/admin/v1/terminals/import').send({ csv: bad, dryRun: false })).body;
    expect(dry).toMatchObject({ dryRun: true, valid: 1, imported: 0 });
    expect(dry.errors.map((e: { line: number }) => e.line)).toEqual([3, 4]);

    const good = `acquirer_api_key,tid,merchant_id,branch_id\n${DEMO.apiKeyId},A1,${h.net.merchant.id},${h.net.branch.id}\n${DEMO.apiKeyId},A2,${h.net.merchant.id},\n`;
    expect((await m.post('/admin/v1/terminals/import').send({ csv: good })).body).toMatchObject({
      dryRun: true,
      valid: 2,
    });
    expect(
      (await m.post('/admin/v1/terminals/import').send({ csv: good, dryRun: false })).body,
    ).toMatchObject({ imported: 2 });
    expect(await h.prisma.terminal.count()).toBe(3);
  });
});

describe('acquirers', () => {
  it('shows the secret once, and the new acquirer can call the API with it', async () => {
    const admin = await loginAs(h.app, ADMIN);
    const created = (
      await admin.post('/admin/v1/acquirers').send({ name: 'Geidea', country: 'EG' })
    ).body;
    expect(created.hmacSecret).toHaveLength(64);
    const listed = (await admin.get('/admin/v1/acquirers')).body;
    expect(JSON.stringify(listed)).not.toContain(created.hmacSecret);
    expect(JSON.stringify(listed)).not.toContain('hmacSecretEnc');

    const opts = {
      apiKey: created.acquirer.apiKeyId,
      secret: created.hmacSecret,
      idempotencyKey: 'k1',
    };
    expect((await signedPost(h.app, '/v1/discounts/inquire', inquiryBody(), opts)).status).toBe(
      200,
    );

    const rotated = (
      await admin.post(`/admin/v1/acquirers/${created.acquirer.id}/rotate-secret`).send({})
    ).body;
    h.app.get(AcquirersService).clear();
    expect(
      (
        await signedPost(h.app, '/v1/discounts/inquire', inquiryBody(), {
          ...opts,
          idempotencyKey: 'k2',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await signedPost(h.app, '/v1/discounts/inquire', inquiryBody(), {
          ...opts,
          secret: rotated.hmacSecret,
          idempotencyKey: 'k3',
        })
      ).status,
    ).toBe(200);
  });
});

describe('campaign workflow', () => {
  it('validates funding and merchant self-funding rules', async () => {
    const m = await loginAs(h.app, MANAGER);
    const bad = await m
      .post('/admin/v1/campaigns')
      .send(campaignBody({ fundings: [{ partnerId: h.net.bank.id, shareBps: 9_000 }] }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toContain('sum to 10000');

    const noTarget = await m
      .post('/admin/v1/campaigns')
      .send(campaignBody({ targeting: { binRanges: [{ from: DEMO.bin, to: DEMO.bin }] } }));
    expect(noTarget.body.error.message).toContain('merchant-funded campaign must target');

    const wrongCurrency = await m
      .post('/admin/v1/campaigns')
      .send(campaignBody({ currency: 'SAR' }));
    expect(wrongCurrency.body.error.message).toContain('currency must be EGP');
  });

  it('goes draft → submit → approve by someone else → live in the acquirer API', async () => {
    const m = await loginAs(h.app, MANAGER);
    const a = await loginAs(h.app, APPROVER);
    const c = (await m.post('/admin/v1/campaigns').send(campaignBody())).body;
    expect(c.status).toBe('DRAFT');
    expect((await inquire(h.app)).body.reason).toBe('NO_ELIGIBLE_CAMPAIGN');

    expect((await m.post(`/admin/v1/campaigns/${c.id}/approve`).send({})).status).toBe(403); // role
    await m.post(`/admin/v1/campaigns/${c.id}/submit`).send({}).expect(200);
    expect((await a.get('/admin/v1/campaigns?awaitingApproval=true')).body.total).toBe(1);

    const approved = (await a.post(`/admin/v1/campaigns/${c.id}/approve`).send({})).body;
    expect(approved).toMatchObject({ status: 'ACTIVE', version: 1 });
    await eventually(async () => (await inquire(h.app)).body.eligible === true);

    const audit = await h.prisma.auditLog.findMany({
      where: { entityId: c.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((x) => x.action)).toEqual([
      'campaign.create',
      'campaign.submit',
      'campaign.approve',
    ]);
  });

  it('blocks self-approval even for admins', async () => {
    const admin = await loginAs(h.app, ADMIN);
    const c = (await admin.post('/admin/v1/campaigns').send(campaignBody())).body;
    await admin.post(`/admin/v1/campaigns/${c.id}/submit`).send({});
    const res = await admin.post(`/admin/v1/campaigns/${c.id}/approve`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_APPROVAL');
  });

  it('keeps a live campaign running unchanged until its edit is approved', async () => {
    const m = await loginAs(h.app, MANAGER);
    const a = await loginAs(h.app, APPROVER);
    const c = (await m.post('/admin/v1/campaigns').send(campaignBody())).body;
    await m.post(`/admin/v1/campaigns/${c.id}/submit`).send({});
    await a.post(`/admin/v1/campaigns/${c.id}/approve`).send({});
    await eventually(
      async () => (await inquire(h.app, { amount: 50_000 })).body.discount_amount === 10_000,
    );

    const edit = campaignBody({
      discount: { type: 'FIXED', amountMinor: 3_000 },
      startAt: c.startAt,
      endAt: c.endAt,
    });
    const moved = await m
      .put(`/admin/v1/campaigns/${c.id}`)
      .send({ ...edit, startAt: new Date().toISOString() });
    expect(moved.body.error.message).toContain('start date cannot change');
    expect(
      (await m.put(`/admin/v1/campaigns/${c.id}`).send({ ...edit, country: 'SA', currency: 'SAR' }))
        .status,
    ).toBe(422);
    const proposed = (await m.put(`/admin/v1/campaigns/${c.id}`).send(edit)).body;
    expect(proposed.pendingChanges.discount.type).toBe('FIXED');
    expect((await inquire(h.app, { amount: 50_000 })).body.discount_amount).toBe(10_000);

    await a.post(`/admin/v1/campaigns/${c.id}/reject`).send({ reason: 'too low' }).expect(200);
    await m.put(`/admin/v1/campaigns/${c.id}`).send(edit);
    const approved = (await a.post(`/admin/v1/campaigns/${c.id}/approve`).send({})).body;
    expect(approved).toMatchObject({ version: 2, pendingChanges: null, discountType: 'FIXED' });
    await eventually(
      async () => (await inquire(h.app, { amount: 50_000 })).body.discount_amount === 3_000,
    );

    const detail = (await m.get(`/admin/v1/campaigns/${c.id}`)).body;
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('pauses and resumes', async () => {
    const m = await loginAs(h.app, MANAGER);
    const a = await loginAs(h.app, APPROVER);
    const c = (await m.post('/admin/v1/campaigns').send(campaignBody())).body;
    await m.post(`/admin/v1/campaigns/${c.id}/submit`).send({});
    await a.post(`/admin/v1/campaigns/${c.id}/approve`).send({});
    await eventually(async () => (await inquire(h.app)).body.eligible === true);

    await a.post(`/admin/v1/campaigns/${c.id}/pause`).send({}).expect(200);
    await eventually(async () => (await inquire(h.app)).body.eligible === false);
    await m.post(`/admin/v1/campaigns/${c.id}/resume`).send({}).expect(200);
    await eventually(async () => (await inquire(h.app)).body.eligible === true);
  });

  it('starts approved future campaigns as SCHEDULED', async () => {
    const m = await loginAs(h.app, MANAGER);
    const a = await loginAs(h.app, APPROVER);
    const c = (
      await m
        .post('/admin/v1/campaigns')
        .send(campaignBody({ startAt: new Date(Date.now() + 86_400_000).toISOString() }))
    ).body;
    await m.post(`/admin/v1/campaigns/${c.id}/submit`).send({});
    expect((await a.post(`/admin/v1/campaigns/${c.id}/approve`).send({})).body.status).toBe(
      'SCHEDULED',
    );
  });
});

describe('simulator, stats and explorer', () => {
  async function liveCampaign(overrides: Record<string, unknown> = {}) {
    const m = await loginAs(h.app, MANAGER);
    const a = await loginAs(h.app, APPROVER);
    const c = (await m.post('/admin/v1/campaigns').send(campaignBody(overrides))).body;
    await m.post(`/admin/v1/campaigns/${c.id}/submit`).send({});
    await a.post(`/admin/v1/campaigns/${c.id}/approve`).send({});
    await eventually(async () => h.cache.get(c.id) !== undefined);
    return { c, m };
  }

  it('simulates without reserving, matching the real decision', async () => {
    const { c, m } = await liveCampaign();
    const draft = (
      await m.post('/admin/v1/campaigns').send(campaignBody({ name: 'draft', priority: 50 }))
    ).body;
    const sim = (
      await m
        .post('/admin/v1/simulate')
        .send({ terminalId: h.net.terminal.id, bin: DEMO.bin, scheme: 'VISA', amountMinor: 50_000 })
    ).body;
    expect(sim.winnerCampaignId).toBe(c.id);
    expect(
      sim.results.find((r: { campaignId: string }) => r.campaignId === draft.id),
    ).toMatchObject({ status: 'DRAFT', eligible: true });
    expect(sim.results.find((r: { campaignId: string }) => r.campaignId === c.id)).toMatchObject({
      discountMinor: 10_000,
      headroom: { budgetMinor: 1_000_000 },
    });
    expect(await h.prisma.redemption.count()).toBe(0);
    expect((await inquire(h.app)).body.campaign_id).toBe(c.id);
  });

  it('reports stats and lists redemptions', async () => {
    const { c, m } = await liveCampaign();
    const r = (await inquire(h.app, { amount: 50_000 })).body;
    await signedPost(h.app, `/v1/discounts/${r.redemption_id}/confirm`, { charged_amount: 40_000 });
    await inquire(h.app, { bin: '999999' });

    const stats = (await m.get(`/admin/v1/campaigns/${c.id}/stats`)).body;
    expect(stats.budget).toMatchObject({
      totalMinor: 1_000_000,
      usedMinor: 10_000,
      remainingMinor: 990_000,
      usedPct: 1,
    });
    expect(stats.redemptionsByStatus).toEqual({ CONFIRMED: 1 });
    expect(stats.daily).toHaveLength(1);
    expect(stats.topTerminals[0]).toMatchObject({
      externalTerminalId: DEMO.terminalId,
      redemptions: 1,
    });

    const list = (await m.get(`/admin/v1/redemptions?campaignId=${c.id}`)).body;
    expect(list.total).toBe(1);
    const detail = (await m.get(`/admin/v1/redemptions/${r.redemption_id}`)).body;
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(['RESERVED', 'CONFIRMED']);

    await eventually(async () => (await m.get('/admin/v1/inquiries/summary')).body.total === 2);
    const summary = (await m.get('/admin/v1/inquiries/summary')).body;
    expect(summary).toMatchObject({
      granted: 1,
      reasons: [{ reason: 'NO_ELIGIBLE_CAMPAIGN', count: 1 }],
    });
  });
});
