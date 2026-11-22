'use client';

import { Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { BulkUpload } from '@/components/BulkUpload';
import { FormModal } from '@/components/FormModal';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Table,
} from '@/components/ui';
import { api, qs, useApi, type ApiError, type Page } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EDITORS, useSession } from '@/lib/session';
import type { Acquirer, Merchant, Terminal } from '@/lib/types';

export default function TerminalsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Page<Terminal>>(`/terminals${qs({ q, page })}`);
  const [form, setForm] = useState<{
    acquirerId: string;
    externalTerminalId: string;
    merchantId: string;
    branchId: string;
    mcc: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const acquirers = useApi<Acquirer[]>(form || importing ? '/acquirers' : null);
  const merchants = useApi<Page<Merchant>>(form || importing ? '/merchants?pageSize=200' : null);
  const merchant = useApi<Merchant>(form?.merchantId ? `/merchants/${form.merchantId}` : null);

  const toggle = async (term: Terminal) => {
    await api(`/terminals/${term.id}`, { method: 'PATCH', body: { active: !term.active } });
    await list.reload();
  };

  return (
    <>
      <PageHeader
        title={t('terminals.title')}
        actions={
          can(...EDITORS) && (
            <>
              <Button icon={Upload} variant="secondary" onClick={() => setImporting(true)}>
                {t('terminals.import')}
              </Button>
              <Button
                icon={Plus}
                onClick={() =>
                  setForm({
                    acquirerId: '',
                    externalTerminalId: '',
                    merchantId: '',
                    branchId: '',
                    mcc: '',
                  })
                }
              >
                {t('terminals.new')}
              </Button>
            </>
          )
        }
      />
      <Card>
        <input
          className="input mb-4 ltr"
          placeholder={t('terminals.tid')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
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
                rowKey={(x) => x.id}
                columns={[
                  {
                    key: 'tid',
                    header: t('terminals.tid'),
                    cell: (x) => <span className="ltr font-medium">{x.externalTerminalId}</span>,
                  },
                  { key: 'merchant', header: t('common.merchant'), cell: (x) => x.merchant?.name },
                  { key: 'branch', header: t('common.branch'), cell: (x) => x.branch?.name ?? '—' },
                  { key: 'acq', header: t('common.acquirer'), cell: (x) => x.acquirer?.name },
                  {
                    key: 'mcc',
                    header: t('terminals.mccOverride'),
                    cell: (x) => <span className="ltr">{x.mcc ?? '—'}</span>,
                  },
                  {
                    key: 'st',
                    header: t('common.status'),
                    cell: (x) => (
                      <Badge tone={x.active ? 'ok' : 'neutral'}>
                        {x.active ? t('common.active') : t('common.inactive')}
                      </Badge>
                    ),
                  },
                  {
                    key: 'act',
                    header: '',
                    className: 'text-end',
                    cell: (x) =>
                      can(...EDITORS) && (
                        <Button size="sm" variant="ghost" onClick={() => void toggle(x)}>
                          {x.active ? t('terminals.deactivate') : t('terminals.activate')}
                        </Button>
                      ),
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

      <FormModal
        open={!!form}
        title={t('terminals.new')}
        onClose={() => setForm(null)}
        onSubmit={async () => {
          if (!form) return;
          await api('/terminals', {
            body: { ...form, branchId: form.branchId || undefined, mcc: form.mcc || undefined },
          });
          await list.reload();
        }}
      >
        {form && (
          <>
            <Field label={t('common.acquirer')}>
              <Select
                value={form.acquirerId}
                onChange={(v) => setForm({ ...form, acquirerId: v })}
                placeholder="—"
                options={(acquirers.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
            <Field label={t('terminals.tid')}>
              <input
                className="input ltr"
                value={form.externalTerminalId}
                onChange={(e) => setForm({ ...form, externalTerminalId: e.target.value })}
              />
            </Field>
            <Field label={t('common.merchant')}>
              <Select
                value={form.merchantId}
                onChange={(v) => setForm({ ...form, merchantId: v, branchId: '' })}
                placeholder="—"
                options={(merchants.data?.items ?? []).map((m) => ({ value: m.id, label: m.name }))}
              />
            </Field>
            <Field label={`${t('common.branch')} (${t('common.optional')})`}>
              <Select
                value={form.branchId}
                onChange={(v) => setForm({ ...form, branchId: v })}
                placeholder="—"
                options={(merchant.data?.branches ?? []).map((b) => ({
                  value: b.id,
                  label: b.name,
                }))}
              />
            </Field>
            <Field label={`${t('terminals.mccOverride')} (${t('common.optional')})`}>
              <input
                className="input ltr"
                maxLength={4}
                value={form.mcc}
                onChange={(e) => setForm({ ...form, mcc: e.target.value })}
              />
            </Field>
          </>
        )}
      </FormModal>

      <BulkUpload
        open={importing}
        onClose={() => setImporting(false)}
        title={t('terminals.import')}
        hint={t('terminals.importHint')}
        endpoint="/terminals/import"
        templateName="terminals-template"
        onImported={() => void list.reload()}
        reference={{
          sheet: 'Reference',
          rows: [
            ['type', 'name', 'id_to_copy', 'belongs_to'],
            ...(acquirers.data ?? []).map((a) => ['acquirer', a.name, a.apiKeyId, '']),
            ...(merchants.data?.items ?? []).flatMap((m) => [
              ['merchant', m.name, m.id, m.partner?.name ?? ''],
              ...(m.branches ?? []).map((b) => ['branch', b.name, b.id, m.name]),
            ]),
          ],
        }}
        columns={[
          {
            name: 'acquirer_api_key',
            required: true,
            example: acquirers.data?.[0]?.apiKeyId ?? 'acq_demo',
          },
          { name: 'tid', required: true, example: 'TID0002' },
          {
            name: 'merchant_id',
            required: true,
            example: merchants.data?.items[0]?.id ?? '00000000-0000-0000-0000-000000000000',
          },
          { name: 'branch_id', example: merchants.data?.items[0]?.branches?.[0]?.id ?? '' },
          { name: 'mcc', example: '5812' },
        ]}
      />
    </>
  );
}
