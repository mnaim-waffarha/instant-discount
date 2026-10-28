import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DiscountsModule } from './discounts/discounts.module';
import { InfraModule } from './infra/infra.module';
import { JobsService } from './jobs/jobs.service';
import { AlertsModule } from './safety/alerts.module';
import { SafetyCoreModule } from './safety/safety-core.module';
import { SettlementModule } from './settlement/settlement.module';

@Module({
  imports: [
    InfraModule,
    SafetyCoreModule,
    DiscountsModule,
    SettlementModule,
    AlertsModule,
    ScheduleModule.forRoot(),
  ],
  providers: [JobsService],
})
export class WorkerModule {}
