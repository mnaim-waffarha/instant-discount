import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { DiscountsModule } from './discounts/discounts.module';
import { HealthController } from './health.controller';
import { InfraModule } from './infra/infra.module';
import { SettlementModule } from './settlement/settlement.module';

@Module({
  imports: [InfraModule, DiscountsModule, AdminModule, SettlementModule],
  controllers: [HealthController],
})
export class AppModule {}
