import { describe, expect, it } from 'vitest';
import { buildDocuments, vatOn, type EntryForDocs } from './documents';

let n = 0;
function entry(o: Partial<EntryForDocs>): EntryForDocs {
  return {
    id: `e${++n}`,
    campaignId: 'c1',
    settlementMode: 'WAFFARHA_COLLECTS',
    partnerId: 'bank',
    partnerType: 'BANK',
    merchantPartnerId: 'cafe',
    currency: 'EGP',
    amountMinor: 0,
    countDelta: 1,
    funderDocumentId: null,
    merchantDocumentId: null,
    ...o,
  };
}

/** One confirmed redemption funded 50% bank / 30% merchant / 20% Waffarha (discount 10_000). */
function redemption(mode: EntryForDocs['settlementMode']) {
  return [
    entry({ settlementMode: mode, partnerId: 'bank', partnerType: 'BANK', amountMinor: 5_000 }),
    entry({ settlementMode: mode, partnerId: 'cafe', partnerType: 'MERCHANT', amountMinor: 3_000 }),
    entry({
      settlementMode: mode,
      partnerId: 'waffarha',
      partnerType: 'WAFFARHA',
      amountMinor: 2_000,
    }),
  ];
}

describe('buildDocuments', () => {
  it('WAFFARHA_COLLECTS: invoices the bank and pays the merchant the bank + Waffarha shares', () => {
    const docs = buildDocuments(redemption('WAFFARHA_COLLECTS'));
    expect(docs.map((d) => [d.partnerId, d.type, d.subtotalMinor])).toEqual([
      ['bank', 'INVOICE', 5_000],
      ['cafe', 'PAYOUT_STATEMENT', 7_000],
    ]);
    const payout = docs.find((d) => d.type === 'PAYOUT_STATEMENT')!;
    expect(payout.lines.map((l) => [l.kind, l.counterpartyPartnerId, l.netMinor])).toEqual([
      ['OWED_BY_FUNDER', 'bank', 5_000],
      ['OWED_BY_FUNDER', 'waffarha', 2_000],
      ['OWN_CONTRIBUTION', null, 3_000],
    ]);
    expect(payout.merchantEntryIds).toHaveLength(3);
    expect(docs[0]!.funderEntryIds).toHaveLength(1);
  });

  it('DIRECT: statements only, showing who owes the merchant', () => {
    const docs = buildDocuments(redemption('DIRECT'));
    expect(docs.map((d) => [d.partnerId, d.type, d.subtotalMinor])).toEqual([
      ['bank', 'STATEMENT', 5_000],
      ['cafe', 'STATEMENT', 7_000],
    ]);
  });

  it('nets refunds into the period they happen in, and skips already documented sides', () => {
    const docs = buildDocuments([
      entry({ amountMinor: 5_000 }),
      entry({ amountMinor: -2_000, countDelta: 0 }),
      entry({ amountMinor: 1_000, funderDocumentId: 'old', merchantDocumentId: 'old' }),
    ]);
    const invoice = docs.find((d) => d.type === 'INVOICE')!;
    expect(invoice.lines[0]).toMatchObject({
      redemptionCount: 1,
      grossMinor: 5_000,
      reversedMinor: 2_000,
      netMinor: 3_000,
    });
    expect(invoice.funderEntryIds).toHaveLength(2);
  });

  it('computes VAT, including on credits', () => {
    expect(vatOn(10_001, 1_400)).toBe(1_400);
    expect(vatOn(-10_000, 1_500)).toBe(-1_500);
  });
});
