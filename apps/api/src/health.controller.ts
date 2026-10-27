import { Controller, Get, HttpException } from '@nestjs/common';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';

export interface DependencyHealth {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  redis: 'ok' | 'down';
}

/** Database and Redis reachability; shared by the API and the worker's health server. */
export async function checkDependencies(
  prisma: PrismaService,
  redis: RedisService,
): Promise<DependencyHealth> {
  const [db, cache] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(
      () => 'ok' as const,
      () => 'down' as const,
    ),
    redis.client.ping().then(
      () => 'ok' as const,
      () => 'down' as const,
    ),
  ]);
  return { status: db === 'ok' && cache === 'ok' ? 'ok' : 'degraded', db, redis: cache };
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Readiness: take this instance out of rotation while a dependency is down. */
  @Get()
  async check() {
    const body = await checkDependencies(this.prisma, this.redis);
    if (body.status !== 'ok') throw new HttpException(body, 503);
    return body;
  }

  /**
   * Liveness: the process is up. Deliberately ignores dependencies, so a database blip removes
   * pods from rotation (readiness) instead of restarting all of them at once.
   */
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
