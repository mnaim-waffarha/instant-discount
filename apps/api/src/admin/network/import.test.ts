import { describe, expect, it } from 'vitest';
import { parseBranchCsv } from './branch-import';
import { parseCsv } from './csv-import';
import { parseTerminalCsv } from './terminal-import';

describe('parseCsv', () => {
  it('reads a header row case-insensitively, ignoring BOM, spaces and blank lines', () => {
    const { records, errors } = parseCsv('\uFEFF Name , CITY\n Zamalek , Cairo \n\n,Giza\n', [
      'name',
    ]);
    expect(records).toEqual([{ line: 2, values: { name: 'Zamalek', city: 'Cairo' } }]);
    expect(errors).toEqual([{ line: 3, message: 'Missing name' }]);
  });

  it('reports malformed CSV instead of throwing', () => {
    expect(parseCsv('name\n"unclosed', ['name']).errors[0]!.message).toMatch(/^Invalid CSV/);
  });
});

describe('parseBranchCsv', () => {
  it('rejects duplicates in the file and names the merchant already has', () => {
    const csv = 'name,city\nMaadi,Cairo\nmaadi,Cairo\nZamalek,Cairo\nNasr City,\n';
    const { rows, errors } = parseBranchCsv(csv, ['ZAMALEK']);
    expect(rows).toEqual([
      { line: 2, name: 'Maadi', city: 'Cairo' },
      { line: 5, name: 'Nasr City', city: undefined },
    ]);
    expect(errors.map((e) => e.line)).toEqual([3, 4]);
    expect(errors[1]!.message).toContain('already exists');
  });

  it('enforces the same length limits as the single-branch form', () => {
    const { errors } = parseBranchCsv(
      `name,city\n${'x'.repeat(201)},\nOk,${'y'.repeat(101)}\n`,
      [],
    );
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

describe('parseTerminalCsv', () => {
  it('keeps its rules: required columns, 4-digit MCC, unique TID per acquirer', () => {
    const csv =
      'acquirer_api_key,tid,merchant_id,mcc\nacq,T1,m1,5812\nacq,T2,m1,58\nacq,T1,m1,\n,T3,m1,\n';
    const { rows, errors } = parseTerminalCsv(csv);
    expect(rows.map((r) => r.tid)).toEqual(['T1']);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });
});
