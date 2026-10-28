import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDemoCampaign } from '../scripts/demo-data';
import { buildSpecs } from '../src/openapi/generate';
import { inquire, loginAs, resetData, signedPost, startApp, type Harness } from './harness';

/**
 * Calls the real API and checks every JSON response against the generated OpenAPI documents:
 * the body must validate, and it must not contain fields the docs do not mention.
 */
type Schema = Record<string, unknown>;
const specs = buildSpecs();
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const checked = new Set<string>();

function operation(spec: keyof typeof specs, method: string, template: string) {
  const paths = specs[spec].paths as Record<string, Record<string, Schema>>;
  const op = paths[template]?.[method.toLowerCase()];
  if (!op) throw new Error(`${method} ${template} is not in the ${spec} spec`);
  return op;
}

function resolve(schema: Schema, components: Record<string, Schema>): Schema {
  let s = schema;
  while (typeof s.$ref === 'string') s = components[s.$ref.split('/').pop()!]!;
  return s;
}

/** Properties a schema documents for an object value (through $ref, allOf, anyOf, oneOf). */
function documented(
  schema: Schema,
  components: Record<string, Schema>,
): { props: Record<string, Schema>; open: boolean } {
  const s = resolve(schema, components);
  const out = { props: { ...((s.properties as Record<string, Schema>) ?? {}) }, open: false };
  if (s.additionalProperties !== undefined && s.additionalProperties !== false) out.open = true;
  if (!s.type && !s.properties && !s.allOf && !s.anyOf && !s.oneOf) out.open = true; // {} = any
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    for (const branch of (s[key] as Schema[] | undefined) ?? []) {
      const d = documented(branch, components);
      Object.assign(out.props, d.props);
      out.open ||= d.open;
    }
  }
  return out;
}

function undocumented(
  value: unknown,
  schema: Schema,
  components: Record<string, Schema>,
  path: string,
  found: string[],
) {
  const s = resolve(schema, components);
  if (Array.isArray(value)) {
    const items =
      (s.items as Schema | undefined) ??
      [...((s.anyOf as Schema[]) ?? []), ...((s.oneOf as Schema[]) ?? [])]
        .map((b) => resolve(b, components))
        .find((b) => b.items)?.items;
    if (items)
      value.forEach((v, i) => undocumented(v, items as Schema, components, `${path}[${i}]`, found));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const { props, open } = documented(s, components);
  for (const [k, v] of Object.entries(value)) {
    if (!(k in props)) {
      if (!open) found.push(`${path}.${k}`);
      continue;
    }
    undocumented(v, props[k]!, components, `${path}.${k}`, found);
  }
}

function expectDocumented(
  spec: keyof typeof specs,
  method: string,
  template: string,
  res: Response,
) {
  const op = operation(spec, method, template);
  const responses = op.responses as Record<
    string,
    { content?: Record<string, { schema: Schema }> }
  >;
  const documentedStatus = responses[String(res.status)];
  expect(
    documentedStatus,
    `${method} ${template}: status ${res.status} is not documented (${JSON.stringify(res.body)})`,
  ).toBeDefined();
  const schema = documentedStatus!.content?.['application/json']?.schema;
  if (!schema) return;
  const components = (specs[spec].components as { schemas: Record<string, Schema> }).schemas;
  const validate = ajv.compile({ ...schema, components: { schemas: components } });
  expect(validate(res.body), `${method} ${template}: ${ajv.errorsText(validate.errors)}`).toBe(
    true,
  );
  const extra: string[] = [];
  undocumented(res.body, schema, components, 'body', extra);
  expect(extra, `${method} ${template} returns undocumented fields`).toEqual([]);
  checked.add(`${method} ${template}`);
}

let h: Harness;
beforeAll(async () => {
  const base = await startApp();
  h = { ...base, net: undefined as never };
});
afterAll(async () => h.app.close());
beforeEach(async () => {
  h.net = await resetData(h);
  await h.prisma.user.createMany({
    data: [
      { email: 'admin@waffarha.com', name: 'Admin', role: 'ADMIN' },
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

const period = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());

describe('responses match the API docs', () => {
  it('acquirer, admin, portal and ops endpoints', async () => {
    const admin = await loginAs(h.app, 'admin@waffarha.com');
    const approver = await loginAs(h.app, 'approver@waffarha.com');
    const partner = await loginAs(h.app, 'ops@demobank.example');
    const id = (template: string, values: Record<string, string>) =>
      template.replace(/\{(\w+)\}/g, (_, k: string) => values[k]!);

    // Acquirer flow on the demo campaign.
    const demo = await createDemoCampaign(h.prisma, h.net, { perCardMaxCount: 10 });
    await h.cache.refresh();
    const eligible = await inquire(h.app, { card_token: 'tok_docs_1_card' });
    expectDocumented('acquirer', 'POST', '/v1/discounts/inquire', eligible);
    const r = eligible.body as { redemption_id: string; final_amount: number };
    expectDocumented(
      'acquirer',
      'POST',
      '/v1/discounts/{id}/confirm',
      await signedPost(h.app, `/v1/discounts/${r.redemption_id}/confirm`, {
        charged_amount: r.final_amount,
      }),
    );
    expectDocumented(
      'acquirer',
      'POST',
      '/v1/discounts/{id}/refund',
      await signedPost(h.app, `/v1/discounts/${r.redemption_id}/refund`, {
        refund_id: 'rf-docs',
        amount: 1_000,
      }),
    );
    const second = (await inquire(h.app, { card_token: 'tok_docs_2_card' })).body as {
      redemption_id: string;
    };
    expectDocumented(
      'acquirer',
      'POST',
      '/v1/discounts/{id}/cancel',
      await signedPost(h.app, `/v1/discounts/${second.redemption_id}/cancel`, {}),
    );
    const notEligible = await inquire(h.app, { terminal_id: 'NO-SUCH-TID' });
    expectDocumented('acquirer', 'POST', '/v1/discounts/inquire', notEligible);
    expectDocumented(
      'acquirer',
      'POST',
      '/v1/discounts/{id}/confirm',
      await signedPost(h.app, '/v1/discounts/00000000-0000-4000-8000-000000000000/confirm', {
        charged_amount: 1,
      }),
    );

    // Campaign lifecycle through the admin API, with an A/B test and a holdout.
    const startAt = new Date(Date.now() - 3_600_000).toISOString();
    const endAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const created = await admin.post('/admin/v1/campaigns').send({
      name: 'Docs campaign',
      country: 'EG',
      currency: 'EGP',
      startAt,
      endAt,
      discount: { type: 'PERCENT', percentBps: 1000 },
      targeting: { merchantIds: [h.net.merchant.id] },
      limits: { totalBudgetMinor: 1_000_000 },
      fundings: [{ partnerId: h.net.bank.id, shareBps: 10_000 }],
      holdoutBps: 1000,
      variants: [
        { key: 'A', name: 'Ten', weightBps: 5000, discount: { type: 'PERCENT', percentBps: 1000 } },
        {
          key: 'B',
          name: 'Fixed',
          weightBps: 5000,
          discount: { type: 'FIXED', amountMinor: 4000 },
        },
      ],
    });
    expectDocumented('admin', 'POST', '/admin/v1/campaigns', created);
    const c = { id: created.body.id as string };
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/campaigns/{id}/submit',
      await admin.post(id('/admin/v1/campaigns/{id}/submit', c)).send({}),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/campaigns/{id}/approve',
      await approver.post(id('/admin/v1/campaigns/{id}/approve', c)).send({}),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/campaigns/{id}/pause',
      await admin.post(id('/admin/v1/campaigns/{id}/pause', c)).send({}),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/campaigns/{id}/resume',
      await admin.post(id('/admin/v1/campaigns/{id}/resume', c)).send({}),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/campaigns/{id}/approve',
      await approver.post(id('/admin/v1/campaigns/{id}/approve', c)).send({}),
    );

    // Settlement documents.
    const run = await admin
      .post('/admin/v1/settlements/run')
      .send({ country: 'EG', period: period() });
    expectDocumented('admin', 'POST', '/admin/v1/settlements/run', run);
    const docs = await admin.get('/admin/v1/documents');
    expectDocumented('admin', 'GET', '/admin/v1/documents', docs);
    const doc = {
      id: (docs.body.items as Array<{ id: string; partnerId: string }>).find(
        (d) => d.partnerId === h.net.bank.id,
      )!.id,
    };
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/documents/{id}/issue',
      await admin.post(id('/admin/v1/documents/{id}/issue', doc)).send({}),
    );

    const values = {
      id: c.id,
      version: '1',
    };
    const gets: Array<
      [
        ReturnType<typeof loginAs> extends Promise<infer A> ? A : never,
        string,
        Record<string, string>,
      ]
    > = [
      [admin, '/admin/v1/auth/me', {}],
      [admin, '/admin/v1/campaigns', {}],
      [admin, '/admin/v1/campaigns/{id}', values],
      [admin, '/admin/v1/campaigns/{id}/versions/{version}', values],
      [admin, '/admin/v1/campaigns/{id}/stats', { id: demo.id }],
      [admin, '/admin/v1/campaigns/{id}/performance', { id: demo.id }],
      [admin, '/admin/v1/redemptions', {}],
      [admin, '/admin/v1/redemptions/{id}', { id: r.redemption_id }],
      [admin, '/admin/v1/inquiries/summary', {}],
      [admin, '/admin/v1/merchants', {}],
      [admin, '/admin/v1/merchants/{id}', { id: h.net.merchant.id }],
      [admin, '/admin/v1/terminals', {}],
      [admin, '/admin/v1/partners', {}],
      [admin, '/admin/v1/partners/{id}', { id: h.net.bank.id }],
      [admin, '/admin/v1/acquirers', {}],
      [admin, '/admin/v1/users', {}],
      [admin, '/admin/v1/audit', {}],
      [admin, '/admin/v1/settlements/overview?country=EG&period=' + period(), {}],
      [admin, '/admin/v1/documents/{id}', doc],
      [admin, '/admin/v1/tax-rates', {}],
      [admin, '/admin/v1/safety', {}],
      [admin, '/admin/v1/alerts', {}],
      [partner, '/admin/v1/portal/me', {}],
      [partner, '/admin/v1/portal/campaigns', {}],
      [partner, '/admin/v1/portal/campaigns/{id}/redemptions', { id: demo.id }],
      [partner, '/admin/v1/portal/campaigns/{id}/performance', { id: c.id }],
      [partner, '/admin/v1/portal/documents', {}],
    ];
    for (const [agent, template, params] of gets) {
      const [pathTemplate, query] = template.split('?');
      const res = await agent.get(id(pathTemplate!, params) + (query ? `?${query}` : ''));
      expect(res.status, `GET ${template}: ${JSON.stringify(res.body)}`).toBe(200);
      expectDocumented('admin', 'GET', pathTemplate!, res);
    }

    // Mutations on the network, partners, acquirers, users and safety.
    const partnerRes = await admin
      .post('/admin/v1/partners')
      .send({ name: 'Docs Bank', type: 'BANK', country: 'EG' });
    expectDocumented('admin', 'POST', '/admin/v1/partners', partnerRes);
    expectDocumented(
      'admin',
      'PATCH',
      '/admin/v1/partners/{id}',
      await admin.patch(`/admin/v1/partners/${partnerRes.body.id}`).send({ name: 'Docs Bank 2' }),
    );
    const acq = await admin
      .post('/admin/v1/acquirers')
      .send({ name: 'Docs Acquirer', country: 'EG' });
    expectDocumented('admin', 'POST', '/admin/v1/acquirers', acq);
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/acquirers/{id}/rotate-secret',
      await admin.post(`/admin/v1/acquirers/${acq.body.acquirer.id}/rotate-secret`).send({}),
    );
    const merchant = await admin
      .post('/admin/v1/merchants')
      .send({ partnerId: h.net.merchantPartner.id, name: 'Docs Cafe', country: 'EG', mcc: '5812' });
    expectDocumented('admin', 'POST', '/admin/v1/merchants', merchant);
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/merchants/{id}/branches',
      await admin.post(`/admin/v1/merchants/${merchant.body.id}/branches`).send({ name: 'Maadi' }),
    );
    const terminal = await admin.post('/admin/v1/terminals').send({
      acquirerId: h.net.acquirer.id,
      externalTerminalId: 'TID-DOCS',
      merchantId: merchant.body.id,
    });
    expectDocumented('admin', 'POST', '/admin/v1/terminals', terminal);
    expectDocumented(
      'admin',
      'PATCH',
      '/admin/v1/terminals/{id}',
      await admin.patch(`/admin/v1/terminals/${terminal.body.id}`).send({ active: false }),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/terminals/import',
      await admin.post('/admin/v1/terminals/import').send({
        csv: 'acquirer_api_key,tid,merchant_id,branch_id,mcc\nacq_demo,TID-X,not-a-merchant,,5812',
        dryRun: true,
      }),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/users',
      await admin
        .post('/admin/v1/users')
        .send({ email: 'new@waffarha.com', name: 'New', role: 'VIEWER' }),
    );
    expectDocumented(
      'admin',
      'PATCH',
      '/admin/v1/users/me/locale',
      await admin.patch('/admin/v1/users/me/locale').send({ locale: 'ar' }),
    );
    expectDocumented(
      'admin',
      'PUT',
      '/admin/v1/safety',
      await admin.put('/admin/v1/safety').send({ cardVelocity: { maxGrantsPerHour: 8 } }),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/simulate',
      await admin.post('/admin/v1/simulate').send({
        terminalId: h.net.terminal.id,
        bin: '412345',
        scheme: 'VISA',
        amountMinor: 50_000,
        cardToken: 'tok_docs_sim_card',
      }),
    );
    expectDocumented(
      'admin',
      'POST',
      '/admin/v1/campaigns',
      await admin.post('/admin/v1/campaigns').send({ name: '' }),
    );
    expectDocumented('admin', 'GET', '/admin/v1/users', await partner.get('/admin/v1/users'));

    // Ops.
    const ops = h.app.getHttpServer();
    const supertest = (await import('supertest')).default;
    expectDocumented('ops', 'GET', '/health', await supertest(ops).get('/health'));
    expectDocumented('ops', 'GET', '/health/live', await supertest(ops).get('/health/live'));

    expect(checked.size).toBeGreaterThanOrEqual(50);
  });
});
