import { Injectable } from '@nestjs/common';
import { conflict, unprocessable } from '../common/api-error';
import { RedisService } from '../infra/redis.service';

const TTL_SECONDS = 24 * 3600;

type Entry<T> = { hash: string; state: 'pending' } | { hash: string; state: 'done'; response: T };

/**
 * Replays the stored response when an acquirer retries a request with the same Idempotency-Key.
 * Reusing a key with a different body is rejected.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  async run<T>(scope: string, key: string, requestHash: string, fn: () => Promise<T>): Promise<T> {
    const redisKey = `idem:${scope}:${key}`;
    const pending: Entry<T> = { hash: requestHash, state: 'pending' };
    const claimed = await this.redis.client.set(
      redisKey,
      JSON.stringify(pending),
      'EX',
      TTL_SECONDS,
      'NX',
    );

    if (!claimed) {
      const raw = await this.redis.client.get(redisKey);
      const entry = raw ? (JSON.parse(raw) as Entry<T>) : undefined;
      if (entry) {
        if (entry.hash !== requestHash) {
          throw unprocessable(
            'IDEMPOTENCY_KEY_REUSED',
            'Idempotency-Key was already used with a different request',
          );
        }
        if (entry.state === 'pending') {
          throw conflict(
            'IDEMPOTENCY_IN_PROGRESS',
            'A request with this Idempotency-Key is still being processed',
          );
        }
        return entry.response;
      }
      // Expired between SET and GET: just process it.
    }

    try {
      const response = await fn();
      const done: Entry<T> = { hash: requestHash, state: 'done', response };
      await this.redis.client.set(redisKey, JSON.stringify(done), 'EX', TTL_SECONDS);
      return response;
    } catch (err) {
      await this.redis.client.del(redisKey).catch(() => undefined);
      throw err;
    }
  }
}
