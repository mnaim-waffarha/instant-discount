'use client';

import { LanguageToggle } from '@/components/LanguageToggle';
import { Logo } from '@/components/Logo';
import { Loading } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useAreaGuard, useSession } from '@/lib/session';

/** Placeholder until the partner portal is built in Phase 3. */
export default function PortalPage() {
  const { ready, user } = useAreaGuard('portal');
  const { logout } = useSession();
  const { t } = useI18n();
  if (!ready || !user) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-8 flex items-center justify-between">
        <Logo />
        <div className="flex gap-2">
          <LanguageToggle />
          <button className="text-sm text-ink-muted" onClick={() => void logout()}>
            {t('nav.signOut')}
          </button>
        </div>
      </header>
      <h1 className="text-2xl font-semibold">{t('portal.title')}</h1>
      <p className="mt-2 text-sm text-ink-muted">{user.name}</p>
    </div>
  );
}
