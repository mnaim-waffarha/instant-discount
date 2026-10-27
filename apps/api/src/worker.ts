import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';
import { MetricsService } from './safety/metrics.service';
import { startWorkerHealthServer } from './worker-health';
import { WorkerModule } from './worker.module';

/** Background worker: same codebase as the API; only a small health/metrics HTTP server. */
async function main() {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: config.LOG_FORMAT === 'json' }),
  });
  app.enableShutdownHooks();
  const server = await startWorkerHealthServer(
    {
      prisma: app.get(PrismaService),
      redis: app.get(RedisService),
      metrics: app.get(MetricsService),
      metricsToken: config.METRICS_TOKEN,
    },
    config.WORKER_PORT,
  );
  const stop = () => server.close();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

void main();
