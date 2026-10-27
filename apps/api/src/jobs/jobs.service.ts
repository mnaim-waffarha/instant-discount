import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CAMPAIGNS_CHANGED_CHANNEL } from '../campaigns/campaign-cache.service';
import { CountersService, USAGE_STATUSES } from '../counters/counters.service';
import { LifecycleService } from '../discounts/lifecycle.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

const EXPIRY_BATCH = 200;
const EXPIRY_RUN_BUDGET_MS = 30_000;

/** Background jobs. Each takes a Redis lock so only one worker replica runs it at a time. */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly lifecycle: LifecycleService,
    private readonly counters: CountersService,
  ) {}

  /** Releases reservations the acquirer never confirmed (e.g. it timed out and charged full price). */
  @Interval(15_000)
  async expireReservations(): Promise<number> {
    return (
      (await this.redis.withLock('job:expiry', 60_000, async () => {
        // Drain in batches, but stop well before the lock expires.
        const deadline = Date.now() + EXPIRY_RUN_BUDGET_MS;
        let expired = 0;
        while (Date.now() < deadline) {
          const due = await this.prisma.redemption.findMany({
            where: { status: 'RESERVED', expiresAt: { lte: new Date() } },
            select: { id: true },
            take: EXPIRY_BATCH,
            orderBy: { expiresAt: 'asc' },
          });
          for (const { id } of due) {
            if (await this.lifecycle.expire(id).catch(() => false)) expired++;
          }
          if (due.length < EXPIRY_BATCH) break;
        }
        if (expired) this.logger.log(`Expired ${expired} reservations`);
        return expired;
      })) ?? 0
    );
  }

  /** SCHEDULED → ACTIVE at start, ACTIVE/PAUSED → ENDED at end. */
  @Interval(30_000)
  async advanceCampaigns(): Promise<number> {
    return (
      (await this.redis.withLock('job:campaign-lifecycle', 30_000, async () => {
        const now = new Date();
        const ended = await this.prisma.campaign.updateMany({
          where: { status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED'] }, endAt: { lte: now } },
          data: { status: 'ENDED' },
        });
        const started = await this.prisma.campaign.updateMany({
          where: { status: 'SCHEDULED', startAt: { lte: now } },
          data: { status: 'ACTIVE' },
        });
        const changed = ended.count + started.count;
        if (changed) await this.redis.client.publish(CAMPAIGNS_CHANGED_CHANNEL, 'lifecycle');
        return changed;
      })) ?? 0
    );
  }

  /**
   * Compares Redis budget counters with Postgres and logs drift. Small transient drift is
   * expected (reservations in flight); persistent drift means a counter update was lost, and
   * an operator can force a rebuild.
   */
  @Interval(300_000)
  async reconcile(): Promise<Array<{ campaignId: string; redisSpent: number; dbSpent: number }>> {
    return (
      (await this.redis.withLock('job:reconcile', 300_000, async () => {
        const campaigns = await this.prisma.campaign.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true },
        });
        const drift: Array<{ campaignId: string; redisSpent: number; dbSpent: number }> = [];
        for (const { id } of campaigns) {
          const snapshot = await this.counters.snapshot(id);
          if (!snapshot.initialized) continue;
          const agg = await this.prisma.redemption.aggregate({
            where: { campaignId: id, status: { in: [...USAGE_STATUSES] } },
            _sum: { discountMinor: true, refundedDiscountMinor: true },
          });
          const dbSpent = Number(
            (agg._sum.discountMinor ?? 0n) - (agg._sum.refundedDiscountMinor ?? 0n),
          );
          if (dbSpent !== snapshot.spent) {
            drift.push({ campaignId: id, redisSpent: snapshot.spent, dbSpent });
            this.logger.warn(
              `Counter drift on campaign ${id}: redis=${snapshot.spent} db=${dbSpent}`,
            );
          }
        }
        return drift;
      })) ?? []
    );
  }
}
