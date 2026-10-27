import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Prisma, type User } from '@instant-discount/db';
import type { Response } from 'express';
import { z } from 'zod';
import { notFound } from '../common/api-error';
import { ZodPipe } from '../common/zod-pipe';
import { AdminAuthGuard, CurrentUser } from '../admin/auth/admin-auth.guard';
import { Roles } from '../admin/auth/roles';
import { pageQuery, toPage } from '../admin/common/pagination';
import { PrismaService } from '../infra/prisma.service';
import { sendDocument } from './settlement.controller';
import { SettlementService } from './settlement.service';

const VISIBLE_DOCS = ['ISSUED', 'OVERDUE', 'PAID'] as const;
const redemptionQuery = pageQuery.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

interface PortalRow {
  id: string;
  createdAt: Date;
  status: string;
  bin: string;
  currency: string;
  originalAmountMinor: bigint;
  discountMinor: bigint;
  refundedDiscountMinor: bigint;
  terminal: string;
  merchant: string;
  shareMinor: bigint | null;
}

/**
 * Read-only partner portal. Every query is scoped to the signed-in user's partner:
 * a funder sees the campaigns it funds; a merchant also sees campaigns running at its
 * terminals, but only the redemptions made there.
 */
@Controller('admin/v1/portal')
@UseGuards(AdminAuthGuard)
@Roles('PARTNER_USER')
export class PortalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: User) {
    return this.prisma.partner.findUniqueOrThrow({
      where: { id: user.partnerId! },
      select: { id: true, name: true, nameAr: true, type: true, country: true },
    });
  }

  @Get('campaigns')
  async campaigns(@CurrentUser() user: User) {
    const partnerId = user.partnerId!;
    const ids = await this.visibleCampaignIds(partnerId);
    if (!ids.length) return [];
    const [campaigns, stats] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          nameAr: true,
          status: true,
          currency: true,
          startAt: true,
          endAt: true,
          timezone: true,
          discountConfig: true,
          fundings: { where: { partnerId }, select: { shareBps: true } },
        },
        orderBy: { startAt: 'desc' },
      }),
      this.prisma.$queryRaw<
        Array<{
          campaignId: string;
          redemptions: bigint;
          discount: bigint | null;
          share: number | null;
        }>
      >`
        SELECT r."campaignId",
               count(*) AS redemptions,
               sum(r."discountMinor" - r."refundedDiscountMinor") AS discount,
               sum(${this.shareSql(partnerId)}) AS share
        FROM "Redemption" r
        JOIN "Terminal" t ON t.id = r."terminalId"
        JOIN "Merchant" m ON m.id = t."merchantId"
        WHERE r."campaignId" IN (${Prisma.join(ids)})
          AND r.status IN ('CONFIRMED', 'PARTIALLY_REFUNDED')
          AND ${this.rowVisibleSql(partnerId)}
        GROUP BY r."campaignId"`,
    ]);
    const byId = new Map(stats.map((s) => [s.campaignId, s]));
    return campaigns.map((c) => {
      const s = byId.get(c.id);
      return {
        ...c,
        shareBps: c.fundings[0]?.shareBps ?? 0,
        redemptions: Number(s?.redemptions ?? 0),
        discountMinor: Number(s?.discount ?? 0),
        partnerShareMinor: Math.round(Number(s?.share ?? 0)),
      };
    });
  }

  @Get('campaigns/:id/redemptions')
  async redemptions(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query(new ZodPipe(redemptionQuery)) q: z.infer<typeof redemptionQuery>,
  ) {
    await this.assertVisible(user.partnerId!, id);
    const where = this.rowsWhere(user.partnerId!, id, q.from, q.to);
    const [rows, count] = await Promise.all([
      this.rows(
        user.partnerId!,
        where,
        Prisma.sql`LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      ),
      this.prisma.$queryRaw<
        Array<{ n: bigint }>
      >`SELECT count(*) AS n FROM "Redemption" r JOIN "Terminal" t ON t.id = r."terminalId" JOIN "Merchant" m ON m.id = t."merchantId" WHERE ${where}`,
    ]);
    return toPage(rows.map(toPortalRow), Number(count[0]?.n ?? 0), q);
  }

  @Get('campaigns/:id/redemptions.csv')
  async redemptionsCsv(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    await this.assertVisible(user.partnerId!, id);
    const rows = (
      await this.rows(
        user.partnerId!,
        this.rowsWhere(user.partnerId!, id),
        Prisma.sql`LIMIT 100000`,
      )
    ).map(toPortalRow);
    const header =
      'date,merchant,terminal,bin,status,amount,discount,refunded_discount,your_share,currency';
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        csv(r.merchant),
        csv(r.terminal),
        r.bin,
        r.status,
        minor(r.originalAmountMinor),
        minor(r.discountMinor),
        minor(r.refundedDiscountMinor),
        minor(r.partnerShareMinor),
        r.currency,
      ].join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="redemptions-${id.slice(0, 8)}.csv"`,
    );
    res.send([header, ...lines].join('\n') + '\n');
  }

  @Get('documents')
  async documents(
    @CurrentUser() user: User,
    @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>,
  ) {
    const where = { partnerId: user.partnerId!, status: { in: [...VISIBLE_DOCS] } };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { periodStart: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Get('documents/:id/pdf')
  documentPdf(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    return this.document(user, id, 'pdf', res);
  }

  @Get('documents/:id/csv')
  documentCsv(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    return this.document(user, id, 'csv', res);
  }

  private async document(user: User, id: string, format: 'pdf' | 'csv', res: Response) {
    const doc = await this.settlement.get(id).catch(() => null);
    if (
      !doc ||
      doc.partnerId !== user.partnerId ||
      !(VISIBLE_DOCS as readonly string[]).includes(doc.status)
    ) {
      throw notFound('DOCUMENT_NOT_FOUND', 'No such document');
    }
    await sendDocument(res, doc, format);
  }

  /** Campaigns the partner funds, plus (for merchants) campaigns that targeted its merchants. */
  private async visibleCampaignIds(partnerId: string): Promise<string[]> {
    const merchants = await this.prisma.merchant.findMany({
      where: { partnerId },
      select: { id: true },
    });
    const rows = await this.prisma.campaign.findMany({
      where: {
        status: { notIn: ['DRAFT', 'PENDING_APPROVAL'] },
        OR: [
          { fundings: { some: { partnerId } } },
          ...merchants.map((m) => ({
            targeting: { path: ['merchantIds'], array_contains: [m.id] },
          })),
          { redemptions: { some: { terminal: { merchant: { partnerId } } } } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async assertVisible(partnerId: string, campaignId: string) {
    if (!(await this.visibleCampaignIds(partnerId)).includes(campaignId))
      throw notFound('CAMPAIGN_NOT_FOUND', 'No such campaign');
  }

  /** A funder sees every redemption of the campaign; a non-funding merchant only its own. */
  private rowVisibleSql(partnerId: string) {
    return Prisma.sql`(m."partnerId" = ${partnerId} OR EXISTS (SELECT 1 FROM jsonb_array_elements(r."fundingSnapshot") f WHERE f->>'partnerId' = ${partnerId}))`;
  }

  /** The partner's share of a redemption, net of refunds (refunds reverse shares proportionally). */
  private shareSql(partnerId: string) {
    return Prisma.sql`COALESCE((SELECT (f->>'amountMinor')::numeric FROM jsonb_array_elements(r."fundingSnapshot") f WHERE f->>'partnerId' = ${partnerId}), 0)
      * (1 - r."refundedDiscountMinor"::numeric / NULLIF(r."discountMinor", 0))`;
  }

  private rowsWhere(partnerId: string, campaignId: string, from?: Date, to?: Date) {
    return Prisma.sql`r."campaignId" = ${campaignId}
      AND r.status IN ('CONFIRMED', 'PARTIALLY_REFUNDED', 'REFUNDED')
      AND ${this.rowVisibleSql(partnerId)}
      ${from ? Prisma.sql`AND r."createdAt" >= ${from}` : Prisma.empty}
      ${to ? Prisma.sql`AND r."createdAt" < ${to}` : Prisma.empty}`;
  }

  private rows(partnerId: string, where: Prisma.Sql, limit: Prisma.Sql) {
    return this.prisma.$queryRaw<PortalRow[]>`
      SELECT r.id, r."createdAt", r.status, r.bin, r.currency::text AS currency, r."originalAmountMinor", r."discountMinor", r."refundedDiscountMinor",
             t."externalTerminalId" AS terminal, m.name AS merchant,
             round(${this.shareSql(partnerId)})::bigint AS "shareMinor"
      FROM "Redemption" r
      JOIN "Terminal" t ON t.id = r."terminalId"
      JOIN "Merchant" m ON m.id = t."merchantId"
      WHERE ${where}
      ORDER BY r."createdAt" DESC
      ${limit}`;
  }
}

function toPortalRow(r: PortalRow) {
  return {
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    bin: r.bin,
    currency: r.currency,
    merchant: r.merchant,
    terminal: r.terminal,
    originalAmountMinor: Number(r.originalAmountMinor),
    discountMinor: Number(r.discountMinor),
    refundedDiscountMinor: Number(r.refundedDiscountMinor),
    partnerShareMinor: Number(r.shareMinor ?? 0),
  };
}

const minor = (v: number) => (v / 100).toFixed(2);
const csv = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
