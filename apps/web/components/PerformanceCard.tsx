'use client';

import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { PerformanceGroup, PerformanceReport } from '@/lib/types';
import { Card, Empty, ErrorBox, Loading } from './ui';

/**
 * Holdout is the untreated baseline, so it is neutral gray; variants keep fixed hues from the
 * secondary palette (7687 C, 7702 C, 151 C), stepped to pass the chart palette checks.
 */
const COLORS: Record<string, string> = {
  HOLDOUT: '#8A919E',
  A: '#2C59B0',
  B: '#1E9FCC',
  C: '#F57A00',
};

/**
 * Uplift vs holdout and the A/B comparison for one campaign. Used by the admin campaign page
 * and the partner portal (`path` decides which API, and so which terminals are counted).
 */
export function PerformanceCard({ path, csvHref }: { path: string; csvHref?: string }) {
  const { t, locale } = useI18n();
  const report = useApi<PerformanceReport>(path, { refreshMs: 60_000 });
  const [hover, setHover] = useState<string | null>(null);
  const r = report.data;

  const money = (v: number) => formatMoney(v, r?.currency ?? 'EGP', locale);
  const pct = (v: number) =>
    `${new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en', { maximumFractionDigits: 1 }).format(Math.abs(v) * 100)}%`;
  const signedPct = (v: number) => `${v < 0 ? '−' : '+'}${pct(v)}`;
  const name = (group: string) => {
    if (group === 'HOLDOUT') return t('perf.group.HOLDOUT');
    const v = r?.variants.find((x) => x.key === group);
    return v && v.name !== v.key ? `${v.key} · ${v.name}` : group;
  };

  return (
    <Card
      title={t('perf.title')}
      icon={TrendingUp}
      tone="ok"
      actions={
        csvHref && r && r.groups.length > 0 ? (
          <a className="text-sm font-medium text-brand" href={csvHref}>
            {t('portal.downloadCsv')}
          </a>
        ) : undefined
      }
    >
      <ErrorBox error={report.error} onRetry={report.reload} />
      {!r && !report.error && <Loading />}
      {r && (
        <div className="space-y-5" data-testid="performance">
          <p className="text-xs text-ink-muted">
            {t('perf.period', {
              from: formatDate(r.from, locale),
              to: formatDate(r.to, locale),
            })}
            {' · '}
            {t('wizard.holdout')}: {r.holdoutBps / 100}%
          </p>
          {r.holdoutBps === 0 && r.variants.length < 2 && (
            <p className="text-sm text-ink-muted">{t('perf.none')}</p>
          )}
          {r.groups.every((g) => g.cards === 0) ? (
            <Empty>{t('campaign.noData')}</Empty>
          ) : (
            <>
              <Verdict report={r} name={name} money={money} pct={pct} signedPct={signedPct} />
              <SpendChart
                groups={r.groups}
                name={name}
                money={money}
                hover={hover}
                setHover={setHover}
              />
              <div className="-mx-4 sm:-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-muted">
                      {(
                        [
                          'perf.group',
                          'perf.cards',
                          'perf.payments',
                          'perf.spendPerCard',
                          'perf.avgBasket',
                          'perf.paymentsPerCard',
                          'perf.repeatRate',
                          'common.discount',
                          'perf.costPerPayment',
                          'perf.uplift',
                          'perf.pValue',
                        ] as const
                      ).map((k, i) => (
                        <th
                          key={k}
                          className={`px-3 py-2 font-medium ${i === 0 ? 'ps-5 text-start' : 'text-end'} ${i === 10 ? 'pe-5' : ''}`}
                        >
                          {t(k)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.groups.map((g) => {
                      const u = r.uplift.find((x) => x.group === g.group)?.vsHoldout;
                      return (
                        <tr key={g.group} className="border-b border-line last:border-0">
                          <td className="px-3 py-2 ps-5">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-sm"
                                style={{ background: COLORS[g.group] }}
                                aria-hidden
                              />
                              {name(g.group)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-end">{formatNumber(g.cards, locale)}</td>
                          <td className="px-3 py-2 text-end">{formatNumber(g.payments, locale)}</td>
                          <td className="px-3 py-2 text-end font-medium">
                            {money(g.spendPerCardMinor)}
                          </td>
                          <td className="px-3 py-2 text-end">{money(g.avgBasketMinor)}</td>
                          <td className="px-3 py-2 text-end">{g.paymentsPerCard.toFixed(2)}</td>
                          <td className="px-3 py-2 text-end">{g.repeatRatePct}%</td>
                          <td className="px-3 py-2 text-end">{money(g.discountMinor)}</td>
                          <td className="px-3 py-2 text-end">
                            {g.costPerPaymentMinor === null ? '—' : money(g.costPerPaymentMinor)}
                          </td>
                          <td className="px-3 py-2 text-end">
                            {u?.relative == null ? '—' : signedPct(u.relative)}
                          </td>
                          <td className="px-3 py-2 pe-5 text-end">
                            {u ? u.pValue.toFixed(3) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function Verdict({
  report: r,
  name,
  money,
  pct,
  signedPct,
}: {
  report: PerformanceReport;
  name: (g: string) => string;
  money: (v: number) => string;
  pct: (v: number) => string;
  signedPct: (v: number) => string;
}) {
  const { t } = useI18n();
  const holdout = r.groups.find((g) => g.group === 'HOLDOUT');
  const lines = r.uplift.flatMap((u) => {
    const h = u.vsHoldout;
    if (!h || !holdout || h.relative === null) return [];
    const base = holdout.spendPerCardMinor;
    return [
      {
        group: u.group,
        text: t(h.diff >= 0 ? 'perf.verdictUp' : 'perf.verdictDown', {
          name: name(u.group),
          pct: pct(h.relative),
          lo: signedPct(h.ci95[0] / base),
          hi: signedPct(h.ci95[1] / base),
        }),
        significant: h.significant,
        roi:
          h.roi === null
            ? null
            : t('perf.roi', {
                spend: money(h.incrementalSpendMinor),
                cost: money(r.groups.find((g) => g.group === u.group)?.discountMinor ?? 0),
                roi: h.roi.toFixed(2),
              }),
      },
    ];
  });

  return (
    <div className="space-y-2 rounded-lg bg-canvas px-4 py-3 text-sm">
      {!r.enoughData && (
        <p className="text-warn">{t('perf.notEnough', { n: r.minCardsPerGroup })}</p>
      )}
      {lines.map((l) => (
        <p key={l.group}>
          {l.text}{' '}
          {/* Below the minimum sample a "significant" label would overstate the evidence. */}
          {r.enoughData && (
            <strong className={l.significant ? 'text-ok' : 'text-ink-muted'}>
              {t(l.significant ? 'perf.significant' : 'perf.notSignificant')}
            </strong>
          )}
          {l.roi && <span className="block text-xs text-ink-muted">{l.roi}</span>}
        </p>
      ))}
      {r.variants.length > 1 && r.enoughData && (
        <p className="font-medium">
          {r.winner ? t('perf.winner', { name: name(r.winner) }) : t('perf.noWinner')}
        </p>
      )}
    </div>
  );
}

/**
 * Spend per card by group with 95% CI whiskers. Built in HTML so it follows the page direction
 * (RTL in Arabic). Every bar is labelled with its group and value, and the table repeats the data.
 */
function SpendChart({
  groups,
  name,
  money,
  hover,
  setHover,
}: {
  groups: PerformanceGroup[];
  name: (g: string) => string;
  money: (v: number) => string;
  hover: string | null;
  setHover: (g: string | null) => void;
}) {
  const { t } = useI18n();
  const max = Math.max(
    1,
    ...groups.map((g) => Math.max(g.spendPerCardMinor, g.spendPerCardCi95?.[1] ?? 0)),
  );
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

  return (
    <figure>
      <figcaption className="mb-2 text-xs font-medium text-ink-muted">
        {t('perf.chartTitle')}
      </figcaption>
      <div className="space-y-2" role="img" aria-label={t('perf.chartTitle')}>
        {groups.map((g) => {
          const ci = g.spendPerCardCi95;
          const active = hover === null || hover === g.group;
          return (
            <div
              key={g.group}
              className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3 text-xs"
              onMouseEnter={() => setHover(g.group)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="truncate text-ink">{name(g.group)}</span>
              <div className="relative h-6">
                <div
                  className="absolute top-1 h-4 rounded-e"
                  style={{
                    insetInlineStart: 0,
                    width: at(g.spendPerCardMinor),
                    background: COLORS[g.group] ?? '#5F6673',
                    opacity: active ? 1 : 0.55,
                  }}
                />
                {ci && (
                  <div
                    className="absolute top-3 h-px bg-ink"
                    style={{
                      insetInlineStart: at(ci[0]),
                      width: `calc(${at(ci[1])} - ${at(ci[0])})`,
                    }}
                  >
                    <span
                      className="absolute -top-1.5 h-3 w-px bg-ink"
                      style={{ insetInlineStart: 0 }}
                    />
                    <span
                      className="absolute -top-1.5 h-3 w-px bg-ink"
                      style={{ insetInlineEnd: 0 }}
                    />
                  </div>
                )}
              </div>
              <span className="ltr text-end font-medium text-ink">
                {money(g.spendPerCardMinor)}
              </span>
              {hover === g.group && ci && (
                <span className="col-span-3 -mt-1 text-ink-muted">
                  {t('perf.ciTooltip', { lo: money(ci[0]), hi: money(ci[1]), cards: g.cards })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </figure>
  );
}
