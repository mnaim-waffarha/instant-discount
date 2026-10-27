import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Redemption } from '@instant-discount/db';
import { conflict, notFound, unprocessable } from '../common/api-error';
import type { CounterBuckets } from '../counters/counter-keys';
import { CountersService } from '../counters/counters.service';
import { PrismaService } from '../infra/prisma.service';
import { MetricsService } from '../safety/metrics.service';
import type { ConfirmRequest, RefundRequest } from './dto';
import { applyRefund } from './refund-math';

interface Release {
  discountDeltaMinor: number;
  releaseUsage: boolean;
}

type Tx = Prisma.TransactionClient;

/**
 * Confirm / cancel / refund / expire. Each runs in a transaction holding a row lock on the
 * redemption, so concurrent calls for the same redemption serialise. Redis counters are
 * adjusted after commit; if that fails, Postgres is still right and a rebuild restores Redis.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
    private readonly metrics: MetricsService,
  ) {}

  confirm(acquirerId: string, id: string, body: ConfirmRequest): Promise<Redemption> {
    return this.mutate(
      acquirerId,
      id,
      async (tx, r) => {
        if (
          r.status === 'CONFIRMED' ||
          r.status === 'PARTIALLY_REFUNDED' ||
          r.status === 'REFUNDED'
        ) {
          return { redemption: r };
        }
        if (r.status === 'RELEASED')
          throw conflict('REDEMPTION_CANCELLED', 'This discount was cancelled');
        if (r.status === 'EXPIRED')
          throw conflict('RESERVATION_EXPIRED', 'The reservation expired before confirmation');

        if (r.expiresAt <= new Date()) {
          // Expired but not swept yet: expire it now, and tell the acquirer.
          const expired = await this.transition(
            tx,
            r,
            'EXPIRED',
            'EXPIRED',
            -Number(r.discountMinor),
          );
          return {
            redemption: expired,
            release: { discountDeltaMinor: Number(r.discountMinor), releaseUsage: true },
            error: conflict('RESERVATION_EXPIRED', 'The reservation expired before confirmation'),
          };
        }
        if (body.charged_amount !== Number(r.finalAmountMinor)) {
          throw unprocessable(
            'AMOUNT_MISMATCH',
            `charged_amount must equal final_amount (${r.finalAmountMinor}); cancel instead if the charge differs`,
          );
        }
        const confirmed = await tx.redemption.update({
          where: { id: r.id },
          data: {
            status: 'CONFIRMED',
            authCode: body.auth_code,
            confirmedAt: new Date(),
            events: {
              create: {
                type: 'CONFIRMED',
                discountDeltaMinor: 0,
                amountMinor: body.charged_amount,
              },
            },
          },
        });
        return { redemption: confirmed };
      },
      'confirm',
    );
  }

  /** Payment declined or voided. Allowed before or after confirmation, but not after a refund. */
  cancel(acquirerId: string, id: string, reason?: string): Promise<Redemption> {
    return this.mutate(
      acquirerId,
      id,
      async (tx, r) => {
        if (r.status === 'RELEASED' || r.status === 'EXPIRED') return { redemption: r };
        if (r.status === 'PARTIALLY_REFUNDED' || r.status === 'REFUNDED') {
          throw conflict(
            'USE_REFUND',
            'This purchase was already refunded; use the refund endpoint',
          );
        }
        const released = await this.transition(
          tx,
          r,
          'RELEASED',
          'CANCELLED',
          -Number(r.discountMinor),
          { reason },
        );
        return {
          redemption: released,
          release: { discountDeltaMinor: Number(r.discountMinor), releaseUsage: true },
        };
      },
      'cancel',
    );
  }

  refund(acquirerId: string, id: string, body: RefundRequest): Promise<Redemption> {
    return this.mutate(
      acquirerId,
      id,
      async (tx, r) => {
        const previous = await tx.redemptionEvent.findMany({
          where: { redemptionId: r.id, type: 'REFUNDED' },
        });
        if (
          previous.some(
            (e) => (e.payload as { refund_id?: string } | null)?.refund_id === body.refund_id,
          )
        ) {
          return { redemption: r };
        }
        if (r.status === 'REFUNDED')
          throw conflict('ALREADY_REFUNDED', 'This purchase is already fully refunded');
        if (r.status !== 'CONFIRMED' && r.status !== 'PARTIALLY_REFUNDED') {
          throw conflict(
            'NOT_CONFIRMED',
            `Only confirmed purchases can be refunded (status ${r.status})`,
          );
        }

        const outcome = applyRefund(
          {
            discountMinor: Number(r.discountMinor),
            finalAmountMinor: Number(r.finalAmountMinor),
            refundedAmountMinor: Number(r.refundedAmountMinor),
            refundedDiscountMinor: Number(r.refundedDiscountMinor),
          },
          body.amount,
        );
        if (!outcome.ok) {
          throw unprocessable(
            'REFUND_EXCEEDS_PAID',
            'Total refunds would exceed the amount the customer paid',
          );
        }

        const updated = await tx.redemption.update({
          where: { id: r.id },
          data: {
            status: outcome.full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            refundedAmountMinor: outcome.refundedAmountMinor,
            refundedDiscountMinor: outcome.refundedDiscountMinor,
            events: {
              create: {
                type: 'REFUNDED',
                discountDeltaMinor: -outcome.discountDeltaMinor,
                amountMinor: body.amount,
                payload: { refund_id: body.refund_id },
              },
            },
          },
        });
        return {
          redemption: updated,
          release: { discountDeltaMinor: outcome.discountDeltaMinor, releaseUsage: outcome.full },
        };
      },
      'refund',
    );
  }

  /** Used by the expiry job. Returns false if the redemption was no longer RESERVED. */
  async expire(id: string): Promise<boolean> {
    const r = await this.prisma.redemption.findUniqueOrThrow({ where: { id } });
    let expired = false;
    await this.mutate(
      r.acquirerId,
      id,
      async (tx, locked) => {
        if (locked.status !== 'RESERVED') return { redemption: locked };
        expired = true;
        const updated = await this.transition(
          tx,
          locked,
          'EXPIRED',
          'EXPIRED',
          -Number(locked.discountMinor),
        );
        return {
          redemption: updated,
          release: { discountDeltaMinor: Number(locked.discountMinor), releaseUsage: true },
        };
      },
      'expire',
    );
    return expired;
  }

  private transition(
    tx: Tx,
    r: Redemption,
    status: 'RELEASED' | 'EXPIRED',
    event: 'CANCELLED' | 'EXPIRED',
    discountDeltaMinor: number,
    payload?: Prisma.InputJsonObject,
  ) {
    return tx.redemption.update({
      where: { id: r.id },
      data: { status, events: { create: { type: event, discountDeltaMinor, payload } } },
    });
  }

  private async mutate(
    acquirerId: string,
    id: string,
    fn: (
      tx: Tx,
      r: Redemption,
    ) => Promise<{ redemption: Redemption; release?: Release; error?: Error }>,
    action: 'confirm' | 'cancel' | 'refund' | 'expire',
  ): Promise<Redemption> {
    try {
      const r = await this.mutateInner(acquirerId, id, fn);
      this.metrics.lifecycle.inc({ action, outcome: 'ok' });
      return r;
    } catch (err) {
      const code = (err as { response?: { error?: { code?: string } } }).response?.error?.code;
      this.metrics.lifecycle.inc({ action, outcome: code ?? 'error' });
      throw err;
    }
  }

  private async mutateInner(
    acquirerId: string,
    id: string,
    fn: (
      tx: Tx,
      r: Redemption,
    ) => Promise<{ redemption: Redemption; release?: Release; error?: Error }>,
  ): Promise<Redemption> {
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Redemption" WHERE id = ${id} AND "acquirerId" = ${acquirerId} FOR UPDATE`;
      if (locked.length === 0)
        throw notFound('REDEMPTION_NOT_FOUND', 'No such redemption for this acquirer');
      const r = await tx.redemption.findUniqueOrThrow({ where: { id } });
      return fn(tx, r);
    });

    if (result.release && result.release.discountDeltaMinor >= 0) {
      const r = result.redemption;
      await this.counters
        .release(
          r.campaignId,
          r.cardTokenHash,
          r.counterKeys as unknown as CounterBuckets,
          result.release.discountDeltaMinor,
          result.release.releaseUsage,
        )
        .catch((err) =>
          this.logger.error(
            `Counter release failed for ${r.id}; reconciliation will fix it: ${String(err)}`,
          ),
        );
    }
    if (result.error) throw result.error;
    return result.redemption;
  }
}
