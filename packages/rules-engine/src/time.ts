import type { ScheduleWindow } from './types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface LocalTime {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0 = Sunday
  minuteOfDay: number;
}

export function toLocalTime(instant: Date, timezone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAYS.indexOf(parts.weekday ?? ''),
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isWithinSchedule(
  windows: ScheduleWindow[] | undefined,
  instant: Date,
  timezone: string,
): boolean {
  if (!windows || windows.length === 0) return true;
  const local = toLocalTime(instant, timezone);
  return windows.some(
    (w) =>
      w.daysOfWeek.includes(local.dayOfWeek) &&
      local.minuteOfDay >= w.startMinute &&
      local.minuteOfDay < w.endMinute,
  );
}

export type LimitPeriod = 'DAY' | 'WEEK' | 'CAMPAIGN';

/**
 * Bucket key for period-based counters (daily budget, per-card per-week, ...),
 * computed in the campaign's local timezone. Weeks start on Saturday
 * (the start of the working week in both Egypt and KSA).
 */
export function periodKey(period: LimitPeriod, instant: Date, timezone: string): string {
  if (period === 'CAMPAIGN') return 'all';
  const local = toLocalTime(instant, timezone);
  if (period === 'DAY') return local.date;
  const daysSinceSaturday = (local.dayOfWeek + 1) % 7;
  const d = new Date(`${local.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysSinceSaturday);
  return `w${d.toISOString().slice(0, 10)}`;
}
