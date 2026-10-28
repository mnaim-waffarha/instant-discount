import { Module } from '@nestjs/common';
import { AcquirerAuthGuard } from '../acquirers/acquirer-auth.guard';
import { AcquirersService } from '../acquirers/acquirers.service';
import { CampaignCache } from '../campaigns/campaign-cache.service';
import { CountersService } from '../counters/counters.service';
import { TerminalResolver } from '../terminals/terminal-resolver.service';
import { DiscountsController } from './discounts.controller';
import { IdempotencyService } from './idempotency.service';
import { InquiryService } from './inquiry.service';
import { LifecycleService } from './lifecycle.service';

@Module({
  controllers: [DiscountsController],
  providers: [
    AcquirersService,
    AcquirerAuthGuard,
    CampaignCache,
    CountersService,
    TerminalResolver,
    IdempotencyService,
    InquiryService,
    LifecycleService,
  ],
  exports: [CountersService, LifecycleService, CampaignCache],
})
export class DiscountsModule {}
