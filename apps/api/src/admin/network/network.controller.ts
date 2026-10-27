import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { User } from '@instant-discount/db';
import { z } from 'zod';
import { notFound, unprocessable } from '../../common/api-error';
import { ZodPipe } from '../../common/zod-pipe';
import { PrismaService } from '../../infra/prisma.service';
import { AdminAuthGuard, CurrentUser } from '../auth/admin-auth.guard';
import { EDITORS, Roles } from '../auth/roles';
import { AuditService } from '../common/audit.service';
import { optionalQueryString, pageArgs, pageQuery, toPage } from '../common/pagination';
import { parseTerminalCsv, type RowError } from './terminal-import';

const mcc = z.string().regex(/^\d{4}$/, 'must be 4 digits');
const merchantInput = z.object({
  partnerId: z.string().uuid(),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  country: z.enum(['EG', 'SA']),
  mcc,
});
const merchantUpdate = merchantInput.pick({ name: true, nameAr: true, mcc: true }).partial();
const branchInput = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(100).optional(),
});
const terminalInput = z.object({
  acquirerId: z.string().uuid(),
  externalTerminalId: z.string().min(1).max(64),
  merchantId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  mcc: mcc.optional(),
});
const terminalUpdate = z.object({
  active: z.boolean().optional(),
  branchId: z.string().uuid().nullable().optional(),
  mcc: mcc.nullable().optional(),
});
const importInput = z.object({
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().default(true),
});
const merchantQuery = pageQuery.extend({
  partnerId: optionalQueryString,
  country: z.enum(['EG', 'SA']).optional(),
  q: optionalQueryString,
});
const terminalQuery = pageQuery.extend({
  merchantId: optionalQueryString,
  acquirerId: optionalQueryString,
  q: optionalQueryString,
});

@Controller('admin/v1')
@UseGuards(AdminAuthGuard)
export class NetworkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('merchants')
  async listMerchants(@Query(new ZodPipe(merchantQuery)) q: z.infer<typeof merchantQuery>) {
    const where = {
      partnerId: q.partnerId,
      country: q.country,
      name: q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true } },
          _count: { select: { branches: true, terminals: true } },
        },
        orderBy: { name: 'asc' },
        ...pageArgs(q),
      }),
      this.prisma.merchant.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Get('merchants/:id')
  async getMerchant(@Param('id') id: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: { partner: true, branches: { orderBy: { name: 'asc' } } },
    });
    if (!merchant) throw notFound('MERCHANT_NOT_FOUND', 'No such merchant');
    return merchant;
  }

  @Roles(...EDITORS)
  @Post('merchants')
  async createMerchant(
    @CurrentUser() user: User,
    @Body(new ZodPipe(merchantInput)) body: z.infer<typeof merchantInput>,
  ) {
    const partner = await this.prisma.partner.findUnique({ where: { id: body.partnerId } });
    if (!partner || partner.type !== 'MERCHANT') {
      throw unprocessable('INVALID_PARTNER', 'partnerId must be a MERCHANT partner');
    }
    if (partner.country !== body.country)
      throw unprocessable('COUNTRY_MISMATCH', 'Merchant and partner must be in the same country');
    const merchant = await this.prisma.merchant.create({ data: body });
    await this.audit.record(user, 'merchant.create', 'Merchant', merchant.id, undefined, merchant);
    return merchant;
  }

  @Roles(...EDITORS)
  @Patch('merchants/:id')
  async updateMerchant(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(merchantUpdate)) body: z.infer<typeof merchantUpdate>,
  ) {
    const before = await this.prisma.merchant.findUnique({ where: { id } });
    if (!before) throw notFound('MERCHANT_NOT_FOUND', 'No such merchant');
    const merchant = await this.prisma.merchant.update({ where: { id }, data: body });
    await this.audit.record(user, 'merchant.update', 'Merchant', id, before, merchant);
    return merchant;
  }

  @Roles(...EDITORS)
  @Post('merchants/:id/branches')
  async createBranch(
    @CurrentUser() user: User,
    @Param('id') merchantId: string,
    @Body(new ZodPipe(branchInput)) body: z.infer<typeof branchInput>,
  ) {
    if (!(await this.prisma.merchant.findUnique({ where: { id: merchantId } }))) {
      throw notFound('MERCHANT_NOT_FOUND', 'No such merchant');
    }
    const branch = await this.prisma.branch.create({ data: { ...body, merchantId } });
    await this.audit.record(user, 'branch.create', 'Branch', branch.id, undefined, branch);
    return branch;
  }

  @Get('terminals')
  async listTerminals(@Query(new ZodPipe(terminalQuery)) q: z.infer<typeof terminalQuery>) {
    const where = {
      merchantId: q.merchantId,
      acquirerId: q.acquirerId,
      externalTerminalId: q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.terminal.findMany({
        where,
        include: {
          merchant: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          acquirer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.terminal.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Roles(...EDITORS)
  @Post('terminals')
  async createTerminal(
    @CurrentUser() user: User,
    @Body(new ZodPipe(terminalInput)) body: z.infer<typeof terminalInput>,
  ) {
    await this.checkBranch(body.merchantId, body.branchId);
    const exists = await this.prisma.terminal.findUnique({
      where: {
        acquirerId_externalTerminalId: {
          acquirerId: body.acquirerId,
          externalTerminalId: body.externalTerminalId,
        },
      },
    });
    if (exists)
      throw unprocessable(
        'DUPLICATE_TERMINAL',
        'This acquirer already has a terminal with that TID',
      );
    const terminal = await this.prisma.terminal.create({ data: body });
    await this.audit.record(user, 'terminal.create', 'Terminal', terminal.id, undefined, terminal);
    return terminal;
  }

  @Roles(...EDITORS)
  @Patch('terminals/:id')
  async updateTerminal(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(terminalUpdate)) body: z.infer<typeof terminalUpdate>,
  ) {
    const before = await this.prisma.terminal.findUnique({ where: { id } });
    if (!before) throw notFound('TERMINAL_NOT_FOUND', 'No such terminal');
    if (body.branchId) await this.checkBranch(before.merchantId, body.branchId);
    const terminal = await this.prisma.terminal.update({ where: { id }, data: body });
    await this.audit.record(user, 'terminal.update', 'Terminal', id, before, terminal);
    return terminal;
  }

  /**
   * Bulk terminal import. With dryRun (default) nothing is written and every row is validated;
   * otherwise rows are upserted by (acquirer, TID) in one transaction, and only if there are no errors.
   */
  @Roles(...EDITORS)
  @Post('terminals/import')
  async importTerminals(
    @CurrentUser() user: User,
    @Body(new ZodPipe(importInput)) body: z.infer<typeof importInput>,
  ) {
    const { rows, errors } = parseTerminalCsv(body.csv);
    const [acquirers, merchants, branches] = await Promise.all([
      this.prisma.acquirer.findMany({
        where: { apiKeyId: { in: [...new Set(rows.map((r) => r.acquirerApiKey))] } },
      }),
      this.prisma.merchant.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.merchantId))] } },
      }),
      this.prisma.branch.findMany({
        where: { id: { in: rows.flatMap((r) => (r.branchId ? [r.branchId] : [])) } },
      }),
    ]);
    const acquirerByKey = new Map(acquirers.map((a) => [a.apiKeyId, a]));
    const merchantIds = new Set(merchants.map((m) => m.id));
    const branchMerchant = new Map(branches.map((b) => [b.id, b.merchantId]));

    const valid: Array<{
      acquirerId: string;
      externalTerminalId: string;
      merchantId: string;
      branchId?: string;
      mcc?: string;
    }> = [];
    const rowErrors: RowError[] = [...errors];
    for (const r of rows) {
      const acquirer = acquirerByKey.get(r.acquirerApiKey);
      if (!acquirer)
        rowErrors.push({ line: r.line, message: `Unknown acquirer_api_key ${r.acquirerApiKey}` });
      else if (!merchantIds.has(r.merchantId))
        rowErrors.push({ line: r.line, message: `Unknown merchant_id ${r.merchantId}` });
      else if (r.branchId && branchMerchant.get(r.branchId) !== r.merchantId) {
        rowErrors.push({
          line: r.line,
          message: `branch_id ${r.branchId} does not belong to the merchant`,
        });
      } else {
        valid.push({
          acquirerId: acquirer.id,
          externalTerminalId: r.tid,
          merchantId: r.merchantId,
          branchId: r.branchId,
          mcc: r.mcc,
        });
      }
    }
    rowErrors.sort((a, b) => a.line - b.line);

    if (body.dryRun || rowErrors.length > 0) {
      return { dryRun: true, valid: valid.length, errors: rowErrors, imported: 0 };
    }
    await this.prisma.$transaction(
      valid.map((t) =>
        this.prisma.terminal.upsert({
          where: {
            acquirerId_externalTerminalId: {
              acquirerId: t.acquirerId,
              externalTerminalId: t.externalTerminalId,
            },
          },
          update: { merchantId: t.merchantId, branchId: t.branchId ?? null, mcc: t.mcc ?? null },
          create: t,
        }),
      ),
    );
    await this.audit.record(user, 'terminal.import', 'Terminal', 'bulk', undefined, {
      count: valid.length,
    });
    return { dryRun: false, valid: valid.length, errors: [], imported: valid.length };
  }

  private async checkBranch(merchantId: string, branchId?: string) {
    if (!(await this.prisma.merchant.findUnique({ where: { id: merchantId } }))) {
      throw unprocessable('INVALID_MERCHANT', 'Unknown merchant');
    }
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch || branch.merchantId !== merchantId) {
        throw unprocessable('INVALID_BRANCH', 'Branch does not belong to the merchant');
      }
    }
  }
}
