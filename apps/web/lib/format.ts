export type Locale = 'en' | 'ar';

const MINOR_DIGITS = 2; // EGP and SAR

function numberLocale(locale: Locale) {
  // Latin digits in both languages: easier to read for finance and support staff.
  return locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG';
}

export function formatMoney(
  minor: number | null | undefined,
  currency: string,
  locale: Locale,
): string {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat(numberLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 10 ** MINOR_DIGITS);
}

export function formatNumber(n: number | null | undefined, locale: Locale): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(numberLocale(locale)).format(n);
}

export function formatDateTime(
  value: string | Date | null | undefined,
  locale: Locale,
  timeZone?: string,
): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function formatDate(
  value: string | Date | null | undefined,
  locale: Locale,
  timeZone?: string,
): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeZone,
  }).format(new Date(value));
}

/** Major units typed in a form (e.g. "125.5") → integer minor units, or null when empty. */
export function toMinor(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function fromMinor(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? '' : String(minor / 100);
}

/**
 * Converts a wall-clock time typed for `timeZone` ("2026-11-01T09:00") into a UTC Date.
 * Campaign dates are entered in the campaign's own timezone, not the browser's.
 */
export function zonedToUtc(local: string, timeZone: string): Date {
  const asUtc = new Date(`${local}:00Z`);
  const offset = tzOffsetMs(asUtc, timeZone);
  const guess = new Date(asUtc.getTime() - offset);
  // Re-check across DST boundaries.
  return new Date(asUtc.getTime() - tzOffsetMs(guess, timeZone));
}

/** UTC instant → "YYYY-MM-DDTHH:mm" wall clock in `timeZone` (for datetime-local inputs). */
export function utcToZoned(value: string | Date, timeZone: string): string {
  const d = new Date(value);
  return new Date(d.getTime() + tzOffsetMs(d, timeZone)).toISOString().slice(0, 16);
}

function tzOffsetMs(instant: Date, timeZone: string): number {
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

export function formatMonth(
  value: string | Date | null | undefined,
  locale: Locale,
  timeZone?: string,
): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(value));
}
