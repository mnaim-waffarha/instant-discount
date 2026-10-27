import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { PortalController } from './portal.controller';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

@Module({
  imports: [AdminModule],
  controllers: [SettlementController, PortalController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
