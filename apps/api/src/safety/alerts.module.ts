import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { AlertsService } from './alerts.service';
import { MetricsController, SafetyController } from './safety.controller';

@Module({
  imports: [DiscountsModule, AdminModule],
  controllers: [SafetyController, MetricsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
