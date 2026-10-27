import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DiscountsModule } from './discounts/discounts.module';
import { InfraModule } from './infra/infra.module';
import { JobsService } from './jobs/jobs.service';
import { SettlementModule } from './settlement/settlement.module';

@Module({
  imports: [InfraModule, DiscountsModule, SettlementModule, ScheduleModule.forRoot()],
  providers: [JobsService],
})
export class WorkerModule {}
