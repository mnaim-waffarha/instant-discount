import { Prisma } from '@instant-discount/db';
import {
  discountConfigSchema,
  scheduleSchema,
  targetingSchema,
} from '@instant-discount/rules-engine';
import { COUNTRY_DEFAULTS } from '@instant-discount/shared';
import { z } from 'zod';
import { unprocessable } from '../../common/api-error';
import type { PrismaService } from '../../infra/prisma.service';

const minor = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

export const limitsSchema = z
  .object({
    totalBudgetMinor: minor.nullable().optional(),
    maxUniqueCards: positiveInt.nullable().optional(),
    dailyBudgetMinor: minor.nullable().optional(),
    dailyRedemptionLimit: positiveInt.nullable().optional(),
    perCardMaxCount: positiveInt.nullable().optional(),
    perCardMaxAmountMinor: minor.nullable().optional(),
    perCardPeriod: z.enum(['DAY', 'WEEK', 'CAMPAIGN']).default('CAMPAIGN'),
  })
  .default({});

export const campaignInput = z
  .object({
    name: z.string().min(1).max(200),
    nameAr: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    country: z.enum(['EG', 'SA']),
    currency: z.enum(['EGP', 'SAR']),
    timezone: z.string().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    priority: z.number().int().min(0).max(1000).default(0),
    discount: discountConfigSchema,
    targeting: targetingSchema.default({}),
    schedule: scheduleSchema.nullable().optional(),
    displayMessage: z.string().max(120).optional(),
    displayMessageAr: z.string().max(120).optional(),
    limits: limitsSchema,
    fundings: z
      .array(
        z.object({ partnerId: z.string().uuid(), shareBps: z.number().int().min(1).max(10_000) }),
      )
      .min(1),
    settlementMode: z.enum(['WAFFARHA_COLLECTS', 'DIRECT']).default('WAFFARHA_COLLECTS'),
    autoPauseOnFraud: z.boolean().default(false),
  })
  .transform((c) => ({ ...c, timezone: c.timezone ?? COUNTRY_DEFAULTS[c.country].timezone }));

export type CampaignInput = z.infer<typeof campaignInput>;

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Business rules that need the database. Throws 422 listing every problem found. */
export async function validateCampaign(prisma: PrismaService, c: CampaignInput): Promise<void> {
  const problems: string[] = [];
  if (COUNTRY_DEFAULTS[c.country].currency !== c.currency)
    problems.push(`currency must be ${COUNTRY_DEFAULTS[c.country].currency} for ${c.country}`);
  if (!isValidTimezone(c.timezone)) problems.push(`unknown timezone ${c.timezone}`);
  if (c.endAt <= c.startAt) problems.push('endAt must be after startAt');

  if (c.discount.type === 'TIERED') {
    const mins = c.discount.tiers.map((t) => t.minSpendMinor);
    if (new Set(mins).size !== mins.length)
      problems.push('tiers must have distinct minSpendMinor values');
  }

  // Funding: shares sum to 100%, partners exist in the campaign's country.
  const total = c.fundings.reduce((s, f) => s + f.shareBps, 0);
  if (total !== 10_000) problems.push(`funding shares must sum to 10000 bps (100%), got ${total}`);
  const partnerIds = c.fundings.map((f) => f.partnerId);
  if (new Set(partnerIds).size !== partnerIds.length)
    problems.push('each partner can appear only once in funding');
  const partners = await prisma.partner.findMany({ where: { id: { in: partnerIds } } });
  if (partners.length !== new Set(partnerIds).size) problems.push('unknown partner in funding');
  if (partners.some((p) => p.country !== c.country))
    problems.push('funding partners must be in the campaign country');

  // A merchant can fund only a campaign that runs exclusively at its own merchants.
  const merchantFunders = partners.filter((p) => p.type === 'MERCHANT');
  if (merchantFunders.length > 1) problems.push('at most one merchant can fund a campaign');
  if (partners.filter((p) => p.type === 'WAFFARHA').length > 1)
    problems.push('Waffarha can appear only once in funding');

  const t = c.targeting;
  const [merchants, branches, terminals] = await Promise.all([
    t.merchantIds?.length ? prisma.merchant.findMany({ where: { id: { in: t.merchantIds } } }) : [],
    t.branchIds?.length ? prisma.branch.findMany({ where: { id: { in: t.branchIds } } }) : [],
    t.terminalIds?.length || t.excludeTerminalIds?.length
      ? prisma.terminal.findMany({
          where: { id: { in: [...(t.terminalIds ?? []), ...(t.excludeTerminalIds ?? [])] } },
        })
      : [],
  ]);
  if (merchants.length !== new Set(t.merchantIds ?? []).size)
    problems.push('unknown merchant in targeting');
  if (branches.length !== new Set(t.branchIds ?? []).size)
    problems.push('unknown branch in targeting');
  if (
    terminals.length !== new Set([...(t.terminalIds ?? []), ...(t.excludeTerminalIds ?? [])]).size
  )
    problems.push('unknown terminal in targeting');
  if (merchants.some((m) => m.country !== c.country))
    problems.push('targeted merchants must be in the campaign country');

  const merchantFunder = merchantFunders[0];
  if (merchantFunder) {
    if (!t.merchantIds?.length)
      problems.push('a merchant-funded campaign must target that merchant explicitly');
    else if (merchants.some((m) => m.partnerId !== merchantFunder.id)) {
      problems.push('a merchant-funded campaign can only target merchants of the funding merchant');
    }
  }

  if (problems.length) throw unprocessable('INVALID_CAMPAIGN', problems.join('; '));
}

/** Prisma column values for a validated campaign input. */
export function toCampaignColumns(c: CampaignInput) {
  const l = c.limits;
  const big = (v: number | null | undefined) => (v === null || v === undefined ? null : BigInt(v));
  return {
    name: c.name,
    nameAr: c.nameAr ?? null,
    description: c.description ?? null,
    country: c.country,
    currency: c.currency,
    timezone: c.timezone,
    startAt: c.startAt,
    endAt: c.endAt,
    priority: c.priority,
    discountType: c.discount.type,
    discountConfig: c.discount as Prisma.InputJsonValue,
    targeting: c.targeting as Prisma.InputJsonValue,
    schedule: c.schedule ? (c.schedule as Prisma.InputJsonValue) : Prisma.JsonNull,
    displayMessage: c.displayMessage ?? null,
    displayMessageAr: c.displayMessageAr ?? null,
    totalBudgetMinor: big(l.totalBudgetMinor),
    maxUniqueCards: l.maxUniqueCards ?? null,
    dailyBudgetMinor: big(l.dailyBudgetMinor),
    dailyRedemptionLimit: l.dailyRedemptionLimit ?? null,
    perCardMaxCount: l.perCardMaxCount ?? null,
    perCardMaxAmountMinor: big(l.perCardMaxAmountMinor),
    perCardPeriod: l.perCardPeriod,
    settlementMode: c.settlementMode,
    autoPauseOnFraud: c.autoPauseOnFraud,
  };
}
