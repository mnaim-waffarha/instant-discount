'use client';

import { use, useState } from 'react';
import {
  Card,
  ErrorBox,
  Loading,
  PageHeader,
  Pagination,
  RedemptionStatusBadge,
  Table,
} from '@/components/ui';
import { PerformanceCard } from '@/components/PerformanceCard';
import { useApi, type Page } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface Row {
  id: string;
  createdAt: string;
  status: string;
  bin: string;
  currency: string;
  merchant: string;
  terminal: string;
  originalAmountMinor: number;
  discountMinor: number;
  refundedDiscountMinor: number;
  partnerShareMinor: number;
}

export default function PortalCampaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const campaigns =
    useApi<Array<{ id: string; name: string; nameAr: string | null }>>('/portal/campaigns');
  const rows = useApi<Page<Row>>(`/portal/campaigns/${id}/redemptions?page=${page}`);
  const c = campaigns.data?.find((x) => x.id === id);
  return (
    <>
      <PageHeader
        back="/portal"
        title={c ? (locale === 'ar' && c.nameAr ? c.nameAr : c.name) : t('portal.payments')}
        subtitle={t('portal.shareNote')}
        actions={
          <a
            className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium hover:bg-canvas"
            href={`/api/portal/campaigns/${id}/redemptions.csv`}
          >
            {t('portal.downloadCsv')}
          </a>
        }
      />
      <div className="mb-6">
        <PerformanceCard path={`/portal/campaigns/${id}/performance`} />
      </div>
      <Card title={t('portal.payments')}>
        <ErrorBox error={rows.error} />
        <div className="-m-5">
          {rows.loading && !rows.data ? (
            <Loading />
          ) : (
            <>
              <Table
                rows={rows.data?.items ?? []}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'time',
                    header: t('common.time'),
                    cell: (r) => (
                      <span className="text-xs">{formatDateTime(r.createdAt, locale)}</span>
                    ),
                  },
                  { key: 'merchant', header: t('common.merchant'), cell: (r) => r.merchant },
                  {
                    key: 'tid',
                    header: t('common.terminal'),
                    cell: (r) => <span className="ltr text-xs">{r.terminal}</span>,
                  },
                  {
                    key: 'bin',
                    header: t('tx.bin'),
                    cell: (r) => <span className="ltr">{r.bin}</span>,
                  },
                  {
                    key: 'amount',
                    header: t('common.amount'),
                    className: 'text-end',
                    cell: (r) => formatMoney(r.originalAmountMinor, r.currency, locale),
                  },
                  {
                    key: 'disc',
                    header: t('common.discount'),
                    className: 'text-end',
                    cell: (r) =>
                      formatMoney(r.discountMinor - r.refundedDiscountMinor, r.currency, locale),
                  },
                  {
                    key: 'share',
                    header: t('portal.yourShare'),
                    className: 'text-end font-medium',
                    cell: (r) => formatMoney(r.partnerShareMinor, r.currency, locale),
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    cell: (r) => <RedemptionStatusBadge status={r.status} />,
                  },
                ]}
              />
              {rows.data && (
                <Pagination
                  page={rows.data.page}
                  pageSize={rows.data.pageSize}
                  total={rows.data.total}
                  onPage={setPage}
                />
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}
