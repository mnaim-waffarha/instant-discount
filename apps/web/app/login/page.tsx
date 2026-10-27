'use client';

import Script from 'next/script';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Logo } from '@/components/Logo';
import { Button, ErrorBox, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession, type SessionUser } from '@/lib/session';

interface RuntimeConfig {
  googleClientId: string | null;
  devLogin: boolean;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: {
            client_id: string;
            callback: (r: { credential: string }) => void;
            hd?: string;
          }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

function LoginForm() {
  const { t, locale } = useI18n();
  const { user, reload } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [devEmail, setDevEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<RuntimeConfig>();
  useEffect(() => {
    fetch('/runtime-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ googleClientId: null, devLogin: false }));
  }, []);
  const GOOGLE_CLIENT_ID = config?.googleClientId;
  const DEV_LOGIN = config?.devLogin ?? false;

  const goHome = useCallback(
    (u: SessionUser) =>
      router.replace(
        next && next.startsWith('/') ? next : u.role === 'PARTNER_USER' ? '/portal' : '/admin',
      ),
    [next, router],
  );

  useEffect(() => {
    if (user) goHome(user);
  }, [user, goHome]);

  const finish = async (call: Promise<SessionUser>) => {
    setBusy(true);
    setError(undefined);
    try {
      const u = await call;
      await reload();
      goHome(u);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const renderGoogle = () => {
    const el = document.getElementById('google-button');
    if (!GOOGLE_CLIENT_ID || !window.google || !el) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      hd: 'waffarha.com',
      callback: (r) =>
        void finish(api<SessionUser>('/auth/google', { body: { idToken: r.credential } })),
    });
    window.google.accounts.id.renderButton(el, {
      theme: 'outline',
      size: 'large',
      width: 320,
      locale,
    });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      {GOOGLE_CLIENT_ID && (
        <Script src="https://accounts.google.com/gsi/client" onLoad={renderGoogle} />
      )}
      <div className="absolute end-4 top-4">
        <LanguageToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo />
          <h1 className="mt-6 text-2xl font-semibold">{t('login.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('login.subtitle')}</p>
        </div>

        <div className="space-y-4">
          <ErrorBox error={error} />

          <section className="card p-5">
            <h2 className="text-sm font-semibold">{t('login.staff')}</h2>
            <p className="mb-4 mt-1 text-xs text-ink-muted">{t('login.staffHint')}</p>
            {GOOGLE_CLIENT_ID ? (
              <div id="google-button" className="flex justify-center" />
            ) : (
              <p className="text-xs text-ink-faint">{t('login.googleNotConfigured')}</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold">{t('login.partner')}</h2>
            <p className="mb-4 mt-1 text-xs text-ink-muted">{t('login.partnerHint')}</p>
            {linkSent ? (
              <p className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok">{t('login.linkSent')}</p>
            ) : (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api('/auth/magic-link', { body: { email } });
                    setLinkSent(true);
                  } catch (err) {
                    setError((err as ApiError).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label={t('common.email')}>
                  <input
                    className="input ltr"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </Field>
                <Button className="w-full" loading={busy}>
                  {t('login.sendLink')}
                </Button>
              </form>
            )}
          </section>

          {DEV_LOGIN && (
            <section className="card border-dashed p-5">
              <h2 className="text-sm font-semibold">{t('login.dev')}</h2>
              <p className="mb-4 mt-1 text-xs text-ink-muted">{t('login.devHint')}</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void finish(api<SessionUser>('/auth/dev-login', { body: { email: devEmail } }));
                }}
              >
                <input
                  className="input ltr"
                  type="email"
                  required
                  placeholder="name@waffarha.com"
                  value={devEmail}
                  onChange={(e) => setDevEmail(e.target.value)}
                  aria-label={t('common.email')}
                />
                <Button variant="secondary" loading={busy}>
                  {t('login.devButton')}
                </Button>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
