/** Helpers for bulk uploads: Excel cells → CSV text (the API only reads CSV), and a CSV preview. */

export type Cell = string | number | boolean | Date | null | undefined;

/** One cell as plain text. Numbers never use exponent notation; dates become YYYY-MM-DD. */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number')
    return v.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
  return String(v).trim();
}

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Rows of cells → CSV. Trailing empty rows are dropped. */
export function rowsToCsv(rows: Cell[][]): string {
  const text = rows.map((r) => r.map((c) => cellText(c)));
  while (text.length && text[text.length - 1]!.every((c) => c === '')) text.pop();
  return text.map((r) => r.map(quote).join(',')).join('\n') + (text.length ? '\n' : '');
}

/** Small CSV reader for the preview table (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}
