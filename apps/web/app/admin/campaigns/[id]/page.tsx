'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { DailyChart } from '@/components/DailyChart';
import {
  Badge,
  Button,
  CampaignStatusBadge,
  Card,
  Empty,
  ErrorBox,
  LinkButton,
  Loading,
  Meter,
  Modal,
  PageHeader,
  Stat,
} from '@/components/ui';
import { api, useApi, type ApiError } from '@/lib/api';
import { discountLabel } from '@/lib/campaign';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { APPROVERS, EDITORS, useSession } from '@/lib/session';
import type { Campaign, CampaignStats } from '@/lib/types';
import type { MessageKey } from '@/messages/en';

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { user, can } = useSession();
  const router = useRouter();
  const campaign = useApi<Campaign>(`/campaigns/${id}`);
  const stats = useApi<CampaignStats>(`/campaigns/${id}/stats`, { refreshMs: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [ending, setEnding] = useState(false);

  const c = campaign.data;
  if (campaign.error) return <ErrorBox error={campaign.error} onRetry={campaign.reload} />;
  if (!c) return <Loading />;

  const act = async (action: string, body: unknown = {}) => {
    setBusy(action);
    setError(undefined);
    try {
      const result = await api<Campaign>(`/campaigns/${id}/${action}`, { body });
      if (action === 'clone') return router.push(`/admin/campaigns/${result.id}/edit`);
      await campaign.reload();
      await stats.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const isMaker = !!user && [c.createdById, c.updatedById, c.submittedById].includes(user.id);
  const isChangeMaker = !!user && c.pendingById === user.id;
  const awaiting = c.status === 'PENDING_APPROVAL' || !!c.pendingChanges;
  const canDecide =
    can(...APPROVERS) && awaiting && !(c.status === 'PENDING_APPROVAL' ? isMaker : isChangeMaker);
  const editable = can(...EDITORS) && ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED'].includes(c.status);
  const s = stats.data;
  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? t('common.unlimited') : formatMoney(v, c.currency, locale);
  const n = (v: number | null | undefined) =>
    v === null || v === undefined ? t('common.unlimited') : formatNumber(v, locale);

  return (
    <>
      <PageHeader
        back="/admin/campaigns"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {locale === 'ar' && c.nameAr ? c.nameAr : c.name}{' '}
            <CampaignStatusBadge status={c.status} />
            <Badge>{t('campaign.version', { version: c.version })}</Badge>
          </span>
        }
        subtitle={`${t(`country.${c.country}`)} · ${discountLabel(c, t)} · ${formatDateTime(c.startAt, locale, c.timezone)} → ${formatDateTime(c.endAt, locale, c.timezone)}`}
        actions={
          <>
            {editable && (
              <LinkButton variant="secondary" href={`/admin/campaigns/${id}/edit`}>
                {t('common.edit')}
              </LinkButton>
            )}
            {can(...EDITORS) && c.status === 'DRAFT' && (
              <Button loading={busy === 'submit'} onClick={() => void act('submit')}>
                {t('campaign.submit')}
              </Button>
            )}
            {can(...EDITORS) && c.status === 'PENDING_APPROVAL' && (
              <Button
                variant="secondary"
                loading={busy === 'withdraw'}
                onClick={() => void act('withdraw')}
              >
                {t('campaign.withdraw')}
              </Button>
            )}
            {canDecide && (
              <Button loading={busy === 'approve'} onClick={() => void act('approve')}>
                {t('campaign.approve')}
              </Button>
            )}
            {canDecide && (
              <Button variant="danger" onClick={() => setRejecting(true)}>
                {t('campaign.reject')}
              </Button>
            )}
            {can(...EDITORS, 'APPROVER') && (c.status === 'ACTIVE' || c.status === 'SCHEDULED') && (
              <Button
                variant="secondary"
                loading={busy === 'pause'}
                onClick={() => void act('pause')}
              >
                {t('campaign.pause')}
              </Button>
            )}
            {can(...EDITORS, 'APPROVER') && c.status === 'PAUSED' && (
              <Button loading={busy === 'resume'} onClick={() => void act('resume')}>
                {t('campaign.resume')}
              </Button>
            )}
            {can(...EDITORS, 'APPROVER') &&
              ['SCHEDULED', 'ACTIVE', 'PAUSED'].includes(c.status) && (
                <Button variant="danger" onClick={() => setEnding(true)}>
                  {t('campaign.end')}
                </Button>
              )}
            {can(...EDITORS) && (
              <Button variant="ghost" loading={busy === 'clone'} onClick={() => void act('clone')}>
                {t('campaign.clone')}
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6">
        <ErrorBox error={error} />
        {c.rejectionReason && (
          <div className="rounded-lg border border-bad/20 bg-bad-bg px-4 py-3 text-sm text-bad">
            <strong>{t('campaign.rejected')}: </strong>
            {c.rejectionReason}
          </div>
        )}
        {c.pendingChanges && (
          <div className="rounded-lg border border-warn/20 bg-warn-bg px-4 py-3 text-sm text-warn">
            <strong>{t('campaign.pendingTitle')}</strong> — {t('campaign.pendingBody')}
            {isChangeMaker && <div className="mt-1">{t('campaign.makerNote')}</div>}
            <div className="mt-1 text-xs">
              {t('common.discount')}:{' '}
              {discountLabel(
                { discountConfig: c.pendingChanges.discount, currency: c.currency },
                t,
              )}{' '}
              · {t('wizard.totalBudget')}: {money(c.pendingChanges.limits.totalBudgetMinor)}
            </div>
          </div>
        )}
        {c.status === 'PENDING_APPROVAL' && isMaker && can(...APPROVERS) && (
          <p className="text-sm text-ink-muted">{t('campaign.makerNote')}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="card p-4">
            <div className="text-xs text-ink-muted">{t('campaign.budget')}</div>
            <div className="mt-1 text-lg font-semibold ltr text-start">
              {s ? formatMoney(s.budget.usedMinor, c.currency, locale) : '—'}{' '}
              <span className="text-sm font-normal text-ink-muted">
                / {money(s?.budget.totalMinor)}
              </span>
            </div>
            <div className="mt-2">
              <Meter pct={s?.budget.usedPct ?? null} />
            </div>
            <div className="mt-1 text-xs text-ink-faint">
              {t('campaign.remaining')}: {money(s?.budget.remainingMinor)}
            </div>
          </div>
          <Stat
            label={t('campaign.uniqueCards')}
            value={`${formatNumber(s?.uniqueCards.used ?? 0, locale)} / ${n(c.maxUniqueCards)}`}
          />
          <Stat
            label={t('campaign.redemptions')}
            value={formatNumber(
              (s?.redemptionsByStatus.CONFIRMED ?? 0) +
                (s?.redemptionsByStatus.PARTIALLY_REFUNDED ?? 0),
              locale,
            )}
            hint={
              s &&
              Object.entries(s.redemptionsByStatus)
                .map(([k, v]) => `${t(`rstatus.${k}` as MessageKey)} ${v}`)
                .join(' · ')
            }
          />
          <Stat
            label={t('campaign.confirmRate')}
            value={
              s?.confirmRate === null || s?.confirmRate === undefined ? '—' : `${s.confirmRate}%`
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" title={t('campaign.daily')}>
            {s && s.daily.length > 0 ? (
              <DailyChart data={s.daily} currency={c.currency} timeZone={c.timezone} />
            ) : (
              <Empty>{t('campaign.noData')}</Empty>
            )}
          </Card>
          <Card title={t('campaign.topTerminals')}>
            {s && s.topTerminals.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {s.topTerminals.map((term) => (
                  <li key={term.terminalId} className="flex justify-between gap-3">
                    <span className="ltr">{term.externalTerminalId}</span>
                    <span className="text-ink-muted">
                      {formatNumber(term.redemptions, locale)} ·{' '}
                      {formatMoney(term.discountMinor, c.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t('campaign.noData')}</Empty>
            )}
          </Card>
        </div>

        <Card title={t('campaign.configuration')}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['campaigns.priority', String(c.priority)],
                ['wizard.totalBudget', money(c.totalBudgetMinor)],
                ['wizard.maxCards', n(c.maxUniqueCards)],
                ['wizard.dailyBudget', money(c.dailyBudgetMinor)],
                ['wizard.dailyCount', n(c.dailyRedemptionLimit)],
                [
                  'wizard.perCardCount',
                  `${n(c.perCardMaxCount)} · ${t(`wizard.period.${c.perCardPeriod ?? 'CAMPAIGN'}`)}`,
                ],
                ['wizard.perCardAmount', money(c.perCardMaxAmountMinor)],
                [
                  'wizard.bins',
                  c.targeting.binRanges
                    ?.map((b) => (b.from === b.to ? b.from : `${b.from}–${b.to}`))
                    .join(', ') ?? t('common.all'),
                ],
                ['wizard.schemes', c.targeting.schemes?.join(', ') ?? t('common.all')],
                ['wizard.mccs', c.targeting.mccs?.join(', ') ?? t('common.all')],
                [
                  'wizard.funders',
                  c.fundings.map((f) => `${f.partner?.name} ${f.shareBps / 100}%`).join(' · '),
                ],
                ['wizard.settlement', t(`wizard.settlement.${c.settlementMode}`)],
                ['wizard.displayMessage', c.displayMessage ?? '—'],
              ] as Array<[MessageKey, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-muted">{t(k)}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {!!c.versions?.length && (
            <div className="mt-6 border-t border-line pt-4 text-xs text-ink-muted">
              {t('campaign.versions')}:{' '}
              {c.versions.map((v) => (
                <span key={v.version} className="me-3">
                  v{v.version} · {formatDateTime(v.createdAt, locale)}
                </span>
              ))}
              <Link className="text-brand" href={`/admin/transactions?campaignId=${c.id}`}>
                {t('nav.transactions')} →
              </Link>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={rejecting}
        title={t('campaign.reject')}
        onClose={() => setRejecting(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              loading={busy === 'reject'}
              onClick={async () => {
                await act('reject', { reason });
                setRejecting(false);
                setReason('');
              }}
            >
              {t('campaign.reject')}
            </Button>
          </>
        }
      >
        <label className="label" htmlFor="reject-reason">
          {t('campaign.rejectReason')}
        </label>
        <textarea
          id="reject-reason"
          className="input h-24 py-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
      <Modal
        open={ending}
        title={t('campaign.end')}
        onClose={() => setEnding(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnding(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busy === 'end'}
              onClick={async () => {
                await act('end');
                setEnding(false);
              }}
            >
              {t('campaign.end')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('campaign.endConfirm')}</p>
      </Modal>
    </>
  );
}
