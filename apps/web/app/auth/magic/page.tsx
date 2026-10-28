'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

function Verify() {
  const { t } = useI18n();
  const { reload } = useSession();
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Links are single use: make sure React strict mode does not consume it twice.
    if (started.current) return;
    started.current = true;
    if (!token) return setFailed(true);
    api('/auth/magic-link/verify', { body: { token } })
      .then(async () => {
        await reload();
        router.replace('/portal');
      })
      .catch(() => setFailed(true));
  }, [token, reload, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      {failed ? (
        <div className="card max-w-sm p-6">
          <p className="text-sm">{t('login.linkInvalid')}</p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-brand">
            {t('login.backToLogin')}
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> {t('login.verifying')}
        </p>
      )}
    </div>
  );
}

export default function MagicPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
