import { Injectable, Logger } from '@nestjs/common';
import type { Country, Prisma, User } from '@instant-discount/db';
import { COUNTRY_DEFAULTS, monthBounds } from '@instant-discount/shared';
import { conflict, notFound, unprocessable } from '../common/api-error';
import { AuditService } from '../admin/common/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { MailerService } from '../mail/mailer.service';
import { buildDocuments, vatOn, type EntryForDocs } from './documents';
import { ledgerLines } from './ledger';
import { renderDocumentPdf, type DocumentWithLines } from './render';

const LEDGER_EVENT_TYPES = ['CONFIRMED', 'REFUNDED', 'CANCELLED'] as const;
const BATCH = 500;
const INVOICE_DUE_DAYS = 30;
const PREFIX: Record<string, string> = {
  INVOICE: 'INV',
  PAYOUT_STATEMENT: 'PAY',
  STATEMENT: 'STM',
};

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  /** Writes ledger entries for every redemption event not processed yet. Safe to run any time. */
  async buildLedger(): Promise<number> {
    let written = 0;
    for (;;) {
      const pending = await this.prisma.redemptionEvent.findMany({
        where: { ledgerProcessedAt: null, type: { in: [...LEDGER_EVENT_TYPES] } },
        select: { id: true, redemptionId: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      if (pending.length === 0) return written;

      const redemptions = await this.prisma.redemption.findMany({
        where: { id: { in: [...new Set(pending.map((p) => p.redemptionId))] } },
        include: {
          events: { orderBy: { createdAt: 'asc' } },
          campaign: { select: { settlementMode: true, country: true } },
          terminal: { select: { merchant: { select: { partnerId: true } } } },
        },
      });
      const snapshotPartnerIds = new Set(
        redemptions.flatMap((r) =>
          (r.fundingSnapshot as Array<{ partnerId: string }>).map((f) => f.partnerId),
        ),
      );
      const partners = await this.prisma.partner.findMany({
        where: { id: { in: [...snapshotPartnerIds] } },
        select: { id: true, type: true },
      });
      const typeOf = new Map(partners.map((p) => [p.id, p.type]));

      const data: Prisma.SettlementEntryCreateManyInput[] = [];
      for (const r of redemptions) {
        const lines = ledgerLines({
          discountMinor: Number(r.discountMinor),
          fundingSnapshot: r.fundingSnapshot as Array<{
            partnerId: string;
            shareBps: number;
            amountMinor: number;
          }>,
          events: r.events.map((e) => ({
            id: e.id,
            type: e.type,
            discountDeltaMinor: Number(e.discountDeltaMinor),
            createdAt: e.createdAt,
          })),
        });
        for (const l of lines) {
          data.push({
            redemptionEventId: l.eventId,
            redemptionId: r.id,
            campaignId: r.campaignId,
            settlementMode: r.campaign.settlementMode,
            partnerId: l.partnerId,
            partnerType: typeOf.get(l.partnerId) ?? 'BANK',
            merchantPartnerId: r.terminal.merchant.partnerId,
            country: r.campaign.country,
            currency: r.currency,
            amountMinor: l.amountMinor,
            countDelta: l.countDelta,
            eventAt: l.eventAt,
          });
        }
      }
      await this.prisma.$transaction([
        // Re-deriving a redemption reproduces earlier entries exactly; duplicates are skipped.
        this.prisma.settlementEntry.createMany({ data, skipDuplicates: true }),
        this.prisma.redemptionEvent.updateMany({
          where: { id: { in: pending.map((p) => p.id) } },
          data: { ledgerProcessedAt: new Date() },
        }),
      ]);
      written += data.length;
    }
  }

  /**
   * Creates DRAFT documents for a country and month. Re-running replaces the period's drafts,
   * so late events are picked up; issued documents are never touched and anything they did
   * not cover rolls into the next period.
   */
  async generate(country: Country, period: string): Promise<{ created: number; period: string }> {
    const result = await this.redis.withLock(`settlement:${country}`, 120_000, async () => {
      await this.buildLedger();
      const { start, end } = monthBounds(period, COUNTRY_DEFAULTS[country].timezone);

      const drafts = await this.prisma.invoice.findMany({
        where: { country, periodStart: start, status: 'DRAFT' },
        select: { id: true },
      });
      if (drafts.length) {
        const ids = drafts.map((d) => d.id);
        await this.prisma.$transaction([
          this.prisma.settlementEntry.updateMany({
            where: { funderDocumentId: { in: ids } },
            data: { funderDocumentId: null },
          }),
          this.prisma.settlementEntry.updateMany({
            where: { merchantDocumentId: { in: ids } },
            data: { merchantDocumentId: null },
          }),
          this.prisma.invoice.deleteMany({ where: { id: { in: ids } } }),
        ]);
      }

      const rows = await this.prisma.settlementEntry.findMany({
        where: {
          country,
          eventAt: { lt: end },
          OR: [{ funderDocumentId: null }, { merchantDocumentId: null }],
        },
      });
      const entries: EntryForDocs[] = rows.map((r) => ({
        ...r,
        amountMinor: Number(r.amountMinor),
      }));
      const specs = buildDocuments(entries).filter((d) => d.lines.length > 0);
      if (!specs.length) return 0;

      const [campaigns, partners, rate] = await Promise.all([
        this.prisma.campaign.findMany({
          where: { id: { in: [...new Set(entries.map((e) => e.campaignId))] } },
          select: { id: true, name: true },
        }),
        this.prisma.partner.findMany({
          where: {
            id: { in: [...new Set(entries.flatMap((e) => [e.partnerId, e.merchantPartnerId]))] },
          },
          select: { id: true, name: true },
        }),
        this.prisma.taxRate.findFirst({
          where: { country, validFrom: { lte: end } },
          orderBy: { validFrom: 'desc' },
        }),
      ]);
      if (!rate && specs.some((d) => d.type === 'INVOICE')) {
        // Never issue tax invoices with a silently missing VAT rate.
        throw unprocessable(
          'NO_TAX_RATE',
          `No VAT rate is configured for ${country}; add one under tax rates first`,
        );
      }
      const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
      const partnerName = new Map(partners.map((p) => [p.id, p.name]));

      for (const spec of specs) {
        const vatBps = spec.type === 'INVOICE' ? (rate?.rateBps ?? 0) : 0;
        const vatMinor = vatOn(spec.subtotalMinor, vatBps);
        await this.prisma.$transaction(async (tx) => {
          const doc = await tx.invoice.create({
            data: {
              type: spec.type,
              partnerId: spec.partnerId,
              country,
              currency: spec.currency,
              periodStart: start,
              periodEnd: end,
              subtotalMinor: spec.subtotalMinor,
              vatBps,
              vatMinor,
              totalMinor: spec.subtotalMinor + vatMinor,
              lines: {
                create: spec.lines.map((l) => ({
                  ...l,
                  campaignName: campaignName.get(l.campaignId) ?? l.campaignId,
                  counterpartyName: l.counterpartyPartnerId
                    ? (partnerName.get(l.counterpartyPartnerId) ?? null)
                    : null,
                })),
              },
            },
          });
          if (spec.funderEntryIds.length)
            await tx.settlementEntry.updateMany({
              where: { id: { in: spec.funderEntryIds } },
              data: { funderDocumentId: doc.id },
            });
          if (spec.merchantEntryIds.length)
            await tx.settlementEntry.updateMany({
              where: { id: { in: spec.merchantEntryIds } },
              data: { merchantDocumentId: doc.id },
            });
        });
      }
      this.logger.log(`Generated ${specs.length} draft documents for ${country} ${period}`);
      return specs.length;
    });
    if (result === undefined)
      throw conflict(
        'SETTLEMENT_RUNNING',
        'A settlement run for this country is already in progress',
      );
    return { created: result, period };
  }

  async get(id: string): Promise<DocumentWithLines> {
    const doc = await this.prisma.invoice.findUnique({
      where: { id },
      include: { lines: { orderBy: [{ kind: 'asc' }, { campaignName: 'asc' }] }, partner: true },
    });
    if (!doc) throw notFound('DOCUMENT_NOT_FOUND', 'No such document');
    return doc;
  }

  /** Locks the number (gap-free per prefix/country/year) and emails the PDF to the partner. */
  async issue(user: User, id: string) {
    const issued = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        Array<{ status: string }>
      >`SELECT status FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
      if (!locked) throw notFound('DOCUMENT_NOT_FOUND', 'No such document');
      if (locked.status !== 'DRAFT')
        throw conflict('INVALID_STATUS', `Only drafts can be issued (status ${locked.status})`);
      const doc = await tx.invoice.findUniqueOrThrow({ where: { id } });
      const now = new Date();
      const year = now.getUTCFullYear();
      const prefix = PREFIX[doc.type]!;
      const [seq] = await tx.$queryRaw<Array<{ value: number }>>`
        INSERT INTO "DocumentSequence" (prefix, country, year, value) VALUES (${prefix}, ${doc.country}::"Country", ${year}, 1)
        ON CONFLICT (prefix, country, year) DO UPDATE SET value = "DocumentSequence".value + 1
        RETURNING value`;
      return tx.invoice.update({
        where: { id },
        data: {
          status: 'ISSUED',
          number: `${prefix}-${doc.country}-${year}-${String(seq!.value).padStart(6, '0')}`,
          issuedAt: now,
          dueAt:
            doc.type === 'INVOICE' ? new Date(now.getTime() + INVOICE_DUE_DAYS * 86_400_000) : null,
        },
      });
    });
    await this.audit.record(
      user,
      'document.issue',
      'Invoice',
      id,
      { status: 'DRAFT' },
      { status: issued.status, number: issued.number },
    );
    await this.emailDocument(id).catch((err) =>
      this.logger.error(`Could not email document ${id}: ${String(err)}`),
    );
    return this.get(id);
  }

  async markPaid(user: User, id: string, paidAt: Date, reference?: string) {
    const doc = await this.get(id);
    if (doc.type === 'STATEMENT')
      throw conflict('NOT_PAYABLE', 'Statements are settled outside Waffarha');
    if (doc.status !== 'ISSUED' && doc.status !== 'OVERDUE')
      throw conflict('INVALID_STATUS', `Cannot mark a ${doc.status} document as paid`);
    await this.prisma.invoice.update({
      where: { id },
      data: { status: 'PAID', paidAt, paymentRef: reference },
    });
    await this.audit.record(
      user,
      'document.paid',
      'Invoice',
      id,
      { status: doc.status },
      { status: 'PAID', paidAt, reference },
    );
    return this.get(id);
  }

  /** Voids a document; its entries are released and will be included in the next run. */
  async void(user: User, id: string, reason: string) {
    const doc = await this.get(id);
    if (doc.status === 'PAID' || doc.status === 'VOID')
      throw conflict('INVALID_STATUS', `Cannot void a ${doc.status} document`);
    await this.prisma.$transaction([
      this.prisma.settlementEntry.updateMany({
        where: { funderDocumentId: id },
        data: { funderDocumentId: null },
      }),
      this.prisma.settlementEntry.updateMany({
        where: { merchantDocumentId: id },
        data: { merchantDocumentId: null },
      }),
      this.prisma.invoice.update({ where: { id }, data: { status: 'VOID', voidReason: reason } }),
    ]);
    await this.audit.record(
      user,
      'document.void',
      'Invoice',
      id,
      { status: doc.status },
      { status: 'VOID', reason },
    );
    return this.get(id);
  }

  async markOverdue(): Promise<number> {
    const r = await this.prisma.invoice.updateMany({
      where: { status: 'ISSUED', type: 'INVOICE', dueAt: { lt: new Date() } },
      data: { status: 'OVERDUE' },
    });
    return r.count;
  }

  /** Per-partner totals from the ledger for a period (what documents will be built from). */
  async overview(country: Country, period: string) {
    await this.buildLedger();
    const { start, end } = monthBounds(period, COUNTRY_DEFAULTS[country].timezone);
    const grouped = await this.prisma.settlementEntry.groupBy({
      by: ['partnerId', 'partnerType', 'settlementMode', 'currency'],
      where: { country, eventAt: { gte: start, lt: end } },
      _sum: { amountMinor: true, countDelta: true },
    });
    const partners = await this.prisma.partner.findMany({
      where: { id: { in: grouped.map((g) => g.partnerId) } },
      select: { id: true, name: true },
    });
    const name = new Map(partners.map((p) => [p.id, p.name]));
    return {
      country,
      period,
      periodStart: start,
      periodEnd: end,
      funders: grouped
        .map((g) => ({
          partnerId: g.partnerId,
          partnerName: name.get(g.partnerId) ?? g.partnerId,
          partnerType: g.partnerType,
          settlementMode: g.settlementMode,
          currency: g.currency,
          fundedMinor: Number(g._sum.amountMinor ?? 0n),
          redemptions: g._sum.countDelta ?? 0,
        }))
        .sort((a, b) => b.fundedMinor - a.fundedMinor),
    };
  }

  private async emailDocument(id: string) {
    const doc = await this.get(id);
    if (!doc.partner.billingEmail) return;
    const pdf = await renderDocumentPdf(doc);
    await this.mailer.send({
      to: doc.partner.billingEmail,
      subject: `Waffarha ${doc.type === 'INVOICE' ? 'invoice' : 'statement'} ${doc.number}`,
      text: `Dear ${doc.partner.name},\n\nPlease find attached ${doc.number} for ${doc.periodStart.toISOString().slice(0, 7)}.\nTotal: ${doc.currency} ${(Number(doc.totalMinor) / 100).toFixed(2)}\n\nYou can also download it from the Waffarha partner portal.\n`,
      attachments: [
        { filename: `${doc.number}.pdf`, content: pdf, contentType: 'application/pdf' },
      ],
    });
  }
}
