'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAreaGuard, useSession } from '@/lib/session';
import { LanguageToggle } from './LanguageToggle';
import { Logo } from './Logo';
import { Loading } from './ui';

export function PortalShell({ children }: { children: ReactNode }) {
  const { ready, user } = useAreaGuard('portal');
  const { logout } = useSession();
  const { t, locale } = useI18n();
  const path = usePathname();
  const partner = useApi<{ name: string; nameAr: string | null }>(ready ? '/portal/me' : null);
  if (!ready || !user) return <Loading />;
  const tabs = [
    { href: '/portal', label: t('portal.overview') },
    { href: '/portal/documents', label: t('portal.documents') },
  ];
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden text-sm text-ink-muted sm:inline">
              ·{' '}
              {partner.data
                ? locale === 'ar' && partner.data.nameAr
                  ? partner.data.nameAr
                  : partner.data.name
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <span className="hidden text-xs text-ink-muted sm:inline">{user.name}</span>
            <button
              className="h-8 rounded-lg px-3 text-sm text-ink-muted hover:bg-canvas hover:text-ink"
              onClick={() => void logout()}
            >
              {t('nav.signOut')}
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4">
          {tabs.map((tab) => {
            const active =
              tab.href === '/portal'
                ? path === '/portal' || path.startsWith('/portal/campaigns')
                : path.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`border-b-2 px-3 py-2 text-sm ${active ? 'border-brand font-medium text-brand-600' : 'border-transparent text-ink-muted hover:text-ink'}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
