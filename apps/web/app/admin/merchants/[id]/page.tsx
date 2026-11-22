'use client';

import { CreditCard, MapPin, Plus, Store, Upload } from 'lucide-react';
import { use, useState } from 'react';
import { BulkUpload } from '@/components/BulkUpload';
import { FormModal } from '@/components/FormModal';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Table,
} from '@/components/ui';
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
  const [uploading, setUploading] = useState(false);
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
            <>
              <Button icon={Upload} variant="secondary" onClick={() => setUploading(true)}>
                {t('merchants.uploadBranches')}
              </Button>
              <Button icon={Plus} onClick={() => setBranch({ name: '', city: '' })}>
                {t('merchants.newBranch')}
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title={`${t('merchants.branches')} (${m.branches?.length ?? 0})`}
          icon={Store}
          tone="sky"
        >
          {m.branches?.length ? (
            <ul className="-my-2 max-h-[28rem] divide-y divide-line overflow-y-auto text-sm">
              {m.branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-medium">{b.name}</span>
                  {b.city && (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {b.city}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Store}>{t('merchants.noBranches')}</Empty>
          )}
        </Card>
        <Card className="lg:col-span-2" title={t('merchants.terminals')} icon={CreditCard}>
          <div className="-m-4 sm:-m-5">
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
      <BulkUpload
        open={uploading}
        onClose={() => setUploading(false)}
        title={t('merchants.uploadBranches')}
        hint={t('merchants.uploadBranchesHint')}
        endpoint={`/merchants/${id}/branches/import`}
        templateName="branches-template"
        onImported={() => void merchant.reload()}
        columns={[
          { name: 'name', required: true, example: t('merchants.exampleBranch') },
          { name: 'city', example: t('merchants.exampleCity') },
        ]}
      />
    </>
  );
}
