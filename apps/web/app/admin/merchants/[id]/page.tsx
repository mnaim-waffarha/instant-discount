'use client';

import { use, useState } from 'react';
import { FormModal } from '@/components/FormModal';
import { Badge, Button, Card, ErrorBox, Field, Loading, PageHeader, Table } from '@/components/ui';
import { api, useApi, type Page } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EDITORS, useSession } from '@/lib/session';
import type { Merchant, Terminal } from '@/lib/types';

export default function MerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const { can } = useSession();
  const merchant = useApi<Merchant>(`/merchants/${id}`);
  const terminals = useApi<Page<Terminal>>(`/terminals?merchantId=${id}&pageSize=200`);
  const [branch, setBranch] = useState<{ name: string; city: string } | null>(null);
  const m = merchant.data;
  if (merchant.error) return <ErrorBox error={merchant.error} />;
  if (!m) return <Loading />;

  return (
    <>
      <PageHeader
        back="/admin/merchants"
        title={m.name}
        subtitle={`${m.partner?.name} · ${t(`country.${m.country}`)} · MCC ${m.mcc}`}
        actions={
          can(...EDITORS) && (
            <Button onClick={() => setBranch({ name: '', city: '' })}>
              {t('merchants.newBranch')}
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t('merchants.branches')}>
          <ul className="space-y-2 text-sm">
            {m.branches?.map((b) => (
              <li key={b.id} className="flex justify-between">
                <span>{b.name}</span>
                <span className="text-ink-muted">{b.city}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:col-span-2" title={t('merchants.terminals')}>
          <div className="-m-5">
            <Table
              rows={terminals.data?.items ?? []}
              rowKey={(x) => x.id}
              columns={[
                {
                  key: 'tid',
                  header: t('terminals.tid'),
                  cell: (x) => <span className="ltr font-medium">{x.externalTerminalId}</span>,
                },
                { key: 'acq', header: t('common.acquirer'), cell: (x) => x.acquirer?.name },
                { key: 'branch', header: t('common.branch'), cell: (x) => x.branch?.name ?? '—' },
                {
                  key: 'st',
                  header: t('common.status'),
                  cell: (x) => (
                    <Badge tone={x.active ? 'ok' : 'neutral'}>
                      {x.active ? t('common.active') : t('common.inactive')}
                    </Badge>
                  ),
                },
              ]}
            />
          </div>
        </Card>
      </div>
      <FormModal
        open={!!branch}
        title={t('merchants.newBranch')}
        onClose={() => setBranch(null)}
        onSubmit={async () => {
          if (!branch) return;
          await api(`/merchants/${id}/branches`, {
            body: { name: branch.name, city: branch.city || undefined },
          });
          await merchant.reload();
        }}
      >
        {branch && (
          <>
            <Field label={t('common.name')}>
              <input
                className="input"
                value={branch.name}
                onChange={(e) => setBranch({ ...branch, name: e.target.value })}
              />
            </Field>
            <Field label={t('merchants.city')}>
              <input
                className="input"
                value={branch.city}
                onChange={(e) => setBranch({ ...branch, city: e.target.value })}
              />
            </Field>
          </>
        )}
      </FormModal>
    </>
  );
}
