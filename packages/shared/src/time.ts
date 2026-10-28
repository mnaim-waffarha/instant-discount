/** Offset of `timeZone` from UTC at `instant`, in ms (positive east of UTC). */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  );
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` shows the given local date-time. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
  hour = 0,
  minute = 0,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - offsetMs(new Date(asUtc), timeZone);
  return new Date(asUtc - offsetMs(new Date(first), timeZone));
}

/** [start, end) of a calendar month ("YYYY-MM") in `timeZone`, as UTC instants. */
export function monthBounds(period: string, timeZone: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Invalid period ${period}, expected YYYY-MM`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    start: zonedTimeToUtc(year, month, 1, timeZone),
    end:
      month === 12
        ? zonedTimeToUtc(year + 1, 1, 1, timeZone)
        : zonedTimeToUtc(year, month + 1, 1, timeZone),
  };
}

/** The "YYYY-MM" of the month before the one containing `instant`, in `timeZone`. */
export function previousPeriod(instant: Date, timeZone: string): string {
  const local = new Date(instant.getTime() + offsetMs(instant, timeZone));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth(); // 0-based current month = 1-based previous month
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
}
