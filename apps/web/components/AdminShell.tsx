'use client';

import {
  ArrowLeftRight,
  Bell,
  ClipboardCheck,
  CreditCard,
  FlaskConical,
  Handshake,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  OctagonAlert,
  Receipt,
  ShieldCheck,
  Store,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAreaGuard, useSession, type Role } from '@/lib/session';
import type { MessageKey } from '@/messages/en';
import { LanguageToggle } from './LanguageToggle';
import { Logo } from './Logo';
import { Loading } from './ui';

interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  roles?: Role[];
}

const NAV: Array<{ group: MessageKey; items: NavItem[] }> = [
  {
    group: 'nav.groupOperate',
    items: [
      { href: '/admin', label: 'nav.overview', icon: LayoutDashboard },
      { href: '/admin/campaigns', label: 'nav.campaigns', icon: Megaphone },
      { href: '/admin/approvals', label: 'nav.approvals', icon: ClipboardCheck },
      { href: '/admin/simulator', label: 'nav.simulator', icon: FlaskConical },
      { href: '/admin/transactions', label: 'nav.transactions', icon: ArrowLeftRight },
      {
        href: '/admin/settlements',
        label: 'nav.settlements',
        icon: Receipt,
        roles: ['ADMIN', 'FINANCE', 'APPROVER', 'VIEWER'],
      },
    ],
  },
  {
    group: 'nav.groupNetwork',
    items: [
      { href: '/admin/partners', label: 'nav.partners', icon: Handshake },
      { href: '/admin/merchants', label: 'nav.merchants', icon: Store },
      { href: '/admin/terminals', label: 'nav.terminals', icon: CreditCard },
      { href: '/admin/acquirers', label: 'nav.acquirers', icon: Landmark },
    ],
  },
  {
    group: 'nav.groupAdmin',
    items: [
      { href: '/admin/alerts', label: 'nav.alerts', icon: Bell },
      { href: '/admin/safety', label: 'nav.safety', icon: ShieldCheck },
      { href: '/admin/users', label: 'nav.users', icon: Users, roles: ['ADMIN'] },
      {
        href: '/admin/audit',
        label: 'nav.audit',
        icon: History,
        roles: ['ADMIN', 'APPROVER', 'FINANCE'],
      },
    ],
  },
];

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function Avatar({ name }: { name: string }) {
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { ready, user } = useAreaGuard('admin');
  const { logout } = useSession();
  const { t } = useI18n();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const safety = useApi<{ killSwitch: { enabled: boolean; reason?: string } }>(
    ready ? '/safety' : null,
    { refreshMs: 30_000 },
  );

  // The mobile drawer closes on navigation and on Escape, and the page behind it does not scroll.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!ready || !user) return <Loading />;

  const isActive = (href: string) =>
    href === '/admin' ? path === '/admin' : path.startsWith(href);

  const nav = (
    <nav className="space-y-6 px-3 py-4" aria-label={t('nav.main')}>
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.roles || i.roles.includes(user.role));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t(g.group)}
            </div>
            <ul className="space-y-0.5">
              {items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${active ? 'bg-brand-50 font-medium text-brand' : 'text-ink-muted hover:bg-canvas hover:text-ink'}`}
                    >
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-brand' : 'text-ink-faint group-hover:text-ink-muted'}`}
                        aria-hidden
                      />
                      {t(label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const userCard = (
    <div className="flex items-center gap-3 border-t border-line p-4">
      <Avatar name={user.name} />
      <div className="min-w-0 flex-1 text-xs">
        <div className="truncate font-medium text-ink">{user.name}</div>
        <div className="truncate text-ink-faint">{t(`role.${user.role}`)}</div>
      </div>
      <button
        className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-canvas hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        onClick={() => void logout()}
        aria-label={t('nav.signOut')}
        title={t('nav.signOut')}
      >
        <LogOut className="h-4 w-4 rtl:rotate-180" aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden border-e border-line bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="px-6 py-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        {userCard}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-navy-dark/40 motion-safe:animate-[fade_150ms_ease-out]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside
            role="dialog"
            aria-modal
            aria-label={t('nav.main')}
            className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl motion-safe:animate-[slide-in_200ms_ease-out] rtl:motion-safe:animate-[slide-in-rtl_200ms_ease-out]"
          >
            <div className="flex items-center justify-between px-5 py-4">
              <Logo />
              <button
                className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-canvas"
                onClick={() => setOpen(false)}
                aria-label={t('nav.closeMenu')}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {userCard}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white/90 px-3 backdrop-blur sm:px-4 lg:px-8">
          <button
            className="grid h-10 w-10 place-items-center rounded-lg text-ink-muted hover:bg-canvas lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={t('nav.openMenu')}
            aria-expanded={open}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="flex-1" />
          <LanguageToggle />
          <div className="hidden items-center gap-2 text-end text-xs sm:flex lg:hidden">
            <Avatar name={user.name} />
          </div>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink-muted hover:bg-canvas hover:text-ink lg:hidden"
            onClick={() => void logout()}
            aria-label={t('nav.signOut')}
          >
            <LogOut className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
          <button
            className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-ink-muted hover:bg-canvas hover:text-ink lg:inline-flex"
            onClick={() => void logout()}
          >
            <LogOut className="h-4 w-4 rtl:rotate-180" aria-hidden />
            {t('nav.signOut')}
          </button>
        </header>
        {safety.data?.killSwitch.enabled && (
          <div
            role="alert"
            className="flex items-center justify-center gap-2 bg-bad px-4 py-2 text-center text-sm font-medium text-white lg:px-8"
          >
            <OctagonAlert className="h-4 w-4 shrink-0" aria-hidden />
            {t('safety.banner', { reason: safety.data.killSwitch.reason ?? '' })}
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
