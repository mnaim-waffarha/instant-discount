import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@instant-discount/db';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config';
import { conflict, notFound, unprocessable } from '../../common/api-error';
import { ZodPipe } from '../../common/zod-pipe';
import { PrismaService } from '../../infra/prisma.service';
import { MailerService } from '../../mail/mailer.service';
import { AdminAuthGuard, CurrentUser } from '../auth/admin-auth.guard';
import { Roles } from '../auth/roles';
import { SessionService } from '../auth/session.service';
import { AuditService } from '../common/audit.service';
import { optionalQueryString, pageArgs, pageQuery, toPage } from '../common/pagination';
import { toUserDto } from './users.mapper';

const role = z.enum(['ADMIN', 'CAMPAIGN_MANAGER', 'APPROVER', 'FINANCE', 'VIEWER', 'PARTNER_USER']);
const inviteInput = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  name: z.string().min(1).max(200),
  role,
  partnerId: z.string().uuid().optional(),
  locale: z.enum(['en', 'ar']).default('en'),
});
const userUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  role: role.optional(),
  active: z.boolean().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});
const listQuery = pageQuery.extend({
  role: role.optional(),
  partnerId: optionalQueryString,
  q: optionalQueryString,
});

@Controller('admin/v1/users')
@UseGuards(AdminAuthGuard)
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly mailer: MailerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Roles('ADMIN')
  @Get()
  async list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where = {
      role: q.role,
      partnerId: q.partnerId,
      OR: q.q
        ? [
            { email: { contains: q.q, mode: 'insensitive' as const } },
            { name: { contains: q.q, mode: 'insensitive' as const } },
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { email: 'asc' }, ...pageArgs(q) }),
      this.prisma.user.count({ where }),
    ]);
    return toPage(items.map(toUserDto), total, q);
  }

  /**
   * Staff must use a Workspace email (they sign in with Google); partner users need a partner
   * and sign in by magic link. The invitee gets an email telling them how to sign in.
   */
  @Roles('ADMIN')
  @Post()
  async invite(
    @CurrentUser() actor: User,
    @Body(new ZodPipe(inviteInput)) body: z.infer<typeof inviteInput>,
  ) {
    const isPartner = body.role === 'PARTNER_USER';
    if (isPartner && !body.partnerId)
      throw unprocessable('PARTNER_REQUIRED', 'Partner users need a partnerId');
    if (!isPartner && body.partnerId)
      throw unprocessable('PARTNER_NOT_ALLOWED', 'Staff users cannot belong to a partner');
    if (!isPartner && !body.email.endsWith(`@${this.config.GOOGLE_HOSTED_DOMAIN}`)) {
      throw unprocessable(
        'STAFF_DOMAIN',
        `Staff must use an @${this.config.GOOGLE_HOSTED_DOMAIN} email`,
      );
    }
    if (isPartner && !(await this.prisma.partner.findUnique({ where: { id: body.partnerId } }))) {
      throw unprocessable('INVALID_PARTNER', 'Unknown partner');
    }
    if (await this.prisma.user.findUnique({ where: { email: body.email } })) {
      throw conflict('USER_EXISTS', 'A user with this email already exists');
    }

    const user = await this.prisma.user.create({ data: body });
    await this.audit.record(actor, 'user.invite', 'User', user.id, undefined, toUserDto(user));
    const how = isPartner
      ? 'Open the link below, enter your email, and we will send you a one-time sign-in link.'
      : `Open the link below and sign in with your @${this.config.GOOGLE_HOSTED_DOMAIN} Google account.`;
    await this.mailer.send({
      to: user.email,
      subject: 'You have been invited to Waffarha Instant Discount',
      text: `Hello ${user.name},\n\n${actor.name} invited you to Waffarha Instant Discount.\n${how}\n${this.config.WEB_BASE_URL}/login\n`,
    });
    return toUserDto(user);
  }

  @Roles('ADMIN')
  @Patch(':id')
  async update(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body(new ZodPipe(userUpdate)) body: z.infer<typeof userUpdate>,
  ) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw notFound('USER_NOT_FOUND', 'No such user');
    if (id === actor.id && (body.active === false || (body.role && body.role !== 'ADMIN'))) {
      throw unprocessable(
        'SELF_LOCKOUT',
        'You cannot deactivate yourself or remove your own admin role',
      );
    }
    if (body.role && (body.role === 'PARTNER_USER') !== (before.role === 'PARTNER_USER')) {
      throw unprocessable(
        'ROLE_KIND_CHANGE',
        'Cannot switch a user between staff and partner; invite a new user',
      );
    }
    const user = await this.prisma.user.update({ where: { id }, data: body });
    // Role or access changes take effect immediately.
    if (body.active === false || body.role) await this.sessions.revokeAll(id);
    await this.audit.record(actor, 'user.update', 'User', id, toUserDto(before), toUserDto(user));
    return toUserDto(user);
  }

  /** Own language preference; allowed for everyone. */
  @Roles('ADMIN', 'CAMPAIGN_MANAGER', 'APPROVER', 'FINANCE', 'VIEWER', 'PARTNER_USER')
  @Patch('me/locale')
  async setLocale(
    @CurrentUser() user: User,
    @Body(new ZodPipe(z.object({ locale: z.enum(['en', 'ar']) }))) body: { locale: 'en' | 'ar' },
  ) {
    return toUserDto(
      await this.prisma.user.update({ where: { id: user.id }, data: { locale: body.locale } }),
    );
  }
}
