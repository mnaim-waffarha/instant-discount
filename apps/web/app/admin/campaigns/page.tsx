'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Badge,
  CampaignStatusBadge,
  Card,
  ErrorBox,
  LinkButton,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Table,
} from '@/components/ui';
import { qs, useApi, type Page } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { EDITORS, useSession } from '@/lib/session';
import type { Campaign } from '@/lib/types';
import { discountLabel } from '@/lib/campaign';

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED'] as const;

export default function CampaignsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Page<Campaign>>(
    `/campaigns${qs({ status, country, q, page })}`,
  );

  return (
    <>
      <PageHeader
        title={t('campaigns.title')}
        actions={
          can(...EDITORS) && (
            <LinkButton icon={Plus} href="/admin/campaigns/new">
              {t('campaigns.new')}
            </LinkButton>
          )
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <input
            className="input"
            placeholder={t('common.search')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
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
            options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
          />
          <Select
            value={country}
            onChange={(v) => {
              setCountry(v);
              setPage(1);
            }}
            placeholder={`${t('common.country')}: ${t('common.all')}`}
            options={[
              { value: 'EG', label: t('country.EG') },
              { value: 'SA', label: t('country.SA') },
            ]}
          />
        </div>
        <ErrorBox error={error} onRetry={reload} />
        <div className="-mx-4 sm:-mx-5 -mb-5">
          {loading && !data ? (
            <Loading />
          ) : (
            <>
              <Table
                rows={data?.items ?? []}
                rowKey={(c) => c.id}
                onRowClick={(c) => router.push(`/admin/campaigns/${c.id}`)}
                empty={t('campaigns.none')}
                columns={[
                  {
                    key: 'name',
                    header: t('common.name'),
                    cell: (c) => (
                      <div>
                        <div className="font-medium">
                          {locale === 'ar' && c.nameAr ? c.nameAr : c.name}
                        </div>
                        {c.pendingChanges && (
                          <Badge tone="warn">{t('campaigns.pendingChange')}</Badge>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    cell: (c) => <CampaignStatusBadge status={c.status} />,
                  },
                  {
                    key: 'discount',
                    header: t('common.discount'),
                    cell: (c) => <span className="ltr">{discountLabel(c, t)}</span>,
                  },
                  {
                    key: 'funders',
                    header: t('campaigns.funders'),
                    cell: (c) => (
                      <span className="text-xs text-ink-muted">
                        {c.fundings
                          .map((f) => `${f.partner?.name} ${f.shareBps / 100}%`)
                          .join(' · ')}
                      </span>
                    ),
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
                    key: 'priority',
                    header: t('campaigns.priority'),
                    cell: (c) => c.priority,
                    className: 'text-end',
                  },
                ]}
              />
              {data && (
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
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
