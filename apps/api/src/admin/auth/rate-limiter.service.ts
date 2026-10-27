import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import { RedisService } from '../../infra/redis.service';

@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  /** Throws 429 once `key` was hit more than `limit` times within `windowSeconds`. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const redisKey = `rl:${key}`;
    const count = await this.redis.client.incr(redisKey);
    if (count === 1) await this.redis.client.expire(redisKey, windowSeconds);
    if (count > limit)
      throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts, try again later');
  }
}
