import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { DiscountsModule } from './discounts/discounts.module';
import { HealthController } from './health.controller';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule, DiscountsModule, AdminModule],
  controllers: [HealthController],
})
export class AppModule {}
