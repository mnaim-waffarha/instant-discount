import type { DocumentLineKind, DocumentType } from '@instant-discount/db';

export interface EntryForDocs {
  id: string;
  campaignId: string;
  settlementMode: 'WAFFARHA_COLLECTS' | 'DIRECT';
  partnerId: string;
  partnerType: 'BANK' | 'MERCHANT' | 'WAFFARHA';
  merchantPartnerId: string;
  currency: 'EGP' | 'SAR';
  amountMinor: number;
  countDelta: number;
  funderDocumentId: string | null;
  merchantDocumentId: string | null;
}

export interface LineSpec {
  kind: DocumentLineKind;
  campaignId: string;
  counterpartyPartnerId: string | null;
  redemptionCount: number;
  grossMinor: number;
  reversedMinor: number;
  netMinor: number;
}

export interface DocumentSpec {
  partnerId: string;
  type: DocumentType;
  currency: 'EGP' | 'SAR';
  lines: LineSpec[];
  /** Entries this document covers on the funder side / merchant side. */
  funderEntryIds: string[];
  merchantEntryIds: string[];
  /** Sum of payable lines (own contributions are informational). */
  subtotalMinor: number;
}

/** Does this entry produce a funder-side document? Waffarha and a merchant funding itself do not. */
export function hasFunderSide(
  e: Pick<EntryForDocs, 'partnerType' | 'partnerId' | 'merchantPartnerId'>,
) {
  return e.partnerType !== 'WAFFARHA' && e.partnerId !== e.merchantPartnerId;
}

/**
 * Groups undocumented ledger entries into documents:
 *
 * WAFFARHA_COLLECTS campaigns
 *   - each external funder (bank) gets an INVOICE for its share (it owes Waffarha);
 *   - the merchant gets a PAYOUT_STATEMENT: the bank and Waffarha shares Waffarha pays it,
 *     plus its own contribution as information.
 * DIRECT campaigns
 *   - each external funder gets a STATEMENT of what it owes the merchant;
 *   - the merchant gets a STATEMENT of what each funder owes it.
 */
export function buildDocuments(entries: EntryForDocs[]): DocumentSpec[] {
  const docs = new Map<string, DocumentSpec & { lineMap: Map<string, LineSpec> }>();

  const add = (
    partnerId: string,
    type: DocumentType,
    e: EntryForDocs,
    kind: DocumentLineKind,
    counterparty: string | null,
    side: 'funder' | 'merchant',
  ) => {
    const key = `${partnerId}|${type}|${e.currency}`;
    let doc = docs.get(key);
    if (!doc) {
      doc = {
        partnerId,
        type,
        currency: e.currency,
        lines: [],
        funderEntryIds: [],
        merchantEntryIds: [],
        subtotalMinor: 0,
        lineMap: new Map(),
      };
      docs.set(key, doc);
    }
    const lineKey = `${kind}|${e.campaignId}|${counterparty ?? ''}`;
    let line = doc.lineMap.get(lineKey);
    if (!line) {
      line = {
        kind,
        campaignId: e.campaignId,
        counterpartyPartnerId: counterparty,
        redemptionCount: 0,
        grossMinor: 0,
        reversedMinor: 0,
        netMinor: 0,
      };
      doc.lineMap.set(lineKey, line);
    }
    line.redemptionCount += e.countDelta;
    if (e.amountMinor >= 0) line.grossMinor += e.amountMinor;
    else line.reversedMinor += -e.amountMinor;
    line.netMinor += e.amountMinor;
    if (kind !== 'OWN_CONTRIBUTION') doc.subtotalMinor += e.amountMinor;
    (side === 'funder' ? doc.funderEntryIds : doc.merchantEntryIds).push(e.id);
  };

  for (const e of entries) {
    const collects = e.settlementMode === 'WAFFARHA_COLLECTS';
    if (e.funderDocumentId === null && hasFunderSide(e)) {
      add(
        e.partnerId,
        collects ? 'INVOICE' : 'STATEMENT',
        e,
        'FUNDED_SHARE',
        e.merchantPartnerId,
        'funder',
      );
    }
    if (e.merchantDocumentId === null) {
      const own = e.partnerId === e.merchantPartnerId;
      add(
        e.merchantPartnerId,
        collects ? 'PAYOUT_STATEMENT' : 'STATEMENT',
        e,
        own ? 'OWN_CONTRIBUTION' : 'OWED_BY_FUNDER',
        own ? null : e.partnerId,
        'merchant',
      );
    }
  }

  return [...docs.values()].map(({ lineMap, ...doc }) => ({
    ...doc,
    lines: [...lineMap.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.campaignId.localeCompare(b.campaignId),
    ),
  }));
}

/** VAT on a document subtotal, rounded half up; negative subtotals (credits) get negative VAT. */
export function vatOn(subtotalMinor: number, rateBps: number): number {
  const v = Math.round((Math.abs(subtotalMinor) * rateBps) / 10_000);
  return subtotalMinor < 0 ? -v : v;
}
