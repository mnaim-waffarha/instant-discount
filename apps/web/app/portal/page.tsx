'use client';

import { BadgePercent, CreditCard, Megaphone, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  CampaignStatusBadge,
  Card,
  ErrorBox,
  Loading,
  PageHeader,
  Stat,
  Table,
} from '@/components/ui';
import { useApi } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface PortalCampaign {
  id: string;
  name: string;
  nameAr: string | null;
  status: string;
  currency: string;
  timezone: string;
  startAt: string;
  endAt: string;
  shareBps: number;
  redemptions: number;
  discountMinor: number;
  partnerShareMinor: number;
}

export default function PortalHome() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<PortalCampaign[]>('/portal/campaigns', {
    refreshMs: 60_000,
  });
  const currency = data?.[0]?.currency ?? 'EGP';
  const sum = (k: 'redemptions' | 'discountMinor' | 'partnerShareMinor') =>
    (data ?? []).reduce((s, c) => s + c[k], 0);

  return (
    <>
      <PageHeader title={t('portal.title')} subtitle={t('portal.shareNote')} />
      <ErrorBox error={error} onRetry={reload} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          icon={Megaphone}
          label={t('portal.campaignCount')}
          value={formatNumber(data?.length, locale)}
        />
        <Stat
          icon={CreditCard}
          tone="sky"
          label={t('portal.redemptions')}
          value={formatNumber(data ? sum('redemptions') : undefined, locale)}
        />
        <Stat
          icon={BadgePercent}
          tone="tangerine"
          label={t('portal.discountGiven')}
          value={data ? formatMoney(sum('discountMinor'), currency, locale) : '—'}
        />
        <Stat
          icon={Wallet}
          tone="ok"
          label={t('portal.yourShare')}
          value={data ? formatMoney(sum('partnerShareMinor'), currency, locale) : '—'}
        />
      </div>
      <Card title={t('portal.campaigns')} icon={Megaphone}>
        <div className="-m-4 sm:-m-5">
          {loading && !data ? (
            <Loading />
          ) : (
            <Table
              rows={data ?? []}
              rowKey={(c) => c.id}
              empty={t('portal.none')}
              onRowClick={(c) => router.push(`/portal/campaigns/${c.id}`)}
              columns={[
                {
                  key: 'name',
                  header: t('common.name'),
                  cell: (c) => (
                    <span className="font-medium">
                      {locale === 'ar' && c.nameAr ? c.nameAr : c.name}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: t('common.status'),
                  cell: (c) => <CampaignStatusBadge status={c.status} />,
                },
                {
                  key: 'period',
                  header: t('campaigns.period'),
                  cell: (c) => (
                    <span className="text-xs">
                      {formatDate(c.startAt, locale, c.timezone)} →{' '}
                      {formatDate(c.endAt, locale, c.timezone)}
                    </span>
                  ),
                },
                {
                  key: 'pct',
                  header: t('portal.yourSharePct'),
                  className: 'text-end',
                  cell: (c) => (c.shareBps ? `${c.shareBps / 100}%` : '—'),
                },
                {
                  key: 'red',
                  header: t('portal.redemptions'),
                  className: 'text-end',
                  cell: (c) => formatNumber(c.redemptions, locale),
                },
                {
                  key: 'disc',
                  header: t('portal.discountGiven'),
                  className: 'text-end',
                  cell: (c) => formatMoney(c.discountMinor, c.currency, locale),
                },
                {
                  key: 'share',
                  header: t('portal.yourShare'),
                  className: 'text-end font-medium',
                  cell: (c) => formatMoney(c.partnerShareMinor, c.currency, locale),
                },
              ]}
            />
          )}
        </div>
      </Card>
    </>
  );
}
