'use client';

import { Plus } from 'lucide-react';
import {} from 'lucide-react';
import { useState } from 'react';
import { FormModal } from '@/components/FormModal';
import {
  Badge,
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
import type { Partner } from '@/lib/types';

const blank = {
  name: '',
  nameAr: '',
  type: 'BANK',
  country: 'EG',
  taxNumber: '',
  billingEmail: '',
};

export default function PartnersPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<Partner | null>(null);
  const list = useApi<Page<Partner>>(`/partners${qs({ type, q, page })}`);
  const types = ['BANK', 'MERCHANT', 'WAFFARHA'] as const;

  const save = async () => {
    if (!form) return;
    const body = {
      name: form.name,
      nameAr: form.nameAr || undefined,
      taxNumber: form.taxNumber || undefined,
      billingEmail: form.billingEmail || undefined,
    };
    if (editing) await api(`/partners/${editing.id}`, { method: 'PATCH', body });
    else await api('/partners', { body: { ...body, type: form.type, country: form.country } });
    await list.reload();
  };

  return (
    <>
      <PageHeader
        title={t('partners.title')}
        actions={
          can(...EDITORS) && (
            <Button
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setForm(blank);
              }}
            >
              {t('partners.new')}
            </Button>
          )
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <input
            className="input"
            placeholder={t('common.search')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            placeholder={`${t('common.type')}: ${t('common.all')}`}
            options={types.map((x) => ({ value: x, label: t(`ptype.${x}`) }))}
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
                rowKey={(p) => p.id}
                onRowClick={
                  can(...EDITORS)
                    ? (p) => {
                        setEditing(p);
                        setForm({
                          name: p.name,
                          nameAr: p.nameAr ?? '',
                          type: p.type,
                          country: p.country,
                          taxNumber: p.taxNumber ?? '',
                          billingEmail: p.billingEmail ?? '',
                        });
                      }
                    : undefined
                }
                columns={[
                  {
                    key: 'name',
                    header: t('common.name'),
                    cell: (p) => <span className="font-medium">{p.name}</span>,
                  },
                  {
                    key: 'type',
                    header: t('common.type'),
                    cell: (p) => (
                      <Badge
                        tone={
                          p.type === 'BANK' ? 'navy' : p.type === 'WAFFARHA' ? 'brand' : 'neutral'
                        }
                      >
                        {t(`ptype.${p.type}`)}
                      </Badge>
                    ),
                  },
                  {
                    key: 'country',
                    header: t('common.country'),
                    cell: (p) => t(`country.${p.country}`),
                  },
                  {
                    key: 'email',
                    header: t('partners.billingEmail'),
                    cell: (p) => <span className="ltr text-xs">{p.billingEmail ?? '—'}</span>,
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
        title={editing ? t('common.edit') : t('partners.new')}
        onClose={() => setForm(null)}
        onSubmit={save}
      >
        {form && (
          <>
            <Field label={t('common.name')}>
              <input
                className="input"
                required
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
            {!editing && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('common.type')}>
                  <Select
                    value={form.type}
                    onChange={(v) => setForm({ ...form, type: v })}
                    options={types.map((x) => ({ value: x, label: t(`ptype.${x}`) }))}
                  />
                </Field>
                <Field label={t('common.country')}>
                  <Select
                    value={form.country}
                    onChange={(v) => setForm({ ...form, country: v })}
                    options={[
                      { value: 'EG', label: t('country.EG') },
                      { value: 'SA', label: t('country.SA') },
                    ]}
                  />
                </Field>
              </div>
            )}
            <Field label={t('partners.taxNumber')}>
              <input
                className="input ltr"
                value={form.taxNumber}
                onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
              />
            </Field>
            <Field label={t('partners.billingEmail')}>
              <input
                className="input ltr"
                type="email"
                value={form.billingEmail}
                onChange={(e) => setForm({ ...form, billingEmail: e.target.value })}
              />
            </Field>
          </>
        )}
      </FormModal>
    </>
  );
}
