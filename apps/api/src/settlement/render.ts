import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import type { Invoice, InvoiceLine, Partner } from '@instant-discount/db';

const req = createRequire(__filename);
const FONT_LATIN = req.resolve('@fontsource/ar-one-sans/files/ar-one-sans-latin-400-normal.woff');
const FONT_LATIN_BOLD = req.resolve(
  '@fontsource/ar-one-sans/files/ar-one-sans-latin-600-normal.woff',
);
const FONT_ARABIC = req.resolve(
  '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff',
);
const FONT_ARABIC_BOLD = req.resolve(
  '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff',
);

const ORANGE = '#FE5F00';
const INK = '#1A1D23';
const MUTED = '#5F6673';
const LINE = '#EDEFF2';

export type DocumentWithLines = Invoice & { lines: InvoiceLine[]; partner: Partner };

const TITLES: Record<Invoice['type'], { en: string; ar: string; note: string }> = {
  INVOICE: {
    en: 'Tax invoice',
    ar: 'فاتورة ضريبية',
    note: 'Your share of instant discounts granted in this period, payable to Waffarha.',
  },
  PAYOUT_STATEMENT: {
    en: 'Payout statement',
    ar: 'كشف مستحقات',
    note: 'Discount shares funded by others that Waffarha pays you for this period. Your own contribution is shown for information and is not payable.',
  },
  STATEMENT: {
    en: 'Settlement statement',
    ar: 'كشف تسوية',
    note: 'Amounts to be settled directly between the funders and the merchant. No payment is made through Waffarha.',
  },
};

const KIND_LABELS: Record<InvoiceLine['kind'], string> = {
  FUNDED_SHARE: 'Your funded share',
  OWED_BY_FUNDER: 'Owed to you by funder',
  OWN_CONTRIBUTION: 'Your own contribution (not payable)',
};

export function money(minor: bigint | number, currency: string): string {
  const n = Number(minor) / 100;
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TIMEZONE: Record<string, string> = { EG: 'Africa/Cairo', SA: 'Asia/Riyadh' };

/** Calendar date in the document's country (periods are local months). */
const date = (d: Date | null, country: string) =>
  d ? new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE[country] ?? 'UTC' }).format(d) : '—';

/** Inclusive last day of the period, as people read it. */
const lastDay = (end: Date) => new Date(end.getTime() - 1);

/**
 * Draws a right-to-left Arabic phrase ending at the right edge of the box. fontkit shapes each
 * word, but pdfkit does not reorder words or supply a space glyph in the Arabic subset, so
 * words are placed one by one from the right.
 */
function arabicText(
  pdf: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  font: string,
  size: number,
) {
  pdf.font('latin').fontSize(size);
  const space = pdf.widthOfString(' ');
  let cursor = x + width;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    pdf.font(font).fontSize(size);
    const w = pdf.widthOfString(word);
    cursor -= w;
    pdf.text(word, cursor, y, { lineBreak: false });
    cursor -= space;
  }
}

export function renderDocumentPdf(doc: DocumentWithLines): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `${TITLES[doc.type].en} ${doc.number ?? 'DRAFT'}`, Author: 'Waffarha' },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    pdf.registerFont('latin', FONT_LATIN);
    pdf.registerFont('latin-bold', FONT_LATIN_BOLD);
    pdf.registerFont('arabic', FONT_ARABIC);
    pdf.registerFont('arabic-bold', FONT_ARABIC_BOLD);
    const left = 48;
    const width = pdf.page.width - 96;
    const title = TITLES[doc.type];

    // Header
    pdf.font('latin-bold').fontSize(20).fillColor(ORANGE).text('Waffarha', left, 48);
    pdf.font('latin').fontSize(9).fillColor(MUTED).text('Instant Discount', left, 72);
    pdf
      .font('latin-bold')
      .fontSize(16)
      .fillColor(INK)
      .text(title.en, left, 48, { width, align: 'right' });
    pdf.fillColor(INK);
    arabicText(pdf, title.ar, left, 70, width, 'arabic-bold', 14);

    if (doc.status === 'DRAFT') {
      pdf
        .save()
        .rotate(-30, { origin: [300, 420] })
        .font('latin-bold')
        .fontSize(90)
        .fillColor(LINE)
        .text('DRAFT', 120, 380)
        .restore();
    }
    if (doc.status === 'VOID') {
      pdf
        .save()
        .rotate(-30, { origin: [300, 420] })
        .font('latin-bold')
        .fontSize(90)
        .fillColor('#F6D2CC')
        .text('VOID', 150, 380)
        .restore();
    }

    // Meta
    let y = 110;
    const meta: Array<[string, string]> = [
      ['Number', doc.number ?? 'Not issued yet'],
      [
        'Period',
        `${date(doc.periodStart, doc.country)} to ${date(lastDay(doc.periodEnd), doc.country)}`,
      ],
      ['Issued', date(doc.issuedAt, doc.country)],
      ...(doc.type === 'INVOICE'
        ? ([['Due', date(doc.dueAt, doc.country)]] as Array<[string, string]>)
        : []),
      ['Status', doc.status],
    ];
    for (const [k, v] of meta) {
      pdf.font('latin').fontSize(9).fillColor(MUTED).text(k, left, y);
      pdf
        .font('latin')
        .fontSize(9)
        .fillColor(INK)
        .text(v, left + 70, y);
      y += 14;
    }

    // Partner
    const px = left + width / 2 + 20;
    let py = 110;
    pdf
      .font('latin')
      .fontSize(9)
      .fillColor(MUTED)
      .text(doc.type === 'INVOICE' ? 'Bill to' : 'Partner', px, py);
    py += 14;
    pdf
      .font('latin-bold')
      .fontSize(11)
      .fillColor(INK)
      .text(doc.partner.name, px, py, { width: width / 2 - 20 });
    py += 16;
    if (doc.partner.nameAr) {
      arabicText(pdf, doc.partner.nameAr, px, py, width / 2 - 20, 'arabic', 11);
      py += 16;
    }
    pdf.font('latin').fontSize(9).fillColor(MUTED);
    if (doc.partner.taxNumber) (pdf.text(`Tax no. ${doc.partner.taxNumber}`, px, py), (py += 13));
    if (doc.partner.billingEmail) (pdf.text(doc.partner.billingEmail, px, py), (py += 13));

    // Lines
    y = Math.max(y, py) + 24;
    const cols = [
      { label: 'Campaign', w: 0.3, align: 'left' as const },
      { label: 'Counterparty', w: 0.2, align: 'left' as const },
      { label: 'Count', w: 0.1, align: 'right' as const },
      { label: 'Gross', w: 0.13, align: 'right' as const },
      { label: 'Reversed', w: 0.13, align: 'right' as const },
      { label: 'Net', w: 0.14, align: 'right' as const },
    ];
    const row = (cells: string[], opts: { bold?: boolean; color?: string } = {}) => {
      let x = left;
      const h = 18;
      if (y > pdf.page.height - 140) {
        pdf.addPage();
        y = 48;
      }
      cells.forEach((cell, i) => {
        const c = cols[i]!;
        pdf
          .font(opts.bold ? 'latin-bold' : 'latin')
          .fontSize(8.5)
          .fillColor(opts.color ?? INK)
          .text(cell, x + 2, y + 5, {
            width: c.w * width - 4,
            align: c.align,
            lineBreak: false,
            ellipsis: true,
          });
        x += c.w * width;
      });
      y += h;
      pdf
        .moveTo(left, y)
        .lineTo(left + width, y)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
    };

    row(
      cols.map((c) => c.label),
      { bold: true, color: MUTED },
    );
    for (const kind of ['FUNDED_SHARE', 'OWED_BY_FUNDER', 'OWN_CONTRIBUTION'] as const) {
      const lines = doc.lines.filter((l) => l.kind === kind);
      if (!lines.length) continue;
      y += 6;
      pdf
        .font('latin-bold')
        .fontSize(8.5)
        .fillColor(ORANGE)
        .text(KIND_LABELS[kind], left + 2, y);
      y += 12;
      for (const l of lines) {
        row(
          [
            l.campaignName,
            l.counterpartyName ?? '—',
            String(l.redemptionCount),
            money(l.grossMinor, doc.currency),
            money(-l.reversedMinor, doc.currency),
            money(l.netMinor, doc.currency),
          ],
          {
            color: kind === 'OWN_CONTRIBUTION' ? MUTED : INK,
          },
        );
      }
    }

    // Totals
    y += 16;
    const totals: Array<[string, string, boolean]> = [
      ['Subtotal', money(doc.subtotalMinor, doc.currency), false],
      ...(doc.type === 'INVOICE'
        ? ([[`VAT ${doc.vatBps / 100}%`, money(doc.vatMinor, doc.currency), false]] as Array<
            [string, string, boolean]
          >)
        : []),
      [
        doc.type === 'INVOICE'
          ? 'Total due'
          : doc.type === 'PAYOUT_STATEMENT'
            ? 'Total payable to you'
            : 'Total to settle',
        money(doc.totalMinor, doc.currency),
        true,
      ],
    ];
    for (const [k, v, bold] of totals) {
      pdf
        .font(bold ? 'latin-bold' : 'latin')
        .fontSize(bold ? 11 : 9.5)
        .fillColor(INK)
        .text(k, left + width * 0.5, y, { width: width * 0.3, align: 'right' });
      pdf.text(v, left + width * 0.8, y, { width: width * 0.2, align: 'right' });
      y += bold ? 18 : 14;
    }

    // Footer
    pdf
      .font('latin')
      .fontSize(8)
      .fillColor(MUTED)
      .text(title.note, left, pdf.page.height - 96, { width });
    pdf.text(
      'Funded shares are computed per redemption at the time of payment. Refunds are reversed in the period in which they happen.',
      left,
      pdf.page.height - 72,
      { width },
    );
    pdf.end();
  });
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderDocumentCsv(doc: DocumentWithLines): string {
  const header = [
    'document_number',
    'type',
    'partner',
    'period_start',
    'period_end',
    'line_kind',
    'campaign',
    'counterparty',
    'redemptions',
    'gross',
    'reversed',
    'net',
    'currency',
  ];
  const rows = doc.lines.map((l) => [
    doc.number ?? 'DRAFT',
    doc.type,
    doc.partner.name,
    date(doc.periodStart, doc.country),
    date(lastDay(doc.periodEnd), doc.country),
    l.kind,
    l.campaignName,
    l.counterpartyName ?? '',
    l.redemptionCount,
    (Number(l.grossMinor) / 100).toFixed(2),
    (Number(l.reversedMinor) / 100).toFixed(2),
    (Number(l.netMinor) / 100).toFixed(2),
    doc.currency,
  ]);
  const totals = [
    [
      '',
      '',
      '',
      '',
      '',
      'SUBTOTAL',
      '',
      '',
      '',
      '',
      '',
      (Number(doc.subtotalMinor) / 100).toFixed(2),
      doc.currency,
    ],
    [
      '',
      '',
      '',
      '',
      '',
      `VAT_${doc.vatBps}BPS`,
      '',
      '',
      '',
      '',
      '',
      (Number(doc.vatMinor) / 100).toFixed(2),
      doc.currency,
    ],
    [
      '',
      '',
      '',
      '',
      '',
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      (Number(doc.totalMinor) / 100).toFixed(2),
      doc.currency,
    ],
  ];
  return [header, ...rows, ...totals].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
