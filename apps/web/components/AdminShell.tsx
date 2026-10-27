'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAreaGuard, useSession, type Role } from '@/lib/session';
import type { MessageKey } from '@/messages/en';
import { LanguageToggle } from './LanguageToggle';
import { Logo } from './Logo';
import { Loading } from './ui';

interface NavItem {
  href: string;
  label: MessageKey;
  roles?: Role[];
}

const NAV: Array<{ group: MessageKey; items: NavItem[] }> = [
  {
    group: 'nav.groupOperate',
    items: [
      { href: '/admin', label: 'nav.overview' },
      { href: '/admin/campaigns', label: 'nav.campaigns' },
      { href: '/admin/approvals', label: 'nav.approvals' },
      { href: '/admin/simulator', label: 'nav.simulator' },
      { href: '/admin/transactions', label: 'nav.transactions' },
      {
        href: '/admin/settlements',
        label: 'nav.settlements',
        roles: ['ADMIN', 'FINANCE', 'APPROVER', 'VIEWER'],
      },
    ],
  },
  {
    group: 'nav.groupNetwork',
    items: [
      { href: '/admin/partners', label: 'nav.partners' },
      { href: '/admin/merchants', label: 'nav.merchants' },
      { href: '/admin/terminals', label: 'nav.terminals' },
      { href: '/admin/acquirers', label: 'nav.acquirers' },
    ],
  },
  {
    group: 'nav.groupAdmin',
    items: [
      { href: '/admin/users', label: 'nav.users', roles: ['ADMIN'] },
      { href: '/admin/audit', label: 'nav.audit', roles: ['ADMIN', 'APPROVER', 'FINANCE'] },
    ],
  },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { ready, user } = useAreaGuard('admin');
  const { logout } = useSession();
  const { t } = useI18n();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  if (!ready || !user) return <Loading />;

  const isActive = (href: string) =>
    href === '/admin' ? path === '/admin' : path.startsWith(href);

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`${open ? 'block' : 'hidden'} border-e border-line bg-white lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto`}
      >
        <div className="hidden px-5 py-5 lg:block">
          <Logo />
        </div>
        <nav className="space-y-5 px-3 pb-6">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.roles || i.roles.includes(user.role));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {t(g.group)}
                </div>
                {items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm ${isActive(i.href) ? 'bg-brand-50 font-medium text-brand-600' : 'text-ink-muted hover:bg-canvas hover:text-ink'}`}
                  >
                    {t(i.label)}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <button
              className="rounded-lg px-2 py-1 text-ink-muted hover:bg-canvas"
              onClick={() => setOpen(!open)}
              aria-label="Menu"
            >
              ☰
            </button>
            <Logo compact />
          </div>
          <div className="flex-1" />
          <LanguageToggle />
          <div className="hidden text-end text-xs sm:block">
            <div className="font-medium">{user.name}</div>
            <div className="text-ink-faint">{t(`role.${user.role}`)}</div>
          </div>
          <button
            className="h-8 rounded-lg px-3 text-sm text-ink-muted hover:bg-canvas hover:text-ink"
            onClick={() => void logout()}
          >
            {t('nav.signOut')}
          </button>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
