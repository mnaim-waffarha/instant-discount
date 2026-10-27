import { describe, expect, it } from 'vitest';
import { isWithinSchedule, periodKey, toLocalTime } from './time';

describe('time', () => {
  // 2026-10-27 is a Tuesday. 21:30 UTC = 00:30 Wednesday in Riyadh (UTC+3).
  const instant = new Date('2026-10-27T21:30:00Z');

  it('converts to campaign local time', () => {
    expect(toLocalTime(instant, 'Asia/Riyadh')).toEqual({
      date: '2026-10-28',
      dayOfWeek: 3,
      minuteOfDay: 30,
    });
  });

  it('checks schedule windows in local time', () => {
    const lunch = [{ daysOfWeek: [0, 1, 2, 3, 4], startMinute: 12 * 60, endMinute: 16 * 60 }];
    expect(isWithinSchedule(lunch, new Date('2026-10-27T10:00:00Z'), 'Africa/Cairo')).toBe(true);
    expect(isWithinSchedule(lunch, new Date('2026-10-27T14:00:00Z'), 'Africa/Cairo')).toBe(false);
    expect(isWithinSchedule(undefined, instant, 'Africa/Cairo')).toBe(true);
  });

  it('computes period keys with Saturday week start', () => {
    expect(periodKey('DAY', instant, 'Asia/Riyadh')).toBe('2026-10-28');
    expect(periodKey('WEEK', instant, 'Asia/Riyadh')).toBe('w2026-10-24');
    expect(periodKey('WEEK', new Date('2026-10-24T10:00:00Z'), 'Africa/Cairo')).toBe('w2026-10-24');
    expect(periodKey('CAMPAIGN', instant, 'Asia/Riyadh')).toBe('all');
  });
});
