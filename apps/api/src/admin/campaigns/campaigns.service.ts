import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Campaign,
  type CampaignFunding,
  type CampaignStatus,
  type User,
} from '@instant-discount/db';
import { CAMPAIGNS_CHANGED_CHANNEL } from '../../campaigns/campaign-cache.service';
import { ApiError, conflict, notFound, unprocessable } from '../../common/api-error';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { AuditService } from '../common/audit.service';
import {
  campaignInput,
  toCampaignColumns,
  validateCampaign,
  type CampaignInput,
} from './campaign-input';

type CampaignWithFundings = Campaign & { fundings: CampaignFunding[] };

const LIVE: CampaignStatus[] = ['SCHEDULED', 'ACTIVE', 'PAUSED'];

/** The approved, editable shape of a campaign (what CampaignInput describes). */
export function toCampaignInput(c: CampaignWithFundings): CampaignInput {
  const num = (v: bigint | null) => (v === null ? null : Number(v));
  return campaignInput.parse({
    name: c.name,
    nameAr: c.nameAr ?? undefined,
    description: c.description ?? undefined,
    country: c.country,
    currency: c.currency,
    timezone: c.timezone,
    startAt: c.startAt,
    endAt: c.endAt,
    priority: c.priority,
    discount: c.discountConfig,
    targeting: c.targeting,
    schedule: c.schedule ?? null,
    displayMessage: c.displayMessage ?? undefined,
    displayMessageAr: c.displayMessageAr ?? undefined,
    limits: {
      totalBudgetMinor: num(c.totalBudgetMinor),
      maxUniqueCards: c.maxUniqueCards,
      dailyBudgetMinor: num(c.dailyBudgetMinor),
      dailyRedemptionLimit: c.dailyRedemptionLimit,
      perCardMaxCount: c.perCardMaxCount,
      perCardMaxAmountMinor: num(c.perCardMaxAmountMinor),
      perCardPeriod: c.perCardPeriod ?? 'CAMPAIGN',
    },
    fundings: c.fundings.map((f) => ({ partnerId: f.partnerId, shareBps: f.shareBps })),
    settlementMode: c.settlementMode,
    autoPauseOnFraud: c.autoPauseOnFraud,
  });
}

/**
 * Campaign workflow with maker-checker:
 *   DRAFT ─submit→ PENDING_APPROVAL ─approve→ SCHEDULED/ACTIVE ⇄ PAUSED → ENDED
 *                  └─reject/withdraw→ DRAFT
 * Edits to an approved campaign are stored as `pendingChanges` and only take effect when a
 * different user approves them; the live campaign keeps running unchanged until then.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async get(id: string): Promise<CampaignWithFundings> {
    const c = await this.prisma.campaign.findUnique({ where: { id }, include: { fundings: true } });
    if (!c) throw notFound('CAMPAIGN_NOT_FOUND', 'No such campaign');
    return c;
  }

  async create(user: User, input: CampaignInput) {
    await validateCampaign(this.prisma, input);
    const c = await this.prisma.campaign.create({
      data: {
        ...toCampaignColumns(input),
        status: 'DRAFT',
        createdById: user.id,
        updatedById: user.id,
        fundings: { create: input.fundings },
      },
      include: { fundings: true },
    });
    await this.audit.record(user, 'campaign.create', 'Campaign', c.id, undefined, c);
    return c;
  }

  async update(user: User, id: string, input: CampaignInput) {
    const c = await this.get(id);
    await validateCampaign(this.prisma, input);

    if (c.status === 'DRAFT') {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.campaignFunding.deleteMany({ where: { campaignId: id } });
        return tx.campaign.update({
          where: { id },
          data: {
            ...toCampaignColumns(input),
            updatedById: user.id,
            rejectionReason: null,
            fundings: { create: input.fundings },
          },
          include: { fundings: true },
        });
      });
      await this.audit.record(user, 'campaign.update', 'Campaign', id, c, updated);
      return updated;
    }

    if (LIVE.includes(c.status)) {
      this.checkLiveChange(c, input);
      const updated = await this.prisma.campaign.update({
        where: { id },
        data: {
          pendingChanges: input as unknown as Prisma.InputJsonValue,
          pendingById: user.id,
          pendingAt: new Date(),
          rejectionReason: null,
        },
        include: { fundings: true },
      });
      await this.audit.record(user, 'campaign.propose_change', 'Campaign', id, undefined, input);
      return updated;
    }

    throw conflict(
      'NOT_EDITABLE',
      c.status === 'PENDING_APPROVAL'
        ? 'Withdraw the campaign before editing it'
        : 'Ended campaigns cannot be edited',
    );
  }

  async submit(user: User, id: string) {
    const c = await this.get(id);
    if (c.status !== 'DRAFT')
      throw conflict('INVALID_STATUS', `Only drafts can be submitted (status ${c.status})`);
    const input = toCampaignInput(c);
    await validateCampaign(this.prisma, input);
    if (input.endAt <= new Date()) throw unprocessable('INVALID_CAMPAIGN', 'endAt is in the past');
    return this.transition(user, c, 'campaign.submit', {
      status: 'PENDING_APPROVAL',
      submittedById: user.id,
      submittedAt: new Date(),
      rejectionReason: null,
    });
  }

  async withdraw(user: User, id: string) {
    const c = await this.get(id);
    if (c.status !== 'PENDING_APPROVAL')
      throw conflict('INVALID_STATUS', 'Only campaigns pending approval can be withdrawn');
    return this.transition(user, c, 'campaign.withdraw', { status: 'DRAFT' });
  }

  /** Approves a submitted campaign, or the pending changes of a live one. Approver ≠ maker. */
  async approve(user: User, id: string) {
    const c = await this.get(id);

    if (c.status === 'PENDING_APPROVAL') {
      const makers = [c.createdById, c.updatedById, c.submittedById];
      if (makers.includes(user.id)) throw forbiddenSelfApproval();
      const status: CampaignStatus = c.startAt <= new Date() ? 'ACTIVE' : 'SCHEDULED';
      const approved = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.campaign.update({
          where: { id },
          data: { status, approvedById: user.id, approvedAt: new Date() },
          include: { fundings: true },
        });
        await tx.campaignVersion.create({
          data: { campaignId: id, version: updated.version, snapshot: snapshot(updated) },
        });
        return updated;
      });
      await this.afterChange(user, 'campaign.approve', c, approved);
      return approved;
    }

    if (c.pendingChanges && LIVE.includes(c.status)) {
      if (c.pendingById === user.id) throw forbiddenSelfApproval();
      const input = campaignInput.parse(c.pendingChanges);
      await validateCampaign(this.prisma, input);
      this.checkLiveChange(c, input);
      const approved = await this.prisma.$transaction(async (tx) => {
        await tx.campaignFunding.deleteMany({ where: { campaignId: id } });
        const updated = await tx.campaign.update({
          where: { id },
          data: {
            ...toCampaignColumns(input),
            version: { increment: 1 },
            updatedById: c.pendingById,
            approvedById: user.id,
            approvedAt: new Date(),
            pendingChanges: Prisma.DbNull,
            pendingById: null,
            pendingAt: null,
            fundings: { create: input.fundings },
          },
          include: { fundings: true },
        });
        await tx.campaignVersion.create({
          data: { campaignId: id, version: updated.version, snapshot: snapshot(updated) },
        });
        return updated;
      });
      await this.afterChange(user, 'campaign.approve_change', c, approved);
      return approved;
    }

    throw conflict('NOTHING_TO_APPROVE', 'This campaign has nothing waiting for approval');
  }

  async reject(user: User, id: string, reason: string) {
    const c = await this.get(id);
    if (c.status === 'PENDING_APPROVAL') {
      return this.transition(user, c, 'campaign.reject', {
        status: 'DRAFT',
        rejectionReason: reason,
      });
    }
    if (c.pendingChanges) {
      return this.transition(user, c, 'campaign.reject_change', {
        pendingChanges: Prisma.DbNull,
        pendingById: null,
        pendingAt: null,
        rejectionReason: reason,
      });
    }
    throw conflict('NOTHING_TO_REJECT', 'This campaign has nothing waiting for approval');
  }

  async pause(user: User, id: string) {
    const c = await this.get(id);
    if (c.status !== 'ACTIVE' && c.status !== 'SCHEDULED')
      throw conflict('INVALID_STATUS', `Cannot pause a ${c.status} campaign`);
    return this.transition(user, c, 'campaign.pause', { status: 'PAUSED', pausedAt: new Date() });
  }

  async resume(user: User, id: string) {
    const c = await this.get(id);
    if (c.status !== 'PAUSED')
      throw conflict('INVALID_STATUS', 'Only paused campaigns can be resumed');
    if (c.endAt <= new Date()) throw conflict('CAMPAIGN_OVER', 'The campaign end date has passed');
    return this.transition(user, c, 'campaign.resume', {
      status: c.startAt <= new Date() ? 'ACTIVE' : 'SCHEDULED',
      pausedAt: null,
    });
  }

  async end(user: User, id: string) {
    const c = await this.get(id);
    if (c.status === 'ENDED') return c;
    if (c.status === 'DRAFT' || c.status === 'PENDING_APPROVAL') {
      throw conflict('INVALID_STATUS', 'Drafts are not running; there is nothing to end');
    }
    return this.transition(user, c, 'campaign.end', { status: 'ENDED' });
  }

  async clone(user: User, id: string) {
    const c = await this.get(id);
    const input = toCampaignInput(c);
    return this.create(user, { ...input, name: `Copy of ${c.name}`.slice(0, 200) });
  }

  /** Changes that would corrupt running counters or history are not allowed on a live campaign. */
  private checkLiveChange(c: Campaign, input: CampaignInput) {
    const problems: string[] = [];
    if (input.country !== c.country || input.currency !== c.currency)
      problems.push('country and currency cannot change');
    if (input.limits.perCardPeriod !== (c.perCardPeriod ?? 'CAMPAIGN'))
      problems.push('per-card period cannot change');
    if (c.startAt <= new Date() && input.startAt.getTime() !== c.startAt.getTime()) {
      problems.push('start date cannot change once the campaign has started');
    }
    if (input.endAt <= new Date())
      problems.push('end date must be in the future (use End to stop the campaign)');
    if (problems.length) throw unprocessable('INVALID_CHANGE', problems.join('; '));
  }

  private async transition(
    user: User,
    before: CampaignWithFundings,
    action: string,
    data: Prisma.CampaignUpdateInput,
  ) {
    const after = await this.prisma.campaign.update({
      where: { id: before.id },
      data,
      include: { fundings: true },
    });
    await this.afterChange(user, action, before, after);
    return after;
  }

  private async afterChange(user: User, action: string, before: Campaign, after: Campaign) {
    await this.audit.record(
      user,
      action,
      'Campaign',
      after.id,
      { status: before.status, version: before.version },
      { status: after.status, version: after.version },
    );
    // Every API instance reloads its campaign cache.
    await this.redis.client.publish(CAMPAIGNS_CHANGED_CHANNEL, after.id);
  }
}

function snapshot(c: CampaignWithFundings): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(c, (_, v) => (typeof v === 'bigint' ? Number(v) : v)),
  ) as Prisma.InputJsonValue;
}

function forbiddenSelfApproval() {
  return new ApiError(
    403,
    'SELF_APPROVAL',
    'A different user must approve changes you made or submitted',
  );
}
