import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { notFound } from '../../common/api-error';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { ZodPipe } from '../../common/zod-pipe';
import { PrismaService } from '../../infra/prisma.service';
import { optionalQueryString, pageArgs, pageQuery, toPage } from '../common/pagination';

const redemptionQuery = pageQuery.extend({
  campaignId: optionalQueryString,
  status: z
    .enum(['RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'])
    .optional(),
  txnRef: optionalQueryString,
  bin: optionalQueryString,
  terminalId: optionalQueryString,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const reasonsQuery = z.object({
  campaignId: optionalQueryString,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@Controller('admin/v1')
@UseGuards(AdminAuthGuard)
export class ExplorerController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('redemptions')
  async redemptions(@Query(new ZodPipe(redemptionQuery)) q: z.infer<typeof redemptionQuery>) {
    const where = {
      campaignId: q.campaignId,
      status: q.status,
      acquirerTxnRef: q.txnRef,
      bin: q.bin,
      terminalId: q.terminalId,
      createdAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.redemption.findMany({
        where,
        include: {
          campaign: { select: { id: true, name: true } },
          terminal: {
            select: {
              id: true,
              externalTerminalId: true,
              merchant: { select: { id: true, name: true } },
            },
          },
          acquirer: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.redemption.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Get('redemptions/:id')
  async redemption(@Param('id') id: string) {
    const r = await this.prisma.redemption.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        campaign: { select: { id: true, name: true, currency: true } },
        terminal: { include: { merchant: { select: { id: true, name: true } }, branch: true } },
        acquirer: { select: { id: true, name: true } },
      },
    });
    if (!r) throw notFound('REDEMPTION_NOT_FOUND', 'No such redemption');
    return r;
  }

  /** Why inquiries did or did not get a discount, plus latency, over a period (default 24 h). */
  @Get('inquiries/summary')
  async inquirySummary(@Query(new ZodPipe(reasonsQuery)) q: z.infer<typeof reasonsQuery>) {
    const from = q.from ?? new Date(Date.now() - 86_400_000);
    const to = q.to ?? new Date();
    const where = { createdAt: { gte: from, lt: to }, campaignId: q.campaignId };
    const [reasons, latency] = await Promise.all([
      this.prisma.inquiryLog.groupBy({ by: ['eligible', 'reason'], where, _count: true }),
      this.prisma.$queryRaw<
        Array<{ total: bigint; p50: number | null; p95: number | null; p99: number | null }>
      >`
        SELECT count(*) AS total,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95,
               percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs") AS p99
        FROM "InquiryLog" WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`,
    ]);
    const l = latency[0];
    return {
      from,
      to,
      total: Number(l?.total ?? 0),
      granted: reasons.filter((r) => r.eligible).reduce((s, r) => s + r._count, 0),
      reasons: reasons
        .filter((r) => !r.eligible)
        .map((r) => ({ reason: r.reason, count: r._count }))
        .sort((a, b) => b.count - a.count),
      latencyMs: { p50: l?.p50 ?? null, p95: l?.p95 ?? null, p99: l?.p99 ?? null },
    };
  }
}
