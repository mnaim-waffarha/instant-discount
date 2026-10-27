'use client';

import type { DiscountFields } from '@/lib/campaign';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/messages/en';
import { Button, Field } from './ui';

/** Discount type, level and minimum spend. Used for the campaign and for each A/B variant. */
export function DiscountEditor({
  value,
  onChange,
  currency,
  idPrefix = 'discount',
}: {
  value: DiscountFields;
  onChange: (next: DiscountFields) => void;
  currency: string;
  idPrefix?: string;
}) {
  const { t } = useI18n();
  const set = <K extends keyof DiscountFields>(key: K, v: DiscountFields[K]) =>
    onChange({ ...value, [key]: v });
  const money = (label: MessageKey, key: 'maxDiscount' | 'minSpend') => (
    <Field label={`${t(label)} (${currency})`}>
      <input
        className="input ltr"
        inputMode="decimal"
        value={value[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={t('common.unlimited')}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      {/* A labelled group, not a <label>: a label would name only the first button. */}
      <div>
        <div className="label" id={`${idPrefix}-type`}>
          {t('wizard.discountType')}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${idPrefix}-type`}>
          {(['PERCENT', 'FIXED', 'TIERED'] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={value.discountType === type}
              onClick={() => set('discountType', type)}
              className={`rounded-lg border px-4 py-2 text-sm ${value.discountType === type ? 'border-brand bg-brand-50 text-brand-600' : 'border-line bg-white'}`}
            >
              {t(`wizard.type.${type}`)}
            </button>
          ))}
        </div>
      </div>
      {value.discountType === 'PERCENT' && (
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('wizard.percent')}>
            <input
              className="input ltr"
              inputMode="decimal"
              value={value.percent}
              onChange={(e) => set('percent', e.target.value)}
            />
          </Field>
          {money('wizard.maxDiscount', 'maxDiscount')}
          {money('wizard.minSpend', 'minSpend')}
        </div>
      )}
      {value.discountType === 'FIXED' && (
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={`${t('wizard.fixedAmount')} (${currency})`}>
            <input
              className="input ltr"
              inputMode="decimal"
              value={value.fixedAmount}
              onChange={(e) => set('fixedAmount', e.target.value)}
            />
          </Field>
          {money('wizard.minSpend', 'minSpend')}
        </div>
      )}
      {value.discountType === 'TIERED' && (
        <div className="space-y-3">
          <p className="text-xs text-ink-muted">{t('wizard.tierHint')}</p>
          {value.tiers.map((tier, i) => (
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
                        value.tiers.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
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
                    value.tiers.filter((_, j) => j !== i),
                  )
                }
                disabled={value.tiers.length === 1}
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
                ...value.tiers,
                { minSpend: '', percent: '', amount: '', maxDiscount: '' },
              ])
            }
          >
            + {t('wizard.addTier')}
          </Button>
        </div>
      )}
    </div>
  );
}
