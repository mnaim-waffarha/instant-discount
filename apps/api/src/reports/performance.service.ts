import { Injectable } from '@nestjs/common';
import { Prisma } from '@instant-discount/db';
import { HOLDOUT } from '@instant-discount/rules-engine';
import { notFound } from '../common/api-error';
import { PrismaService } from '../infra/prisma.service';
import { compare, type Comparison } from './stats';

/** Below this many cards in a group, results are shown but no verdict is drawn. */
export const MIN_CARDS_PER_GROUP = 100;

export interface GroupMetrics {
  group: string;
  cards: number;
  payments: number;
  spendMinor: number;
  spendPerCardMinor: number;
  /** 95% confidence interval of the group's mean spend per card. */
  spendPerCardCi95: [number, number] | null;
  avgBasketMinor: number;
  paymentsPerCard: number;
  repeatRatePct: number;
  discountMinor: number;
  costPerPaymentMinor: number | null;
}

export interface Uplift {
  group: string;
  vsHoldout:
    | (Comparison & {
        incrementalSpendMinor: number;
        incrementalCi95: [number, number];
        roi: number | null;
      })
    | null;
  vsControl: Comparison | null;
}

export interface PerformanceReport {
  campaignId: string;
  currency: string;
  from: Date;
  to: Date;
  holdoutBps: number;
  variants: Array<{ key: string; name: string; weightBps: number }>;
  groups: GroupMetrics[];
  uplift: Uplift[];
  enoughData: boolean;
  minCardsPerGroup: number;
  /** Variant with the best significant net return (incremental spend − discount cost), if any. */
  winner: string | null;
}

interface PerCardRow {
  group: string;
  cards: bigint;
  payments: bigint;
  spend: bigint | null;
  mean: number | null;
  variance: number | null;
  repeat_cards: bigint;
}

/**
 * Campaign performance from exposures (intent to treat: every card the campaign reached, by
 * group). A payment counts unless it was declined (redemption cancelled); holdout payments and
 * reservations that expired after a timeout count at full price, as that is what was charged.
 */
@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    campaignId: string,
    opts: { from?: Date; to?: Date; merchantPartnerId?: string } = {},
  ): Promise<PerformanceReport> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { variants: { orderBy: { key: 'asc' } } },
    });
    if (!campaign) throw notFound('CAMPAIGN_NOT_FOUND', 'No such campaign');
    const from = opts.from ?? campaign.startAt;
    const to = opts.to ?? new Date();
    const merchant = opts.merchantPartnerId
      ? Prisma.sql`AND e."merchantPartnerId" = ${opts.merchantPartnerId}`
      : Prisma.empty;

    const [perGroup, costs] = await Promise.all([
      this.prisma.$queryRaw<PerCardRow[]>`
        WITH counted AS (
          SELECT e."group", e."cardTokenHash", e."amountMinor"
          FROM "CampaignExposure" e
          LEFT JOIN "Redemption" r ON r.id = e."redemptionId"
          WHERE e."campaignId" = ${campaignId}
            AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
            AND (r.id IS NULL OR r.status <> 'RELEASED')
            ${merchant}
        ), per_card AS (
          SELECT "group", "cardTokenHash", count(*) AS payments, sum("amountMinor") AS spend
          FROM counted GROUP BY 1, 2
        )
        SELECT "group",
               count(*) AS cards,
               sum(payments) AS payments,
               sum(spend) AS spend,
               avg(spend)::float8 AS mean,
               coalesce(var_samp(spend), 0)::float8 AS variance,
               count(*) FILTER (WHERE payments >= 2) AS repeat_cards
        FROM per_card GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ group: string; discount: bigint | null }>>`
        SELECT coalesce(r."variantKey", 'A') AS "group", sum(r."discountMinor" - r."refundedDiscountMinor") AS discount
        FROM "Redemption" r
        JOIN "Terminal" t ON t.id = r."terminalId"
        JOIN "Merchant" m ON m.id = t."merchantId"
        WHERE r."campaignId" = ${campaignId}
          AND r.status IN ('CONFIRMED', 'PARTIALLY_REFUNDED', 'REFUNDED')
          AND r."createdAt" >= ${from} AND r."createdAt" < ${to}
          ${opts.merchantPartnerId ? Prisma.sql`AND m."partnerId" = ${opts.merchantPartnerId}` : Prisma.empty}
        GROUP BY 1`,
    ]);

    const cost = new Map(costs.map((c) => [c.group, Number(c.discount ?? 0)]));
    const order = [
      HOLDOUT,
      ...(campaign.variants.length ? campaign.variants.map((v) => v.key) : ['A']),
    ];
    const rows = new Map(perGroup.map((r) => [r.group, r]));
    const groups: GroupMetrics[] = order
      .filter((g) => g !== HOLDOUT || campaign.holdoutBps > 0 || rows.has(HOLDOUT))
      .map((group) => {
        const r = rows.get(group);
        const cards = Number(r?.cards ?? 0);
        const payments = Number(r?.payments ?? 0);
        const spend = Number(r?.spend ?? 0);
        const discount = group === HOLDOUT ? 0 : (cost.get(group) ?? 0);
        return {
          group,
          cards,
          payments,
          spendMinor: spend,
          spendPerCardMinor: cards ? Math.round(spend / cards) : 0,
          spendPerCardCi95: cards >= 2 ? ciOfMean(r!.mean ?? 0, r!.variance ?? 0, cards) : null,
          avgBasketMinor: payments ? Math.round(spend / payments) : 0,
          paymentsPerCard: cards ? Math.round((payments / cards) * 100) / 100 : 0,
          repeatRatePct: cards ? Math.round((Number(r?.repeat_cards ?? 0) / cards) * 1000) / 10 : 0,
          discountMinor: discount,
          costPerPaymentMinor:
            group === HOLDOUT || !payments ? null : Math.round(discount / payments),
        };
      });

    const sample = (g: string) => {
      const r = rows.get(g);
      return r ? { n: Number(r.cards), mean: r.mean ?? 0, variance: r.variance ?? 0 } : null;
    };
    const holdout = sample(HOLDOUT);
    const control = sample('A');
    const treatedGroups = groups.filter((g) => g.group !== HOLDOUT);
    const uplift: Uplift[] = treatedGroups.map((g) => {
      const s = sample(g.group);
      const vsH = s && holdout ? compare(s, holdout) : null;
      return {
        group: g.group,
        vsHoldout: vsH && {
          ...vsH,
          // Extra spend the discount brought, scaled to the cards that got it.
          incrementalSpendMinor: Math.round(vsH.diff * g.cards),
          incrementalCi95: [Math.round(vsH.ci95[0] * g.cards), Math.round(vsH.ci95[1] * g.cards)],
          roi: g.discountMinor
            ? Math.round(((vsH.diff * g.cards) / g.discountMinor) * 100) / 100
            : null,
        },
        vsControl: g.group !== 'A' && s && control ? compare(s, control) : null,
      };
    });

    const enoughData = groups.every((g) => g.cards >= MIN_CARDS_PER_GROUP);
    const candidates = uplift
      .filter((u) => u.vsHoldout?.significant && u.vsHoldout.diff > 0)
      .map((u) => ({
        group: u.group,
        net:
          u.vsHoldout!.incrementalSpendMinor -
          (treatedGroups.find((g) => g.group === u.group)?.discountMinor ?? 0),
      }))
      .sort((a, b) => b.net - a.net);
    const winner =
      enoughData && campaign.variants.length > 1 && candidates.length ? candidates[0]!.group : null;

    return {
      campaignId,
      currency: campaign.currency,
      from,
      to,
      holdoutBps: campaign.holdoutBps,
      variants: campaign.variants.map((v) => ({
        key: v.key,
        name: v.name,
        weightBps: v.weightBps,
      })),
      groups,
      uplift,
      enoughData,
      minCardsPerGroup: MIN_CARDS_PER_GROUP,
      winner,
    };
  }

  toCsv(r: PerformanceReport): string {
    const head =
      'group,cards,payments,spend,spend_per_card,avg_basket,payments_per_card,repeat_rate_pct,discount,cost_per_payment,uplift_per_card,uplift_ci_low,uplift_ci_high,uplift_pct,p_value,incremental_spend,roi';
    const m = (v: number | null | undefined) =>
      v === null || v === undefined ? '' : (v / 100).toFixed(2);
    const lines = r.groups.map((g) => {
      const u = r.uplift.find((x) => x.group === g.group)?.vsHoldout;
      return [
        g.group,
        g.cards,
        g.payments,
        m(g.spendMinor),
        m(g.spendPerCardMinor),
        m(g.avgBasketMinor),
        g.paymentsPerCard,
        g.repeatRatePct,
        m(g.discountMinor),
        m(g.costPerPaymentMinor),
        m(u?.diff),
        m(u?.ci95[0]),
        m(u?.ci95[1]),
        u?.relative == null ? '' : (u.relative * 100).toFixed(1),
        u ? u.pValue.toFixed(4) : '',
        m(u?.incrementalSpendMinor),
        u?.roi ?? '',
      ].join(',');
    });
    return [head, ...lines].join('\n') + '\n';
  }
}

function ciOfMean(mean: number, variance: number, n: number): [number, number] {
  const half = 1.959964 * Math.sqrt(variance / n);
  return [Math.round(mean - half), Math.round(mean + half)];
}
