import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Acquirer, User } from '@instant-discount/db';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config';
import { notFound } from '../../common/api-error';
import { encryptSecret } from '../../common/crypto';
import { ZodPipe } from '../../common/zod-pipe';
import { PrismaService } from '../../infra/prisma.service';
import { AdminAuthGuard, CurrentUser } from '../auth/admin-auth.guard';
import { Roles } from '../auth/roles';
import { AuditService } from '../common/audit.service';

const ip = z.string().ip();
const acquirerInput = z.object({
  name: z.string().min(1).max(200),
  country: z.enum(['EG', 'SA']),
  ipAllowlist: z.array(ip).max(50).default([]),
  certFingerprint: z.string().max(200).optional(),
});
const acquirerUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
  ipAllowlist: z.array(ip).max(50).optional(),
  certFingerprint: z.string().max(200).nullable().optional(),
});

/** Never expose the encrypted secret. */
function toDto(a: Acquirer) {
  const { hmacSecretEnc: _secret, ...rest } = a;
  return rest;
}

const newSecret = () => randomBytes(32).toString('hex');

@Controller('admin/v1/acquirers')
@UseGuards(AdminAuthGuard)
export class AcquirersAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.acquirer.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { terminals: true } } },
    });
    return rows.map((r) => ({ ...toDto(r), terminalCount: r._count.terminals }));
  }

  /** The HMAC secret is returned only in this response; store it securely and share it with the acquirer. */
  @Roles('ADMIN')
  @Post()
  async create(
    @CurrentUser() user: User,
    @Body(new ZodPipe(acquirerInput)) body: z.infer<typeof acquirerInput>,
  ) {
    const hmacSecret = newSecret();
    const acquirer = await this.prisma.acquirer.create({
      data: {
        ...body,
        apiKeyId: `acq_${randomBytes(8).toString('hex')}`,
        hmacSecretEnc: encryptSecret(this.config.SECRETS_ENCRYPTION_KEY, hmacSecret),
      },
    });
    await this.audit.record(
      user,
      'acquirer.create',
      'Acquirer',
      acquirer.id,
      undefined,
      toDto(acquirer),
    );
    return { acquirer: toDto(acquirer), hmacSecret };
  }

  @Roles('ADMIN')
  @Patch(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(acquirerUpdate)) body: z.infer<typeof acquirerUpdate>,
  ) {
    const before = await this.prisma.acquirer.findUnique({ where: { id } });
    if (!before) throw notFound('ACQUIRER_NOT_FOUND', 'No such acquirer');
    const acquirer = await this.prisma.acquirer.update({ where: { id }, data: body });
    await this.audit.record(
      user,
      'acquirer.update',
      'Acquirer',
      id,
      toDto(before),
      toDto(acquirer),
    );
    return toDto(acquirer);
  }

  /** New secret takes effect immediately; API instances may accept the old one for up to a minute (cache). */
  @Roles('ADMIN')
  @Post(':id/rotate-secret')
  async rotate(@CurrentUser() user: User, @Param('id') id: string) {
    if (!(await this.prisma.acquirer.findUnique({ where: { id } })))
      throw notFound('ACQUIRER_NOT_FOUND', 'No such acquirer');
    const hmacSecret = newSecret();
    await this.prisma.acquirer.update({
      where: { id },
      data: { hmacSecretEnc: encryptSecret(this.config.SECRETS_ENCRYPTION_KEY, hmacSecret) },
    });
    await this.audit.record(user, 'acquirer.rotate_secret', 'Acquirer', id);
    return { hmacSecret };
  }
}
