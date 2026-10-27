import { describe, expect, it } from 'vitest';
import { formatMoney, fromMinor, toMinor, utcToZoned, zonedToUtc } from './format';

describe('timezone conversion', () => {
  it('reads a wall-clock time in the campaign timezone, not the browser one', () => {
    // Cairo is UTC+3 in summer time (until late Oct 2026) and UTC+2 after.
    expect(zonedToUtc('2026-07-01T09:00', 'Africa/Cairo').toISOString()).toBe(
      '2026-07-01T06:00:00.000Z',
    );
    expect(zonedToUtc('2026-12-01T09:00', 'Africa/Cairo').toISOString()).toBe(
      '2026-12-01T07:00:00.000Z',
    );
    expect(zonedToUtc('2026-12-01T09:00', 'Asia/Riyadh').toISOString()).toBe(
      '2026-12-01T06:00:00.000Z',
    );
  });

  it('round-trips', () => {
    for (const local of ['2026-03-15T00:00', '2026-10-29T23:30', '2027-01-01T12:45']) {
      expect(utcToZoned(zonedToUtc(local, 'Africa/Cairo'), 'Africa/Cairo')).toBe(local);
    }
  });
});

describe('money', () => {
  it('parses typed major units into minor units', () => {
    expect(toMinor('125.5')).toBe(12_550);
    expect(toMinor(' ')).toBeNull();
    expect(toMinor('abc')).toBeNull();
    expect(fromMinor(12_550)).toBe('125.5');
  });

  it('formats with Latin digits in both languages', () => {
    expect(formatMoney(150_000, 'EGP', 'en')).toContain('1,500');
    expect(formatMoney(150_000, 'EGP', 'ar')).toMatch(/1[,٬]500/);
  });
});
