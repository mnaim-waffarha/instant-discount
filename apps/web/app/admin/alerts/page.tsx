'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Table,
} from '@/components/ui';
import { api, qs, useApi, type Page } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { MessageKey } from '@/messages/en';

interface Alert {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED';
  title: string;
  message: string;
  campaignId: string | null;
  createdAt: string;
}

const tone = { INFO: 'navy', WARNING: 'warn', CRITICAL: 'bad' } as const;

export default function AlertsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const list = useApi<Page<Alert>>(`/alerts${qs({ status, page })}`, { refreshMs: 30_000 });
  return (
    <>
      <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />
      <Card>
        <div className="mb-4 max-w-xs">
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            placeholder={t('common.all')}
            options={[
              { value: 'OPEN', label: t('alerts.open') },
              { value: 'ACKNOWLEDGED', label: t('alerts.acknowledged') },
            ]}
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
                rowKey={(a) => a.id}
                empty={t('alerts.none')}
                columns={[
                  {
                    key: 'sev',
                    header: '',
                    cell: (a) => (
                      <Badge tone={tone[a.severity]}>
                        {t(`severity.${a.severity}` as MessageKey)}
                      </Badge>
                    ),
                  },
                  {
                    key: 'title',
                    header: t('common.details'),
                    cell: (a) => (
                      <div>
                        <div className="font-medium">{a.title}</div>
                        <div className="text-xs text-ink-muted">{a.message}</div>
                        {a.campaignId && (
                          <Link
                            className="text-xs text-brand"
                            href={`/admin/campaigns/${a.campaignId}`}
                          >
                            {t('nav.campaigns')} →
                          </Link>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'time',
                    header: t('common.time'),
                    cell: (a) => (
                      <span className="text-xs">{formatDateTime(a.createdAt, locale)}</span>
                    ),
                  },
                  {
                    key: 'ack',
                    header: '',
                    className: 'text-end',
                    cell: (a) =>
                      a.status === 'OPEN' &&
                      can('ADMIN', 'CAMPAIGN_MANAGER', 'APPROVER', 'FINANCE') ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await api(`/alerts/${a.id}/acknowledge`, { body: {} });
                            await list.reload();
                          }}
                        >
                          {t('alerts.acknowledge')}
                        </Button>
                      ) : null,
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
    </>
  );
}
