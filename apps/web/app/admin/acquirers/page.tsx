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
  Select,
  Table,
} from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { Acquirer } from '@/lib/types';

export default function AcquirersPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const list = useApi<Acquirer[]>('/acquirers');
  const [form, setForm] = useState<{ name: string; country: string; ips: string } | null>(null);
  const [secret, setSecret] = useState<{ apiKey: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const isAdmin = can('ADMIN');

  const rotate = async (a: Acquirer) => {
    if (!window.confirm(t('acquirers.rotateConfirm'))) return;
    const r = await api<{ hmacSecret: string }>(`/acquirers/${a.id}/rotate-secret`, { body: {} });
    setCopied(false);
    setSecret({ apiKey: a.apiKeyId, secret: r.hmacSecret });
  };

  return (
    <>
      <PageHeader
        title={t('acquirers.title')}
        actions={
          isAdmin && (
            <Button onClick={() => setForm({ name: '', country: 'EG', ips: '' })}>
              {t('acquirers.new')}
            </Button>
          )
        }
      />
      <Card>
        <ErrorBox error={list.error} onRetry={list.reload} />
        <div className="-m-5">
          {list.loading && !list.data ? (
            <Loading />
          ) : (
            <Table
              rows={list.data ?? []}
              rowKey={(a) => a.id}
              columns={[
                {
                  key: 'name',
                  header: t('common.name'),
                  cell: (a) => <span className="font-medium">{a.name}</span>,
                },
                {
                  key: 'key',
                  header: t('acquirers.apiKey'),
                  cell: (a) => <code className="ltr text-xs">{a.apiKeyId}</code>,
                },
                {
                  key: 'country',
                  header: t('common.country'),
                  cell: (a) => t(`country.${a.country}`),
                },
                {
                  key: 'ips',
                  header: t('acquirers.ipAllowlist'),
                  cell: (a) => (
                    <span className="ltr text-xs">{a.ipAllowlist.join(', ') || '—'}</span>
                  ),
                },
                {
                  key: 'terms',
                  header: t('acquirers.terminals'),
                  cell: (a) => a.terminalCount ?? 0,
                },
                {
                  key: 'st',
                  header: t('common.status'),
                  cell: (a) => (
                    <Badge tone={a.active ? 'ok' : 'neutral'}>
                      {a.active ? t('common.active') : t('common.inactive')}
                    </Badge>
                  ),
                },
                {
                  key: 'created',
                  header: t('common.createdAt'),
                  cell: (a) => formatDate(a.createdAt, locale),
                },
                {
                  key: 'act',
                  header: '',
                  className: 'text-end',
                  cell: (a) =>
                    isAdmin && (
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void rotate(a)}>
                          {t('acquirers.rotate')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await api(`/acquirers/${a.id}`, {
                              method: 'PATCH',
                              body: { active: !a.active },
                            });
                            await list.reload();
                          }}
                        >
                          {a.active ? t('acquirers.disable') : t('acquirers.enable')}
                        </Button>
                      </span>
                    ),
                },
              ]}
            />
          )}
        </div>
      </Card>
      <FormModal
        open={!!form}
        title={t('acquirers.new')}
        onClose={() => setForm(null)}
        onSubmit={async () => {
          if (!form) return;
          const r = await api<{ acquirer: Acquirer; hmacSecret: string }>('/acquirers', {
            body: {
              name: form.name,
              country: form.country,
              ipAllowlist: form.ips.split(/\s+/).filter(Boolean),
            },
          });
          setCopied(false);
          setSecret({ apiKey: r.acquirer.apiKeyId, secret: r.hmacSecret });
          await list.reload();
        }}
      >
        {form && (
          <>
            <Field label={t('common.name')}>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
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
            <Field label={t('acquirers.ipAllowlist')} hint={t('acquirers.ipHint')}>
              <textarea
                className="input h-20 py-2 ltr"
                value={form.ips}
                onChange={(e) => setForm({ ...form, ips: e.target.value })}
              />
            </Field>
          </>
        )}
      </FormModal>
      <Modal
        open={!!secret}
        title={t('acquirers.secretTitle')}
        onClose={() => setSecret(null)}
        footer={<Button onClick={() => setSecret(null)}>{t('common.close')}</Button>}
      >
        {secret && (
          <div className="space-y-3 text-sm">
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-warn">{t('acquirers.secretBody')}</p>
            <div>
              <div className="label">{t('acquirers.apiKey')}</div>
              <code className="ltr block rounded bg-canvas p-2 text-xs">{secret.apiKey}</code>
            </div>
            <div>
              <div className="label">{t('acquirers.secretTitle')}</div>
              <code
                className="ltr block break-all rounded bg-canvas p-2 text-xs"
                data-testid="hmac-secret"
              >
                {secret.secret}
              </code>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(secret.secret);
                setCopied(true);
              }}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
