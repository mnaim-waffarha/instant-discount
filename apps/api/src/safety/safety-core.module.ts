import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { SettingsService } from './settings.service';

/** Settings and metrics are needed on the payment path, so they are global and dependency-free. */
@Global()
@Module({
  providers: [SettingsService, MetricsService],
  exports: [SettingsService, MetricsService],
})
export class SafetyCoreModule {}
