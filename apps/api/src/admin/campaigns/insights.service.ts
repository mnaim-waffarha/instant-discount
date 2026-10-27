import { Injectable } from '@nestjs/common';
import type { CampaignStatus } from '@instant-discount/db';
import {
  evaluateCampaign,
  periodKey,
  rankCampaigns,
  type TransactionContext,
} from '@instant-discount/rules-engine';
import { toActiveCampaign, type ActiveCampaign } from '../../campaigns/campaign-cache.service';
import { notFound } from '../../common/api-error';
import { CountersService, USAGE_STATUSES } from '../../counters/counters.service';
import { PrismaService } from '../../infra/prisma.service';

export interface SimulateInput {
  terminalId: string;
  bin: string;
  scheme: TransactionContext['scheme'];
  amountMinor: number;
  at?: Date;
  includeInactive: boolean;
}

/** Remaining headroom for one transaction; null = unlimited. */
interface Headroom {
  budgetMinor: number | null;
  uniqueCards: number | null;
  dailyBudgetMinor: number | null;
  dailyRedemptions: number | null;
}

@Injectable()
export class CampaignInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
  ) {}

  /**
   * "Would this payment get a discount, and why?" Evaluates every campaign in the terminal's
   * country (optionally including drafts and paused ones, as if they were live) and reports
   * the verdict and remaining caps. Never reserves anything. Per-card limits are not shown
   * because the simulator does not know the card.
   */
  async simulate(input: SimulateInput) {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: input.terminalId },
      include: { merchant: true },
    });
    if (!terminal) throw notFound('TERMINAL_NOT_FOUND', 'No such terminal');
    const now = input.at ?? new Date();
    const currency = terminal.merchant.country === 'EG' ? 'EGP' : 'SAR';
    const txn: TransactionContext = {
      country: terminal.merchant.country,
      currency,
      amountMinor: input.amountMinor,
      bin: input.bin,
      scheme: input.scheme,
      merchantId: terminal.merchantId,
      branchId: terminal.branchId ?? undefined,
      terminalId: terminal.id,
      mcc: terminal.mcc ?? terminal.merchant.mcc,
    };

    const statuses: CampaignStatus[] = input.includeInactive
      ? ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED']
      : ['ACTIVE'];
    const rows = await this.prisma.campaign.findMany({
      where: { country: txn.country, status: { in: statuses } },
      include: { fundings: true },
    });
    const campaigns = rows.flatMap((r) => {
      try {
        return [{ row: r, active: toActiveCampaign(r) }];
      } catch {
        return [];
      }
    });

    const results = await Promise.all(
      campaigns.map(async ({ row, active }) => {
        const asLive = { ...active.rule, status: 'ACTIVE' as const };
        const verdict = evaluateCampaign(asLive, txn, now);
        const headroom = await this.headroom(active, now);
        const capped = verdict.eligible ? cappedBy(headroom, verdict.discountMinor) : null;
        return {
          campaignId: row.id,
          name: row.name,
          status: row.status,
          priority: row.priority,
          eligible: verdict.eligible,
          reason: verdict.eligible ? null : verdict.reason,
          discountMinor: verdict.eligible ? verdict.discountMinor : null,
          finalAmountMinor: verdict.eligible ? verdict.finalAmountMinor : null,
          cappedBy: capped,
          headroom,
        };
      }),
    );

    // The campaign a real payment would get right now: live, eligible, not capped, best ranked.
    const usable = new Set(
      results
        .filter((r) => r.status === 'ACTIVE' && r.eligible && !r.cappedBy)
        .map((r) => r.campaignId),
    );
    const ranked = rankCampaigns(
      campaigns.filter((c) => usable.has(c.row.id)).map((c) => c.active.rule),
      txn,
      now,
    );
    const order = new Map(rows.map((r) => [r.id, r.priority]));
    results.sort((a, b) => (order.get(b.campaignId) ?? 0) - (order.get(a.campaignId) ?? 0));

    return {
      terminal: {
        id: terminal.id,
        externalTerminalId: terminal.externalTerminalId,
        merchantId: terminal.merchantId,
        mcc: txn.mcc,
        country: txn.country,
        currency,
      },
      at: now.toISOString(),
      winnerCampaignId: ranked.eligible[0]?.campaignId ?? null,
      results,
    };
  }

  async stats(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { fundings: true },
    });
    if (!campaign) throw notFound('CAMPAIGN_NOT_FOUND', 'No such campaign');

    const [byStatus, snapshot, daily, topTerminals] = await Promise.all([
      this.prisma.redemption.groupBy({
        by: ['status'],
        where: { campaignId },
        _count: true,
        _sum: { discountMinor: true, refundedDiscountMinor: true },
      }),
      this.counters.snapshot(campaignId),
      this.prisma.$queryRaw<Array<{ day: string; redemptions: bigint; discount: bigint }>>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${campaign.timezone}, 'YYYY-MM-DD') AS day,
               count(*) AS redemptions,
               sum("discountMinor" - "refundedDiscountMinor") AS discount
        FROM "Redemption"
        WHERE "campaignId" = ${campaignId}
          AND status IN ('CONFIRMED', 'PARTIALLY_REFUNDED')
          AND "createdAt" > now() - interval '30 days'
        GROUP BY 1 ORDER BY 1`,
      this.prisma.redemption.groupBy({
        by: ['terminalId'],
        where: { campaignId, status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] } },
        _count: true,
        _sum: { discountMinor: true },
        orderBy: { _count: { terminalId: 'desc' } },
        take: 10,
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    const settled =
      (counts.CONFIRMED ?? 0) + (counts.PARTIALLY_REFUNDED ?? 0) + (counts.REFUNDED ?? 0);
    const decided = settled + (counts.RELEASED ?? 0) + (counts.EXPIRED ?? 0);
    const dbSpent = byStatus
      .filter((s) => (USAGE_STATUSES as readonly string[]).includes(s.status))
      .reduce(
        (sum, s) =>
          sum + Number((s._sum.discountMinor ?? 0n) - (s._sum.refundedDiscountMinor ?? 0n)),
        0,
      );
    const total = campaign.totalBudgetMinor === null ? null : Number(campaign.totalBudgetMinor);
    const spent = snapshot.initialized ? snapshot.spent : dbSpent;
    const terminals = await this.prisma.terminal.findMany({
      where: { id: { in: topTerminals.map((t) => t.terminalId) } },
      select: { id: true, externalTerminalId: true },
    });
    const tid = new Map(terminals.map((t) => [t.id, t.externalTerminalId]));

    return {
      campaignId,
      currency: campaign.currency,
      budget: {
        totalMinor: total,
        usedMinor: spent,
        remainingMinor: total === null ? null : Math.max(0, total - spent),
        usedPct: total ? Math.round((spent / total) * 1000) / 10 : null,
      },
      uniqueCards: {
        used: snapshot.initialized ? snapshot.cards : null,
        max: campaign.maxUniqueCards,
      },
      redemptionsByStatus: counts,
      confirmRate: decided ? Math.round((settled / decided) * 1000) / 10 : null,
      daily: daily.map((d) => ({
        day: d.day,
        redemptions: Number(d.redemptions),
        discountMinor: Number(d.discount),
      })),
      topTerminals: topTerminals.map((t) => ({
        terminalId: t.terminalId,
        externalTerminalId: tid.get(t.terminalId) ?? null,
        redemptions: t._count,
        discountMinor: Number(t._sum.discountMinor ?? 0n),
      })),
    };
  }

  private async headroom(c: ActiveCampaign, now: Date): Promise<Headroom> {
    const [snapshot, day] = await Promise.all([
      this.counters.snapshot(c.rule.id),
      this.counters.dayUsage(c.rule.id, periodKey('DAY', now, c.rule.timezone)),
    ]);
    const l = c.limits;
    const left = (limit: number | null, used: number) =>
      limit === null ? null : Math.max(0, limit - used);
    return {
      budgetMinor: left(l.totalBudgetMinor, snapshot.spent),
      uniqueCards: left(l.maxUniqueCards, snapshot.cards),
      dailyBudgetMinor: left(l.dailyBudgetMinor, day.spent),
      dailyRedemptions: left(l.dailyRedemptionLimit, day.count),
    };
  }
}

/** Which cap would stop this discount (a new card is assumed for the unique-card cap). */
function cappedBy(h: Headroom, discountMinor: number): string | null {
  if (h.budgetMinor !== null && h.budgetMinor < discountMinor) return 'BUDGET_EXHAUSTED';
  if (h.uniqueCards !== null && h.uniqueCards < 1) return 'MAX_CARDS_REACHED';
  if (h.dailyBudgetMinor !== null && h.dailyBudgetMinor < discountMinor)
    return 'DAILY_BUDGET_EXHAUSTED';
  if (h.dailyRedemptions !== null && h.dailyRedemptions < 1) return 'DAILY_LIMIT_REACHED';
  return null;
}
