import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@instant-discount/db';
import { rankCampaigns, type TransactionContext } from '@instant-discount/rules-engine';
import { splitByShares } from '@instant-discount/shared';
import type { AuthenticatedAcquirer } from '../acquirers/acquirers.service';
import { CampaignCache, type ActiveCampaign } from '../campaigns/campaign-cache.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { hashCardToken } from '../common/crypto';
import { bucketsFor } from '../counters/counter-keys';
import { CountersService } from '../counters/counters.service';
import { PrismaService } from '../infra/prisma.service';
import { TerminalResolver } from '../terminals/terminal-resolver.service';
import type { InquireRequest, InquireResponse, NotEligibleReason } from './dto';

interface Decision {
  response: InquireResponse;
  terminalId?: string;
  campaignId?: string;
  /** Per-campaign rejection reasons, for the inquiry log. */
  details?: Record<string, string>;
}

@Injectable()
export class InquiryService {
  private readonly logger = new Logger(InquiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CampaignCache,
    private readonly counters: CountersService,
    private readonly terminals: TerminalResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async inquire(
    acquirer: AuthenticatedAcquirer,
    idempotencyKey: string,
    req: InquireRequest,
  ): Promise<InquireResponse> {
    const started = Date.now();
    let decision: Decision;
    try {
      decision = await this.decide(acquirer, idempotencyKey, req, new Date());
    } catch (err) {
      // Fail open: the POS charges the full amount, payments are never blocked by us.
      this.logger.error(`Inquiry ${req.acquirer_txn_ref} failed: ${String(err)}`);
      decision = { response: { eligible: false, reason: 'UNAVAILABLE' } };
    }
    this.logInquiry(acquirer, req, decision, Date.now() - started);
    return decision.response;
  }

  private async decide(
    acquirer: AuthenticatedAcquirer,
    idempotencyKey: string,
    req: InquireRequest,
    now: Date,
  ): Promise<Decision> {
    const notEligible = (reason: NotEligibleReason, extra: Partial<Decision> = {}): Decision => ({
      response: { eligible: false, reason },
      ...extra,
    });

    const terminal = await this.terminals.resolve(acquirer.id, req.terminal_id);
    if (!terminal) return notEligible('UNKNOWN_TERMINAL');
    if (!terminal.active) return notEligible('TERMINAL_INACTIVE', { terminalId: terminal.id });

    const txn: TransactionContext = {
      country: terminal.country,
      currency: req.currency,
      amountMinor: req.amount,
      bin: req.bin,
      scheme: req.scheme,
      merchantId: terminal.merchantId,
      branchId: terminal.branchId,
      terminalId: terminal.id,
      mcc: terminal.mcc,
    };
    const candidates = this.cache.forCountry(terminal.country);
    const ranked = rankCampaigns(
      candidates.map((c) => c.rule),
      txn,
      now,
    );
    const details: Record<string, string> = Object.fromEntries(
      ranked.rejected.map((r) => [r.campaignId, r.reason]),
    );
    if (ranked.eligible.length === 0)
      return notEligible('NO_ELIGIBLE_CAMPAIGN', { terminalId: terminal.id, details });

    const cardHash = hashCardToken(this.config.CARD_TOKEN_PEPPER, req.card_token);

    // Highest priority first; fall through to the next campaign when one is capped.
    for (const candidate of ranked.eligible) {
      const campaign = this.cache.get(candidate.campaignId)!;
      const buckets = bucketsFor(now, campaign.rule.timezone, campaign.limits.perCardPeriod);
      const result = await this.counters.reserve(
        campaign,
        cardHash,
        buckets,
        candidate.discountMinor,
        now,
      );
      if (result !== 'OK') {
        details[candidate.campaignId] = result;
        continue;
      }

      try {
        const redemption = await this.createRedemption(
          acquirer,
          idempotencyKey,
          req,
          campaign,
          terminal.id,
          cardHash,
          buckets,
          candidate.discountMinor,
          now,
        );
        return {
          response: {
            eligible: true,
            redemption_id: redemption.id,
            campaign_id: campaign.rule.id,
            original_amount: req.amount,
            discount_amount: Number(redemption.discountMinor),
            final_amount: Number(redemption.finalAmountMinor),
            currency: req.currency,
            expires_at: redemption.expiresAt.toISOString(),
            display_message: campaign.displayMessage,
            display_message_ar: campaign.displayMessageAr,
          },
          terminalId: terminal.id,
          campaignId: campaign.rule.id,
          details,
        };
      } catch (err) {
        // Give the reservation back before deciding what to answer.
        await this.counters.release(
          campaign.rule.id,
          cardHash,
          buckets,
          candidate.discountMinor,
          true,
        );
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return this.replayExisting(acquirer.id, idempotencyKey, terminal.id);
        }
        throw err;
      }
    }

    return notEligible('LIMITS_REACHED', { terminalId: terminal.id, details });
  }

  private createRedemption(
    acquirer: AuthenticatedAcquirer,
    idempotencyKey: string,
    req: InquireRequest,
    campaign: ActiveCampaign,
    terminalId: string,
    cardHash: string,
    buckets: ReturnType<typeof bucketsFor>,
    discountMinor: number,
    now: Date,
  ) {
    const shares = splitByShares(
      discountMinor,
      campaign.fundings.map((f) => f.shareBps),
    );
    const fundingSnapshot = campaign.fundings.map((f, i) => ({ ...f, amountMinor: shares[i] }));
    return this.prisma.redemption.create({
      data: {
        acquirerId: acquirer.id,
        idempotencyKey,
        acquirerTxnRef: req.acquirer_txn_ref,
        campaignId: campaign.rule.id,
        campaignVersion: campaign.rule.version,
        terminalId,
        cardTokenHash: cardHash,
        bin: req.bin,
        scheme: req.scheme,
        currency: req.currency,
        originalAmountMinor: req.amount,
        discountMinor,
        finalAmountMinor: req.amount - discountMinor,
        fundingSnapshot,
        counterKeys: { ...buckets },
        expiresAt: new Date(now.getTime() + this.config.RESERVATION_TTL_SECONDS * 1000),
        events: {
          create: { type: 'RESERVED', discountDeltaMinor: discountMinor, amountMinor: req.amount },
        },
      },
    });
  }

  /** Same Idempotency-Key already produced a redemption (Redis idempotency entry was lost). */
  private async replayExisting(
    acquirerId: string,
    idempotencyKey: string,
    terminalId: string,
  ): Promise<Decision> {
    const r = await this.prisma.redemption.findUniqueOrThrow({
      where: { acquirerId_idempotencyKey: { acquirerId, idempotencyKey } },
      include: { campaign: true },
    });
    return {
      response: {
        eligible: true,
        redemption_id: r.id,
        campaign_id: r.campaignId,
        original_amount: Number(r.originalAmountMinor),
        discount_amount: Number(r.discountMinor),
        final_amount: Number(r.finalAmountMinor),
        currency: r.currency,
        expires_at: r.expiresAt.toISOString(),
        display_message: r.campaign.displayMessage,
        display_message_ar: r.campaign.displayMessageAr,
      },
      terminalId,
      campaignId: r.campaignId,
    };
  }

  /** Written off the hot path; losing a log line must never affect the payment. */
  private logInquiry(
    acquirer: AuthenticatedAcquirer,
    req: InquireRequest,
    d: Decision,
    latencyMs: number,
  ) {
    const r = d.response;
    void this.prisma.inquiryLog
      .create({
        data: {
          acquirerId: acquirer.id,
          terminalId: d.terminalId,
          acquirerTxnRef: req.acquirer_txn_ref,
          bin: req.bin,
          amountMinor: req.amount,
          currency: req.currency,
          eligible: r.eligible,
          campaignId: d.campaignId,
          redemptionId: r.eligible ? r.redemption_id : undefined,
          reason: r.eligible ? undefined : r.reason,
          details: d.details,
          latencyMs,
        },
      })
      .catch((err) => this.logger.warn(`Could not write inquiry log: ${String(err)}`));
  }
}
