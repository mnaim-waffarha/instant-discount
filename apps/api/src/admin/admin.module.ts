import { Module } from '@nestjs/common';
import { DiscountsModule } from '../discounts/discounts.module';
import { AcquirersAdminController } from './acquirers/acquirers-admin.controller';
import { AuditController } from './audit/audit.controller';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { RateLimiter } from './auth/rate-limiter.service';
import { SessionService } from './auth/session.service';
import { CampaignsController, SimulatorController } from './campaigns/campaigns.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignInsightsService } from './campaigns/insights.service';
import { ExplorerController } from './explorer/explorer.controller';
import { NetworkController } from './network/network.controller';
import { PartnersController } from './partners/partners.controller';
import { UsersController } from './users/users.controller';

@Module({
  imports: [DiscountsModule],
  controllers: [
    AuthController,
    PartnersController,
    NetworkController,
    AcquirersAdminController,
    UsersController,
    CampaignsController,
    SimulatorController,
    ExplorerController,
    AuditController,
  ],
  exports: [SessionService, AdminAuthGuard],
  providers: [
    AuthService,
    SessionService,
    RateLimiter,
    CampaignsService,
    CampaignInsightsService,
    AdminAuthGuard,
  ],
})
export class AdminModule {}
