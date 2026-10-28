import { createServer, type Server } from 'node:http';
import { checkDependencies } from './health.controller';
import type { PrismaService } from './infra/prisma.service';
import type { RedisService } from './infra/redis.service';
import type { MetricsService } from './safety/metrics.service';

export interface WorkerHealthDeps {
  prisma: PrismaService;
  redis: RedisService;
  metrics: MetricsService;
  metricsToken?: string;
}

/**
 * The worker has no Nest HTTP server, so Kubernetes probes and Prometheus use this one:
 * GET /health/live (process up), GET /health (DB + Redis), GET /metrics (job metrics).
 */
export function startWorkerHealthServer(deps: WorkerHealthDeps, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: string, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    void (async () => {
      try {
        const path = (req.url ?? '/').split('?')[0];
        if (req.method !== 'GET')
          return send(405, JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED' } }));
        if (path === '/health/live') return send(200, JSON.stringify({ status: 'ok' }));
        if (path === '/health') {
          const health = await checkDependencies(deps.prisma, deps.redis);
          return send(health.status === 'ok' ? 200 : 503, JSON.stringify(health));
        }
        if (path === '/metrics') {
          if (deps.metricsToken && req.headers.authorization !== `Bearer ${deps.metricsToken}`) {
            return send(401, JSON.stringify({ error: { code: 'UNAUTHORIZED' } }));
          }
          return send(
            200,
            await deps.metrics.registry.metrics(),
            deps.metrics.registry.contentType,
          );
        }
        send(404, JSON.stringify({ error: { code: 'NOT_FOUND' } }));
      } catch {
        send(500, JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }));
      }
    })();
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
