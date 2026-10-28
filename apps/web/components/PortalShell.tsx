'use client';

import { Building2, FileText, LayoutDashboard, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAreaGuard, useSession } from '@/lib/session';
import { Avatar } from './AdminShell';
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
    { href: '/portal', label: t('portal.overview'), icon: LayoutDashboard },
    { href: '/portal/documents', label: t('portal.documents'), icon: FileText },
  ];
  const partnerName = partner.data
    ? locale === 'ar' && partner.data.nameAr
      ? partner.data.nameAr
      : partner.data.name
    : '';
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="sm:hidden">
              <Logo compact />
            </span>
            <span className="hidden sm:inline">
              <Logo />
            </span>
            {partnerName && (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-ink-muted">
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{partnerName}</span>
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <LanguageToggle />
            <span className="hidden items-center gap-2 text-xs text-ink-muted md:flex">
              <Avatar name={user.name} />
              {user.name}
            </span>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              onClick={() => void logout()}
              aria-label={t('nav.signOut')}
            >
              <LogOut className="h-4 w-4 rtl:rotate-180" aria-hidden />
              <span className="hidden sm:inline">{t('nav.signOut')}</span>
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {tabs.map(({ icon: Icon, ...tab }) => {
            const active =
              tab.href === '/portal'
                ? path === '/portal' || path.startsWith('/portal/campaigns')
                : path.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm ${active ? 'border-brand font-medium text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}
              >
                <Icon className="h-4 w-4" aria-hidden />
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
