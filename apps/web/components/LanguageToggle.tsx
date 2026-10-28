'use client';

import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const { user } = useSession();
  const next = locale === 'en' ? 'ar' : 'en';
  return (
    <button
      className="h-8 rounded-lg px-3 text-sm text-ink-muted hover:bg-canvas hover:text-ink"
      onClick={() => {
        setLocale(next);
        if (user)
          void api('/users/me/locale', { method: 'PATCH', body: { locale: next } }).catch(
            () => undefined,
          );
      }}
    >
      {t('lang.switch')}
    </button>
  );
}
