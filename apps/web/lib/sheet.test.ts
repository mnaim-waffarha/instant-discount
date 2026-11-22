import { describe, expect, it } from 'vitest';
import { cellText, parseCsv, rowsToCsv } from './sheet';

describe('sheet helpers', () => {
  it('turns Excel cells into plain text', () => {
    expect(cellText(5812)).toBe('5812');
    expect(cellText(12345678901234567)).toBe('12345678901234568');
    expect(cellText(1e21)).toBe('1000000000000000000000');
    expect(cellText(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
    expect(cellText(null)).toBe('');
    expect(cellText('  Maadi ')).toBe('Maadi');
  });

  it('writes CSV with quoting and drops trailing empty rows', () => {
    expect(
      rowsToCsv([
        ['name', 'city'],
        ['Smouha, Alex', 'He said "hi"'],
        [null, null],
      ]),
    ).toBe('name,city\n"Smouha, Alex","He said ""hi"""\n');
  });

  it('reads CSV back, including quotes, CRLF, BOM and blank lines', () => {
    expect(parseCsv('\uFEFFname,city\r\n"Smouha, Alex","a ""b"""\r\n\r\nMaadi,\n')).toEqual([
      ['name', 'city'],
      ['Smouha, Alex', 'a "b"'],
      ['Maadi', ''],
    ]);
  });

  it('round-trips through CSV', () => {
    const rows = [
      ['tid', 'note'],
      ['00123', 'line1\nline2'],
    ];
    expect(parseCsv(rowsToCsv(rows))).toEqual(rows);
  });
});
