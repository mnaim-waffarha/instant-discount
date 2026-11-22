import { parseCsv, type RowError } from './csv-import';

export type { RowError } from './csv-import';

export interface ImportRow {
  line: number;
  acquirerApiKey: string;
  tid: string;
  merchantId: string;
  branchId?: string;
  mcc?: string;
}

/** Parses the terminal import CSV (header row required). Shape errors are reported per line. */
export function parseTerminalCsv(csv: string): { rows: ImportRow[]; errors: RowError[] } {
  const { records, errors } = parseCsv(csv, ['acquirer_api_key', 'tid', 'merchant_id']);
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  for (const { line, values: r } of records) {
    if (r.mcc && !/^\d{4}$/.test(r.mcc)) {
      errors.push({ line, message: 'mcc must be 4 digits' });
      continue;
    }
    const key = `${r.acquirer_api_key}:${r.tid}`;
    if (seen.has(key)) {
      errors.push({ line, message: `Duplicate tid ${r.tid} in file` });
      continue;
    }
    seen.add(key);
    rows.push({
      line,
      acquirerApiKey: r.acquirer_api_key!,
      tid: r.tid!,
      merchantId: r.merchant_id!,
      branchId: r.branch_id || undefined,
      mcc: r.mcc || undefined,
    });
  }
  errors.sort((a, b) => a.line - b.line);
  return { rows, errors };
}
