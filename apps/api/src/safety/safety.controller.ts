import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@instant-discount/db';
import type { Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config';
import { unauthorized } from '../common/api-error';
import { ZodPipe } from '../common/zod-pipe';
import { AdminAuthGuard, CurrentUser } from '../admin/auth/admin-auth.guard';
import { Roles } from '../admin/auth/roles';
import { pageArgs, pageQuery, toPage } from '../admin/common/pagination';
import { PrismaService } from '../infra/prisma.service';
import { AlertsService } from './alerts.service';
import { MetricsService } from './metrics.service';
import { SettingsService, safetyUpdateSchema } from './settings.service';

const killInput = z.object({ enabled: z.boolean(), reason: z.string().min(1).max(500) });
const alertQuery = pageQuery.extend({ status: z.enum(['OPEN', 'ACKNOWLEDGED']).optional() });

@Controller('admin/v1')
@UseGuards(AdminAuthGuard)
export class SafetyController {
  constructor(
    private readonly settings: SettingsService,
    private readonly alerts: AlertsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('safety')
  get() {
    return this.settings.get();
  }

  @Roles('ADMIN')
  @Put('safety')
  update(
    @CurrentUser() user: User,
    @Body(new ZodPipe(safetyUpdateSchema)) body: z.infer<typeof safetyUpdateSchema>,
  ) {
    return this.settings.update(user, body);
  }

  /** Stops every discount everywhere within seconds. Payments carry on at full price. */
  @Roles('ADMIN')
  @Post('safety/kill-switch')
  @HttpCode(200)
  async killSwitch(
    @CurrentUser() user: User,
    @Body(new ZodPipe(killInput)) body: z.infer<typeof killInput>,
  ) {
    const next = await this.settings.update(user, {
      killSwitch: {
        enabled: body.enabled,
        reason: body.reason,
        by: user.email,
        at: new Date().toISOString(),
      },
    });
    await this.alerts.raise({
      type: 'KILL_SWITCH',
      severity: 'CRITICAL',
      title: body.enabled
        ? `Kill switch turned ON by ${user.email}`
        : `Kill switch turned off by ${user.email}`,
      message: body.enabled
        ? `All discounts are stopped. Reason: ${body.reason}`
        : `Discounts are running again. Note: ${body.reason}`,
      dedupeKey: `kill:${Date.now()}`,
    });
    return next;
  }

  @Get('alerts')
  async list(@Query(new ZodPipe(alertQuery)) q: z.infer<typeof alertQuery>) {
    const where = { status: q.status };
    const [items, total] = await Promise.all([
      this.prisma.alert.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.alert.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Roles('ADMIN', 'CAMPAIGN_MANAGER', 'APPROVER', 'FINANCE')
  @Post('alerts/:id/acknowledge')
  @HttpCode(200)
  acknowledge(@CurrentUser() user: User, @Param('id') id: string) {
    return this.alerts.acknowledge(user, id);
  }
}

/** Prometheus scrape endpoint; protect with METRICS_TOKEN or keep it on the internal network. */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    if (this.config.METRICS_TOKEN && auth !== `Bearer ${this.config.METRICS_TOKEN}`)
      throw unauthorized('Metrics token required');
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
