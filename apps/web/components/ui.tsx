'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Inbox,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/messages/en';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-600 disabled:bg-brand/50',
  secondary: 'bg-white text-ink border border-line hover:bg-canvas disabled:text-ink-faint',
  ghost: 'text-ink-muted hover:bg-canvas hover:text-ink',
  danger: 'bg-white text-bad border border-bad/30 hover:bg-bad-bg',
};

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1';

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon: Icon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  /** Leading icon; replaced by the spinner while loading. */
  icon?: LucideIcon;
}) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm';
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition disabled:cursor-not-allowed ${focusRing} ${sizing} ${buttonStyles[variant]} ${className}`}
    >
      {loading ? (
        <Spinner small />
      ) : (
        Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      )}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
  icon: Icon,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  icon?: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition ${focusRing} ${buttonStyles[variant]}`}
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      {children}
    </Link>
  );
}

export type ChipTone = 'brand' | 'sky' | 'sun' | 'tangerine' | 'ok' | 'warn' | 'bad' | 'neutral';
const chipTones: Record<ChipTone, string> = {
  brand: 'bg-brand-50 text-brand',
  sky: 'bg-sky-50 text-sky-ink',
  sun: 'bg-sun-50 text-sun-ink',
  tangerine: 'bg-tangerine-50 text-tangerine-ink',
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  neutral: 'bg-canvas text-ink-muted',
};

/** A tinted square holding an icon (stat tiles, card headers, empty states). */
export function IconChip({
  icon: Icon,
  tone = 'brand',
  size = 'md',
}: {
  icon: LucideIcon;
  tone?: ChipTone;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box =
    size === 'sm'
      ? 'h-7 w-7 rounded-md'
      : size === 'lg'
        ? 'h-12 w-12 rounded-xl'
        : 'h-10 w-10 rounded-lg';
  const glyph = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <span
      className={`inline-grid shrink-0 place-items-center ${box} ${chipTones[tone]}`}
      aria-hidden
    >
      <Icon className={glyph} />
    </span>
  );
}

const MOBILE_QUERY = '(max-width: 767px)';
/** True below the `md` breakpoint. Renders as desktop on the server, then follows the viewport. */
export function useIsMobile() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

export function Card({
  children,
  className = '',
  title,
  actions,
  icon,
  tone = 'brand',
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  tone?: ChipTone;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon && <IconChip icon={icon} tone={tone} size="sm" />}
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link
            href={back}
            className="mb-2 inline-flex items-center gap-1 rounded text-xs font-medium text-ink-muted hover:text-brand"
          >
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden /> {t('common.back')}
          </Link>
        )}
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'navy';
const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-muted border-line',
  brand: 'bg-brand-50 text-brand-600 border-brand/20',
  ok: 'bg-ok-bg text-ok border-ok/20',
  warn: 'bg-warn-bg text-warn border-warn/20',
  bad: 'bg-bad-bg text-bad border-bad/20',
  // Light blue, so it stays distinct from the dark-blue brand tone.
  navy: 'bg-sky-50 text-sky-ink border-sky/30',
};

export function Badge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: Tone;
  /** Leading dot, used for statuses so they scan at a glance. */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const campaignTones: Record<string, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warn',
  SCHEDULED: 'navy',
  ACTIVE: 'ok',
  PAUSED: 'warn',
  ENDED: 'neutral',
};
export function CampaignStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge dot tone={campaignTones[status] ?? 'neutral'}>
      {t(`status.${status}` as MessageKey)}
    </Badge>
  );
}

const redemptionTones: Record<string, Tone> = {
  RESERVED: 'warn',
  CONFIRMED: 'ok',
  RELEASED: 'neutral',
  EXPIRED: 'neutral',
  PARTIALLY_REFUNDED: 'navy',
  REFUNDED: 'bad',
};
export function RedemptionStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge dot tone={redemptionTones[status] ?? 'neutral'}>
      {t(`rstatus.${status}` as MessageKey)}
    </Badge>
  );
}

const docTones: Record<string, Tone> = {
  DRAFT: 'neutral',
  ISSUED: 'navy',
  PAID: 'ok',
  OVERDUE: 'bad',
  VOID: 'neutral',
};
export function DocumentStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge dot tone={docTones[status] ?? 'neutral'}>
      {t(`docstatus.${status}` as MessageKey)}
    </Badge>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
    </label>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? 'h-3 w-3' : 'h-5 w-5'}`}
      aria-hidden
    />
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-ink-muted">
      <Spinner /> {t('common.loading')}
    </div>
  );
}

export function ErrorBox({
  error,
  onRetry,
}: {
  error?: ApiError | Error | string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-bad/20 bg-bad-bg px-4 py-3 text-sm text-bad"
    >
      <span className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">{t('common.error')}: </strong>
          {message}
        </span>
      </span>
      {onRetry && (
        <button className="shrink-0 font-medium underline" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Empty({ children, icon = Inbox }: { children?: ReactNode; icon?: LucideIcon }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-ink-muted">
      <IconChip icon={icon} tone="neutral" size="lg" />
      <div>{children ?? t('common.empty')}</div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** On phones, shown as the card's title instead of a labelled row (defaults to the first column). */
  primary?: boolean;
  /** On phones, leave this column out of the card. */
  hideOnMobile?: boolean;
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  if (isMobile) {
    // Phones: one card per row, so no column is cut off or needs sideways scrolling.
    const primary = columns.find((c) => c.primary) ?? columns[0]!;
    const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
    return (
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 font-medium">{primary.cell(row)}</div>
                {onRowClick && (
                  <ChevronRight
                    className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint rtl:rotate-180"
                    aria-hidden
                  />
                )}
              </div>
              {rest.length > 0 && (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {rest.map((c) =>
                    // An unlabelled column holds row actions: give it the full card width.
                    c.header === '' || c.header === null ? (
                      <div key={c.key} className="col-span-2 flex flex-wrap gap-2 pt-1">
                        {c.cell(row)}
                      </div>
                    ) : (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-xs text-ink-faint">{c.header}</dt>
                        <dd className="mt-0.5 break-words">{c.cell(row)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              )}
            </>
          );
          return (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  className={`block w-full px-4 py-3 text-start hover:bg-canvas ${focusRing}`}
                >
                  {body}
                </button>
              ) : (
                <div className="px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas/60 text-start text-xs text-ink-muted">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2 text-start font-medium ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line transition-colors last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-brand-50/50' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 align-middle ${c.className ?? ''}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-ink-muted sm:justify-end">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        {t('common.previous')}
      </Button>
      <span>{t('common.page', { page, pages })}</span>
      <Button
        size="sm"
        variant="secondary"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {t('common.next')}
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      </Button>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-dark/40 sm:items-center sm:p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal
        className="card w-full max-w-lg rounded-b-none sm:rounded-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 text-base font-semibold">
          {title}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className={`grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink ${focusRing}`}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: ChipTone;
}) {
  return (
    <div className="card flex h-full items-start gap-3 p-4">
      {icon && <IconChip icon={icon} tone={tone} />}
      <div className="min-w-0">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="mt-1 text-xl font-semibold ltr text-start sm:text-2xl">{value}</div>
        {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
      </div>
    </div>
  );
}

/** Thin progress bar for budget usage. */
export function Meter({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped >= 100 ? 'bg-bad' : clamped >= 80 ? 'bg-warn' : 'bg-brand';
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-line"
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  className = '',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  placeholder?: string;
}) {
  return (
    <select
      className={`input ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
