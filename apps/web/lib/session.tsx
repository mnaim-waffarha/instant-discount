'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { useI18n } from './i18n';

export type Role =
  'ADMIN' | 'CAMPAIGN_MANAGER' | 'APPROVER' | 'FINANCE' | 'VIEWER' | 'PARTNER_USER';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  partnerId: string | null;
  locale: 'en' | 'ar';
}

interface Session {
  user: SessionUser | null;
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLocale, locale } = useI18n();

  const reload = useCallback(async () => {
    try {
      const me = await api<SessionUser>('/auth/me');
      setUser(me);
      if (me.locale !== locale) setLocale(me.locale);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setUser(null);
    } finally {
      setLoading(false);
    }
    // Only on mount / explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { body: {} }).catch(() => undefined);
    setUser(null);
    window.location.href = '/login';
  }, []);

  const can = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user]);

  return (
    <SessionContext.Provider value={{ user, loading, reload, logout, can }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}

/** Sends visitors to login, and partner users and staff to their own area. */
export function useAreaGuard(area: 'admin' | 'portal') {
  const { user, loading } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (area === 'admin' && user.role === 'PARTNER_USER') router.replace('/portal');
    else if (area === 'portal' && user.role !== 'PARTNER_USER') router.replace('/admin');
  }, [user, loading, area, router, path]);
  const allowed =
    !!user && (area === 'portal' ? user.role === 'PARTNER_USER' : user.role !== 'PARTNER_USER');
  return { user, ready: !loading && allowed };
}

export const EDITORS: Role[] = ['ADMIN', 'CAMPAIGN_MANAGER'];
export const APPROVERS: Role[] = ['ADMIN', 'APPROVER'];
