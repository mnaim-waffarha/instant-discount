import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@instant-discount/db';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-pipe';
import { AdminAuthGuard, CurrentUser } from '../admin/auth/admin-auth.guard';
import { Roles } from '../admin/auth/roles';
import { AuditService } from '../admin/common/audit.service';
import { optionalQueryString, pageArgs, pageQuery, toPage } from '../admin/common/pagination';
import { PrismaService } from '../infra/prisma.service';
import { renderDocumentCsv, renderDocumentPdf, type DocumentWithLines } from './render';
import { SettlementService } from './settlement.service';

const FINANCE = ['ADMIN', 'FINANCE'] as const;
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM');
const country = z.enum(['EG', 'SA']);
const runInput = z.object({ country, period });
const overviewQuery = z.object({ country, period });
const docQuery = pageQuery.extend({
  country: country.optional(),
  period: period.optional(),
  status: z.enum(['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID']).optional(),
  type: z.enum(['INVOICE', 'PAYOUT_STATEMENT', 'STATEMENT']).optional(),
  partnerId: optionalQueryString,
});
const paidInput = z.object({
  paidAt: z.coerce.date().default(() => new Date()),
  reference: z.string().max(100).optional(),
});
const voidInput = z.object({ reason: z.string().min(1).max(500) });
const taxInput = z.object({
  country,
  rateBps: z.number().int().min(0).max(5_000),
  validFrom: z.coerce.date(),
});

export function sendDocument(res: Response, doc: DocumentWithLines, format: 'pdf' | 'csv') {
  const name = doc.number ?? `DRAFT-${doc.id.slice(0, 8)}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.send(renderDocumentCsv(doc));
    return;
  }
  return renderDocumentPdf(doc).then((pdf) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.send(pdf);
  });
}

@Controller('admin/v1')
@UseGuards(AdminAuthGuard)
export class SettlementController {
  constructor(
    private readonly settlement: SettlementService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('settlements/overview')
  overview(@Query(new ZodPipe(overviewQuery)) q: z.infer<typeof overviewQuery>) {
    return this.settlement.overview(q.country, q.period);
  }

  @Roles(...FINANCE)
  @Post('settlements/run')
  @HttpCode(200)
  run(@Body(new ZodPipe(runInput)) body: z.infer<typeof runInput>) {
    return this.settlement.generate(body.country, body.period);
  }

  @Get('documents')
  async list(@Query(new ZodPipe(docQuery)) q: z.infer<typeof docQuery>) {
    let periodStart: Date | undefined;
    if (q.period && q.country) {
      const { monthBounds, COUNTRY_DEFAULTS } = await import('@instant-discount/shared');
      periodStart = monthBounds(q.period, COUNTRY_DEFAULTS[q.country].timezone).start;
    }
    const where = {
      country: q.country,
      status: q.status,
      type: q.type,
      partnerId: q.partnerId,
      periodStart,
    };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { partner: { select: { id: true, name: true, type: true } } },
        orderBy: [{ periodStart: 'desc' }, { type: 'asc' }, { createdAt: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Get('documents/:id')
  get(@Param('id') id: string) {
    return this.settlement.get(id);
  }

  @Get('documents/:id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    await sendDocument(res, await this.settlement.get(id), 'pdf');
  }

  @Get('documents/:id/csv')
  async csv(@Param('id') id: string, @Res() res: Response) {
    await sendDocument(res, await this.settlement.get(id), 'csv');
  }

  @Roles(...FINANCE)
  @Post('documents/:id/issue')
  @HttpCode(200)
  issue(@CurrentUser() user: User, @Param('id') id: string) {
    return this.settlement.issue(user, id);
  }

  @Roles(...FINANCE)
  @Post('documents/:id/paid')
  @HttpCode(200)
  paid(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(paidInput)) body: z.infer<typeof paidInput>,
  ) {
    return this.settlement.markPaid(user, id, body.paidAt, body.reference);
  }

  @Roles(...FINANCE)
  @Post('documents/:id/void')
  @HttpCode(200)
  void(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(voidInput)) body: z.infer<typeof voidInput>,
  ) {
    return this.settlement.void(user, id, body.reason);
  }

  @Get('tax-rates')
  taxRates() {
    return this.prisma.taxRate.findMany({ orderBy: [{ country: 'asc' }, { validFrom: 'desc' }] });
  }

  @Roles(...FINANCE)
  @Post('tax-rates')
  async addTaxRate(
    @CurrentUser() user: User,
    @Body(new ZodPipe(taxInput)) body: z.infer<typeof taxInput>,
  ) {
    const rate = await this.prisma.taxRate.upsert({
      where: { country_validFrom: { country: body.country, validFrom: body.validFrom } },
      update: { rateBps: body.rateBps },
      create: body,
    });
    await this.audit.record(user, 'tax_rate.set', 'TaxRate', rate.id, undefined, rate);
    return rate;
  }
}
