import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { User } from '@instant-discount/db';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod-pipe';
import { PrismaService } from '../../infra/prisma.service';
import { AdminAuthGuard, CurrentUser } from '../auth/admin-auth.guard';
import { APPROVERS, EDITORS, Roles } from '../auth/roles';
import { optionalQueryString, pageArgs, pageQuery, toPage } from '../common/pagination';
import { campaignInput, type CampaignInput } from './campaign-input';
import { CampaignsService } from './campaigns.service';
import { CampaignInsightsService, type SimulateInput } from './insights.service';
import { PerformanceService } from '../../reports/performance.service';

const status = z.enum(['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED']);
const listQuery = pageQuery.extend({
  status: status.optional(),
  country: z.enum(['EG', 'SA']).optional(),
  q: optionalQueryString,
  /** Campaigns waiting for a decision: submitted ones and live ones with pending changes. */
  awaitingApproval: z.enum(['true', 'false']).optional(),
});
const rejectInput = z.object({ reason: z.string().min(1).max(500) });
const periodQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const simulateInput = z.object({
  terminalId: z.string().uuid(),
  bin: z.string().regex(/^\d{6,8}$/),
  scheme: z.enum(['VISA', 'MASTERCARD', 'MEEZA', 'MADA', 'AMEX']),
  amountMinor: z.number().int().positive(),
  at: z.coerce.date().optional(),
  includeInactive: z.boolean().default(true),
  cardToken: z.string().min(8).max(256).optional(),
});

@Controller('admin/v1/campaigns')
@UseGuards(AdminAuthGuard)
export class CampaignsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly insights: CampaignInsightsService,
    private readonly performance: PerformanceService,
  ) {}

  /** Uplift vs holdout and A/B comparison; `from`/`to` limit the window (e.g. after a change). */
  @Get(':id/performance')
  performanceReport(
    @Param('id') id: string,
    @Query(new ZodPipe(periodQuery)) q: z.infer<typeof periodQuery>,
  ) {
    return this.performance.report(id, q);
  }

  @Get(':id/performance.csv')
  async performanceCsv(
    @Param('id') id: string,
    @Query(new ZodPipe(periodQuery)) q: z.infer<typeof periodQuery>,
    @Res() res: Response,
  ) {
    const report = await this.performance.report(id, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="performance-${id.slice(0, 8)}.csv"`,
    );
    res.send(this.performance.toCsv(report));
  }

  @Get()
  async list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where = {
      status: q.status,
      country: q.country,
      name: q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined,
      ...(q.awaitingApproval === 'true'
        ? {
            OR: [
              { status: 'PENDING_APPROVAL' as const },
              { pendingChanges: { not: { equals: null } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: {
          fundings: { include: { partner: { select: { id: true, name: true, type: true } } } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    await this.campaigns.get(id);
    return this.prisma.campaign.findUniqueOrThrow({
      where: { id },
      include: {
        fundings: { include: { partner: { select: { id: true, name: true, type: true } } } },
        versions: { select: { version: true, createdAt: true }, orderBy: { version: 'desc' } },
        variants: { orderBy: { key: 'asc' } },
      },
    });
  }

  @Get(':id/versions/:version')
  async version(@Param('id') id: string, @Param('version') version: string) {
    return this.prisma.campaignVersion.findUniqueOrThrow({
      where: { campaignId_version: { campaignId: id, version: Number(version) } },
    });
  }

  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.insights.stats(id);
  }

  @Roles(...EDITORS)
  @Post()
  create(@CurrentUser() user: User, @Body(new ZodPipe(campaignInput)) body: CampaignInput) {
    return this.campaigns.create(user, body);
  }

  @Roles(...EDITORS)
  @Put(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(campaignInput)) body: CampaignInput,
  ) {
    return this.campaigns.update(user, id, body);
  }

  @Roles(...EDITORS)
  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: User, @Param('id') id: string) {
    return this.campaigns.submit(user, id);
  }

  @Roles(...EDITORS)
  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: User, @Param('id') id: string) {
    return this.campaigns.withdraw(user, id);
  }

  @Roles(...APPROVERS)
  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: User, @Param('id') id: string) {
    return this.campaigns.approve(user, id);
  }

  @Roles(...APPROVERS)
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(rejectInput)) body: z.infer<typeof rejectInput>,
  ) {
    return this.campaigns.reject(user, id, body.reason);
  }

  /** Emergency controls are open to editors and approvers alike. */
  @Roles(...EDITORS, 'APPROVER')
  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentUser() user: User, @Param('id') id: string) {
    return this.campaigns.pause(user, id);
  }

  @Roles(...EDITORS, 'APPROVER')
  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentUser() user: User, @Param('id') id: string) {
    return this.campaigns.resume(user, id);
  }

  @Roles(...EDITORS, 'APPROVER')
  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() user: User, @Param('id') id: string) {
    return this.campaigns.end(user, id);
  }

  @Roles(...EDITORS)
  @Post(':id/clone')
  clone(@CurrentUser() user: User, @Param('id') id: string) {
    return this.campaigns.clone(user, id);
  }
}

@Controller('admin/v1/simulate')
@UseGuards(AdminAuthGuard)
export class SimulatorController {
  constructor(private readonly insights: CampaignInsightsService) {}

  @Post()
  @HttpCode(200)
  simulate(@Body(new ZodPipe(simulateInput)) body: SimulateInput) {
    return this.insights.simulate(body);
  }
}
