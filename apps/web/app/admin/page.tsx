'use client';

import {
  Activity,
  BadgePercent,
  ClipboardCheck,
  Megaphone,
  Plus,
  SearchX,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import {
  CampaignStatusBadge,
  Card,
  Empty,
  ErrorBox,
  LinkButton,
  Loading,
  PageHeader,
  Stat,
  Table,
} from '@/components/ui';
import { useApi, type Page } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { EDITORS, useSession } from '@/lib/session';
import type { Campaign, InquirySummary } from '@/lib/types';
import type { MessageKey } from '@/messages/en';

export default function OverviewPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
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
      <PageHeader
        title={t('overview.title')}
        actions={
          can(...EDITORS) && (
            <LinkButton href="/admin/campaigns/new" icon={Plus}>
              {t('campaigns.new')}
            </LinkButton>
          )
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Stat
          icon={Megaphone}
          label={t('overview.activeCampaigns')}
          value={formatNumber(active.data?.total, locale)}
        />
        <Link
          href="/admin/approvals"
          className="block h-full rounded-card transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Stat
            icon={ClipboardCheck}
            tone="sun"
            label={t('overview.awaitingApproval')}
            value={formatNumber(awaiting.data?.total, locale)}
          />
        </Link>
        <Stat
          icon={Activity}
          tone="sky"
          label={t('overview.inquiries24h')}
          value={formatNumber(s?.total, locale)}
        />
        <Stat
          icon={BadgePercent}
          tone="ok"
          label={t('overview.granted24h')}
          value={formatNumber(s?.granted, locale)}
          hint={s && s.total ? `${Math.round((s.granted / s.total) * 100)}%` : undefined}
        />
        <div className="col-span-2 lg:col-span-1">
          <Stat
            icon={Timer}
            tone="tangerine"
            label={t('overview.latency')}
            value={`${ms(s?.latencyMs.p95)} / ${ms(s?.latencyMs.p99)}`}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title={t('overview.liveCampaigns')} icon={Megaphone}>
          <div className="-m-4 sm:-m-5">
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
        <Card
          className="lg:col-span-2"
          title={t('overview.reasons')}
          icon={SearchX}
          tone="tangerine"
        >
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
