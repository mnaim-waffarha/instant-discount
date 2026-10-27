import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Campaign, CampaignFunding, CampaignVariant } from '@instant-discount/db';
import {
  discountConfigSchema,
  scheduleSchema,
  targetingSchema,
  type CampaignRule,
  type ExperimentConfig,
  type LimitPeriod,
} from '@instant-discount/rules-engine';
import type { Country } from '@instant-discount/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

/** Publish on this channel after any campaign change so every API instance reloads. */
export const CAMPAIGNS_CHANGED_CHANNEL = 'campaigns:changed';

/** Limits are null when unlimited. */
export interface CampaignLimits {
  totalBudgetMinor: number | null;
  maxUniqueCards: number | null;
  dailyBudgetMinor: number | null;
  dailyRedemptionLimit: number | null;
  perCardMaxCount: number | null;
  perCardMaxAmountMinor: number | null;
  perCardPeriod: LimitPeriod;
}

export interface ActiveCampaign {
  rule: CampaignRule;
  limits: CampaignLimits;
  fundings: Array<{ partnerId: string; shareBps: number }>;
  displayMessage: string | null;
  displayMessageAr: string | null;
  /** Holdout and A/B variants; variants are empty when the campaign runs no A/B test. */
  experiment: ExperimentConfig;
}

/** Relations every campaign read needs. */
export const CAMPAIGN_INCLUDE = { fundings: true, variants: { orderBy: { key: 'asc' as const } } };
export type CampaignWithRelations = Campaign & {
  fundings: CampaignFunding[];
  variants: CampaignVariant[];
};

const toNum = (v: bigint | number | null) => (v === null ? null : Number(v));

export function toActiveCampaign(c: CampaignWithRelations): ActiveCampaign {
  return {
    rule: {
      id: c.id,
      version: c.version,
      status: c.status,
      priority: c.priority,
      country: c.country,
      currency: c.currency,
      timezone: c.timezone,
      startAt: c.startAt,
      endAt: c.endAt,
      discount: discountConfigSchema.parse(c.discountConfig),
      targeting: targetingSchema.parse(c.targeting),
      schedule: c.schedule === null ? undefined : scheduleSchema.parse(c.schedule),
    },
    limits: {
      totalBudgetMinor: toNum(c.totalBudgetMinor),
      maxUniqueCards: c.maxUniqueCards,
      dailyBudgetMinor: toNum(c.dailyBudgetMinor),
      dailyRedemptionLimit: c.dailyRedemptionLimit,
      perCardMaxCount: c.perCardMaxCount,
      perCardMaxAmountMinor: toNum(c.perCardMaxAmountMinor),
      perCardPeriod: c.perCardPeriod ?? 'CAMPAIGN',
    },
    fundings: c.fundings
      .map((f) => ({ partnerId: f.partnerId, shareBps: f.shareBps }))
      .sort((a, b) => b.shareBps - a.shareBps),
    displayMessage: c.displayMessage,
    displayMessageAr: c.displayMessageAr,
    experiment: {
      campaignId: c.id,
      salt: c.experimentSalt,
      holdoutBps: c.holdoutBps,
      variants: c.variants.map((v) => ({
        key: v.key,
        weightBps: v.weightBps,
        discount: discountConfigSchema.parse(v.discountConfig),
      })),
    },
  };
}

/**
 * Keeps ACTIVE campaigns in memory so an inquiry needs no database read to evaluate rules.
 * Refreshes on an interval and immediately when a change is published.
 */
@Injectable()
export class CampaignCache implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignCache.name);
  private byCountry = new Map<Country, ActiveCampaign[]>();
  private byId = new Map<string, ActiveCampaign>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.config.CAMPAIGN_CACHE_REFRESH_MS);
    this.timer.unref();
    await this.redis.subscriber.subscribe(CAMPAIGNS_CHANGED_CHANNEL);
    this.redis.subscriber.on('message', (channel) => {
      if (channel === CAMPAIGNS_CHANGED_CHANNEL) void this.refresh();
    });
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  forCountry(country: Country): ActiveCampaign[] {
    return this.byCountry.get(country) ?? [];
  }

  get(id: string): ActiveCampaign | undefined {
    return this.byId.get(id);
  }

  async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.campaign.findMany({
        where: { status: 'ACTIVE', endAt: { gt: new Date() } },
        include: CAMPAIGN_INCLUDE,
      });
      const byCountry = new Map<Country, ActiveCampaign[]>();
      const byId = new Map<string, ActiveCampaign>();
      for (const row of rows) {
        try {
          const campaign = toActiveCampaign(row);
          byId.set(row.id, campaign);
          byCountry.set(row.country, [...(byCountry.get(row.country) ?? []), campaign]);
        } catch (err) {
          // A malformed campaign must not take the others down.
          this.logger.error(`Skipping campaign ${row.id}: invalid configuration (${String(err)})`);
        }
      }
      this.byCountry = byCountry;
      this.byId = byId;
    } catch (err) {
      // Keep serving the last good snapshot.
      this.logger.error(`Campaign cache refresh failed: ${String(err)}`);
    }
  }
}
