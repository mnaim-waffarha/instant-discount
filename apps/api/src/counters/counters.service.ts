import { Injectable, Logger } from '@nestjs/common';
import type { ActiveCampaign } from '../campaigns/campaign-cache.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { campaignKeys, scriptKeys, type CounterBuckets } from './counter-keys';
import { RELEASE_LUA, RESERVE_LUA } from './scripts';

export type ReserveResult =
  | 'OK'
  | 'NOT_INITIALIZED'
  | 'BUDGET_EXHAUSTED'
  | 'MAX_CARDS_REACHED'
  | 'DAILY_BUDGET_EXHAUSTED'
  | 'DAILY_LIMIT_REACHED'
  | 'CARD_LIMIT_REACHED'
  | 'CARD_AMOUNT_LIMIT_REACHED';

/** Statuses whose discount still counts against the campaign's limits. */
export const USAGE_STATUSES = ['RESERVED', 'CONFIRMED', 'PARTIALLY_REFUNDED'] as const;

const DAY = 86_400;
const DAY_BUCKET_TTL = 3 * DAY;
const WEEK_BUCKET_TTL = 10 * DAY;

type ScriptClient = {
  idReserve(...args: Array<string | number>): Promise<ReserveResult>;
  idRelease(...args: Array<string | number>): Promise<string>;
};

/**
 * Budget and cap counters in Redis, updated atomically by Lua scripts so concurrent
 * inquiries can never overshoot a limit. Postgres stays the source of truth: if a campaign's
 * counters are missing (new campaign, Redis restart) they are rebuilt from redemptions.
 */
@Injectable()
export class CountersService {
  private readonly logger = new Logger(CountersService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    redis.client.defineCommand('idReserve', { numberOfKeys: 9, lua: RESERVE_LUA });
    redis.client.defineCommand('idRelease', { numberOfKeys: 9, lua: RELEASE_LUA });
  }

  private get scripts(): ScriptClient {
    return this.redis.client as unknown as ScriptClient;
  }

  async reserve(
    campaign: ActiveCampaign,
    cardHash: string,
    buckets: CounterBuckets,
    discountMinor: number,
    now: Date,
  ): Promise<ReserveResult> {
    const run = () => {
      const l = campaign.limits;
      const campaignTtl = Math.max(
        DAY,
        Math.ceil((campaign.rule.endAt.getTime() - now.getTime()) / 1000) + 90 * DAY,
      );
      const cardTtl =
        l.perCardPeriod === 'DAY'
          ? DAY_BUCKET_TTL
          : l.perCardPeriod === 'WEEK'
            ? WEEK_BUCKET_TTL
            : campaignTtl;
      return this.scripts.idReserve(
        ...scriptKeys(campaign.rule.id, cardHash, buckets),
        discountMinor,
        cardHash,
        l.totalBudgetMinor ?? -1,
        l.maxUniqueCards ?? -1,
        l.dailyBudgetMinor ?? -1,
        l.dailyRedemptionLimit ?? -1,
        l.perCardMaxCount ?? -1,
        l.perCardMaxAmountMinor ?? -1,
        campaignTtl,
        DAY_BUCKET_TTL,
        cardTtl,
      );
    };

    const result = await run();
    if (result !== 'NOT_INITIALIZED') return result;
    // Rebuilt by someone else in the meantime, or by us now; retry once either way.
    await this.rebuild(campaign.rule.id);
    return run();
  }

  /**
   * Gives back `discountDeltaMinor` of budget. With `releaseUsage`, also frees the redemption's
   * count and (if it was the card's last active redemption) its unique-card slot.
   */
  async release(
    campaignId: string,
    cardHash: string,
    buckets: CounterBuckets,
    discountDeltaMinor: number,
    releaseUsage: boolean,
  ): Promise<void> {
    await this.scripts.idRelease(
      ...scriptKeys(campaignId, cardHash, buckets),
      discountDeltaMinor,
      cardHash,
      releaseUsage ? '1' : '0',
    );
  }

  /**
   * Recomputes a campaign's counters from Postgres. Reservations are blocked while the init key
   * is missing, so the only possible race is a release landing mid-rebuild, which can only
   * over-count usage (the safe direction); the reconciliation job reports any such drift.
   */
  async rebuild(campaignId: string): Promise<boolean> {
    const k = campaignKeys(campaignId);
    const locked = await this.redis.client.set(k.rebuildLock, '1', 'PX', 30_000, 'NX');
    if (!locked) {
      // Another instance is rebuilding; give it a moment.
      await new Promise((r) => setTimeout(r, 200));
      return false;
    }
    try {
      const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      const rows = await this.prisma.redemption.findMany({
        where: { campaignId, status: { in: [...USAGE_STATUSES] } },
        select: {
          cardTokenHash: true,
          counterKeys: true,
          discountMinor: true,
          refundedDiscountMinor: true,
        },
      });

      const values = new Map<string, number>();
      const add = (key: string, by: number) => values.set(key, (values.get(key) ?? 0) + by);
      const cardRefs = new Map<string, number>();
      for (const r of rows) {
        const net = Number(r.discountMinor - r.refundedDiscountMinor);
        const b = r.counterKeys as unknown as CounterBuckets;
        add(k.spent, net);
        add(k.count, 1);
        add(k.daySpent(b.day), net);
        add(k.dayCount(b.day), 1);
        add(k.cardCount(b.cardPeriod, r.cardTokenHash), 1);
        add(k.cardAmount(b.cardPeriod, r.cardTokenHash), net);
        cardRefs.set(r.cardTokenHash, (cardRefs.get(r.cardTokenHash) ?? 0) + 1);
      }

      const existing = await this.scanKeys(`${k.tag}:*`);
      const ttl = Math.max(
        DAY,
        Math.ceil((campaign.endAt.getTime() - Date.now()) / 1000) + 90 * DAY,
      );
      const tx = this.redis.client.multi();
      const toDelete = existing.filter((key) => key !== k.rebuildLock);
      if (toDelete.length) tx.del(...toDelete);
      for (const [key, value] of values) tx.set(key, value, 'EX', ttl);
      if (cardRefs.size) {
        tx.sadd(k.cards, ...cardRefs.keys());
        tx.hset(k.cardRefs, Object.fromEntries(cardRefs));
        tx.expire(k.cards, ttl);
        tx.expire(k.cardRefs, ttl);
      }
      tx.set(k.init, new Date().toISOString(), 'EX', ttl);
      await tx.exec();
      this.logger.log(
        `Rebuilt counters for campaign ${campaignId} from ${rows.length} redemptions`,
      );
      return true;
    } finally {
      await this.redis.client.del(k.rebuildLock);
    }
  }

  /** Current Redis totals, for reconciliation and dashboards. */
  async snapshot(
    campaignId: string,
  ): Promise<{ initialized: boolean; spent: number; count: number; cards: number }> {
    const k = campaignKeys(campaignId);
    const [init, spent, count, cards] = await Promise.all([
      this.redis.client.exists(k.init),
      this.redis.client.get(k.spent),
      this.redis.client.get(k.count),
      this.redis.client.scard(k.cards),
    ]);
    return { initialized: init === 1, spent: Number(spent ?? 0), count: Number(count ?? 0), cards };
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }
}
