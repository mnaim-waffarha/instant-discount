import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailerService } from '../src/mail/mailer.service';
import { SettlementService } from '../src/settlement/settlement.service';
import { createDemoCampaign } from '../scripts/demo-data';
import { inquire, loginAs, resetData, signedPost, startApp, type Harness } from './harness';

let h: Harness;
let settlement: SettlementService;
let mailer: MailerService;

/** Current month in Cairo, "YYYY-MM". */
const period = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());

async function pay(amount: number, card: string) {
  const r = (await inquire(h.app, { amount, card_token: card })).body;
  expect(r.eligible).toBe(true);
  await signedPost(h.app, `/v1/discounts/${r.redemption_id}/confirm`, {
    charged_amount: r.final_amount,
  }).expect(200);
  return r as { redemption_id: string; final_amount: number };
}

/**
 * Demo campaign: 20% capped at 150 EGP, funded bank 50% / merchant 30% / Waffarha 20%.
 *   r1: 500 EGP bill → 100 EGP discount, confirmed
 *   r2: same, then 100 EGP of the 400 paid refunded → 25 EGP of discount reversed
 *   r3: reserved, never confirmed → not in settlement
 *   r4: confirmed then cancelled → nets to zero
 */
async function scenario() {
  await createDemoCampaign(h.prisma, h.net, { perCardMaxCount: 10 });
  await h.cache.refresh();
  const r1 = await pay(50_000, 'tok_a_card');
  const r2 = await pay(50_000, 'tok_b_card');
  await signedPost(h.app, `/v1/discounts/${r2.redemption_id}/refund`, {
    refund_id: 'rf-1',
    amount: 10_000,
  }).expect(200);
  expect((await inquire(h.app, { amount: 50_000, card_token: 'tok_c_card' })).body.eligible).toBe(
    true,
  );
  const r4 = await pay(50_000, 'tok_d_card');
  await signedPost(h.app, `/v1/discounts/${r4.redemption_id}/cancel`, {}).expect(200);
  return { r1, r2, r4 };
}

beforeAll(async () => {
  const base = await startApp();
  h = { ...base, net: undefined as never };
  settlement = h.app.get(SettlementService);
  mailer = h.app.get(MailerService);
});
afterAll(async () => h.app.close());
beforeEach(async () => {
  h.net = await resetData(h);
  await h.prisma.partner.update({
    where: { id: h.net.bank.id },
    data: { billingEmail: 'billing@demobank.example' },
  });
  await h.prisma.user.createMany({
    data: [
      { email: 'finance@waffarha.com', name: 'Finance', role: 'FINANCE' },
      { email: 'manager@waffarha.com', name: 'Manager', role: 'CAMPAIGN_MANAGER' },
      {
        email: 'ops@demobank.example',
        name: 'Bank Ops',
        role: 'PARTNER_USER',
        partnerId: h.net.bank.id,
      },
      {
        email: 'ops@cafe.example',
        name: 'Cafe Ops',
        role: 'PARTNER_USER',
        partnerId: h.net.merchantPartner.id,
      },
    ],
  });
  await h.cache.refresh();
});

describe('settlement', () => {
  it('builds an exact ledger and the right documents', async () => {
    await scenario();
    const fin = await loginAs(h.app, 'finance@waffarha.com');
    expect(
      (await fin.post('/admin/v1/settlements/run').send({ country: 'EG', period: period() })).body
        .created,
    ).toBe(2);

    const docs = (await fin.get(`/admin/v1/documents?country=EG&period=${period()}`)).body.items;
    const invoice = docs.find((d: { type: string }) => d.type === 'INVOICE');
    const payout = docs.find((d: { type: string }) => d.type === 'PAYOUT_STATEMENT');
    // Bank: 50 (r1) + 50 − 12.50 (r2) + 50 − 50 (r4) = 87.50 EGP, VAT 14% = 12.25.
    expect(invoice).toMatchObject({
      partnerId: h.net.bank.id,
      status: 'DRAFT',
      subtotalMinor: 8_750,
      vatBps: 1_400,
      vatMinor: 1_225,
      totalMinor: 9_975,
    });
    // Merchant is paid the bank + Waffarha shares: 70 + 70 − 17.50 + 0 = 122.50 EGP, no VAT.
    expect(payout).toMatchObject({
      partnerId: h.net.merchantPartner.id,
      subtotalMinor: 12_250,
      vatMinor: 0,
      totalMinor: 12_250,
    });

    const detail = (await fin.get(`/admin/v1/documents/${payout.id}`)).body;
    const lines = detail.lines.map(
      (l: {
        kind: string;
        counterpartyName: string | null;
        redemptionCount: number;
        netMinor: number;
      }) => [l.kind, l.counterpartyName, l.redemptionCount, l.netMinor],
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        ['OWED_BY_FUNDER', 'Demo Bank', 2, 8_750],
        ['OWED_BY_FUNDER', 'Waffarha', 2, 3_500],
        ['OWN_CONTRIBUTION', null, 2, 5_250],
      ]),
    );

    // Re-running replaces drafts instead of duplicating them.
    await fin
      .post('/admin/v1/settlements/run')
      .send({ country: 'EG', period: period() })
      .expect(200);
    expect((await fin.get(`/admin/v1/documents?country=EG&period=${period()}`)).body.total).toBe(2);
  });

  it('issues gap-free numbers, emails the invoice, and rolls late refunds into a new document', async () => {
    const { r1 } = await scenario();
    const fin = await loginAs(h.app, 'finance@waffarha.com');
    await fin.post('/admin/v1/settlements/run').send({ country: 'EG', period: period() });
    const docs = (await fin.get('/admin/v1/documents?type=INVOICE')).body.items;
    mailer.outbox.length = 0;

    const issued = (await fin.post(`/admin/v1/documents/${docs[0].id}/issue`).send({})).body;
    expect(issued.number).toBe(`INV-EG-${new Date().getUTCFullYear()}-000001`);
    expect(issued.dueAt).toBeTruthy();
    expect(mailer.outbox.at(-1)).toMatchObject({ to: 'billing@demobank.example' });
    expect(mailer.outbox.at(-1)!.attachments![0]!.filename).toBe(`${issued.number}.pdf`);
    expect((await fin.post(`/admin/v1/documents/${docs[0].id}/issue`).send({})).status).toBe(409);

    const pdf = await fin
      .get(`/admin/v1/documents/${issued.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const csv = (await fin.get(`/admin/v1/documents/${issued.id}/csv`)).text;
    expect(csv).toContain('TOTAL');
    expect(csv).toContain('99.75'); // 87.50 + 14% VAT

    // A refund after the invoice was issued is not lost: it lands in the next run as a credit.
    await signedPost(h.app, `/v1/discounts/${r1.redemption_id}/refund`, {
      refund_id: 'late',
      amount: 40_000,
    }).expect(200);
    await fin.post('/admin/v1/settlements/run').send({ country: 'EG', period: period() });
    const invoices = (await fin.get('/admin/v1/documents?type=INVOICE')).body.items;
    const credit = invoices.find((d: { status: string }) => d.status === 'DRAFT');
    expect(credit).toMatchObject({ subtotalMinor: -5_000, vatMinor: -700 });

    await fin
      .post(`/admin/v1/documents/${issued.id}/paid`)
      .send({ reference: 'TRX-1' })
      .expect(200);
    expect(
      (await fin.post(`/admin/v1/documents/${issued.id}/void`).send({ reason: 'x' })).status,
    ).toBe(409);
    expect(
      (
        await (
          await loginAs(h.app, 'manager@waffarha.com')
        )
          .post(`/admin/v1/documents/${credit.id}/issue`)
          .send({})
      ).status,
    ).toBe(403);
  });

  it('voiding releases entries so the next run picks them up again', async () => {
    await scenario();
    const fin = await loginAs(h.app, 'finance@waffarha.com');
    await fin.post('/admin/v1/settlements/run').send({ country: 'EG', period: period() });
    const inv = (await fin.get('/admin/v1/documents?type=INVOICE')).body.items[0];
    await fin.post(`/admin/v1/documents/${inv.id}/issue`).send({});
    await fin
      .post(`/admin/v1/documents/${inv.id}/void`)
      .send({ reason: 'wrong billing entity' })
      .expect(200);
    await fin.post('/admin/v1/settlements/run').send({ country: 'EG', period: period() });
    const drafts = (await fin.get('/admin/v1/documents?type=INVOICE&status=DRAFT')).body.items;
    expect(drafts[0].subtotalMinor).toBe(8_750);
  });

  it('DIRECT campaigns produce statements, not invoices', async () => {
    await h.prisma.campaign.create({
      data: {
        name: 'Direct',
        status: 'ACTIVE',
        country: 'EG',
        currency: 'EGP',
        timezone: 'Africa/Cairo',
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
        discountType: 'FIXED',
        discountConfig: { type: 'FIXED', amountMinor: 1_000 },
        targeting: {},
        settlementMode: 'DIRECT',
        fundings: { create: [{ partnerId: h.net.bank.id, shareBps: 10_000 }] },
      },
    });
    await h.cache.refresh();
    await pay(5_000, 'tok_direct');
    await settlement.generate('EG', period());
    const docs = await h.prisma.invoice.findMany();
    expect(docs.map((d) => [d.type, Number(d.totalMinor)]).sort()).toEqual([
      ['STATEMENT', 1_000],
      ['STATEMENT', 1_000],
    ]);
  });
});

describe('tax rates', () => {
  it('refuses to draft invoices without a VAT rate', async () => {
    await scenario();
    await h.prisma.taxRate.deleteMany({ where: { country: 'EG' } });
    try {
      await expect(settlement.generate('EG', period())).rejects.toMatchObject({
        response: { error: { code: 'NO_TAX_RATE' } },
      });
    } finally {
      await h.prisma.taxRate.create({
        data: { country: 'EG', rateBps: 1_400, validFrom: new Date('2020-01-01') },
      });
    }
  });
});

describe('partner portal', () => {
  it('shows a bank only its campaigns, its share and its issued documents', async () => {
    await scenario();
    const fin = await loginAs(h.app, 'finance@waffarha.com');
    await fin.post('/admin/v1/settlements/run').send({ country: 'EG', period: period() });
    const [invoice] = (await fin.get('/admin/v1/documents?type=INVOICE')).body.items;
    const [payout] = (await fin.get('/admin/v1/documents?type=PAYOUT_STATEMENT')).body.items;

    const bank = await loginAs(h.app, 'ops@demobank.example');
    const campaigns = (await bank.get('/admin/v1/portal/campaigns')).body;
    expect(campaigns).toHaveLength(1);
    // Bank share net of refunds: 50 + (50 − 12.50) = 87.50 EGP over 2 live redemptions.
    expect(campaigns[0]).toMatchObject({
      shareBps: 5_000,
      redemptions: 2,
      partnerShareMinor: 8_750,
    });

    const rows = (await bank.get(`/admin/v1/portal/campaigns/${campaigns[0].id}/redemptions`)).body;
    expect(rows.total).toBe(2); // confirmed and partly refunded; the cancelled payment is not shown
    expect(JSON.stringify(rows)).not.toContain('cardTokenHash');
    expect(
      (await bank.get(`/admin/v1/portal/campaigns/${campaigns[0].id}/redemptions.csv`)).text.split(
        '\n',
      )[0],
    ).toContain('your_share');

    // Drafts are invisible; issued documents can be downloaded, but not someone else's.
    expect((await bank.get('/admin/v1/portal/documents')).body.total).toBe(0);
    expect((await bank.get(`/admin/v1/portal/documents/${invoice.id}/pdf`)).status).toBe(404);
    await fin.post(`/admin/v1/documents/${invoice.id}/issue`).send({});
    await fin.post(`/admin/v1/documents/${payout.id}/issue`).send({});
    expect((await bank.get('/admin/v1/portal/documents')).body.total).toBe(1);
    expect((await bank.get(`/admin/v1/portal/documents/${invoice.id}/pdf`)).status).toBe(200);
    expect((await bank.get(`/admin/v1/portal/documents/${payout.id}/pdf`)).status).toBe(404);

    const cafe = await loginAs(h.app, 'ops@cafe.example');
    expect((await cafe.get('/admin/v1/portal/documents')).body.items[0].id).toBe(payout.id);
  });

  it('is closed to staff and to signed-out visitors', async () => {
    const fin = await loginAs(h.app, 'finance@waffarha.com');
    expect((await fin.get('/admin/v1/portal/campaigns')).status).toBe(403);
    expect((await request(h.app.getHttpServer()).get('/admin/v1/portal/campaigns')).status).toBe(
      401,
    );
  });
});
