import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AcquirersService } from '../src/acquirers/acquirers.service';
import { CampaignCache } from '../src/campaigns/campaign-cache.service';
import { signRequest } from '../src/common/crypto';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { SettingsService } from '../src/safety/settings.service';
import { TerminalResolver } from '../src/terminals/terminal-resolver.service';
import { DEMO, createDemoNetwork, type DemoNetwork } from '../scripts/demo-data';

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  redis: RedisService;
  cache: CampaignCache;
  net: DemoNetwork;
}

export async function startApp(): Promise<Omit<Harness, 'net'>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    cache: app.get(CampaignCache),
  };
}

/** Empties Postgres and Redis and recreates the demo network. */
export async function resetData(h: Omit<Harness, 'net'>): Promise<DemoNetwork> {
  const tables = await h.prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'TaxRate')`;
  await h.prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`,
  );
  await h.redis.client.flushdb();
  h.app.get(AcquirersService).clear();
  h.app.get(TerminalResolver).clear();
  await h.app.get(SettingsService).refresh();
  return createDemoNetwork(h.prisma, process.env.SECRETS_ENCRYPTION_KEY!);
}

export function signedPost(
  app: INestApplication,
  path: string,
  body: unknown,
  opts: { idempotencyKey?: string; secret?: string; timestamp?: number; apiKey?: string } = {},
) {
  const raw = JSON.stringify(body);
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const req = request(app.getHttpServer())
    .post(path)
    .set('Content-Type', 'application/json')
    .set('X-Api-Key', opts.apiKey ?? DEMO.apiKeyId)
    .set('X-Timestamp', ts)
    .set('X-Signature', signRequest(opts.secret ?? DEMO.hmacSecret, ts, 'POST', path, raw));
  if (opts.idempotencyKey) req.set('Idempotency-Key', opts.idempotencyKey);
  return req.send(raw);
}

let seq = 0;
export function inquiryBody(overrides: Record<string, unknown> = {}) {
  seq++;
  return {
    terminal_id: DEMO.terminalId,
    bin: DEMO.bin,
    card_token: `tok_card_${seq}`,
    scheme: 'VISA',
    amount: 50_000,
    currency: 'EGP',
    acquirer_txn_ref: `txn-${seq}`,
    ...overrides,
  };
}

export function inquire(
  app: INestApplication,
  overrides: Record<string, unknown> = {},
  key?: string,
) {
  const body = inquiryBody(overrides);
  return signedPost(app, '/v1/discounts/inquire', body, {
    idempotencyKey: key ?? `idem-${body.acquirer_txn_ref}`,
  });
}

/** A supertest agent signed in as `email` (via dev-login), keeping the session cookie. */
export async function loginAs(app: INestApplication, email: string) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/admin/v1/auth/dev-login').send({ email });
  if (res.status !== 200)
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Waits until `fn` returns true (used for pub/sub-driven cache reloads). */
export async function eventually(fn: () => Promise<boolean>, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met in time');
}
