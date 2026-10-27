import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { User } from '@instant-discount/db';
import { z } from 'zod';
import { notFound } from '../../common/api-error';
import { ZodPipe } from '../../common/zod-pipe';
import { PrismaService } from '../../infra/prisma.service';
import { AdminAuthGuard, CurrentUser } from '../auth/admin-auth.guard';
import { EDITORS, Roles } from '../auth/roles';
import { AuditService } from '../common/audit.service';
import { optionalQueryString, pageArgs, pageQuery, toPage } from '../common/pagination';

const partnerInput = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  type: z.enum(['BANK', 'MERCHANT', 'WAFFARHA']),
  country: z.enum(['EG', 'SA']),
  taxNumber: z.string().max(64).optional(),
  billingEmail: z.string().email().optional(),
});
const partnerUpdate = partnerInput.omit({ type: true, country: true }).partial();
const listQuery = pageQuery.extend({
  type: z.enum(['BANK', 'MERCHANT', 'WAFFARHA']).optional(),
  country: z.enum(['EG', 'SA']).optional(),
  q: optionalQueryString,
});

@Controller('admin/v1/partners')
@UseGuards(AdminAuthGuard)
export class PartnersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where = {
      type: q.type,
      country: q.country,
      name: q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.partner.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(q) }),
      this.prisma.partner.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        merchants: true,
        fundings: { include: { campaign: { select: { id: true, name: true, status: true } } } },
      },
    });
    if (!partner) throw notFound('PARTNER_NOT_FOUND', 'No such partner');
    return partner;
  }

  @Roles(...EDITORS)
  @Post()
  async create(
    @CurrentUser() user: User,
    @Body(new ZodPipe(partnerInput)) body: z.infer<typeof partnerInput>,
  ) {
    const partner = await this.prisma.partner.create({ data: body });
    await this.audit.record(user, 'partner.create', 'Partner', partner.id, undefined, partner);
    return partner;
  }

  @Roles(...EDITORS)
  @Patch(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(partnerUpdate)) body: z.infer<typeof partnerUpdate>,
  ) {
    const before = await this.prisma.partner.findUnique({ where: { id } });
    if (!before) throw notFound('PARTNER_NOT_FOUND', 'No such partner');
    const partner = await this.prisma.partner.update({ where: { id }, data: body });
    await this.audit.record(user, 'partner.update', 'Partner', id, before, partner);
    return partner;
  }
}
