'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  Card,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  RedemptionStatusBadge,
  Select,
  Table,
} from '@/components/ui';
import { qs, useApi, type Page } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Redemption } from '@/lib/types';
import type { MessageKey } from '@/messages/en';

const STATUSES = ['RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

function Transactions() {
  const { t, locale } = useI18n();
  const campaignId = useSearchParams().get('campaignId') ?? '';
  const [status, setStatus] = useState('');
  const [txnRef, setTxnRef] = useState('');
  const [bin, setBin] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi<Page<Redemption>>(
    `/redemptions${qs({ campaignId, status, txnRef, bin, page })}`,
  );
  const detail = useApi<Redemption>(selected ? `/redemptions/${selected}` : null);
  const d = detail.data;

  return (
    <>
      <PageHeader title={t('tx.title')} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <input
            className="input ltr"
            placeholder={t('tx.txnRef')}
            value={txnRef}
            onChange={(e) => {
              setTxnRef(e.target.value);
              setPage(1);
            }}
          />
          <input
            className="input ltr"
            placeholder={t('tx.bin')}
            value={bin}
            onChange={(e) => {
              setBin(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            placeholder={`${t('common.status')}: ${t('common.all')}`}
            options={STATUSES.map((s) => ({ value: s, label: t(`rstatus.${s}` as MessageKey) }))}
          />
        </div>
        <ErrorBox error={list.error} onRetry={list.reload} />
        <div className="-mx-4 sm:-mx-5 -mb-5">
          {list.loading && !list.data ? (
            <Loading />
          ) : (
            <>
              <Table
                rows={list.data?.items ?? []}
                rowKey={(r) => r.id}
                empty={t('tx.none')}
                onRowClick={(r) => setSelected(r.id)}
                columns={[
                  {
                    key: 'time',
                    header: t('common.time'),
                    cell: (r) => (
                      <span className="text-xs">{formatDateTime(r.createdAt, locale)}</span>
                    ),
                  },
                  {
                    key: 'ref',
                    header: t('tx.txnRef'),
                    cell: (r) => <span className="ltr text-xs">{r.acquirerTxnRef}</span>,
                  },
                  { key: 'campaign', header: t('nav.campaigns'), cell: (r) => r.campaign?.name },
                  {
                    key: 'terminal',
                    header: t('common.terminal'),
                    cell: (r) => (
                      <span className="text-xs">
                        {r.terminal?.merchant?.name} ·{' '}
                        <span className="ltr">{r.terminal?.externalTerminalId}</span>
                      </span>
                    ),
                  },
                  {
                    key: 'bin',
                    header: t('tx.bin'),
                    cell: (r) => <span className="ltr">{r.bin}</span>,
                  },
                  {
                    key: 'amount',
                    header: t('common.amount'),
                    cell: (r) => formatMoney(r.originalAmountMinor, r.currency, locale),
                  },
                  {
                    key: 'discount',
                    header: t('common.discount'),
                    cell: (r) => formatMoney(r.discountMinor, r.currency, locale),
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    cell: (r) => <RedemptionStatusBadge status={r.status} />,
                  },
                ]}
              />
              {list.data && (
                <Pagination
                  page={list.data.page}
                  pageSize={list.data.pageSize}
                  total={list.data.total}
                  onPage={setPage}
                />
              )}
            </>
          )}
        </div>
      </Card>

      <Modal open={!!selected} title={t('common.details')} onClose={() => setSelected(null)}>
        {!d ? (
          <Loading />
        ) : (
          <div className="space-y-5 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-ink-muted">{t('tx.txnRef')}</dt>
                <dd className="ltr text-start">{d.acquirerTxnRef}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('common.status')}</dt>
                <dd>
                  <RedemptionStatusBadge status={d.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('common.amount')}</dt>
                <dd>{formatMoney(d.originalAmountMinor, d.currency, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('common.discount')}</dt>
                <dd>{formatMoney(d.discountMinor, d.currency, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('tx.charged')}</dt>
                <dd>{formatMoney(d.finalAmountMinor, d.currency, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('tx.refunded')}</dt>
                <dd>{formatMoney(d.refundedAmountMinor, d.currency, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('common.acquirer')}</dt>
                <dd>{d.acquirer?.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t('common.terminal')}</dt>
                <dd className="ltr text-start">{d.terminal?.externalTerminalId}</dd>
              </div>
            </dl>
            <div>
              <div className="label">{t('tx.funding')}</div>
              <ul className="space-y-1">
                {d.fundingSnapshot.map((f) => (
                  <li key={f.partnerId} className="flex justify-between">
                    <span className="ltr text-xs text-ink-muted">
                      {f.partnerId.slice(0, 8)} · {f.shareBps / 100}%
                    </span>
                    <span>{formatMoney(f.amountMinor, d.currency, locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="label">{t('tx.events')}</div>
              <ol className="space-y-2 border-s border-line ps-4">
                {d.events?.map((e) => (
                  <li key={e.id}>
                    <div className="font-medium">{t(`tx.event.${e.type}` as MessageKey)}</div>
                    <div className="text-xs text-ink-muted">
                      {formatDateTime(e.createdAt, locale)}
                      {e.discountDeltaMinor !== 0 &&
                        ` · ${t('common.discount')} ${formatMoney(e.discountDeltaMinor, d.currency, locale)}`}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense>
      <Transactions />
    </Suspense>
  );
}
