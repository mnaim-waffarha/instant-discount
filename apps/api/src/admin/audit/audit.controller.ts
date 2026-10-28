import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { ZodPipe } from '../../common/zod-pipe';
import { PrismaService } from '../../infra/prisma.service';
import { Roles } from '../auth/roles';
import { optionalQueryString, pageArgs, pageQuery, toPage } from '../common/pagination';

const auditQuery = pageQuery.extend({
  entityType: optionalQueryString,
  entityId: optionalQueryString,
  actorId: optionalQueryString,
});

@Controller('admin/v1/audit')
@UseGuards(AdminAuthGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('ADMIN', 'APPROVER', 'FINANCE')
  @Get()
  async list(@Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    const where = { entityType: q.entityType, entityId: q.entityId, actorId: q.actorId };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))] } },
      select: { id: true, email: true, name: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return toPage(
      rows.map((r) => ({ ...r, actor: r.actorId ? (byId.get(r.actorId) ?? null) : null })),
      total,
      q,
    );
  }
}
