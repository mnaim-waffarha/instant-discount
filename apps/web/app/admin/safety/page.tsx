'use client';

import { useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Field, Loading, Modal, PageHeader } from '@/components/ui';
import { api, useApi, type ApiError } from '@/lib/api';
import { formatDateTime, fromMinor, toMinor } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { MessageKey } from '@/messages/en';

interface Safety {
  killSwitch: { enabled: boolean; reason?: string; by?: string; at?: string };
  maxDiscountPerTxnMinor: { EGP: number | null; SAR: number | null };
  cardVelocity: { maxGrantsPerHour: number | null };
  alerts: Record<string, number | number[]>;
}

const THRESHOLDS: Array<[string, MessageKey]> = [
  ['errorRatePct', 'safety.errorRate'],
  ['p99LatencyMs', 'safety.p99'],
  ['cardInquiriesPerHour', 'safety.cardInquiries'],
  ['terminalSpikeFactor', 'safety.spikeFactor'],
  ['terminalSpikeMin', 'safety.spikeMin'],
  ['terminalCardsPer10Min', 'safety.cards10'],
];

export default function SafetyPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const { data, error, reload } = useApi<Safety>('/safety');
  const [form, setForm] = useState<Record<string, string>>({});
  const [kill, setKill] = useState<{ enabled: boolean; reason: string } | null>(null);
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const isAdmin = can('ADMIN');

  useEffect(() => {
    if (!data) return;
    setForm({
      EGP: fromMinor(data.maxDiscountPerTxnMinor.EGP),
      SAR: fromMinor(data.maxDiscountPerTxnMinor.SAR),
      velocity: data.cardVelocity.maxGrantsPerHour?.toString() ?? '',
      budgetThresholdsPct: (data.alerts.budgetThresholdsPct as number[]).join(', '),
      ...Object.fromEntries(THRESHOLDS.map(([k]) => [k, String(data.alerts[k])])),
    });
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    setMsg(undefined);
    try {
      await api('/safety', {
        method: 'PUT',
        body: {
          maxDiscountPerTxnMinor: { EGP: toMinor(form.EGP ?? ''), SAR: toMinor(form.SAR ?? '') },
          cardVelocity: { maxGrantsPerHour: form.velocity?.trim() ? Number(form.velocity) : null },
          alerts: {
            budgetThresholdsPct: (form.budgetThresholdsPct ?? '')
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number),
            ...Object.fromEntries(THRESHOLDS.map(([k]) => [k, Number(form[k])])),
          },
        },
      });
      setMsg(t('safety.saved'));
      await reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const input = (key: string, label: string) => (
    <Field key={key} label={label}>
      <input
        className="input ltr"
        disabled={!isAdmin}
        value={form[key] ?? ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={t('common.unlimited')}
      />
    </Field>
  );
  const ks = data.killSwitch;

  return (
    <>
      <PageHeader title={t('safety.title')} subtitle={t('safety.subtitle')} />
      <div className="space-y-6">
        <Card title={t('safety.killSwitch')}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className={`text-lg font-semibold ${ks.enabled ? 'text-bad' : 'text-ok'}`}>
                {ks.enabled ? t('safety.killOn') : t('safety.killOff')}
              </div>
              <p className="mt-1 max-w-xl text-sm text-ink-muted">{t('safety.killHint')}</p>
              {ks.by && (
                <p className="mt-1 text-xs text-ink-faint">
                  {ks.reason} · {ks.by} · {formatDateTime(ks.at, locale)}
                </p>
              )}
            </div>
            {isAdmin && (
              <Button
                variant={ks.enabled ? 'primary' : 'danger'}
                onClick={() => setKill({ enabled: !ks.enabled, reason: '' })}
              >
                {ks.enabled ? t('safety.turnOff') : t('safety.turnOn')}
              </Button>
            )}
          </div>
        </Card>
        <ErrorBox error={err} />
        {msg && <p className="rounded-lg bg-ok-bg px-4 py-2 text-sm text-ok">{msg}</p>}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={t('safety.guardrails')}>
            <div className="space-y-4">
              {input('EGP', t('safety.maxDiscount', { currency: 'EGP' }))}
              {input('SAR', t('safety.maxDiscount', { currency: 'SAR' }))}
              {input('velocity', t('safety.velocity'))}
            </div>
          </Card>
          <Card title={t('safety.thresholds')}>
            <div className="grid gap-4 sm:grid-cols-2">
              {input('budgetThresholdsPct', t('safety.budgetPct'))}
              {THRESHOLDS.map(([k, label]) => input(k, t(label)))}
            </div>
          </Card>
        </div>
        {isAdmin && (
          <div className="flex justify-end">
            <Button loading={busy} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </div>
      <Modal
        open={!!kill}
        title={t('safety.killSwitch')}
        onClose={() => setKill(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setKill(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={kill?.enabled ? 'danger' : 'primary'}
              disabled={!kill?.reason.trim()}
              loading={busy}
              onClick={async () => {
                if (!kill) return;
                setBusy(true);
                try {
                  await api('/safety/kill-switch', { body: kill });
                  setKill(null);
                  await reload();
                } catch (e) {
                  setErr((e as ApiError).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {kill?.enabled ? t('safety.turnOn') : t('safety.turnOff')}
            </Button>
          </>
        }
      >
        <label className="label" htmlFor="kill-reason">
          {t('safety.reason')}
        </label>
        <textarea
          id="kill-reason"
          className="input h-24 py-2"
          value={kill?.reason ?? ''}
          onChange={(e) => kill && setKill({ ...kill, reason: e.target.value })}
        />
      </Modal>
    </>
  );
}
