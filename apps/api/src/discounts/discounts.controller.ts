import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AcquirerAuthGuard, CurrentAcquirer } from '../acquirers/acquirer-auth.guard';
import type { AuthenticatedAcquirer } from '../acquirers/acquirers.service';
import { badRequest } from '../common/api-error';
import { sha256Hex } from '../common/crypto';
import { ZodPipe } from '../common/zod-pipe';
import {
  cancelSchema,
  confirmSchema,
  inquireSchema,
  refundSchema,
  type CancelRequest,
  type ConfirmRequest,
  type InquireRequest,
  type InquireResponse,
  type RedemptionResponse,
  type RefundRequest,
} from './dto';
import { IdempotencyService } from './idempotency.service';
import { InquiryService } from './inquiry.service';
import { LifecycleService } from './lifecycle.service';
import { toRedemptionResponse } from './redemption.mapper';

@Controller('v1/discounts')
@UseGuards(AcquirerAuthGuard)
export class DiscountsController {
  constructor(
    private readonly inquiry: InquiryService,
    private readonly lifecycle: LifecycleService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('inquire')
  @HttpCode(200)
  async inquire(
    @CurrentAcquirer() acquirer: AuthenticatedAcquirer,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @Body(new ZodPipe(inquireSchema)) body: InquireRequest,
  ): Promise<InquireResponse> {
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw badRequest('Idempotency-Key header is required (max 128 characters)');
    }
    return this.idempotency.run(acquirer.id, idempotencyKey, sha256Hex(req.rawBody ?? ''), () =>
      this.inquiry.inquire(acquirer, idempotencyKey, body),
    );
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentAcquirer() acquirer: AuthenticatedAcquirer,
    @Param('id') id: string,
    @Body(new ZodPipe(confirmSchema)) body: ConfirmRequest,
  ): Promise<RedemptionResponse> {
    return toRedemptionResponse(await this.lifecycle.confirm(acquirer.id, id, body));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentAcquirer() acquirer: AuthenticatedAcquirer,
    @Param('id') id: string,
    @Body(new ZodPipe(cancelSchema)) body: CancelRequest,
  ): Promise<RedemptionResponse> {
    return toRedemptionResponse(await this.lifecycle.cancel(acquirer.id, id, body.reason));
  }

  @Post(':id/refund')
  @HttpCode(200)
  async refund(
    @CurrentAcquirer() acquirer: AuthenticatedAcquirer,
    @Param('id') id: string,
    @Body(new ZodPipe(refundSchema)) body: RefundRequest,
  ): Promise<RedemptionResponse> {
    return toRedemptionResponse(await this.lifecycle.refund(acquirer.id, id, body));
  }
}
