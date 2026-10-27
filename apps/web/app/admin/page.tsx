'use client';

import Link from 'next/link';
import {
  CampaignStatusBadge,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Stat,
  Table,
} from '@/components/ui';
import { useApi, type Page } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Campaign, InquirySummary } from '@/lib/types';
import type { MessageKey } from '@/messages/en';

export default function OverviewPage() {
  const { t, locale } = useI18n();
  const active = useApi<Page<Campaign>>('/campaigns?status=ACTIVE&pageSize=10', {
    refreshMs: 30_000,
  });
  const awaiting = useApi<Page<Campaign>>('/campaigns?awaitingApproval=true&pageSize=1', {
    refreshMs: 30_000,
  });
  const summary = useApi<InquirySummary>('/inquiries/summary', { refreshMs: 30_000 });
  const s = summary.data;
  const ms = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${Math.round(v)} ms`;

  return (
    <>
      <PageHeader title={t('overview.title')} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label={t('overview.activeCampaigns')}
          value={formatNumber(active.data?.total, locale)}
        />
        <Link href="/admin/approvals">
          <Stat
            label={t('overview.awaitingApproval')}
            value={formatNumber(awaiting.data?.total, locale)}
          />
        </Link>
        <Stat label={t('overview.inquiries24h')} value={formatNumber(s?.total, locale)} />
        <Stat
          label={t('overview.granted24h')}
          value={formatNumber(s?.granted, locale)}
          hint={s && s.total ? `${Math.round((s.granted / s.total) * 100)}%` : undefined}
        />
        <Stat
          label={t('overview.latency')}
          value={`${ms(s?.latencyMs.p95)} / ${ms(s?.latencyMs.p99)}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title={t('overview.liveCampaigns')}>
          <div className="-m-5">
            <ErrorBox error={active.error} onRetry={active.reload} />
            {active.loading && !active.data ? (
              <Loading />
            ) : (
              <Table
                rows={active.data?.items ?? []}
                rowKey={(c) => c.id}
                columns={[
                  {
                    key: 'name',
                    header: t('common.name'),
                    cell: (c) => (
                      <Link
                        className="font-medium hover:text-brand"
                        href={`/admin/campaigns/${c.id}`}
                      >
                        {c.name}
                      </Link>
                    ),
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    cell: (c) => <CampaignStatusBadge status={c.status} />,
                  },
                  {
                    key: 'end',
                    header: t('wizard.endAt'),
                    cell: (c) => formatDate(c.endAt, locale, c.timezone),
                  },
                ]}
              />
            )}
          </div>
        </Card>
        <Card className="lg:col-span-2" title={t('overview.reasons')}>
          <ErrorBox error={summary.error} />
          {s && s.reasons.length === 0 && <Empty>{t('overview.noReasons')}</Empty>}
          <ul className="space-y-2">
            {s?.reasons.map((r) => (
              <li
                key={r.reason ?? 'none'}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>{t(`reason.${r.reason}` as MessageKey)}</span>
                <span className="ltr font-medium">{formatNumber(r.count, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
