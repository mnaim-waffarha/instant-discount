'use client';

import type { ReactNode } from 'react';
import type { Locale } from '@/lib/format';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nProvider initialLocale={locale}>
      <SessionProvider>{children}</SessionProvider>
    </I18nProvider>
  );
}
