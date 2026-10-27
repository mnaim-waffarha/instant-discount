'use client';

import { use, useState } from 'react';
import { FormModal } from '@/components/FormModal';
import {
  Button,
  Card,
  DocumentStatusBadge,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Table,
} from '@/components/ui';
import { api, useApi, type ApiError } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { SettlementDocument } from '@/lib/types';

const TZ = { EG: 'Africa/Cairo', SA: 'Asia/Riyadh' } as const;

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { can } = useSession();
  const doc = useApi<SettlementDocument>(`/documents/${id}`);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [paying, setPaying] = useState<{ reference: string; paidAt: string } | null>(null);
  const [voiding, setVoiding] = useState<{ reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const d = doc.data;
  if (doc.error) return <ErrorBox error={doc.error} />;
  if (!d) return <Loading />;

  const isFinance = can('ADMIN', 'FINANCE');
  const tz = TZ[d.country];
  const money = (v: number) => formatMoney(v, d.currency, locale);
  const lastDay = new Date(new Date(d.periodEnd).getTime() - 1);

  const issue = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/documents/${id}/issue`, { body: {} });
      setConfirmIssue(false);
      await doc.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        back="/admin/settlements"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t(`doctype.${d.type}`)}{' '}
            <span className="ltr text-base text-ink-muted">{d.number ?? t('settle.draft')}</span>{' '}
            <DocumentStatusBadge status={d.status} />
          </span>
        }
        subtitle={`${d.partner?.name} · ${formatDate(d.periodStart, locale, tz)} → ${formatDate(lastDay, locale, tz)}`}
        actions={
          <>
            <a
              className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium hover:bg-canvas"
              href={`/api/documents/${id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              {t('settle.downloadPdf')}
            </a>
            <a
              className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium hover:bg-canvas"
              href={`/api/documents/${id}/csv`}
            >
              {t('settle.downloadCsv')}
            </a>
            {isFinance && d.status === 'DRAFT' && (
              <Button onClick={() => setConfirmIssue(true)}>{t('settle.issue')}</Button>
            )}
            {isFinance &&
              d.type !== 'STATEMENT' &&
              (d.status === 'ISSUED' || d.status === 'OVERDUE') && (
                <Button
                  onClick={() =>
                    setPaying({ reference: '', paidAt: new Date().toISOString().slice(0, 10) })
                  }
                >
                  {t('settle.markPaid')}
                </Button>
              )}
            {isFinance && d.status !== 'PAID' && d.status !== 'VOID' && (
              <Button variant="danger" onClick={() => setVoiding({ reason: '' })}>
                {t('settle.void')}
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6">
        <ErrorBox error={error} />
        {d.voidReason && (
          <p className="rounded-lg bg-bad-bg px-4 py-2 text-sm text-bad">{d.voidReason}</p>
        )}
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            [t('settle.subtotal'), money(d.subtotalMinor)],
            [t('settle.vat', { rate: d.vatBps / 100 }), money(d.vatMinor)],
            [t('settle.total'), money(d.totalMinor)],
            [
              d.paidAt ? t('settle.paid') : d.dueAt ? t('settle.due') : t('settle.issued'),
              formatDate(d.paidAt ?? d.dueAt ?? d.issuedAt, locale, tz),
            ],
          ].map(([k, v]) => (
            <div key={k} className="card p-4">
              <div className="text-xs text-ink-muted">{k}</div>
              <div className="mt-1 text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <Card title={t('settle.lines')}>
          <div className="-m-5">
            <Table
              rows={d.lines ?? []}
              rowKey={(l) => l.id}
              columns={[
                {
                  key: 'kind',
                  header: t('common.type'),
                  cell: (l) => (
                    <span className={l.kind === 'OWN_CONTRIBUTION' ? 'text-ink-muted' : ''}>
                      {t(`linekind.${l.kind}`)}
                    </span>
                  ),
                },
                { key: 'campaign', header: t('nav.campaigns'), cell: (l) => l.campaignName },
                {
                  key: 'cp',
                  header: t('settle.counterparty'),
                  cell: (l) => l.counterpartyName ?? '—',
                },
                {
                  key: 'count',
                  header: t('settle.count'),
                  className: 'text-end',
                  cell: (l) => formatNumber(l.redemptionCount, locale),
                },
                {
                  key: 'gross',
                  header: t('settle.gross'),
                  className: 'text-end',
                  cell: (l) => money(l.grossMinor),
                },
                {
                  key: 'rev',
                  header: t('settle.reversed'),
                  className: 'text-end',
                  cell: (l) => money(-l.reversedMinor),
                },
                {
                  key: 'net',
                  header: t('settle.net'),
                  className: 'text-end font-medium',
                  cell: (l) => money(l.netMinor),
                },
              ]}
            />
          </div>
        </Card>
      </div>

      <Modal
        open={confirmIssue}
        title={t('settle.issue')}
        onClose={() => setConfirmIssue(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmIssue(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void issue()}>
              {t('settle.issue')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('settle.issueConfirm')}</p>
      </Modal>
      <FormModal
        open={!!paying}
        title={t('settle.markPaid')}
        onClose={() => setPaying(null)}
        onSubmit={async () => {
          if (!paying) return;
          await api(`/documents/${id}/paid`, {
            body: { paidAt: paying.paidAt, reference: paying.reference || undefined },
          });
          await doc.reload();
        }}
      >
        {paying && (
          <>
            <Field label={t('settle.paid')}>
              <input
                type="date"
                className="input ltr"
                value={paying.paidAt}
                onChange={(e) => setPaying({ ...paying, paidAt: e.target.value })}
              />
            </Field>
            <Field label={t('settle.paymentRef')}>
              <input
                className="input ltr"
                value={paying.reference}
                onChange={(e) => setPaying({ ...paying, reference: e.target.value })}
              />
            </Field>
          </>
        )}
      </FormModal>
      <FormModal
        open={!!voiding}
        title={t('settle.void')}
        submitLabel={t('settle.void')}
        onClose={() => setVoiding(null)}
        onSubmit={async () => {
          if (!voiding) return;
          await api(`/documents/${id}/void`, { body: { reason: voiding.reason } });
          await doc.reload();
        }}
      >
        {voiding && (
          <Field label={t('settle.voidReason')}>
            <textarea
              className="input h-24 py-2"
              value={voiding.reason}
              onChange={(e) => setVoiding({ reason: e.target.value })}
            />
          </Field>
        )}
      </FormModal>
    </>
  );
}
