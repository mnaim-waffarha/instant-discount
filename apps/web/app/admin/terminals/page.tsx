'use client';

import { useState } from 'react';
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

interface ImportResult {
  dryRun: boolean;
  valid: number;
  imported: number;
  errors: Array<{ line: number; message: string }>;
}

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
  const acquirers = useApi<Acquirer[]>(form ? '/acquirers' : null);
  const merchants = useApi<Page<Merchant>>(form ? '/merchants?pageSize=200' : null);
  const merchant = useApi<Merchant>(form?.merchantId ? `/merchants/${form.merchantId}` : null);
  const [importing, setImporting] = useState(false);
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult>();
  const [importError, setImportError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const runImport = async (dryRun: boolean) => {
    setBusy(true);
    setImportError(undefined);
    try {
      const r = await api<ImportResult>('/terminals/import', { body: { csv, dryRun } });
      setResult(r);
      if (!r.dryRun) await list.reload();
    } catch (e) {
      setImportError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

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
              <Button
                variant="secondary"
                onClick={() => {
                  setImporting(true);
                  setResult(undefined);
                  setCsv('');
                }}
              >
                {t('terminals.import')}
              </Button>
              <Button
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
        <div className="-mx-5 -mb-5">
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

      <Modal
        open={importing}
        title={t('terminals.import')}
        onClose={() => setImporting(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setImporting(false)}>
              {t('common.close')}
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              disabled={!csv.trim()}
              onClick={() => void runImport(true)}
            >
              {t('terminals.validate')}
            </Button>
            {result?.dryRun && result.errors.length === 0 && result.valid > 0 && (
              <Button loading={busy} onClick={() => void runImport(false)}>
                {t('terminals.importNow', { count: result.valid })}
              </Button>
            )}
          </>
        }
      >
        <p className="mb-3 text-xs text-ink-muted">{t('terminals.importHint')}</p>
        <input
          type="file"
          accept=".csv,text/csv"
          className="mb-3 block text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              setCsv(await file.text());
              setResult(undefined);
            }
          }}
        />
        <textarea
          className="input h-40 py-2 font-mono text-xs ltr"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(undefined);
          }}
          placeholder="acquirer_api_key,tid,merchant_id,branch_id,mcc"
        />
        <div className="mt-3 space-y-2 text-sm">
          <ErrorBox error={importError} />
          {result && !result.dryRun && (
            <p className="text-ok">{t('terminals.imported', { count: result.imported })}</p>
          )}
          {result?.dryRun && <p>{t('terminals.importValid', { count: result.valid })}</p>}
          {result && result.errors.length > 0 && (
            <div className="rounded-lg bg-bad-bg p-3 text-bad">
              <div className="mb-1 font-medium">{t('terminals.importErrors')}</div>
              <ul className="space-y-1 text-xs">
                {result.errors.map((e) => (
                  <li key={`${e.line}-${e.message}`}>
                    {t('terminals.line', { line: e.line })}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
