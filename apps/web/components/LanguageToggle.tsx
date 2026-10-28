'use client';

import { Languages } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const { user } = useSession();
  const next = locale === 'en' ? 'ar' : 'en';
  return (
    <button
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      onClick={() => {
        setLocale(next);
        if (user)
          void api('/users/me/locale', { method: 'PATCH', body: { locale: next } }).catch(
            () => undefined,
          );
      }}
    >
      <Languages className="h-4 w-4" aria-hidden />
      {t('lang.switch')}
    </button>
  );
}
