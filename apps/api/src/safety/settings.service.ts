import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma, User } from '@instant-discount/db';
import { z } from 'zod';
import { AuditService } from '../admin/common/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

export const SETTINGS_CHANGED_CHANNEL = 'settings:changed';
const KEY = 'safety';
const REFRESH_MS = 5_000;

const nullablePositive = z.number().int().positive().nullable();

const alertThresholds = z.object({
  budgetThresholdsPct: z.array(z.number().int().min(1).max(100)),
  errorRatePct: z.number().min(0).max(100),
  p99LatencyMs: z.number().int().positive(),
  minSampleSize: z.number().int().positive(),
  cardInquiriesPerHour: z.number().int().positive(),
  terminalSpikeFactor: z.number().positive(),
  terminalSpikeMin: z.number().int().positive(),
  terminalCardsPer10Min: z.number().int().positive(),
  expiryBacklog: z.number().int().positive(),
});
const defaultAlerts: z.infer<typeof alertThresholds> = {
  budgetThresholdsPct: [50, 80, 100],
  errorRatePct: 5,
  p99LatencyMs: 500,
  minSampleSize: 20,
  cardInquiriesPerHour: 15,
  terminalSpikeFactor: 5,
  terminalSpikeMin: 20,
  terminalCardsPer10Min: 40,
  expiryBacklog: 100,
};
const discountCaps = z.object({ EGP: nullablePositive, SAR: nullablePositive });

export const safetySchema = z.object({
  killSwitch: z
    .object({
      enabled: z.boolean(),
      reason: z.string().max(500).optional(),
      by: z.string().optional(),
      at: z.string().optional(),
    })
    .default({ enabled: false }),
  /** Hard cap on any single discount, applied after campaign rules (guards against misconfiguration). */
  maxDiscountPerTxnMinor: discountCaps.default({ EGP: 100_000, SAR: 10_000 }),
  /** Discounts one card may receive per hour across all campaigns. */
  cardVelocity: z.object({ maxGrantsPerHour: nullablePositive }).default({ maxGrantsPerHour: 6 }),
  alerts: alertThresholds
    .partial()
    .transform((a) => ({ ...defaultAlerts, ...a }))
    .default({}),
});
export type SafetySettings = z.infer<typeof safetySchema>;

/** Nested partial update; the kill switch is set through its own endpoint. */
export const safetyUpdateSchema = z
  .object({
    maxDiscountPerTxnMinor: discountCaps.partial().optional(),
    cardVelocity: z.object({ maxGrantsPerHour: nullablePositive }).partial().optional(),
    alerts: alertThresholds.partial().optional(),
  })
  .strict();
export type SafetyPatch = z.infer<typeof safetyUpdateSchema> & {
  killSwitch?: SafetySettings['killSwitch'];
};

/**
 * Runtime safety settings. Every instance keeps a copy in memory (refreshed every few seconds
 * and immediately on change), so the kill switch and guardrails cost nothing per payment.
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private current: SafetySettings = safetySchema.parse({});
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
    await this.redis.subscriber.subscribe(SETTINGS_CHANGED_CHANNEL);
    this.redis.subscriber.on('message', (channel) => {
      if (channel === SETTINGS_CHANGED_CHANNEL) void this.refresh();
    });
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  get(): SafetySettings {
    return this.current;
  }

  async refresh(): Promise<void> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
      this.current = safetySchema.parse(row?.value ?? {});
    } catch (err) {
      // Keep the last good copy; a broken settings row must not take payments down.
      this.logger.error(`Settings refresh failed: ${String(err)}`);
    }
  }

  async update(
    user: Pick<User, 'id' | 'email'> | null,
    patch: SafetyPatch,
  ): Promise<SafetySettings> {
    await this.refresh();
    const before = this.current;
    const next = safetySchema.parse(merge(before, patch));
    await this.prisma.setting.upsert({
      where: { key: KEY },
      update: { value: next as unknown as Prisma.InputJsonValue, updatedBy: user?.id },
      create: { key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedBy: user?.id },
    });
    this.current = next;
    await this.redis.client.publish(SETTINGS_CHANGED_CHANNEL, '1');
    await this.audit.record(user, 'settings.update', 'Setting', KEY, before, next);
    return next;
  }
}

function merge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (
    Array.isArray(patch) ||
    typeof patch !== 'object' ||
    patch === null ||
    typeof base !== 'object' ||
    base === null
  )
    return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch))
    out[k] = merge((base as Record<string, unknown>)[k], v);
  return out as T;
}
