import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { MetricsService } from '../src/safety/metrics.service';
import { startWorkerHealthServer } from '../src/worker-health';
import { startApp } from './harness';

let h: Awaited<ReturnType<typeof startApp>>;
let worker: Server;
let base: string;

beforeAll(async () => {
  h = await startApp();
  worker = await startWorkerHealthServer(
    {
      prisma: h.app.get(PrismaService),
      redis: h.app.get(RedisService),
      metrics: h.app.get(MetricsService),
      metricsToken: 'secret-token',
    },
    0,
  );
  base = `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
});
afterAll(async () => {
  worker.close();
  await h.app.close();
});

describe('Kubernetes probes', () => {
  it('API: liveness never touches dependencies, readiness does', async () => {
    const server = h.app.getHttpServer();
    expect((await request(server).get('/health/live')).body).toEqual({ status: 'ok' });
    expect((await request(server).get('/health')).body).toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
    });
  });

  it('worker: health, liveness and token-protected metrics', async () => {
    expect(await (await fetch(`${base}/health/live`)).json()).toEqual({ status: 'ok' });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
    });
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    const metrics = await fetch(`${base}/metrics`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain('instant_discount_job_duration_seconds');
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
