import { describe, expect, it } from 'vitest';
import { monthBounds, previousPeriod, zonedTimeToUtc } from './time';

describe('time', () => {
  it('converts local midnight to UTC across DST', () => {
    // Egypt is UTC+3 in summer 2026 and UTC+2 from the last Friday of October.
    expect(zonedTimeToUtc(2026, 7, 1, 'Africa/Cairo').toISOString()).toBe(
      '2026-06-30T21:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 12, 1, 'Africa/Cairo').toISOString()).toBe(
      '2026-11-30T22:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 12, 1, 'Asia/Riyadh').toISOString()).toBe(
      '2026-11-30T21:00:00.000Z',
    );
  });

  it('computes month bounds, including December', () => {
    expect(monthBounds('2026-12', 'Asia/Riyadh')).toEqual({
      start: new Date('2026-11-30T21:00:00.000Z'),
      end: new Date('2026-12-31T21:00:00.000Z'),
    });
    expect(() => monthBounds('2026-13x', 'Asia/Riyadh')).toThrow();
  });

  it('finds the previous period in local time', () => {
    // 1 Nov 00:30 in Cairo is still 31 Oct in UTC.
    expect(previousPeriod(new Date('2026-10-31T22:30:00Z'), 'Africa/Cairo')).toBe('2026-10');
    expect(previousPeriod(new Date('2027-01-15T10:00:00Z'), 'Asia/Riyadh')).toBe('2026-12');
  });
});
