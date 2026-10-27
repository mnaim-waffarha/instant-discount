'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, useApi, type Page, ApiError } from '@/lib/api';
import { COUNTRY, SCHEMES, formToInput, type CampaignForm } from '@/lib/campaign';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Campaign, Merchant, Partner, Terminal } from '@/lib/types';
import type { MessageKey } from '@/messages/en';
import { Button, Card, ErrorBox, Field, Select } from './ui';

const STEPS: MessageKey[] = [
  'wizard.stepBasics',
  'wizard.stepDiscount',
  'wizard.stepTargeting',
  'wizard.stepLimits',
  'wizard.stepFunding',
  'wizard.stepSchedule',
  'wizard.stepReview',
];

interface Props {
  initial: CampaignForm;
  /** Editing an existing campaign. */
  campaign?: Campaign;
}

export function CampaignWizard({ initial, campaign }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<CampaignForm>(initial);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const live = !!campaign && ['SCHEDULED', 'ACTIVE', 'PAUSED'].includes(campaign.status);
  const set = <K extends keyof CampaignForm>(key: K, value: CampaignForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const currency = COUNTRY[form.country].currency;
  const tz = COUNTRY[form.country].timezone;

  const partners = useApi<Page<Partner>>(`/partners?country=${form.country}&pageSize=200`);
  const merchants = useApi<Page<Merchant>>(`/merchants?country=${form.country}&pageSize=200`);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  useEffect(() => {
    if (!form.merchantIds.length) return setTerminals([]);
    Promise.all(
      form.merchantIds.map((id) => api<Page<Terminal>>(`/terminals?merchantId=${id}&pageSize=200`)),
    )
      .then((pages) => setTerminals(pages.flatMap((p) => p.items)))
      .catch(() => setTerminals([]));
  }, [form.merchantIds]);

  const shareTotal = useMemo(
    () => form.fundings.reduce((s, f) => s + (Number(f.share) || 0), 0),
    [form.fundings],
  );

  async function save(submit: boolean) {
    setSaving(submit ? 'submit' : 'draft');
    setError(undefined);
    try {
      const body = formToInput(form);
      const saved = campaign
        ? await api<Campaign>(`/campaigns/${campaign.id}`, { method: 'PUT', body })
        : await api<Campaign>('/campaigns', { body });
      if (submit && saved.status === 'DRAFT')
        await api(`/campaigns/${saved.id}/submit`, { body: {} });
      router.push(`/admin/campaigns/${saved.id}`);
    } catch (e) {
      setError((e as ApiError).message);
      setSaving(null);
    }
  }

  const money = (label: MessageKey, key: keyof CampaignForm, hint?: ReactNode) => (
    <Field label={`${t(label)} (${currency})`} hint={hint}>
      <input
        className="input ltr"
        inputMode="decimal"
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        placeholder={t('common.unlimited')}
      />
    </Field>
  );
  const count = (label: MessageKey, key: keyof CampaignForm) => (
    <Field label={t(label)}>
      <input
        className="input ltr"
        inputMode="numeric"
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        placeholder={t('common.unlimited')}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      {live && (
        <p className="rounded-lg border border-warn/20 bg-warn-bg px-4 py-3 text-sm text-warn">
          {t('wizard.liveNote')}
        </p>
      )}
      <nav className="flex flex-wrap gap-1" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${i === step ? 'bg-brand text-white' : 'bg-white text-ink-muted ring-1 ring-line hover:text-ink'}`}
          >
            <span className="ltr">{i + 1}</span>. {t(s)}
          </button>
        ))}
      </nav>
      <ErrorBox error={error} />

      <Card>
        {step === 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('common.name')}>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
            <Field label={t('common.nameAr')}>
              <input
                className="input"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => set('nameAr', e.target.value)}
              />
            </Field>
            <Field label={t('common.country')}>
              <Select
                value={form.country}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    country: v as CampaignForm['country'],
                    merchantIds: [],
                    excludeTerminalIds: [],
                    fundings: [{ partnerId: '', share: '100' }],
                  }))
                }
                options={[
                  { value: 'EG', label: `${t('country.EG')} (EGP)` },
                  { value: 'SA', label: `${t('country.SA')} (SAR)` },
                ]}
              />
            </Field>
            <Field label={t('wizard.priority')}>
              <input
                className="input ltr"
                inputMode="numeric"
                value={form.priority}
                onChange={(e) => set('priority', e.target.value)}
              />
            </Field>
            <Field label={t('wizard.displayMessage')}>
              <input
                className="input"
                maxLength={120}
                value={form.displayMessage}
                onChange={(e) => set('displayMessage', e.target.value)}
              />
            </Field>
            <Field label={t('wizard.displayMessageAr')}>
              <input
                className="input"
                dir="rtl"
                maxLength={120}
                value={form.displayMessageAr}
                onChange={(e) => set('displayMessageAr', e.target.value)}
              />
            </Field>
            <Field label={t('wizard.description')} className="md:col-span-2">
              <textarea
                className="input h-20 py-2"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Field label={t('wizard.discountType')}>
              <div className="flex flex-wrap gap-2">
                {(['PERCENT', 'FIXED', 'TIERED'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => set('discountType', type)}
                    className={`rounded-lg border px-4 py-2 text-sm ${form.discountType === type ? 'border-brand bg-brand-50 text-brand-600' : 'border-line bg-white'}`}
                  >
                    {t(`wizard.type.${type}`)}
                  </button>
                ))}
              </div>
            </Field>
            {form.discountType === 'PERCENT' && (
              <div className="grid gap-4 md:grid-cols-3">
                <Field label={t('wizard.percent')}>
                  <input
                    className="input ltr"
                    inputMode="decimal"
                    value={form.percent}
                    onChange={(e) => set('percent', e.target.value)}
                  />
                </Field>
                {money('wizard.maxDiscount', 'maxDiscount')}
                {money('wizard.minSpend', 'minSpend')}
              </div>
            )}
            {form.discountType === 'FIXED' && (
              <div className="grid gap-4 md:grid-cols-3">
                <Field label={`${t('wizard.fixedAmount')} (${currency})`}>
                  <input
                    className="input ltr"
                    inputMode="decimal"
                    value={form.fixedAmount}
                    onChange={(e) => set('fixedAmount', e.target.value)}
                  />
                </Field>
                {money('wizard.minSpend', 'minSpend')}
              </div>
            )}
            {form.discountType === 'TIERED' && (
              <div className="space-y-3">
                <p className="text-xs text-ink-muted">{t('wizard.tierHint')}</p>
                {form.tiers.map((tier, i) => (
                  <div key={i} className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                    {(['minSpend', 'percent', 'maxDiscount', 'amount'] as const).map((k) => (
                      <Field
                        key={k}
                        label={
                          k === 'minSpend'
                            ? `${t('wizard.tierMinSpend')} (${currency})`
                            : k === 'percent'
                              ? t('wizard.tierPercent')
                              : k === 'maxDiscount'
                                ? `${t('wizard.maxDiscount')} (${currency})`
                                : `${t('wizard.tierFixed')} (${currency})`
                        }
                      >
                        <input
                          className="input ltr"
                          inputMode="decimal"
                          value={tier[k]}
                          onChange={(e) =>
                            set(
                              'tiers',
                              form.tiers.map((x, j) =>
                                j === i ? { ...x, [k]: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </Field>
                    ))}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        set(
                          'tiers',
                          form.tiers.filter((_, j) => j !== i),
                        )
                      }
                      disabled={form.tiers.length === 1}
                    >
                      {t('common.remove')}
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    set('tiers', [
                      ...form.tiers,
                      { minSpend: '', percent: '', amount: '', maxDiscount: '' },
                    ])
                  }
                >
                  + {t('wizard.addTier')}
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <div className="label">{t('wizard.bins')}</div>
              <p className="mb-2 text-xs text-ink-faint">{t('wizard.binsHint')}</p>
              {form.bins.map((b, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <input
                    className="input ltr"
                    aria-label={t('common.from')}
                    placeholder={t('common.from')}
                    value={b.from}
                    onChange={(e) =>
                      set(
                        'bins',
                        form.bins.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)),
                      )
                    }
                  />
                  <input
                    className="input ltr"
                    aria-label={t('common.to')}
                    placeholder={t('common.to')}
                    value={b.to}
                    onChange={(e) =>
                      set(
                        'bins',
                        form.bins.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      set(
                        'bins',
                        form.bins.filter((_, j) => j !== i),
                      )
                    }
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set('bins', [...form.bins, { from: '', to: '' }])}
              >
                + {t('wizard.addBin')}
              </Button>
            </div>
            <div>
              <div className="label">{t('wizard.schemes')}</div>
              <p className="mb-2 text-xs text-ink-faint">{t('wizard.schemesHint')}</p>
              <div className="flex flex-wrap gap-3">
                {SCHEMES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={form.schemes.includes(s)}
                      onChange={(e) =>
                        set(
                          'schemes',
                          e.target.checked
                            ? [...form.schemes, s]
                            : form.schemes.filter((x) => x !== s),
                        )
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="label">{t('wizard.merchants')}</div>
              <p className="mb-2 text-xs text-ink-faint">{t('wizard.merchantsHint')}</p>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                {merchants.data?.items.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-canvas"
                  >
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={form.merchantIds.includes(m.id)}
                      onChange={(e) =>
                        set(
                          'merchantIds',
                          e.target.checked
                            ? [...form.merchantIds, m.id]
                            : form.merchantIds.filter((x) => x !== m.id),
                        )
                      }
                    />
                    {m.name} <span className="text-xs text-ink-faint">({m.partner?.name})</span>
                  </label>
                ))}
              </div>
            </div>
            {terminals.length > 0 && (
              <div>
                <div className="label">{t('wizard.excludeTerminals')}</div>
                <div className="flex flex-wrap gap-3">
                  {terminals.map((term) => (
                    <label key={term.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={form.excludeTerminalIds.includes(term.id)}
                        onChange={(e) =>
                          set(
                            'excludeTerminalIds',
                            e.target.checked
                              ? [...form.excludeTerminalIds, term.id]
                              : form.excludeTerminalIds.filter((x) => x !== term.id),
                          )
                        }
                      />
                      <span className="ltr">{term.externalTerminalId}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Field label={t('wizard.mccs')} hint={t('wizard.mccsHint')}>
              <input
                className="input ltr"
                value={form.mccs}
                onChange={(e) => set('mccs', e.target.value)}
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted">{t('wizard.limitsHint')}</p>
            <div className="grid gap-4 md:grid-cols-3">
              {money('wizard.totalBudget', 'totalBudget')}
              {count('wizard.maxCards', 'maxCards')}
              {money('wizard.dailyBudget', 'dailyBudget')}
              {count('wizard.dailyCount', 'dailyCount')}
              {count('wizard.perCardCount', 'perCardCount')}
              {money('wizard.perCardAmount', 'perCardAmount')}
              <label className="flex items-center gap-2 self-end text-sm md:col-span-2">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.autoPauseOnFraud}
                  onChange={(e) => set('autoPauseOnFraud', e.target.checked)}
                />
                {t('wizard.autoPause')}
              </label>
              <Field label={t('wizard.perCardPeriod')}>
                <Select
                  value={form.perCardPeriod}
                  onChange={(v) => set('perCardPeriod', v as CampaignForm['perCardPeriod'])}
                  options={(['DAY', 'WEEK', 'CAMPAIGN'] as const).map((p) => ({
                    value: p,
                    label: t(`wizard.period.${p}`),
                  }))}
                />
              </Field>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <div className="label">{t('wizard.funders')}</div>
              <p className="mb-3 text-xs text-ink-faint">{t('wizard.fundersHint')}</p>
              {form.fundings.map((f, i) => (
                <div key={i} className="mb-2 grid items-center gap-2 sm:grid-cols-[1fr_8rem_auto]">
                  <Select
                    value={f.partnerId}
                    onChange={(v) =>
                      set(
                        'fundings',
                        form.fundings.map((x, j) => (j === i ? { ...x, partnerId: v } : x)),
                      )
                    }
                    placeholder={t('common.partner')}
                    options={(partners.data?.items ?? []).map((p) => ({
                      value: p.id,
                      label: `${p.name} · ${t(`ptype.${p.type}`)}`,
                    }))}
                  />
                  <input
                    className="input ltr"
                    inputMode="decimal"
                    aria-label={t('wizard.share')}
                    value={f.share}
                    onChange={(e) =>
                      set(
                        'fundings',
                        form.fundings.map((x, j) =>
                          j === i ? { ...x, share: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      set(
                        'fundings',
                        form.fundings.filter((_, j) => j !== i),
                      )
                    }
                    disabled={form.fundings.length === 1}
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => set('fundings', [...form.fundings, { partnerId: '', share: '' }])}
                >
                  + {t('wizard.addFunder')}
                </Button>
                <span
                  className={`text-sm font-medium ${Math.abs(shareTotal - 100) < 0.001 ? 'text-ok' : 'text-bad'}`}
                >
                  {t('wizard.shareTotal', { total: shareTotal })}
                </span>
              </div>
            </div>
            <Field label={t('wizard.settlement')}>
              <Select
                value={form.settlementMode}
                onChange={(v) => set('settlementMode', v as CampaignForm['settlementMode'])}
                options={(['WAFFARHA_COLLECTS', 'DIRECT'] as const).map((m) => ({
                  value: m,
                  label: t(`wizard.settlement.${m}`),
                }))}
              />
            </Field>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('wizard.startAt')} hint={t('wizard.timezoneNote', { tz })}>
                <input
                  type="datetime-local"
                  className="input ltr"
                  value={form.startAt}
                  onChange={(e) => set('startAt', e.target.value)}
                />
              </Field>
              <Field label={t('wizard.endAt')} hint={t('wizard.timezoneNote', { tz })}>
                <input
                  type="datetime-local"
                  className="input ltr"
                  value={form.endAt}
                  onChange={(e) => set('endAt', e.target.value)}
                />
              </Field>
            </div>
            <div>
              <div className="label">{t('wizard.windows')}</div>
              <p className="mb-2 text-xs text-ink-faint">{t('wizard.windowsHint')}</p>
              {form.windows.map((w, i) => (
                <div
                  key={i}
                  className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
                >
                  <div className="flex flex-wrap gap-2">
                    {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                      <label key={d} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          className="accent-brand"
                          checked={w.days.includes(d)}
                          onChange={(e) =>
                            set(
                              'windows',
                              form.windows.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      days: e.target.checked
                                        ? [...x.days, d]
                                        : x.days.filter((y) => y !== d),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        {t(`day.${d}` as MessageKey)}
                      </label>
                    ))}
                  </div>
                  <input
                    type="time"
                    className="input ltr w-32"
                    aria-label={t('common.from')}
                    value={w.start}
                    onChange={(e) =>
                      set(
                        'windows',
                        form.windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                      )
                    }
                  />
                  <input
                    type="time"
                    className="input ltr w-32"
                    aria-label={t('common.to')}
                    value={w.end}
                    onChange={(e) =>
                      set(
                        'windows',
                        form.windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      set(
                        'windows',
                        form.windows.filter((_, j) => j !== i),
                      )
                    }
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  set('windows', [
                    ...form.windows,
                    { days: [0, 1, 2, 3, 4], start: '12:00', end: '16:00' },
                  ])
                }
              >
                + {t('wizard.addWindow')}
              </Button>
            </div>
          </div>
        )}

        {step === 6 && (
          <Review
            form={form}
            partners={partners.data?.items ?? []}
            merchants={merchants.data?.items ?? []}
            locale={locale}
          />
        )}
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t('common.back')}
        </Button>
        <div className="flex gap-2">
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)}>{t('common.next')}</Button>
          ) : live ? (
            <Button loading={saving === 'draft'} onClick={() => void save(false)}>
              {t('wizard.proposeChange')}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                loading={saving === 'draft'}
                disabled={!!saving}
                onClick={() => void save(false)}
              >
                {t('wizard.saveDraft')}
              </Button>
              <Button
                loading={saving === 'submit'}
                disabled={!!saving}
                onClick={() => void save(true)}
              >
                {t('wizard.saveSubmit')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Review({
  form,
  partners,
  merchants,
  locale,
}: {
  form: CampaignForm;
  partners: Partner[];
  merchants: Merchant[];
  locale: 'en' | 'ar';
}) {
  const { t } = useI18n();
  const input = formToInput(form);
  const cur = input.currency;
  const m = (v: number | null | undefined) =>
    v === null || v === undefined ? t('common.unlimited') : formatMoney(v, cur, locale);
  const n = (v: number | null | undefined) =>
    v === null || v === undefined ? t('common.unlimited') : String(v);
  const d = input.discount;
  const discount =
    d.type === 'PERCENT'
      ? `${d.percentBps / 100}%${d.maxDiscountMinor ? ` · max ${m(d.maxDiscountMinor)}` : ''}${d.minSpendMinor ? ` · min ${m(d.minSpendMinor)}` : ''}`
      : d.type === 'FIXED'
        ? `${m(d.amountMinor)}${d.minSpendMinor ? ` · min ${m(d.minSpendMinor)}` : ''}`
        : d.tiers
            .map(
              (tier) =>
                `≥ ${m(tier.minSpendMinor)}: ${'percentBps' in tier ? `${tier.percentBps / 100}%` : m(tier.amountMinor)}`,
            )
            .join(' · ');
  const rows: Array<[MessageKey, string]> = [
    ['common.name', input.name || '—'],
    ['common.country', `${t(`country.${input.country}`)} · ${cur}`],
    ['campaigns.priority', String(input.priority)],
    ['common.discount', discount],
    [
      'wizard.bins',
      input.targeting.binRanges
        ?.map((b) => (b.from === b.to ? b.from : `${b.from}–${b.to}`))
        .join(', ') ?? t('common.all'),
    ],
    ['wizard.schemes', input.targeting.schemes?.join(', ') ?? t('common.all')],
    [
      'wizard.merchants',
      input.targeting.merchantIds
        ?.map((id) => merchants.find((x) => x.id === id)?.name ?? id)
        .join(', ') ?? t('common.all'),
    ],
    ['wizard.mccs', input.targeting.mccs?.join(', ') ?? t('common.all')],
    ['wizard.totalBudget', m(input.limits.totalBudgetMinor)],
    ['wizard.maxCards', n(input.limits.maxUniqueCards)],
    ['wizard.dailyBudget', m(input.limits.dailyBudgetMinor)],
    ['wizard.dailyCount', n(input.limits.dailyRedemptionLimit)],
    [
      'wizard.perCardCount',
      `${n(input.limits.perCardMaxCount)} · ${t(`wizard.period.${input.limits.perCardPeriod}`)}`,
    ],
    ['wizard.perCardAmount', m(input.limits.perCardMaxAmountMinor)],
    [
      'wizard.funders',
      input.fundings
        .map(
          (f) => `${partners.find((p) => p.id === f.partnerId)?.name ?? '?'} ${f.shareBps / 100}%`,
        )
        .join(' · '),
    ],
    ['wizard.settlement', t(`wizard.settlement.${input.settlementMode}`)],
    ['wizard.startAt', formatDateTime(input.startAt, locale, input.timezone)],
    ['wizard.endAt', formatDateTime(input.endAt, locale, input.timezone)],
    [
      'wizard.windows',
      input.schedule
        ?.map(
          (w) =>
            `${w.daysOfWeek.map((x) => t(`day.${x}` as MessageKey)).join(' ')} ${Math.floor(w.startMinute / 60)}:${String(w.startMinute % 60).padStart(2, '0')}–${Math.floor(w.endMinute / 60)}:${String(w.endMinute % 60).padStart(2, '0')}`,
        )
        .join(' | ') ?? t('common.all'),
    ],
  ];
  return (
    <div>
      <p className="mb-4 text-sm text-ink-muted">{t('wizard.reviewHint')}</p>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[14rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{t(k)}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
