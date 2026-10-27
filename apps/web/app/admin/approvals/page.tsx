'use client';

import { useRouter } from 'next/navigation';
import {
  Badge,
  CampaignStatusBadge,
  Card,
  ErrorBox,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
import { useApi, type Page } from '@/lib/api';
import { discountLabel } from '@/lib/campaign';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Campaign } from '@/lib/types';

export default function ApprovalsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Page<Campaign>>(
    '/campaigns?awaitingApproval=true&pageSize=100',
    { refreshMs: 30_000 },
  );
  return (
    <>
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />
      <Card>
        <ErrorBox error={error} onRetry={reload} />
        <div className="-m-5">
          {loading && !data ? (
            <Loading />
          ) : (
            <Table
              rows={data?.items ?? []}
              rowKey={(c) => c.id}
              empty={t('approvals.none')}
              onRowClick={(c) => router.push(`/admin/campaigns/${c.id}`)}
              columns={[
                {
                  key: 'name',
                  header: t('common.name'),
                  cell: (c) => <span className="font-medium">{c.name}</span>,
                },
                {
                  key: 'kind',
                  header: t('common.type'),
                  cell: (c) => (
                    <Badge tone={c.status === 'PENDING_APPROVAL' ? 'brand' : 'warn'}>
                      {c.status === 'PENDING_APPROVAL'
                        ? t('approvals.newCampaign')
                        : t('approvals.change')}
                    </Badge>
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
                  cell: (c) => (
                    <span className="ltr">
                      {discountLabel(
                        c.pendingChanges
                          ? { discountConfig: c.pendingChanges.discount, currency: c.currency }
                          : c,
                        t,
                      )}
                    </span>
                  ),
                },
                {
                  key: 'when',
                  header: t('common.updatedAt'),
                  cell: (c) => formatDateTime(c.pendingAt ?? c.updatedAt, locale),
                },
                {
                  key: 'go',
                  header: '',
                  cell: () => <span className="text-brand">{t('approvals.review')} →</span>,
                  className: 'text-end',
                },
              ]}
            />
          )}
        </div>
      </Card>
    </>
  );
}
