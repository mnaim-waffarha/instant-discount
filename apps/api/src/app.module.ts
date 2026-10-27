import { Module } from '@nestjs/common';
import { DiscountsModule } from './discounts/discounts.module';
import { HealthController } from './health.controller';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule, DiscountsModule],
  controllers: [HealthController],
})
export class AppModule {}
