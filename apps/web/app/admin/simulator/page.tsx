'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Badge,
  Button,
  CampaignStatusBadge,
  Card,
  ErrorBox,
  Field,
  PageHeader,
  Select,
  Table,
} from '@/components/ui';
import { api, useApi, type ApiError, type Page } from '@/lib/api';
import { SCHEMES } from '@/lib/campaign';
import { formatMoney, toMinor, zonedToUtc } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Terminal } from '@/lib/types';
import type { MessageKey } from '@/messages/en';

interface SimResult {
  terminal: { currency: string; country: string };
  winnerCampaignId: string | null;
  results: Array<{
    campaignId: string;
    name: string;
    status: string;
    priority: number;
    eligible: boolean;
    reason: string | null;
    discountMinor: number | null;
    finalAmountMinor: number | null;
    cappedBy: string | null;
    /** Only when a card token was given: the card's experiment group in this campaign. */
    group?: string | null;
    heldOut?: boolean;
    headroom: {
      budgetMinor: number | null;
      uniqueCards: number | null;
      dailyBudgetMinor: number | null;
      dailyRedemptions: number | null;
    };
  }>;
}

export default function SimulatorPage() {
  const { t, locale } = useI18n();
  const terminals = useApi<Page<Terminal>>('/terminals?pageSize=200');
  const [terminalId, setTerminalId] = useState('');
  const [bin, setBin] = useState('');
  const [scheme, setScheme] = useState('VISA');
  const [amount, setAmount] = useState('500');
  const [at, setAt] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [cardToken, setCardToken] = useState('');
  const [result, setResult] = useState<SimResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const tz = 'Africa/Cairo';
      setResult(
        await api<SimResult>('/simulate', {
          body: {
            terminalId,
            bin,
            scheme,
            amountMinor: toMinor(amount),
            includeInactive,
            cardToken: cardToken.trim() || undefined,
            at: at ? zonedToUtc(at, tz).toISOString() : undefined,
          },
        }),
      );
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const winner = result?.results.find((r) => r.campaignId === result.winnerCampaignId);
  const cur = result?.terminal.currency ?? 'EGP';

  return (
    <>
      <PageHeader title={t('sim.title')} subtitle={t('sim.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <Field label={t('sim.terminal')}>
              <Select
                value={terminalId}
                onChange={setTerminalId}
                placeholder="—"
                options={(terminals.data?.items ?? []).map((term) => ({
                  value: term.id,
                  label: `${term.externalTerminalId} · ${term.merchant?.name ?? ''}`,
                }))}
              />
            </Field>
            <Field label={t('sim.bin')}>
              <input
                className="input ltr"
                required
                pattern="\d{6,8}"
                value={bin}
                onChange={(e) => setBin(e.target.value)}
              />
            </Field>
            <Field label={t('sim.scheme')}>
              <Select
                value={scheme}
                onChange={setScheme}
                options={SCHEMES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
            <Field label={t('sim.amount')}>
              <input
                className="input ltr"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={t('sim.at')} hint={t('wizard.timezoneNote', { tz: 'Africa/Cairo' })}>
              <input
                className="input ltr"
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </Field>
            <Field label={t('sim.cardToken')} hint={t('sim.cardTokenHint')}>
              <input
                className="input ltr"
                minLength={8}
                value={cardToken}
                onChange={(e) => setCardToken(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-brand"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              {t('sim.includeInactive')}
            </label>
            <Button className="w-full" loading={busy} disabled={!terminalId}>
              {t('sim.run')}
            </Button>
          </form>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <ErrorBox error={error} />
          {result && (
            <div className={`card p-5 ${winner ? 'border-ok/30' : ''}`}>
              {winner ? (
                <>
                  <div className="text-xs text-ink-muted">{t('sim.winner')}</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {formatMoney(winner.discountMinor, cur, locale)}
                  </div>
                  <div className="mt-1 text-sm">
                    <Link
                      className="font-medium text-brand"
                      href={`/admin/campaigns/${winner.campaignId}`}
                    >
                      {winner.name}
                    </Link>{' '}
                    · {t('sim.pay', { amount: formatMoney(winner.finalAmountMinor, cur, locale) })}
                  </div>
                </>
              ) : (
                <div className="text-sm">{t('sim.noWinner')}</div>
              )}
            </div>
          )}
          {result && (
            <Card>
              <div className="-m-4 sm:-m-5">
                <Table
                  rows={result.results}
                  rowKey={(r) => r.campaignId}
                  columns={[
                    {
                      key: 'name',
                      header: t('common.name'),
                      cell: (r) => (
                        <Link
                          className="font-medium hover:text-brand"
                          href={`/admin/campaigns/${r.campaignId}`}
                        >
                          {r.name}
                        </Link>
                      ),
                    },
                    {
                      key: 'status',
                      header: t('common.status'),
                      cell: (r) => <CampaignStatusBadge status={r.status} />,
                    },
                    { key: 'priority', header: t('campaigns.priority'), cell: (r) => r.priority },
                    {
                      key: 'group',
                      header: t('sim.group'),
                      cell: (r) =>
                        r.group ? (
                          <span className="ltr">
                            {r.group === 'HOLDOUT' ? t('perf.group.HOLDOUT') : r.group}
                          </span>
                        ) : (
                          '—'
                        ),
                    },
                    {
                      key: 'verdict',
                      header: t('common.reason'),
                      cell: (r) =>
                        r.eligible && r.heldOut ? (
                          <Badge>{t('sim.heldOut')}</Badge>
                        ) : r.eligible ? (
                          r.cappedBy ? (
                            <Badge tone="warn">
                              {t('sim.cappedBy')}: {t(`reason.${r.cappedBy}` as MessageKey)}
                            </Badge>
                          ) : (
                            <Badge tone="ok">{t('sim.eligible')}</Badge>
                          )
                        ) : (
                          <Badge>{t(`reason.${r.reason}` as MessageKey)}</Badge>
                        ),
                    },
                    {
                      key: 'discount',
                      header: t('common.discount'),
                      cell: (r) => formatMoney(r.discountMinor, cur, locale),
                    },
                    {
                      key: 'headroom',
                      header: t('sim.headroom'),
                      cell: (r) => (
                        <span className="text-xs text-ink-muted">
                          {r.headroom.budgetMinor === null
                            ? t('common.unlimited')
                            : formatMoney(r.headroom.budgetMinor, cur, locale)}
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
