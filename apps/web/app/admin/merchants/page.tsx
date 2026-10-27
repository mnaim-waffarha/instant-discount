'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormModal } from '@/components/FormModal';
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Table,
} from '@/components/ui';
import { api, qs, useApi, type Page } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EDITORS, useSession } from '@/lib/session';
import type { Merchant, Partner } from '@/lib/types';

export default function MerchantsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{
    partnerId: string;
    name: string;
    nameAr: string;
    country: string;
    mcc: string;
  } | null>(null);
  const list = useApi<Page<Merchant>>(`/merchants${qs({ q, page })}`);
  const partners = useApi<Page<Partner>>(
    form ? `/partners?type=MERCHANT&country=${form.country}&pageSize=200` : null,
  );

  return (
    <>
      <PageHeader
        title={t('merchants.title')}
        actions={
          can(...EDITORS) && (
            <Button
              onClick={() =>
                setForm({ partnerId: '', name: '', nameAr: '', country: 'EG', mcc: '' })
              }
            >
              {t('merchants.new')}
            </Button>
          )
        }
      />
      <Card>
        <input
          className="input mb-4"
          placeholder={t('common.search')}
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
                rowKey={(m) => m.id}
                onRowClick={(m) => router.push(`/admin/merchants/${m.id}`)}
                columns={[
                  {
                    key: 'name',
                    header: t('common.name'),
                    cell: (m) => <span className="font-medium">{m.name}</span>,
                  },
                  { key: 'partner', header: t('common.partner'), cell: (m) => m.partner?.name },
                  {
                    key: 'country',
                    header: t('common.country'),
                    cell: (m) => t(`country.${m.country}`),
                  },
                  {
                    key: 'mcc',
                    header: t('merchants.mcc'),
                    cell: (m) => <span className="ltr">{m.mcc}</span>,
                  },
                  {
                    key: 'branches',
                    header: t('merchants.branches'),
                    cell: (m) => m._count?.branches ?? 0,
                  },
                  {
                    key: 'terminals',
                    header: t('merchants.terminals'),
                    cell: (m) => m._count?.terminals ?? 0,
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
        title={t('merchants.new')}
        onClose={() => setForm(null)}
        onSubmit={async () => {
          if (!form) return;
          await api('/merchants', { body: { ...form, nameAr: form.nameAr || undefined } });
          await list.reload();
        }}
      >
        {form && (
          <>
            <Field label={t('common.country')}>
              <Select
                value={form.country}
                onChange={(v) => setForm({ ...form, country: v, partnerId: '' })}
                options={[
                  { value: 'EG', label: t('country.EG') },
                  { value: 'SA', label: t('country.SA') },
                ]}
              />
            </Field>
            <Field label={t('common.partner')} hint={t('merchants.partnerHint')}>
              <Select
                value={form.partnerId}
                onChange={(v) => setForm({ ...form, partnerId: v })}
                placeholder="—"
                options={(partners.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label={t('common.name')}>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t('common.nameAr')}>
              <input
                className="input"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
            </Field>
            <Field label={t('merchants.mcc')}>
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
    </>
  );
}
