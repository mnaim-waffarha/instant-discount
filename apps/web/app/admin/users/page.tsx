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
  PageHeader,
  Pagination,
  Select,
  Table,
} from '@/components/ui';
import { api, qs, useApi, type Page } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { Partner, User } from '@/lib/types';
import type { MessageKey } from '@/messages/en';

const ROLES = [
  'ADMIN',
  'CAMPAIGN_MANAGER',
  'APPROVER',
  'FINANCE',
  'VIEWER',
  'PARTNER_USER',
] as const;

export default function UsersPage() {
  const { t, locale } = useI18n();
  const { user: me } = useSession();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Page<User>>(`/users${qs({ q, page })}`);
  const [form, setForm] = useState<{
    email: string;
    name: string;
    role: string;
    partnerId: string;
    locale: string;
  } | null>(null);
  const partners = useApi<Page<Partner>>(
    form?.role === 'PARTNER_USER' ? '/partners?pageSize=200' : null,
  );
  const partnerNames = useApi<Page<Partner>>('/partners?pageSize=200');
  const nameOf = (id: string | null) => partnerNames.data?.items.find((p) => p.id === id)?.name;

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.inviteHint')}
        actions={
          <Button
            onClick={() =>
              setForm({ email: '', name: '', role: 'VIEWER', partnerId: '', locale: 'en' })
            }
          >
            {t('users.invite')}
          </Button>
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
                rowKey={(u) => u.id}
                columns={[
                  {
                    key: 'name',
                    header: t('common.name'),
                    cell: (u) => (
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="ltr text-start text-xs text-ink-muted">{u.email}</div>
                      </div>
                    ),
                  },
                  {
                    key: 'role',
                    header: t('common.role'),
                    cell: (u) => (
                      <div>
                        <Badge tone={u.role === 'PARTNER_USER' ? 'navy' : 'brand'}>
                          {t(`role.${u.role}` as MessageKey)}
                        </Badge>
                        {u.partnerId && (
                          <div className="mt-1 text-xs text-ink-muted">{nameOf(u.partnerId)}</div>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'last',
                    header: t('users.lastLogin'),
                    cell: (u) =>
                      u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : t('users.never'),
                  },
                  {
                    key: 'st',
                    header: t('common.status'),
                    cell: (u) => (
                      <Badge tone={u.active ? 'ok' : 'neutral'}>
                        {u.active ? t('common.active') : t('common.inactive')}
                      </Badge>
                    ),
                  },
                  {
                    key: 'act',
                    header: '',
                    className: 'text-end',
                    cell: (u) =>
                      u.id !== me?.id && (
                        <span className="inline-flex gap-1">
                          {u.role !== 'PARTNER_USER' && (
                            <select
                              className="h-8 rounded-lg border border-line bg-white px-2 text-xs"
                              value={u.role}
                              aria-label={t('common.role')}
                              onChange={async (e) => {
                                await api(`/users/${u.id}`, {
                                  method: 'PATCH',
                                  body: { role: e.target.value },
                                });
                                await list.reload();
                              }}
                            >
                              {ROLES.filter((r) => r !== 'PARTNER_USER').map((r) => (
                                <option key={r} value={r}>
                                  {t(`role.${r}`)}
                                </option>
                              ))}
                            </select>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await api(`/users/${u.id}`, {
                                method: 'PATCH',
                                body: { active: !u.active },
                              });
                              await list.reload();
                            }}
                          >
                            {u.active ? t('users.deactivate') : t('users.activate')}
                          </Button>
                        </span>
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
        title={t('users.invite')}
        onClose={() => setForm(null)}
        submitLabel={t('users.invite')}
        onSubmit={async () => {
          if (!form) return;
          await api('/users', {
            body: { ...form, partnerId: form.role === 'PARTNER_USER' ? form.partnerId : undefined },
          });
          await list.reload();
        }}
      >
        {form && (
          <>
            <Field label={t('common.email')}>
              <input
                className="input ltr"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label={t('common.name')}>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t('common.role')}>
              <Select
                value={form.role}
                onChange={(v) => setForm({ ...form, role: v })}
                options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))}
              />
            </Field>
            {form.role === 'PARTNER_USER' && (
              <Field label={t('common.partner')}>
                <Select
                  value={form.partnerId}
                  onChange={(v) => setForm({ ...form, partnerId: v })}
                  placeholder="—"
                  options={(partners.data?.items ?? []).map((p) => ({
                    value: p.id,
                    label: `${p.name} · ${t(`ptype.${p.type}`)}`,
                  }))}
                />
              </Field>
            )}
            <Field label="Language / اللغة">
              <Select
                value={form.locale}
                onChange={(v) => setForm({ ...form, locale: v })}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'العربية' },
                ]}
              />
            </Field>
          </>
        )}
      </FormModal>
    </>
  );
}
