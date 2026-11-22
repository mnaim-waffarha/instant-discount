import { parse } from 'csv-parse/sync';

export interface RowError {
  /** Line in the file as the user sees it (the header is line 1). */
  line: number;
  message: string;
}

export interface CsvRecord {
  line: number;
  values: Record<string, string>;
}

/**
 * Parses an import CSV with a header row (BOM, surrounding spaces and empty lines are ignored;
 * header names are case-insensitive). Rows missing a required column are reported, not returned.
 */
export function parseCsv(
  csv: string,
  required: readonly string[],
): { records: CsvRecord[]; errors: RowError[] } {
  let rows: Array<Record<string, string>>;
  try {
    rows = parse(csv, {
      columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    return {
      records: [],
      errors: [{ line: 0, message: `Invalid CSV: ${(err as Error).message}` }],
    };
  }
  const records: CsvRecord[] = [];
  const errors: RowError[] = [];
  rows.forEach((values, i) => {
    const line = i + 2; // header is line 1
    const missing = required.filter((c) => !values[c]);
    if (missing.length) errors.push({ line, message: `Missing ${missing.join(', ')}` });
    else records.push({ line, values });
  });
  return { records, errors };
}
