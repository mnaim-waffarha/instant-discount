import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type AlertSeverity, type User } from '@instant-discount/db';
import { periodKey } from '@instant-discount/rules-engine';
import { CAMPAIGNS_CHANGED_CHANNEL } from '../campaigns/campaign-cache.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { notFound } from '../common/api-error';
import { AuditService } from '../admin/common/audit.service';
import { CountersService } from '../counters/counters.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { MailerService } from '../mail/mailer.service';
import { MetricsService } from './metrics.service';
import { SettingsService } from './settings.service';

export interface RaiseInput {
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Same key = same condition; it alerts only once. */
  dedupeKey: string;
  campaignId?: string;
  terminalId?: string;
  data?: Prisma.InputJsonValue;
}

const bucket = (ms: number) => Math.floor(Date.now() / ms);

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    private readonly settings: SettingsService,
    private readonly counters: CountersService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Records the alert once per dedupe key and notifies (email to admins, Slack). */
  async raise(input: RaiseInput): Promise<boolean> {
    try {
      await this.prisma.alert.create({ data: input });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
    this.metrics.alerts.inc({ type: input.type, severity: input.severity });
    this.logger.warn(`[${input.severity}] ${input.title}: ${input.message}`);
    await this.notify(input).catch((err) =>
      this.logger.error(`Alert notification failed: ${String(err)}`),
    );
    return true;
  }

  async acknowledge(user: User, id: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw notFound('ALERT_NOT_FOUND', 'No such alert');
    return this.prisma.alert.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedBy: user.id, acknowledgedAt: new Date() },
    });
  }

  /** Runs every alert rule once. Called by the worker every minute. */
  async evaluate(): Promise<number> {
    const rules = [
      this.budgetRule,
      this.dailyCapRule,
      this.healthRule,
      this.expiryBacklogRule,
      this.cardVelocityRule,
      this.terminalSpikeRule,
      this.terminalCardsRule,
    ];
    let raised = 0;
    for (const rule of rules) {
      try {
        raised += await rule.call(this);
      } catch (err) {
        this.logger.error(`Alert rule ${rule.name} failed: ${String(err)}`);
      }
    }
    return raised;
  }

  private async budgetRule(): Promise<number> {
    const thresholds = [...this.settings.get().alerts.budgetThresholdsPct].sort((a, b) => a - b);
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: 'ACTIVE', totalBudgetMinor: { not: null } },
      select: { id: true, name: true, totalBudgetMinor: true, currency: true },
    });
    let raised = 0;
    for (const c of campaigns) {
      const snap = await this.counters.snapshot(c.id);
      if (!snap.initialized) continue;
      const pct = (snap.spent / Number(c.totalBudgetMinor)) * 100;
      for (const t of thresholds.filter((x) => pct >= x)) {
        const ok = await this.raise({
          type: 'BUDGET_THRESHOLD',
          severity: t >= 100 ? 'CRITICAL' : t >= 80 ? 'WARNING' : 'INFO',
          title: `${c.name}: ${t}% of budget used`,
          message: `${(snap.spent / 100).toFixed(2)} of ${(Number(c.totalBudgetMinor) / 100).toFixed(2)} ${c.currency} discount reserved or given.`,
          dedupeKey: `budget:${c.id}:${t}`,
          campaignId: c.id,
          data: { pct: Math.round(pct * 10) / 10, spentMinor: snap.spent },
        });
        if (ok) raised++;
      }
    }
    return raised;
  }

  private async dailyCapRule(): Promise<number> {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ dailyBudgetMinor: { not: null } }, { dailyRedemptionLimit: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        timezone: true,
        dailyBudgetMinor: true,
        dailyRedemptionLimit: true,
      },
    });
    let raised = 0;
    for (const c of campaigns) {
      const day = periodKey('DAY', new Date(), c.timezone);
      const usage = await this.counters.dayUsage(c.id, day);
      const budgetHit =
        c.dailyBudgetMinor !== null && usage.spent >= Number(c.dailyBudgetMinor) * 0.99;
      const countHit = c.dailyRedemptionLimit !== null && usage.count >= c.dailyRedemptionLimit;
      if (budgetHit || countHit) {
        const ok = await this.raise({
          type: 'DAILY_CAP_REACHED',
          severity: 'INFO',
          title: `${c.name}: daily limit reached`,
          message: `No more discounts from this campaign today (${day}); payments fall through to other campaigns.`,
          dedupeKey: `daily:${c.id}:${day}`,
          campaignId: c.id,
          data: usage,
        });
        if (ok) raised++;
      }
    }
    return raised;
  }

  /** Error rate (fail-open answers) and latency over the last 5 minutes. */
  private async healthRule(): Promise<number> {
    const a = this.settings.get().alerts;
    const [row] = await this.prisma.$queryRaw<
      Array<{ total: bigint; failed: bigint; p99: number | null }>
    >`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE reason = 'UNAVAILABLE') AS failed,
             percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs") AS p99
      FROM "InquiryLog" WHERE "createdAt" > now() - interval '5 minutes'`;
    const total = Number(row?.total ?? 0);
    if (total < a.minSampleSize) return 0;
    let raised = 0;
    const errorPct = (Number(row!.failed) / total) * 100;
    if (errorPct > a.errorRatePct) {
      raised += Number(
        await this.raise({
          type: 'ERROR_RATE',
          severity: 'CRITICAL',
          title: `${errorPct.toFixed(1)}% of inquiries failed open in the last 5 minutes`,
          message:
            'Payments are going through at full price. Check API, database and Redis health.',
          dedupeKey: `errors:${bucket(5 * 60_000)}`,
          data: { total, failed: Number(row!.failed) },
        }),
      );
    }
    if (row!.p99 !== null && row!.p99 > a.p99LatencyMs) {
      raised += Number(
        await this.raise({
          type: 'LATENCY',
          severity: 'WARNING',
          title: `Inquiry p99 latency ${Math.round(row!.p99)} ms`,
          message: `Above the ${a.p99LatencyMs} ms threshold; acquirers time out at about 800 ms and charge full price.`,
          dedupeKey: `latency:${bucket(5 * 60_000)}`,
          data: { p99: row!.p99, total },
        }),
      );
    }
    return raised;
  }

  private async expiryBacklogRule(): Promise<number> {
    const n = await this.prisma.redemption.count({
      where: { status: 'RESERVED', expiresAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    });
    if (n <= this.settings.get().alerts.expiryBacklog) return 0;
    return Number(
      await this.raise({
        type: 'EXPIRY_BACKLOG',
        severity: 'WARNING',
        title: `${n} expired reservations not released`,
        message: 'The worker is behind or down; their budget is still held.',
        dedupeKey: `expiry:${bucket(10 * 60_000)}`,
        data: { count: n },
      }),
    );
  }

  private async cardVelocityRule(): Promise<number> {
    const limit = this.settings.get().alerts.cardInquiriesPerHour;
    const rows = await this.prisma.$queryRaw<Array<{ card: string; n: bigint; bin: string }>>`
      SELECT "cardTokenHash" AS card, count(*) AS n, min(bin) AS bin
      FROM "InquiryLog"
      WHERE "createdAt" > now() - interval '1 hour' AND "cardTokenHash" IS NOT NULL
      GROUP BY 1 HAVING count(*) > ${limit}
      LIMIT 50`;
    let raised = 0;
    for (const r of rows) {
      const ok = await this.raise({
        type: 'FRAUD_CARD_VELOCITY',
        severity: 'WARNING',
        title: `One card made ${r.n} inquiries in an hour`,
        message: `BIN ${r.bin}. Could be a card being tested or a cashier repeating payments.`,
        dedupeKey: `card:${r.card}:${bucket(3_600_000)}`,
        data: { cardHashPrefix: r.card.slice(0, 12), bin: r.bin, inquiries: Number(r.n) },
      });
      if (ok) raised++;
    }
    return raised;
  }

  /** A terminal granting far more discounts than its usual hourly rate. */
  private async terminalSpikeRule(): Promise<number> {
    const a = this.settings.get().alerts;
    const rows = await this.prisma.$queryRaw<
      Array<{ terminal: string; tid: string; recent: bigint; baseline: number }>
    >`
      WITH recent AS (
        SELECT "terminalId", count(*) AS n FROM "Redemption"
        WHERE "createdAt" > now() - interval '1 hour' AND status NOT IN ('RELEASED', 'EXPIRED')
        GROUP BY 1
      ), base AS (
        SELECT "terminalId", count(*)::float / (7 * 24) AS per_hour FROM "Redemption"
        WHERE "createdAt" > now() - interval '8 days' AND "createdAt" <= now() - interval '1 hour'
        GROUP BY 1
      )
      SELECT r."terminalId" AS terminal, t."externalTerminalId" AS tid, r.n AS recent, COALESCE(b.per_hour, 0) AS baseline
      FROM recent r JOIN "Terminal" t ON t.id = r."terminalId" LEFT JOIN base b ON b."terminalId" = r."terminalId"
      WHERE r.n >= ${a.terminalSpikeMin} AND r.n > ${a.terminalSpikeFactor} * COALESCE(b.per_hour, 0)`;
    let raised = 0;
    for (const r of rows) {
      const ok = await this.raise({
        type: 'FRAUD_TERMINAL_SPIKE',
        severity: 'CRITICAL',
        title: `Terminal ${r.tid}: ${r.recent} discounts in the last hour`,
        message: `Usual rate is ${r.baseline.toFixed(1)} per hour.`,
        dedupeKey: `spike:${r.terminal}:${bucket(3_600_000)}`,
        terminalId: r.terminal,
        data: { recent: Number(r.recent), baselinePerHour: r.baseline },
      });
      if (ok) {
        raised++;
        await this.autoPause(r.terminal, 60, `fraud alert: terminal ${r.tid} spike`);
      }
    }
    return raised;
  }

  /** Many different cards on one terminal within minutes (card testing, skimming). */
  private async terminalCardsRule(): Promise<number> {
    const limit = this.settings.get().alerts.terminalCardsPer10Min;
    const rows = await this.prisma.$queryRaw<Array<{ terminal: string; cards: bigint }>>`
      SELECT "terminalId" AS terminal, count(DISTINCT "cardTokenHash") AS cards
      FROM "InquiryLog"
      WHERE "createdAt" > now() - interval '10 minutes' AND "terminalId" IS NOT NULL AND "cardTokenHash" IS NOT NULL
      GROUP BY 1 HAVING count(DISTINCT "cardTokenHash") > ${limit}`;
    let raised = 0;
    for (const r of rows) {
      const t = await this.prisma.terminal.findUnique({
        where: { id: r.terminal },
        select: { externalTerminalId: true },
      });
      const ok = await this.raise({
        type: 'FRAUD_TERMINAL_CARDS',
        severity: 'CRITICAL',
        title: `Terminal ${t?.externalTerminalId ?? r.terminal}: ${r.cards} different cards in 10 minutes`,
        message: 'Possible card testing. Check with the merchant and acquirer.',
        dedupeKey: `cards:${r.terminal}:${bucket(10 * 60_000)}`,
        terminalId: r.terminal,
        data: { cards: Number(r.cards) },
      });
      if (ok) {
        raised++;
        await this.autoPause(
          r.terminal,
          10,
          `fraud alert: many cards on terminal ${t?.externalTerminalId ?? r.terminal}`,
        );
      }
    }
    return raised;
  }

  /** Pauses campaigns that opted in and granted discounts on this terminal recently. */
  private async autoPause(terminalId: string, minutes: number, reason: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
        autoPauseOnFraud: true,
        redemptions: {
          some: { terminalId, createdAt: { gt: new Date(Date.now() - minutes * 60_000) } },
        },
      },
      select: { id: true, name: true },
    });
    for (const c of campaigns) {
      await this.prisma.campaign.update({
        where: { id: c.id },
        data: { status: 'PAUSED', pausedAt: new Date() },
      });
      await this.audit.record(
        null,
        'campaign.auto_pause',
        'Campaign',
        c.id,
        { status: 'ACTIVE' },
        { status: 'PAUSED', reason },
      );
      await this.redis.client.publish(CAMPAIGNS_CHANGED_CHANNEL, c.id);
      await this.raise({
        type: 'CAMPAIGN_AUTO_PAUSED',
        severity: 'CRITICAL',
        title: `${c.name} was paused automatically`,
        message: `Reason: ${reason}. Resume it from the campaign page once checked.`,
        dedupeKey: `autopause:${c.id}:${bucket(3_600_000)}`,
        campaignId: c.id,
      });
    }
  }

  private async notify(a: RaiseInput) {
    const text = `[${a.severity}] ${a.title}\n${a.message}`;
    if (this.config.SLACK_WEBHOOK_URL) {
      const res = await fetch(this.config.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) this.logger.error(`Slack webhook returned ${res.status}`);
    }
    if (a.severity === 'INFO') return; // email only what needs attention
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', active: true },
      select: { email: true },
    });
    for (const { email } of admins) {
      await this.mailer.send({
        to: email,
        subject: `Instant Discount alert: ${a.title}`,
        text: `${text}\n\n${this.config.WEB_BASE_URL}/admin/alerts\n`,
      });
    }
  }
}
