import { parseCsv, type RowError } from './csv-import';

export interface BranchRow {
  line: number;
  name: string;
  city?: string;
}

/**
 * Parses a branch import CSV (`name`, optional `city`) for one merchant. Names must be unique
 * within the file and must not match a branch the merchant already has (case-insensitive).
 */
export function parseBranchCsv(
  csv: string,
  existingNames: string[],
): { rows: BranchRow[]; errors: RowError[] } {
  const { records, errors } = parseCsv(csv, ['name']);
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();
  const rows: BranchRow[] = [];
  for (const { line, values: r } of records) {
    const name = r.name!;
    const key = name.toLowerCase();
    if (name.length > 200) errors.push({ line, message: 'name is longer than 200 characters' });
    else if ((r.city ?? '').length > 100)
      errors.push({ line, message: 'city is longer than 100 characters' });
    else if (seen.has(key)) errors.push({ line, message: `Duplicate branch "${name}" in file` });
    else if (taken.has(key)) errors.push({ line, message: `Branch "${name}" already exists` });
    else {
      seen.add(key);
      rows.push({ line, name, city: r.city || undefined });
    }
  }
  errors.sort((a, b) => a.line - b.line);
  return { rows, errors };
}
