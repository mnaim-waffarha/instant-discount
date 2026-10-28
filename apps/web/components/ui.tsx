'use client';

import Link from 'next/link';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
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

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm';
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition disabled:cursor-not-allowed ${sizing} ${buttonStyles[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition ${buttonStyles[variant]}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  children,
  className = '',
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
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
      <div>
        {back && (
          <Link href={back} className="mb-1 inline-block text-xs text-ink-muted hover:text-brand">
            <span className="inline-block rtl:rotate-180">←</span> {t('common.back')}
          </Link>
        )}
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
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
    <Badge tone={campaignTones[status] ?? 'neutral'}>{t(`status.${status}` as MessageKey)}</Badge>
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
    <Badge tone={redemptionTones[status] ?? 'neutral'}>
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
    <Badge tone={docTones[status] ?? 'neutral'}>{t(`docstatus.${status}` as MessageKey)}</Badge>
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
      <span>
        <strong className="font-semibold">{t('common.error')}: </strong>
        {message}
      </span>
      {onRetry && (
        <button className="underline" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="p-8 text-center text-sm text-ink-muted">{children ?? t('common.empty')}</div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
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
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-start text-xs text-ink-muted">
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
              className={`border-b border-line last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-canvas' : ''}`}
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
    <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 text-xs text-ink-muted">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
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
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-dark/40 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal
        className="card w-full max-w-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="border-b border-line px-5 py-3 text-base font-semibold">{title}</header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
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
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold ltr text-start">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
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
