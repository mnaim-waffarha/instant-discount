'use client';

import { Plus } from 'lucide-react';
import {} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormModal } from '@/components/FormModal';
import {
  Badge,
  Button,
  Card,
  DocumentStatusBadge,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Select,
  Table,
} from '@/components/ui';
import { api, qs, useApi, type ApiError, type Page } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { SettlementDocument } from '@/lib/types';
import type { MessageKey } from '@/messages/en';

interface Overview {
  funders: Array<{
    partnerId: string;
    partnerName: string;
    partnerType: string;
    settlementMode: string;
    currency: string;
    fundedMinor: number;
    redemptions: number;
  }>;
}

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export default function SettlementsPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const router = useRouter();
  const [country, setCountry] = useState<'EG' | 'SA'>('EG');
  const [period, setPeriod] = useState(lastMonth());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [rate, setRate] = useState<{ country: string; percent: string; validFrom: string } | null>(
    null,
  );
  const overview = useApi<Overview>(`/settlements/overview${qs({ country, period })}`);
  const docs = useApi<Page<SettlementDocument>>(
    `/documents${qs({ country, period, pageSize: 200 })}`,
  );
  const rates =
    useApi<Array<{ id: string; country: string; rateBps: number; validFrom: string }>>(
      '/tax-rates',
    );
  const isFinance = can('ADMIN', 'FINANCE');

  const run = async () => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const r = await api<{ created: number }>('/settlements/run', { body: { country, period } });
      setMessage(t('settle.runDone', { count: r.created }));
      await Promise.all([docs.reload(), overview.reload()]);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('settle.title')} subtitle={t('settle.subtitle')} />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label={t('common.country')}>
          <Select
            value={country}
            onChange={(v) => setCountry(v as 'EG' | 'SA')}
            options={[
              { value: 'EG', label: t('country.EG') },
              { value: 'SA', label: t('country.SA') },
            ]}
          />
        </Field>
        <Field label={t('settle.period')}>
          <input
            type="month"
            className="input ltr"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
        {isFinance && (
          <Button loading={busy} onClick={() => void run()}>
            {t('settle.run')}
          </Button>
        )}
      </div>
      <div className="mb-6 space-y-2">
        <ErrorBox error={error} />
        {message && <p className="rounded-lg bg-ok-bg px-4 py-2 text-sm text-ok">{message}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={t('settle.documents')}>
          <ErrorBox error={docs.error} onRetry={docs.reload} />
          <div className="-m-4 sm:-m-5">
            {docs.loading && !docs.data ? (
              <Loading />
            ) : (
              <Table
                rows={docs.data?.items ?? []}
                rowKey={(d) => d.id}
                empty={t('settle.none')}
                onRowClick={(d) => router.push(`/admin/settlements/${d.id}`)}
                columns={[
                  {
                    key: 'number',
                    header: t('settle.number'),
                    cell: (d) => (
                      <span className="ltr text-xs">{d.number ?? t('settle.draft')}</span>
                    ),
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
                  { key: 'partner', header: t('common.partner'), cell: (d) => d.partner?.name },
                  {
                    key: 'total',
                    header: t('settle.total'),
                    className: 'text-end',
                    cell: (d) => formatMoney(d.totalMinor, d.currency, locale),
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    cell: (d) => <DocumentStatusBadge status={d.status} />,
                  },
                ]}
              />
            )}
          </div>
        </Card>
        <div className="space-y-6">
          <Card title={t('settle.funders')}>
            <ErrorBox error={overview.error} />
            {overview.data && overview.data.funders.length === 0 && (
              <p className="text-sm text-ink-muted">{t('settle.none')}</p>
            )}
            <ul className="space-y-3 text-sm">
              {overview.data?.funders.map((f) => (
                <li
                  key={`${f.partnerId}-${f.settlementMode}-${f.currency}`}
                  className="flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="font-medium">{f.partnerName}</div>
                    <div className="text-xs text-ink-muted">
                      {t(`ptype.${f.partnerType}` as MessageKey)} ·{' '}
                      {t(`wizard.settlement.${f.settlementMode}` as MessageKey)}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-medium">
                      {formatMoney(f.fundedMinor, f.currency, locale)}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {formatNumber(f.redemptions, locale)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title={t('settle.taxRates')}
            actions={
              isFinance && (
                <Button
                  icon={Plus}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setRate({
                      country,
                      percent: '',
                      validFrom: new Date().toISOString().slice(0, 10),
                    })
                  }
                >
                  {t('settle.addRate')}
                </Button>
              )
            }
          >
            <ul className="space-y-2 text-sm">
              {rates.data?.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>{t(`country.${r.country}` as MessageKey)}</span>
                  <span className="text-ink-muted">
                    {r.rateBps / 100}% · {t('settle.validFrom')} {formatDate(r.validFrom, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <FormModal
        open={!!rate}
        title={t('settle.addRate')}
        onClose={() => setRate(null)}
        onSubmit={async () => {
          if (!rate) return;
          await api('/tax-rates', {
            body: {
              country: rate.country,
              rateBps: Math.round(Number(rate.percent) * 100),
              validFrom: rate.validFrom,
            },
          });
          await rates.reload();
        }}
      >
        {rate && (
          <>
            <Field label={t('common.country')}>
              <Select
                value={rate.country}
                onChange={(v) => setRate({ ...rate, country: v })}
                options={[
                  { value: 'EG', label: t('country.EG') },
                  { value: 'SA', label: t('country.SA') },
                ]}
              />
            </Field>
            <Field label="%">
              <input
                className="input ltr"
                inputMode="decimal"
                value={rate.percent}
                onChange={(e) => setRate({ ...rate, percent: e.target.value })}
              />
            </Field>
            <Field label={t('settle.validFrom')}>
              <input
                type="date"
                className="input ltr"
                value={rate.validFrom}
                onChange={(e) => setRate({ ...rate, validFrom: e.target.value })}
              />
            </Field>
          </>
        )}
      </FormModal>
    </>
  );
}
