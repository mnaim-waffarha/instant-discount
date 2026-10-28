import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  /** Separate connection: a subscribed ioredis client cannot run other commands. */
  readonly subscriber: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const options = { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false };
    this.client = new Redis(config.REDIS_URL, options);
    this.subscriber = new Redis(config.REDIS_URL, options);
  }

  /** Runs fn only if this process wins the lock; used so one worker replica runs each job. */
  async withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const key = `lock:${name}`;
    const token = Math.random().toString(36).slice(2);
    const acquired = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    if (!acquired) return undefined;
    try {
      return await fn();
    } finally {
      // Only release our own lock.
      await this.client.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        key,
        token,
      );
    }
  }

  async onModuleDestroy() {
    this.subscriber.disconnect();
    this.client.disconnect();
  }
}
