import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@instant-discount/db';
import { PrismaService } from '../../infra/prisma.service';

const SECRET_KEY = /secret|token|hash|password/i;

/** JSON-safe copy with secrets removed and BigInts as numbers. */
function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v) =>
      SECRET_KEY.test(key) ? '[redacted]' : typeof v === 'bigint' ? Number(v) : v,
    ),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    actor: Pick<User, 'id'> | null,
    action: string,
    entityType: string,
    entityId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id,
        action,
        entityType,
        entityId,
        before: sanitize(before),
        after: sanitize(after),
      },
    });
  }
}
