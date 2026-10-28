import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { DiscountsModule } from './discounts/discounts.module';
import { HealthController } from './health.controller';
import { InfraModule } from './infra/infra.module';
import { AlertsModule } from './safety/alerts.module';
import { SafetyCoreModule } from './safety/safety-core.module';
import { SettlementModule } from './settlement/settlement.module';

@Module({
  imports: [
    InfraModule,
    SafetyCoreModule,
    DiscountsModule,
    AdminModule,
    SettlementModule,
    AlertsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
