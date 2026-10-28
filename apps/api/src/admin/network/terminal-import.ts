import { parse } from 'csv-parse/sync';

export interface ImportRow {
  line: number;
  acquirerApiKey: string;
  tid: string;
  merchantId: string;
  branchId?: string;
  mcc?: string;
}

export interface RowError {
  line: number;
  message: string;
}

const REQUIRED = ['acquirer_api_key', 'tid', 'merchant_id'] as const;

/** Parses the terminal import CSV (header row required). Shape errors are reported per line. */
export function parseTerminalCsv(csv: string): { rows: ImportRow[]; errors: RowError[] } {
  let records: Array<Record<string, string>>;
  try {
    records = parse(csv, {
      columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    return { rows: [], errors: [{ line: 0, message: `Invalid CSV: ${(err as Error).message}` }] };
  }
  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  records.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const missing = REQUIRED.filter((c) => !r[c]);
    if (missing.length) return errors.push({ line, message: `Missing ${missing.join(', ')}` });
    if (r.mcc && !/^\d{4}$/.test(r.mcc))
      return errors.push({ line, message: 'mcc must be 4 digits' });
    const key = `${r.acquirer_api_key}:${r.tid}`;
    if (seen.has(key)) return errors.push({ line, message: `Duplicate tid ${r.tid} in file` });
    seen.add(key);
    rows.push({
      line,
      acquirerApiKey: r.acquirer_api_key!,
      tid: r.tid!,
      merchantId: r.merchant_id!,
      branchId: r.branch_id || undefined,
      mcc: r.mcc || undefined,
    });
  });
  return { rows, errors };
}
