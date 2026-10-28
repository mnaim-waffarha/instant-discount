'use client';

import {
  Badge,
  Card,
  DocumentStatusBadge,
  ErrorBox,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
import { useApi, type Page } from '@/lib/api';
import { formatDate, formatMoney, formatMonth } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { SettlementDocument } from '@/lib/types';

const TZ = { EG: 'Africa/Cairo', SA: 'Asia/Riyadh' } as const;

export default function PortalDocuments() {
  const { t, locale } = useI18n();
  const { data, error, loading } = useApi<Page<SettlementDocument>>(
    '/portal/documents?pageSize=100',
  );
  const link = 'text-sm font-medium text-brand hover:underline';
  return (
    <>
      <PageHeader title={t('portal.documents')} />
      <Card>
        <ErrorBox error={error} />
        <div className="-m-5">
          {loading && !data ? (
            <Loading />
          ) : (
            <Table
              rows={data?.items ?? []}
              rowKey={(d) => d.id}
              empty={t('portal.noDocuments')}
              columns={[
                {
                  key: 'number',
                  header: t('settle.number'),
                  cell: (d) => <span className="ltr text-xs">{d.number}</span>,
                },
                {
                  key: 'type',
                  header: t('common.type'),
                  cell: (d) => (
                    <Badge tone={d.type === 'INVOICE' ? 'brand' : 'navy'}>
                      {t(`doctype.${d.type}`)}
                    </Badge>
                  ),
                },
                {
                  key: 'period',
                  header: t('settle.period'),
                  cell: (d) => formatMonth(d.periodStart, locale, TZ[d.country]),
                },
                {
                  key: 'total',
                  header: t('settle.total'),
                  className: 'text-end',
                  cell: (d) => formatMoney(d.totalMinor, d.currency, locale),
                },
                {
                  key: 'due',
                  header: t('settle.due'),
                  cell: (d) => formatDate(d.dueAt, locale, TZ[d.country]),
                },
                {
                  key: 'status',
                  header: t('common.status'),
                  cell: (d) => <DocumentStatusBadge status={d.status} />,
                },
                {
                  key: 'dl',
                  header: '',
                  className: 'text-end',
                  cell: (d) => (
                    <span className="inline-flex gap-3">
                      <a
                        className={link}
                        href={`/api/portal/documents/${d.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('settle.downloadPdf')}
                      </a>
                      <a className={link} href={`/api/portal/documents/${d.id}/csv`}>
                        {t('settle.downloadCsv')}
                      </a>
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>
    </>
  );
}
