'use client';

import { useState } from 'react';
import { Card, ErrorBox, Loading, PageHeader, Pagination, Table } from '@/components/ui';
import { qs, useApi, type Page } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor: { email: string; name: string } | null;
}

export default function AuditPage() {
  const { t, locale } = useI18n();
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Page<AuditRow>>(`/audit${qs({ entityType, page, pageSize: 50 })}`);
  return (
    <>
      <PageHeader title={t('audit.title')} />
      <Card>
        <input
          className="input mb-4 ltr"
          placeholder="Campaign, Partner, Acquirer…"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage(1);
          }}
        />
        <ErrorBox error={list.error} onRetry={list.reload} />
        <div className="-mx-4 sm:-mx-5 -mb-5">
          {list.loading && !list.data ? (
            <Loading />
          ) : (
            <>
              <Table
                rows={list.data?.items ?? []}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'time',
                    header: t('common.time'),
                    cell: (r) => (
                      <span className="text-xs">{formatDateTime(r.createdAt, locale)}</span>
                    ),
                  },
                  {
                    key: 'actor',
                    header: t('audit.actor'),
                    cell: (r) => <span className="ltr text-xs">{r.actor?.email ?? 'system'}</span>,
                  },
                  {
                    key: 'action',
                    header: t('audit.action'),
                    cell: (r) => <code className="ltr text-xs">{r.action}</code>,
                  },
                  {
                    key: 'entity',
                    header: t('audit.entity'),
                    cell: (r) => (
                      <span className="ltr text-xs">
                        {r.entityType} · {r.entityId.slice(0, 8)}
                      </span>
                    ),
                  },
                  {
                    key: 'change',
                    header: t('common.details'),
                    cell: (r) =>
                      r.after || r.before ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-ink-muted">JSON</summary>
                          <pre className="ltr mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-canvas p-2">
                            {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                          </pre>
                        </details>
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
