import { Global, Module } from '@nestjs/common';
import { AuditService } from '../admin/common/audit.service';
import { APP_CONFIG, loadConfig } from '../config';
import { MailerService } from '../mail/mailer.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    RedisService,
    MailerService,
    AuditService,
  ],
  exports: [APP_CONFIG, PrismaService, RedisService, MailerService, AuditService],
})
export class InfraModule {}
