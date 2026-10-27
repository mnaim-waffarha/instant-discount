import { Controller, Get, HttpException } from '@nestjs/common';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => 'ok',
        () => 'down',
      ),
      this.redis.client.ping().then(
        () => 'ok',
        () => 'down',
      ),
    ]);
    const body = { status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded', db, redis };
    if (body.status !== 'ok') throw new HttpException(body, 503);
    return body;
  }
}
